const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFigureWorkspaceDraft, createFigureWorkspaceDraftController } =
  require('../core/figure-workspace.js');

const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');

// Use production functions, with the same extraction convention as the existing
// content contract suites. Do not copy the admission or result-commit branches.
function functionSource(name) {
  let start = content.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing production function: ${name}`);
  if (content.slice(start - 6, start) === 'async ') start -= 6;
  const bodyStart = content.indexOf(') {', start) + 2;
  assert.ok(bodyStart > start, `missing function body: ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < content.length; index += 1) {
    if (content[index] === '{') depth += 1;
    if (content[index] === '}') depth -= 1;
    if (!depth) return content.slice(start, index + 1);
  }
  assert.fail(`unterminated function: ${name}`);
}

function productionFunctions(names, dependencies, prefix = '') {
  return new Function(...Object.keys(dependencies), `${prefix}\n` +
    names.map(functionSource).join('\n') +
    `\nreturn { ${names.join(', ')} };`
  )(...Object.values(dependencies));
}

const documentHash = 'a'.repeat(64);
const binding = { documentHash, documentGeneration: 3, semanticRevision: 5 };
const semanticContextDigest = 'b'.repeat(64);
const pngDataUrl = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';

function preparationHarness(mutateDuringDecode = () => {}) {
  const source = { dataUrl: pngDataUrl, mediaType: 'image/png', width: 1, height: 1,
    sourcePage: 1, sourceKind: 'pdf-original-page', workspacePath: 'pdf/figures/source.png',
    sha256: 'c'.repeat(64) };
  const figure = { figureId: 'figure-1', figureLabel: 'Figure 1', pageNumber: 1,
    pageNumbers: [1], analysisImages: [source], panelHints: ['D'] };
  const effects = { decoded: [], parentRegistrations: [], childRegistrations: [],
    records: [], released: 0 };
  const globals = {
    __brevessPdfSemanticDocument: { documentHash, documentGeneration: 3, revision: 5 },
    __brevessPdfSemanticCompatibility: {},
    __brevessNativePdfDocument: { structure: { documentHash }, documentGeneration: 3, pageCount: 1 },
    __brevessNativePdfFigures: { figures: [figure] }
  };
  const parentProof = { assetId: `pdfa-${'1'.repeat(48)}`,
    imageContentHash: source.sha256, ...binding, figureId: figure.figureId,
    width: 1, height: 1, sourceType: 'full-figure', assetRevision: 1 };
  const registry = {
    async register(input) {
      effects.childRegistrations.push(structuredClone(input));
      return { ...input, assetId: `pdfa-${'2'.repeat(48)}`,
        imageContentHash: 'd'.repeat(64), assetRevision: 1, cropRevision: 1 };
    },
    async resolveForRequest({ expected }) { return { descriptor: expected }; }
  };
  const api = productionFunctions([
    'pdfFigureProductionError', 'pdfFigureProductionSourceSignature',
    'currentPdfFigureProductionBinding', 'selectNativePdfFigurePanelSource',
    'prepareFigurePanelImageVariants'
  ], {
    globalThis: globals,
    console: { warn() {} },
    requireFigureTaskAdmission() {},
    ensureNativePdfFigureImages: async () => {},
    activeNativePdfStructure: () => globals.__brevessNativePdfDocument.structure,
    FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 12000,
    admitFigureProviderImages: async images => {
      const decodedFrom = images[0].dataUrl;
      effects.decoded.push(decodedFrom);
      await Promise.resolve();
      mutateDuringDecode(figure);
      return { images: [{ ...images[0], dataUrl: decodedFrom }],
        decodedSources: [{ naturalWidth: 1, naturalHeight: 1, decodedFrom }] };
    },
    validateFigureProviderImageDimensions: image => ({ image }),
    admitFigureImageDimensions() {},
    figureImageDiagnosticCode: error => error?.code || 'FIGURE_IMAGE_INVALID',
    figureImagePixelArea: () => 1,
    normalizePanelCropGeometry: () => null,
    encodeFigureImageVariant: image => ({ dataUrl: image.decodedFrom,
      mediaType: 'image/png', width: 1, height: 1, maxEdge: 1 }),
    releaseFigureImage() { effects.released += 1; },
    decodePdfFigureProductionBytes: dataUrl => Buffer.from(dataUrl.split(',')[1], 'base64'),
    pdfFigureAssetRegistry: registry,
    async buildPdfFigureProductionEnvelope(_figure, options) {
      if (!options.assetProof) effects.parentRegistrations.push(structuredClone(options.images[0]));
      return { version: 'pdf-figure-production-envelope-v1', verified: true,
        route: 'vision', binding, semanticContextDigest,
        figure: { figureId: figure.figureId }, assetProof: options.assetProof || parentProof };
    },
    recordPdfFigureProductionEnvelope(figureId, envelope, owner, parentImage) {
      effects.records.push({ figureId, envelope, owner, parentImage });
      return envelope;
    }
  });
  return { figure, source, effects,
    run: () => api.prepareFigurePanelImageVariants(figure, 'D', {
      route: { capabilityMode: 'vision' }
    }, 'figure_panel_interpretation') };
}

