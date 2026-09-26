const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function snapshotHandler(dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
  const marker = "} else if (request.action === 'getArticleWorkspaceSnapshot') {";
  const start = source.indexOf(marker) + marker.length;
  const end = source.indexOf("} else if (request.action === 'getArticleAbbreviations')", start);
  assert.ok(start >= marker.length && end > start);
  const names = Object.keys(dependencies);
  const readStart = source.indexOf('async function readArticleWorkspaceSnapshot(');
  const readEnd = source.indexOf('\n}', readStart) + 2;
  return new Function(...names, source.slice(readStart, readEnd) + '\n' + source.slice(start, end))(
    ...names.map(key => dependencies[key]));
}

test('workspace snapshot waits for the inventory merge it started before exposing its draft revision', async () => {
  let release;
  const seed = new Promise(resolve => { release = resolve; });
  let revision = 4;
  let lifecycle = 2;
  let response;
  let respond;
  let reads = 0;
  const manual = { documentId: 'document-a' };
  const completion = new Promise(resolve => { respond = resolve; });
  const dependencies = {
    request: { action: 'getArticleWorkspaceSnapshot' },
    waitForArticleStructureReady: async () => {},
    articlePublicPreviewNotice: () => null,
    canonicalArticlePreindexUrl: () => 'https://example.test/article',
    currentArticleWorkspaceReadUrl: () => 'https://example.test/article',
    withCurrentPdfSemanticNavigation: value => value,
    articleStructureChangeSequence: 0,
    articleExtractionCache: null,
    getFigureWorkspaceInventory() {},
    extractCurrentArticleStructure: () => ({ paragraphs: [{ text: 'Paper body' }] }),
    populateFigureWorkspaceDraft() {},
    combinedFigureWorkspaceInventory: () => [],
    sendResponse(value) { response = value; respond(value); },
    ensureGlobalAbbreviationMemory: async () => ({}),
    prepareManualDocument: async () => manual,
    currentManualDocument: manual,
    manualPreparedHref: 'https://example.test/article',
    currentFigureWorkspaceRefreshBinding: () => ({ documentId: 'document-a' }),
    articleWorkspaceLifecycleGeneration: 2, figureWorkspaceInventoryEpoch: 0,
    figureWorkspaceInventorySeedPromise: seed,
    assertCurrentArticleWorkspaceLifecycle() {}, sameFigureWorkspaceRefreshBinding: () => true,
    globalAbbreviationMemory: {},
    ensureCurrentArticleWorkspace: async () => ({ workspaceId: 'workspace-a' }),
    refreshSupplementalFigureAssets: async () => {},
    supplementalFigureAssets: [],
    buildArticleWorkspaceSnapshot() {
      reads += 1;
      return { documentId: 'document-a', figures: {
        draft: { revision }, workspaceLifecycle: lifecycle, figures: [{ figureId: 'figure-1' }]
      } };
    },
    async ensureFigureWorkspaceInventorySeeded() {
      await seed;
      revision = 7;
      lifecycle = 3;
    },
    articleStructureObserver: true,
    maintainArticleStructureObserverAfterWorkspaceSnapshot() {},
    startArticleStructureObserver() {}
  };
  snapshotHandler(dependencies);
  await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(response, undefined, 'must not publish the pre-merge revision'); }
  finally { release(); }
  const result = await completion;
  assert.equal(result.success, true, result.error || result.code);
  assert.equal(result.snapshot.figures.draft.revision, 7);
  assert.equal(result.snapshot.figures.workspaceLifecycle, 3);
  assert.ok(reads >= 2, 'rebuild the public view after the pending merge completes');
});

function generationAdmission(dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
  const start = source.indexOf('async function runCrossFigureLogic(');
  const end = source.indexOf('        operationId = createMechanismOperationId();', start);
  assert.ok(start >= 0 && end > start);
  const names = Object.keys(dependencies);
  return new Function(...names, source.slice(start, end) +
    '\n return generationContext; } catch (error) { throw error; } }\nreturn runCrossFigureLogic;')(
    ...names.map(key => dependencies[key]));
}

test('mechanism click reads the current workspace before capturing its generation binding', async () => {
  let release;
  const refreshed = new Promise(resolve => { release = resolve; });
  let revision = 4;
  let captures = 0;
  let finished = false;
  const run = generationAdmission({
    activeWorkspaceView: 'mechanism', requireUsableLlm: () => true,
    queryPanelTargetTab: async () => ({ id: 1 }), figureTaskGeneration: 2,
    isCurrentFigureTask: () => true, capturePanelContext: () => ({ tabId: 1, key: 'paper-a' }),
    isCurrentPanelContext: () => true,
    async refreshArticleWorkspace() { await refreshed; revision = 7; return { documentId: 'a' }; },
    captureFigureWorkspaceEditContext() { captures += 1; return { draftRevision: revision }; }
  });
  const pending = run().then(value => { finished = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(finished, false, 'generation cannot use a stale sidebar before refresh completes');
    assert.equal(captures, 0);
  } finally { release(); }
  assert.equal((await pending).draftRevision, 7);
});

test('switching paper while generation prepares its workspace cannot capture or dispatch for the new paper', async () => {
  let current = true;
  let captures = 0;
  const run = generationAdmission({
    activeWorkspaceView: 'mechanism', requireUsableLlm: () => true,
    queryPanelTargetTab: async () => ({ id: 1 }), figureTaskGeneration: 2,
    isCurrentFigureTask: () => current, capturePanelContext: () => ({ tabId: 1, key: 'paper-a' }),
    isCurrentPanelContext: () => current,
    async refreshArticleWorkspace() { current = false; return { documentId: 'paper-b' }; },
    captureFigureWorkspaceEditContext() { captures += 1; return { documentId: 'paper-b' }; }
  });
  assert.equal(await run(), undefined);
  assert.equal(captures, 0);
});
