const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('loads category metadata and article extraction before the content script', () => {
  const messenger = read('core/tab-messenger.js');
  const expected = [
    'core/category-store.js',
    'core/confidence-policy.js',
    'core/sentence-boundary.js',
    'core/publisher-adapters.js',
    'core/article-structure.js',
    'core/article-extractor.js',
    'core/publisher-diagnostics.js',
    'core/highlight-distribution.js',
    'core/figure-extractor.js',
    'core/figure-analysis.js',
    'core/manual-annotations.js',
    'content.js'
  ];
  expected.forEach(file => assert.match(messenger, new RegExp(file.replace(/[./]/g, '\\$&'))));
});

test('content exposes serializable side-panel workspace snapshots and source focus actions', () => {
  const script = read('content.js');
  for (const action of [
    'getArticleWorkspaceSnapshot',
    'focusArticleWorkspaceSource',
    'getFigureWorkspaceSnapshot'
  ]) assert.match(script, new RegExp(`request\\.action === '${action}'`));
  assert.match(script, /function buildArticleWorkspaceSnapshot\(/);
  assert.match(script, /function serializeArticleWorkspaceNode\(/);
  assert.match(script, /highlightDistribution/);
  assert.match(script, /lastReviewOutline/);
  assert.match(script, /lastLlmAnalysis\?\.rawAnalysis\?\.ledger/);
  assert.match(script, /figureWalkthroughState/);
});

test('content script exposes full-document LLM analysis and local highlighting', () => {
  const script = read('content.js');
  const css = read('content.css');
  assert.match(script, /analyzeArticleWithLLM/);
  assert.match(script, /LLM_ANALYZE_DOCUMENT/);
  assert.match(script, /applyLlmHighlights/);
  assert.match(script, /applyStoredRegexFallback/);
  assert.match(script, /LLM 分析失败.*自动回退.*正则/);
  assert.match(script, /LLM_RECORD_FEEDBACK/);
  assert.match(script, /showHighlightContextPopover/);
  assert.match(script, /sciLlmParagraphId/);
  assert.match(script, /normalizeTextWithOffsets/);
  assert.match(css, /\.sci-llm-highlight/);
  assert.match(css, /#sci-llm-status/);
  assert.match(css, /#sci-llm-feedback/);
});

test('content script forwards the popup-prepared document identity after re-extraction', () => {
  const script = read('content.js');
  const analyzeStart = script.indexOf('async function analyzeArticleWithLLM');
  const analyzeEnd = script.indexOf('async function analyzeFiguresWithLLM', analyzeStart);
  const analyzeWorkflow = script.slice(analyzeStart, analyzeEnd);
  assert.match(analyzeWorkflow, /documentId:\s*options\.documentId/);
  assert.match(analyzeWorkflow, /previousDocumentHash:\s*options\.documentHash/);

  const outlineStart = script.indexOf('async function analyzeReviewOutlineWithLLM');
  const outlineEnd = script.indexOf('async function maybeAutoAnalyzeWithLLM', outlineStart);
  const outlineWorkflow = script.slice(outlineStart, outlineEnd);
  assert.match(outlineWorkflow, /documentId:\s*options\.documentId/);
  assert.match(outlineWorkflow, /previousDocumentHash:\s*options\.documentHash/);
});

test('content script retains extraction and highlight diagnostics for the popup', () => {
  const script = read('content.js');
  assert.match(script, /lastLlmDiagnostics/);
  assert.match(script, /diagnoseArticleExtraction/);
  assert.match(script, /getLlmDiagnostics/);
  assert.match(script, /annotationCount/);
  assert.match(script, /rejectedCount/);
  assert.match(script, /exportPublisherDiagnostic/);
  assert.match(script, /downloadPublisherDiagnostic/);
});

test('content records bounded extraction traces and exports diagnostics without rerunning extraction', () => {
  const script = read('content.js');
  assert.match(script, /createExtractionTraceRecorder/);
  assert.match(script, /function extractArticleWithTrace\(/);
  assert.match(script, /function diagnoseArticleWithTrace\(/);
  assert.match(script, /request\.action === 'buildAdapterDiagnosticBundle'/);
  const start = script.indexOf("request.action === 'buildAdapterDiagnosticBundle'");
  const end = script.indexOf("request.action === 'exportPublisherDiagnostic'", start);
  const handler = script.slice(start, end);
  assert.match(handler, /buildAdapterDiagnosticBundle/);
  assert.match(handler, /extractionTrace\.snapshot\(\)/);
  assert.doesNotMatch(handler, /extractArticleWithTrace|diagnoseArticleWithTrace|SciLLM\.extractArticle/);
});

test('one canonical snapshot is reused by navigation, chat, archive, and paragraph counts', () => {
  const script = read('content.js');
  const extractor = read('core/article-extractor.js');
  assert.match(script, /canonicalArticleSnapshotCache/);
  assert.match(script, /function getCanonicalArticleSnapshot\(/);
  assert.match(script, /documentHash[\s\S]*revision/);
  assert.match(script, /buildArticleStructureFromRecords/);
  assert.match(script, /canonicalArticleSnapshotCache\s*=\s*\{[\s\S]*?snapshot/);
  assert.match(script, /bodyParagraphCount/);
  assert.match(script, /archiveParagraphCount/);
  assert.match(script, /chatParagraphCount/);
  assert.match(extractor, /function buildArticleStructureFromRecords/);
});

test('dynamic article structure refresh observes prose containers used outside p tags', () => {
  const script = read('content.js');
  const start = script.indexOf('function isArticleStructureMutation(');
  const end = script.indexOf('function startArticleStructureObserver', start);
  const observer = script.slice(start, end);
  assert.match(observer, /blockquote,dd/);
  assert.match(observer, /div\[class\*="paragraph" i\]/);
  assert.match(observer, /div\[class\*="para" i\]/);
  assert.match(observer, /adapter\?\.paragraphSelectors/);
  assert.match(script, /type:\s*'ARTICLE_STRUCTURE_CHANGED'/);
  assert.match(script, /if \(!articleStructureObserver\) startArticleStructureObserver\(\)/);
});

test('workspace paragraph resolution retries one forced structure refresh for stale navigation', () => {
  const script = read('content.js');
  assert.match(script, /function resolveWorkspaceParagraph\(/);
  const start = script.indexOf('function resolveWorkspaceParagraph(');
  const end = script.indexOf('function focusArticleWorkspaceSource', start);
  const resolver = script.slice(start, end);
  assert.match(resolver, /SciLLM\.resolveArticleStructureParagraph/);
  assert.match(resolver, /navigationRevision/);
  assert.match(resolver, /extractCurrentArticleStructure\(\{\s*forceRefresh:\s*true\s*\}\)/);
  assert.match(script, /const paragraph = resolveWorkspaceParagraph\(target\)/);
});

test('article citation jumps reverify canonical evidence after a document revision change', () => {
  const script = read('content.js');
  const messenger = read('core/tab-messenger.js');
  assert.match(messenger, /core\/article-chat-citations\.js/);
  assert.match(script, /textHash:\s*String\(paragraph\.textHash/);
  assert.match(script, /sectionPath:/);
  const start = script.indexOf('function verifyAndFocusArticleChatCitation');
  const end = script.indexOf('function focusArticleWorkspaceSource', start);
  const workflow = script.slice(start, end);
  assert.match(workflow, /getCanonicalArticleSnapshot/);
  assert.match(workflow, /forceRefresh:\s*true/);
  assert.match(workflow, /SciLLM\.verifyArticleChatEvidence/);
  assert.match(workflow, /DOCUMENT_REVISION_CHANGED|revisionChanged/);
  assert.match(script, /citationResult/);
});

test('single paragraph analysis sends current navigation records but scopes the requested paragraph', () => {
  const script = read('content.js');
  assert.match(script, /async function analyzeReviewParagraphWithLLM\(/);
  assert.match(script, /SciLLM\.toReviewParagraphRecords\(structure\)/);
  assert.match(script, /preparedParagraphs:\s*preparedParagraphs/);
  assert.match(script, /scopeParagraphIds:\s*\[paragraphId\]/);
  assert.match(script, /PARAGRAPH_STALE/);
  const start = script.indexOf('async function analyzeReviewOutlineWithLLM');
  const end = script.indexOf('async function maybeAutoAnalyzeWithLLM', start);
  const workflow = script.slice(start, end);
  assert.match(workflow, /options\.preparedParagraphs/);
});

test('paragraph-only outline payload contains scoped text and sends document proof separately', () => {
  const script = read('content.js');
  const start = script.indexOf('async function analyzeReviewOutlineWithLLM');
  const end = script.indexOf('async function maybeAutoAnalyzeWithLLM', start);
  const workflow = script.slice(start, end);
  assert.match(workflow, /const paragraphOnly = requestedParagraphIds\.size === 1/);
  assert.match(workflow, /paragraphs:\s*paragraphOnly \? paragraphs : allParagraphs/);
  assert.match(workflow, /documentProof:\s*\{/);
  assert.match(workflow, /documentHash:\s*options\.documentHash/);
});

test('content script persists safe LLM failure diagnostics across regex fallback', () => {
  const script = read('content.js');
  assert.match(script, /dataset\.sciLlmContentRevision/);
  assert.match(script, /2\.3\.0-panel-chat-r3/);
  assert.match(script, /dataset\.sciLlmBackgroundRevision/);
  assert.match(script, /errorMessage:\s*error\.message/);
  assert.match(script, /dataset\.sciLlmErrorCode/);
  assert.match(script, /dataset\.sciLlmErrorMessage/);
  assert.match(script, /dataset\.sciLlmDiagnosticType/);
  assert.match(script, /dataset\.sciLlmDiagnosticMessage/);
  assert.match(script, /dataset\.sciLlmDiagnosticStage/);
  assert.match(script, /dataset\.sciLlmDiagnosticRequestBytes/);
  assert.match(script, /dataset\.sciLlmDiagnosticElapsedMs/);
  assert.match(script, /dataset\.sciLlmHttpStatus/);
  assert.match(script, /dataset\.sciLlmRetryAfterMs/);
  assert.match(script, /response\?\.error\?\.diagnosticMessage/);
  assert.match(script, /response\?\.error\?\.diagnosticStage/);
  assert.match(script, /response\?\.error\?\.runtimeRevision/);
  assert.match(script, /setLlmErrorDiagnostics\(error\)/);
});

test('content script explains retry waits and adaptive chunk splitting', () => {
  const script = read('content.js');
  assert.match(script, /progress\.waitMs/);
  assert.match(script, /progress\.phase === 'split'/);
  assert.match(script, /progress\.errorCode === 'REQUEST_TIMEOUT'/);
  assert.match(script, /progress\.errorCode === 'PROVIDER_UNAVAILABLE'/);
  assert.match(script, /progress\.errorCode === 'OUTPUT_TRUNCATED'/);
  assert.match(script, /后自动重试/);
  assert.match(script, /自动拆分/);
});

test('validated highlight chunks are rendered progressively before the final document response', () => {
  const script = read('content.js');
  const router = read('core/background-router.js');
  const pipeline = read('core/analysis-pipeline.js');
  assert.match(script, /let llmProgressiveAnalysis = null/);
  assert.match(script, /function renderProgressiveLlmChunk\(/);
  assert.match(script, /renderProgressiveLlmChunk\(progress\)/);
  assert.match(script, /SciLLM\.mergeAnnotations/);
  assert.match(script, /chunk_checkpoint/);
  assert.match(router, /checkpointAnnotations:\s*Array\.isArray\(completed\.annotations\)/);
  assert.match(pipeline, /await serializeCheckpoint\(completed\)/);
});

test('content presents only public effective-route metadata and token recovery states', () => {
  const script = read('content.js');
  assert.match(script, /function formatEffectiveRoute\(status, route\)/);
  assert.match(script, /effectiveProfileName/);
  assert.match(script, /已回退到/);
  assert.match(script, /使用 \$\{target\}/);
  ['token_limit_retry', 'output_token_retry', 'output_compact_retry']
    .forEach(phase => assert.match(script, new RegExp(`progress\\.phase === '${phase}'`)));
  assert.doesNotMatch(script.slice(script.indexOf('function formatEffectiveRoute'),
    script.indexOf('function setLlmErrorDiagnostics')), /apiKey|customHeaders|authorization/i);
});

test('content script reapplies cached raw annotations when threshold changes', () => {
  const script = read('content.js');
  assert.match(script, /lastLlmAnalysis/);
  assert.match(script, /filterAnnotationGroupsByConfidence/);
  assert.match(script, /applyLlmConfidenceThreshold/);
  assert.match(script, /hiddenConfidenceCount/);
});

test('sentence mode highlights across inline DOM nodes using scientific boundaries', () => {
  const script = read('content.js');
  assert.match(script, /applySentenceHighlights/);
  assert.match(script, /findScientificSentenceBounds/);
  assert.match(script, /closest\(['"]p,/);
});