async function expectDecodeMutationRejected(mutate) {
  const harness = preparationHarness(mutate);
  await assert.rejects(harness.run(), error =>
    ['PDF_FIGURE_CONTEXT_STALE', 'PDF_FIGURE_ASSET_SOURCE_UNVERIFIED'].includes(error?.code));
  assert.equal(harness.effects.decoded.length, 1, 'exercise the real decode await');
  assert.equal(harness.effects.parentRegistrations.length, 0,
    'changed source must be rejected before registering a parent');
  assert.equal(harness.effects.childRegistrations.length, 0,
    'changed source must be rejected before registering a child');
  assert.equal(harness.effects.records.length, 0);
}

test('native Panel preparation rejects OLD to NEW replacement during decode before registering assets', async () => {
  await expectDecodeMutationRejected(figure => {
    figure.analysisImages = [{ ...figure.analysisImages[0],
      dataUrl: 'data:image/png;base64,TkVX' }];
  });
});

for (const [field, replacement] of [
  ['sourcePage', 2], ['sourceKind', 'pdf-whole-figure'],
  ['workspacePath', 'pdf/figures/replaced.png'], ['sha256', 'e'.repeat(64)]
]) {
  test(`native Panel preparation rejects same-byte ${field} mutation during decode`, async () => {
    await expectDecodeMutationRejected(figure => {
      figure.analysisImages[0][field] = replacement;
    });
  });
}

test('native Panel preparation registers the unchanged decoded source and its child', async () => {
  const harness = preparationHarness();
  const variants = await harness.run();
  assert.equal(variants.length, 1);
  assert.equal(harness.effects.parentRegistrations.length, 1);
  assert.equal(harness.effects.childRegistrations.length, 1);
  assert.equal(harness.effects.records.length, 1);
  assert.equal(harness.effects.parentRegistrations[0].dataUrl, harness.effects.decoded[0]);
  assert.equal(variants[0].dataUrl, harness.effects.decoded[0]);
  assert.equal(variants[0].assetProof.parentAssetId,
    harness.effects.records[0].envelope.assetProof.parentAssetId);
  assert.equal(harness.effects.records[0].parentImage.dataUrl, harness.source.dataUrl);
  assert.equal(harness.effects.released, 1);
});

