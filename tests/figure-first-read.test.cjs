'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { functionSource } = require('./helpers/r28-full07-source.js');
const content = fs.readFileSync(require.resolve('../extension/content.js'), 'utf8');
const popup = fs.readFileSync(require.resolve('../extension/popup.js'), 'utf8');
const batch = new vm.Script(functionSource(content, 'analyzeFiguresWithLLM'));

function firstRead(changePage) {
  const events = [];
  const stop = new Error('reached the source lease');
  let transient = true;
  const env = vm.createContext({
    figureAnalysisPromise: null, articleWorkspaceLifecycleGeneration: 1,
    preflightFigureTaskRoute: async () => ({}),
    recoverPendingFigureOperationRelease: async () => {},
    prepareFigureSourceAdmission: async () => {},
    synchronizeFigureWorkspaceLifecycle: async () => {},
    assertCurrentArticleWorkspaceLifecycle(value) {
      assert.equal(value, env.articleWorkspaceLifecycleGeneration, 'page changed');
    },
    async admitArticleWorkspacePersistence() {
      events.push('admit');
      transient = false;
      if (changePage) env.articleWorkspaceLifecycleGeneration++;
      return { transient };
    },
    beginFigureOperation() {
      events.push('lease');
      assert.equal(transient, false, 'an unseen paper still has a read-only owner');
      throw stop;
    }
  });
  batch.runInContext(env);
  return { events, run: () => env.analyzeFiguresWithLLM({ allFigures: true }), stop };
}

test('batch on a previously unsaved paper admits its owner before pinning the source', async () => {
  const { events, run, stop } = firstRead(false);
  await assert.rejects(run, error => error === stop);
  assert.deepEqual(events, ['admit', 'lease']);
});

test('navigation while admitting a new paper cannot start a batch for the new page', async () => {
  const { events, run } = firstRead(true);
  await assert.rejects(run, /page changed/);
  assert.deepEqual(events, ['admit']);
});

test('a figure badge works before the first draft and stays bound to the original paper', () => {
  const env = vm.createContext({
    activePanelTabContext: { tabId: 7, key: '7|paper' },
    currentWorkspaceSnapshot: { documentId: 'original', documentHash: 'original-hash',
      localWorkspace: { workspaceId: 'workspace', workspaceGeneration: 1, contentHash: 'source' },
      figures: { workspaceLifecycle: 0 } },
    mechanismChainFingerprint: () => ''
  });
  for (const name of ['mechanismWorkspaceDraft', 'captureFigureWorkspaceEditContext', 'isCurrentFigureBadgeContext']) {
    vm.runInContext(functionSource(popup, name), env);
  }
  const original = env.captureFigureWorkspaceEditContext();
  assert.ok(Number.isNaN(original.draftRevision));
  assert.equal(env.isCurrentFigureBadgeContext(original), true);
  env.currentWorkspaceSnapshot.figures.draft = { revision: 1 };
  assert.equal(env.isCurrentFigureBadgeContext(original), true);
  env.currentWorkspaceSnapshot.documentHash = 'replaced-source';
  assert.equal(env.isCurrentFigureBadgeContext(original), false);
  env.currentWorkspaceSnapshot.documentHash = 'original-hash';
  env.activePanelTabContext.tabId = 8;
  assert.equal(env.isCurrentFigureBadgeContext(original), false);
  assert.match(popup, /summaryHeading\.isConnected && isCurrentFigureBadgeContext\(gestureContext\)/);
});

test('parallel progress is accepted only from the child request registered for that figure and owner', () => {
  const binding = { documentIdentity: 'doc', navigationIdentity: 'page', documentId: 'document',
    workspaceId: 'workspace', workspaceGeneration: 1, workspaceLifecycle: 2 };
  const active = { operationId: 'batch', workspaceLifecycle: 2, progressBinding: binding,
    requestOperationByFigure: new Map([['fig-1', 'child-1'], ['fig-2', 'child-2']]),
    requestOperationIds: new Set(['child-1', 'child-2']) };
  const env = vm.createContext({ figureOperationState: { active }, articleWorkspaceLifecycleGeneration: 2,
    currentFigureLlmProgressBinding: () => binding, crossFigureMechanismOwnData: (entry, key) => entry[key] });
  for (const name of ['sameFigureLlmProgressOwner', 'isCurrentFigureLlmProgress']) {
    vm.runInContext(functionSource(content, name), env);
  }
  const event = { figureId: 'fig-1', operationId: 'child-1', workspaceLifecycle: 2, workspaceId: 'workspace' };
  assert.equal(env.isCurrentFigureLlmProgress(event), true);
  assert.equal(env.isCurrentFigureLlmProgress({ ...event, operationId: 'batch' }), true);
  for (const patch of [{ figureId: 'fig-2' }, { operationId: 'unknown' }, { workspaceId: 'other' },
    { workspaceLifecycle: 3 }, { documentId: 'another-document' }]) {
    assert.equal(env.isCurrentFigureLlmProgress({ ...event, ...patch }), false);
  }
  active.cancelled = true;
  assert.equal(env.isCurrentFigureLlmProgress(event), false);
});

