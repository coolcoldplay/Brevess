const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('legacy research-map assets remain compatible while mechanism generation is explicit', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const content = read('content.js');

  assert.doesNotMatch(html, /id="createResearchLogicMap"/);
  assert.doesNotMatch(html, /id="createBlankResearchLogicMap"|手动梳理/);
  assert.doesNotMatch(html, /id="analyzeCrossFigureLogic"/);
  assert.doesNotMatch(popup, /getElementById\('createBlankResearchLogicMap'\)/);
  const wiring = popup.slice(
    popup.indexOf('async function runFigureAnalysis'),
    popup.indexOf('async function showFigureOriginalImage')
  );
  assert.doesNotMatch(wiring, /runCrossFigureLogic\(/);
  assert.doesNotMatch(wiring, /chrome\.tabs\.create|openResearchLogicMapEditor/);
  assert.match(content, /async function createArticleLogicMap/);
  assert.match(content, /logicMap = await createArticleLogicMap\(\{ blank: false \}\)/);
  assert.match(content, /logic-maps\/index\.json/);
});

test('research-map editor implements the unified schema-v3 problem-evidence chain', () => {
  const html = read('logic-map.html');
  const js = read('logic-map.js');
  const css = read('logic-map.css');

  assert.match(js, /已知背景/);
  assert.match(js, /科学问题/);
  assert.match(js, /开始着手解决的问题/);
  assert.match(js, /本图证明/);
  assert.match(js, /最终得到的所有结论（对应最初科学问题）/);
  assert.doesNotMatch(html, /logicMapOutlineList|论证目录/);
  assert.doesNotMatch(js, /nextQuestion/);
  assert.match(html, /id="logicMapInspector"[\s\S]*id="logicMapCanvas"/);
  assert.match(html, /id="toggleLogicMapEditor"/);
  assert.match(html, /id="collapseAllLogicMapFigures"/);
  assert.match(html, /机制链/);
  assert.match(html, /id="logicMapMechanismChain"/);
  assert.match(html, /id="toggleLogicMapFullscreen"/);
  assert.match(html, /结论边界/);
  assert.match(js, /questionItems/);
  assert.match(js, /proofItems/);
  assert.match(js, /evidencePoints/);
  assert.match(js, /argumentRole/);
  assert.match(js, /limitation/);
  assert.match(js, /ARTICLE_WORKSPACE_SAVE_ASSET/);
  assert.match(js, /expectedRevision/);
  assert.match(js, /localStorage\.setItem/);
  assert.match(js, /buildResearchLogicMapSvg/);
  assert.match(js, /requestFullscreen/);
  assert.match(css, /\.figure-stage\.is-collapsed[^{]*\.figure-evidence-groups/);
  assert.match(css, /logic-map-focus-mode/);
});

test('scientific-question graph is readable and its relations remain editable', () => {
  const js = read('logic-map.js');
  const chain = js.slice(
    js.indexOf('function appendScientificQuestionGraph'),
    js.indexOf('function locatorLabel')
  );
  const editor = js.slice(
    js.indexOf('function renderScientificEditor'),
    js.indexOf('function renderStepQuestionEditor')
  );
  assert.match(chain, /relationType/);
  assert.match(chain, /parentQuestionIds/);
  assert.match(chain, /supportingFigureIds/);
  assert.match(editor, /relationType/);
  assert.match(editor, /parentQuestionIds/);
  assert.match(editor, /supportingFigureIds/);
  assert.match(editor, /convergent/);
  assert.match(editor, /markObjectEdited/);
});

test('supplemental lane supports manual CRUD, collision-free flow and two centered bezier links', () => {
  const html = read('logic-map.html');
  const js = read('logic-map.js');
  const css = read('logic-map.css');

  for (const type of ['figure', 'video', 'table']) {
    assert.match(html, new RegExp(`data-add-supplemental="${type}"`));
  }
  assert.match(html, /logicMapSupplementalLane/);
  assert.match(html, /logicMapConnectorLayer/);
  assert.match(js, /function addSupplemental/);
  assert.match(js, /function deleteSupplemental/);
  assert.match(js, /function drawBezier/);
  assert.match(js, /from\.top \+ from\.height \/ 2/);
  assert.match(js, /to\.top \+ to\.height \/ 2/);
  assert.match(js, /mode: 'evidence-group'/);
  assert.match(js, /targetGroupId/);
  assert.match(js, /sourceGroupId/);
  assert.match(js, /groupCard\.append\(name, method, pointList, conclusion\)/);
  assert.match(js, /function renderSupplementalGroupEditor[\s\S]*'方法'[\s\S]*'组级局限'/);
  assert.match(js, /needsManualSplit/);
  assert.match(js, /function resetPointLocatorProvenance[\s\S]*point\.sourceRefs = \[\]/);
  assert.match(js, /collapsedSupplementalIds\.includes/);
  assert.match(css, /#logicMapSupplementalLane \{ display: flex; flex-direction: column; gap:/);
  assert.match(css, /\.supplemental-card\.is-collapsed \.supplemental-groups/);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
});

test('mechanism edges use pathway endpoints and audited relation stroke styles', () => {
  const js = read('logic-map.js');
  const css = read('logic-map.css');

  assert.match(js, /edge\.effect === 'inhibit'/);
  assert.match(js, /mechanism-promote-arrow/);
  assert.match(js, /edge\.relationKind === 'correlative' \|\| edge\.effect === 'associate'/);
  assert.match(js, /edge\.lineStyle === 'dashed' \|\| relationKind === 'correlative'/);
  assert.doesNotMatch(js, /edge\.evidence !== 'strong'/);
  assert.match(js, /'stroke-dasharray': dashed \? '10 7' : ''/);
  assert.match(js, /row\.classList\.toggle\('is-contested', contested\)/);
  assert.match(js, /row\.dataset\.lineStyle = dashed \? 'dashed' : 'solid'/);
  assert.match(js, /safeMechanismDisplayLabel/);
  assert.doesNotMatch(js, /refs\.textContent = Array\.isArray\(edge\.supportPanels\)/);
  assert.match(js, /x1: 174, y1: 16, x2: 174, y2: 38/);
  assert.match(js, /row\.append\(sourceNode, connector, targetNode\)/);
  assert.match(css, /\.mechanism-edge-row \{[^}]*grid-template-columns:/s);
  assert.match(css, /\.mechanism-edge-row\.is-contested/);
  assert.doesNotMatch(css, /\.logic-map-mechanism-chain \{[^}]*overflow-x:\s*auto/s);
  assert.match(js, /function synchronizeMechanismChain/);
  assert.match(js, /synchronizeMechanismChain\(\)/);
});

test('Figure workspace mechanism entry replaces the new-tab argument-ladder path', () => {
  const popup = read('popup.js');
  const rendererStart = popup.indexOf('function renderResearchLogicMapSnapshot');
  const rendererEnd = popup.indexOf('function syncFigureQuickNavFromScroll', rendererStart);
  const renderer = popup.slice(rendererStart, rendererEnd);
  assert.match(renderer, /图表梳理/);
  assert.match(renderer, /openMechanismChainWorkspace/);
  assert.doesNotMatch(renderer, /openResearchLogicMapEditor|chrome\.tabs\.create/);
  assert.doesNotMatch(read('popup.html'), /手动梳理|createBlankResearchLogicMap/);
});

test('reachable cross-Figure generation status names only the mechanism chain', () => {
  const popup = read('popup.js');
  const start = popup.indexOf('async function runCrossFigureLogic');
  const end = popup.indexOf('async function runCreateResearchLogicMap', start);
  const run = popup.slice(start, end);
  assert.match(run, /机制链/);
  assert.doesNotMatch(run, /论证阶梯|argument ladder/iu);
});

test('reachable side-panel UI has no old argument-ladder or integration-analysis wording', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  assert.doesNotMatch(html, /论文论证阶梯|论证阶梯|整合分析|手动梳理/);
  assert.doesNotMatch(popup, /论文论证阶梯|论证阶梯|整合分析|手动梳理/);
  assert.doesNotMatch(html, /id="analyzeCrossFigureLogic"/);
});

test('editor preserves conflict drafts and non-adjacent schema-v3 links', () => {
  const js = read('logic-map.js');

  assert.match(js, /if \(draft\?\.map\) \{/);
  assert.match(js, /远端版本已变化；本地草稿仍保留/);
  assert.doesNotMatch(js, /draft\?\.map && draft\.remoteContentHash === assetContentHash/);
  assert.match(js, /const preserved = \(Array\.isArray\(logicMap\.links\)/);
  assert.match(js, /logicMap\.links = preserved/);
  assert.match(js, /clearTimeout\(saveTimer\);[\s\S]*saveTimer = null/);
  assert.match(js, /const sourceTabIdParam = params\.get\('sourceTabId'\)/);
});

test('highlights view no longer renders the evidence ledger above saved excerpts', () => {
  const html = read('popup.html');
  assert.doesNotMatch(html, /id="evidenceLedger"/);
  assert.match(html, /id="highlightDistribution"/);
});

test('workspace router exposes conflict-safe single-asset reads', () => {
  const background = read('background.js');
  const router = read('core/background-router.js');

  assert.match(background, /ARTICLE_WORKSPACE_GET_ASSET/);
  assert.match(router, /message\.type === 'ARTICLE_WORKSPACE_GET_ASSET'/);
  assert.match(router, /ASSET_REVISION_CONFLICT/);
  assert.match(router, /ASSET_HASH_CONFLICT/);
});

test('navigation paragraphs expose persistent token-free manual notes', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const content = read('content.js');

  assert.match(html, /id="paragraphNoteDialog"/);
  assert.match(html, /手动点评 · 不消耗 token/);
  assert.match(popup, /workspace-paragraph-note-action/);
  assert.match(popup, /action: 'updateArticleParagraphNote'/);
  assert.match(content, /annotations\/paragraph-notes\.json/);
  assert.match(content, /async function updateArticleParagraphNote/);
  assert.match(content, /paragraphNotes:/);
});
