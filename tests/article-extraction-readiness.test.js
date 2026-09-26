const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const workspace = require('../core/figure-workspace.js');

function load(file, names, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const context = vm.createContext(dependencies);
  for (const name of names) {
    let start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    if (source.slice(start - 6, start) === 'async ') start -= 6;
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  return context;
}

test('anchor navigation reuses typed extraction for body and structure; force refresh rescans once', () => {
  let scans = 0;
  const records = [{ recordType: 'body', text: 'body' }, { recordType: 'figure-caption', text: 'caption' }];
  const context = load('content.js', ['canonicalArticlePreindexUrl', 'getCachedArticleExtraction',
    'extractArticleWithTrace', 'extractArticleStructureWithTrace'], {
    location: { href: 'https://example.test/article#Sec1' },
    articleExtractionCache: null, ARTICLE_EXTRACTION_CACHE_TTL_MS: 15000,
    lastSuccessfulExtraction: null, lastSuccessfulStructure: null,
    extractionTrace: { begin() {}, complete() {}, fail() {} },
    activeNativePdfStructure: () => null, summarizeExtractedParagraphs: () => ({}),
    document: {}, SciLLM: {
      extractArticle() { scans += 1; return records; },
      buildArticleStructureFromRecords(_document, rows) { return { paragraphs: rows }; }
    }
  });
  assert.equal(context.extractArticleWithTrace().length, 1);
  context.location.href = 'https://example.test/article#Sec2';
  assert.equal(context.extractArticleWithTrace().length, 1);
  assert.equal(context.extractArticleStructureWithTrace().paragraphs.length, 2);
  assert.equal(scans, 1);
  context.extractArticleStructureWithTrace('refresh', { forceRefresh: true });
  assert.equal(scans, 2);
  assert.equal(context.articleExtractionCache.url, 'https://example.test/article');
});

test('failed Figure seed stays failed for its caller but a later refresh retries the real CAS controller', async () => {
  const binding = { documentId: 'paper', documentHash: 'hash', canonicalUrl: 'https://example.test/a',
    workspaceId: 'workspace:a', workspaceGeneration: 1 };
  let attempts = 0;
  const controller = workspace.createFigureWorkspaceDraftController({ binding,
    initialDraft: { ...workspace.createFigureWorkspaceDraft([]), binding },
    persist: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('storage unavailable'), { code: 'SAVE_FAILED' });
      return { revision: 1, contentHash: 'saved' };
    }
  });
  const context = load('content.js', ['sameFigureWorkspaceRefreshBinding',
    'populateFigureWorkspaceDraft', 'ensureFigureWorkspaceInventorySeeded'], {
    currentFigureWorkspaceRefreshBinding: () => binding,
    figureWorkspaceDraftForRefreshBinding: draft => draft,
    figureWorkspaceDraft: controller.getDraft(),
    figureWorkspaceDraftController: controller, figureWorkspaceDraftControllerPromise: null,
    figureWorkspaceInventorySeedPromise: Promise.resolve(), articleWorkspaceLifecycleGeneration: 2,
    figureWorkspaceDraftCheckpoint: {}, figureWorkspaceDraftDirty: false,
    figureWorkspaceCompletedModelResult: () => null,
    assertCurrentArticleWorkspaceLifecycle(value) { assert.equal(value, 2); },
    articleWorkspaceLifecycleError: () => Error('STALE')
  });
  const figures = [{ figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A'] }];
  await assert.rejects(context.populateFigureWorkspaceDraft(figures), { code: 'SAVE_FAILED' });
  await assert.rejects(context.ensureFigureWorkspaceInventorySeeded(), error =>
    error.code === 'FIGURE_WORKSPACE_INVENTORY_SEED_FAILED' && error.causeCode === 'SAVE_FAILED');
  await context.populateFigureWorkspaceDraft(figures);
  const result = await context.ensureFigureWorkspaceInventorySeeded();
  assert.ok(result.figures['figure-1']);
  assert.equal(attempts, 2);
});

function readerDependencies(extra = {}) {
  const manual = { documentId: 'paper' };
  const binding = { documentId: 'paper', documentHash: 'hash', canonicalUrl: 'https://example.test/a',
    workspaceId: 'a', workspaceGeneration: 1 };
  return {
    waitForArticleStructureReady: async () => {}, canonicalArticlePreindexUrl: () => 'https://example.test/a',
    currentArticleWorkspaceReadUrl: () => 'https://example.test/a',
    articlePublicPreviewNotice: () => null,
    articleStructureChangeSequence: 1, articleExtractionCache: {},
    getFigureWorkspaceInventory() {}, extractCurrentArticleStructure: () => ({ paragraphs: [{ text: 'body' }] }),
    prepareManualDocument: async () => manual, currentManualDocument: manual,
    manualPreparedHref: 'https://example.test/a',
    ensureCurrentArticleWorkspace: async () => ({ workspaceId: 'a' }),
    currentFigureWorkspaceRefreshBinding: () => binding,
    articleWorkspaceLifecycleGeneration: 1, figureWorkspaceInventoryEpoch: 0,
    figureWorkspaceInventorySeedPromise: Promise.resolve(),
    assertCurrentArticleWorkspaceLifecycle(value) { assert.equal(value, 1); },
    sameFigureWorkspaceRefreshBinding: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    refreshSupplementalFigureAssets: async () => {}, supplementalFigureAssets: [],
    combinedFigureWorkspaceInventory: () => [], populateFigureWorkspaceDraft() {},
    buildArticleWorkspaceSnapshot: () => ({ title: 'Paper', paragraphs: [{ text: 'body' }],
      nodes: [{ title: 'Abstract' }], figures: { draft: { revision: 5 }, figures: [{ figureId: 'figure-1' }] } }),
    ensureFigureWorkspaceInventorySeeded: async () => {}, ...extra
  };
}

test('catalog failure preserves readable body/navigation without publishing an uncommitted edit capability', async () => {
  const context = load('content.js', ['readArticleWorkspaceSnapshot'], readerDependencies({
    ensureFigureWorkspaceInventorySeeded: async () => { throw { code: 'FIGURE_WORKSPACE_INVENTORY_SEED_FAILED',
      causeCode: 'ASSET_REVISION_CONFLICT' }; }
  }));
  const result = await context.readArticleWorkspaceSnapshot();
  assert.equal(result.paragraphs.length, 1);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.figures.inventoryReady, false);
  assert.equal(result.figures.draft, null);
  assert.equal(result.warnings[0].code, 'ASSET_REVISION_CONFLICT');
  const popup = load('popup.js', ['reconcileArticleWorkspaceSnapshot']);
  assert.equal(popup.reconcileArticleWorkspaceSnapshot({ figures: { draft: { revision: 9 } } }, result), result);
});