test('two concurrent text fallback decisions remain independently bound to the figure, operation and source', () => {
  const active = {};
  const figures = ['figure-1', 'figure-2'].map(figureId => ({ figureId }));
  const env = vm.createContext({
    figureOperationState: { active }, chrome: { runtime: { id: 'extension' } },
    isCurrentFigureLlmProgress: () => true, sanitizeFigureVisionConfirmation: value => value,
    applyFigureProgressEvent: value => value, publishPublicLlmOperationProgress() {},
    isCurrentFigureOperation: value => value === active, contentDocumentIdentity: 'doc',
    contentNavigationIdentity: () => 'page', articleWorkspaceLifecycleGeneration: 1,
    getFigureWorkspaceInventory() {}, combinedFigureWorkspaceInventory: () => figures,
    SciLLM: { stableHash: value => value }, figureVisionTextSource: figure => figure.figureId
  });
  for (const name of ['applyAndPublishFigureProgressEvent', 'validateFigureVisionConfirmation']) {
    vm.runInContext(functionSource(content, name), env);
  }
  for (const [i, figure] of figures.entries()) {
    const decision = { id: 'decision-' + i, operationId: 'child-' + i, figureId: figure.figureId,
      documentIdentity: 'doc', navigationIdentity: 'page', workspaceLifecycle: 1, sourceSignature: figure.figureId };
    env.applyAndPublishFigureProgressEvent({ ...decision, phase: 'figure_vision_confirmation', visionConfirmation: decision });
  }
  const check = (id, op) => env.validateFigureVisionConfirmation({ id, operationId: op }, { id: 'extension' }).success;
  assert.equal(check('decision-0', 'child-0'), true);
  assert.equal(check('decision-1', 'child-1'), true);
  assert.equal(check('decision-0', 'child-1'), false);
  env.contentDocumentIdentity = 'another-tab';
  assert.equal(check('decision-1', 'child-1'), false);
});

test('an independent batch child can resume its single-Figure budget without widening the current plan', () => {
  const env = vm.createContext({});
  vm.runInContext(functionSource(content, 'selectFigureResumeOperationPlan'), env);
  const figure = { figureId: 'fig-6', panelHints: ['A', 'B'] };
  const current = [{ figureId: 'fig-5', panelCount: 3 }, { figureId: 'fig-6', panelCount: 2 }];
  const checkpoint = { version: 'figure-checkpoint-envelope-v1', operationPlan: [current[1]] };
  const select = cp => env.selectFigureResumeOperationPlan(cp, figure, current, true);
  assert.deepEqual(JSON.parse(JSON.stringify(select(checkpoint))), [current[1]]);
  for (const plan of [[{ ...current[1], panelCount: 3 }], [current[1], { figureId: 'foreign', panelCount: 4 }],
    [current[1], { ...current[0], panelCount: 7 }], []]) {
    assert.equal(select({ ...checkpoint, operationPlan: plan }), current);
  }
  assert.equal(select(null), current);
});

