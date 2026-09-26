const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('manual and rule highlights share hover details and the category-note editor', () => {
  const script = read('content.js');
  const css = read('content.css');
  assert.match(script, /mark\.addEventListener\('mouseenter'/);
  assert.match(script, /annotation\?\.note/);
  assert.match(script, /ensureAutomaticHighlightAnnotation/);
  assert.match(script, /sourceType: 'regex'/);
  assert.match(script, /showHighlightContextPopover\(manualMark\)/);
  assert.match(css, /\.sci-manual-highlight\.sci-automatic-annotation/);
});

function loadManualUiHelpers() {
  const script = read('content.js');
  const startMarker = '// DOM-independent manual annotation UI helpers: start';
  const endMarker = '// DOM-independent manual annotation UI helpers: end';
  const start = script.indexOf(startMarker);
  const end = script.indexOf(endMarker);
  assert.notEqual(start, -1, 'manual UI helper start marker should exist');
  assert.notEqual(end, -1, 'manual UI helper end marker should exist');
  const context = {};
  vm.runInNewContext(
    `${script.slice(start + startMarker.length, end)}\n` +
      'globalThis.manualUiHelpers = ManualAnnotationUiHelpers;',
    context
  );
  return context.manualUiHelpers;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('manifest loads manual annotation anchors before the content script', () => {
  const { CONTENT_SCRIPT_FILES: scripts } = require('../core/tab-messenger.js');
  const manualIndex = scripts.indexOf('core/manual-annotations.js');
  const contentIndex = scripts.indexOf('content.js');
  assert.ok(manualIndex >= 0, 'manual annotation helpers should be registered');
  assert.ok(manualIndex < contentIndex, 'manual annotation helpers should load before content.js');
});

test('dynamic content injection loads the PDF mutation guard exactly once before manual annotations', () => {
  const { CONTENT_SCRIPT_FILES: scripts } = require('../core/tab-messenger.js');
  const pdfHelper = 'core/pdf-annotations.js';
  const pdfIndexes = scripts.flatMap((file, index) => file === pdfHelper ? [index] : []);
  const manualIndex = scripts.indexOf('core/manual-annotations.js');
  const contentIndex = scripts.indexOf('content.js');

  assert.equal(pdfIndexes.length, 1, 'PDF annotation helpers should be injected exactly once');
  assert.ok(pdfIndexes[0] < manualIndex, 'PDF annotation helpers should load before manual annotations');
  assert.ok(pdfIndexes[0] < contentIndex, 'PDF annotation helpers should load before content.js');
});

test('preparing manual annotations initializes selection listeners exactly once', () => {
  const script = read('content.js');
  const start = script.indexOf("request.action === 'prepareManualAnnotations'");
  const end = script.indexOf("request.action === 'clearAutomaticHighlights'", start);
  const route = script.slice(start, end);
  assert.match(route, /initializeManualAnnotationUi\(\)/);
  assert.ok(route.indexOf('initializeManualAnnotationUi()') <
    route.indexOf('prepareManualDocument()'));
  const initializer = script.slice(
    script.indexOf('function initializeManualAnnotationUi'),
    script.indexOf('// Manual annotation UI: end')
  );
  assert.match(initializer, /manualUiLifecycle\.initialize/);
  assert.match(initializer, /return initialized/);
});

test('manual selection reacts immediately to mouse, pointer, and touch completion', () => {
  const script = read('content.js');
  const manualSection = script.slice(
    script.indexOf('// Manual annotation UI: start'),
    script.indexOf('// Manual annotation UI: end')
  );
  assert.match(manualSection, /type: 'mouseup'/);
  assert.match(manualSection, /type: 'pointerup'/);
  assert.match(manualSection, /type: 'touchend'/);
  assert.match(manualSection, /restoreManualAnnotations\([^)]+\);\s*scheduleManualSelectionInspection\(0\)/);
  assert.match(manualSection, /handleManualPointerUp[\s\S]*scheduleManualSelectionInspection\(0\)/);
  assert.match(manualSection, /handleManualSelectionChange[\s\S]*scheduleManualSelectionInspection\(16\)/);
  assert.doesNotMatch(manualSection, /setTimeout\([\s\S]{0,120}prepareManualDocument\(\)[\s\S]{0,80}950/);
});

test('selection validation rejects plugin, editor, outside-article, and cross-block ranges', () => {
  const { validateManualSelectionDescriptor } = loadManualUiHelpers();
  const valid = {
    text: 'same paragraph',
    collapsed: false,
    startBlockId: 'p-1',
    endBlockId: 'p-1'
  };
  assert.deepEqual(plain(validateManualSelectionDescriptor(valid)), { valid: true });
  assert.equal(validateManualSelectionDescriptor({ ...valid, insidePluginUi: true }).code, 'PLUGIN_UI');
  assert.equal(validateManualSelectionDescriptor({ ...valid, blockedRegion: true }).code, 'BLOCKED_REGION');
  assert.equal(validateManualSelectionDescriptor({
    ...valid,
    effectiveContentEditable: true
  }).code, 'BLOCKED_REGION');
  assert.equal(validateManualSelectionDescriptor({
    ...valid,
    intersectsForbiddenRegion: true,
    intersectedForbiddenTag: 'code'
  }).code, 'BLOCKED_REGION');
  assert.equal(validateManualSelectionDescriptor({
    ...valid,
    intersectsForbiddenRegion: true,
    intersectedForbiddenTag: 'pre'
  }).code, 'BLOCKED_REGION');
  assert.equal(validateManualSelectionDescriptor({ ...valid, startBlockId: '' }).code, 'OUTSIDE_ARTICLE');
  assert.deepEqual(
    plain(validateManualSelectionDescriptor({ ...valid, endBlockId: 'p-2' })),
    {
      valid: false,
      code: 'CROSS_BLOCK',
      message: '一次请选择同一段落内的文字'
    }
  );
});

test('restore planning locates records without persisting unresolved failures', () => {
  const { planManualAnnotationRestore } = loadManualUiHelpers();
  let locateCalls = 0;
  let writeCalls = 0;
  const records = [{ annotationId: 'a' }, { annotationId: 'b' }];
  const planned = planManualAnnotationRestore(records, [{ blockId: 'p-1' }], annotation => {
    locateCalls += 1;
    if (annotation.annotationId === 'a') {
      return { status: 'located', blockId: 'p-1', startOffset: 1, endOffset: 2 };
    }
    return { status: 'unresolved', reason: 'NOT_FOUND' };
  });
  assert.equal(locateCalls, 2);
  assert.equal(writeCalls, 0, 'restore failures must never trigger persistence');
  assert.deepEqual(plain(planned.located.map(item => item.annotation.annotationId)), ['a']);
  assert.deepEqual(plain(planned.unresolved.map(item => item.annotationId)), ['b']);
});

test('reanchoring replaces only anchor fields and preserves annotation identity and timestamps', () => {
  const { buildReanchoredAnnotation } = loadManualUiHelpers();
  const original = {
    annotationId: 'annotation-1',
    categoryId: 'result',
    categorySnapshot: { name: '结果', color: '#AABBCC' },
    quote: 'old', prefix: 'before', suffix: 'after', sectionTitle: 'Old',
    blockFingerprint: 'old-fp', startOffset: 4, endOffset: 7,
    note: 'keep note', status: 'unresolved',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T01:00:00.000Z'
  };
  const anchor = {
    quote: 'new quote', prefix: 'new before', suffix: 'new after', sectionTitle: 'Results',
    blockFingerprint: 'new-fp', startOffset: 10, endOffset: 19
  };
  const rebound = buildReanchoredAnnotation(original, anchor);
  assert.deepEqual(plain(rebound), { ...original, ...anchor, status: 'located' });
  assert.equal(rebound.annotationId, original.annotationId);
  assert.equal(rebound.createdAt, original.createdAt);
  assert.equal(rebound.updatedAt, original.updatedAt);
});

test('manual UI lifecycle binds once, rejects stale document responses, and releases retained state', () => {
  const { createManualUiLifecycle } = loadManualUiHelpers();
  const added = [];
  const removed = [];
  const target = {
    addEventListener: (type, handler, options) => added.push([type, handler, options]),
    removeEventListener: (type, handler, options) => removed.push([type, handler, options])
  };
  const lifecycle = createManualUiLifecycle();
  const bindings = [{ target, type: 'selectionchange', handler() {}, options: false }];
  assert.equal(lifecycle.initialize(bindings), true);
  assert.equal(lifecycle.initialize(bindings), false, 'reinitialization must not duplicate listeners');
  assert.equal(added.length, 1);

  const first = lifecycle.beginDocument('doc-a');
  lifecycle.retain({ blocks: [{ blockId: 'p-1' }], unresolved: [{ annotationId: 'a' }], selection: {} });
  const second = lifecycle.beginDocument('doc-b');
  assert.equal(lifecycle.isCurrent(first, 'doc-a'), false);
  assert.equal(lifecycle.isCurrent(second, 'doc-b'), true);
  lifecycle.disable();
  assert.equal(removed.length, 1);
  assert.deepEqual(plain(lifecycle.snapshot()), {
    initialized: false,
    documentId: '',
    blockCount: 0,
    unresolvedCount: 0,
    hasSelection: false
  });
});

test('SPA prepare races cannot mutate an old document or a detached article block', () => {
  const { isManualMutationCandidateCurrent } = loadManualUiHelpers();
  const connectedBlocks = [{ blockId: 'p-1', element: { isConnected: true } }];
  assert.equal(isManualMutationCandidateCurrent({
    currentDocumentId: 'doc-new',
    selectionDocumentId: 'doc-old',
    blockId: 'p-1',
    blocks: connectedBlocks
  }), false);
  assert.equal(isManualMutationCandidateCurrent({
    currentDocumentId: 'doc-new',
    selectionDocumentId: 'doc-new',
    blockId: 'p-1',
    blocks: [{ blockId: 'p-1', element: { isConnected: false } }]
  }), false);
  assert.equal(isManualMutationCandidateCurrent({
    currentDocumentId: 'doc-new',
    selectionDocumentId: 'doc-new',
    blockId: 'p-1',
    blocks: connectedBlocks
  }), true);
});

test('toolbar category model prioritizes current-view categories and caps rendered menus', () => {
  const { splitManualToolbarCategories } = loadManualUiHelpers();
  const categories = Array.from({ length: 70 }, (_, index) => ({
    categoryId: `category_${index}`,
    name: `Category ${index}`,
    color: '#F2D978'
  }));
  const model = splitManualToolbarCategories({
    activeCategories: [categories[3], categories[1]],
    allCategories: categories,
    primaryLimit: 8,
    moreLimit: 40
  });
  assert.deepEqual(plain(model.primary.map(item => item.categoryId)), ['category_3', 'category_1']);
  assert.equal(model.more.length, 40);
  assert.equal(model.hiddenMoreCount, 28);
});

test('manual selection defaults to the current analysis mode and can switch rule sets locally', () => {
  const script = read('content.js');
  const css = read('content.css');
  const manualSection = script.slice(
    script.indexOf('// Manual annotation UI: start'),
    script.indexOf('// Manual annotation UI: end')
  );
  assert.match(script, /Array\.isArray\(settings\.analysisModes\)/);
  assert.match(script, /settings\.readingViewId/);
  assert.match(manualSection, /resolveManualToolbarSettings\(publicState\)/);
  assert.match(manualSection, /function manualCategoriesForAnalysisMode/);
  assert.match(manualSection, /descriptor\?\.manualAnalysisModeId \|\| currentManualAnalysisModeId/);
  assert.match(manualSection, /modeRow\.className = 'sci-manual-mode-row'/);
  assert.match(manualSection, /modeSelect\.addEventListener\('change'/);
  assert.match(
    manualSection,
    /toolbar\.addEventListener\('mousedown',[\s\S]*?event\.target\.closest\('button'\)[\s\S]*?event\.preventDefault\(\)/
  );
  assert.doesNotMatch(
    manualSection,
    /toolbar\.addEventListener\('mousedown',\s*event\s*=>\s*event\.preventDefault\(\)\)/
  );
  assert.match(manualSection, /toolbarCategories\.slice\(0, 8\)/);
  assert.doesNotMatch(
    manualSection.match(/modeSelect\.addEventListener\('change'[\s\S]*?\n\s*\}\);/)?.[0] || '',
    /currentManualAnalysisModeId\s*=\s*modeSelect\.value/
  );
  assert.match(manualSection, /changes\?\.sciLlmSettingsV2/);
  assert.match(manualSection, /CATEGORY_APPEND_FIXED_PHRASE/);
  assert.match(manualSection, /加入白名单/);
  assert.match(manualSection, /加入黑名单/);
  assert.match(manualSection, /listType === 'exclude'/);
  assert.match(manualSection, /toolbarDescriptor\.manualAnalysisModeId = modeSelect\.value/);
  assert.match(css, /\.sci-manual-mode-row\s*\{/);
  assert.match(css, /\.sci-manual-mode-row select\s*\{/);
  assert.match(css, /\.sci-manual-rule-row\s*\{/);
});

test('manual toolbar uses configured scenarios and the effective category library', () => {
  const { resolveManualToolbarSettings } = loadManualUiHelpers();
  const resolved = resolveManualToolbarSettings({
    settings: {
      readingViewId: 'critical_review',
      analysisModes: [
        {
          id: 'quick_story', name: '快速主线',
          categoryIds: ['known_background', 'result', 'custom_signal']
        },
        {
          id: 'critical_review', name: '批判审阅',
          categoryIds: ['necessity_evidence', 'design_control', 'deleted_legacy']
        },
        {
          id: 'review_synthesis', name: '综述综合',
          categoryIds: ['review_scope_thesis', 'conflicting_evidence']
        }
      ]
    },
    readingViews: {
      stale_legacy_view: { name: '旧模式', categoryIds: ['hypothesis', 'objective'] }
    },
    availableCategories: [
      { categoryId: 'known_background', name: '已知背景', color: '#112233' },
      { categoryId: 'result', name: '我的结果名', color: '#123456' },
      { categoryId: 'custom_signal', name: '自定义线索', color: '#654321' },
      { categoryId: 'necessity_evidence', name: '必要性证据', color: '#223344' },
      { categoryId: 'design_control', name: '设计与对照', color: '#334455' },
      { categoryId: 'review_scope_thesis', name: '综述范围', color: '#445566' },
      { categoryId: 'conflicting_evidence', name: '冲突证据', color: '#556677' },
      { categoryId: 'retired', name: '已删除', color: '#000000', retired: true }
    ]
  });

  assert.deepEqual(plain(resolved.modes.map(mode => mode.id)), [
    'quick_story', 'critical_review', 'review_synthesis'
  ]);
  assert.equal(resolved.selectedModeId, 'critical_review');
  assert.deepEqual(plain(resolved.categories.map(category => category.categoryId)), [
    'known_background', 'result', 'custom_signal', 'necessity_evidence',
    'design_control', 'review_scope_thesis', 'conflicting_evidence'
  ]);
  assert.deepEqual(
    plain(resolved.categories.find(category => category.categoryId === 'result')),
    { categoryId: 'result', name: '我的结果名', color: '#123456' }
  );
  assert.equal(resolved.modes.some(mode => mode.id === 'stale_legacy_view'), false);
});

test('manual toolbar refresh replaces stale categories without rebuilding history', () => {
  const script = read('content.js');
  const manualSection = script.slice(
    script.indexOf('// Manual annotation UI: start'),
    script.indexOf('// Manual annotation UI: end')
  );
  const applySettings = manualSection.slice(
    manualSection.indexOf('function applyManualAnalysisSettings'),
    manualSection.indexOf('function manualCategoriesForAnalysisMode')
  );
  const prepare = manualSection.slice(
    manualSection.indexOf('async function prepareManualDocumentFresh'),
    manualSection.indexOf('function isCurrentManualMutationCandidate')
  );
  const modeChange = manualSection.match(
    /modeSelect\.addEventListener\('change'[\s\S]*?\n\s*\}\);/
  )?.[0] || '';

  assert.match(applySettings, /currentManualCategories\s*=\s*uniqueManualCategories\(toolbarSettings\.categories\)/);
  assert.match(applySettings, /currentManualAnalysisModes\s*=\s*toolbarSettings\.modes/);
  assert.doesNotMatch(applySettings, /currentManualDocument\s*=/);
  assert.doesNotMatch(prepare, /createBuiltInCategories/);
  assert.match(manualSection, /modeLabel\.textContent = '阅读情境'/);
  assert.match(modeChange, /focusModeSelect:\s*true/);
  assert.doesNotMatch(modeChange, /sendManualMessage|askArticleWithLLM/);
  assert.match(manualSection, /changes\?\.sciLlmSettingsV2[\s\S]*refreshManualAnalysisSettings/);
  assert.match(manualSection, /window\.innerHeight - height - 8/);
});

test('retired categories never enter selection or edit candidates', () => {
  const { splitManualToolbarCategories } = loadManualUiHelpers();
  const active = { categoryId: 'active', name: 'Active', color: '#AABBCC' };
  const retired = {
    categoryId: 'retired', name: 'Retired', color: '#DDEEFF', retired: true
  };
  const model = splitManualToolbarCategories({
    activeCategories: [retired, active],
    allCategories: [retired, { categoryId: 'other', name: 'Other', color: '#CCDDEE' }]
  });
  assert.deepEqual(plain(model.primary.map(item => item.categoryId)), ['active']);
  assert.deepEqual(plain(model.more.map(item => item.categoryId)), ['other']);
});

test('content script supports safe manual editing, unified overlap feedback, and bounded cleanup', () => {
  const script = read('content.js');
  const manualStart = script.indexOf('// Manual annotation UI: start');
  const manualEnd = script.indexOf('// Manual annotation UI: end');
  assert.ok(manualStart >= 0 && manualEnd > manualStart);
  const manualSection = script.slice(manualStart, manualEnd);
  assert.match(manualSection, /showManualSelectionToolbar/);
  assert.match(manualSection, /renderManualAnnotation/);
  assert.match(manualSection, /showHighlightContextPopover/);
  assert.match(manualSection, /restoreManualAnnotations/);
  assert.match(manualSection, /reanchorManualAnnotation/);
  assert.match(manualSection, /ANNOTATION_UPSERT/);
  assert.match(manualSection, /ANNOTATION_DELETE/);
  assert.match(manualSection, /DOCUMENT_PREPARE/);
  assert.match(manualSection, /textContent/);
  assert.doesNotMatch(manualSection, /innerHTML\s*=/);
  assert.match(script, /showHighlightContextPopover\(mark/);
  assert.match(script, /bindLlmHighlightInteraction/);
  assert.match(manualSection, /rehydrateLlmFeedbackInsideManualMark/);
  assert.match(script, /clearAutomaticHighlights/);
  assert.match(script, /clearManualAnnotations/);
  assert.match(script, /ANNOTATION_CLEAR_DOCUMENT/);
  assert.match(script, /removeEventListener/);
  assert.match(script, /selection\.removeAllRanges\(\)/);
  assert.match(script, /MANUAL_(?:MORE|UNRESOLVED)_RENDER_LIMIT/);
  assert.match(manualSection, /function handleManualViewportChange\(event\)[\s\S]*manualClosest\(event\?\.target, MANUAL_UI_SELECTOR\)/);
  assert.match(manualSection, /MANUAL_FORBIDDEN_SCAN_LIMIT/);
  assert.match(manualSection, /NodeFilter\.SHOW_ELEMENT/);
  assert.match(manualSection, /range\.intersectsNode/);
  assert.match(manualSection, /isContentEditable/);
  assert.match(manualSection, /sci-manual-unresolved-note/);
  assert.match(manualSection, /visibleNote\.textContent\s*=\s*annotation\.note/);
});

test('manual preparation reuses a connected document and isolates a fresh SPA extraction', () => {
  const script = read('content.js');
  const manualStart = script.indexOf('// Manual annotation UI: start');
  const manualEnd = script.indexOf('// Manual annotation UI: end');
  const manualSection = script.slice(manualStart, manualEnd);
  const prepare = manualSection.match(
    /async function prepareManualDocument\([^)]*\)\s*\{([\s\S]*?)\n\}/
  )?.[1] || '';
  assert.match(prepare, /const reusable =/);
  assert.match(prepare, /if \(!force && reusable\)/);
  assert.match(prepare, /manualPreparedContentSequence === articleStructureChangeSequence/);
  assert.match(prepare, /manualPreparePromise\?\.articleHref === href/);
  assert.match(prepare, /preparation\.articleHref = href/);
  assert.match(prepare, /manualPreparePromise === preparation/);
  const fresh = manualSection.match(
    /async function prepareManualDocumentFresh\([^)]*\)\s*\{([\s\S]*?)\n\}/
  )?.[1] || '';
  const freezeIndex = fresh.indexOf('freezeManualDocumentInteraction');
  const extractIndex = fresh.indexOf('getManualDocumentInputAndBlocks');
  const awaitIndex = fresh.indexOf('await Promise.all');
  assert.ok(freezeIndex >= 0 && freezeIndex < extractIndex && extractIndex < awaitIndex);
  assert.match(fresh, /const contentSequence = articleStructureChangeSequence/);
  assert.match(fresh, /articleStructureChangeSequence !== contentSequence/);
  assert.match(fresh, /manualPreparedContentSequence = contentSequence/);
  const freeze = manualSection.match(
    /function freezeManualDocumentInteraction\([^)]*\)\s*\{([\s\S]*?)\n\}/
  )?.[1] || '';
  assert.match(freeze, /currentManualDocument\s*=\s*null/);
  assert.match(freeze, /currentManualBlocks\s*=\s*\[\]/);
  assert.match(freeze, /clearManualBrowserSelection\(\)/);
  assert.match(freeze, /closeManualTransientUi\(\)/);
});

test('manual selection offset avoids cloning an entire paragraph DOM subtree', () => {
  const script = read('content.js');
  const offset = script.match(
    /function manualBoundaryOffset\([^)]*\)\s*\{([\s\S]*?)\n\}/
  )?.[1] || '';
  assert.match(offset, /before\.toString\(\)\.length/);
  assert.doesNotMatch(offset, /cloneContents/);
});

test('historical retired snapshots render but stay disabled in the category editor', () => {
  const script = read('content.js');
  const manualSection = script.slice(
    script.indexOf('// Manual annotation UI: start'),
    script.indexOf('// Manual annotation UI: end')
  );
  assert.match(manualSection, /annotation\.categorySnapshot\?\.name/);
  assert.match(manualSection, /historicalOption\.disabled\s*=\s*true/);
  assert.match(manualSection, /已停用/);
});

test('disabling manual annotations cancels deferred preparation and status cleanup timers', () => {
  const script = read('content.js');
  const manualStart = script.indexOf('// Manual annotation UI: start');
  const manualEnd = script.indexOf('// Manual annotation UI: end');
  const manualSection = script.slice(manualStart, manualEnd);
  assert.match(manualSection, /let manualPrepareTimer/);
  assert.match(manualSection, /let manualStatusTimer/);
  const disable = manualSection.match(
    /function disableManualAnnotationUi\(\)\s*\{([\s\S]*?)\n\}/
  )?.[1] || '';
  assert.match(disable, /clearTimeout\(manualPrepareTimer\)/);
  assert.match(disable, /clearTimeout\(manualStatusTimer\)/);
});

test('manual, LLM, and regex clear paths are strictly independent', () => {
  const script = read('content.js');
  const classStart = script.indexOf('class SciPaperHighlighter');
  const classEnd = script.indexOf('// DOM-independent manual annotation UI helpers: start');
  const highlighterClass = script.slice(classStart, classEnd);
  const regexClear = highlighterClass.match(
    /clearHighlight\(analysisModeId = ''\)\s*\{([\s\S]*?)\r?\n\s*\}\r?\n\s*\/\/ 获取所有文本节点/
  )?.[1] || '';
  const llmClear = script.match(
    /function clearLlmHighlights\(analysisModeId = ''\)\s*\{([\s\S]*?)\n\}/
  )?.[1] || '';
  const manualClear = script.match(/function clearManualHighlightMarks\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(regexClear, /sci-highlight|highlightedElements/);
  assert.match(
    regexClear,
    /querySelectorAll\(\s*[\s\S]*?sci-highlight\[data-source="regex"\]/
  );
  assert.doesNotMatch(regexClear, /clearLlmHighlights|sci-llm-highlight|sci-manual-highlight/);
  assert.match(llmClear, /sci-llm-highlight/);
  assert.doesNotMatch(llmClear, /sci-manual-highlight|sci-highlight['"]/);
  assert.match(manualClear, /sci-manual-highlight/);
  assert.doesNotMatch(manualClear, /sci-llm-highlight|sci-highlight['"]/);
});

test('manual mutations push fresh counts to the active side panel without polling', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const notifier = content.slice(
    content.indexOf('function notifyManualAnnotationStateChanged'),
    content.indexOf('function updateCurrentManualRecord')
  );
  assert.match(notifier, /MANUAL_ANNOTATION_STATE_CHANGED/);
  assert.match(notifier, /annotationCount/);
  assert.match(notifier, /unresolvedCount/);
  assert.match(content, /updateCurrentManualRecord[\s\S]{0,240}notifyManualAnnotationStateChanged\('mutated'\)/);
  assert.match(content, /updateCurrentManualRecord[\s\S]{0,240}scheduleArticleWorkspaceArtifactsSave\(\{ immediate: true \}\)/);
  assert.match(content, /clearManualAnnotationsAfterBackground[\s\S]{0,600}notifyManualAnnotationStateChanged\('cleared'\)/);
  assert.match(popup, /message\?\.type === 'MANUAL_ANNOTATION_STATE_CHANGED'/);
  assert.match(popup, /applyManualAnnotationStateEvent\(message\.event, sender\.tab\.id\)/);
  assert.match(popup, /MANUAL_ANNOTATION_STATE_CHANGED[\s\S]{0,300}void refreshArticleWorkspace\(\)/);
  assert.match(popup, /manualSummarySequence \+= 1/);
  assert.match(
    popup,
    /function openWorkspaceView\(viewId\)[\s\S]{0,180}viewId === 'analysis'[\s\S]{0,80}refreshManualAnnotationSummary/
  );
});

test('unverified manual events never publish state and coalesce through double-prepare proof', () => {
  const popup = read('popup.js');
  const apply = popup.slice(
    popup.indexOf('function applyManualAnnotationStateEvent'),
    popup.indexOf('async function refreshManualAnnotationSummary')
  );
  const listener = popup.slice(
    popup.indexOf("message?.type === 'MANUAL_ANNOTATION_STATE_CHANGED'"),
    popup.indexOf("message?.type === 'ARTICLE_NOTIFICATION'")
  );

  assert.match(apply, /manualAnnotationEventCommitMode\(/);
  assert.match(apply, /commitMode !== 'verified'[\s\S]{0,80}return false/);
  assert.match(listener, /applyManualAnnotationStateEvent\([\s\S]{0,180}refreshManualAnnotationSummaryAfterUnverifiedEvent/);
  assert.match(popup, /manualAnnotationEventRefreshPromise[\s\S]{0,500}refreshManualAnnotationSummary\(/);
});

test('an old verified event cannot supersede an in-flight new-epoch proof', async () => {
  const popup = read('popup.js');
  const start = popup.indexOf('function applyManualAnnotationStateEvent');
  const end = popup.indexOf('async function clearAutomaticHighlightsFromCurrentTab', start);
  const source = popup.slice(start, end);
  const manualCore = require('../core/manual-annotations.js');
  let releaseFirst;
  const firstPending = new Promise(resolve => { releaseFirst = resolve; });
  const oldProof = {
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: `sha256:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.test/article',
    contentWorldNonce: '1'.repeat(32),
    documentEpoch: 7
  };
  const newProof = {
    ...oldProof,
    contentWorldNonce: '2'.repeat(32),
    documentEpoch: 8
  };
  const context = {
    SciLLM: manualCore,
    activePanelTabContext: { tabId: 41 },
    manualAnnotationState: {
      tabId: 41, ...oldProof, title: 'old', annotationCount: 3, unresolvedCount: 0
    },
    manualSummarySequence: 0,
    manualAnnotationEventRefreshPromise: null,
    renderManualAnnotationSummary() {},
    refreshArticleWorkspace: async () => null,
    queryPanelTargetTab: async () => ({ id: 41, url: 'https://example.test/article' }),
    sendTabMessage: (() => {
      let call = 0;
      return async () => {
        call += 1;
        if (call === 1) await firstPending;
        return {
          success: true,
          ...newProof,
          title: 'new',
          annotationCount: call === 1 ? 4 : 5,
          unresolvedCount: 1
        };
      };
    })()
  };
  vm.runInNewContext(
    `${source}\n` +
    'globalThis.harness = {' +
      'applyManualAnnotationStateEvent,' +
      'refreshManualAnnotationSummaryAfterUnverifiedEvent,' +
      'state: () => manualAnnotationState,' +
      'sequence: () => manualSummarySequence' +
    '};',
    context
  );

  const refresh = context.harness.refreshManualAnnotationSummaryAfterUnverifiedEvent(41);
  await Promise.resolve();
  const sequenceDuringProof = context.harness.sequence();
  assert.equal(context.harness.applyManualAnnotationStateEvent({
    ...oldProof,
    title: 'stale',
    annotationCount: 99,
    unresolvedCount: 9
  }, 41), false);
  assert.equal(context.harness.sequence(), sequenceDuringProof);
  assert.equal(context.harness.state().annotationCount, 3);

  releaseFirst();
  await refresh;
  assert.equal(context.harness.state().documentEpoch, 8);
  assert.equal(context.harness.state().annotationCount, 5,
    'the second live proof owns the published counts');
});

test('an exact event after live proof retains its newer counts through final tab validation', async () => {
  const popup = read('popup.js');
  const start = popup.indexOf('function applyManualAnnotationStateEvent');
  const end = popup.indexOf('async function clearAutomaticHighlightsFromCurrentTab', start);
  const source = popup.slice(start, end);
  const manualCore = require('../core/manual-annotations.js');
  let releaseFinalTab;
  const finalTabPending = new Promise(resolve => { releaseFinalTab = resolve; });
  const proof = {
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: `sha256:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.test/article',
    contentWorldNonce: '1'.repeat(32),
    documentEpoch: 7
  };
  let queryCalls = 0;
  let prepareCalls = 0;
  const context = {
    SciLLM: manualCore,
    activePanelTabContext: { tabId: 41 },
    manualAnnotationState: {
      tabId: 41, ...proof, title: 'old', annotationCount: 3, unresolvedCount: 0
    },
    manualSummarySequence: 0,
    manualAnnotationEventRefreshPromise: null,
    renderManualAnnotationSummary() {},
    refreshArticleWorkspace: async () => null,
    queryPanelTargetTab: async () => {
      queryCalls += 1;
      if (queryCalls === 2) await finalTabPending;
      return { id: 41, url: 'https://example.test/article' };
    },
    sendTabMessage: async () => {
      prepareCalls += 1;
      return {
        success: true,
        ...proof,
        title: 'proof',
        annotationCount: prepareCalls === 1 ? 4 : 5,
        unresolvedCount: 1
      };
    }
  };
  vm.runInNewContext(
    `${source}\n` +
    'globalThis.harness = {' +
      'applyManualAnnotationStateEvent,' +
      'refreshManualAnnotationSummary,' +
      'state: () => manualAnnotationState' +
    '};',
    context
  );

  const refresh = context.harness.refreshManualAnnotationSummary(41);
  while (queryCalls < 2) await Promise.resolve();
  assert.equal(context.harness.applyManualAnnotationStateEvent({
    ...proof,
    title: 'latest event',
    annotationCount: 6,
    unresolvedCount: 2
  }, 41), true);
  releaseFinalTab();
  const state = await refresh;
  assert.equal(state.annotationCount, 6);
  assert.equal(state.title, 'latest event');
});

test('superseded exact self-events retain their newer state while response publishes live proof', () => {
  const popup = read('popup.js');
  const popupHtml = read('popup.html');
  const refresh = popup.slice(
    popup.indexOf('async function refreshManualAnnotationSummary'),
    popup.indexOf('async function clearAutomaticHighlightsFromCurrentTab')
  );

  assert.match(popupHtml, /<script src="core\/manual-annotations\.js"><\/script>/);
  assert.match(refresh, /capturedTab[\s\S]{0,600}sendTabMessage/);
  assert.equal((refresh.match(/action: 'prepareManualAnnotations'/g) || []).length, 2);
  assert.match(refresh, /const liveProof = await sendTabMessage/);
  assert.match(refresh, /manualAnnotationRefreshCommitMode\(\{[\s\S]{0,400}capturedTab,[\s\S]{0,80}currentTab/);
  assert.match(refresh, /response,[\s\S]{0,80}liveProof,/);
  assert.match(refresh, /commitMode === 'committed'[\s\S]{0,80}return manualAnnotationState/);
  assert.match(refresh, /if \(commitMode !== 'response'\) return null/);
  assert.match(refresh, /documentId: liveProof\.documentId/);
  assert.match(refresh, /annotationCount:[\s\S]{0,80}liveProof\.annotationCount/);
});

test('side-panel highlight distribution separates manual, AI, and rule-generated marks', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  assert.match(popup, /regex:\s*\{ label:\s*'正则', className:\s*'is-regex'/);
  assert.match(popup, /llm:\s*\{ label:\s*'LLM', className:\s*'is-llm'/);
  assert.match(popup, /manual:\s*\{[\s\S]{0,100}label:\s*'手动', className:\s*'is-manual'/);
  assert.match(popup, /value\.sources/);
  assert.match(css, /\.workspace-distribution-cell\.is-manual/);
  assert.match(css, /\.workspace-distribution-cell\.is-llm/);
  assert.match(css, /\.workspace-distribution-cell\.is-regex/);
});

test('clearing automatic highlights clears restorable state and persists an empty engine', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const clear = content.slice(
    content.indexOf('async function clearAutomaticHighlightsAndPersist'),
    content.indexOf('function clearManualAnnotationsAfterBackground')
  );
  assert.match(clear, /lastRegexHighlightRequest = null/);
  assert.match(clear, /lastLlmAnalysis = null/);
  assert.match(clear, /llmProgressiveAnalysis = null/);
  assert.match(clear, /lastLlmDiagnostics = null/);
  assert.match(clear, /persistArticleWorkspaceArtifacts\(\{ force: true \}\)/);
  assert.doesNotMatch(clear, /currentManualDocument\s*=\s*null/);
  assert.match(popup, /await persistCurrentArticleArchive\(\)\.catch\(\(\) => null\)/);
  assert.match(popup, /response\.persisted === false/);
});

test('manual fluorescent and automatic underline channels follow Brevess tokens', () => {
  const css = read('content.css');
  const manualCss = css.slice(
    css.indexOf('/* Manual annotation UI: start */'),
    css.indexOf('/* Manual annotation UI: end */')
  );
  assert.match(css, /--sci-manual-navy:\s*#0b4778/i);
  assert.match(css, /\.sci-manual-highlight[\s\S]*background-color:\s*var\(--sci-manual-color/);
  assert.match(css, /\.sci-manual-highlight[\s\S]*text-decoration:\s*none/);
  assert.match(css, /\.sci-llm-highlight[\s\S]*background:\s*transparent/);
  assert.match(css, /\.sci-llm-highlight[\s\S]*border-bottom:\s*3px solid/);
  assert.match(css, /#sci-manual-toolbar/);
  assert.match(css, /#sci-highlight-context-popover/);
  assert.doesNotMatch(manualCss, /linear-gradient/);
});

test('regex and LLM renderers use underline colors without inline automatic backgrounds', () => {
  const script = read('content.js');
  const regexRenderer = script.match(
    /createHighlightSpan\(match, mode\)\s*\{([\s\S]*?)\n\s*return span;/
  )?.[1] || '';
  const llmRenderer = script.match(
    /function applyLlmHighlights\([^)]*\)\s*\{([\s\S]*?)\n\}/
  )?.[1] || '';

  assert.match(regexRenderer, /span\.style\.borderBottomColor\s*=\s*match\.color/);
  assert.doesNotMatch(regexRenderer, /span\.style\.background(?:Color)?\s*=/);
  assert.match(llmRenderer, /mark\.style\.borderBottomColor\s*=\s*primary\.color/);
  assert.doesNotMatch(llmRenderer, /mark\.style\.background(?:Color)?\s*=/);
});

test('automatic CSS shares a 3px underline while manual marks remain fluorescent', () => {
  const css = read('content.css');
  const regexRule = css.match(/\.sci-highlight\s*\{([^}]*)\}/)?.[1] || '';
  const llmRule = css.match(/\.sci-llm-highlight\s*\{([^}]*)\}/)?.[1] || '';
  const warningRule = css.match(
    /\.sci-llm-highlight\.sci-llm-inferred-warning\s*\{([^}]*)\}/
  )?.[1] || '';
  const rejectedRule = css.match(
    /\.sci-llm-highlight\.feedback-rejected\s*\{([^}]*)\}/
  )?.[1] || '';
  const manualRule = css.match(/\.sci-manual-highlight\s*\{([^}]*)\}/)?.[1] || '';

  for (const automaticRule of [regexRule, llmRule]) {
    assert.match(automaticRule, /background(?:-color)?:\s*transparent\s*!important/);
    assert.match(automaticRule, /border-bottom:\s*3px solid/);
  }
  for (const automaticOverrideRule of [warningRule, rejectedRule]) {
    const backgroundValues = [...automaticOverrideRule.matchAll(
      /background(?:-color)?\s*:\s*([^;}]+)/gi
    )].map(match => match[1].trim());
    assert.ok(backgroundValues.length > 0, 'automatic state overrides must stay explicit');
    backgroundValues.forEach(value => {
      assert.match(value, /^transparent(?:\s*!important)?$/i);
    });
  }
  assert.match(warningRule, /border-bottom-style:\s*dashed/);
  assert.match(manualRule, /background-color:\s*var\(--sci-manual-color/);
  assert.match(manualRule, /text-decoration:\s*none/);
  assert.doesNotMatch(manualRule, /border-bottom:/);
});