function responseHarness(requestMode, stale = true, mergeAwaitStage = '') {
  const effects = { providerCalls: 0, draftWrites: 0, durableWrites: 0,
    mergeAwaitMutations: 0, resultStateWrites: [], persisted: [] };
  const resultFields = new Set(['standard', 'panelAnalyses', 'panelFollowups', 'panelFollowupHistories']);
  const operation = { operationId: 'panel-admission-test', generation: 1,
    cancelled: false, paused: false, waiters: [] };
  const trackedMap = (name, initial = {}) => new Proxy(initial, {
    set(target, key, value) {
      effects.resultStateWrites.push(`${name}.${String(key)}`);
      target[key] = value;
      return true;
    }
  });
  const figure = { figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['D'],
    caption: '(D) Treatment result.', contextParagraphs: [] };
  const state = new Proxy({ figure, standard: { panels: [{ panel: 'D',
    directObservation: 'previous observation' }] },
    panelAnalyses: trackedMap('panelAnalyses'),
    panelFollowups: trackedMap('panelFollowups'),
    panelFollowupHistories: trackedMap('panelFollowupHistories'),
    panelAnalysisLoading: {}, panelAnalysisErrors: {},
    panelFollowupLoading: {}, panelFollowupErrors: {} }, {
    set(target, key, value) {
      if (resultFields.has(key)) effects.resultStateWrites.push(String(key));
      target[key] = value;
      return true;
    }
  });
  const currentEnvelope = { binding, semanticContextDigest, assetProof: null };
  const proof = { figureId: figure.figureId, binding,
    semanticContextDigest: stale ? 'f'.repeat(64) : semanticContextDigest, assetProof: null };
  const result = requestMode === 'interpretation'
    ? { panel: 'D', directObservation: 'new observation', pdfEvidenceBinding: proof }
    : { figureId: figure.figureId, panel: 'D', answer: 'new answer',
      basis: 'caption_context', sourceRefs: [], pdfEvidenceBinding: proof };
  const normalizers = content.slice(content.indexOf('function isSafePanelFollowupDataRecord('),
    content.indexOf('async function askFigurePanelWithLLM('));
  const dependencies = {
    articleWorkspaceLifecycleGeneration: 7,
    document: { title: 'Native PDF' },
    SciLLM: { normalizePanelFollowupTopics: value => value,
      normalizePanelCustomQuestion: value => String(value || '').trim(),
      figurePanelDisplayId: () => '1D' },
    normalizeRequestedPanelId: value => String(value || '').toUpperCase(),
    preflightFigureTaskRoute: async taskId => ({ taskId,
      route: { capabilityMode: 'caption_text_only' } }),
    assertCurrentArticleWorkspaceLifecycle: expected => assert.equal(expected, 7),
    recoverPendingFigureOperationRelease: async () => {},
    getFigureWorkspaceInventory: () => [],
    ensureFigureWorkspaceInventorySeeded: async () => {},
    synchronizeFigureWorkspaceLifecycle: async () => {},
    ensureFigureWalkthroughState: () => state,
    getActiveFigureAnalysisForDomino: () => state.standard,
    reuseActiveFigureAnalysisPromise: () => null,
    beginFigureOperation: () => operation,
    figureOperationState: { active: operation },
    beginSingleFigureProgress() {}, updateFigureProgress() {},
    computePageDocumentHash: async () => documentHash,
    prepareFigurePanelProductionInput: async () => ({ imageVariants: [],
      pdfFigureContext: currentEnvelope }),
    buildFigurePanelProviderContract: () => ({}),
    sendFigureAnalysisRequestWithReceipt: async () => {
      effects.providerCalls += 1;
      return { success: true, data: {
        [requestMode === 'interpretation' ? 'panelAnalysis' : 'panelFollowup']: result
      } };
    },
    activeNativePdfStructure: () => ({ documentHash }),
    getPdfFigureProductionEnvelope: () => currentEnvelope,
    mergeCompletedFigureResultIntoWorkspaceDraft: async () => { effects.draftWrites += 1; },
    mergeSinglePanelIntoFigureResult: (previous, panel) => ({ ...previous, panels: [panel] }),
    persistImportedSupplementalFigureState: async (_figure, _state, options) => {
      effects.persisted.push(options.stateFields);
      return { saved: true };
    },
    scheduleCurrentArticleArchiveSave() {}, scheduleArticleWorkspaceArtifactsSave() {},
    captureFigureOperationPrimaryError() {}, finishSingleFigureProgress() {},
    finishFigureOperation: async () => {}
  };
  let controller = null;
  let initialDraft = null;
  if (mergeAwaitStage) {
    const mutateCurrentOwner = () => {
      effects.mergeAwaitMutations += 1;
      if (mergeAwaitStage.endsWith('-cancel')) operation.cancelled = true;
      else currentEnvelope.semanticContextDigest = 'f'.repeat(64);
    };
    controller = createFigureWorkspaceDraftController({
      initialDraft: createFigureWorkspaceDraft([figure]),
      initialCheckpoint: { revision: 7, contentHash: 'checkpoint-before' },
      persist: async request => {
        await Promise.resolve();
        if (mergeAwaitStage.startsWith('persist')) mutateCurrentOwner();
        if (request.assertCommitCurrent) request.assertCommitCurrent();
        effects.durableWrites += 1;
        return { revision: 8, contentHash: 'checkpoint-after' };
      }
    });
    initialDraft = controller.getDraft();
    const mergeApi = productionFunctions(['mergeCompletedFigureResultIntoWorkspaceDraft'], {});
    dependencies.mergeCompletedFigureResultIntoWorkspaceDraft = (inputFigure, modelResult, options) =>
      mergeApi.mergeCompletedFigureResultIntoWorkspaceDraft(inputFigure, modelResult, {
        ...options,
        getLifecycle: () => 7,
        ensureController: async () => {
          await Promise.resolve();
          if (mergeAwaitStage.startsWith('controller')) mutateCurrentOwner();
          return controller;
        },
        getActiveController: () => controller,
        commit() { effects.draftWrites += 1; }
      });
  }
  const api = productionFunctions([
    'isCurrentFigureOperation', 'waitForLocalOperation',
    'cancelledOperationError', 'throwStaleFigureOperation',
    'pdfFigureProductionError', 'samePdfFigureProductionBinding',
    'samePdfFigureProductionAssetProof', 'assertCurrentPdfFigurePanelResult',
    'analyzeSingleFigurePanelWithLLM', 'askFigurePanelWithLLM'
  ], dependencies, `let figureDepthAnalysisId = '', figureDepthAnalysisKind = '';
    let figureDepthAnalysisPromise = null;
    ${normalizers}`);
  return { effects, state, result, controller, initialDraft,
    run: options => requestMode === 'interpretation'
      ? api.analyzeSingleFigurePanelWithLLM(figure.figureId, 'D', options || {})
      : api.askFigurePanelWithLLM(figure.figureId, 'D', [], 'What changed?') };
}

