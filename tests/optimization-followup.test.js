const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('batch Figure reading is ordered, includes supplements, and skips completed depth', () => {
  const source = read('content.js');
  const start = source.indexOf('async function analyzeFiguresWithLLM(options = {})');
  const end = source.indexOf('\nfunction setReviewOutlineDepth', start);
  const batch = source.slice(start, end);
  assert.match(batch, /getImportedSupplementalFigureInventory\(\)/);
  assert.match(batch, /\.\.\.visibleMainFigures,\s*\.\.\.supplementalFigures/);
  assert.match(batch, /manualMainLabels/);
  assert.match(batch, /parallelBatch:\s*false/);
  assert.match(batch, /await runFigureWorker\(0\)/);
  assert.match(batch, /skippedExisting:\s*true/);
  assert.match(batch, /skippedCount:\s*skippedFigures/);
  assert.doesNotMatch(batch, /workerCount|Promise\.allSettled/);
});

test('original-image navigation and quick ticks distinguish supplemental Figures', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const css = read('popup.css');
  assert.match(content, /function getFigureViewerInventory\(\)[\s\S]*getImportedSupplementalFigureInventory/);
  assert.match(content, /function adjacentFigureViewerId[\s\S]*getFigureViewerInventory\(\)/);
  assert.match(popup, /figureKind = figure\.isSupplemental === true \? 'supplemental' : 'main'/);
  assert.match(popup, /classList\.toggle\('is-supplemental'/);
  assert.match(css, /\.figure-quick-nav-item\.is-supplemental \.figure-quick-nav-tick/);
});

test('workspace snapshots re-save complete supplemental assets and retry transient OneDrive misses', () => {
  const content = read('content.js');
  const sync = read('core/directory-sync.js');
  const start = content.indexOf('function buildArticleWorkspaceAssets()');
  const end = content.indexOf('\nfunction buildArticleWorkspaceBaselineAssets', start);
  const builder = content.slice(start, end);
  assert.match(builder, /supplementalFigureAssets\.forEach/);
  assert.match(builder, /assets\.set\(relativePath, asset\)/);
  assert.match(sync, /'NotFoundError', 'NotReadableError'/);
  assert.match(sync, /attempt < 5/);
});

test('portable encrypted configuration owns MinerU parser settings and token', () => {
  const background = read('background.js');
  const manager = read('core/portable-config-manager.js');
  const options = read('options.html');
  assert.match(background, /mineruSettingsKey:\s*SciLLM\.PDF_MINERU_SETTINGS_KEY/);
  assert.match(manager, /mineruPdfSettings:\s*normalizeMineruSettings/);
  assert.match(manager, /values\[mineruSettingsKey\] = normalized\.mineruPdfSettings/);
  assert.match(options, /MinerU PDF 解析设置与 Token/);
});

test('progressive Panel checkpoints cannot overwrite committed Figure results', () => {
  const content = read('content.js');
  const start = content.indexOf('function applyFigureProgressEvent(progress = {})');
  const end = content.indexOf('\nfunction updateFigureAnalysisStatus', start);
  const progress = content.slice(start, end);
  assert.match(progress, /state\.pendingResults\s*\|\|=/);
  assert.match(progress, /state\.pendingResults\[depth\]/);
  assert.doesNotMatch(progress, /state\[depth\]\s*=/);
  assert.match(content, /pendingStandard:/);
  assert.match(content, /pendingDeep:/);
  assert.match(content, /delete state\.pendingResults\.standard/);
  assert.match(content, /delete state\.pendingResults\[analysisDepth\]/);
});

test('Figure completion requires usable content and the viewer moves shortcuts below the image', () => {
  const content = read('content.js');
  const css = read('content.css');
  const popup = read('popup.js');
  const html = read('popup.html');
  const viewerStart = content.indexOf('async function showFigureImageViewer');
  const viewerEnd = content.indexOf('\nfunction clearFigureWalkthroughs', viewerStart);
  const viewer = content.slice(viewerStart, viewerEnd);
  assert.match(content, /function isCompleteFigureAnalysisResult/);
  assert.match(content, /isUsableFigureAnalysisResult\(result, figure, analysisDepth\)/);
  assert.match(content, /Boolean\(String\(result\.figureQuestion/);
  assert.match(content, /Boolean\(String\(result\.coreConclusion/);
  assert.match(viewer, /title\.textContent = figureViewerDisplayTitle\(figure\)/);
  assert.match(viewer, /header\.append\(title, close\)/);
  assert.match(viewer, /qualityLabel,\s*shortcutHint/);
  assert.match(css, /\.sci-figure-viewer-shortcuts\s*\{[^}]*font-size:\s*10px/s);
  assert.match(popup, /progress\?\.completed === true && !result/);
  assert.match(html, /core\/figure-analysis\.js/);
});

test('Panel summary roles and method labels are localized to Chinese', () => {
  const popup = read('popup.js');
  const figureAnalysis = read('core/figure-analysis.js');
  assert.match(popup, /const PANEL_ROLE_LABELS/);
  assert.match(popup, /model_setup:\s*'模型建立'/);
  assert.match(popup, /manipulation_validation:\s*'操作验证'/);
  assert.match(popup, /SciLLM\.localizeFigureMethodLabel/);
  assert.match(figureAnalysis, /'schematic':\s*'实验示意图'/);
  assert.match(figureAnalysis, /'electrophysiology':\s*'电生理记录'/);
  assert.match(figureAnalysis, /Every descriptive method or chart-type phrase must be written in Chinese/);
});
