const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('popup offers explicit regex and LLM modes plus a gear-owned settings menu', () => {
  const html = read('popup.html');
  assert.match(html, /name="analysisMode"[^>]*value="regex"|value="regex"[^>]*name="analysisMode"/);
  assert.match(html, /name="analysisMode"[^>]*value="llm"|value="llm"[^>]*name="analysisMode"/);
  assert.match(html, /id="openSidePanelSettings"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
  assert.match(html, /id="sidePanelSettingsMenu"[^>]*role="menu"/);
  assert.match(html, /id="settingsRouteSummary"/);
  assert.match(html, /id="openLlmSettingsMenuItem"[^>]*role="menuitem"/);
  assert.match(html, /id="llmDiagnostics"/);
});

test('popup routes LLM analysis and falls back to regex on failure', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /core\/tab-messenger\.js/);
  assert.match(script, /sendTabMessageWithRecovery/);
  assert.doesNotMatch(script, /chrome\.tabs\.sendMessage/);
  assert.match(script, /analyzeArticleWithLLM/);
  assert.match(script, /LLM_UPDATE_PREFERENCES/);
  assert.match(script, /openOptionsPage/);
  assert.match(script, /availableCategories/);
  assert.match(script, /LLM_PREPARE_DOCUMENT/);
  assert.match(script, /回退.*正则|正则.*回退/);
  assert.match(script, /getLlmDiagnostics/);
  assert.match(script, /refreshLlmDiagnostics/);
  assert.match(script, /unrecognizedTextBlocks/);
  assert.match(script, /未识别长文本/);
});

test('popup exposes task controls and never treats user cancellation as regex fallback', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  ['pauseHighlightAnalysis', 'cancelHighlightAnalysis', 'pauseFigureAnalysis',
    'cancelFigureAnalysis'].forEach(id => assert.match(html, new RegExp(`id="${id}"`)));
  assert.match(script, /function controlActiveAnalysis\(/);
  assert.match(script, /error\?\.code === 'CANCELLED' \|\| highlightTaskState\.cancelled/);
});

test('popup article chat allows queueing and preserves the composer while blocks stream', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  const start = script.indexOf('function articleChatStatusText');
  const end = script.indexOf('function withPreparationDeadline', start);
  const chat = script.slice(start, end);
  assert.match(html, /id="articleChatMessages"[^>]*role="log"/);
  assert.match(html, /aria-relevant="additions text"/);
  assert.match(script, /function applyArticleChatStateEvent/);
  assert.match(chat, /function renderArticleChatTurn/);
  assert.match(chat, /function renderArticleChatBlock/);
  assert.match(chat, /selectedProfileId:\s*profileId/);
  assert.doesNotMatch(chat, /if \(articleChatRequestPending\) return;[\s\S]{0,700}articleChatQuestion/);
  assert.doesNotMatch(chat, /send\.disabled = loading/);
});

test('popup formats effective-route fallback without exposing provider secrets', () => {
  const script = read('popup.js');
  assert.match(script, /function formatEffectiveRoute\(status, route\)/);
  assert.match(script, /effectiveProfileName/);
  assert.match(script, /已回退到/);
  assert.match(script, /使用 \$\{target\}/);
  const helper = script.slice(script.indexOf('function formatEffectiveRoute'));
  assert.doesNotMatch(helper, /apiKey|customHeaders|authorization/i);
});

test('gear route summary reads v5 public settings without exposing provider secrets', () => {
  const script = read('popup.js');
  const start = script.indexOf('function getPublicRouteSummaryRows');
  const end = script.indexOf('return Object.freeze({', start);
  const summary = script.slice(start, end);
  assert.match(summary, /profiles/);
  assert.match(summary, /globalProfileId/);
  assert.match(summary, /taskRoutes/);
  assert.doesNotMatch(summary, /apiKeyMask|apiKey|customHeaders|authorization/i);
});