test('a changing DOM cannot publish a mixed article snapshot after asynchronous preparation', async () => {
  const dependencies = readerDependencies();
  const context = load('content.js', ['readArticleWorkspaceSnapshot'], dependencies);
  context.prepareManualDocument = async () => { context.articleStructureChangeSequence += 1;
    return context.currentManualDocument; };
  await assert.rejects(context.readArticleWorkspaceSnapshot(), { code: 'ARTICLE_PAGE_LOADING' });
});

test('loading waits are bounded, steady article DOM does not wait for publisher images, and native PDF bypasses HTML readiness', async () => {
  let now = 1000, waits = 0;
  const context = load('content.js', ['waitForArticleStructureReady'], {
    activeNativePdfStructure: () => null, articleStructureObserver: {},
    articleStructureLastMutationAt: 500, document: { readyState: 'loading' },
    canonicalArticlePreindexUrl: () => 'https://example.test/a', Date: { now: () => now },
    setTimeout(callback, delay) { waits++; now += delay; callback(); }
  });
  await assert.rejects(context.waitForArticleStructureReady({ maxWaitMs: 300 }), { code: 'ARTICLE_PAGE_LOADING' });
  assert.equal(waits, 3);
  context.document.readyState = 'interactive';
  await context.waitForArticleStructureReady();
  assert.equal(waits, 3);
  context.document.readyState = 'loading';
  context.activeNativePdfStructure = () => ({ paragraphs: [] });
  await context.waitForArticleStructureReady();
  assert.equal(waits, 3);
});

test('an empty fully loaded page is unavailable, not endlessly presented as loading', async () => {
  const context = load('content.js', ['readArticleWorkspaceSnapshot'], readerDependencies({
    document: { readyState: 'complete' }, extractCurrentArticleStructure: () => ({ paragraphs: [] })
  }));
  await assert.rejects(context.readArticleWorkspaceSnapshot(), { code: 'ARTICLE_BODY_UNAVAILABLE' });
});

test('visible subscription preview is distinguished from loading without mislabeling full text or a hidden paywall', () => {
  let visible = true;
  const context = load('content.js', ['articlePublicPreviewNotice'], {
    document: { querySelectorAll: () => [{ getClientRects: () => visible ? [{}] : [],
      closest: () => null, textContent: 'This is a preview of subscription content, access via your institution' }] }
  });
  assert.equal(context.articlePublicPreviewNotice({ paragraphs: [{ sectionKind: 'abstract' }] }).code,
    'ARTICLE_PUBLIC_PREVIEW');
  assert.equal(context.articlePublicPreviewNotice({ paragraphs: [{ sectionKind: 'results' }] }), null);
  visible = false;
  assert.equal(context.articlePublicPreviewNotice({ paragraphs: [{ sectionKind: 'abstract' }] }), null);
  assert.equal(context.articlePublicPreviewNotice({ adapterId: 'pdf-native', paragraphs: [] }), null);
});