for (const mode of ['interpretation', 'followup']) {
  test(`native Panel ${mode} rejects stale returned binding before draft or result state writes`, async () => {
    const harness = responseHarness(mode);
    await assert.rejects(harness.run(), { code: 'PDF_FIGURE_CONTEXT_STALE' });
    assert.equal(harness.effects.providerCalls, 1, 'exercise the actual response entry point');
    assert.equal(harness.effects.draftWrites, 0);
    assert.deepEqual(harness.effects.resultStateWrites, []);
    assert.deepEqual(harness.effects.persisted, []);
    assert.equal(harness.state.standard.panels[0].directObservation, 'previous observation');
  });

  test(`native Panel ${mode} accepts a current returned binding in the same harness`, async () => {
    const harness = responseHarness(mode, false);
    const response = await harness.run();
    assert.equal(response.success, true);
    assert.equal(harness.effects.providerCalls, 1);
    assert.ok(harness.effects.resultStateWrites.length > 0);
    assert.equal(harness.effects.persisted.length, 1);
  });
}

test('deferred Panel interpretation also rejects a stale result before exposing it to the caller', async () => {
  const harness = responseHarness('interpretation');
  await assert.rejects(harness.run({ deferMerge: true }), { code: 'PDF_FIGURE_CONTEXT_STALE' });
  assert.equal(harness.effects.draftWrites, 0);
  assert.deepEqual(harness.effects.resultStateWrites, []);
});

for (const stage of ['controller', 'persist']) {
  test(`Panel interpretation rejects owner changes during the real merge ${stage} await before commit`, async () => {
    const harness = responseHarness('interpretation', false, stage);
    await assert.rejects(harness.run(), { code: 'PDF_FIGURE_CONTEXT_STALE' });
    assert.equal(harness.effects.providerCalls, 1);
    assert.equal(harness.effects.mergeAwaitMutations, 1,
      'the returned binding was current until the merge helper awaited');
    assert.equal(harness.effects.durableWrites, 0);
    assert.equal(harness.effects.draftWrites, 0);
    assert.deepEqual(harness.effects.resultStateWrites, []);
    assert.deepEqual(harness.effects.persisted, []);
    assert.deepEqual(harness.controller.getDraft(), harness.initialDraft);
    assert.deepEqual(harness.controller.getCheckpoint(), {
      revision: 7, contentHash: 'checkpoint-before'
    });
  });
}

test('Panel interpretation commits through the real merge helper when its owner stays current', async () => {
  const harness = responseHarness('interpretation', false, 'unchanged');
  assert.equal((await harness.run()).success, true);
  assert.equal(harness.effects.mergeAwaitMutations, 0);
  assert.equal(harness.effects.durableWrites, 1);
  assert.equal(harness.effects.draftWrites, 1);
  assert.ok(harness.effects.resultStateWrites.length > 0);
  assert.notDeepEqual(harness.controller.getDraft(), harness.initialDraft);
});

for (const stage of ['controller', 'persist']) {
  test(`Panel interpretation cancelled during the real merge ${stage} await cannot commit`, async () => {
    const harness = responseHarness('interpretation', false, `${stage}-cancel`);
    await assert.rejects(harness.run(), { code: 'CANCELLED' });
    assert.equal(harness.effects.mergeAwaitMutations, 1);
    assert.equal(harness.effects.durableWrites, 0);
    assert.equal(harness.effects.draftWrites, 0);
    assert.deepEqual(harness.effects.resultStateWrites, []);
    assert.deepEqual(harness.effects.persisted, []);
    assert.deepEqual(harness.controller.getDraft(), harness.initialDraft);
  });
}

test('PDF workspace preparation and chat regeneration contain no misplaced Panel result guard', () => {
  for (const name of ['prepareNativePdfWorkspace', 'regenerateArticleChatTurn']) {
    assert.doesNotMatch(functionSource(name), /\bassertCurrentPdfFigurePanelResult\s*\(/u,
      `${name} has no Panel state/response locals and must not call the Panel result guard`);
  }
});