test('a stale Figure request cannot update the panel after its tab context changes', () => {
  const script = read('popup.js');
  assert.match(script, /let figureTaskGeneration = 0/);
  assert.match(script, /function isCurrentFigureTask\(token, tabId\)/);
  const resetStart = script.indexOf('function resetPanelArticleState');
  const resetEnd = script.indexOf('function renderInactiveTabState', resetStart);
  const reset = script.slice(resetStart, resetEnd);
  assert.match(reset, /figureTaskGeneration \+= 1/);
  assert.match(reset, /crossFigureLogicRunning = false/);
  assert.doesNotMatch(reset, /singleFigureRunningIds/);
  const restoreStart = script.indexOf('function restorePanelTabState');
  const restoreEnd = script.indexOf('async function synchronizeActiveTabContext', restoreStart);
  assert.doesNotMatch(script.slice(restoreStart, restoreEnd), /cached\.figureAnalysisState/);
  const figureStart = script.indexOf('async function runFigureAnalysis');
  const figureEnd = script.indexOf('async function showFigureOriginalImage', figureStart);
  const figureRun = script.slice(figureStart, figureEnd);
  assert.match(figureRun, /taskToken = figureTaskGeneration/);
  assert.match(figureRun, /if \(!isCurrentFigureTask\(taskToken, tab\.id\)\) return/);
  assert.match(figureRun, /finally \{[\s\S]*isCurrentFigureTask\(taskToken, tab\?\.id\)/);
});

test('Figure progress route line identifies the effective profile, model, capability, and fallback', () => {
  const script = read('popup.js');
  const helper = script.slice(script.indexOf('function formatFigureProgress'));
  assert.match(helper, /effectiveProfileName/);
  assert.match(helper, /capabilityMode/);
  assert.match(helper, /fallbackReason/);
  assert.match(helper, /routeModel/);
});

test('Figure progress polling keeps the request token across an await', () => {
  const script = read('popup.js');
  const refreshStart = script.indexOf('async function refreshFigureAnalysisProgress');
  const refreshEnd = script.indexOf('function startFigureProgressPolling', refreshStart);
  const refresh = script.slice(refreshStart, refreshEnd);
  const pollingEnd = script.indexOf('async function restoreFigureAnalysisProgress', refreshEnd);
  const polling = script.slice(refreshEnd, pollingEnd);

  assert.match(
    refresh,
    /async function refreshFigureAnalysisProgress\(tabId, announce = true, taskToken = figureTaskGeneration\)/
  );
  assert.match(refresh, /isCurrentFigureTask\(taskToken, tabId\)/);
  assert.doesNotMatch(refresh, /isCurrentFigureTask\(figureTaskGeneration, tabId\)/);
  assert.match(polling, /refreshFigureAnalysisProgress\(tabId, true, taskToken\)/);
});

test('Figure progress polling ignores overlapping and superseded snapshot responses', () => {
  const script = read('popup.js');
  const refreshStart = script.indexOf('async function refreshFigureAnalysisProgress');
  const refreshEnd = script.indexOf('function startFigureProgressPolling', refreshStart);
  const refresh = script.slice(refreshStart, refreshEnd);
  const pollingEnd = script.indexOf('async function restoreFigureAnalysisProgress', refreshEnd);
  const polling = script.slice(refreshEnd, pollingEnd);

  assert.match(script, /let figureProgressPollingGeneration\s*=/);
  assert.match(script, /let figureProgressRefreshSequence\s*=/);
  assert.match(refresh, /const requestSequence\s*=\s*\+\+figureProgressRefreshSequence/);
  assert.match(refresh, /requestSequence !== figureProgressRefreshSequence/);
  assert.match(polling, /let pollInFlight\s*=\s*false/);
  assert.match(polling, /if \(pollInFlight\) return/);
  assert.match(polling, /pollInFlight\s*=\s*true/);
  assert.match(polling, /finally\s*\{\s*pollInFlight\s*=\s*false/);
});

test('workspace refresh and cached-tab restore resume the shared Figure progress timer', () => {
  const script = read('popup.js');
  const restoreStart = script.indexOf('function restorePanelTabState');
  const restoreEnd = script.indexOf('async function synchronizeActiveTabContext', restoreStart);
  const restore = script.slice(restoreStart, restoreEnd);
  const refreshStart = script.indexOf('async function refreshArticleWorkspace');
  const refreshEnd = script.indexOf('// 鍒濆鍖?', refreshStart);
  const refresh = script.slice(refreshStart, refreshEnd);

  assert.match(script, /function resumeFigureProgressFromWorkspaceSnapshot/);
  assert.match(restore, /resumeFigureProgressFromWorkspaceSnapshot\(currentWorkspaceSnapshot/);
  assert.match(refresh, /resumeFigureProgressFromWorkspaceSnapshot\(response\.snapshot/);
  assert.match(script, /hasRunningFigureProgress\(status\)/);
  assert.match(script, /startFigureProgressPolling\(tabId\)/);
  assert.match(script, /elapsedSeconds/);
});

test('side panel scans, restores, and clears the current page workspace explicitly', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /id="scanArticleWorkspace"/);
  assert.match(html, /id="clearArticleWorkspace"/);
  assert.match(script, /ARTICLE_WORKSPACE_SCAN_RESTORE/);
  assert.match(script, /requestPermission:\s*true/);
  assert.match(script, /action:\s*'applyArticleWorkspaceAssets'/);
  assert.match(script, /ARTICLE_WORKSPACE_BEGIN_DELETE/);
  assert.match(script, /ARTICLE_WORKSPACE_FINALIZE_DELETE/);
  assert.match(script, /confirm\(/);
  assert.match(script, /activeWorkspaceView/);
  assert.match(script, /ui\/state\.json/);
});

test('side panel follows the active tab without activating untouched papers', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /core\/tab-activation\.js/);
  assert.match(script, /chrome\.tabs\.onActivated\.addListener/);
  assert.match(script, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(script, /function synchronizeActiveTabContext/);
  assert.match(script, /isTabActivated/);
  assert.match(script, /点击扩展图标激活/);
  const bootStart = script.indexOf("document.addEventListener('DOMContentLoaded'");
  const bootEnd = script.indexOf('// 加载设置', bootStart);
  const boot = script.slice(bootStart, bootEnd);
  assert.match(boot, /synchronizeActiveTabContext/);
  assert.doesNotMatch(boot, /await initializeCurrentArticle\(\)/);
});

test('popup carries the prepared document identity into study selection and analysis actions', () => {
  const script = read('popup.js');
  assert.match(
    script,
    /type:\s*'LLM_SET_STUDY_TYPE'[\s\S]{0,240}documentId:\s*preparedDocumentState\.documentId/
  );
  assert.match(
    script,
    /action:\s*'analyzeArticleWithLLM'[\s\S]{0,240}documentId:\s*preparedDocumentState\.documentId/
  );
  assert.match(
    script,
    /action:\s*'analyzeReviewOutlineWithLLM'[\s\S]{0,240}documentId:\s*preparedDocumentState\.documentId/
  );
});

test('popup exposes a persistent LLM confidence slider', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  const css = read('popup.css');
  assert.match(html, /id="confidenceControl"/);
  assert.match(html, /id="confidenceThreshold"[^>]*type="range"|type="range"[^>]*id="confidenceThreshold"/);
  assert.match(html, /min="0\.5"/);
  assert.match(html, /max="0\.95"/);
  assert.match(html, /step="0\.05"/);
  assert.match(script, /confidenceThreshold\s*=\s*0\.8/);
  assert.match(script, /applyLlmConfidenceThreshold/);
  assert.match(css, /\.confidence-control/);
});

test('popup exposes a one-click LLM-only Figure walkthrough without regex fallback', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  const css = read('popup.css');
  assert.match(html, /id="analyzeFigures"/);
  assert.match(html, /逐图解读/);
  assert.match(script, /function updateFigureButton/);
  assert.match(script, /figureButton\.hidden\s*=\s*!isLlm/);
  assert.match(script, /figureButton\.disabled\s*=\s*!ready/);
  assert.match(script, /action:\s*'analyzeFiguresWithLLM'/);
  assert.match(script, /逐图解读完成/);
  const handlerStart = script.indexOf('async function runFigureAnalysis');
  const handlerEnd = script.indexOf('function setupEventListeners', handlerStart);
  const handler = script.slice(handlerStart, handlerEnd);
  assert.doesNotMatch(handler, /applyRegexOnTab|mode:\s*'regex'/);
  assert.match(css, /\.btn-figure/);
});