test('imported supplemental PDF figures use their own verified local PNG when the preview is empty', async () => {
  const { createHash, webcrypto } = require('node:crypto');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8MkAAAAASUVORK5CYII=', 'base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const path = 'pdf/figures/supplemental/figure-s1.png';
  const dataUrl = 'data:image/png;base64,' + bytes.toString('base64');
  const workspace = { workspaceId: 'paper', workspaceGeneration: 1, canonicalUrl: 'https://paper.example/article' };
  const image = { sha256, workspacePath: path, mimeType: 'image/png' };
  const figure = { sourceExternal: true, sourceMaterialId: 'supp', figureId: 'supp-paper-s1',
    originalFigureId: 'pdf-s1', imageAssetPath: path, imageSha256: sha256, analysisImages: [] };
  const data = { ...workspace, relativePath: path, sha256, dataUrl, byteLength: bytes.length, found: true };
  let onRead = () => {};
  const env = vm.createContext({ Uint8Array, crypto: webcrypto, atob, currentArticleWorkspace: workspace,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20 * 1024 * 1024, FIGURE_IMAGE_SOURCE_MAX_EDGE: 10000,
    FIGURE_IMAGE_SOURCE_MAX_PIXELS: 40000000, FIGURE_IMAGE_MAX_EDGE: 1600, FIGURE_IMAGE_MAX_BYTES: 1572864,
    articleWorkspaceLifecycleGeneration: 1, articleWorkspaceLifecycleError: () => new Error('stale paper'),
    assertCurrentArticleWorkspaceLifecycle: generation => assert.equal(generation, env.articleWorkspaceLifecycleGeneration),
    supplementalFigureAssets: [{ materialId: 'supp', parentWorkspaceId: 'paper', parentWorkspaceGeneration: 1,
      parentCanonicalUrl: workspace.canonicalUrl, parsedDocument: { pdfFigureManifest: { source: 'pdffigures2',
        status: 'ready', figures: [{ figureId: 'pdf-s1', image }] } } }],
    chrome: { runtime: { sendMessage: async message => {
      assert.equal(message.relativePath, path);
      assert.equal(message.workspaceId, 'paper');
      onRead();
      return { success: true, data };
    } } } });
  for (const name of ['figureImageError', 'figureDataUrlBytes', 'admitFigureImageDimensions', 'readFigureImageDimensions',
    'decodePdfFigureProductionBytes', 'importedPdfFigureImageRef', 'readImportedPdfFigureImage', 'ensureNativePdfFigureImages']) {
    vm.runInContext(functionSource(content, name), env);
  }
  const prepared = await env.ensureNativePdfFigureImages(figure);
  assert.equal(prepared[0].dataUrl, dataUrl);
  assert.equal(figure.analysisImages.length, 0, 'loading an original must preserve its source revision');
  assert.equal(await env.readImportedPdfFigureImage({ ...figure, originalFigureId: 'other' }), null);
  const corrupted = Buffer.from(bytes);
  corrupted[40] ^= 1;
  data.dataUrl = 'data:image/png;base64,' + corrupted.toString('base64');
  await assert.rejects(env.readImportedPdfFigureImage(figure), { code: 'FIGURE_IMAGE_INVALID' });
  data.dataUrl = dataUrl;
  onRead = () => { workspace.workspaceGeneration++; };
  await assert.rejects(env.readImportedPdfFigureImage(figure), /stale paper/);
});

test('the PDF source and its saved editable figure count once only if their image evidence matches', () => {
  const { matchSupplementalPdfInventoryEntry, normalizeSupplementalFigure } = require('../extension/core/supplemental-materials.js');
  const image = { workspacePath: 'pdf/figures/supplemental/s1.png', sha256: 'a'.repeat(64) };
  const entry = { figureLabel: 'Figure S1', figureId: 'pdf-s1', image };
  const asset = { materialId: 'supp', parsedDocument: { pdfFigureManifest: { documentFingerprint: 'b'.repeat(64) } } };
  const raw = { ...entry, caption: 'Supplementary figure', sourceMaterialId: 'supp', imageAssetPath: image.workspacePath,
    imageSha256: image.sha256, sourceDocumentFingerprint: 'b'.repeat(64) };
  const canonical = normalizeSupplementalFigure(raw, asset);
  asset.figures = [raw, canonical];
  assert.equal(matchSupplementalPdfInventoryEntry(asset, entry), canonical);
  for (const patch of [{ imageSha256: 'c'.repeat(64) }, { originalFigureId: 'unrelated' },
    { sourceMaterialId: 'other' }, { sourceDocumentFingerprint: null }, { caption: 'Other figure' }]) {
    assert.equal(matchSupplementalPdfInventoryEntry({ ...asset, figures: [raw, { ...canonical, ...patch }] }, entry), null);
  }
});
