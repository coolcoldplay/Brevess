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
  const source = functionBody(script, 'buildFigureInputHash', 'getFigureWorkspaceInventory');
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
  assert.match(renderer, /formatFigurePanelHeader\(panel\)/);
  assert.match(renderer, /panel\.observationSource/);
  assert.match(renderer, /panel\.methodSource/);
  assert.match(renderer, /workspace-panel-id/);
  assert.match(renderer, /workspace-panel-description/);
  assert.match(css, /\.workspace-panel-id\s*\{[^}]*font-weight:\s*800/);
  assert.match(css, /\.workspace-panel-description\s*\{[^}]*font-weight:\s*450/);
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
  assert.match(panelCatalog, /figureCatalogPanelIds\(figure, result\)/);
  assert.match(panelCatalog, /runSingleFigurePanelAnalysis\(figure\.figureId, panelId\)/);
  assert.match(panelCatalog, /createPanelFollowupControl\(figure, panel\)/);
  assert.match(content, /async function analyzeSingleFigurePanelWithLLM/);
  assert.match(content, /type: 'LLM_ANALYZE_FIGURE_PANEL'/);
  assert.match(content, /figure_panel_schema_retry/);
  assert.match(content, /figure_panel_transient_retry/);
  assert.match(content, /computePageDocumentHash\(\)/);
  assert.match(content, /prepareFigurePanelImageVariants\(state\.figure, normalizedPanelId\)/);
  assert.match(content, /request\.action === 'analyzeSingleFigurePanelWithLLM'/);
  const workflow = functionBody(
    content, 'analyzeSingleFigurePanelWithLLM', 'askFigurePanelWithLLM'
  );
  assert.doesNotMatch(workflow, /document:\s*\{[^}]*paragraphs/);
  assert.doesNotMatch(workflow, /type: 'LLM_ANALYZE_FIGURES'/);
});

test('Figure argument chain, evidence groups, and logic bridges are independently collapsible', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const renderer = functionBody(popup, 'renderFigureWorkspaceSnapshot', 'renderArticleWorkspaceSnapshot');
  assert.match(popup, /const figureSectionExpansionState = new Map\(\)/);
  assert.match(popup, /function createCollapsibleFigureResultSection/);
  assert.match(renderer, /'argument-chain'/);
  assert.match(renderer, /'panel-groups'/);
  assert.match(renderer, /'logic-bridges'/);
  assert.match(css, /\.workspace-figure-result-section/);
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
  assert.match(content, /prepareFigurePanelImageVariants\(state\.figure, panelKey\)/);
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
  assert.match(popup, /appendPanelFollowupHistory\(root, figure, panelId, answer\)/);
  assert.match(popup, /workspace-panel-followup-history/);
  assert.match(popup, /历史追问/);
  assert.match(popup, /function revealPanelFollowupAnswer\(/);
  assert.match(popup, /function stabilizePanelFollowupAnswer\(/);
  assert.match(popup, /完成后会自动定位到这里/);
  assert.match(css, /\.workspace-panel-followup-answer\.is-newly-revealed/);
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
  assert.match(analyzer, /extractArticleFigures/);
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
  assert.match(renderer, /renderFigureProgress\(details, progress\)/);
  assert.match(popup, /workspace-figure-progress/);
  assert.match(css, /\.workspace-figure-progress\s*\{/);
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

test('Figure header actions are one compact row and cross-Figure action is concise', () => {
  const popup = read('popup.js');
  const html = read('popup.html');
  const css = read('popup.css');
  assert.match(popup, /'图注'/);
  assert.match(popup, /'原图'/);
  assert.match(popup, /loading \? '解图中…' : '解图'/);
  assert.match(
    css,
    /\.workspace-figure-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s
  );
  assert.match(css, /\.workspace-figure-analyze-action\s*\{\s*grid-column:\s*auto/);
  assert.match(html, />主图串解<\/button>/);
  assert.match(popup, /'主图串解'/);
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

test('Figure workspace provides a one-click cross-main-Figure domino chain with source jumps', () => {
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
  assert.match(html, /id="analyzeCrossFigureLogic"/);
  assert.match(css, /workspace-cross-figure-card/);
  assert.match(popup, /crossFigureButton\.hidden = false/);
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
