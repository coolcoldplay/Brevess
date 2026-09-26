const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('navigation separates paragraph jumps from compact summaries and scopes analysis by section', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const css = read('popup.css');
  assert.match(content, /DEFAULT_ANALYSIS_SECTION_KINDS/);
  assert.match(content, /'abstract', 'main', 'introduction', 'results', 'discussion', 'conclusion'/);
  assert.match(content, /setArticleAnalysisSectionSelection/);
  assert.match(content, /selectedArticleAnalysisParagraphIds/);
  assert.match(popup, /workspace-section-analysis-toggle/);
  assert.match(popup, /workspace-paragraph-jump/);
  assert.match(popup, /workspace-paragraph-summary-action/);
  assert.match(popup, /'概述'/);
  assert.match(css, /\.workspace-paragraph-row/);
  assert.match(
    css,
    /\.workspace-view\[data-workspace-view="navigation"\] \.workspace-outline-toolbar\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0/s
  );
  assert.match(
    css,
    /\.workspace-view\[data-workspace-view="navigation"\]\s*\{\s*padding-top:\s*0;/
  );
  assert.doesNotMatch(popup, /navigationButton\.disabled = reviewOutlineState\.running/);
  assert.doesNotMatch(read('popup.html'), /id="generateOutlineSummaries"/);
  assert.doesNotMatch(popup, /navigationButton\.disabled = !ready/);
  assert.match(popup, /function selectedWorkspaceAnalysisSectionIds/);
  assert.match(popup, /scopeSectionIds:\s*selectedWorkspaceAnalysisSectionIds\(\)/);
  assert.match(content, /scopeSelectionProvided:\s*request\.scopeSelectionProvided === true/);
});

test('content workflow requests and tracks one review outline job', () => {
  const script = read('content.js');
  assert.match(script, /let reviewOutlinePromise\s*=\s*null/);
  assert.match(script, /reviewOutlineStatus/);
  assert.match(script, /async function analyzeReviewOutlineWithLLM/);
  assert.match(script, /LLM_ANALYZE_REVIEW_OUTLINE/);
  assert.match(script, /getReviewOutlineStatus/);
});

test('content workflow filters non-body outline units and reports the exclusion count', () => {
  const script = read('content.js');
  const start = script.indexOf('async function analyzeReviewOutlineWithLLM');
  const workflow = script.slice(start, script.indexOf('async function maybeAutoAnalyzeWithLLM', start));
  assert.match(workflow, /prepareReviewOutlineParagraphs/);
  assert.match(workflow, /excludedOutlineUnitCount/);
  assert.match(workflow, /outlineSectionCount/);
  assert.match(workflow, /锁定.*正文章节/);
  assert.match(workflow, /已排除.*非正文/);
});

test('side panel requests exactly one paragraph and exposes its cached summary', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  assert.match(content, /request\.action === 'analyzeReviewParagraphWithLLM'/);
  assert.match(content, /scopeParagraphIds:\s*\[paragraphId\]/);
  assert.match(content, /standaloneReviewParagraphSummaries/);
  assert.match(content, /paragraphSummaries:/);
  assert.match(popup, /function runSingleParagraphSummary\(/);
  assert.match(popup, /action:\s*'analyzeReviewParagraphWithLLM'/);
  assert.match(popup, /workspaceParagraphSummaryState/);
  assert.match(popup, /workspaceParagraphsForNode/);
});

test('single paragraph summary falls back to the durable workspace document proof', () => {
  const popup = read('popup.js');
  const start = popup.indexOf('async function runSingleParagraphSummary');
  const end = popup.indexOf('function renderArticleNavigationTree', start);
  const workflow = popup.slice(start, end);
  assert.match(workflow,
    /preparedDocumentState\?\.documentId\s*\|\|\s*manualAnnotationState\?\.documentId/);
  assert.match(workflow,
    /preparedDocumentState\?\.documentHash\s*\|\|\s*manualAnnotationState\?\.documentHash/);
});

