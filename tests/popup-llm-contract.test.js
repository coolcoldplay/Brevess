const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('popup offers explicit regex and LLM modes plus a direct settings gear', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /name="analysisMode"[^>]*value="regex"|value="regex"[^>]*name="analysisMode"/);
  assert.match(html, /name="analysisMode"[^>]*value="llm"|value="llm"[^>]*name="analysisMode"/);
  assert.match(html, /id="openSidePanelSettings"[^>]*aria-label="打开识别规则与模型设置"/);
  assert.doesNotMatch(html, /id="sidePanelSettingsMenu"/);
  assert.match(script, /function setupSidePanelSettingsShortcut\(/);
  assert.match(script, /options\.html#categoryWorkspace/);
  assert.match(script, /chrome\.tabs\.create/);
  assert.match(html, /id="llmDiagnostics"/);
});

test('popup preserves completed LLM chunks and retries only unfinished work', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /core\/tab-messenger\.js/);
  assert.match(script, /sendTabMessageWithRecovery/);
  assert.doesNotMatch(script, /chrome\.tabs\.sendMessage/);
  assert.match(script, /analyzeArticleWithLLM/);
  assert.match(script, /LLM_UPDATE_PREFERENCES/);
  assert.match(script, /options\.html#categoryWorkspace/);
  assert.match(script, /availableCategories/);
  assert.match(script, /LLM_PREPARE_DOCUMENT/);
  assert.match(script, /已完成分块和高亮均已保留/);
  assert.match(script, /再次点击只会重试未完成分块/);
  assert.doesNotMatch(script, /LLM 分析失败，已回退到正则高亮/);
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

test('an unavailable LLM mode turns the primary action into a settings CTA', () => {
  const script = read('popup.js');
  const updateStart = script.indexOf('function updateApplyButton');
  const updateEnd = script.indexOf('async function controlActiveAnalysis', updateStart);
  const update = script.slice(updateStart, updateEnd);
  assert.match(update, /先配置 API/);
  assert.match(update, /applyButton\.disabled\s*=\s*false/);
  assert.match(script, /chrome\.runtime\.openOptionsPage\(\)/);
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
  assert.match(
    refresh,
    /refreshFigureExtractorInTab\([\s\S]{0,120}chrome,[\s\S]{0,80}panelContext\.tabId/
  );
  assert.match(script, /function mergeRefreshedFigureCatalog/);
  assert.match(refresh, /mergeRefreshedFigureCatalog\(/);
  assert.match(script, /extractorProbeFigureId/);
  assert.match(refresh, /resumeFigureProgressFromWorkspaceSnapshot\(snapshot/);
  assert.match(script, /hasRunningFigureProgress\(status\)/);
  assert.match(script, /startFigureProgressPolling\(tabId\)/);
  assert.match(script, /elapsedSeconds/);
});

test('side panel scans, restores, and clears the current page workspace explicitly', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /id="scanArticleWorkspace"/);
  assert.match(html, /id="clearArticleWorkspace"/);
  assert.ok(
    html.indexOf('core/user-data-database.js') < html.indexOf('popup.js')
  );
  assert.ok(
    html.indexOf('core/directory-sync.js') < html.indexOf('popup.js')
  );
  assert.match(script, /ARTICLE_WORKSPACE_SCAN_RESTORE/);
  assert.match(script, /function beginArticleWorkspaceDirectoryPermissionRequest\(/);
  assert.match(
    script,
    /handle\.requestPermission\(\{\s*mode:\s*'readwrite'\s*\}\)/
  );
  assert.match(script, /requestPermission:\s*false/);
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
  assert.match(script, /点击侧栏任意位置激活/);
  const bootStart = script.indexOf("document.addEventListener('DOMContentLoaded'");
  const bootEnd = script.indexOf('// 加载设置', bootStart);
  const boot = script.slice(bootStart, bootEnd);
  assert.match(boot, /synchronizeActiveTabContext/);
  assert.doesNotMatch(boot, /await initializeCurrentArticle\(\)/);
});

test('popup carries the prepared document identity into analysis actions without paper-type selection', () => {
  const script = read('popup.js');
  assert.doesNotMatch(script, /type:\s*'LLM_SET_STUDY_TYPE'/);
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

test('popup exposes Figure LLM tools independently from the selected highlight engine', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  const css = read('popup.css');
  assert.match(html, /id="analyzeFigures"/);
  assert.match(html, /全部解图/);
  assert.match(script, /function updateFigureButton/);
  assert.match(script, /function hasUsableLlm/);
  assert.match(script, /figureButton\.hidden\s*=\s*false/);
  assert.match(script, /figureButton\.disabled\s*=\s*running/);
  assert.doesNotMatch(script, /figureButton\.hidden\s*=\s*!isLlm/);
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

test('highlight distribution exposes three independent fixed source toggles', () => {
  const script = read('popup.js');
  const css = read('popup.css');
  assert.match(script, /HIGHLIGHT_SOURCE_FILTERS = Object\.freeze\(\['regex', 'llm', 'manual'\]\)/);
  assert.match(script, /label: '正则'/);
  assert.match(script, /label: 'LLM'/);
  assert.match(script, /label: '手动'/);
  assert.match(script, /dataset\.highlightSourceToggle = source/);
  assert.match(script, /setAttribute\('aria-pressed'/);
  assert.match(script, /action: 'setHighlightSourceVisibility'/);
  assert.match(css, /workspace-distribution-legend-item\[aria-pressed="false"\]/);
});

test('transient LLM chunk notifications replace one progress row instead of flooding history', () => {
  const script = read('popup.js');
  const start = script.indexOf('function recordSidePanelNotification');
  const end = script.indexOf('function setupSidePanelNotificationCenter', start);
  const helper = script.slice(start, end);
  assert.match(helper, /transientHighlightProgress/);
  assert.match(helper, /当前段落已完成并保存/);
  assert.match(helper, /newest\.message = normalizedMessage/);
  assert.match(helper, /60000/);
});

function loadSupplementalFigureImportTools(overrides = {}) {
  const script = read('popup.js');
  const start = script.indexOf('function createSupplementalFigureImportTools');
  const end = script.indexOf('const supplementalFigureImportTools', start);
  assert.ok(start >= 0 && end > start, 'supplemental Figure import factory is present');
  const factory = new Function(
    `${script.slice(start, end)}\nreturn createSupplementalFigureImportTools;`
  )();
  const shared = require('../core/supplemental-materials.js');
  return factory({
    shared,
    cryptoApi: {
      subtle: {
        digest: async () => Uint8Array.from({ length: 32 }, (_, index) => index).buffer
      }
    },
    btoaImpl: value => Buffer.from(value, 'binary').toString('base64'),
    now: () => '2026-08-03T00:00:00.000Z',
    ...overrides
  });
}

test('new supplemental Figure dialog combines image and caption into one manual pane', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const script = read('popup.js');
  assert.match(html, /id="openSupplementalFigureImport"/);
  assert.match(html, /id="supplementalFigureImportStatus"[^>]*aria-live="polite"/);
  for (const mode of ['pdf', 'manual']) {
    assert.match(html, new RegExp(`name="supplementalFigureSourceMode"[^>]*value="${mode}"`));
    assert.match(html, new RegExp(`data-supplemental-source-pane="${mode}"`));
  }
  assert.doesNotMatch(html, /name="supplementalFigureSourceMode"[^>]*value="caption"/);
  assert.match(
    html,
    /id="supplementalFigureImageFile"[^>]*accept="[^"]*(?:image\/png)[^"]*(?:image\/jpeg)[^"]*(?:image\/webp)[^"]*"/
  );
  assert.match(
    html,
    /id="supplementalFigureImageCaption"[^>]*maxlength="8000"/
  );
  assert.doesNotMatch(
    html,
    /id="supplementalFigureImageCaption"[^>]*required/
  );
  assert.match(html, /id="supplementalFigurePasteTarget"[^>]*tabindex="0"/);
  assert.match(html, /id="supplementalFigureKind"/);
  assert.match(html, /<option value="main">主图<\/option>/);
  assert.match(html, /<option value="supplemental" selected>补充图<\/option>/);
  assert.match(html, /id="supplementalFigureLabel"/);
  assert.match(html, /id="supplementalFigureSourcePage"[^>]*type="number"[^>]*min="1"/);
  assert.match(html, /Ctrl\+V/);
  assert.match(script, /function resetSupplementalFigureImportForm/);
  assert.match(script, /form\?\.reset\?\.\(\)/);
  assert.match(script, /clipboardImageFile/);
  assert.match(script, /updateSupplementalFigureDraft/);
  assert.match(script, /deleteSupplementalFigure/);
  assert.match(script, /normalizeManualMetadata/);
  assert.match(script, /PDF 第 \$\{Math\.floor\(Number\(figure\.sourcePage\)\)\} 页/);
  assert.ok(html.indexOf('core/supplemental-materials.js') < html.indexOf('popup.js'));
  assert.match(css, /\.supplemental-figure-import-dialog/);
  assert.match(css, /\[data-supplemental-source-pane\]\[hidden\]/);
});

test('supplemental Figure source mode keeps one pane visible without clearing retry input', () => {
  const tools = loadSupplementalFigureImportTools();
  const radios = ['pdf', 'manual'].map(value => ({ value, checked: value === 'pdf' }));
  const panes = ['pdf', 'manual'].map(value => ({
    dataset: { supplementalSourcePane: value },
    hidden: value !== 'pdf'
  }));
  const root = {
    querySelectorAll(selector) {
      if (selector === '[data-supplemental-source-pane]') return panes;
      if (selector === 'input[name="supplementalFigureSourceMode"]') return radios;
      return [];
    }
  };
  const retainedFile = { name: 'figure-s1.png' };
  const retainedCaption = 'Figure S1. Replication.';
  tools.syncSourceMode(root, 'manual');
  assert.deepEqual(panes.filter(pane => !pane.hidden).map(pane => pane.dataset.supplementalSourcePane), ['manual']);
  assert.equal(radios.filter(radio => radio.checked)[0].value, 'manual');
  assert.equal(retainedFile.name, 'figure-s1.png');
  assert.equal(retainedCaption, 'Figure S1. Replication.');
});

test('supplemental Figure import rejects mismatched files, empty captions, and zero-size decodes', async () => {
  const tools = loadSupplementalFigureImportTools({
    createImageBitmapImpl: async () => ({ width: 0, height: 100, close() {} })
  });
  assert.throws(
    () => tools.validateImageFile({ name: 'figure-s1.png', type: 'image/jpeg', size: 200 }),
    error => error?.code === 'SUPPLEMENTAL_IMAGE_INVALID' &&
      error.fieldId === 'supplementalFigureImageFile'
  );
  assert.throws(
    () => tools.normalizeCaption('   '),
    error => error?.code === 'SUPPLEMENTAL_CAPTION_EMPTY' &&
      error.fieldId === 'supplementalFigureImageCaption'
  );
  assert.throws(
    () => tools.validateManualInput(null, '   '),
    error => error?.code === 'SUPPLEMENTAL_MANUAL_INPUT_REQUIRED'
  );
  assert.deepEqual(
    tools.validateManualInput(null, 'Figure S1. (A) control.'),
    { file: null, caption: 'Figure S1. (A) control.' }
  );
  await assert.rejects(
    () => tools.prepareTransientImage({
      name: 'figure-s1.png',
      type: 'image/png',
      size: 4,
      arrayBuffer: async () => Uint8Array.of(1, 2, 3, 4).buffer
    }),
    error => error?.code === 'SUPPLEMENTAL_IMAGE_DECODE'
  );
});

test('supplemental Figure accepts a clipboard image as a normal upload file', () => {
  const tools = loadSupplementalFigureImportTools();
  class FakeFile {
    constructor(parts, name, options) {
      this.parts = parts;
      this.name = name;
      this.type = options.type;
      this.size = 4;
    }
  }
  const pasted = tools.clipboardImageFile({
    items: [{
      kind: 'file',
      type: 'image/png',
      getAsFile: () => ({ type: 'image/png', size: 4, name: '' })
    }]
  }, FakeFile);
  assert.match(pasted.name, /^clipboard-\d+\.png$/);
  assert.equal(pasted.type, 'image/png');
});

test('supplemental import targets normalize production bare document hashes', () => {
  const tools = loadSupplementalFigureImportTools();
  const target = tools.validateTarget({
    workspaceId: `workspace:${'a'.repeat(64)}`,
    workspaceGeneration: 2,
    targetArticleTabId: 42,
    canonicalUrl: 'https://journal.example/paper',
    documentHash: 'B'.repeat(64)
  });
  assert.equal(target.documentHash, `sha256:${'b'.repeat(64)}`);
});

test('supplemental import binds to the workspace identity instead of a prepared-document hash', () => {
  const tools = loadSupplementalFigureImportTools();
  const target = tools.buildTarget({
    url: 'https://journal.example/visible-reader-url',
    documentHash: 'c'.repeat(64),
    localWorkspace: {
      workspaceId: `workspace:${'a'.repeat(64)}`,
      workspaceGeneration: 4,
      canonicalUrl: 'https://journal.example/canonical-paper',
      contentHash: 'b'.repeat(64)
    }
  }, 42, 'd'.repeat(64));

  assert.equal(target.canonicalUrl, 'https://journal.example/canonical-paper');
  assert.equal(target.documentHash, `sha256:${'b'.repeat(64)}`);
  assert.equal(target.workspaceGeneration, 4);
  assert.equal(target.targetArticleTabId, 42);
});

test('supplemental image import hashes the original file but sends only the bounded transient image shape', async () => {
  const sent = [];
  const runtimeMessages = [];
  let closed = false;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
    toBlob(callback, mediaType) {
      callback(new Blob([Uint8Array.of(1, 2, 3)], { type: mediaType }));
    }
  };
  const tools = loadSupplementalFigureImportTools({
    chromeApi: {
      runtime: {
        sendMessage: async message => {
          runtimeMessages.push(message);
          return { success: true };
        }
      }
    },
    sendTabMessageWithRecovery: async (_chrome, tabId, message) => {
      sent.push({ tabId, message });
      if (closed) {
        throw Object.assign(new Error('target disappeared'), { code: 'TAB_NOT_FOUND' });
      }
      return { success: true };
    },
    createImageBitmapImpl: async () => ({ width: 3200, height: 1600, close() {} }),
    createCanvas: () => canvas
  });
  const target = tools.validateTarget({
    workspaceId: `workspace:${'a'.repeat(64)}`,
    workspaceGeneration: 3,
    targetArticleTabId: 42,
    canonicalUrl: 'https://journal.example/paper',
    documentHash: `sha256:${'b'.repeat(64)}`
  });
  const file = {
    name: 'figure-s1.png',
    type: 'image/png',
    size: 4,
    arrayBuffer: async () => Uint8Array.of(9, 8, 7, 6).buffer
  };
  const prepared = await tools.prepareTransientImage(file);
  assert.equal(Math.max(prepared.width, prepared.height), 1600);
  assert.match(prepared.sourceFingerprint, /^sha256:[a-f0-9]{64}$/);
  const request = tools.createImageImport(
    file,
    prepared,
    '  Figure S1. (A) Replication.  '
  );
  assert.equal(request.draft.figures[0].caption, 'Figure S1. (A) Replication.');
  await tools.deliverImport(target, {
    ...request,
    originalFile: file,
    extra: 'must-not-cross-boundary'
  });
  assert.equal(sent[0].tabId, 42);
  assert.deepEqual(Object.keys(sent[0].message).sort(), [
    'action', 'draft', 'target', 'transientImage'
  ]);
  assert.deepEqual(Object.keys(sent[0].message.transientImage).sort(), [
    'dataUrl', 'height', 'mediaType', 'sourceFingerprint', 'width'
  ]);
  assert.equal(sent[0].message.transientImage.dataUrl, 'data:image/png;base64,AQID');
  assert.equal(JSON.stringify(sent[0].message).includes('originalFile'), false);
  assert.equal(JSON.stringify(sent[0].message).includes('must-not-cross-boundary'), false);
  closed = true;
  await tools.deliverImport(target, request);
  assert.equal(runtimeMessages.length, 1);
  assert.deepEqual(Object.keys(runtimeMessages[0]).sort(), [
    'draft', 'target', 'transientImage', 'type'
  ]);
  assert.deepEqual(runtimeMessages[0].transientImage, sent[0].message.transientImage);
  assert.deepEqual(Object.keys(runtimeMessages[0].transientImage).sort(), [
    'dataUrl', 'height', 'mediaType', 'sourceFingerprint', 'width'
  ]);
  assert.equal(JSON.stringify(runtimeMessages[0]).includes('originalFile'), false);
});

test('supplemental caption delivery targets the captured article tab and falls back to a workspace draft only when closed', async () => {
  const runtimeMessages = [];
  const tabMessages = [];
  let closed = false;
  const tools = loadSupplementalFigureImportTools({
    chromeApi: {
      runtime: {
        sendMessage: async message => {
          runtimeMessages.push(message);
          return { success: true };
        }
      }
    },
    sendTabMessageWithRecovery: async (_chrome, tabId, message) => {
      tabMessages.push({ tabId, message });
      if (closed) throw new Error(`No tab with id: ${tabId}.`);
      return { success: true };
    }
  });
  const target = tools.validateTarget({
    workspaceId: `workspace:${'c'.repeat(64)}`,
    workspaceGeneration: 7,
    targetArticleTabId: 77,
    canonicalUrl: 'https://journal.example/article'
  });
  const request = { draft: { materialId: 'manual-caption-test', sourceMode: 'caption' } };
  await tools.deliverImport(target, request);
  assert.equal(tabMessages[0].tabId, 77);
  closed = true;
  await tools.deliverImport(target, request);
  assert.equal(runtimeMessages.length, 1);
  assert.equal(runtimeMessages[0].type, 'ARTICLE_WORKSPACE_SAVE_SUPPLEMENTAL_DRAFT');
  assert.deepEqual(runtimeMessages[0].target, target);
  assert.deepEqual(Object.keys(runtimeMessages[0]).sort(), ['draft', 'target', 'type']);
});

test('supplemental import rejects explicit failure responses from live and closed-tab routes', async () => {
  const target = {
    workspaceId: `workspace:${'d'.repeat(64)}`,
    workspaceGeneration: 4,
    targetArticleTabId: 88,
    canonicalUrl: 'https://journal.example/failure'
  };
  const draft = { materialId: 'manual-caption-failure', sourceMode: 'caption' };
  const liveFailure = loadSupplementalFigureImportTools({
    chromeApi: { runtime: { sendMessage: async () => ({ success: true }) } },
    sendTabMessageWithRecovery: async () => ({
      success: false,
      code: 'SUPPLEMENTAL_TARGET_MISMATCH',
      error: 'target changed'
    })
  });
  await assert.rejects(
    () => liveFailure.deliverImport(target, { draft }),
    error => error?.code === 'SUPPLEMENTAL_TARGET_MISMATCH'
  );

  const fallbackFailure = loadSupplementalFigureImportTools({
    chromeApi: {
      runtime: {
        sendMessage: async () => ({ success: false, error: 'save rejected' })
      }
    },
    sendTabMessageWithRecovery: async () => {
      throw Object.assign(new Error('gone'), { code: 'TAB_NOT_FOUND' });
    }
  });
  await assert.rejects(
    () => fallbackFailure.deliverImport(target, { draft }),
    error => error?.code === 'SUPPLEMENTAL_DRAFT_SAVE_FAILED'
  );
});

test('supplemental PDF opening consumes the validated target tuple without active-tab fallback', async () => {
  const script = read('popup.js');
  const start = script.indexOf('async function openSupplementalMaterialPdf');
  const end = script.indexOf('let supplementalFigureImportTarget', start);
  const source = script.slice(start, end);
  assert.match(source, /openSupplementalMaterialPdf\(material, target\)/);
  assert.match(source, /validateTarget\(target\)/);
  assert.match(source, /target\.targetArticleTabId/);
  assert.match(source, /已在新标签页打开/);
  assert.doesNotMatch(source, /指定论文标签页/);
  assert.doesNotMatch(source, /activePanelTabContext|currentWorkspaceSnapshot|chrome\.tabs\.query/);
  const created = [];
  const bindings = [];
  const target = {
    workspaceId: `workspace:${'e'.repeat(64)}`,
    workspaceGeneration: 2,
    targetArticleTabId: 55,
    canonicalUrl: 'https://journal.example/paper',
    documentHash: `sha256:${'f'.repeat(64)}`
  };
  const openPdf = new Function(
    'supplementalFigureImportTools', 'SciLLM', 'chrome', 'showStatus',
    `${source}\nreturn openSupplementalMaterialPdf;`
  )(
    { validateTarget: value => ({ ...value }) },
    {
      createSupplementalPdfReaderUrl: (_getUrl, binding) => {
        bindings.push(binding);
        return 'chrome-extension://test/pdf-reader.html';
      },
      markTabActivated: async () => {}
    },
    {
      runtime: { getURL: value => `chrome-extension://test/${value}` },
      storage: { session: {} },
      tabs: {
        get: async () => assert.fail('must not inspect or reuse the paper tab'),
        update: async () => assert.fail('must not overwrite the paper tab'),
        create: async options => {
          created.push(options);
          return { id: 99, ...options };
        }
      }
    },
    () => {}
  );
  await openPdf({ materialId: 'supplement-s1', title: 'Supplement S1', url: '' }, target);
  assert.deepEqual(created, [{
    url: 'chrome-extension://test/pdf-reader.html',
    active: true
  }]);
  assert.deepEqual(bindings[0], {
    sourceUrl: '',
    title: 'Supplement S1',
    materialId: 'supplement-s1',
    parentWorkspaceId: target.workspaceId,
    parentWorkspaceGeneration: 2,
    parentCanonicalUrl: target.canonicalUrl,
    parentDocumentHash: target.documentHash,
    parentTabId: 55
  });
});
