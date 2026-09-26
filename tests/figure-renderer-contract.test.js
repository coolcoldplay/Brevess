const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function functionBody(script, name, nextName) {
  const start = script.indexOf('function ' + name);
  const end = nextName ? script.indexOf('function ' + nextName, start + 1) : script.length;
  return script.slice(start, end);
}

test('mechanism network core loads before popup and content entrypoints', () => {
  const html = read('popup.html');
  const { CONTENT_SCRIPT_FILES } = require('../core/tab-messenger');
  const exportIndex = html.indexOf('<script src="core/export-bundle.js"></script>');
  const networkIndex = html.indexOf('<script src="core/mechanism-network.js"></script>');
  const popupIndex = html.indexOf('<script src="popup.js"></script>');
  assert.ok(exportIndex >= 0 && exportIndex < networkIndex);
  assert.ok(networkIndex >= 0 && networkIndex < popupIndex);
  const contentNetworkIndex = CONTENT_SCRIPT_FILES.indexOf('core/mechanism-network.js');
  const contentIndex = CONTENT_SCRIPT_FILES.indexOf('content.js');
  assert.ok(contentNetworkIndex >= 0 && contentNetworkIndex < contentIndex);
});

test('content script defines bounded Figure image preparation', () => {
  const script = read('content.js');
  assert.match(script, /FIGURE_IMAGE_MAX_EDGE\s*=\s*1600/);
  assert.match(script, /FIGURE_IMAGE_MAX_BYTES\s*=\s*1572864/);
  assert.match(script, /FIGURE_IMAGE_LIMIT\s*=\s*4/);
  assert.match(script, /FIGURE_IMAGE_LOAD_TIMEOUT_MS\s*=\s*8000/);
  assert.match(script, /FIGURE_IMAGE_PREPARATION_TIMEOUT_MS\s*=\s*12000/);
  assert.match(script, /prepareFigureImages/);
  assert.match(script, /canvas\.toDataURL\(['"]image\/jpeg/);
  assert.match(script, /FIGURE_IMAGE_TIMEOUT/);
  assert.match(script, /signal:\s*controller\.signal/);
});

test('Figure input hashes use compact image identity and invalidate replaced supplemental sources', () => {
  const script = read('content.js');
  const source = functionBody(script, 'buildFigureInputHash', 'isCompleteFigureAnalysisResult');
  const buildFigureInputHash = new Function(
    'FIGURE_IMAGE_LIMIT',
    `${source}\nreturn buildFigureInputHash;`
  )(4);
  const figure = {
    figureId: 'supp-manual-s1-s1',
    caption: 'Figure S1. Replication.',
    panelHints: ['A'],
    contextParagraphs: [],
    sourceFingerprint: `sha256:${'a'.repeat(64)}`
  };
  const firstImage = [{
    mediaType: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
    width: 1,
    height: 1,
    sourceFingerprint: `sha256:${'b'.repeat(64)}`,
    sourceUrl: 'https://journal.example/figure-s1.png'
  }];
  const replacementWithSameLength = [{
    ...firstImage[0],
    dataUrl: 'data:image/png;base64,AAAB'
  }];

  const first = buildFigureInputHash(figure, firstImage);
  assert.equal(buildFigureInputHash(structuredClone(figure), structuredClone(firstImage)), first);
  assert.notEqual(buildFigureInputHash(figure, replacementWithSameLength), first);
  assert.notEqual(buildFigureInputHash({
    ...figure,
    sourceFingerprint: `sha256:${'c'.repeat(64)}`
  }, firstImage), first);
  const strippedPreparedImage = [{
    mediaType: firstImage[0].mediaType,
    dataUrl: firstImage[0].dataUrl
  }];
  const persisted = buildFigureInputHash({
    ...figure,
    analysisImages: firstImage
  }, strippedPreparedImage);
  assert.notEqual(buildFigureInputHash({
    ...figure,
    analysisImages: [{
      ...firstImage[0],
      persistedFingerprint: `sha256:${'d'.repeat(64)}`,
      sourceUrl: 'https://journal.example/replaced-figure-s1.png'
    }]
  }, strippedPreparedImage), persisted);
  assert.equal(
    buildFigureInputHash(figure, []),
    buildFigureInputHash(structuredClone(figure), [])
  );

  assert.match(source, /sourceFingerprint/);
  assert.match(source, /encodedLength/);
  assert.match(source, /decodedLength/);
  assert.match(source, /dataFingerprint/);
  assert.doesNotMatch(source, /images:\s*images/);
  assert.doesNotMatch(source, /dataUrl:\s*(?:dataUrl|image\??\.)/);
});

test('active Figure workflows never inject walkthrough cards beside webpage captions', () => {
  const script = read('content.js');
  const css = read('content.css');
  for (const name of ['analyzeSingleFigureDeep', 'analyzeSingleFigureWithLLM']) {
    const start = script.indexOf(`async function ${name}`);
    const end = script.indexOf('\nasync function ', start + 1);
    const workflow = script.slice(start, end < 0 ? script.length : end);
    assert.doesNotMatch(workflow, /renderFigureWalkthroughsFromState|renderFigureWalkthroughs\(/);
  }
  assert.doesNotMatch(css, /\.sci-figure-walkthrough\s*\{/);
  assert.match(script, /function clearFigureWalkthroughs/);
});

test('Figure side panel omits raw caption and uses snapshot-driven per-Figure state', () => {
  const popup = read('popup.js');
  const start = popup.indexOf('function renderFigureWorkspaceSnapshot');
  const end = popup.indexOf('function renderArticleWorkspaceSnapshot', start);
  const renderer = popup.slice(start, end);
  assert.doesNotMatch(renderer, /figure\.caption/);
  assert.match(popup, /function figureCatalogPanelIds/);
  assert.match(popup, /figure\?\.panelHints/);
  assert.doesNotMatch(popup, /singleFigureRunningIds/);
  assert.match(renderer, /progress\?\.running === true/);
  assert.match(popup, /解图中/);
  assert.match(popup, /compactFigureResultConclusion/);
  assert.match(renderer, /workspace-figure-summary-conclusion/);
});

test('content owns, populates, captures, and restores the bounded Figure workspace draft', () => {
  const script = read('content.js');
  assert.match(script, /let figureWorkspaceDraft\s*=\s*SciLLM\.createFigureWorkspaceDraft\(\[\]\)/);
  assert.match(script, /combinedFigureWorkspaceInventory/);
  assert.match(script, /\.\.\.figureWorkspaceInventory[\s\S]*\.\.\.getImportedSupplementalFigureInventory\(\)/);
  assert.match(script, /\['figures\/workspace-draft\.json',\s*SciLLM\.publicFigureWorkspaceDraft\(figureWorkspaceDraft\)\]/);
  assert.match(script, /byPath\.get\(FIGURE_WORKSPACE_DRAFT_ASSET_PATH\)/);
  assert.match(script, /SciLLM\.initializeFigureWorkspaceDraftState\(/);
  assert.match(script, /draft:\s*SciLLM\.publicFigureWorkspaceDraft\(figureWorkspaceDraft\)/);
  assert.match(script, /createPortableFigureWorkspaceArchiveFields\([\s\S]*SciLLM\.publicFigureWorkspaceDraft\(figureWorkspaceDraft\)/);
  const populateSource = functionBody(
    script, 'populateFigureWorkspaceDraft', 'getFigureWorkspaceInventory'
  );
  assert.match(populateSource, /seedFigures\(inventory\)/);
  assert.doesNotMatch(populateSource, /figureWorkspaceDraftController\s*=\s*null/);
  assert.match(script, /let figureWorkspaceInventorySeedPromise\s*=\s*Promise\.resolve\(\)/);
  assert.match(script, /function ensureFigureWorkspaceInventorySeeded/);
  const seedBarrierSource = functionBody(
    script, 'ensureFigureWorkspaceInventorySeeded', 'getFigureWorkspaceInventory'
  );
  assert.match(seedBarrierSource, /FIGURE_WORKSPACE_INVENTORY_SEED_FAILED/);
  assert.doesNotMatch(seedBarrierSource, /error\?\.message/);

  for (const [name, nextName] of [
    ['analyzeSingleFigureDeep', 'analyzeSingleFigureWithLLM'],
    ['analyzeSingleFigureWithLLM', 'mergeSinglePanelIntoFigureResult'],
    ['analyzeSingleFigurePanelWithLLM', 'askFigurePanelWithLLM'],
    ['askFigurePanelWithLLM', 'cancelFigureAnalysis']
  ]) {
    const source = functionBody(script, name, nextName);
    const refreshIndex = source.indexOf('getFigureWorkspaceInventory()');
    const barrierIndex = source.indexOf('await ensureFigureWorkspaceInventorySeeded()');
    const providerIndex = source.indexOf('chrome.runtime.sendMessage');
    assert.ok(refreshIndex >= 0 && barrierIndex > refreshIndex,
      `${name} must await the inventory seed after refresh`);
    assert.ok(providerIndex < 0 || barrierIndex < providerIndex,
      `${name} must await the inventory seed before provider work`);
  }
  const crossSource = functionBody(
    script, 'analyzeCrossFigureLogicWithLLM', 'analyzeFiguresWithLLM'
  );
  assert.match(crossSource,
    /getFigureWorkspaceInventory\(\);[\s\S]*await ensureFigureWorkspaceInventorySeeded\(\)/);
  assert.ok(crossSource.indexOf('await ensureFigureWorkspaceInventorySeeded()') <
    crossSource.indexOf('chrome.runtime.sendMessage'));
  const batchSource = functionBody(
    script, 'analyzeFiguresWithLLM', 'cancelFigureAnalysis'
  );
  assert.ok(batchSource.indexOf('await ensureFigureWorkspaceInventorySeeded()') <
    batchSource.indexOf('chrome.runtime.sendMessage'));
});

test('single-Panel refresh replaces in place instead of moving the Panel to the tail', () => {
  const script = read('content.js');
  const normalizeSource = functionBody(
    script, 'normalizeRequestedPanelId', 'mergeSinglePanelIntoFigureResult'
  );
  const mergeStart = script.indexOf('function mergeSinglePanelIntoFigureResult');
  const mergeEnd = script.indexOf('\nasync function computePageDocumentHash', mergeStart);
  const mergeSource = script.slice(mergeStart, mergeEnd);
  const mergeSinglePanelIntoFigureResult = new Function(
    `${normalizeSource}\n${mergeSource}\nreturn mergeSinglePanelIntoFigureResult;`
  )();
  const result = {
    panels: [{ panel: 'A' }, { panel: 'B', purpose: 'old' }, { panel: 'C' }]
  };
  const merged = mergeSinglePanelIntoFigureResult(
    result, { panel: 'B', purpose: 'new' }, { panelHints: ['A', 'B', 'C'] }
  );
  assert.deepEqual(merged.panels.map(item => item.panel), ['A', 'B', 'C']);
  assert.equal(merged.panels[1].purpose, 'new');
});

test('Figure workspace messages serialize persistence, roll back failures, and notify after success', () => {
  const script = read('content.js');
  const ensureSource = functionBody(
    script, 'ensureFigureWorkspaceDraftController', 'mutateFigureWorkspaceDraft'
  );
  const mutateSource = functionBody(
    script, 'mutateFigureWorkspaceDraft', 'restoreFigureWorkspaceModelValue'
  );
  assert.match(script, /SciLLM\.createFigureWorkspaceDraftController/);
  assert.match(ensureSource, /SciLLM\.initializeFigureWorkspaceDraftState\(/);
  assert.match(ensureSource, /durableAsset:\s*asset/);
  assert.match(ensureSource, /memoryDraft:\s*figureWorkspaceDraft/);
  assert.match(ensureSource, /inventory:\s*combinedFigureWorkspaceInventory\(\)/);
  assert.match(ensureSource, /initialDirty:\s*figureWorkspaceDraftDirty/);
  assert.match(ensureSource, /figureWorkspaceDraft\s*=\s*initialized\.draft/);
  assert.match(script, /let figureWorkspaceDraftDirty\s*=\s*false/);
  assert.match(script, /persistWorkspaceAssetCheckpoint\(\s*FIGURE_WORKSPACE_DRAFT_ASSET_PATH/);
  assert.match(script, /expectedRevision:\s*request\.expectedRevision/);
  assert.match(script, /expectedContentHash:\s*request\.expectedContentHash/);
  assert.match(script, /acceptCommittedStale:\s*true/);
  assert.match(mutateSource, /ensureFigureWorkspaceDraftController\(\)/);
  assert.match(mutateSource, /controller\.mutate\(mutation/);
  assert.match(mutateSource,
    /workspaceLifecycle === articleWorkspaceLifecycleGeneration[\s\S]*figureWorkspaceDraftController === controller/);
  assert.doesNotMatch(mutateSource, /persistArticleWorkspaceArtifacts/);
  const flushSource = functionBody(
    script, 'flushFigureWorkspaceDraft', 'persistArticleAbbreviationMutation'
  );
  assert.match(flushSource, /ensureFigureWorkspaceDraftController\(\)/);
  assert.match(flushSource, /controller\.flush\(\)/);

  for (const action of [
    'updateFigureWorkspaceDraft', 'restoreFigureWorkspaceModelValue', 'flushFigureWorkspaceDraft'
  ]) {
    assert.match(script, new RegExp(`request\\.action === '${action}'`));
  }
  assert.match(script, /FIGURE_WORKSPACE_DRAFT_SAVE_FAILED/);
  assert.match(script, /function publicFigureWorkspaceDraftFailure/);
  assert.match(script, /\^\[A-Z\]\[A-Z0-9_\]\{0,99\}\$/);

  const artifactPersistSource = functionBody(
    script, 'persistArticleWorkspaceArtifacts', 'persistArticleWorkspaceBaseline'
  );
  assert.match(artifactPersistSource,
    /if \(path === FIGURE_WORKSPACE_DRAFT_ASSET_PATH\) continue/);
  assert.match(artifactPersistSource, /await flushFigureWorkspaceDraft\(\)/);
  assert.ok(
    artifactPersistSource.indexOf('await flushFigureWorkspaceDraft()') >
      artifactPersistSource.indexOf('for (const [path, content]'),
    'draft checkpoint must be written only after every unrelated asset succeeds'
  );
});

test('Figure draft write targets reject a same-tab document switch before mutation', () => {
  const script = read('content.js');
  const sourceStart = script.indexOf('function assertCurrentFigureWorkspaceEditTarget');
  const sourceEnd = script.indexOf('\nasync function mutateFigureWorkspaceDraft', sourceStart);
  assert.ok(sourceStart >= 0 && sourceEnd > sourceStart);
  const source = script.slice(sourceStart, sourceEnd);
  const assertCurrentFigureWorkspaceEditTarget = new Function(
    'SciLLM', `${source}\nreturn assertCurrentFigureWorkspaceEditTarget;`
  )({
    normalizeWorkspaceCanonicalUrl(value) {
      return new URL(String(value)).toString().replace(/\/$/u, '');
    }
  });
  const hashA = 'a'.repeat(64);
  const hashB = 'b'.repeat(64);
  const targetA = {
    workspaceId: `workspace:${hashA}`,
    workspaceGeneration: 2,
    canonicalUrl: 'https://journal.example/paper-a',
    contentHash: hashA
  };
  const workspaceA = { ...targetA };
  const workspaceB = {
    workspaceId: `workspace:${hashB}`,
    workspaceGeneration: 1,
    canonicalUrl: 'https://journal.example/paper-b',
    contentHash: hashB
  };

  assert.deepEqual(
    assertCurrentFigureWorkspaceEditTarget(targetA, workspaceA),
    targetA
  );
  assert.throws(
    () => assertCurrentFigureWorkspaceEditTarget(targetA, workspaceB),
    error => error.code === 'FIGURE_WORKSPACE_CONTEXT_MISMATCH' &&
      error.message === 'FIGURE_WORKSPACE_CONTEXT_MISMATCH'
  );
  assert.throws(
    () => assertCurrentFigureWorkspaceEditTarget({ ...targetA, workspaceId: '__proto__' }, workspaceA),
    error => error.code === 'FIGURE_WORKSPACE_CONTEXT_INVALID'
  );

  assert.match(script,
    /request\.action === 'updateFigureWorkspaceDraft'[\s\S]*mutateFigureWorkspaceDraftForTarget\(request\)/);
  assert.match(script,
    /request\.action === 'flushFigureWorkspaceDraft'[\s\S]*flushFigureWorkspaceDraftForTarget\(request\)/);
});

test('secured Figure restore keeps workspace identity separate from every Task5 restore kind', async () => {
  const script = read('content.js');
  const start = script.indexOf('async function restoreFigureWorkspaceModelValueForTarget');
  const end = script.indexOf('\nasync function flushFigureWorkspaceDraftForTarget', start);
  assert.ok(start >= 0 && end > start);
  const restoreFigureWorkspaceModelValueForTarget = new Function(
    `${script.slice(start, end)}\nreturn restoreFigureWorkspaceModelValueForTarget;`
  )();
  const hashA = 'a'.repeat(64);
  const workspace = {
    workspaceId: `workspace:${hashA}`, workspaceGeneration: 2,
    canonicalUrl: 'https://journal.example/paper-a', contentHash: hashA
  };
  const restored = [];
  const dependencies = {
    getLifecycle: () => 7,
    ensureWorkspace: async () => workspace,
    assertLifecycle: lifecycle => assert.equal(lifecycle, 7),
    assertTarget(workspaceTarget, current) {
      if (workspaceTarget.workspaceId !== current.workspaceId) {
        const error = new Error('FIGURE_WORKSPACE_CONTEXT_MISMATCH');
        error.code = error.message;
        throw error;
      }
    },
    restore: async request => {
      restored.push(request.target);
      return { success: true, target: request.target };
    }
  };
  for (const target of ['figure_field', 'panel_field', 'panel_list']) {
    const result = await restoreFigureWorkspaceModelValueForTarget({
      workspaceTarget: workspace, target, figureId: 'figure-1',
      panelId: target === 'figure_field' ? undefined : 'A', field: 'purpose'
    }, dependencies);
    assert.equal(result.target, target);
  }
  assert.deepEqual(restored, ['figure_field', 'panel_field', 'panel_list']);

  await assert.rejects(
    restoreFigureWorkspaceModelValueForTarget({
      workspaceTarget: { ...workspace, workspaceId: `workspace:${'b'.repeat(64)}` },
      target: 'figure_field', figureId: 'figure-1', field: 'coreConclusion'
    }, dependencies),
    error => error.code === 'FIGURE_WORKSPACE_CONTEXT_MISMATCH'
  );
  assert.deepEqual(restored, ['figure_field', 'panel_field', 'panel_list']);
  assert.match(script,
    /restoreFigureWorkspaceModelValueForTarget[\s\S]*request\.workspaceTarget[\s\S]*restore\(request\)/);
});

test('Figure workspace reset and archive restore preserve notebook backward compatibility', () => {
  const script = read('content.js');
  const archiveRestore = functionBody(
    script, 'applyArticleArchiveSnapshot', 'applyArticleWorkspaceAssets'
  );
  assert.match(archiveRestore, /restoreFigureWorkspaceDraft\(/);
  assert.match(archiveRestore, /resolveArchivedFigureWorkspaceDraft\(workspace\)/);
  const archiveDraftResolver = functionBody(
    script, 'resolveArchivedFigureWorkspaceDraft', 'buildCurrentArticleArchive'
  );
  assert.match(archiveDraftResolver, /workspace\?\.figureWorkspaceDraft/);
  assert.match(archiveDraftResolver, /workspace\?\.figureWorkspace\?\.draft/);
  assert.match(archiveDraftResolver, /workspace\?\.navigation\?\.figures\?\.draft/);
  assert.match(archiveRestore, /restoredFigureWorkspaceSnapshot\?\.figures/);

  const reset = functionBody(
    script, 'resetArticleWorkspaceState', 'prepareExternalArticleWorkspaceDeletion'
  );
  assert.match(reset, /figureWorkspaceDraft\s*=\s*SciLLM\.createFigureWorkspaceDraft\(\[\]\)/);
  assert.match(script, /savedFigureWorkspaceDraftAsset/);
  assert.match(script, /savedFigureWorkspaceDraftAsset\?\.revision/);
  assert.match(script, /savedFigureWorkspaceDraftAsset\?\.contentHash/);
});

test('Figure panel cards use a compact role, phenotype, and method header while retaining evidence', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const start = popup.indexOf('function renderFigureWorkspaceSnapshot');
  const end = popup.indexOf('function renderArticleWorkspaceSnapshot', start);
  const renderer = popup.slice(start, end) +
    functionBody(popup, 'appendFigurePanelSummary', 'appendFigurePanelCatalog') +
    functionBody(popup, 'appendFigurePanelCatalog', 'createCollapsibleFigureResultSection');
  assert.match(popup, /const METHOD_CATEGORY_LABELS/);
  assert.match(popup, /function formatFigurePanelHeader/);
  assert.match(renderer, /formatFigurePanelHeader\(panel, viewPanel\.displayId\)/);
  assert.match(renderer, /panel\.observationSource/);
  assert.match(renderer, /panel\.methodSource/);
  assert.match(renderer, /workspace-panel-id/);
  assert.match(renderer, /workspace-panel-description/);
  assert.match(css, /\.workspace-panel-id\s*\{[^}]*font-weight:\s*800/);
  assert.match(css, /\.workspace-panel-description\s*\{[^}]*font-weight:\s*450/);
  assert.match(popup, /function figurePanelEvidenceGroup/);
  assert.match(popup, /result\?\.panelGroups/);
  assert.match(popup, /result\?\.argumentChain/);
  assert.match(popup, /dataset\.evidenceGroup/);
  assert.match(css, /\.workspace-panel-id\[data-evidence-group="1"\]/);
  assert.match(css, /\.workspace-panel-id\[data-evidence-group="6"\]/);
});

test('Figure workspace renderer uses the shared no-LLM view and compact Panel identities', () => {
  const popup = read('popup.js');
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceSnapshot', 'renderArticleWorkspaceSnapshot'
  );
  const catalog = functionBody(
    popup, 'appendFigurePanelCatalog', 'createCollapsibleFigureResultSection'
  );
  assert.match(renderer, /figureWorkspaceViewState\.resolve\(/);
  assert.match(renderer, /appendFigureWorkspaceOverview\(details, view, snapshot\)/);
  assert.match(renderer, /appendFigurePanelCatalog\(details, figure, result, view\)/);
  assert.match(catalog, /viewPanel\.displayId/);
  assert.doesNotMatch(catalog, /`Panel \$\{panelId\}`/);
});

test('Figure deep cards expose every evidence relation and retain a compact no-panel state', () => {
  const popup = read('popup.js');
  const start = popup.indexOf('function renderFigureWorkspaceSnapshot');
  const end = popup.indexOf('function renderArticleWorkspaceSnapshot', start);
  const renderer = popup.slice(start, end) +
    functionBody(popup, 'appendFigurePanelCatalog', 'createCollapsibleFigureResultSection');
  assert.match(renderer, /control\.controlType/);
  assert.match(renderer, /result\.evidenceRelations/);
  assert.match(renderer, /result\.alternativeExplanations/);
  assert.match(renderer, /result\.missingLinksIfPanelRemoved/);
  assert.match(renderer, /workspace-figure-panel-empty/);
  assert.doesNotMatch(renderer, /figure\.caption/);
});

test('DOM-discovered Panels are available before LLM analysis and can be analyzed independently', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const panelCatalog = functionBody(popup, 'appendFigurePanelCatalog', 'createCollapsibleFigureResultSection');
  assert.match(panelCatalog, /view\.panels/);
  assert.match(panelCatalog, /viewPanel\.panelId/);
  assert.match(panelCatalog, /runSingleFigurePanelAnalysis\(figure\.figureId, panelId\)/);
  assert.match(panelCatalog,
    /createPanelFollowupControl\(figure, panel, viewPanel\.displayId\)/);
  assert.match(content, /async function analyzeSingleFigurePanelWithLLM/);
  assert.match(content, /type: 'LLM_ANALYZE_FIGURE_PANEL'/);
  assert.match(content, /figure_panel_schema_retry/);
  assert.match(content, /figure_panel_transient_retry/);
  assert.match(content, /computePageDocumentHash\(\)/);
  assert.match(content,
    /prepareFigurePanelProductionInput\(\s*state\.figure,\s*normalizedPanelId,\s*visionAdmission,\s*'figure_panel_interpretation'\s*\)/u);
  assert.match(content, /request\.action === 'analyzeSingleFigurePanelWithLLM'/);
  const workflow = functionBody(
    content, 'analyzeSingleFigurePanelWithLLM', 'askFigurePanelWithLLM'
  );
  assert.doesNotMatch(workflow, /document:\s*\{[^}]*paragraphs/);
  assert.doesNotMatch(workflow, /type: 'LLM_ANALYZE_FIGURES'/);
});

test('Figure evidence blocks contain folded Panels and one editable upstream sentence', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const renderer = functionBody(popup, 'renderFigureWorkspaceSnapshot', 'renderArticleWorkspaceSnapshot');
  const catalog = functionBody(
    popup, 'createFigureEvidenceBlockDetails', 'createCollapsibleFigureResultSection'
  );
  const panelGroup = functionBody(
    popup, 'createFigureEvidencePanelsDetails', 'createFigureEvidenceBlockDetails'
  );
  assert.match(catalog, /SciLLM\.buildEvidenceBlocks\(result\)/);
  assert.match(catalog, /SciLLM\.buildFigureEvidenceDisplayLayout/);
  assert.match(panelGroup, /workspace-evidence-panels/);
  assert.match(catalog, /workspace-evidence-direction is-upstream/);
  assert.match(catalog, /resolveFigureEvidenceUpstreamContext/);
  assert.match(catalog, /'upstreamContext'/);
  assert.doesNotMatch(catalog, /workspace-evidence-direction is-downstream|启下/);
  assert.match(catalog, /details\.open = false/);
  assert.match(catalog, /panelDetails\.dataset\.evidenceGroup/);
  assert.match(catalog, /workspace-evidence-orphans/);
  assert.match(catalog, /'待确认分组'/);
  assert.doesNotMatch(renderer, /'argument-chain'/);
  assert.doesNotMatch(renderer, /'panel-groups'/);
  assert.doesNotMatch(renderer, /'logic-bridges'/);
  assert.match(css, /\.workspace-evidence-panels/);
  assert.match(css, /\.workspace-evidence-orphans/);
  assert.doesNotMatch(css, /\.workspace-evidence-transition|is-downstream/);
  assert.match(css, /\.workspace-figure-panel-card\[data-evidence-group="1"\]/);
});

test('interleaved evidence renderer prefers the persisted per-Figure draft layout and exposes edits', () => {
  const popup = read('popup.js');
  const catalog = functionBody(
    popup, 'createFigureEvidenceBlockDetails', 'createCollapsibleFigureResultSection'
  );
  const editable = functionBody(
    popup, 'appendFigureEvidenceEditableField', 'bindFigureEvidenceEditFlush'
  );
  assert.match(catalog, /view\?\.evidenceBlocks/);
  assert.match(catalog, /'evidence-block'/);
  assert.match(catalog, /item\?\.kind === 'transition'/);
  assert.doesNotMatch(catalog, /appendChild\(createFigureEvidenceTransitionDetails/);
  assert.match(editable, /appendFigureWorkspaceViewField/);
});

test('Figure values use direct draft editing while the legacy result editor is unreachable', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const content = read('content.js');
  const css = read('popup.css');
  assert.match(html, /id="figureResultEditorDialog"/);
  assert.match(html, /id="figureResultEditorBody"/);
  assert.match(html, /id="restoreFigureModelResult"/);
  assert.match(popup, /function openFigureResultEditor/);
  assert.match(popup, /action:\s*'updateFigureAnalysisResult'/);
  assert.match(popup, /action:\s*'restoreFigureAnalysisResult'/);
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceSnapshot', 'renderArticleWorkspaceSnapshot'
  );
  assert.match(popup, /function createFigureWorkspaceInlineEditController/);
  assert.match(popup, /action:\s*'updateFigureWorkspaceDraft'/);
  assert.doesNotMatch(renderer, /编辑结果|继续编辑|openFigureResultEditor/);
  assert.match(content, /function createUserFigureResultEdits/);
  assert.match(content, /function applyUserFigureResultEdits/);
  assert.match(content, /modelStandard/);
  assert.match(content, /modelDeep/);
  assert.match(content, /manualEdits/);
  assert.match(content, /persistArticleWorkspaceArtifacts\(\{[\s\S]*assets:/);
  assert.match(content, /request\.action === 'updateFigureAnalysisResult'/);
  assert.match(content, /request\.action === 'restoreFigureAnalysisResult'/);
  assert.match(css, /\.figure-result-editor-dialog/);
  assert.match(css, /\.workspace-figure-edit-action\.is-edited/);
});

test('quick navigation exclusively expands the requested Figure', () => {
  const popup = read('popup.js');
  const jump = functionBody(popup, 'navigateFigureQuickAnchor', 'renderFigureQuickNav');
  assert.match(jump, /figures\.forEach/);
  assert.match(jump, /figureExpansionState\.set\(figure\.figureId, figure\.figureId === figureId\)/);
  assert.match(jump, /figurePanelExpansionState\.set\(key, false\)/);
  assert.match(jump, /figurePanelExpansionState\.set\(panelWorkspaceKey\(figureId, panelId\), true\)/);
});

test('single Figure re-read propagates forceRefresh from popup through content', () => {
  const popup = read('popup.js');
  const content = read('content.js');
  const workflow = functionBody(content, 'analyzeSingleFigureWithLLM', 'analyzeCrossFigureLogicWithLLM');
  assert.match(popup, /action: 'analyzeSingleFigureWithLLM',[\s\S]*forceRefresh:\s*true/);
  assert.match(workflow, /forceRefresh:\s*forceRefresh === true/);
  assert.match(content, /analyzeSingleFigureWithLLM\(String\(request\.figureId \|\| ''\),\s*\{\s*forceRefresh:/);
});

test('concurrent single-Figure requests return an explicit busy error', () => {
  const script = read('content.js');
  assert.match(script, /figureDepthAnalysisId/);
  assert.match(script, /FIGURE_ANALYSIS_BUSY/);
  assert.match(script, /requestedFigureId/);
});

test('Figure original viewer stays in the webpage and never opens a new tab', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const css = read('content.css');
  assert.match(content, /request\.action === 'showFigureOriginalImage'/);
  assert.match(content, /FIGURE_IMAGE_VIEWER_ID/);
  assert.match(content, /SciLLM\.selectFigureImageSource/);
  assert.match(content, /image\.addEventListener\('error'/);
  assert.match(content, /ArrowLeft:\s*'previous'/);
  assert.match(content, /ArrowRight:\s*'next'/);
  assert.match(content, /ArrowUp:\s*'first'/);
  assert.match(content, /ArrowDown:\s*'last'/);
  assert.match(content, /event\.key === '0' \? 10 : Number\(event\.key\)/);
  assert.match(content, /requestedFigureNumber/);
  assert.match(popup, /action:\s*'navigateFigureOriginalImage',[\s\S]*figureNumber/);
  assert.match(content, /% figures\.length/);
  assert.match(content, /figureImageCacheMode/);
  assert.match(popup, /action:\s*'showFigureOriginalImage'/);
  assert.match(popup, /action:\s*'navigateFigureOriginalImage'/);
  assert.match(popup, /action:\s*'getFigureOriginalImageState'/);
  assert.match(popup, /handleFigureOriginalViewerKeyboard/);
  assert.match(content, /request\.action === 'navigateFigureOriginalImage'/);
  assert.match(content, /viewer\.dataset\.loading = 'true'/);
  assert.match(content, /FIGURE_ORIGINAL_VIEWER_STATE_CHANGED/);
  assert.match(popup, /FIGURE_ORIGINAL_VIEWER_STATE_CHANGED/);
  assert.match(popup, /followFigureOriginalViewerInSidebar/);
  assert.match(content, /navigationMode:\s*requestedFigureNumber > 0 \? 'number' : 'direction'/);
  assert.match(popup, /function shouldPreserveCrossFigureSidebar/);
  assert.match(popup, /navigationMode === 'direction'/);
  assert.match(popup, /!preserveCrossFigureSidebar/);
  assert.match(popup, /collapsePanels:\s*true/);
  assert.doesNotMatch(popup, /window\.open\(/);
  assert.match(css, /#sci-figure-image-viewer\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s);
  assert.match(css, /\.sci-figure-viewer-loading::before/);
  assert.match(css, /@keyframes sci-figure-viewer-spin/);
});

test('Figure viewer toggles a grouped caption-only sidebar and preserves it across navigation', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const html = read('popup.html');
  const contentCss = read('content.css');
  const popupCss = read('popup.css');
  assert.match(
    content,
    /fitControl,\s*captionControl,\s*qualityLabel/
  );
  assert.match(content, /captionVisible \? '隐藏图注' : '查看图注'/);
  assert.match(content, /viewer\.dataset\.captionVisible/);
  assert.match(content, /captionVisible:\s*viewerState\.captionVisible === true/);
  assert.match(content, /captionVisible:\s*state\?\.captionVisible === true/);
  assert.match(contentCss, /\.sci-figure-viewer-caption-toggle\[aria-pressed="true"\]/);
  assert.match(html, /core\/figure-extractor\.js/);
  assert.match(popup, /function renderFigureCaptionSidebarSnapshot/);
  assert.match(popup, /function showFigureCaptionSidebar/);
  assert.match(popup, /function hideFigureCaptionSidebar/);
  assert.match(popup, /splitFigureCaptionByPanelGroups/);
  assert.match(popup, /合并描述的 Panel 保持为同一块/);
  assert.match(popup, /previousCaptionVisible/);
  assert.match(popupCss, /\.workspace-figure-caption-block/);
});

test('Figure original viewer and vision preparation walk every safe source before failing', () => {
  const content = read('content.js');
  const viewer = read('core/figure-viewer.js');
  assert.match(viewer, /function collectFigureImageSources\(/);
  assert.match(content, /SciLLM\.collectFigureImageSources/);
  assert.match(content, /sourceIndex \+= 1/);
  assert.match(content, /SciLLM\.collectFigureImageCandidates/);
  assert.match(content, /FIGURE_RESOLVE_IMAGE_CANDIDATES/);
  assert.match(content, /for \(const source of candidates\)/);
});

test('single Figure work preserves user-controlled Figure and Panel expansion across polling', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const snapshotStart = content.indexOf('function buildFigureWorkspaceSnapshot');
  const snapshotEnd = content.indexOf('function buildArticleWorkspaceSnapshot', snapshotStart);
  const snapshot = content.slice(snapshotStart, snapshotEnd);
  const single = functionBody(content, 'analyzeSingleFigureWithLLM', 'askFigurePanelWithLLM');
  assert.doesNotMatch(single, /otherFigureId !== figureId\) otherState\.expanded = false/);
  assert.match(single, /state\.expanded = true/);
  assert.match(snapshot, /panelFollowups/);
  assert.match(snapshot, /panelFollowupLoading/);
  assert.match(snapshot, /panelFollowupErrors/);
  assert.match(popup, /const figureExpansionState = new Map\(\)/);
  assert.match(popup, /const figurePanelExpansionState = new Map\(\)/);
  assert.match(popup, /figureExpansionState\.has\(figure\.figureId\)/);
  assert.doesNotMatch(popup, /details\.open = figure\.expanded === true \|\| loading/);
});

test('Panel cards provide a bounded follow-up menu using the same dedicated Panel planner', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const css = read('popup.css');
  assert.match(content, /async function askFigurePanelWithLLM\(/);
  assert.match(content, /type: 'LLM_ASK_FIGURE_PANEL'/);
  assert.match(content,
    /prepareFigurePanelProductionInput\(\s*state\.figure,\s*panelKey,\s*visionAdmission,\s*'figure_panel_followup'\s*\)/u);
  assert.match(content, /panelFollowupHistories/);
  assert.match(popup, /function panelFollowupPresetOptions\(/);
  assert.match(popup, /function createPanelFollowupControl\(/);
  assert.match(popup, /function runFigurePanelFollowup\(/);
  assert.match(popup, /action: 'askFigurePanelWithLLM'/);
  assert.match(popup, /customQuestion/);
  assert.match(popup, /workspace-panel-followup-custom/);
  assert.match(css, /\.workspace-panel-followup-chooser/);
  assert.match(popup, /formatFigurePanelInputBasis/);
  assert.match(popup, /dataset\.panelFollowupAnswer/);
  assert.match(popup, /function appendPanelFollowupHistory\(/);
  assert.match(popup,
    /appendPanelFollowupHistory\(root, figure, panelId, displayId, answer\)/);
  assert.match(popup, /workspace-panel-followup-history/);
  assert.match(popup, /历史追问/);
  assert.match(popup, /function revealPanelFollowupAnswer\(/);
  assert.match(popup, /function stabilizePanelFollowupAnswer\(/);
  assert.match(popup, /完成后会自动定位到这里/);
  assert.match(css, /\.workspace-panel-followup-answer\.is-newly-revealed/);
});

test('forced article refresh aligns supplemental references with the freshly extracted Figure inventory', () => {
  const content = read('content.js');
  const snapshotStart = content.indexOf('function buildArticleWorkspaceSnapshot');
  const snapshotEnd = content.indexOf('function articleWorkspaceMetadata', snapshotStart);
  const snapshot = content.slice(snapshotStart, snapshotEnd);
  const figureStart = content.indexOf('function buildFigureWorkspaceSnapshot');
  const figureEnd = content.indexOf('function ensureGlobalAbbreviationMemory', figureStart);
  const figureSnapshot = content.slice(figureStart, figureEnd);

  const inventoryRefresh = snapshot.indexOf('getFigureWorkspaceInventory({ forceRefresh: true })');
  const canonicalRefresh = snapshot.indexOf('getCanonicalArticleSnapshot({ forceRefresh })');
  assert.ok(inventoryRefresh >= 0 && inventoryRefresh < canonicalRefresh);
  assert.match(snapshot, /supplementalParagraphs:\s*canonicalSnapshot\.paragraphs/);
  assert.match(figureSnapshot, /getSupplementalMaterialDiscovery\(supplementalParagraphs\)/);
});

test('current and historical Panel follow-ups render validated jump points without quote-derived locators', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const ask = functionBody(content, 'askFigurePanelWithLLM', 'normalizeArticleChatEvidence');
  const focus = functionBody(content, 'focusArticleWorkspaceSource', 'focusHighlightOccurrence');
  const history = functionBody(
    popup, 'appendPanelFollowupHistory', 'createPanelFollowupControl'
  );
  const renderer = functionBody(
    popup, 'createPanelFollowupControl', 'revealPanelFollowupAnswer'
  );

  assert.match(ask, /sourceRefs:\s*response\.data\.panelFollowup\.sourceRefs/);
  assert.match(history, /appendPanelFollowupSourceRefs/);
  assert.match(renderer, /appendPanelFollowupSourceRefs/);
  assert.match(popup, /function normalizePanelFollowupSourceRefs\(/);
  assert.match(popup, /article-chat-inline-citation/);
  assert.match(popup, /String\(index \+ 1\)/);
  assert.match(popup, /navigateFigureQuickAnchor/);
  assert.match(popup, /kind:\s*'figure-followup-paragraph'/);
  assert.match(popup, /无法定位原文依据，论文页面可能已更新。/);
  assert.match(focus, /focusFigureFollowupParagraphSource\(target\)/);
  const paragraphFocus = functionBody(
    content, 'focusFigureFollowupParagraphSource', 'focusArticleWorkspaceSource'
  );
  assert.match(paragraphFocus, /contextParagraphs/);
  assert.match(paragraphFocus, /paragraphId/);
  assert.match(paragraphFocus, /target\.quote/);
  assert.match(paragraphFocus, /focusArticleSourceQuote/);
});

test('Panel follow-up answers use compact inline references and omit the interpretation boundary', () => {
  const popup = read('popup.js');
  const renderer = functionBody(
    popup, 'createPanelFollowupControl', 'revealPanelFollowupAnswer'
  );
  assert.match(renderer, /appendPanelFollowupSourceRefs\(answerParagraph/);
  assert.doesNotMatch(renderer, /answer\.claimBoundary/);
  assert.doesNotMatch(renderer, /workspace-panel-followup-boundary/);
});

test('high-resolution viewer follows the persisted Figure workspace order', () => {
  const content = read('content.js');
  const inventory = functionBody(
    content, 'getFigureViewerInventory', 'findFigureAnalysisTarget'
  );
  assert.match(inventory, /SciLLM\.orderFigureWorkspaceItems/);
  assert.match(inventory, /figureWorkspaceDraft\?\.supplementalPlacements/);
});

test('Panel follow-up jump handlers require frozen context and successful exact navigation', async () => {
  const popup = read('popup.js');
  const paragraphSource = functionBody(
    popup, 'focusPanelFollowupParagraphSource', 'jumpToPanelFollowupSource'
  );
  const panelSource = functionBody(
    popup, 'jumpToPanelFollowupSource', 'appendPanelFollowupSourceRefs'
  );
  const focusParagraph = new Function(
    `async ${paragraphSource}\nreturn focusPanelFollowupParagraphSource;`
  )();
  const jumpPanel = new Function(
    `${panelSource}\nreturn jumpToPanelFollowupSource;`
  )();
  const figure = { figureId: 'figure-2' };
  const source = { paragraphId: 'p7' };
  const failures = [];
  const targets = [];

  const frozen = { article: 'same' };
  const current = context => context === frozen;
  assert.equal(await focusParagraph(figure, source, frozen, async target => {
    targets.push(target);
    return true;
  }, current, message => failures.push(message)), true);
  assert.deepEqual(targets, [{
    kind: 'figure-followup-paragraph', figureId: 'figure-2', paragraphId: 'p7'
  }]);
  assert.deepEqual(failures, []);

  const pdfSource = {
    kind: 'paragraph', ref: 'pdf-paragraph:0123456789abcdef',
    figureId: 'figure-2', panelId: 'A',
    paragraphId: 'pdf-paragraph:0123456789abcdef', sentenceId: 'sentence-1',
    quote: 'verified sentence', locatorKind: 'pdf-semantic',
    scope: { kind: 'pdf-figure-panel', figureId: 'figure-2', panelId: 'A' },
    binding: { figureId: 'figure-2', binding: {
      documentHash: 'a'.repeat(64), documentGeneration: 2, semanticRevision: 3
    }, semanticContextDigest: 'b'.repeat(64), assetProof: null },
    location: { paragraphId: 'pdf-paragraph:0123456789abcdef',
      sentenceId: 'sentence-1', expectedNormalizedQuote: 'verified sentence',
      locatorStatus: 'resolved', locatorPrecision: 'exact-raw',
      sourceFragments: [{ pageNumber: 2, start: 10, end: 27 }] }
  };
  targets.length = 0;
  assert.equal(await focusParagraph(figure, pdfSource, frozen, async target => {
    targets.push(target);
    return true;
  }, current, message => failures.push(message)), true);
  assert.equal(targets[0].locatorKind, 'pdf-semantic');
  assert.deepEqual(targets[0].binding, pdfSource.binding);
  assert.deepEqual(targets[0].location.sourceFragments, pdfSource.location.sourceFragments);

  assert.equal(await focusParagraph(figure, source, frozen, async () => false,
    current, message => failures.push(message)), false);
  assert.equal(await focusParagraph(figure, source, frozen, async () => {
    throw new Error('message port closed');
  }, current, message => failures.push(message)), false);
  assert.equal(await focusParagraph(figure, source, frozen, async () => true,
    () => false, message => failures.push(message)), false);
  assert.deepEqual(failures, [
    '无法定位原文依据，论文页面可能已更新。',
    '无法定位原文依据，论文页面可能已更新。',
    '无法定位原文依据，论文页面可能已更新。'
  ]);

  const panelCalls = [];
  const panelSourceRef = {
    kind: 'panel', ref: '2A', figureId: 'figure-2', panelId: 'A'
  };
  assert.equal(await jumpPanel(panelSourceRef, frozen,
    view => panelCalls.push(['view', view]),
    async (figureId, panelId) => {
      panelCalls.push(['panel', figureId, panelId]);
      return true;
    }, current, message => failures.push(message)), true);
  assert.deepEqual(panelCalls, [
    ['view', 'figures'], ['panel', 'figure-2', 'A']
  ]);
  assert.equal(await jumpPanel(panelSourceRef, frozen, () => {}, async () => false,
    current, message => failures.push(message)), false);
  assert.equal(await jumpPanel(panelSourceRef, frozen, () => {}, async () => {
    throw new Error('render failed');
  }, current, message => failures.push(message)), false);
  assert.equal(await jumpPanel(panelSourceRef, frozen, () => {}, async () => true,
    () => false, message => failures.push(message)), false);
  assert.equal(failures.slice(-3).every(message =>
    message === '无法定位原文依据，论文页面可能已更新。'), true);

  const history = functionBody(
    popup, 'appendPanelFollowupHistory', 'createPanelFollowupControl'
  );
  const currentRenderer = functionBody(
    popup, 'createPanelFollowupControl', 'revealPanelFollowupAnswer'
  );
  assert.match(history, /appendPanelFollowupSourceRefs/);
  assert.match(currentRenderer, /appendPanelFollowupSourceRefs/);
  assert.match(popup, /void focusPanelFollowupParagraphSource\(/);
});

test('Popup preserves verified native PDF Panel locators even without legacy paragraph ids', () => {
  const popup = read('popup.js');
  const source = functionBody(
    popup, 'normalizePanelFollowupSourceRefs', 'focusPanelFollowupParagraphSource'
  ).replace(/\s*async\s*$/u, '');
  const normalize = new Function(
    'SciLLM', `${source}\nreturn normalizePanelFollowupSourceRefs;`
  )({ figurePanelDisplayId: () => '2A' });
  const binding = { figureId: 'figure-2', binding: {
    documentHash: 'a'.repeat(64), documentGeneration: 2, semanticRevision: 3
  }, semanticContextDigest: 'b'.repeat(64), assetProof: null };
  const refs = normalize({ figureId: 'figure-2', figureLabel: 'Figure 2',
    contextParagraphIds: [] }, 'A', [{
    kind: 'paragraph', ref: 'pdf-paragraph:0123456789abcdef',
    figureId: 'figure-2', panelId: 'A',
    paragraphId: 'pdf-paragraph:0123456789abcdef', sentenceId: 'sentence-1',
    quote: 'verified sentence', locatorKind: 'pdf-semantic',
    scope: { kind: 'pdf-figure-panel', figureId: 'figure-2', panelId: 'A' },
    binding,
    location: { paragraphId: 'pdf-paragraph:0123456789abcdef',
      sentenceId: 'sentence-1', expectedNormalizedQuote: 'verified sentence',
      locatorStatus: 'resolved', locatorPrecision: 'exact-raw',
      sourceFragments: [{ pageNumber: 2, start: 10, end: 27 }] }
  }]);
  assert.equal(refs.length, 2);
  assert.equal(refs[1].locatorKind, 'pdf-semantic');
  assert.deepEqual(refs[1].binding, binding);
  assert.deepEqual(refs[1].location.sourceFragments,
    [{ pageNumber: 2, start: 10, end: 27 }]);
});

test('Panel follow-up source buttons retain the immutable render context', async () => {
  const popup = read('popup.js');
  const appendSource = functionBody(
    popup, 'appendPanelFollowupSourceRefs', 'appendPanelFollowupHistory'
  );
  const jumpSource = functionBody(
    popup, 'jumpToPanelFollowupSource', 'appendPanelFollowupSourceRefs'
  );
  const jump = new Function(`${jumpSource}\nreturn jumpToPanelFollowupSource;`)();
  let activeArticle = 'article-a';
  let passedContext = null;
  let pending = null;
  const failures = [];
  const createElement = (tag, className, text = '') => ({
    tag, className, text, children: [], listeners: Object.create(null),
    addEventListener(type, listener) { this.listeners[type] = listener; },
    appendChild(child) { this.children.push(child); }
  });
  const append = new Function(
    'normalizePanelFollowupSourceRefs', 'createWorkspaceElement',
    'capturePanelContext', 'jumpToPanelFollowupSource',
    'focusPanelFollowupParagraphSource',
    `${appendSource}\nreturn appendPanelFollowupSourceRefs;`
  )(
    () => [{
      kind: 'panel', ref: '2A', figureId: 'figure-2', panelId: 'A',
      paragraphId: '', quote: ''
    }],
    createElement,
    () => Object.freeze({ article: activeArticle }),
    (source, context) => {
      passedContext = context;
      pending = jump(
        source, context, () => {}, async () => true,
        frozen => frozen.article === activeArticle,
        message => failures.push(message)
      );
      return pending;
    },
    async () => false
  );
  const parent = createElement('div', 'parent');
  append(parent, { figureId: 'figure-2' }, 'A', { sourceRefs: [] });
  const button = parent.children[0].children[0];
  activeArticle = 'article-b';
  button.listeners.click();

  assert.equal(await pending, false);
  assert.equal(Object.isFrozen(passedContext), true);
  assert.equal(passedContext.article, 'article-a');
  assert.deepEqual(failures, ['无法定位原文依据，论文页面可能已更新。']);
});

test('malicious restored Panel follow-up sources are projected before snapshot and persistence', () => {
  const content = read('content.js');
  const start = content.indexOf('function isSafePanelFollowupDataRecord');
  const end = content.indexOf('async function askFigurePanelWithLLM', start);
  assert.ok(start >= 0 && end > start);
  const source = content.slice(start, end);
  const normalize = new Function(
    'SciLLM', `${source}\nreturn normalizeFigurePanelFollowupCollections;`
  )({
    figurePanelDisplayId: (label, isSupplemental, panel) =>
      `${isSupplemental || label.includes('S') ? 'S2' : '2'}${panel}`
  });

  const sourceWithExtras = Object.create(null);
  Object.assign(sourceWithExtras, {
    kind: 'paragraph', ref: '', paragraphId: 'p7',
    quote: '<b>private   paragraph</b>', selector: '#paper',
    url: 'https://evil.example', apiKey: 'sk-secret'
  });
  const current = Object.create(null);
  Object.assign(current, {
    figureId: 'figure-2', panel: 'A', topics: ['grouping', 'unknown'],
    basis: 'caption_context', answer: 'safe answer', claimBoundary: 'safe boundary',
    sourceRefs: [
      sourceWithExtras,
      { kind: 'paragraph', ref: 'p9', paragraphId: 'p9', quote: 'unknown' },
      { kind: 'panel', ref: 'https://evil.example', paragraphId: '', quote: '' }
    ],
    inputBasis: { inputMode: 'caption_context', pixelsSupplied: false,
      selector: '#credential', token: 'secret-token' },
    credential: 'secret-credential'
  });
  Object.defineProperty(current, 'apiKey', {
    enumerable: true, get() { throw new Error('getter must not run'); }
  });
  const inherited = Object.create({ answer: 'prototype-secret', apiKey: 'sk-proto' });
  inherited.panel = 'B';
  const assistant = {
    historyId: 'h2', role: 'assistant', content: 'old answer',
    sourceRefs: [sourceWithExtras], url: 'javascript:alert(1)', password: 'secret'
  };
  const historyArray = [
    { historyId: 'h1', role: 'user', content: 'question', paragraph: 'body secret' },
    assistant,
    { historyId: 'h3', role: 'assistant', content: 'legacy without refs' }
  ];
  Object.defineProperty(historyArray, '99', {
    enumerable: true, get() { throw new Error('array getter must not run'); }
  });
  const longHistory = Array.from({ length: 205 }, (_, index) => ({
    historyId: `old-${index}`, role: index % 2 ? 'assistant' : 'user',
    content: `turn-${index}`
  }));
  longHistory.push(historyArray[0], historyArray[1], historyArray[2]);
  const normalized = normalize({
    figureId: 'figure-2', figureLabel: 'Figure 2', panelHints: ['A', 'B'],
    contextParagraphs: [
      { paragraphId: 'p7', text: 'private paragraph body' },
      { paragraphId: 'javascript:alert', text: 'uri body' }
    ]
  }, { a: current, B: inherited }, { a: longHistory });

  assert.deepEqual(Object.keys(normalized.panelFollowups), ['A']);
  assert.deepEqual(normalized.panelFollowups.A.sourceRefs.map(item => item.ref), ['2A', 'p7']);
  assert.equal(normalized.panelFollowups.A.sourceRefs[1].quote, 'private paragraph');
  assert.equal(normalized.panelFollowupHistories.A.length, 200);
  assert.equal(normalized.panelFollowupHistories.A[0].historyId, 'old-8');
  assert.equal(normalized.panelFollowupHistories.A.at(-1).historyId, 'h3');
  assert.deepEqual(
    normalized.panelFollowupHistories.A.filter(item => item.role === 'assistant')
      .slice(-2).map(item => item.sourceRefs.map(ref => ref.ref)),
    [['2A', 'p7'], ['2A']]
  );
  const serialized = JSON.stringify(normalized);
  assert.doesNotMatch(serialized,
    /evil|selector|apiKey|credential|password|secret-token|private paragraph body|javascript:/i);
  assert.match(serialized, /safe answer/);

  for (const [name, nextName] of [
    ['ensureFigureWalkthroughState', 'updateFigureAnalysisResultEdits'],
    ['buildFigureWorkspaceSnapshot', 'notifyArticleAbbreviationsChanged'],
    ['normalizeRestoredFigureWorkspace', 'applyArticleArchiveSnapshot']
  ]) {
    assert.match(functionBody(content, name, nextName),
      /normalizeFigurePanelFollowupCollections/);
  }
  assert.match(content,
    /\['figures\/inventory\.json',\s*snapshot\.figures\]/);
  const ask = functionBody(content, 'askFigurePanelWithLLM', 'normalizeArticleChatEvidence');
  assert.match(ask, /panelFollowupArrayValues\(history,\s*198,\s*true\)/);
  assert.match(ask, /persistImportedSupplementalFigureState\(/);
  assert.match(ask, /panelFollowups['"\s,]+panelFollowupHistories['"\s,]+panelFollowupErrors/s);
  assert.match(ask, /SUPPLEMENTAL_FOLLOWUP_NOT_DURABLE/);
});

test('native PDF Panel restore retains historical evidence but only current bindings enter new requests', () => {
  const content = read('content.js');
  const start = content.indexOf('function isSafePanelFollowupDataRecord');
  const end = content.indexOf('async function askFigurePanelWithLLM', start);
  assert.ok(start >= 0 && end > start);
  const source = content.slice(start, end);
  let current = true;
  const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  const api = new Function(
    'SciLLM', 'activeNativePdfStructure', 'getPdfFigureProductionEnvelope',
    'samePdfFigureProductionBinding', 'samePdfFigureProductionAssetProof',
    `${source}\nreturn { normalize: normalizeFigurePanelFollowupCollections,
      requestMemory: currentFigurePanelRequestMemory };`
  )(
    { figurePanelDisplayId: () => '1D' },
    () => ({ documentHash: 'a'.repeat(64) }),
    (_figureId, binding) => current ? {
      binding: binding.binding,
      semanticContextDigest: binding.semanticContextDigest,
      assetProof: binding.assetProof
    } : null,
    same,
    same
  );
  const binding = { figureId: 'figure-1', binding: {
    documentHash: 'a'.repeat(64), documentGeneration: 2, semanticRevision: 3
  }, semanticContextDigest: 'b'.repeat(64), assetProof: null };
  const location = {
    paragraphId: 'pdf-paragraph:0123456789abcdef', sentenceId: 'sentence-1',
    expectedNormalizedQuote: 'verified sentence', locatorStatus: 'resolved',
    locatorPrecision: 'exact-raw',
    sourceFragments: [{ pageNumber: 2, start: 10, end: 27 }]
  };
  const sourceRef = {
    kind: 'paragraph', ref: location.paragraphId, paragraphId: location.paragraphId,
    figureId: 'figure-1', panelId: 'D', sentenceId: 'sentence-1',
    quote: 'verified sentence', locatorKind: 'pdf-semantic',
    scope: { kind: 'pdf-figure-panel', figureId: 'figure-1', panelId: 'D' },
    binding, location
  };
  const figure = { figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: [] };
  const followup = { figureId: 'figure-1', panel: 'D', basis: 'caption_context',
    answer: 'bound answer', pdfEvidenceBinding: binding, sourceRefs: [sourceRef] };
  const history = [
    { historyId: 'question', role: 'user', content: 'question', pdfEvidenceBinding: binding },
    { historyId: 'answer', role: 'assistant', content: 'bound answer',
      pdfEvidenceBinding: binding, sourceRefs: [sourceRef] }
  ];

  const retained = api.normalize(figure, { D: followup }, { D: history });
  assert.deepEqual(retained.panelFollowups.D.pdfEvidenceBinding, binding);
  assert.equal(retained.panelFollowups.D.sourceRefs[1].locatorKind, 'pdf-semantic');
  assert.equal(retained.panelFollowupHistories.D.length, 2);
  assert.deepEqual(retained.panelFollowupHistories.D[1].pdfEvidenceBinding, binding);
  const panel = { panel: 'D', directObservation: 'stored observation', pdfEvidenceBinding: binding };
  const productionInput = { pdfFigureContext: { figure: { figureId: 'figure-1' },
    ...binding } };
  const admitted = api.requestMemory(figure, 'D', panel, history, productionInput);
  assert.equal(admitted.history.length, 2);
  assert.equal(admitted.panel.directObservation, 'stored observation');

  current = false;
  const restored = api.normalize(figure, { D: followup }, { D: history });
  assert.equal(restored.panelFollowups.D.answer, 'bound answer',
    'an old answer may remain displayable');
  assert.equal(JSON.stringify(restored), JSON.stringify(retained),
    'empty process-local envelope records must not destroy persisted evidence or displayed history');
  assert.deepEqual(restored.panelFollowups.D.pdfEvidenceBinding, binding,
    'retain the original provider proof; do not stamp it with a new owner');
  const rejected = api.requestMemory(figure, 'D', panel,
    restored.panelFollowupHistories.D, productionInput);
  assert.deepEqual(rejected.panel, { panel: 'D' });
  assert.deepEqual(rejected.history, [],
    'displayable historical evidence must not re-enter the current model request');
  const legacy = api.normalize(figure, {}, { D: [{ role: 'user', content: 'old question' }] });
  assert.equal(legacy.panelFollowupHistories.D[0].content, 'old question');
  assert.equal('pdfEvidenceBinding' in legacy.panelFollowupHistories.D[0], false);
  assert.deepEqual(api.requestMemory(figure, 'D', { panel: 'D' },
    legacy.panelFollowupHistories.D, productionInput).history, []);
});

test('native PDF Panel citation focus uses the semantic locator and never DOM fallback', async () => {
  const content = read('content.js');
  const source = functionBody(
    content, 'focusFigureFollowupParagraphSource', 'focusArticleWorkspaceSource'
  ).replace(/\s*async\s*$/u, '');
  const calls = [];
  const focus = new Function(
    'panelFollowupSafePanelId', 'normalizePanelFollowupPdfBinding',
    'normalizePanelFollowupPdfLocation', 'focusPdfSemanticCitationTarget',
    'refreshActivePdfSemanticNavigationContext', 'resolvePdfSemanticQuoteFocus',
    'createPdfSemanticHighlightLocator', 'resolvePdfSemanticHighlightLocator',
    'findFigureAnalysisTarget', 'resolveWorkspaceParagraph',
    'focusArticleSourceQuote', 'focusArticleSource', 'extractCurrentArticleStructure',
    `async ${source}\nreturn focusFigureFollowupParagraphSource;`
  )(
    value => String(value || '').toUpperCase(),
    value => value,
    value => value,
    async value => {
      calls.push(value);
      return { focused: true, paragraphId: value.paragraphId,
        pageNumber: value.sourceFragments[0].pageNumber };
    },
    () => ({ documentHash: 'a'.repeat(64) }),
    input => ({ candidateCount: 1, target: { paragraphId: input.paragraphId },
      selection: { normalizedStart: 10, normalizedEnd: 27,
        expectedNormalizedQuote: input.expectedNormalizedQuote } }),
    (target, selection) => ({ ...target, ...selection }),
    () => ({ status: 'resolved', ranges: [{ pageNumber: 2, start: 10, end: 27 }] }),
    () => { throw new Error('DOM Figure fallback must not run'); },
    () => { throw new Error('DOM paragraph fallback must not run'); },
    () => { throw new Error('DOM quote fallback must not run'); },
    () => { throw new Error('DOM source fallback must not run'); },
    () => { throw new Error('DOM refresh fallback must not run'); }
  );
  const binding = { figureId: 'figure-1', binding: {
    documentHash: 'a'.repeat(64), documentGeneration: 2, semanticRevision: 3
  }, semanticContextDigest: 'b'.repeat(64), assetProof: null };
  const location = {
    paragraphId: 'pdf-paragraph:0123456789abcdef', sentenceId: 'sentence-1',
    expectedNormalizedQuote: 'verified sentence', locatorStatus: 'resolved',
    locatorPrecision: 'exact-raw',
    sourceFragments: [{ pageNumber: 2, start: 10, end: 27 }]
  };
  const result = await focus({
    kind: 'figure-followup-paragraph', figureId: 'figure-1', panelId: 'D',
    paragraphId: location.paragraphId, sentenceId: 'sentence-1',
    quote: 'verified sentence', locatorKind: 'pdf-semantic', binding, location,
    scope: { kind: 'pdf-figure-panel', figureId: 'figure-1', panelId: 'D' }
  });
  assert.equal(result.focused, true);
  assert.deepEqual(calls, [{
    paragraphId: location.paragraphId,
    semanticParagraphId: location.paragraphId,
    sentenceId: 'sentence-1',
    quote: 'verified sentence',
    expectedNormalizedQuote: 'verified sentence',
    sourceFragments: location.sourceFragments,
    documentHash: binding.binding.documentHash,
    documentGeneration: binding.binding.documentGeneration,
    revision: binding.binding.semanticRevision,
    locatorKind: 'pdf-semantic', normalizedStart: 10, normalizedEnd: 27
  }]);
});

test('single Panel images use one best source, reliable canvas crop, and a 1200/960/768 ladder', () => {
  const content = read('content.js');
  const workflow = functionBody(
    content, 'prepareFigurePanelImageVariants', 'closeFigureImageViewer'
  );
  assert.match(content, /function normalizePanelCropGeometry/);
  assert.match(content, /function encodeFigureImageVariant/);
  assert.match(workflow, /findDedicatedPanelImageElement/);
  assert.match(workflow, /\[1200, 960, 768\]/);
  assert.match(workflow, /inputMode = dedicated \|\| reliableCrop \? 'panel_crop' : 'figure_image'/);
  assert.match(content, /context\.drawImage\(/);
});

test('deep workflow does not clear standard Figure results', () => {
  const script = read('content.js');
  const start = script.indexOf('async function analyzeSingleFigureDeep');
  const end = script.indexOf('async function analyzeFiguresWithLLM', start);
  const workflow = script.slice(start, end);
  assert.doesNotMatch(workflow, /clearFigureWalkthroughs/);
  assert.match(workflow, /standard/);
  assert.match(workflow, /deep/);
});

test('one content action analyzes all Figures without invoking regex fallback', () => {
  const script = read('content.js');
  const analyzer = functionBody(script, 'analyzeFiguresWithLLM', 'maybeAutoAnalyzeWithLLM');
  assert.match(analyzer, /extractCurrentArticleFigures/);
  assert.match(analyzer, /prepareFigureImages/);
  assert.match(analyzer, /LLM_ANALYZE_FIGURES/);
  assert.doesNotMatch(analyzer, /renderFigureWalkthroughs\(/);
  assert.doesNotMatch(analyzer, /applyStoredRegexFallback/);
  assert.match(script, /request\.action === 'analyzeFiguresWithLLM'/);
});

test('content script publishes structured per-Figure progress for the popup', () => {
  const script = read('content.js');
  assert.match(script, /figureAnalysisStatus/);
  assert.match(script, /const figureProgressById = new Map\(\)/);
  assert.match(script, /function updateFigureProgress/);
  assert.match(script, /function getFigureProgressSnapshot/);
  assert.match(script, /phase: 'preparing'/);
  assert.match(script, /startedAt/);
  assert.match(script, /elapsedSeconds/);
  assert.match(script, /recognizedPanelCount/);
  assert.match(script, /batchRecognizedPanelCount/);
  assert.match(script, /ignoredUnexpectedPanelCount/);
  assert.match(script, /unexpectedPanels/);
  assert.match(script, /function updateFigureAnalysisStatus/);
  assert.match(script, /currentFigure/);
  assert.match(script, /totalFigures/);
  assert.match(script, /completedFigures/);
  assert.match(script, /failedFigures/);
  assert.match(script, /request\.action === 'getFigureAnalysisStatus'/);
});

test('Figure progress UI uses the content snapshot and never invents a current Panel', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const renderer = functionBody(popup, 'renderFigureWorkspaceSnapshot', 'renderArticleWorkspaceSnapshot');
  assert.match(popup, /function formatFigureProgress/);
  assert.match(popup, /function hasRunningFigureProgress/);
  assert.match(popup, /expectedPanels/);
  assert.match(popup, /recognizedPanelCount/);
  assert.match(popup, /batchRecognizedPanelCount/);
  assert.match(popup, /ignoredUnexpectedPanelCount/);
  assert.match(popup, /function figureProgressUiSignature/);
  assert.match(popup, /function updateFigureElapsedLabels/);
  assert.match(popup, /renderSignature !== figureProgressRenderSignature/);
  assert.match(popup, /startedAt/);
  assert.match(popup, /caption_text_only/);
  assert.match(popup, /figure_model_processing/);
  assert.match(popup, /figure_response_received/);
  assert.match(popup, /figure_validating/);
  assert.match(popup, /figure_assembling/);
  assert.match(popup, /figure_fallback/);
  assert.match(popup, /token_limit_retry/);
  assert.match(popup, /output_compact_retry/);
  assert.match(renderer, /figureProgress/);
  assert.match(renderer, /renderFigureProgress\(details, progress, result, figure, view\)/);
  assert.match(popup, /workspace-figure-progress/);
  assert.match(popup, /compactFigureResultConclusion/);
  assert.match(popup, /workspace-figure-completion-check/);
  assert.match(popup, /aria-label', 'Figure 解读已完成'/);
  assert.match(css, /\.workspace-figure-progress\s*\{/);
  assert.match(css, /\.workspace-figure-progress-conclusion\s*\{/);
  assert.doesNotMatch(renderer, /当前\s*Panel|current\s*Panel/i);
});

test('Figure progress polling owns a single timer only while a snapshot reports work running', () => {
  const popup = read('popup.js');
  const polling = functionBody(popup, 'startFigureProgressPolling', 'restoreFigureAnalysisProgress');
  assert.match(polling, /if \(figureProgressTimer !== null\) return/);
  assert.match(polling, /hasRunningFigureProgress/);
  assert.match(polling, /setInterval/);
  assert.match(popup, /function stopFigureProgressPolling/);
  assert.match(popup, /beforeunload/);
  assert.match(popup, /unload/);
});

test('single Figure analysis starts the shared snapshot poller and does not own persistent loading state', () => {
  const popup = read('popup.js');
  const workflow = functionBody(popup, 'runSingleFigureAnalysis', 'runCrossFigureLogic');
  assert.match(workflow, /startFigureProgressPolling\(tab\.id/);
  assert.match(workflow, /refreshFigureAnalysisProgress\(tab\.id, false, taskToken\)/);
  assert.doesNotMatch(workflow, /singleFigureRunningIds|\.add\(|\.delete\(/);
});

test('Figure progress snapshot is restored after reopening the side panel', () => {
  const popup = read('popup.js');
  const restore = functionBody(popup, 'restoreFigureAnalysisProgress', 'updateLlmPreferencesCore');
  assert.match(restore, /refreshFigureAnalysisProgress\(tab\.id, false\)/);
  assert.match(restore, /hasRunningFigureProgress\(status\)/);
  assert.match(restore, /startFigureProgressPolling\(tab\.id\)/);
});

test('content script preserves successful Figures and continues after a recoverable single-Figure failure', () => {
  const script = read('content.js');
  const analyzer = functionBody(script, 'analyzeFiguresWithLLM', 'maybeAutoAnalyzeWithLLM');
  assert.match(analyzer, /failures\.push/);
  assert.match(analyzer, /isFatalFigureBatchError/);
  assert.match(analyzer, /failedCount/);
  assert.match(analyzer, /partial/);
  assert.match(analyzer, /continue/);
  assert.doesNotMatch(analyzer, /renderFigureWalkthroughs\(/);
});

test('a fatal batch error terminalizes every premarked Figure that did not start', () => {
  const content = read('content.js');
  const sanitizer = functionBody(content, 'sanitizeFigureProgressSnapshot', 'updateFigureProgress');
  const terminalizer = functionBody(content, 'cancelPendingFigureProgress', 'beginSingleFigureProgress');
  const analyzer = functionBody(content, 'analyzeFiguresWithLLM', 'maybeAutoAnalyzeWithLLM');

  assert.match(sanitizer, /cancelled/);
  assert.match(terminalizer, /progress\?\.completed \|\| progress\?\.failed \|\| progress\?\.cancelled/);
  assert.match(terminalizer, /phase:\s*'cancelled'/);
  assert.match(terminalizer, /running:\s*false/);
  assert.match(terminalizer, /cancelled:\s*true/);
  assert.match(analyzer, /cancelPendingFigureProgress\(figures/);
  assert.match(analyzer, /SciLLM\.isFatalFigureBatchError\(error\)/);
});

test('successful Figure batches explicitly terminalize every completed Figure', () => {
  const content = read('content.js');
  const analyzer = functionBody(content, 'analyzeFiguresWithLLM', 'maybeAutoAnalyzeWithLLM');
  assert.match(analyzer, /results\.push\(operationResult\)[\s\S]*?updateFigureProgress\(figure\.figureId/);
  assert.match(analyzer, /phase:\s*'figure'/);
  assert.match(analyzer, /running:\s*false/);
  assert.match(analyzer, /completed:\s*true/);
  assert.match(analyzer, /results\.forEach\(result =>/);
  assert.match(analyzer, /await waitForLocalOperation\(operation\)[\s\S]*?if \(!response\?\.success\)/);
});

test('Figure cancellation is locally terminal and backend confirmation is bounded', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const contentControl = functionBody(content, 'controlLlmOperation', 'throwStaleFigureOperation');
  const popupControl = functionBody(popup, 'controlActiveAnalysis', 'updateHighlightTaskControls');

  assert.match(content, /function sendLlmOperationControlWithDeadline/);
  assert.match(contentControl, /cancelPendingFigureProgress\(figureWorkspaceInventory/);
  assert.match(contentControl, /running:\s*!operation\.cancelled/);
  assert.match(contentControl, /backendAcknowledged/);
  assert.match(popupControl, /if \(command === 'cancel'\) stopFigureProgressPolling\(\)/);
  assert.match(popupControl, /new Promise\(resolve =>/);
  assert.match(popupControl, /CONTROL_CONFIRMATION_TIMEOUT/);
  assert.match(popupControl, /running:\s*command !== 'cancel'/);
  assert.match(popupControl, /界面已立即释放/);
});

test('a terminal global Figure snapshot overrides stale child running flags', () => {
  const popup = read('popup.js');
  const helper = functionBody(
    popup, 'hasRunningFigureProgress', 'resumeFigureProgressFromWorkspaceSnapshot'
  );
  assert.match(helper, /status\?\.running === false/);
  assert.match(helper, /\['idle', 'completed', 'partial', 'failed', 'cancelled'\]/);
  const apply = functionBody(
    popup, 'applyFigureAnalysisProgress', 'refreshFigureAnalysisProgress'
  );
  assert.match(apply, /const running = hasRunningFigureProgress\(status\)/);
  assert.match(apply, /running:\s*running \? item\.running === true : false/);
});

test('Figure workspace exposes pause, cancel, and a compact Figure Panel quick navigator', () => {
  const popup = read('popup.js');
  const html = read('popup.html');
  const css = read('popup.css');
  const content = read('content.js');
  assert.match(html, /id="pauseFigureAnalysis"/);
  assert.match(html, /id="cancelFigureAnalysis"/);
  assert.match(html, /id="figureQuickNav"/);
  assert.match(popup, /function controlActiveAnalysis\(/);
  assert.match(popup, /function renderFigureQuickNav\(/);
  assert.match(popup, /function navigateFigureQuickAnchor\(/);
  assert.match(content, /request\.action === 'controlLlmOperation'/);
  assert.match(css, /\.figure-quick-nav\s*\{/);
});

test('Figure workspace keyboard navigation maps arrows and digits without Panel letters', () => {
  const popup = read('popup.js');
  const html = read('popup.html');
  const handler = functionBody(
    popup, 'handleFigureKeyboardShortcut', 'setupFigureKeyboardNavigation'
  );
  const setup = functionBody(
    popup, 'setupFigureKeyboardNavigation', 'renderFigureQuickNav'
  );
  assert.match(html, /←\/→ 切换 Figure，↑\/↓ 切换 Panel/);
  assert.match(popup, /function figureKeyboardNumber/);
  assert.match(popup, /function currentFigureKeyboardTarget/);
  assert.match(handler, /\^\[1-9\]\$/);
  assert.doesNotMatch(handler, /\^\[a-z\]\$/i);
  assert.doesNotMatch(handler, /event\.key\.toUpperCase\(\)/);
  assert.match(handler, /event\.key === 'ArrowLeft'/);
  assert.match(handler, /event\.key === 'ArrowUp'/);
  assert.match(handler, /panelIds\.includes\('A'\)/);
  assert.match(handler, /adjacentFigureKeyboardTarget/);
  assert.match(handler, /isEditableKeyboardTarget\(event\.target\)/);
  assert.match(setup, /#sidePanelApp/);
  assert.match(setup, /handleFigureOriginalViewerKeyboard,\s*true/);
  assert.match(setup, /document\.addEventListener\('keydown', handleFigureKeyboardShortcut\)/);
  assert.match(popup, /focusWorkspaceSource\(\{\s*kind:\s*'figure'/);
  assert.match(popup, /function collapseAllFigurePanels/);
  assert.match(popup, /collapseFigurePanels/);
});

test('global shortcuts route every module and toolbar action through persisted settings', () => {
  const popup = read('popup.js');
  const html = read('popup.html');
  assert.match(html, /core\/keyboard-shortcuts\.js/);
  assert.match(popup, /function handleGlobalKeyboardShortcut/);
  assert.match(popup, /normalizeKeyboardShortcuts/);
  assert.match(popup, /KEYBOARD_SHORTCUT_DEFINITIONS\.find/);
  for (const actionId of [
    'figures', 'navigation', 'analysis', 'highlights', 'chat',
    'zotero', 'ppt', 'scanLocal', 'saveLocal', 'deleteLocal',
    'exportJson', 'importJson', 'settings'
  ]) {
    assert.match(popup, new RegExp(`${actionId}:`));
  }
  assert.match(popup, /actionId === 'collapseFigurePanels'/);
  assert.match(popup, /isEditableKeyboardTarget\(event\.target\)/);
  assert.match(popup, /figureOriginalViewerState\.open/);
});

test('side-panel shortcuts work from the active article page only while the panel is open', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const background = read('background.js');
  assert.match(content, /function setSidePanelShortcutScope/);
  assert.match(content, /function handleSidePanelGlobalShortcut/);
  assert.match(content, /sidePanelShortcutScope\.enabled/);
  assert.match(content, /isPageShortcutEditableTarget\(event\.target\)/);
  assert.match(content, /getFigureImageViewerState\(\)\.open/);
  assert.match(content, /type:\s*'SIDE_PANEL_GLOBAL_SHORTCUT'/);
  assert.match(content, /request\.action === 'setSidePanelShortcutScope'/);
  assert.match(popup, /function publishSidePanelShortcutScope/);
  assert.match(popup, /function runGlobalKeyboardShortcutKey/);
  assert.match(popup, /message\?\.type === 'SIDE_PANEL_GLOBAL_SHORTCUT'/);
  assert.match(
    popup,
    /Number\(sender\?\.tab\?\.id\) === Number\(activePanelTabContext\.tabId\)/
  );
  assert.match(popup, /activePanelTabContext\.activated/);
  assert.match(popup, /window\.addEventListener\('pagehide'[\s\S]{0,160}false/);
  assert.match(background, /chrome\.sidePanel\?\.onClosed\?\.addListener/);
  assert.match(background, /disableSidePanelShortcutScope/);
});

test('double Figure-module shortcut opens Figure 1 original and follows its collapsed sidebar card', () => {
  const popup = read('popup.js');
  assert.match(popup, /function openFigureOneOriginalFromShortcut/);
  assert.match(popup, /figureKeyboardNumber\(item\) === 1/);
  assert.match(popup, /followFigureOriginalViewerInSidebar\(figure\.figureId\)/);
  assert.match(popup, /showFigureOriginalImage\(figure\.figureId\)/);
  assert.match(popup, /pressedAt - lastFigureModuleShortcutPress\.pressedAt <= 450/);
  assert.match(popup, /definition\.actionId === 'figures'/);
});

test('Figure header actions keep one batch-analysis entry without implicit cross-Figure synthesis', () => {
  const popup = read('popup.js');
  const html = read('popup.html');
  const css = read('popup.css');
  assert.match(popup, /'跳转'/);
  assert.match(popup, /'原图'/);
  assert.match(popup, /loading \? singleFigureButtonProgressLabel\(progress \|\| \{\}\) : '解图'/);
  assert.match(
    css,
    /\.workspace-figure-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s
  );
  assert.match(css, /\.workspace-figure-analyze-action\s*\{\s*grid-column:\s*auto/);
  const analyzeAction = html.match(/<button\b[^>]*id="analyzeFiguresFromFigures"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(analyzeAction, /aria-label="全部解图"/);
  assert.match(analyzeAction, />解图<\/button>/);
  assert.doesNotMatch(html, /id="analyzeCrossFigureLogic"/);
  const supplementAction = html.match(/<button\b[^>]*id="openSupplementalFigureImport"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(supplementAction, /aria-label="添加补图"/);
  assert.match(supplementAction, /ph-image/);
  assert.doesNotMatch(html, />手动梳理<\/button>|createBlankResearchLogicMap/);
  assert.doesNotMatch(
    functionBody(popup, 'runFigureAnalysis', 'showFigureOriginalImage'),
    /runCrossFigureLogic\s*\(/
  );
  assert.match(html, /id="figuresModuleTools"/);
  assert.match(html, /data-workspace-tools="figures"/);
  assert.equal((html.match(/id="analyzeFiguresFromFigures"/g) || []).length, 1);
});

test('Figure quick navigator opens and closes promptly with Panels in one ordered column', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const renderer = functionBody(popup, 'renderFigureQuickNav', 'syncFigureQuickNavFromScroll');

  assert.match(renderer, /\.slice\(\)\.sort\(/);
  assert.doesNotMatch(renderer, /setTimeout\(\(\) => \{[\s\S]*?\}, 60\)/);
  assert.match(renderer, /item\.classList\.toggle\('show-panels', panelIds\.length > 0\)/);
  assert.match(renderer, /item\.addEventListener\('mouseenter', activateItem\)/);
  assert.match(renderer, /setTimeout\(closePanels, 45\)/);
  assert.match(renderer, /figure-quick-nav-item\.show-panels/);
  assert.match(renderer, /if \(other !== item\) other\.classList\.remove\('show-panels'\)/);
  assert.match(css, /\.figure-quick-nav-panel-popover\s*\{[^}]*display:\s*grid;/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(css, /\.figure-quick-nav-panel-popover\s*\{[^}]*flex-wrap:/);
  assert.match(css, /\.figure-quick-nav-panel-button\s*\{[^}]*width:\s*100%/);
  const scrollSync = functionBody(
    popup, 'syncFigureQuickNavFromScroll', 'renderFigureWorkspaceSnapshot'
  );
  assert.doesNotMatch(scrollSync, /renderFigureQuickNav\(/);
  assert.match(scrollSync, /marker\.setAttribute\('aria-current'/);
});

test('batch and single Figure workflows share one operation gate and stamp only current results', () => {
  const content = read('content.js');
  const single = functionBody(content, 'analyzeSingleFigureWithLLM', 'analyzeCrossFigureLogicWithLLM');
  const batch = functionBody(content, 'analyzeFiguresWithLLM', 'maybeAutoAnalyzeWithLLM');
  const progress = functionBody(content, 'applyFigureProgressEvent', 'updateFigureAnalysisStatus');

  assert.match(content, /const figureOperationState\s*=\s*\{/);
  assert.match(content, /function beginFigureOperation/);
  assert.match(content, /function isCurrentFigureOperation/);
  assert.match(content, /function finishFigureOperation/);
  assert.match(content, /FIGURE_ANALYSIS_BUSY/);
  assert.match(content, /正在精读 \$\{activeLabel\}，请完成后再分析/);
  assert.doesNotMatch(content, /姝ｅ湪绮捐/);
  assert.match(single, /beginFigureOperation\('single'/);
  assert.match(batch, /beginFigureOperation\('batch'/);
  assert.match(single, /operationId:\s*operation\.operationId/);
  assert.match(batch, /operationId:\s*operation\.operationId/);
  assert.match(single, /isCurrentFigureOperation\(operation\)/);
  assert.match(batch, /isCurrentFigureOperation\(operation\)/);
  assert.match(progress, /isCurrentFigureOperation\(operationId\)/);
  assert.match(content, /operationId/);
});

test('a failed standard Figure analysis remains visible in the side-panel snapshot', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const analyzer = functionBody(content, 'analyzeFiguresWithLLM', 'maybeAutoAnalyzeWithLLM');
  const snapshotStart = content.indexOf('function buildFigureWorkspaceSnapshot');
  const snapshotEnd = content.indexOf('function buildArticleWorkspaceSnapshot', snapshotStart);
  const snapshot = content.slice(snapshotStart, snapshotEnd);
  assert.match(analyzer, /standardError/);
  assert.match(snapshot, /standardError/);
  assert.match(popup, /figure\.standardError/);
  assert.match(popup, /workspace-figure-error/);
  assert.match(popup, /runSingleFigureAnalysis\(figure\.figureId\)/);
});

test('on-demand injector loads the Figure extractor before the content workflow', () => {
  const source = read('core/tab-messenger.js');
  const scripts = [...source.matchAll(/'([^']+\.js)'/g)].map(match => match[1]);
  assert.ok(scripts.indexOf('core/figure-extractor.js') >= 0);
  assert.ok(scripts.indexOf('core/figure-extractor.js') < scripts.indexOf('content.js'));
});

test('Figure workspace exposes the full inventory, source jump, single deep analysis, and panel evidence chain', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const html = read('popup.html');
  assert.match(content, /function getFigureWorkspaceInventory/);
  assert.match(content, /isSupplemental/);
  assert.match(content, /panelHints/);
  assert.match(content, /request\.action === 'analyzeSingleFigureWithLLM'/);
  assert.match(content, /target\.kind === 'figure'/);
  assert.match(popup, /function runSingleFigureAnalysis/);
  assert.match(popup, /action: 'analyzeSingleFigureWithLLM'/);
  assert.match(popup, /argumentChain/);
  assert.match(popup, /workspace-figure-panel-card/);
  assert.match(html, /id="analyzeFiguresFromFigures"/);
  assert.match(html, /id="figureWorkspaceSummary"/);
  assert.match(popup, /function hasUsableLlm\(/);
  assert.match(popup, /figureButton\.hidden = false/);
  assert.match(popup, /analyze\.disabled = loading/);
  assert.doesNotMatch(
    popup,
    /figureButton\.hidden\s*=\s*!isLlm/
  );
});

test('Nature Extended Data section mutations invalidate the live Figure inventory', () => {
  const content = read('content.js');
  const mutation = functionBody(
    content, 'isFigureInventoryMutation', 'markFigureWorkspaceInventoryDirty'
  );
  assert.match(mutation, /\.c-article-section/);
  assert.match(mutation, /SciLLM\.FIGURE_SELECTOR/);
  assert.match(mutation, /SciLLM\.CAPTION_SELECTOR/);
});

test('Figure workspace generates cross-main-Figure logic only through the explicit AI entry', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const html = read('popup.html');
  const css = read('popup.css');
  assert.match(content, /function buildCrossFigureLogicInput/);
  assert.match(content, /LLM_ANALYZE_CROSS_FIGURE_LOGIC/);
  assert.match(content, /request\.action === 'analyzeCrossFigureLogicWithLLM'/);
  assert.match(popup, /function runCrossFigureLogic/);
  assert.match(popup, /function renderCrossFigureLogicSnapshot/);
  assert.match(popup, /focusWorkspaceSource\(\{[\s\S]*kind: 'figure'/);
  assert.doesNotMatch(html, /id="analyzeCrossFigureLogic"/);
  assert.doesNotMatch(
    functionBody(popup, 'runFigureAnalysis', 'showFigureOriginalImage'),
    /runCrossFigureLogic\s*\(/
  );
  const entry = functionBody(popup, 'renderResearchLogicMapSnapshot', 'persistFigureWorkspaceMetaMutation');
  assert.match(entry, /hasResult \? '重新生成' : 'AI生成'/);
  assert.match(entry, /generate\.addEventListener\('click',\s*\(\) => \{[\s\S]*runCrossFigureLogic\(\{\s*returnView:\s*'mechanism',\s*seedMode:\s*'auto'\s*\}\)/);
  assert.match(entry, /if \(crossFigureLogicRunning \|\| generate\.disabled\) return/);
  assert.match(css, /workspace-cross-figure-card/);
  assert.doesNotMatch(popup, /const crossFigureButton = document\.getElementById\('analyzeCrossFigureLogic'\)/);
});

test('supplemental Figures expose coverage, parent-workspace sync, and invalidate stale cross-Figure logic', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const html = read('popup.html');
  const css = read('popup.css');
  const background = read('background.js');
  const messenger = read('core/tab-messenger.js');

  assert.match(messenger, /core\/supplemental-materials\.js/);
  assert.match(background, /ARTICLE_WORKSPACE_LIST_ASSETS/);
  assert.match(html, /<details id="supplementalFigureCoverage"/);
  assert.match(
    html,
    /id="figureWorkspace"[\s\S]*id="supplementalFigureCoverage"/
  );
  assert.match(html, /id="supplementalFigureCoverageBody"/);
  assert.match(popup, /function renderSupplementalFigureCoverage/);
  assert.match(popup, /supplementalFigureCoverageSummary/);
  assert.match(popup, /createSupplementalPdfReaderUrl/);
  assert.match(popup, /下载后选择 PDF/);
  assert.match(popup, /插件不会自动下载或代传期刊附件/);
  assert.match(popup, /选择本地补充 PDF/);
  assert.match(content, /function refreshSupplementalFigureAssets/);
  assert.match(content, /figures\/supplemental\//);
  assert.match(content, /persistSupplementalFiguresToParentWorkspace/);
  assert.match(content, /supplementalFigureAssetsFingerprint/);
  assert.match(content, /补充图已更新，请重新运行主图串解以纳入补充证据/);
  assert.match(popup, /supplemental\.logicRefreshRequired/);
  assert.match(css, /\.supplemental-coverage-hint\.is-action/);
  assert.match(css, /\.supplemental-figure-coverage\[open\]/);
});

test('supplemental PDF parent reads and writes carry one verified target and retained provenance', () => {
  const content = read('content.js');
  const sync = functionBody(
    content,
    'persistSupplementalFiguresToParentWorkspace',
    'syncParsedSupplementalInventoryToParent'
  );
  assert.match(content, /function supplementalParentWorkspaceTarget\(/);
  assert.match(content, /function supplementalParentWorkspaceProvenance\(/);
  assert.match(sync, /const target = supplementalParentWorkspaceTarget\(supplementalPdfBinding\)/);
  assert.equal((sync.match(/\btarget\b/g) || []).length >= 3, true);
  assert.match(sync, /type:\s*'ARTICLE_WORKSPACE_GET_ASSET',[\s\S]*?target/);
  assert.match(sync, /type:\s*'ARTICLE_WORKSPACE_SAVE_ASSET',[\s\S]*?target/);
  assert.match(sync, /const parentProvenance = supplementalParentWorkspaceProvenance/);
  assert.equal((sync.match(/\.\.\.parentProvenance/g) || []).length >= 3, true);
  assert.match(content, /if \(binding\.parentDocumentHash\)/);
  assert.match(content, /target\.documentHash\s*=\s*binding\.parentDocumentHash/);
  assert.match(content, /if \(target\.documentHash\) provenance\.parentDocumentHash/);
});

test('live supplemental imports save a sequentially named Panel inventory without auto-analysis', async () => {
  const content = read('content.js');
  const importStart = content.indexOf(
    'async function importSupplementalFigureDraft'
  );
  const importEnd = content.indexOf(
    'function cloneUserEditedFigureValue',
    importStart
  );
  const source = content.slice(importStart, importEnd);
  const calls = [];
  let persistedResult = {
    saved: true,
    directoryPersisted: true,
    asset: { revision: 1 }
  };
  let analysisCalls = 0;
  let targetAccepted = true;
  let durableCheckpoint = null;
  const figure = {
    figureId: 'supp-manual-image-a-s1',
    figureLabel: 'Figure S1',
    panelHints: ['A', 'B']
  };
  const asset = { materialId: 'manual-image-a', figures: [figure] };
  const SciLLM = {
    supplementalFigureAssetPath: materialId => `figures/supplemental/${materialId}.json`,
    normalizeSupplementalTransientImage: image => ({ ...image }),
    nextSupplementalFigureLabel: () => 'Figure S1',
    async createManualSupplementalDraft(input, deps) {
      calls.push('create');
      assert.equal(await deps.exists('manual-image-a'), false);
      const persisted = await deps.save(
        'figures/supplemental/manual-image-a.json',
        asset,
        { expectedRevision: 0, createOnly: true }
      );
      return {
        relativePath: 'figures/supplemental/manual-image-a.json',
        asset,
        persisted,
        input
      };
    }
  };
  const factory = new Function(
    'SciLLM',
    'assertCurrentSupplementalImportTarget',
    'getWorkspaceAssetCheckpoint',
    'persistWorkspaceAssetCheckpoint',
    'invalidateCrossFigureLogic',
    'refreshSupplementalFigureAssets',
    'notifyFigureWorkspaceStateChanged',
    'analyzeSingleFigureWithLLM',
    'supplementalAssetFigureMatch',
    `${source}\nlet supplementalFigureAssets = [];\n` +
      `let supplementalFigureAssetsFingerprint = 'old';\n` +
      'return importSupplementalFigureDraft;'
  );
  const importer = factory(
    SciLLM,
    () => {
      if (!targetAccepted) {
        throw Object.assign(new Error('SUPPLEMENTAL_TARGET_MISMATCH'), {
          code: 'SUPPLEMENTAL_TARGET_MISMATCH'
        });
      }
      return { workspace: { workspaceId: `workspace:${'a'.repeat(64)}` } };
    },
    async () => durableCheckpoint,
    async (_path, _content, options) => {
      calls.push('save');
      assert.deepEqual(options, {
        force: true,
        requireDirectoryPersistence: true,
        expectedRevision: 0,
        createOnly: true
      });
      return persistedResult;
    },
    () => calls.push('invalidate'),
    async () => calls.push('refresh'),
    () => calls.push('notify'),
    async () => {
      analysisCalls += 1;
      calls.push('analyze');
      return { success: true };
    },
    (left, right) => left?.figureId === right?.figureId
  );
  const request = {
    target: { workspaceId: `workspace:${'a'.repeat(64)}` },
    draft: {
      sourceMode: 'image',
      materialId: 'manual-image-a',
      sourceImportedAt: '2026-08-03T00:00:00.000Z',
      sourceFingerprint: `sha256:${'b'.repeat(64)}`,
      sourceFileName: 's1.png',
      sourceMimeType: 'image/png',
      sourceFileSize: 4,
      figures: [{ ...figure, caption: 'Figure S1.' }]
    },
    transientImage: {
      mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA',
      width: 1, height: 1, sourceFingerprint: `sha256:${'b'.repeat(64)}`
    }
  };
  const result = await importer(request);
  assert.equal(result.analysisStatus, 'draft');
  assert.equal(result.figureLabel, 'Figure S1');
  assert.equal(result.directoryPersisted, true);
  assert.deepEqual(result.panelHints, ['A', 'B']);
  assert.equal(analysisCalls, 0);
  assert.equal(calls.includes('analyze'), false);

  persistedResult = { saved: false, stale: true };
  calls.length = 0;
  analysisCalls = 0;
  await assert.rejects(
    importer(request),
    error => error?.code === 'SUPPLEMENTAL_DRAFT_NOT_DURABLE'
  );
  assert.equal(analysisCalls, 0);
  assert.equal(calls.includes('analyze'), false);

  targetAccepted = false;
  persistedResult = {
    saved: true,
    directoryPersisted: true,
    asset: { revision: 1 }
  };
  calls.length = 0;
  await assert.rejects(
    importer(request),
    error => error?.code === 'SUPPLEMENTAL_TARGET_MISMATCH'
  );
  assert.equal(calls.includes('create'), false);
  assert.equal(calls.includes('save'), false);

  assert.match(source, /analysisStatus:\s*'draft'/);
  assert.doesNotMatch(source, /analyzeSingleFigureWithLLM/);
  assert.match(source, /nextSupplementalFigureLabel/);
  assert.match(source, /panelHints/);
  assert.match(content, /analysisStatus:\s*'complete'/);
  assert.match(content, /analysisStatus:\s*'error'/);
  const completion = functionBody(
    content,
    'persistCompletedFigureCheckpointState',
    'confirmFigureCheckpointOperationCancelled'
  );
  assert.match(completion, /await persistImportedSupplementalFigureState/);
  assert.match(completion, /checkpointMutation:\s*\{[\s\S]*?kind:\s*'clear'/);
  assert.match(completion, /await persistFigureInventoryWithCas/);
  assert.match(completion, /FIGURE_CHECKPOINT_PERSIST_FAILED/);
  assert.match(content, /request\.action === 'importSupplementalFigureDraft'/);
  assert.match(content, /async function updateImportedSupplementalFigureDraft/);
  assert.match(content, /async function deleteImportedSupplementalFigure/);
  assert.match(content, /request\.action === 'updateSupplementalFigureDraft'/);
  assert.match(content, /request\.action === 'deleteSupplementalFigure'/);
  const popup = read('popup.js');
  assert.match(popup, /'编辑手动图'/);
  assert.match(popup, /deleteSupplementalFigureFromWorkspace/);
  assert.match(popup, /deliverUpdate/);
  assert.match(popup, /deliverDelete/);
});

test('supplemental analysis state re-reads, merges and CAS-saves the durable draft', async () => {
  const content = read('content.js');
  const start = content.indexOf(
    'async function persistImportedSupplementalFigureState'
  );
  const end = content.indexOf(
    'async function importSupplementalFigureDraft',
    start
  );
  const source = content.slice(start, end);
  const cached = {
    materialId: 'manual-image-a',
    figures: [{ figureId: 'supp-a-s1' }]
  };
  const latestVersions = [
    {
      revision: 4,
      contentHash: 'hash-4',
      content: {
        materialId: 'manual-image-a',
        userLabel: 'keep latest asset field',
        figures: [
          {
            figureId: 'supp-a-s1',
            caption: 'keep caption',
            panelHints: ['A', 'B'],
            userField: 'keep latest Figure field',
            manualEdits: { standard: { editedAt: 4, coreConclusion: 'latest edit' } },
            panelFollowups: { A: { answer: 'latest follow-up' } },
            analysisImages: [{ dataUrl: 'data:image/png;base64,LATEST4' }]
          },
          { figureId: 'supp-a-s2', caption: 'keep sibling Figure' }
        ]
      }
    },
    {
      revision: 5,
      contentHash: 'hash-5',
      content: {
        materialId: 'manual-image-a',
        userLabel: 'keep newest concurrent edit',
        figures: [
          {
            figureId: 'supp-a-s1',
            caption: 'keep caption after conflict',
            panelHints: ['A', 'B'],
            userField: 'keep newest Figure field',
            manualEdits: { standard: { editedAt: 5, coreConclusion: 'newest edit' } },
            panelFollowups: { A: { answer: 'newest follow-up' } },
            analysisImages: [{ dataUrl: 'data:image/png;base64,LATEST5' }]
          },
          { figureId: 'supp-a-s2', caption: 'keep sibling Figure' }
        ]
      }
    }
  ];
  let readIndex = 0;
  const saveCalls = [];
  const persistState = new Function(
    'SciLLM',
    'supplementalAssetFigureMatch',
    'getWorkspaceAssetCheckpoint',
    'persistFigureInventoryWithCas',
    'initialAssets',
    `let supplementalFigureAssets = initialAssets;\n${source}\n` +
      'return persistImportedSupplementalFigureState;'
  )(
    {
      supplementalFigureAssetPath: materialId =>
        `figures/supplemental/${materialId}.json`
    },
    (left, right) => left?.figureId === right?.figureId,
    async () => structuredClone(latestVersions[Math.min(
      readIndex++, latestVersions.length - 1
    )]),
    async (next, options) => {
      saveCalls.push({ next: structuredClone(next), options });
      if (saveCalls.length === 1) {
        throw Object.assign(new Error('conflict'), {
          code: 'ASSET_REVISION_CONFLICT'
        });
      }
      return {
        saved: true,
        content: structuredClone(next),
        asset: { revision: 6 }
      };
    },
    [cached]
  );

  const result = await persistState(
    {
      figureId: 'supp-a-s1',
      sourceMaterialId: 'manual-image-a',
      isSupplemental: true,
      sourceExternal: true,
      analysisImages: [{ dataUrl: 'data:image/png;base64,AAAA' }]
    },
    {
      figureInputHash: 'input-hash',
      activeDepth: 'standard',
      standard: { coreConclusion: 'model result' },
      standardError: '',
      manualEdits: {},
      panelFollowups: {}
    },
    {
      analysisStatus: 'complete',
      stateFields: [
        'figureInputHash', 'standard', 'standardError', 'activeDepth'
      ]
    }
  );

  assert.equal(result.saved, true);
  assert.equal(saveCalls.length, 2);
  assert.deepEqual(saveCalls[0].options, {
    relativePath: 'figures/supplemental/manual-image-a.json'
  });
  assert.deepEqual(saveCalls[1].options, {
    relativePath: 'figures/supplemental/manual-image-a.json'
  });
  assert.equal(readIndex, 2);
  assert.equal(saveCalls[1].next.userLabel, 'keep newest concurrent edit');
  assert.equal(saveCalls[1].next.figures[0].caption, 'keep caption after conflict');
  assert.equal(saveCalls[1].next.figures[0].userField, 'keep newest Figure field');
  assert.equal(
    saveCalls[1].next.figures[0].manualEdits.standard.coreConclusion,
    'newest edit'
  );
  assert.equal(
    saveCalls[1].next.figures[0].panelFollowups.A.answer,
    'newest follow-up'
  );
  assert.equal(
    saveCalls[1].next.figures[0].analysisImages[0].dataUrl,
    'data:image/png;base64,LATEST5'
  );
  assert.equal(saveCalls[1].next.figures[1].caption, 'keep sibling Figure');
  assert.equal(saveCalls[1].next.figures[0].analysisStatus, 'complete');
  assert.equal(saveCalls[1].next.figures[0].standard.coreConclusion, 'model result');
  assert.equal(saveCalls[1].next.analysisStatus, 'partial');

  latestVersions.push({
    revision: 6,
    contentHash: 'hash-6',
    content: {
      ...structuredClone(saveCalls[1].next),
      figures: saveCalls[1].next.figures.map((item, index) => index ? item : ({
        ...structuredClone(item),
        manualEdits: {
          standard: { editedAt: 6, coreConclusion: 'concurrent latest edit' }
        }
      }))
    }
  });
  await persistState(
    {
      figureId: 'supp-a-s1',
      sourceMaterialId: 'manual-image-a',
      isSupplemental: true,
      sourceExternal: true
    },
    {
      activeDepth: 'standard',
      manualEdits: {
        standard: { editedAt: 5, coreConclusion: 'newest edit' },
        deep: { editedAt: 7, coreConclusion: 'local deep edit' }
      }
    },
    { stateFields: ['manualEdits'] }
  );
  const manualMerge = saveCalls.at(-1).next.figures[0].manualEdits;
  assert.equal(manualMerge.standard.coreConclusion, 'concurrent latest edit');
  assert.equal(manualMerge.deep.coreConclusion, 'local deep edit');
});

test('progress checkpoint saves do not replay stale supplemental Figure assets', () => {
  const content = read('content.js');
  const source = functionBody(
    content,
    'scheduleArticleWorkspaceArtifactsSave',
    'createPortableFigureWorkspaceArchiveFields'
  );
  let persistedAssets = null;
  const schedule = new Function(
    'captureArticleWorkspaceAssets',
    'persistArticleWorkspaceArtifacts',
    `let articleWorkspaceSaveTimer = null;\n` +
      `let articleWorkspaceSaveFrozen = false;\n` +
      `const articleWorkspaceExplicitSaveState = {` +
        `active:null,paused:false,lifecycle:-1,pendingAutosave:false};\n` +
      `let articleWorkspaceLifecycleGeneration = 0;\n` +
      `${source}\nreturn scheduleArticleWorkspaceArtifactsSave;`
  )(
    () => new Map([
      ['article/structure.json', { revision: 1 }],
      ['figures/supplemental/manual-s2.json', {
        figures: [{ figureId: 'supp-manual-s2', analysisStatus: 'draft' }]
      }]
    ]),
    ({ assets }) => {
      persistedAssets = assets;
      return Promise.resolve({ saved: true });
    }
  );

  schedule({ immediate: true });

  assert.deepEqual([...persistedAssets.keys()], ['article/structure.json']);
});

test('imported supplemental inventory reapplies durable manual Panel edits', () => {
  const content = read('content.js');
  const source = functionBody(
    content,
    'getImportedSupplementalFigureInventory',
    'getFigureViewerInventory'
  );
  const asset = {
    figures: [{
      figureId: 'supp-manual-s2',
      activeDepth: 'standard',
      standard: {
        figureId: 'supp-manual-s2',
        analysisDepth: 'standard',
        panels: [{ panel: 'A', purpose: 'model purpose' }]
      },
      manualEdits: {
        standard: { panels: { A: { purpose: 'human purpose' } } }
      }
    }]
  };
  const inventory = new Function(
    'SciLLM',
    'isUsableFigureAnalysisResult',
    'applyUserFigureResultEdits',
    'initialAssets',
    `let supplementalFigureAssets = initialAssets;\n${source}\n` +
      'return getImportedSupplementalFigureInventory;'
  )(
    { mergeSupplementalFigureAssets: (_main, assets) => assets.flatMap(item => item.figures) },
    value => Boolean(value),
    (base, patch) => base ? ({
      ...structuredClone(base),
      panels: base.panels.map(panel => ({
        ...panel,
        ...(patch?.panels?.[panel.panel] || {})
      }))
    }) : null,
    [asset]
  )();

  assert.equal(inventory[0].modelStandard.panels[0].purpose, 'model purpose');
  assert.equal(inventory[0].standard.panels[0].purpose, 'human purpose');
});

test('imported supplemental Figures can be re-edited and deleted durably', async () => {
  const content = read('content.js');
  const start = content.indexOf('function clearImportedSupplementalAnalysis');
  const end = content.indexOf('const USER_EDITABLE_FIGURE_FIELDS', start);
  const source = content.slice(start, end);
  let checkpoint = {
    revision: 3,
    contentHash: 'hash-3',
    content: {
      materialId: 'manual-caption-a',
      analysisStatus: 'complete',
      figures: [{
        figureId: 'supp-manual-caption-a-s1',
        figureLabel: 'Supplemental Figure 1',
        identityRevision: 1,
        sourceMode: 'caption',
        caption: 'Old caption (A).',
        panelHints: ['A'],
        standard: { coreConclusion: 'stale result' },
        modelStandard: { coreConclusion: 'stale result' },
        analysisStatus: 'complete'
      }]
    }
  };
  let inventoryCheckpoint = {
    revision: 8,
    contentHash: 'inventory-hash-8',
    content: {
      schemaVersion: 2,
      figures: [structuredClone(checkpoint.content.figures[0])],
      figureTombstones: []
    }
  };
  const assetCache = [structuredClone(checkpoint.content)];
  const saved = [];
  const casWrites = [];
  const invalidations = [];
  const notifications = [];
  const factory = new Function(
    'SciLLM',
    'assertCurrentSupplementalImportTarget',
    'refreshSupplementalFigureAssets',
    'supplementalAssetFigureMatch',
    'getWorkspaceAssetCheckpoint',
    'persistWorkspaceAssetCheckpoint',
    'articleWorkspaceAssetFingerprint',
    'persistFigureInventoryWithCas',
    'confirmFigureCheckpointOperationCancelled',
    'createFigureOperationId',
    'invalidateCrossFigureLogic',
    'getImportedSupplementalFigureInventory',
    'notifyFigureWorkspaceStateChanged',
    'initialAssets',
    `${source}\n` +
      `let supplementalFigureAssets = initialAssets;\n` +
      `let supplementalFigureAssetsFingerprint = 'old';\n` +
      `const figureWalkthroughState = new Map();\n` +
      `const figureProgressById = new Map();\n` +
      `return { updateImportedSupplementalFigureDraft, deleteImportedSupplementalFigure };`
  );
  const SciLLM = {
    supplementalFigureAssetPath: materialId => `figures/supplemental/${materialId}.json`,
    extractPanelHints: caption => caption.includes('(B)') ? ['A', 'B'] : ['A'],
    splitFigureCaptionByPanelGroups: caption => [{ panels: ['A', 'B'], text: caption }],
    canonicalSupplementalFigureLabel: () => 'Figure S1',
    normalizeSupplementalTransientImage: image => ({ ...image })
  };
  const functions = factory(
    SciLLM,
    () => ({ workspace: { workspaceId: `workspace:${'a'.repeat(64)}` } }),
    async () => {
      assetCache.splice(0, assetCache.length, structuredClone(checkpoint.content));
    },
    (left, right) => String(left?.figureId) === String(right?.figureId),
    async relativePath => structuredClone(
      relativePath === 'figures/inventory.json'
        ? inventoryCheckpoint : checkpoint
    ),
    async (_path, next, options) => {
      saved.push({ next: structuredClone(next), options });
      checkpoint = {
        revision: checkpoint.revision + 1,
        contentHash: `hash-${checkpoint.revision + 1}`,
        content: structuredClone(next)
      };
      return { saved: true };
    },
    value => JSON.stringify(value),
    async (incoming, options) => {
      casWrites.push({
        incoming: structuredClone(incoming),
        options: structuredClone(options)
      });
      if (options.reconcileFigureReplica === true) {
        assert.deepEqual(
          options.expectedFigureReplica,
          inventoryCheckpoint.content.figures[0]
        );
        inventoryCheckpoint = {
          revision: inventoryCheckpoint.revision + 1,
          contentHash: `inventory-hash-${inventoryCheckpoint.revision + 1}`,
          content: {
            schemaVersion: incoming.schemaVersion,
            figures: structuredClone(incoming.figures),
            figureTombstones: structuredClone(
              inventoryCheckpoint.content.figureTombstones
            )
          }
        };
      } else if (options.deleteFigureIdentity === true) {
        assert.deepEqual(
          options.expectedFigureIdentity,
          inventoryCheckpoint.content.figures[0]
        );
        inventoryCheckpoint = {
          revision: inventoryCheckpoint.revision + 1,
          contentHash: `inventory-hash-${inventoryCheckpoint.revision + 1}`,
          content: {
            schemaVersion: incoming.schemaVersion,
            figures: [],
            figureTombstones: structuredClone(incoming.figureTombstones)
          }
        };
      } else {
        assert.fail('unexpected Figure inventory CAS mutation');
      }
      return { saved: true, content: structuredClone(inventoryCheckpoint.content) };
    },
    async () => assert.fail('checkpoint cancellation should not run without a checkpoint'),
    () => 'figure-delete-operation-0001',
    reason => invalidations.push(reason),
    () => structuredClone(checkpoint.content.figures),
    (event, figure) => notifications.push({ event, figure: structuredClone(figure) }),
    assetCache
  );
  {
    const updated = await functions.updateImportedSupplementalFigureDraft({
      target: {},
      figureId: 'supp-manual-caption-a-s1',
      caption: 'New caption (A) setup. (B) result.'
    });
    assert.equal(updated.figureLabel, 'Figure S1');
    assert.deepEqual(updated.panelHints, ['A', 'B']);
    assert.equal(checkpoint.content.figures[0].standard, undefined);
    assert.equal(checkpoint.content.figures[0].modelStandard, undefined);
    assert.equal(checkpoint.content.figures[0].analysisStatus, 'draft');
    assert.equal(checkpoint.content.figures[0].identityRevision, 2);
    assert.equal(inventoryCheckpoint.content.figures[0].identityRevision, 2);
    assert.equal(saved[0].options.expectedRevision, 3);
    assert.equal(saved[0].options.expectedContentHash, 'hash-3');
    assert.deepEqual(casWrites[0].options, {
      figureId: 'supp-manual-caption-a-s1',
      reconcileFigureReplica: true,
      expectedFigureReplica: {
        figureId: 'supp-manual-caption-a-s1',
        figureLabel: 'Supplemental Figure 1',
        identityRevision: 1,
        sourceMode: 'caption',
        caption: 'Old caption (A).',
        panelHints: ['A'],
        standard: { coreConclusion: 'stale result' },
        modelStandard: { coreConclusion: 'stale result' },
        analysisStatus: 'complete'
      }
    });

    const deleted = await functions.deleteImportedSupplementalFigure({
      target: {},
      figureId: 'supp-manual-caption-a-s1'
    });
    assert.equal(deleted.deleted, true);
    assert.deepEqual(checkpoint.content.figures, []);
    assert.equal(checkpoint.content.analysisStatus, 'empty');
    assert.deepEqual(inventoryCheckpoint.content.figures, []);
    assert.equal(checkpoint.content.figureTombstones.length, 1);
    assert.deepEqual(
      inventoryCheckpoint.content.figureTombstones,
      checkpoint.content.figureTombstones
    );
    assert.match(
      checkpoint.content.figureTombstones[0].predecessorIdentityDigest,
      /^[a-f0-9]{64}$/
    );
    assert.equal(casWrites[1].options.deleteFigureIdentity, true);
    assert.equal(casWrites[1].options.figureId, 'supp-manual-caption-a-s1');
    assert.equal(saved[1].options.expectedRevision, 4);
    assert.equal(saved[1].options.expectedContentHash, 'hash-4');
    assert.equal(invalidations.length, 2);
    assert.deepEqual(notifications.map(item => item.event), [
      'supplemental_figure_updated', 'supplemental_figure_deleted'
    ]);
  }
});

test('workspace checkpoint maps the old hash to the router CAS field', async () => {
  const content = read('content.js');
  const start = content.indexOf('function persistWorkspaceAssetCheckpoint');
  const end = content.indexOf('function persistWorkspaceTurnCheckpoint', start);
  const source = content.slice(start, end);
  const sent = [];
  const persist = new Function(
    'chrome',
    'ensureCurrentArticleWorkspace',
    'assertCurrentArticleWorkspaceLifecycle',
    'articleWorkspaceAssetFingerprint',
    `let articleWorkspaceSaveFrozen = false;\n` +
      `let currentArticleWorkspace = null;\n` +
      `let articleWorkspaceLifecycleGeneration = 1;\n` +
      `let articleWorkspaceMutationTail = Promise.resolve();\n` +
      `const articleWorkspaceAssetFingerprints = new Map();\n` +
      `${source}\nreturn persistWorkspaceAssetCheckpoint;`
  )(
    { runtime: { sendMessage: async message => {
      sent.push(message);
      return { success: true, data: { saved: true } };
    } } },
    async () => ({ workspaceId: 'workspace-1', workspaceGeneration: 3 }),
    () => undefined,
    () => 'new-fingerprint'
  );

  await persist('figures/supplemental/a.json', { value: 1 }, {
    force: true,
    expectedRevision: 7,
    expectedContentHash: 'old-content-hash'
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].expectedRevision, 7);
  assert.equal(sent[0].expectedContentHash, 'old-content-hash');
  assert.equal(Object.hasOwn(sent[0], 'contentHash'), false);
});

test('batch and single supplemental Figure analysis stay on the parent article and persist results', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const batch = functionBody(content, 'analyzeFiguresWithLLM', 'maybeAutoAnalyzeWithLLM');
  const external = functionBody(
    popup,
    'runExternalSupplementalFigureAnalysis',
    'runFigureAnalysis'
  );
  assert.match(batch, /refreshSupplementalFigureAssets\(workspace\)/);
  assert.match(batch, /getImportedSupplementalFigureInventory\(\)/);
  assert.match(batch, /figures\s*=\s*\[\.\.\.visibleMainFigures,\s*\.\.\.supplementalFigures\]/);
  assert.match(batch, /manualMainLabels/);
  assert.match(batch, /persistImportedSupplementalFigureState\(figure, state, \{/);
  assert.doesNotMatch(batch, /state\.standard\s*=\s*null/);
  assert.match(external, /runSingleFigureAnalysis/);
  assert.doesNotMatch(external, /resolveSupplementalReaderTab|chrome\.tabs\.update|sendTabMessageWithRecovery/);
});

test('navigation tree exposes hierarchy depth and separate global controls', () => {
  const popup = read('popup.js');
  const html = read('popup.html');
  const css = read('popup.css');
  assert.match(html, /expandAllOutlineLevels/);
  assert.match(html, /collapseAllOutlineLevels/);
  assert.match(popup, /workspace-tree-toggle/);
  assert.match(popup, /details\.dataset\.treeDepth/);
  assert.match(css, /workspace-tree-node\[data-tree-depth="0"\]/);
  assert.match(css, /workspace-tree-node\[data-tree-depth="1"\]/);
  assert.match(css, /workspace-tree-node\[data-tree-depth="2"\]/);
});