test('every navigation paragraph click only focuses the current source; summaries stay explicit', () => {
  const popup = read('popup.js');
  assert.match(popup, /PARAGRAPH_STALE/);
  const treeStart = popup.indexOf('function renderArticleNavigationTree');
  const paragraphStart = popup.indexOf("const paragraphId = String(paragraph.paragraphId || '');", treeStart);
  const start = popup.indexOf("button.addEventListener('click', async event => {", paragraphStart);
  const end = popup.indexOf('const summarize = createWorkspaceElement(', start);
  assert.ok(treeStart >= 0 && paragraphStart > treeStart && start > paragraphStart && end > start);
  const click = popup.slice(start, end);
  assert.match(click, /await focusWorkspaceSource\(\{/);
  assert.match(click, /paragraphId,\s*sourceKey:\s*paragraph\.sourceKey,\s*navigationRevision:/);
  assert.match(click, /isCurrentParagraphSummaryTask\(panelContext\)/);
  assert.match(click, /event\.stopImmediatePropagation\(\)/);
  assert.match(click, /capture: true/);
  assert.doesNotMatch(click, /runSingleParagraphSummary|hasUsableLlm/);
  const summaryEnd = popup.indexOf('const note = createWorkspaceElement(', end);
  assert.ok(summaryEnd > end);
  assert.match(popup.slice(end, summaryEnd), /runSingleParagraphSummary\(paragraph, panelContext\)/);
});

test('review and paragraph tasks capture and guard one panel context across awaits', () => {
  const popup = read('popup.js');
  assert.match(popup, /capturePanelContext\(/);
  assert.match(popup, /isCurrentPanelContext\(/);
  assert.match(popup, /let reviewOutlineTaskGeneration\s*=\s*0/);
  assert.match(popup, /let paragraphSummaryTaskGeneration\s*=\s*0/);
  const resetStart = popup.indexOf('function resetPanelArticleState');
  const resetEnd = popup.indexOf('function isCurrentFigureTask', resetStart);
  const reset = popup.slice(resetStart, resetEnd);
  assert.match(reset, /reviewOutlineTaskGeneration \+= 1/);
  assert.match(reset, /paragraphSummaryTaskGeneration \+= 1/);
  const reviewStart = popup.indexOf('async function runReviewOutlineAnalysis');
  const reviewEnd = popup.indexOf('function renderManualAnnotationSummary', reviewStart);
  const review = popup.slice(reviewStart, reviewEnd);
  assert.match(review, /const panelContext = capturePanelContext\(reviewOutlineTaskGeneration\)/);
  assert.match(review, /sendTabMessage\(panelContext\.tabId/);
  assert.match(review, /isCurrentReviewOutlineTask\(panelContext\)/);
  const paragraphStart = popup.indexOf('async function runSingleParagraphSummary');
  const paragraphEnd = popup.indexOf('function renderArticleNavigationTree', paragraphStart);
  const paragraph = popup.slice(paragraphStart, paragraphEnd);
  assert.match(paragraph, /capturePanelContext\(paragraphSummaryTaskGeneration\)/);
  assert.match(paragraph, /sendTabMessage\(panelContext\.tabId/);
  assert.match(paragraph, /isCurrentParagraphSummaryTask\(panelContext\)/);
});

test('outline panel renders nested details with three depth modes and textContent only', () => {
  const script = read('content.js');
  const start = script.indexOf('function renderReviewOutlinePanel');
  const end = script.indexOf('async function analyzeReviewOutlineWithLLM', start);
  const renderer = script.slice(start, end);
  assert.match(renderer, /createElement\('details'\)/);
  assert.match(renderer, /major/);
  assert.match(renderer, /all_sections/);
  assert.match(renderer, /paragraphs/);
  assert.match(renderer, /textContent/);
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML|outerHTML/);
});

test('paragraph outline items scroll to extracted source paragraphs', () => {
  const script = read('content.js');
  assert.match(script, /data-sci-llm-paragraph-id/);
  assert.match(script, /scrollIntoView/);
  assert.match(script, /sci-review-source-focus/);
});

test('reduce failure remains visible without hiding paragraph summaries', () => {
  const script = read('content.js');
  const css = read('content.css');
  assert.match(script, /globalSynthesisAvailable/);
  assert.match(script, /全局组织综合暂不可用/);
  assert.match(script, /sci-review-outline-paragraph/);
  assert.match(script, /function setReviewOutlineDepth/);
  assert.match(css, /#sci-review-outline-panel/);
  assert.match(css, /\.sci-review-outline-node/);
  assert.match(css, /\.sci-review-outline-paragraph/);
});

test('invalid model output is shown as automatic correction rather than generic busy status', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  assert.match(content, /errorCode\s*===\s*'INVALID_RESPONSE'/);
  assert.match(content, /格式不符合要求，正在自动纠正/);
  assert.match(content, /格式仍不稳定，已自动拆小/);
  assert.match(popup, /review_retry/);
  assert.match(popup, /review_split/);
  assert.match(popup, /reviewOutlineState\.message/);
});

test('outline tree is isolated from publisher details and summary styles', () => {
  const script = read('content.js');
  const css = read('content.css');
  const start = script.indexOf('function renderReviewOutlinePanel');
  const end = script.indexOf('async function analyzeReviewOutlineWithLLM', start);
  const renderer = script.slice(start, end);
  assert.match(renderer, /sci-review-outline-host/);
  assert.match(renderer, /attachShadow\(\{\s*mode:\s*'open'\s*\}\)/);
  assert.match(renderer, /chrome\.runtime\.getURL\('content\.css'\)/);
  assert.match(css, /\.sci-review-outline-node\s*>\s*summary::after[^{]*\{[^}]*content:\s*none\s*!important/s);
  assert.match(css, /grid-template-columns:\s*18px\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});

test('outline translates machine role ids before rendering compact role labels', () => {
  const script = read('content.js');
  assert.match(script, /REVIEW_ROLE_LABELS/);
  assert.match(script, /article_meta:\s*'文章信息'/);
  assert.match(script, /evidence_support:\s*'证据支持'/);
  assert.match(script, /formatReviewRole\(node\.sectionRole\)/);
  assert.match(script, /formatReviewRole\(paragraph\.rhetoricalRole/);
});

test('article navigator opens a local HTML tree without requiring an LLM job', () => {
  const script = read('content.js');
  assert.match(script, /let currentArticleStructure\s*=\s*null/);
  assert.match(script, /function extractCurrentArticleStructure/);
  assert.match(script, /SciLLM\.extractArticleStructure\(document/);
  assert.match(script, /function renderArticleNavigator/);
  assert.match(script, /结构大纲/);
  assert.match(script, /高亮分布/);
  assert.match(script, /主章节/);
  assert.match(script, /全部标题/);
  assert.match(script, /显示摘要/);
  assert.match(script, /request\.action === 'showArticleNavigator'/);
});

test('article navigator labels publisher security challenges instead of showing an empty article', () => {
  const script = read('content.js');
  const css = read('content.css');
  assert.match(script, /NON_ARTICLE_CHALLENGE/);
  assert.match(script, /challengeBlocked/);
  assert.match(script, /blocked:\s*challengeBlocked/);
  assert.match(css, /\.sci-article-status-warning/);
});

test('article navigator observes only while open and reconciles incremental DOM updates', () => {
  const script = read('content.js');
  assert.match(script, /let articleStructureObserver\s*=\s*null/);
  assert.match(script, /new MutationObserver/);
  assert.match(script, /SciLLM\.reconcileArticleStructure/);
  assert.match(script, /function startArticleStructureObserver/);
  assert.match(script, /function stopArticleStructureObserver/);
  assert.match(script, /close\.addEventListener\('click',[\s\S]*stopArticleStructureObserver/s);
});

test('tree disclosure and source jump are separate controls', () => {
  const script = read('content.js');
  assert.match(script, /sci-article-node-toggle/);
  assert.match(script, /sci-article-node-jump/);
  assert.match(script, /focusArticleSource/);
  assert.match(script, /scrollIntoView/);
  assert.match(script, /sci-article-source-focus/);
});

test('highlight distribution renders a clickable section by category matrix', () => {
  const script = read('content.js');
  const css = read('content.css');
  assert.match(script, /SciLLM\.buildHighlightDistribution/);
  assert.match(script, /collectPageHighlightOccurrences/);
  assert.match(script, /sci-highlight-matrix/);
  assert.match(script, /focusHighlightOccurrence/);
  assert.match(css, /\.sci-highlight-matrix/);
  assert.match(css, /\.sci-highlight-matrix-cell/);
});
