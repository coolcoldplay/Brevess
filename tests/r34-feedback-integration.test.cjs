'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const readingTools = require('../core/reading-tools.js');
const reviewOutline = require('../core/review-outline.js');
const { functionSource } = require('./helpers/r28-full07-source.js');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('NOTE-067 keeps transferable ideas as the final default basic-research field', () => {
  const template = readingTools.DEFAULT_LITERATURE_NOTE_TEMPLATES
    .find(item => item.id === 'basic_research');
  assert.ok(template);
  assert.equal(template.fields.at(-1).id, 'transferable_ideas');
  assert.equal(template.fields.at(-1).label, '我可以借鉴的内容');
  assert.deepEqual(template.fields.slice(-2).map(field => field.id),
    ['open_questions', 'transferable_ideas']);
});

test('UI-066 uses a darker outline translation color and comfortable row rhythm', () => {
  const css = read('popup.css');
  const translation = css.match(/\.workspace-tree-title-translation\s*\{[^}]*margin-top[^}]*\}/)?.[0] || '';
  const summary = css.match(/^\.workspace-tree-summary\s*\{([^}]*)\}/m)?.[1] || '';
  const jump = css.match(/^\.workspace-tree-jump\s*\{([^}]*)\}/m)?.[1] || '';
  assert.match(translation, /color:\s*#244f68/i);
  assert.match(translation, /line-height:\s*1\.4(?:;|\s)/);
  assert.match(summary, /min-height:\s*44px/);
  assert.match(summary, /gap:\s*8px/);
  assert.match(jump, /padding:\s*4px 0/);
  assert.match(jump, /line-height:\s*1\.45/);
});

test('NOTE-064 merges every validated paragraph summary into notes without overwriting human text', () => {
  const paragraphs = [
    { paragraphId: 'p1', sourceKey: 's1', sectionId: 'results', sectionTitle: 'Results',
      text: 'First result paragraph with a measured effect.' },
    { paragraphId: 'p2', sourceKey: 's2', sectionId: 'results', sectionTitle: 'Results',
      text: 'Second result paragraph with a control comparison.' }
  ];
  const summaries = [
    { paragraphId: 'p1', summary: '第一段概述。' },
    { paragraphId: 'p2', summary: '第二段概述。' }
  ];
  const first = reviewOutline.mergeReviewParagraphSummariesIntoNotes({
    notes: [{ paragraphId: 'p1', note: '人工笔记。', sourceKey: 's1', navigationRevision: 3 }],
    paragraphs,
    summaries,
    navigationRevision: 4,
    now: '2026-10-18T00:00:00.000Z'
  });
  assert.deepEqual(first.addedParagraphIds, ['p1', 'p2']);
  assert.equal(first.notes.find(note => note.paragraphId === 'p1').note,
    '人工笔记。\n\n第一段概述。');
  assert.equal(first.notes.find(note => note.paragraphId === 'p2').note,
    '第二段概述。');

  const repeated = reviewOutline.mergeReviewParagraphSummariesIntoNotes({
    notes: first.notes,
    paragraphs,
    summaries,
    navigationRevision: 4,
    now: '2026-10-18T00:01:00.000Z'
  });
  assert.deepEqual(repeated.addedParagraphIds, []);
  assert.deepEqual(repeated.alreadyPresentParagraphIds, ['p1', 'p2']);
  assert.equal(repeated.notes.find(note => note.paragraphId === 'p1').note,
    '人工笔记。\n\n第一段概述。');
});

test('FIG-065 text-only Figure mode skips image preparation before any page read', async () => {
  let prepared = 0;
  const prepare = new Function(
    'figureTextGrantFor',
    'activeNativePdfStructure',
    'restoreNativePdfFigureArtworkSelection',
    'prepareFigureImagesForTextChoice',
    'prepareFigureImages',
    'requireFigureVisualInput',
    `${functionSource(read('content.js'), 'preparePdfFigureProductionInput')}
return preparePdfFigureProductionInput;`
  )(
    () => null,
    () => null,
    () => undefined,
    async () => { prepared += 1; return []; },
    async () => { prepared += 1; return []; },
    async () => { prepared += 1; return []; }
  );
  const result = await prepare({ figureId: 'figure-1', imageElements: [] }, {
    route: { capabilityMode: 'vision' }
  }, 'standard', { forceTextOnly: true });
  assert.deepEqual(result, { images: [], envelope: null });
  assert.equal(prepared, 0);
  const content = read('content.js');
  assert.match(content, /recordExplicitFigureTextGrant\(state\.figure, visionAdmission, 'standard'\)/);
  assert.match(content, /options\.figureInputMode === 'text'[\s\S]{0,120}recordExplicitFigureTextGrant\(figure, visionAdmission, analysisDepth\)/);
});