test('popup polls and displays the current Figure while a long batch is running', () => {
  const script = read('popup.js');
  assert.match(script, /action:\s*'getFigureAnalysisStatus'/);
  assert.match(script, /setInterval/);
  assert.match(script, /clearInterval/);
  assert.match(script, /currentFigure/);
  assert.match(script, /totalFigures/);
  assert.match(script, /completedFigures/);
  assert.match(script, /failedCount/);
  assert.match(script, /第\s*\$\{[^}]+\}\s*\/\s*\$\{[^}]+\}\s*张/);
});

test('popup does not carry a second regex default source', () => {
  const script = read('popup.js');
  assert.doesNotMatch(script, /DEFAULT_CATEGORIES|sanitizeBuiltInRegexRules|allRules/);
  assert.match(script, /availableCategories/);
});

test('regex apply resolves current unified overrides without mixed revisions', () => {
  const script = read('popup.js');
  assert.match(script, /Promise\.all/);
  assert.match(script, /type:\s*'CATEGORY_GET'/);
  assert.match(script, /translateUnifiedRegexCategories/);
  assert.match(script, /userDataCategoryRevision/);
  assert.match(script, /shouldApplyRegexSnapshot/);
  assert.doesNotMatch(script, /DEFAULT_CATEGORIES|sanitizeBuiltInRegexRules/);
});
