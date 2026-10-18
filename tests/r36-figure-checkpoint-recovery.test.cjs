'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { functionSource } = require('./helpers/r28-full07-source.js');
const recoveryApi = require('../core/figure-panel-recovery.js');

const content = fs.readFileSync(require.resolve('../content.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const router = fs.readFileSync(require.resolve('../core/background-router.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const hash = value => crypto.createHash('sha256')
  .update(JSON.stringify(value)).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const figureId = 'figure-r36-16';
const panels = [...'ABCDEFGHIJKLMNOP'];

function indentedRouterFunction(name) {
  const start = router.indexOf(`      function ${name}(`);
  const end = router.indexOf(
    '\n      async function validateResumeCheckpoint(',
    start
  );
  assert.ok(start >= 0 && end > start, `${name} production function`);
  return router.slice(start + 6, end);
}

function panel(label, value = 'recovered evidence') {
  return {
    panel: label,
    status: 'resolved',
    directObservation: value
  };
}

function result(panelLabels, { final = false, operationId = '' } = {}) {
  const expectedPanels = panels.slice();
  const value = {
    figureId,
    analysisDepth: 'standard',
    basis: 'vision_text',
    panels: panelLabels.map(label => panel(label)),
    panelCoverage: {
      expectedPanels,
      returnedPanels: panelLabels.slice(),
      missingPanels: expectedPanels.filter(label => !panelLabels.includes(label))
    }
  };
  if (final) {
    value.figureQuestion = 'How do the sixteen Panels support the Figure?';
    value.coreConclusion = 'The signed Figure result is complete.';
  }
  if (operationId) value.operationId = operationId;
  return value;
}

function envelope(figureResult, { operationPlan = true } = {}) {
  const binding = {
    version: 'figure-checkpoint-envelope-v1',
    implementationVersion: 'r36-test',
    figureId,
    analysisDepth: 'standard',
    inputDigest: '1'.repeat(64),
    routeDigest: '2'.repeat(64),
    taskPolicyDigest: '3'.repeat(64),
    planDigest: '4'.repeat(64),
    ...(operationPlan ? {
      operationPlan: [{ figureId, panelCount: 16 }]
    } : {}),
    immutableLimit: 96
  };
  const value = {
    ...binding,
    bindingDigest: hash(binding),
    inputMode: 'figure_image',
    visionFallback: false,
    fallbackReason: '',
    resultDigest: hash(figureResult),
    figureResult
  };
  return value;
}

function checkpointContext(durableContent) {
  const assets = new Map([[
    'figures/inventory.json',
    {
      revision: 1,
      contentHash: hash(durableContent),
      content: plain(durableContent)
    }
  ]]);
  const c = vm.createContext({
    console,
    structuredClone,
    articleWorkspaceLifecycleGeneration: 7,
    currentArticleWorkspace: { workspaceId: 'workspace-r36', workspaceGeneration: 1 },
    SciLLM: {
      ...recoveryApi,
      captureFigureResultInputHashes: () => ({ standard: '', deep: '' }),
      captureFigureResultPolicySignatures: () => ({ standard: '', deep: '' }),
      rebindFigureContextLocators: (_before, after) => ({
        paragraphs: after,
        locators: []
      })
    }
  });
  c.getWorkspaceAssetCheckpoint = async path => assets.get(path) || null;
  c.persistWorkspaceAssetCheckpoint = async (path, value, options) => {
    const prior = assets.get(path);
    assert.equal(options.expectedRevision, prior?.revision || 0);
    assert.equal(options.expectedContentHash, prior?.contentHash || '');
    const next = {
      revision: (prior?.revision || 0) + 1,
      contentHash: hash(value),
      content: plain(value)
    };
    assets.set(path, next);
    return { saved: true, asset: next, content: next.content };
  };
  vm.runInContext(
    functionSource(content, 'persistFigureInventoryWithCasMutation'), c
  );
  return { c, assets };
}

test('R36 checkpoint recovery materializes a validated recovered Panel without changing the signed base', () => {
  const base = result(panels.slice(0, 15));
  const merged = recoveryApi.mergePanelCheckpointRecovery(
    base,
    [panel('P', 'the recovered Panel pixel evidence')],
    panels
  );
  assert.deepEqual(merged.recoveredPanels, ['P']);
  assert.deepEqual(merged.missingPanels, []);
  assert.equal(merged.result.panels.length, 16);
  assert.equal(base.panels.length, 15, 'the signed base is never mutated');

  assert.throws(
    () => recoveryApi.mergePanelCheckpointRecovery(
      base,
      [panel('A', 'cannot replace signed evidence')],
      panels
    ),
    error => error.code === 'PANEL_CHECKPOINT_SIGNED_PANEL_CHANGED'
  );
  assert.throws(
    () => recoveryApi.mergePanelCheckpointRecovery(
      base,
      [panel('Q', 'foreign Panel')],
      panels
    ),
    error => error.code === 'PANEL_CHECKPOINT_UNEXPECTED'
  );
});

test('R36 router accepts only base-bound recovery proposal deltas', () => {
  const c = vm.createContext({
    figure: { figureId, panelHints: panels },
    analysisDepth: 'standard',
    isPlainObject: value => value && typeof value === 'object' &&
      !Array.isArray(value),
    figureContractError: code => Object.assign(new Error(code), { code }),
    shared: { mergePanelCheckpointRecovery: recoveryApi.mergePanelCheckpointRecovery }
  });
  vm.runInContext(indentedRouterFunction('applyResumeRecoveryProposal'), c);
  const base = result(panels.slice(0, 15));
  const checkpoint = envelope(base);
  const proposal = {
    version: 'figure-panel-checkpoint-recovery-v1',
    figureId,
    analysisDepth: 'standard',
    baseResultDigest: checkpoint.resultDigest,
    recoveredPanels: [panel('P')]
  };
  const applied = c.applyResumeRecoveryProposal(checkpoint, proposal);
  assert.deepEqual(applied.result.panels.map(row => row.panel), panels);
  assert.throws(
    () => c.applyResumeRecoveryProposal(checkpoint, {
      ...proposal, recoveredPanels: [panel('Q')]
    }),
    error => error.code === 'FIGURE_CHECKPOINT_INVALID'
  );
});

test('R36 content CAS persists a recovered Panel proposal while retaining the base envelope', async () => {
  const baseResult = result(panels.slice(0, 15));
  const mergedResult = result(panels);
  mergedResult.panels[15] = panel('P', 'the recovered Panel pixel evidence');
  const baseEnvelope = envelope(baseResult);
  const durable = {
    schemaVersion: 1,
    figures: [{
      figureId,
      panelHints: panels,
      figureInputHash: 'r36-input',
      pendingStandard: { ...baseResult, operationId: 'checkpoint-owner' },
      pendingStandardCheckpointEnvelope: baseEnvelope
    }]
  };
  const incoming = {
    schemaVersion: 1,
    figures: [{
      figureId,
      panelHints: panels,
      figureInputHash: 'r36-input',
      pendingStandard: { ...mergedResult, operationId: 'checkpoint-owner' },
      pendingStandardCheckpointEnvelope: baseEnvelope
    }]
  };
  const { c, assets } = checkpointContext(durable);
  await c.persistFigureInventoryWithCasMutation(incoming, {
    figureId,
    analysisDepth: 'standard',
    checkpointEnvelope: baseEnvelope,
    checkpointResultProposal: {
      version: 'figure-panel-checkpoint-recovery-v1',
      figureId,
      analysisDepth: 'standard',
      baseResultDigest: baseEnvelope.resultDigest,
      recoveredPanels: [panel('P', 'the recovered Panel pixel evidence')]
    },
    pendingOperationId: 'checkpoint-owner'
  });
  const saved = assets.get('figures/inventory.json').content.figures[0];
  assert.deepEqual(saved.pendingStandard.panels.map(row => row.panel),
    panels);
  assert.deepEqual(saved.pendingStandardCheckpointEnvelope, baseEnvelope,
    'recovery must not forge or replace the signed base envelope');

  await assert.rejects(
    c.persistFigureInventoryWithCasMutation(incoming, {
      figureId,
      analysisDepth: 'standard',
      checkpointEnvelope: baseEnvelope,
      checkpointResultProposal: {
        version: 'figure-panel-checkpoint-recovery-v1',
        figureId,
        analysisDepth: 'standard',
        baseResultDigest: baseEnvelope.resultDigest,
        recoveredPanels: [panel('Q', 'foreign Panel')]
      },
      pendingOperationId: 'checkpoint-owner'
    }),
    error => error.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
});

test('R36 legacy finalized checkpoint without an operationPlan can clear only with exact signed coverage', async () => {
  const finalResult = result(panels, { final: true, operationId: 'completion-owner' });
  const unsignedFinal = { ...finalResult };
  delete unsignedFinal.operationId;
  const baseEnvelope = envelope(unsignedFinal, { operationPlan: false });
  const durable = {
    schemaVersion: 1,
    figures: [{
      figureId,
      panelHints: panels,
      pendingStandard: { ...finalResult, operationId: 'checkpoint-owner' },
      pendingStandardCheckpointEnvelope: baseEnvelope
    }]
  };
  const incoming = {
    schemaVersion: 1,
    figures: [{
      figureId,
      panelHints: panels,
      standard: finalResult,
      analysisStatus: 'complete'
    }]
  };
  const { c, assets } = checkpointContext(durable);
  await c.persistFigureInventoryWithCasMutation(incoming, {
    figureId,
    analysisDepth: 'standard',
    operationId: 'completion-owner',
    pendingOperationId: 'checkpoint-owner',
    clearCheckpointEnvelope: baseEnvelope
  });
  const saved = assets.get('figures/inventory.json').content.figures[0];
  assert.equal(saved.pendingStandard, undefined);
  assert.equal(saved.pendingStandardCheckpointEnvelope, undefined);
  assert.equal(saved.standard.operationId, 'completion-owner');
});

test('R36 repeated final save after an acknowledged clear is idempotent and keeps the committed operation', async () => {
  const finalResult = result(panels, { final: true, operationId: 'completion-original' });
  const unsignedFinal = { ...finalResult };
  delete unsignedFinal.operationId;
  const clearEnvelope = envelope(unsignedFinal);
  const durable = {
    schemaVersion: 1,
    figures: [{
      figureId,
      panelHints: panels,
      standard: finalResult,
      analysisStatus: 'complete'
    }]
  };
  const retriedResult = {
    ...plain(finalResult),
    operationId: 'completion-retry'
  };
  const incoming = {
    schemaVersion: 1,
    figures: [{
      figureId,
      panelHints: panels,
      standard: retriedResult,
      analysisStatus: 'complete'
    }]
  };
  const { c, assets } = checkpointContext(durable);
  await c.persistFigureInventoryWithCasMutation(incoming, {
    figureId,
    analysisDepth: 'standard',
    operationId: 'completion-retry',
    clearCheckpointEnvelope: clearEnvelope
  });
  const saved = assets.get('figures/inventory.json').content.figures[0];
  assert.equal(saved.standard.operationId, 'completion-original');
});

test('R36 a successful supplemental viewer source is reused by the analysis image path', async () => {
  const c = vm.createContext({
    console,
    articleWorkspaceLifecycleGeneration: 7,
    figureViewerAnalysisSourceAdoptions: new Map(),
    figureWalkthroughState: new Map(),
    Blob: class SyntheticBlob {},
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL: () => {} },
    loadFigureImage: async () => ({ width: 1200, height: 800 }),
    releaseFigureImage: () => {},
    encodeFigureImage: () => ({
      mediaType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,AA==',
      width: 1200,
      height: 800
    }),
    admitFigureProviderImages: async images => ({
      images: Array.isArray(images) ? images.slice() : [],
      rejected: false,
      truncated: false
    }),
    preferHigherResolutionFigureImages: (prepared, persisted) =>
      prepared.length ? prepared : persisted,
    persistImportedSupplementalFigureState: async () => ({ saved: true }),
    figureImageError: code => Object.assign(new Error(code), { code }),
    requireFigureTaskAdmission: () => {},
    ensureNativeTiffFigureImage: async () => {},
    ensureNativePdfFigureImages: async () => {},
    shouldUpgradePersistedFigureImage: () => false,
    figureImageDiagnosticCode: error => error?.code || 'FIGURE_IMAGE_INVALID',
    FIGURE_IMAGE_LIMIT: 8,
    FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000
  });
  vm.runInContext([
    functionSource(content, 'figureViewerAnalysisSourceKey'),
    functionSource(content, 'getAdoptedFigureViewerAnalysisImages'),
    functionSource(content, 'adoptFigureViewerAnalysisSource'),
    functionSource(content, 'prepareFigureImages')
  ].join('\n'), c);
  const figure = {
    figureId: 'supplemental-r36',
    sourceExternal: true,
    sourceMaterialId: 'material-r36',
    sourceUrl: 'https://example.org/supplement.pdf',
    sourceFingerprint: 'sha256:' + 'a'.repeat(64),
    imageElements: []
  };
  const images = await c.adoptFigureViewerAnalysisSource(figure, {
    bytes: new Uint8Array([1, 2, 3]),
    contentType: 'image/png'
  });
  assert.equal(images.length, 1);
  const prepared = await c.prepareFigureImages(
    figure, { route: { capabilityMode: 'vision' } }, 'figure_walkthrough'
  );
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].dataUrl, 'data:image/jpeg;base64,AA==');
});