test('TRANS-068 PDF title translation accepts embedded outline sources and the same outline set', () => {
  const content = read('content.js');
  assert.match(content, /navigation\?\.outlineSections\?\.length[\s\S]{0,120}navigation\?\.sections/);
  assert.match(content, /\['outline', 'embedded-outline'\]\.includes\(node\?\.source\)/);
});

test('UI-070 keeps evidence panel range and summary on one line with a larger type size', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  assert.match(popup, /workspace-evidence-block-separator', '：'/);
  const summary = css.match(/^\.workspace-evidence-block-summary\s*\{([^}]*)\}/m)?.[1] || '';
  const description = css.match(/^\.workspace-evidence-block-description\s*\{([^}]*)\}/m)?.[1] || '';
  assert.match(summary, /font-size:\s*13px/);
  assert.match(description, /display:\s*inline/);
  assert.doesNotMatch(description, /display:\s*block/);
});

function singleFigureHarness(choice) {
  const messages = [];
  const context = {
    Map, Object, String, Number, Boolean, JSON, Promise, Date,
    requireUsableLlm: () => true,
    capturePanelContext: () => ({ tabId: 7, key: 'panel', url: 'https://paper.test/a' }),
    isCurrentPanelContext: () => true,
    sidebarBatchKey: (module, panel) => `${module}|${panel.key}`,
    sidebarBatchIntents: new Map(),
    sidebarRuntimeTasks: { get: () => null },
    sidebarTaskDocumentId: () => '',
    currentWorkspaceSnapshot: { documentId: 'doc-a', documentHash: 'hash-a',
      figures: { figures: [{ figureId: 'figure-1', figureLabel: 'Figure 1' }] } },
    preparedDocumentState: null,
    requestFigureInputModeChoice: async () => choice,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    renderSidebarBatchActions() {},
    figureTaskGeneration: 1,
    isCurrentFigureTask: () => true,
    isSidebarOperationStopping: () => false,
    queryPanelTargetTab: async () => ({ id: 7 }),
    startFigureProgressPolling() {},
    showStatus(message, kind) { messages.push({ kind, message }); },
    sendTabMessage: async (_tabId, message) => {
      if (message.action === 'analyzeSingleFigureWithLLM') {
        messages.push({ request: message });
        return { success: true, analyzedCount: 1, failedCount: 0 };
      }
      return { success: true };
    },
    pollSidebarRuntimeTasks: async () => {},
    acceptSidebarRuntimeTask: () => true,
    retireSidebarFigureIntent: async () => {},
    refreshFigureAnalysisProgress: async () => null,
    hasRunningFigureProgress: () => false,
    stopFigureProgressPolling() {},
    renderFigureWorkspaceSnapshot() {},
    refreshArticleWorkspace: async () => {},
    persistCurrentArticleArchive: async () => ({ commitConfirmed: true }),
    window: { addEventListener() {}, removeEventListener() {} }
  };
  vm.createContext(context);
  vm.runInContext(functionSource(read('popup.js'), 'runSingleFigureAnalysis'), context);
  return { context, messages };
}

test('FIG-065 cancelling the single-Figure mode dialog sends no request and creates no task', async () => {
  const h = singleFigureHarness(null);
  await h.context.runSingleFigureAnalysis('figure-1');
  assert.equal(h.messages.some(item => item.request), false);
  assert.equal(h.context.sidebarBatchIntents.size, 0);
});

for (const mode of ['text', 'vision']) {
  test(`FIG-065 single Figure forwards the chosen ${mode} input mode before dispatch`, async () => {
    const h = singleFigureHarness(mode);
    await h.context.runSingleFigureAnalysis('figure-1');
    const request = h.messages.find(item => item.request)?.request;
    assert.equal(request?.figureInputMode, mode);
    assert.equal(request?.figureId, 'figure-1');
  });
}
