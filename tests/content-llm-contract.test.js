const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const FigureWorkspace = require('../core/figure-workspace.js');
const FigureAnalysis = require('../core/figure-analysis.js');
const FigureResultBinding = require('../core/figure-result-binding.js');
const FigureViewer = require('../core/figure-viewer.js');
const EvidenceFirstMechanism = require('../core/evidence-first-mechanism.js');
const ArticleChatWebSources = require('../core/article-chat-web-sources.js');
const ArticleChat = require('../core/article-chat.js');
const ArticleChatAttachments = require('../core/article-chat-attachments.js');
require('../core/operation-control.js');
require('../core/analysis-cache.js');
require('../core/mechanism-operation-coordinator.js');
const { createBackgroundRouter } = require('../core/background-router.js');
const { CONTENT_SCRIPT_REVISION } = require('../core/tab-messenger.js');
const {
  executeContentRevisionAssignment
} = require('./helpers/content-revision-runtime.js');

const EVIDENCE_FIRST_VERSIONS = EvidenceFirstMechanism.EVIDENCE_FIRST_VERSIONS;

function mechanismInvalidationHarness(state = {}, environment = {}) {
  const create = executableContentFunction('createCrossFigureLogicState');
  const draft = environment.draft || FigureWorkspace.createFigureWorkspaceDraft([]);
  const runtime = environment.runtime || null;
  const admissions = environment.admissions || new Map();
  const cleanup = environment.cleanup || new Map();
  const value = { ...create(), ...state };
  return Function('crossFigureLogicState', 'figureWorkspaceDraft',
    'crossFigureLogicRuntime', 'crossFigureLogicPromise', 'crossFigureLogicAdmissions',
    'crossFigureLogicCleanupIntents', 'supplementalFigureAssetsFingerprint',
    'createCrossFigureLogicState', `${contentFunctionSource('invalidateCrossFigureLogic')}
      return { invalidate: invalidateCrossFigureLogic, state: () => crossFigureLogicState,
        draft: figureWorkspaceDraft, runtime: crossFigureLogicRuntime,
        admissions: crossFigureLogicAdmissions, cleanup: crossFigureLogicCleanupIntents };`)(
    value, draft, runtime, environment.promise || null, admissions, cleanup,
    'supplemental-after-figure-update', create);
}

test('MECH-008 empty invalidation: a Figure update before any mechanism run remains idle', () => {
  const h = mechanismInvalidationHarness();
  h.invalidate();
  assert.equal(h.state().status, 'idle');
  assert.deepEqual(h.state().audit, { code: '', updatedAt: 0 });
  assert.equal(h.state().operation, null);
  assert.equal(h.state().result, null);
  assert.equal(h.state().pendingResult, null);
  assert.equal(h.state().progress, null);
  assert.equal(h.state().supplementalFingerprint, 'supplemental-after-figure-update');
});

test('MECH-008 empty invalidation: repeated Figure edits preserve notes without inventing mechanism history', () => {
  let draft = FigureWorkspace.createFigureWorkspaceDraft([
    { figureId: 'figure-1', figureLabel: 'Figure 1', caption: '(A) Result.', panelHints: ['A'] }
  ]);
  draft = FigureWorkspace.applyFigureWorkspaceMutation(draft, {
    type: 'set_panel_field', figureId: 'figure-1', panelId: 'A', field: 'note',
    value: 'Keep the reviewed Figure note', expectedRevision: draft.revision
  }, 42);
  const before = JSON.stringify(draft), h = mechanismInvalidationHarness({}, { draft });
  h.invalidate('Supplemental Figure changed');
  h.invalidate();
  assert.equal(h.state().status, 'idle');
  assert.equal(h.state().audit.code, '');
  assert.equal(JSON.stringify(h.draft), before);
});

for (const [label, state] of [
  ['complete result', { result: task8MechanismResult(), status: 'complete' }],
  ['pending result', { pendingResult: task8MechanismResult(), status: 'needs_review' }],
  ['result despite idle label', { result: task8MechanismResult() }],
  ['pending despite idle label', { pendingResult: task8MechanismResult() }],
  ['operation despite idle label', { operation: task8MechanismOperation() }],
  ['progress despite idle label', { progress: { stage: 'collecting_panel_evidence' } }],
  ['recorded failure despite idle label', { audit: { code: 'PROVIDER_UNAVAILABLE', updatedAt: 10 } }],
  ['recorded attempt timestamp', { audit: { code: '', updatedAt: 10 } }],
  ...['queued', 'working', 'retrying', 'failed', 'cancelled', 'revision_conflict']
    .map(status => [status, { status }])
]) test(`MECH-008 empty invalidation: ${label} retains the existing conflict transition`, () => {
  const h = mechanismInvalidationHarness(state);
  h.invalidate('Figure evidence changed');
  assert.equal(h.state().status, 'revision_conflict');
  assert.equal(h.state().audit.code, 'MECHANISM_REVISION_CONFLICT');
  assert.equal(h.state().audit.reason, 'Figure evidence changed');
  assert.equal(h.state().result, state.result || null, 'last committed result is retained');
  assert.equal(h.state().pendingResult, null, 'the old uncommitted candidate is invalidated');
  assert.equal(h.state().operation, null, 'late responses no longer own the public state');
});

for (const [label, environment] of [
  ['active runtime', { runtime: { operation: task8MechanismOperation() } }],
  ['active promise', { promise: Promise.resolve() }],
  ['pending admission', { admissions: new Map([['pending', { operation: task8MechanismOperation() }]]) }],
  ['pending cleanup', { cleanup: new Map([['pending', { command: 'cancel', cleanupPending: true }]]) }],
  ['manual mechanism graph', { draft: { mechanismChain: { nodes: [{ id: 'manual', label: { value: 'Reviewed' } }], edges: [] } } }],
  ['explicitly cleared mechanism graph', { draft: { mechanismChain: { initialized: true, nodes: [], edges: [] } } }]
]) test(`MECH-008 empty invalidation: ${label} is not a never-started mechanism`, () => {
  const h = mechanismInvalidationHarness({}, environment);
  const draftBefore = JSON.stringify(h.draft), admissionsBefore = [...h.admissions], cleanupBefore = [...h.cleanup];
  h.invalidate();
  assert.equal(h.state().status, 'revision_conflict');
  assert.equal(JSON.stringify(h.draft), draftBefore);
  assert.deepEqual([...h.admissions], admissionsBefore);
  assert.deepEqual([...h.cleanup], cleanupBefore);
  assert.equal(h.runtime, environment.runtime || null);
});

test('MECH-008 empty invalidation: an invalidated in-flight response cannot reapply its candidate', () => {
  const operation = task8MechanismOperation();
  const h = mechanismInvalidationHarness({ status: 'working', operation, result: task8MechanismResult() });
  h.invalidate();
  const invalidated = h.state();
  const settle = executableContentFunction('settleCrossFigureMechanismState', { SciLLM: EvidenceFirstMechanism });
  assert.equal(settle(invalidated, { status: 'complete', crossFigureLogic: task8MechanismResult(),
    evidenceFirstStage0: { operationId: operation.operationId, operationEpoch: operation.epoch,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS } }, operation.binding), invalidated);
});

test('MECH-008 empty invalidation: restored diagnostics cannot be mistaken for a never-started mechanism', () => {
  const ownData = executableContentFunction('crossFigureMechanismOwnData');
  const restore = executableContentFunction('restoreCrossFigureMechanismState', {
    createCrossFigureLogicState: executableContentFunction('createCrossFigureLogicState'),
    crossFigureMechanismOwnData: ownData,
    normalizeCrossFigureMechanismPendingPreview: executableContentFunction(
      'normalizeCrossFigureMechanismPendingPreview', {
        SciLLM: EvidenceFirstMechanism,
        crossFigureMechanismOwnData: ownData,
        isSeedableCrossFigureLogicResult: executableContentFunction(
          'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData: ownData })
      })
  });
  for (const status of ['idle', 'complete', 'revision_conflict']) {
    const restored = restore({ status, result: null, pendingResult: null,
      error: 'Snapshot display only', staleReason: 'Snapshot display only',
      audit: { code: 'MECHANISM_REVISION_CONFLICT', updatedAt: 123,
        reason: 'Snapshot display only' } });
    assert.equal(restored.status, status === 'complete' ? 'idle' : status);
    assert.deepEqual(restored.audit, { code: 'MECHANISM_REVISION_CONFLICT', updatedAt: 123 });
    assert.equal(Object.hasOwn(restored, 'error'), false);
    assert.equal(Object.hasOwn(restored, 'staleReason'), false);
    const h = mechanismInvalidationHarness(restored);
    h.invalidate();
    assert.equal(h.state().status, 'revision_conflict');
    assert.equal(h.state().audit.code, 'MECHANISM_REVISION_CONFLICT');
  }
});

for (const status of ['needs_review', 'complete']) {
  test(`inventory CAS persists ${status} mechanism independently of Panel results`, async () => {
    const state = { status, result: status === 'complete' ? { nodes: ['n1'] } : null,
      pendingResult: status === 'needs_review' ? { nodes: ['n1'] } : null,
      operation: { operationId: 'mechanism-new', startedAt: 100 },
      audit: { updatedAt: 200 } };
    let durable = { revision: 2, contentHash: 'a'.repeat(64), content: {
      figures: [], crossFigureLogic: { status: 'idle', result: null, pendingResult: null }
    } };
    const persist = executableContentFunction('persistFigureInventoryWithCas', {
      getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
      persistWorkspaceAssetCheckpoint: async (_path, content, options) => {
        assert.equal(options.expectedRevision, durable.revision);
        durable = { revision: durable.revision + 1, contentHash: 'b'.repeat(64),
          content: structuredClone(content) };
        return { saved: true };
      }
    });
    await persist({ figures: [], crossFigureLogic: state });
    assert.deepEqual(durable.content.crossFigureLogic, state);
    await persist({ figures: [], crossFigureLogic: {
      status: 'working', operation: { operationId: 'mechanism-old', startedAt: 50 },
      audit: { updatedAt: 150 }, result: null, pendingResult: null
    } });
    assert.deepEqual(durable.content.crossFigureLogic, state,
      'an older snapshot cannot erase the saved mechanism');
    await persist({ figures: [], crossFigureLogic: {
      status: 'idle', result: null, pendingResult: null, audit: { updatedAt: 0 }
    } });
    assert.deepEqual(durable.content.crossFigureLogic, state);
  });
}

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function task8MechanismResult() {
  const sourceNodeId = `node-v2-${'1'.repeat(16)}`;
  const targetNodeId = `node-v2-${'2'.repeat(16)}`;
  const relationId = `relation-v1-${'3'.repeat(16)}`;
  const claimId = `claim-v1-${'4'.repeat(16)}`;
  return {
    mechanismEdges: [{
      from: 'Source', to: 'Target', polarity: 'negative',
      supportPanels: ['figure-2:A']
    }],
    evidenceFirstMechanism: {
      status: 'complete', canonicalDigest: `mechanism-v3-sha256-${'c'.repeat(64)}`,
      nodes: [
        { nodeId: sourceNodeId, label: 'Source', nodeType: 'intervention' },
        { nodeId: targetNodeId, label: 'Target', nodeType: 'outcome' }
      ],
      relations: [{
        relationId, sourceNodeId, targetNodeId, relationKind: 'causal',
        relationStatus: 'supported', renderable: true, polarity: 'decreases',
        context: {
          species: 'mouse', tissue: 'brain', cellType: 'microglia',
          compartment: '', condition: 'vehicle', timepoint: '', dose: ''
        },
        assignments: [{
          claimId, panelKey: 'figure-2:A',
          evidenceClass: 'necessity', role: 'supporting',
          claimRelationKind: 'causal', sourceRefs: ['figure-2:A:directObservation']
        }]
      }],
      claims: [{
        claimId, panelKey: 'figure-2:A', semantics: 'causal',
        causalTest: 'necessity', outcome: 'supports', effectSign: 'decreases',
        sourceAnalysisDigest: `source-v2-${'5'.repeat(16)}`,
        sourceRefs: ['figure-2:A:directObservation']
      }]
    }
  };
}

function task8CounterOnlyMechanismResult() {
  const result = structuredClone(task8MechanismResult());
  result.mechanismEdges = [];
  Object.assign(result.evidenceFirstMechanism.relations[0], {
    relationKind: 'correlative', relationStatus: 'counter_only', renderable: false
  });
  Object.assign(result.evidenceFirstMechanism.relations[0].assignments[0], {
    evidenceClass: 'other', role: 'counterclaim', claimRelationKind: 'causal'
  });
  result.evidenceFirstMechanism.claims[0].outcome = 'refutes';
  return result;
}

function task8MechanismOperation() {
  return {
    operationId: 'mechanism:content-cas-12345678', epoch: 3,
    evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
    binding: {
      documentId: 'sha256:content-cas-document',
      workspaceId: `workspace:${'d'.repeat(64)}`,
      workspaceGeneration: 4, workspaceLifecycle: 12,
      baseWorkspaceRevision: 7,
      mechanismChainFingerprint: 'mechanism-chain-v1-d1e2f3a4'
    }
  };
}

function contentFunctionSource(name) {
  const script = read('content.js');
  let start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must be defined in content.js`);
  if (script.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const signatureEnd = script.indexOf(') {', start);
  assert.ok(signatureEnd >= 0, `${name} must have a standard function signature`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === '{') depth += 1;
    if (script[index] === '}') depth -= 1;
    if (depth === 0) return script.slice(start, index + 1);
  }
  assert.fail(`${name} must have a complete function body`);
}

function executableContentFunction(name, dependencies = {}) {
  if (name === 'persistFigureInventoryWithCas') {
    return Function(...Object.keys(dependencies),
      'let figureInventoryMutationTail = Promise.resolve();\n' +
      contentFunctionSource('persistFigureInventoryWithCasMutation') + '\n' +
      contentFunctionSource(name) + '\nreturn persistFigureInventoryWithCas;'
    )(...Object.values(dependencies));
  }
  if (contentFunctionSource(name).includes('await ensureNativeTiffFigureImage(')) {
    dependencies = { ensureNativeTiffFigureImage:
      executableContentFunction('ensureNativeTiffFigureImage'), ...dependencies };
  }
  if (name === 'verifyLiveFigureRetryInput') {
    dependencies = { figureOperationState: { active: null }, ...dependencies };
  }
  if (contentFunctionSource(name).includes('await ensureNativePdfFigureImages(')) {
    dependencies = { ensureNativePdfFigureImages:
      executableContentFunction('ensureNativePdfFigureImages'), ...dependencies };
  }
  const dependencyNames = Object.keys(dependencies);
  if (name === 'autofillLiteratureNoteWithLLM') {
    return Function(...dependencyNames,
      `${contentFunctionSource('observeContentNoteRuntimeEpoch')}\n${contentFunctionSource(name)}\nreturn ${name};`
    )(...dependencyNames.map(key => dependencies[key]));
  }
  return Function(
    ...dependencyNames,
    `return (${contentFunctionSource(name)});`
  )(...dependencyNames.map(key => dependencies[key]));
}

function executableFigureDimensionAdmission() {
  const figureImageError = executableContentFunction('figureImageError');
  return executableContentFunction('admitFigureImageDimensions', {
    FIGURE_IMAGE_SOURCE_MAX_EDGE: 8192,
    FIGURE_IMAGE_SOURCE_MAX_PIXELS: 40000000,
    figureImageError
  });
}

function executableFigureImageUpgradePolicy() {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageBytesMatchMediaType = executableContentFunction(
    'figureImageBytesMatchMediaType'
  );
  const validateFigureProviderImage = executableContentFunction(
    'validateFigureProviderImage', {
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      figureImageError,
      figureImageBytesMatchMediaType,
      atob: value => Buffer.from(value, 'base64').toString('binary')
    }
  );
  const readFigureImageDimensions = executableContentFunction(
    'readFigureImageDimensions', {
      figureImageError,
      admitFigureImageDimensions: executableFigureDimensionAdmission()
    }
  );
  const validateFigureProviderImageDimensions = executableContentFunction(
    'validateFigureProviderImageDimensions', {
      validateFigureProviderImage,
      readFigureImageDimensions,
      figureImageError,
      atob: value => Buffer.from(value, 'base64').toString('binary')
    }
  );
  return {
    shouldUpgradePersistedFigureImage: executableContentFunction(
      'shouldUpgradePersistedFigureImage', {
        SciLLM: FigureViewer,
        document: { baseURI: 'https://paper.test/article' },
        validateFigureProviderImageDimensions,
        FIGURE_IMAGE_MAX_EDGE: 1600
      }
    ),
    preferHigherResolutionFigureImages: executableContentFunction(
      'preferHigherResolutionFigureImages', {
        validateFigureProviderImageDimensions
      }
    )
  };
}

function syntheticExifJpeg(width, height, orientation, littleEndian = true) {
  const exif = Buffer.alloc(32);
  exif.write('Exif\0\0', 0, 'binary');
  const tiff = 6;
  exif.write(littleEndian ? 'II' : 'MM', tiff, 'ascii');
  const writeUInt16 = littleEndian
    ? exif.writeUInt16LE.bind(exif) : exif.writeUInt16BE.bind(exif);
  const writeUInt32 = littleEndian
    ? exif.writeUInt32LE.bind(exif) : exif.writeUInt32BE.bind(exif);
  writeUInt16(42, tiff + 2);
  writeUInt32(8, tiff + 4);
  writeUInt16(1, tiff + 8);
  writeUInt16(0x0112, tiff + 10);
  writeUInt16(3, tiff + 12);
  writeUInt32(1, tiff + 14);
  writeUInt16(orientation, tiff + 18);
  writeUInt32(0, tiff + 22);
  return new Uint8Array(Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, exif.length + 2]),
    exif,
    Buffer.from([
      0xff, 0xc0, 0x00, 0x0b, 0x08,
      (height >>> 8) & 0xff, height & 0xff,
      (width >>> 8) & 0xff, width & 0xff,
      0x01, 0x01, 0x11, 0x00,
      0xff, 0xd9
    ])
  ]));
}

function createOriginSemanticsDocument(canvasLog = []) {
  return {
    baseURI: 'https://paper.test/articles/1',
    location: { href: 'https://paper.test/articles/1' },
    createElement(tagName) {
      assert.equal(tagName, 'canvas');
      const state = { source: null, exported: false };
      canvasLog.push(state);
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          return {
            fillRect() {},
            drawImage(source) { state.source = source; },
            set fillStyle(_value) {}
          };
        },
        toDataURL(mediaType = 'image/png') {
          state.exported = true;
          if (state.source?.originClean !== true) {
            const error = new Error('The canvas has been tainted by cross-origin data');
            error.name = 'SecurityError';
            throw error;
          }
          return mediaType === 'image/jpeg'
            ? 'data:image/jpeg;base64,/9j/'
            : 'data:image/png;base64,iVBORw0KGgo=';
        }
      };
      return canvas;
    }
  };
}

function figureVisionAdmission(taskId) {
  return {
    taskId,
    evidenceContractToken: FigureAnalysis.FIGURE_EVIDENCE_CONTRACT_TOKEN,
    figureReusePolicySignature: '', expectedVision: false,
    route: {
      taskType: taskId,
      capabilityMode: 'vision',
      providerId: 'deepseek'
    },
    taskPolicySignature: `policy-${taskId}`
  };
}

function createMechanismAnalyzeAdmissionHarness({
  versions, chrome, captureBinding, initialRuntime = null, initialState,
  ensureInventory = async () => undefined,
  ensureWorkspace = async () => undefined,
  commitGeneratedMechanism = undefined,
  stageCommitPending = async () => ({
    staged: true, commitPending: true, cleanupPending: true, cleanupErrorCode: ''
  }),
  finalizeCommittedMechanism = async () => ({
    released: true, cleanupPending: false, cleanupErrorCode: ''
  }),
  recoverCleanup = async () => ({ recovered: true }),
  queueCleanup = operation => ({
    operation, cleanupPending: true,
    promise: Promise.resolve({ cancelled: true })
  }),
  createLogicMap = async () => ({}),
  lifecycle = 1
}) {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const sameCrossFigureMechanismBinding = executableContentFunction(
    'sameCrossFigureMechanismBinding', { crossFigureMechanismOwnData }
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const settleCrossFigureMechanismState = executableContentFunction(
    'settleCrossFigureMechanismState', {
      isSeedableCrossFigureLogicResult, normalizeCrossFigureMechanismPendingPreview,
      SciLLM: EvidenceFirstMechanism
    }
  );
  const normalizeEvidenceFirstMechanismRequest = executableContentFunction(
    'normalizeEvidenceFirstMechanismRequest', {
      SciLLM: EvidenceFirstMechanism
    }
  );
  const buildEvidenceFirstMechanismBackgroundMessage = executableContentFunction(
    'buildEvidenceFirstMechanismBackgroundMessage'
  );
  const dependencies = {
    chrome,
    initialRuntime,
    initialState,
    captureEvidenceFirstMechanismBinding: captureBinding,
    normalizeEvidenceFirstMechanismRequest,
    sameCrossFigureMechanismBinding,
    crossFigureMechanismOwnData,
    settleCrossFigureMechanismState,
    commitGeneratedMechanismV2ToWorkspace: commitGeneratedMechanism,
    stageCrossFigureMechanismCommitPending: stageCommitPending,
    finalizeCommittedCrossFigureMechanismOperation: finalizeCommittedMechanism,
    buildEvidenceFirstMechanismBackgroundMessage,
    getFigureWorkspaceInventory: () => [],
    ensureFigureWorkspaceInventorySeeded: ensureInventory,
    ensureCurrentArticleWorkspace: ensureWorkspace,
    buildCrossFigureLogicInput: () => [
      { figureId: 'figure-1', isSupplemental: false },
      { figureId: 'figure-2', isSupplemental: false }
    ],
    collectResearchLogicMapBackgroundItems: () => [],
    buildCrossFigureRepresentativeContext: () => [],
    recoverPendingCrossFigureMechanismCleanup: recoverCleanup,
    publishCrossFigureMechanismProgress: () => true,
    scheduleArticleWorkspaceArtifactsSave: () => undefined,
    scheduleCurrentArticleArchiveSave: () => undefined,
    createArticleLogicMap: createLogicMap,
    queueCrossFigureMechanismCleanup: queueCleanup,
    figureWorkspaceDraft: { authoritative: true },
    document: { title: 'Mechanism admission paper' }
  };
  const dependencyNames = Object.keys(dependencies);
  return Function(...dependencyNames, `
    let crossFigureLogicPromise = null;
    let crossFigureLogicRuntime = initialRuntime;
    const crossFigureLogicAdmissions = new Map();
    const crossFigureLogicAdmissionCancelReceipts = new Map();
    const crossFigureLogicAdmissionTombstones = new Map();
    let crossFigureLogicAdmissionSequence = 0;
    let crossFigureLogicLastPromotedSequence = 0;
    const CROSS_FIGURE_MECHANISM_MAX_ADMISSIONS = 8;
    const CROSS_FIGURE_MECHANISM_MAX_TOMBSTONES = 64;
    let crossFigureLogicState = initialState;
    let supplementalFigureAssetsFingerprint = '';
    let articleWorkspaceLifecycleGeneration = ${JSON.stringify(lifecycle)};
    let lastPreparedStudy = null;
    let lastLlmAnalysis = null;
    ${contentFunctionSource('invalidateCrossFigureMechanismOperations')}
    ${contentFunctionSource('buildCrossFigureMechanismControlMessage')}
    ${contentFunctionSource('cancelCrossFigureLogicWithLLM')}
    ${contentFunctionSource('analyzeCrossFigureLogicWithLLM')}
    return {
      analyze: analyzeCrossFigureLogicWithLLM,
      cancel: cancelCrossFigureLogicWithLLM,
      invalidate: () => invalidateCrossFigureMechanismOperations(),
      setLifecycle: value => { articleWorkspaceLifecycleGeneration = value; },
      runtime: () => crossFigureLogicRuntime,
      admission: operationId => operationId
        ? crossFigureLogicAdmissions.get(operationId)
        : [...crossFigureLogicAdmissions.values()][0] || null,
      admissionCount: () => crossFigureLogicAdmissions.size,
      receiptCount: () => crossFigureLogicAdmissionCancelReceipts.size,
      dropReceipt: operationId => crossFigureLogicAdmissionCancelReceipts.delete(operationId),
      tombstoneCount: () => crossFigureLogicAdmissionTombstones.size,
      state: () => crossFigureLogicState
    };
  `)(...dependencyNames.map(key => dependencies[key]));
}

test('empty Figure refresh preserves a restored draft only for identical stable identity and runtime lifecycle', () => {
  const sameFigureWorkspaceRefreshBinding = executableContentFunction(
    'sameFigureWorkspaceRefreshBinding'
  );
  const preserve = executableContentFunction(
    'shouldPreserveFigureWorkspaceDraftOnEmptyRefresh',
    { sameFigureWorkspaceRefreshBinding }
  );
  const binding = {
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: 'b'.repeat(64),
    canonicalUrl: 'https://example.test/paper',
    workspaceId: `sha256:${'c'.repeat(64)}`,
    workspaceGeneration: 4
  };
  const draft = {
    binding: { ...binding },
    figures: { 'figure-1': { figureId: 'figure-1' } },
    mechanismChain: { nodes: [{ id: 'n1' }] }
  };
  assert.equal(preserve({
    before: binding, after: { ...binding }, beforeLifecycle: 9, afterLifecycle: 9,
    inventory: [], draft
  }), true);
  assert.equal(preserve({
    before: binding, after: { ...binding }, beforeLifecycle: 8, afterLifecycle: 9,
    inventory: [], draft
  }), false);
  assert.equal(preserve({
    before: binding, after: { ...binding, workspaceGeneration: 5 }, inventory: [], draft
  }), false);
  assert.equal(preserve({
    before: binding, after: { ...binding, documentHash: 'd'.repeat(64) }, inventory: [], draft
  }), false);
  assert.equal(preserve({
    before: binding, after: { ...binding }, beforeLifecycle: 9, afterLifecycle: 9,
    inventory: [{}], draft
  }), false);
});

test('Figure refresh rejects an old bound draft before populating a new article', () => {
  const sameFigureWorkspaceRefreshBinding = executableContentFunction(
    'sameFigureWorkspaceRefreshBinding'
  );
  const select = executableContentFunction(
    'figureWorkspaceDraftForRefreshBinding',
    {
      sameFigureWorkspaceRefreshBinding,
      SciLLM: { createFigureWorkspaceDraft: () => ({ revision: 0, figures: {} }) }
    }
  );
  const oldBinding = {
    documentId: 'old', documentHash: 'old-hash', canonicalUrl: 'https://example.test/old',
    workspaceId: 'workspace:old', workspaceGeneration: 1
  };
  const currentBinding = {
    documentId: 'new', documentHash: 'new-hash', canonicalUrl: 'https://example.test/new',
    workspaceId: 'workspace:new', workspaceGeneration: 1
  };
  const oldDraft = { binding: oldBinding, figures: { 'figure-old': { figureId: 'figure-old' } } };
  assert.equal(select(oldDraft, oldBinding), oldDraft);
  const clean = select(oldDraft, currentBinding);
  assert.deepEqual(clean.figures, {});
  assert.equal(clean.binding, undefined);
  const unproven = select(oldDraft, { ...currentBinding, documentHash: '' });
  assert.deepEqual(unproven.figures, {},
    'an incomplete current identity must fail closed instead of retaining old Figures');
});

test('populate entry clears an old draft but defers seeding until the new identity is complete', async () => {
  const sameFigureWorkspaceRefreshBinding = executableContentFunction(
    'sameFigureWorkspaceRefreshBinding'
  );
  const created = [];
  const SciLLM = {
    createFigureWorkspaceDraft: inventory => {
      created.push(inventory);
      return { revision: 0, figures: {} };
    }
  };
  const select = executableContentFunction('figureWorkspaceDraftForRefreshBinding', {
    sameFigureWorkspaceRefreshBinding, SciLLM
  });
  const oldDraft = {
    binding: {
      documentId: 'old', documentHash: 'old-hash',
      canonicalUrl: 'https://example.test/old', workspaceId: 'workspace:old',
      workspaceGeneration: 1
    },
    figures: { 'figure-old': { figureId: 'figure-old' } }
  };
  const currentInventory = [{ figureId: 'figure-current' }];
  const seedCalls = [];
  const activeController = {
    async seedFigures(inventory) {
      seedCalls.push(inventory);
      return { draft: { revision: 1, figures: { 'figure-current': inventory[0] } } };
    },
    async mergeModel() { throw new Error('unexpected model merge'); },
    getDraft() { return { revision: 1, figures: { 'figure-current': currentInventory[0] } }; },
    getCheckpoint() { return { revision: 1, contentHash: 'current' }; },
    isDirty() { return false; }
  };
  let invalidations = 0;
  let ensureCalls = 0;
  const populate = executableContentFunction('populateFigureWorkspaceDraft', {
    sameFigureWorkspaceRefreshBinding,
    combinedFigureWorkspaceInventory: () => currentInventory,
    currentFigureWorkspaceRefreshBinding: () => ({
      documentId: 'new', documentHash: '',
      canonicalUrl: 'https://example.test/new', workspaceId: 'workspace:new',
      workspaceGeneration: 1
    }),
    figureWorkspaceDraftForRefreshBinding: select,
    figureWorkspaceDraft: oldDraft,
    invalidateArticleWorkspaceLifecycle: () => { invalidations += 1; },
    figureWorkspaceDraftCheckpoint: { revision: 9, contentHash: 'old' },
    figureWorkspaceDraftCheckpointLoaded: true,
    figureWorkspaceDraftDirty: true,
    articleWorkspaceLifecycleGeneration: 4,
    ensureFigureWorkspaceDraftController: async () => {
      ensureCalls += 1;
      return activeController;
    },
    assertCurrentArticleWorkspaceLifecycle: () => {},
    figureWorkspaceCompletedModelResult: () => null,
    figureWorkspaceDraftController: activeController,
    articleWorkspaceLifecycleError: () => new Error('stale'),
    figureWorkspaceInventorySeedPromise: Promise.resolve(),
    figureWorkspaceDraftControllerPromise: null,
    SciLLM
  });
  const result = await populate(currentInventory);
  assert.equal(invalidations, 1);
  assert.equal(ensureCalls, 0);
  assert.deepEqual(created, [[]], 'old draft must be replaced by one clean empty draft');
  assert.deepEqual(seedCalls, []);
  assert.equal(Object.hasOwn(result.figures, 'figure-old'), false);
  assert.equal(Object.hasOwn(result.figures, 'figure-current'), false);
});

test('content execution proof is stable per world and document epoch advances only on replacement', () => {
  const createNonce = executableContentFunction('createContentWorldNonce');
  const nextEpoch = executableContentFunction('nextManualDocumentEpochState');
  const cryptoValue = { randomUUID: () => '12345678-1234-4abc-8def-1234567890ab' };
  const nonce = createNonce(cryptoValue);
  assert.equal(nonce, createNonce(cryptoValue));
  assert.match(nonce, /^[a-f0-9]{32,64}$/u);
  const paperA = {
    documentId: 'doc-a',
    record: {
      documentHash: 'hash-a', canonicalUrl: 'https://example.test/a'
    }
  };
  const first = nextEpoch(null, paperA, 4);
  assert.equal(first.documentEpoch, 1);
  assert.deepEqual(nextEpoch(first, { ...paperA, ignored: 'mutable' }, 4), first,
    'two prepares for one stable document and lifecycle keep the same epoch');
  assert.equal(nextEpoch(first, paperA, 5).documentEpoch, 2,
    'a runtime lifecycle replacement advances the epoch');
  const paperB = {
    documentId: 'doc-b',
    record: { documentHash: 'hash-b', canonicalUrl: 'https://example.test/b' }
  };
  assert.equal(nextEpoch(first, paperB, 4).documentEpoch, 2,
    'a real SPA document identity replacement advances the epoch');
});

test('manual prepare response and state-change event carry the same content execution proof', () => {
  const source = read('content.js');
  const prepareStart = source.indexOf("request.action === 'prepareManualAnnotations'");
  const prepareEnd = source.indexOf("request.action === 'clearAutomaticHighlights'", prepareStart);
  const prepare = source.slice(prepareStart, prepareEnd);
  const notifyStart = source.indexOf('function notifyManualAnnotationStateChanged');
  const notifyEnd = source.indexOf('\nfunction publishNativePdfAnnotations', notifyStart);
  const notify = source.slice(notifyStart, notifyEnd);
  for (const field of ['contentWorldNonce', 'documentEpoch']) {
    assert.match(prepare, new RegExp(`\\b${field}\\b`, 'u'));
    assert.match(notify, new RegExp(`\\b${field}\\b`, 'u'));
  }
  assert.match(prepare, /manualDocumentExecutionProof\(\)/u);
  assert.match(notify, /manualDocumentExecutionProof\(\)/u);
});

test('forced manual reprepare discards reusable state and returns the restored live record proof', async () => {
  const sameState = executableContentFunction('sameManualDocumentExecutionState');
  const normalizeExpected = executableContentFunction(
    'normalizeManualReprepareExpectedIdentity'
  );
  const reinitialize = executableContentFunction('reinitializeManualAnnotationsAfterCommit', {
    sameManualDocumentExecutionState: sameState,
    normalizeManualReprepareExpectedIdentity: normalizeExpected
  });
  const expected = {
    documentId: 'doc-live', documentHash: 'hash-live',
    canonicalUrl: 'https://example.test/paper',
    contentWorldNonce: 'a'.repeat(32), documentEpoch: 7,
    operationNonce: 'restore-operation-123'
  };
  let state = {
    ...expected, annotationCount: 1, unresolvedCount: 0, title: 'Before'
  };
  let disabled = 0;
  let initialized = 0;
  let forced = false;
  let domRestored = false;
  const result = await reinitialize(expected, {
    capture: () => ({ ...state }),
    disable: () => { disabled += 1; },
    initialize: () => { initialized += 1; },
    prepare: async options => {
      forced = options?.force === true;
      // Simulates DOCUMENT_PREPARE reading the record written to the live key
      // by the background commit, followed by restoreManualAnnotations DOM paint.
      state = {
        ...expected, annotationCount: 3, unresolvedCount: 1, title: 'After'
      };
      domRestored = true;
      return { documentId: expected.documentId };
    }
  });
  assert.equal(disabled, 1);
  assert.equal(initialized, 1);
  assert.equal(forced, true);
  assert.equal(domRestored, true);
  assert.deepEqual(result, {
    success: true, ...state, operationNonce: expected.operationNonce
  });
});

test('forced manual reprepare rejects world or live identity drift before publishing state', async () => {
  const sameState = executableContentFunction('sameManualDocumentExecutionState');
  const normalizeExpected = executableContentFunction(
    'normalizeManualReprepareExpectedIdentity'
  );
  const reinitialize = executableContentFunction('reinitializeManualAnnotationsAfterCommit', {
    sameManualDocumentExecutionState: sameState,
    normalizeManualReprepareExpectedIdentity: normalizeExpected
  });
  const expected = {
    documentId: 'doc-live', documentHash: 'hash-live',
    canonicalUrl: 'https://example.test/paper',
    contentWorldNonce: 'a'.repeat(32), documentEpoch: 7,
    operationNonce: 'restore-operation-123'
  };
  let prepares = 0;
  await assert.rejects(() => reinitialize({
    ...expected, contentWorldNonce: 'b'.repeat(32)
  }, {
    capture: () => ({ ...expected }), disable: () => {}, initialize: () => {},
    prepare: async () => { prepares += 1; }
  }), /MANUAL_REPREPARE_TARGET_MISMATCH/u);
  assert.equal(prepares, 0, 'a preflight proof mismatch must not discard or reload state');

  let captureCount = 0;
  await assert.rejects(() => reinitialize(expected, {
    capture: () => (++captureCount === 1 ? { ...expected } : {
      ...expected, documentId: 'doc-other', documentEpoch: 8
    }),
    disable: () => {}, initialize: () => {}, prepare: async () => { prepares += 1; }
  }), /MANUAL_REPREPARE_TARGET_MISMATCH/u);
  assert.equal(prepares, 1);
});

test('reinitializeManualAnnotations action requires frozen identity and returns full proof and counts', () => {
  const source = read('content.js');
  const start = source.indexOf("request.action === 'reinitializeManualAnnotations'");
  const end = source.indexOf("request.action === 'applyHighlight'", start);
  const action = source.slice(start, end);
  const helperStart = source.indexOf('function currentManualDocumentExecutionState');
  const helperEnd = source.indexOf('\nconst manualUiLifecycle', helperStart);
  const producer = source.slice(helperStart, helperEnd);
  assert.match(action, /reinitializeManualAnnotationsAfterCommit\(request\.expectedIdentity\)/u);
  for (const field of [
    'documentId', 'documentHash', 'canonicalUrl', 'contentWorldNonce',
    'documentEpoch', 'annotationCount', 'unresolvedCount'
  ]) assert.match(producer, new RegExp(`\\b${field}\\b`, 'u'));
  assert.match(producer, /operationNonce/u);
});

test('Figure refresh bases preserve on combined main and supplemental inventory', () => {
  const script = read('content.js');
  const start = script.indexOf('function getFigureWorkspaceInventory');
  const end = script.indexOf('\nfunction getSupplementalMaterialDiscovery', start);
  const source = script.slice(start, end);
  const combined = source.indexOf('const combinedInventory = combinedFigureWorkspaceInventory()');
  const guard = source.indexOf('shouldPreserveFigureWorkspaceDraftOnEmptyRefresh', combined);
  const inventory = source.indexOf('inventory: combinedInventory', guard);
  const populate = source.indexOf('populateFigureWorkspaceDraft(combinedInventory)', inventory);
  assert.ok(combined >= 0 && guard > combined && inventory > guard && populate > inventory);
});

test('restored bound memory is explicitly preferred only during dirty controller initialization', () => {
  const script = read('content.js');
  const start = script.indexOf('async function ensureFigureWorkspaceDraftController');
  const end = script.indexOf('\nfunction assertCurrentFigureWorkspaceEditTarget', start);
  const source = script.slice(start, end);
  assert.match(source, /preferMemoryDraft:\s*figureWorkspaceDraftDirty\s*===\s*true/u);
  assert.match(source, /binding:\s*currentFigureWorkspaceRefreshBinding\(\)/u);
});

test('authorized archive restore durably flushes its exactly bound Figure draft before receipt', () => {
  const script = read('content.js');
  const start = script.indexOf('async function applyArticleArchiveSnapshot(');
  const end = script.indexOf('\nasync function applyArticleWorkspaceAssetsUnsafe', start);
  const source = script.slice(start, end);
  const transaction = source.indexOf('await runAuthorizedArticleWorkspaceRestore(');
  const commit = source.indexOf('commitArticleArchiveRestoreTransaction(', transaction);
  const capability = source.indexOf(
    'articleWorkspaceRestorePersistenceGate.issue(', transaction
  );
  const capabilityUse = source.indexOf('restorePersistenceCapability:', capability);
  const revoke = source.indexOf(
    'articleWorkspaceRestorePersistenceGate.revoke(', capabilityUse
  );
  assert.ok(transaction >= 0 && commit > transaction);
  assert.ok(capability > transaction && capability < commit &&
    capabilityUse > capability && revoke > commit);
  assert.match(source.slice(commit),
    /registerReceipt:\s*binding\s*=>[\s\S]*?registerArticleRestoreCommitReceipt\(binding\)/u);
  const helperStart = script.indexOf('async function commitArticleArchiveRestoreTransaction(');
  const helperEnd = script.indexOf('\nasync function applyArticleArchiveSnapshot(', helperStart);
  const helper = script.slice(helperStart, helperEnd);
  const preflight = helper.indexOf('await assertTarget(frozenLifecycle)');
  const apply = helper.indexOf('await apply(prepared.archive)', preflight);
  const controller = helper.indexOf('await ensureController()', apply);
  const flush = helper.indexOf('await controller.flush()', controller);
  const receipt = helper.indexOf('await registerReceipt(', flush);
  assert.ok(preflight >= 0 && apply > preflight && controller > apply &&
    flush > controller && receipt > flush);
});

test('archive post-commit failures are truthful, non-retryable, and never reported as zero-write', async () => {
  const commit = executableContentFunction('commitArticleArchiveRestoreTransaction');
  const frozenTarget = {
    current: { workspaceId: 'workspace:a', workspaceGeneration: 1 },
    currentArchive: {
      documentId: 'doc-live', documentHash: 'hash-live',
      canonicalUrl: 'https://example.test/paper'
    },
    archive: {
      documentId: 'doc-old', documentHash: 'hash-old',
      canonicalUrl: 'https://example.test/paper'
    }
  };
  const binding = { documentId: 'doc-a', documentHash: 'hash-a' };
  const prepared = { archive: { title: 'prepared' }, operationNonce: 'nonce-1234567890' };
  let writes = 0;
  let receiptCalls = 0;
  const base = overrides => ({
    assertTarget: async () => {},
    apply: () => { writes += 1; return { success: true, partial: false }; },
    prepareManualProof: async () => ({
      documentId: 'doc-live', documentHash: 'hash-live',
      canonicalUrl: 'https://example.test/paper',
      contentWorldNonce: 'a'.repeat(32), documentEpoch: 8,
      title: 'Live', annotationCount: 1, unresolvedCount: 0
    }),
    ensureController: async () => ({
      getBinding: () => binding,
      flush: async () => ({ success: true, stale: false }),
      getDraft: () => ({ figures: {} }),
      getCheckpoint: () => ({ revision: 1, contentHash: 'h1' }),
      isDirty: () => false
    }),
    expectedBinding: () => binding,
    sameBinding: () => true,
    commitController: () => {},
    registerReceipt: async () => { receiptCalls += 1; return 'receipt-ok'; },
    ...overrides
  });

  const flushFailed = await commit(prepared, frozenTarget, 7, base({
    ensureController: async () => ({
      getBinding: () => binding,
      flush: async () => { throw new Error('disk unavailable'); }
    })
  }));
  assert.equal(writes, 1);
  assert.equal(receiptCalls, 0);
  assert.equal(flushFailed.success, false);
  assert.equal(flushFailed.committed, true);
  assert.equal(flushFailed.retryable, false);
  assert.equal(flushFailed.durableFigureWorkspace, false);
  assert.equal(flushFailed.receiptRegistered, false);
  assert.equal(flushFailed.postCommitStatus, 'figure-workspace-persistence-failed');

  const receiptFailed = await commit(prepared, frozenTarget, 7, base({
    registerReceipt: async () => { receiptCalls += 1; throw new Error('receipt failed'); }
  }));
  assert.equal(writes, 2);
  assert.equal(receiptCalls, 1);
  assert.equal(receiptFailed.success, false);
  assert.equal(receiptFailed.committed, true);
  assert.equal(receiptFailed.retryable, false);
  assert.equal(receiptFailed.durableFigureWorkspace, true);
  assert.equal(receiptFailed.receiptRegistered, false);
  assert.equal(receiptFailed.postCommitStatus, 'receipt-registration-failed');

  let postFlushChecks = 0;
  const postFlushNavigation = await commit(prepared, frozenTarget, 7, base({
    assertTarget: async () => {
      postFlushChecks += 1;
      if (postFlushChecks > 2) throw new Error('navigated after durable flush');
    }
  }));
  assert.equal(postFlushNavigation.success, false);
  assert.equal(postFlushNavigation.committed, true);
  assert.equal(postFlushNavigation.durableFigureWorkspace, true);
  assert.equal(postFlushNavigation.receiptRegistered, false);
  assert.equal(postFlushNavigation.postCommitStatus, 'target-changed-after-persistence');

  const unsafeFailed = await commit(prepared, frozenTarget, 7, base({
    apply: () => { writes += 1; throw new Error('mid-apply'); }
  }));
  assert.equal(unsafeFailed.success, false);
  assert.equal(unsafeFailed.committed, true);
  assert.equal(unsafeFailed.retryable, false);
  assert.equal(unsafeFailed.durableFigureWorkspace, false);
  assert.equal(unsafeFailed.postCommitStatus, 'in-page-commit-failed');

  let receiptBinding;
  const completionOrder = [];
  const completed = await commit(prepared, frozenTarget, 7, base({
    ensureController: async () => ({
      getBinding: () => binding,
      flush: async () => { completionOrder.push('flush'); return { stale: false }; },
      getDraft: () => ({ figures: {} }),
      getCheckpoint: () => ({ revision: 1, contentHash: 'h1' }),
      isDirty: () => false
    }),
    commitController: () => { completionOrder.push('publish'); },
    registerReceipt: async bindingValue => {
      completionOrder.push('receipt');
      receiptBinding = bindingValue;
      return 'receipt-current-live';
    }
  }));
  assert.equal(completed.success, true);
  assert.deepEqual(completionOrder, ['flush', 'publish', 'receipt']);
  assert.equal(completed.manualExecutionProof.documentEpoch, 8);
  assert.deepEqual(receiptBinding, {
    kind: 'archive', operationNonce: prepared.operationNonce,
    current: frozenTarget.current,
    currentArchive: frozenTarget.currentArchive,
    allowContentChanged: false,
    archive: frozenTarget.archive
  });
});

test('archive commit awaits a post-invalidation manual proof and returns its new epoch', async () => {
  const commit = executableContentFunction('commitArticleArchiveRestoreTransaction');
  const proof = {
    documentId: 'doc-live', documentHash: 'hash-live',
    canonicalUrl: 'https://example.test/paper',
    contentWorldNonce: 'a'.repeat(32), documentEpoch: 9,
    title: 'Live', annotationCount: 2, unresolvedCount: 1
  };
  let proofReady = false;
  let targetChecks = 0;
  const result = await commit({ archive: {}, operationNonce: 'restore-operation-123' }, {
    current: {}, currentArchive: proof, archive: {}
  }, 4, {
    assertTarget: async () => {
      targetChecks += 1;
      if (targetChecks > 1) assert.equal(proofReady, true,
        'post-apply target checks must wait for the new manual proof');
    },
    apply: async () => ({ success: true }),
    prepareManualProof: async () => {
      await Promise.resolve();
      proofReady = true;
      return proof;
    },
    ensureController: async () => ({
      getBinding: () => ({}), flush: async () => ({ stale: false })
    }),
    expectedBinding: () => ({}), sameBinding: () => true,
    commitController: () => {}, registerReceipt: async () => 'receipt'
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.manualExecutionProof, proof);
  assert.equal(result.manualExecutionProof.documentEpoch, 9);

  const source = read('content.js');
  const start = source.indexOf('async function applyArticleArchiveSnapshot(');
  const end = source.indexOf('\nasync function applyArticleWorkspaceAssetsUnsafe', start);
  const wrapper = source.slice(start, end);
  assert.match(wrapper,
    /prepareManualProof:[\s\S]*?prepareArticleArchiveRestoreManualExecutionProof/u);
});

test('post-archive manual proof awaits a real epoch replacement and rejects identity drift', async () => {
  const prepareProof = executableContentFunction(
    'prepareArticleArchiveRestoreManualExecutionProof',
    { articleWorkspaceRestoreError: () => new Error('TARGET_MISMATCH') }
  );
  const before = {
    documentId: 'doc-live', documentHash: 'hash-live',
    canonicalUrl: 'https://example.test/paper',
    contentWorldNonce: 'a'.repeat(32), documentEpoch: 4,
    title: 'Before', annotationCount: 1, unresolvedCount: 0
  };
  const after = { ...before, documentEpoch: 5, title: 'After', annotationCount: 3 };
  let prepared = false;
  const proof = await prepareProof({ currentArchive: before }, {
    manualProofBefore: before
  }, {
    prepare: async options => {
      assert.deepEqual(options, { force: true });
      await Promise.resolve();
      prepared = true;
    },
    capture: () => {
      assert.equal(prepared, true);
      return after;
    }
  });
  assert.deepEqual(proof, after);

  await assert.rejects(() => prepareProof({ currentArchive: before }, {
    manualProofBefore: before
  }, {
    prepare: async () => {},
    capture: () => ({ ...after, documentHash: 'hash-other' })
  }), /TARGET_MISMATCH/u);
});

test('archive transaction keeps navigation before commit zero-write and reports navigation after commit truthfully', async () => {
  const commit = executableContentFunction('commitArticleArchiveRestoreTransaction');
  const prepared = { archive: {}, operationNonce: 'nonce-1234567890' };
  const frozenTarget = { current: {}, archive: {} };
  let writes = 0;
  await assert.rejects(() => commit(prepared, frozenTarget, 4, {
    assertTarget: async () => { throw new Error('navigated'); },
    apply: () => { writes += 1; return { success: true }; }
  }));
  assert.equal(writes, 0, 'preflight navigation must remain a zero-write failure');

  let checks = 0;
  const navigated = await commit(prepared, frozenTarget, 4, {
    assertTarget: async () => {
      checks += 1;
      if (checks > 1) throw new Error('navigated');
    },
    apply: () => { writes += 1; return { success: true }; },
    prepareManualProof: async () => ({
      documentId: 'doc-live', documentHash: 'hash-live',
      canonicalUrl: 'https://example.test/paper',
      contentWorldNonce: 'a'.repeat(32), documentEpoch: 2,
      title: 'Live', annotationCount: 0, unresolvedCount: 0
    }),
    ensureController: async () => { throw new Error('must not reach new document controller'); },
    expectedBinding: () => ({}),
    sameBinding: () => true,
    commitController: () => {},
    registerReceipt: async () => 'receipt'
  });
  assert.equal(writes, 1);
  assert.equal(navigated.success, false);
  assert.equal(navigated.committed, true);
  assert.equal(navigated.retryable, false);
  assert.equal(navigated.postCommitStatus, 'target-changed-after-commit');
});

test('workspace asset production entry is zero-write before commit and truthful after commit failures', async () => {
  const commitTransaction = executableContentFunction(
    'commitArticleWorkspaceRestoreTransaction'
  );
  const applyWorkspace = executableContentFunction('applyArticleWorkspaceAssets');
  const frozenTarget = {
    current: {
      workspaceId: 'workspace:a', workspaceGeneration: 3,
      canonicalUrl: 'https://example.test/a', contentHash: 'hash-a'
    },
    manifest: {
      workspaceId: 'workspace:a', workspaceGeneration: 3,
      canonicalUrl: 'https://example.test/a', contentHash: 'hash-a'
    },
    documentId: 'doc-a', match: 'exact', allowContentChanged: false,
    contentRevisionChanged: false
  };
  const input = {
    restoreSource: 'browser-local', match: 'exact', manifest: frozenTarget.manifest,
    restoreTarget: { authorizationToken: 'nonce-1234567890' }
  };
  const runAuthorized = async (restore, callbacks) => callbacks.commit(
    callbacks.prepare(restore, frozenTarget, { manualBaseline: {} }), frozenTarget, 9
  );
  let writes = 0;
  await assert.rejects(() => applyWorkspace(input, {
    runAuthorized,
    commitTransaction,
    operationNonce: () => 'nonce-1234567890',
    commitOverrides: {
      assertCurrentSync: () => {},
      assertTarget: async () => { throw new Error('navigated'); },
      apply: async () => { writes += 1; return { success: true }; }
    }
  }));
  assert.equal(writes, 0);

  let checks = 0;
  const navigated = await applyWorkspace(input, {
    runAuthorized,
    commitTransaction,
    operationNonce: () => 'nonce-1234567890',
    commitOverrides: {
      assertCurrentSync: () => {},
      assertTarget: async () => {
        checks += 1;
        if (checks > 1) throw new Error('navigated');
      },
      apply: async () => { writes += 1; return { success: true, match: 'exact' }; },
      registerReceipt: async () => { throw new Error('must not register'); }
    }
  });
  assert.equal(writes, 1);
  assert.equal(navigated.success, false);
  assert.equal(navigated.committed, true);
  assert.equal(navigated.retryable, false);
  assert.equal(navigated.workspaceApplied, true);
  assert.equal(navigated.receiptRegistered, false);
  assert.equal(navigated.postCommitStatus, 'target-changed-after-commit');

  const midCommitFailure = await applyWorkspace(input, {
    runAuthorized,
    commitTransaction,
    operationNonce: () => 'nonce-1234567890',
    commitOverrides: {
      assertCurrentSync: () => {},
      assertTarget: async () => {},
      apply: async () => {
        writes += 1;
        throw new Error('unsafe restore failed after its commit point');
      },
      registerReceipt: async () => { throw new Error('must not register'); }
    }
  });
  assert.equal(writes, 2);
  assert.equal(midCommitFailure.success, false);
  assert.equal(midCommitFailure.committed, true);
  assert.equal(midCommitFailure.retryable, false);
  assert.equal(midCommitFailure.workspaceApplied, false,
    'the apply stage did not complete even though partial writes may exist');
  assert.equal(midCommitFailure.receiptRegistered, false);
  assert.equal(midCommitFailure.postCommitStatus, 'workspace-commit-failed');
});

test('workspace asset receipt failure uses only the frozen target and returns committed nonretryable', async () => {
  const commitTransaction = executableContentFunction(
    'commitArticleWorkspaceRestoreTransaction'
  );
  const applyWorkspace = executableContentFunction('applyArticleWorkspaceAssets');
  const frozenTarget = {
    current: {
      workspaceId: 'workspace:a', workspaceGeneration: 3,
      canonicalUrl: 'https://example.test/a', contentHash: 'hash-a'
    },
    manifest: {
      workspaceId: 'workspace:a', workspaceGeneration: 3,
      canonicalUrl: 'https://example.test/a', contentHash: 'hash-a'
    },
    documentId: 'doc-a', match: 'content-changed', allowContentChanged: true,
    contentRevisionChanged: true
  };
  const input = {
    restoreSource: 'browser-local', match: 'content-changed', manifest: frozenTarget.manifest,
    restoreTarget: { authorizationToken: 'nonce-1234567890' }
  };
  let receiptBinding;
  const result = await applyWorkspace(input, {
    runAuthorized: async (restore, callbacks) => callbacks.commit(
      callbacks.prepare(restore, frozenTarget, { manualBaseline: {} }), frozenTarget, 11
    ),
    commitTransaction,
    operationNonce: () => 'nonce-1234567890',
    commitOverrides: {
      assertCurrentSync: () => {},
      assertTarget: async () => {},
      apply: async () => ({ success: true, match: 'content-changed' }),
      registerReceipt: async binding => {
        receiptBinding = binding;
        throw new Error('receipt unavailable');
      }
    }
  });
  assert.deepEqual(receiptBinding, {
    kind: 'workspace', operationNonce: 'nonce-1234567890',
    current: frozenTarget.current, documentId: frozenTarget.documentId,
    manifest: frozenTarget.manifest, match: frozenTarget.match,
    allowContentChanged: true
  });
  assert.equal(result.success, false);
  assert.equal(result.committed, true);
  assert.equal(result.retryable, false);
  assert.equal(result.workspaceApplied, true);
  assert.equal(result.receiptRegistered, false);
  assert.equal(result.postCommitStatus, 'receipt-registration-failed');
});

test('literature note autofill returns typed field status and grounded sources', async () => {
  const template = {
    id: 'basic_research',
    name: '基础研究',
    fields: [
      { id: 'research_background', label: '研究背景' },
      { id: 'scientific_questions', label: '科学问题' }
    ]
  };
  const responseData = {
    values: {
      research_background: 'PV neurons support circuit adaptation.'
    },
    statuses: {
      research_background: 'supported',
      scientific_questions: 'missing'
    },
    sources: {
      research_background: ['intro-1'],
      scientific_questions: []
    },
    summary: { supported: 1, missing: 1 },
    templateId: template.id,
    documentHash: 'a'.repeat(64),
    cacheHit: true,
    operationId: 'literature-note-production-operation',
    operationReceipt: {
      schemaVersion: 1,
      operationId: 'literature-note-production-operation',
      cacheIdentity: {
        documentHash: 'a'.repeat(64),
        evidenceSignature: 'b'.repeat(64),
        templateSignature: 'c'.repeat(64)
      }
    },
    evidenceReceipt: {
      documentHash: 'a'.repeat(64),
      evidenceSignature: 'b'.repeat(64),
      templateSignature: 'c'.repeat(64),
      records: [{ paragraphId: 'intro-1', sourceIdentity: 'intro-1', textHash: '' }]
    },
    route: { taskType: 'summary', effectiveProfileId: 'profile-ready' }
  };
  const autofill = executableContentFunction('autofillLiteratureNoteWithLLM', {
    articleWorkspaceLifecycleGeneration: 7,
    pdfSemanticArticleChatSnapshot: () => null,
    activeNativePdfStructure: () => null,
    buildPdfLiteratureNoteFieldEvidence: () => null,
    getCanonicalArticleSnapshot: () => ({
      documentHash: 'a'.repeat(64),
      paragraphs: [{ paragraphId: 'intro-1', text: 'PV neurons support adaptation.' }]
    }),
    SciLLM: { normalizeLiteratureNoteTemplates: () => [template] },
    chrome: { runtime: { sendMessage: async () => ({ success: true, data: responseData }) } },
    document: { title: 'Current paper' },
    assertCurrentArticleWorkspaceLifecycle: () => {}
  });

  const result = await autofill(template);

  assert.deepEqual(result, {
    success: true,
    result: {
      values: responseData.values,
      fieldStatus: responseData.statuses,
      sources: responseData.sources,
      fieldEvidence: null,
      completedFieldIds: [],
      pendingFieldIds: [],
      fieldFailures: [],
      partial: false,
      summary: responseData.summary,
      templateId: template.id,
      documentHash: responseData.documentHash,
      cacheHit: true,
      operationId: responseData.operationId,
      operationReceipt: responseData.operationReceipt,
      runtimeTask: null,
      notificationUsage: null,
      commitConfirmed: false,
      route: responseData.route,
      evidenceReceipt: {
        documentHash: 'a'.repeat(64),
        evidenceSignature: 'b'.repeat(64),
        templateSignature: 'c'.repeat(64),
        records: [{ paragraphId: 'intro-1', sourceIdentity: 'intro-1', textHash: '' }]
      }
    }
  });

  // New partial protocol fields remain typed and scoped to this template.
  responseData.partial = true;
  responseData.completedFieldIds = ['research_background', 'foreign-field'];
  responseData.pendingFieldIds = ['scientific_questions', 'foreign-field'];
  responseData.fieldFailures = [
    { fieldId: 'scientific_questions', batchIndex: 2, errorCode: 'REQUEST_TIMEOUT' },
    { fieldId: 'foreign-field', batchIndex: 9, errorCode: 'FOREIGN' }
  ];
  const partial = (await autofill(template)).result;
  assert.equal(partial.partial, true);
  assert.deepEqual(partial.completedFieldIds, ['research_background']);
  assert.deepEqual(partial.pendingFieldIds, ['scientific_questions']);
  assert.deepEqual(partial.fieldFailures, [
    { fieldId: 'scientific_questions', batchIndex: 2, errorCode: 'REQUEST_TIMEOUT' }
  ]);
});

test('literature note autofill sends only canonical evidence fields and checks lifecycle', async () => {
  const template = {
    id: 'basic_research',
    name: '基础研究',
    fields: [{ id: 'research_background', label: '研究背景' }]
  };
  const lifecycleChecks = [];
  let sentMessage;
  const autofill = executableContentFunction('autofillLiteratureNoteWithLLM', {
    articleWorkspaceLifecycleGeneration: 12,
    pdfSemanticArticleChatSnapshot: () => null,
    activeNativePdfStructure: () => null,
    buildPdfLiteratureNoteFieldEvidence: () => null,
    getCanonicalArticleSnapshot: () => ({
      documentHash: 'b'.repeat(64),
      html: '<article>private DOM</article>',
      pdfBytes: [37, 80, 68, 70],
      credentials: { apiKey: 'do-not-send' },
      literatureNoteDocumentState: { valuesByTemplate: { other_article: { note: 'private' } } },
      paragraphs: [{
        paragraphId: 'results-2',
        sourceIdentity: 'canonical:results-2',
        sourceKey: 'results',
        textHash: 'hash-2',
        sectionKind: 'results',
        sectionTitle: 'Results',
        headingPath: [{ title: 'Results' }],
        text: 'The current-paper result.',
        html: '<b>The current-paper result.</b>',
        pdfBytes: [1, 2, 3],
        credentials: { authorization: 'Bearer secret' },
        noteState: { otherArticle: 'must not leak' }
      }]
    }),
    SciLLM: { normalizeLiteratureNoteTemplates: () => [template] },
    chrome: { runtime: { sendMessage: async message => {
      sentMessage = message;
      return {
        success: true,
        data: {
          values: { research_background: 'A grounded result.' },
          statuses: { research_background: 'supported' },
          sources: { research_background: ['results-2'] },
          summary: { supported: 1, missing: 0 },
          templateId: template.id,
          documentHash: 'b'.repeat(64)
        }
      };
    } } },
    document: { title: 'Current paper' },
    assertCurrentArticleWorkspaceLifecycle: value => lifecycleChecks.push(value)
  });

  await autofill(template, { operationId: 'literature-note-qa-12345678', forceRefresh: true });
  assert.equal(sentMessage.forceRefresh, true);
  assert.equal(sentMessage.operationId, 'literature-note-qa-12345678');
  await autofill(template);
  assert.equal(sentMessage.forceRefresh, false);

  assert.deepEqual(lifecycleChecks, [12, 12]);
  assert.equal(sentMessage.workspaceLifecycle, 12);
  assert.deepEqual(sentMessage.document, {
    sourceKind: 'html-canonical',
    title: 'Current paper',
    documentHash: 'b'.repeat(64),
    paragraphs: [{
      recordType: 'body',
      paragraphId: 'results-2',
      sourceIdentity: 'canonical:results-2',
      sourceKey: 'results',
      textHash: 'hash-2',
      sectionKind: 'results',
      sectionTitle: 'Results',
      sectionPath: ['Results'],
      text: 'The current-paper result.'
    }]
  });
  const serialized = JSON.stringify(sentMessage);
  for (const forbidden of [
    'private DOM', 'pdfBytes', 'do-not-send', 'Bearer secret',
    'literatureNoteDocumentState', 'otherArticle', 'must not leak'
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden));
});

test('literature note autofill rejects a response after the article lifecycle becomes stale', async () => {
  const template = {
    id: 'basic_research',
    name: '基础研究',
    fields: [{ id: 'research_background', label: '研究背景' }]
  };
  let liveLifecycle = 21;
  let releaseResponse;
  let requestStarted;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const deferredResponse = new Promise(resolve => { releaseResponse = resolve; });
  const autofill = executableContentFunction('autofillLiteratureNoteWithLLM', {
    articleWorkspaceLifecycleGeneration: 21,
    pdfSemanticArticleChatSnapshot: () => null,
    activeNativePdfStructure: () => null,
    buildPdfLiteratureNoteFieldEvidence: () => null,
    getCanonicalArticleSnapshot: () => ({
      documentHash: 'c'.repeat(64),
      paragraphs: [{ paragraphId: 'intro-1', text: 'Current article evidence.' }]
    }),
    SciLLM: { normalizeLiteratureNoteTemplates: () => [template] },
    chrome: { runtime: { sendMessage: () => {
      requestStarted();
      return deferredResponse;
    } } },
    document: { title: 'Current article' },
    assertCurrentArticleWorkspaceLifecycle: expected => {
      if (expected !== liveLifecycle) {
        const error = new Error('Article workspace changed');
        error.code = 'WORKSPACE_STALE';
        throw error;
      }
    }
  });

  const pending = autofill(template);
  await started;
  liveLifecycle = 22;
  releaseResponse({
    success: true,
    data: {
      values: { research_background: 'Must not escape.' },
      statuses: { research_background: 'supported' },
      sources: { research_background: ['intro-1'] },
      summary: { supported: 1, missing: 0 },
      templateId: template.id,
      documentHash: 'c'.repeat(64)
    }
  });

  await assert.rejects(pending, error => error?.code === 'WORKSPACE_STALE');
});

test('loads category metadata and article extraction before the content script', () => {
  const messenger = read('core/tab-messenger.js');
  const expected = [
    'core/category-store.js',
    'core/confidence-policy.js',
    'core/result-validator.js',
    'core/sentence-boundary.js',
    'core/publisher-adapters.js',
    'core/article-structure.js',
    'core/article-extractor.js',
    'core/publisher-diagnostics.js',
    'core/highlight-distribution.js',
    'core/figure-extractor.js',
    'core/figure-analysis.js',
    'core/manual-annotations.js',
    'core/pdf-native-document.js',
    'content.js'
  ];
  expected.forEach(file => assert.match(messenger, new RegExp(file.replace(/[./]/g, '\\$&'))));
  assert.ok(
    messenger.indexOf("'core/result-validator.js'") < messenger.indexOf("'content.js'"),
    'progressive highlights require mergeAnnotations before content.js loads'
  );
});

test('web grounding verifier loads before every production consumer', () => {
  const background = read('background.js');
  const messenger = read('core/tab-messenger.js');
  const popup = read('popup.html');
  const pdfReader = read('pdf-reader.html');
  const webSources = 'core/article-chat-web-sources.js';
  assert.ok(background.indexOf("'providers/provider-utils.js'") >= 0);
  assert.ok(background.indexOf(`'${webSources}'`) >
    background.indexOf("'providers/provider-utils.js'"));
  for (const consumer of [
    "'core/article-chat.js'", "'core/article-archive.js'",
    "'providers/openai.js'", "'providers/deepseek.js'"
  ]) {
    assert.ok(background.indexOf(`'${webSources}'`) < background.indexOf(consumer),
      `${webSources} must load before ${consumer}`);
  }
  assert.ok(messenger.indexOf(`'${webSources}'`) < messenger.indexOf("'content.js'"));
  assert.ok(messenger.indexOf(`'${webSources}'`) <
    messenger.indexOf("'core/article-archive.js'"));
  assert.ok(popup.indexOf(`src="${webSources}"`) <
    popup.indexOf('src="core/article-archive.js"'));
  assert.ok(popup.indexOf(`src="${webSources}"`) < popup.indexOf('src="popup.js"'));
  assert.ok(pdfReader.indexOf(`src="${webSources}"`) <
    pdfReader.indexOf('src="content.js"'));
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
  assert.doesNotMatch(script, /applyStoredRegexFallback/);
  assert.match(script, /LLM 分析未全部完成/);
  assert.match(script, /已完成分块会保留，重试时只处理未完成部分/);
  assert.match(script, /LLM_RECORD_FEEDBACK/);
  assert.match(script, /showHighlightContextPopover/);
  assert.match(script, /sciLlmParagraphId/);
  assert.match(script, /normalizeTextWithOffsets/);
  assert.match(css, /\.sci-llm-highlight/);
  assert.match(script, /type:\s*'ARTICLE_NOTIFICATION'/);
  assert.match(script, /timestamp:\s*Date\.now\(\)/);
  assert.doesNotMatch(css, /#sci-llm-status/);
  assert.match(css, /#sci-llm-feedback/);
});

test('cross-Figure meta seeding stops after Paper A conflicts and the live paper becomes B', async () => {
  let live = {
    lifecycle: 7,
    workspace: {
      workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
      canonicalUrl: 'https://journal.example/paper-a', contentHash: 'a'.repeat(64)
    }
  };
  const controllerA = {
    revision: 3,
    getDraft() { return { revision: this.revision }; },
    async mutate() {
      dispatches.push('paper-a');
      live = {
        lifecycle: 8,
        workspace: {
          workspaceId: `workspace:${'b'.repeat(64)}`, workspaceGeneration: 1,
          canonicalUrl: 'https://journal.example/paper-b', contentHash: 'b'.repeat(64)
        }
      };
      activeController = controllerB;
      const error = new Error('conflict');
      error.code = 'FIGURE_WORKSPACE_REVISION_CONFLICT';
      throw error;
    },
    getCheckpoint() { return { revision: 0, contentHash: 'a' }; },
    isDirty() { return false; }
  };
  const controllerB = {
    getDraft: () => ({ revision: 0 }),
    async mutate() { dispatches.push('paper-b'); return { success: true }; }
  };
  let activeController = controllerA;
  let ensures = 0;
  let notifications = 0;
  const dispatches = [];
  const seed = executableContentFunction('seedFigureWorkspaceMetaFromCrossFigure', {
    ensureFigureWorkspaceDraftController: async () => {
      ensures += 1;
      return activeController;
    },
    mutateFigureWorkspaceDraft: async mutation => activeController.mutate(mutation)
  });

  await assert.rejects(seed(
    { backgroundItems: ['Paper A background'] },
    [{ isSupplemental: false, analysis: { figureQuestion: 'Paper A question?' } }],
    {
      getLifecycle: () => live.lifecycle,
      ensureWorkspace: async () => live.workspace,
      getWorkspace: () => live.workspace,
      ensureController: async () => {
        ensures += 1;
        return activeController;
      },
      getActiveController: () => activeController,
      commit: () => { notifications += 1; }
    }
  ), error => error?.code === 'FIGURE_WORKSPACE_META_SEED_STALE');
  assert.deepEqual(dispatches, ['paper-a']);
  assert.equal(ensures, 1);
  assert.equal(notifications, 0);
});

test('cross-Figure meta seeding retries one CAS conflict on the original Paper A controller', async () => {
  const workspace = {
    workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 2,
    canonicalUrl: 'https://journal.example/paper-a', contentHash: 'c'.repeat(64)
  };
  let revision = 4;
  let attempts = 0;
  let ensures = 0;
  let commits = 0;
  const mutations = [];
  const controller = {
    getDraft: () => ({ revision }),
    async mutate(mutation) {
      attempts += 1;
      mutations.push(mutation);
      if (attempts === 1) {
        revision = 5;
        const error = new Error('conflict');
        error.code = 'FIGURE_WORKSPACE_REVISION_CONFLICT';
        throw error;
      }
      revision = 6;
      return { success: true, draft: { revision } };
    },
    getCheckpoint: () => ({ revision: 6, contentHash: 'next' }),
    isDirty: () => false
  };
  const seed = executableContentFunction('seedFigureWorkspaceMetaFromCrossFigure', {
    ensureFigureWorkspaceDraftController: async () => controller,
    mutateFigureWorkspaceDraft: mutation => controller.mutate(mutation)
  });
  const result = await seed(
    { backgroundItems: ['Known fact'] },
    [{ isSupplemental: false, analysis: { figureQuestion: 'Why?' } }],
    {
      getLifecycle: () => 11,
      ensureWorkspace: async () => workspace,
      getWorkspace: () => workspace,
      ensureController: async () => { ensures += 1; return controller; },
      getActiveController: () => controller,
      commit: () => { commits += 1; }
    }
  );
  assert.equal(result.success, true);
  assert.equal(ensures, 1);
  assert.equal(attempts, 2);
  assert.deepEqual(mutations.map(item => item.expectedRevision), [4, 5]);
  assert.equal(commits, 1);
});

test('cross-Figure workspace prefers the whole-study structured question graph', async () => {
  const { orderFigureWorkspaceItems } = require('../core/figure-workspace.js');
  const workspace = {
    workspaceId: `workspace:${'d'.repeat(64)}`, workspaceGeneration: 1,
    canonicalUrl: 'https://journal.example/ordered-paper', contentHash: 'e'.repeat(64)
  };
  const mutations = [];
  const controller = {
    getDraft: () => ({ revision: 2, supplementalPlacements: [
      { figureId: 'figure-s1', slot: 0, rank: 0 }
    ] }),
    mutate: async mutation => {
      mutations.push(mutation);
      return { success: true, draft: { revision: 3 } };
    },
    getCheckpoint: () => ({ revision: 3, contentHash: 'next' }),
    isDirty: () => false
  };
  const seed = executableContentFunction('seedFigureWorkspaceMetaFromCrossFigure', {
    ensureFigureWorkspaceDraftController: async () => controller,
    mutateFigureWorkspaceDraft: mutation => controller.mutate(mutation)
  });
  const common = {
    getLifecycle: () => 5,
    ensureWorkspace: async () => workspace,
    getWorkspace: () => workspace,
    ensureController: async () => controller,
    getActiveController: () => controller,
    orderFigureItems: orderFigureWorkspaceItems,
    commit: () => undefined
  };
  const structuredQuestions = [{
    questionId: 'root', text: 'What is the whole-study question?', relationType: 'root',
    parentQuestionIds: [], supportingFigureIds: ['figure-2', 'figure-10']
  }, {
    questionId: 'mechanism', text: 'How is it mediated?', relationType: 'progressive',
    parentQuestionIds: ['root'], supportingFigureIds: ['figure-10']
  }];
  await seed({ backgroundItems: ['Known'], scientificQuestions: structuredQuestions }, [
    { figureId: 'figure-10', figureLabel: 'Figure 10', isSupplemental: false,
      analysis: { figureQuestion: 'Question ten?' } },
    { figureId: 'figure-s1', figureLabel: 'Figure S1', isSupplemental: true,
      analysis: { figureQuestion: 'Supplement must not win?' } },
    { figureId: 'figure-2', figureLabel: 'Figure 2', isSupplemental: false,
      analysis: { figureQuestion: 'Question two?' } }
  ], common);
  assert.deepEqual(mutations[0].scientificQuestions, structuredQuestions);

  mutations.length = 0;
  await seed({ backgroundItems: ['Known'] }, [
    { figureId: 'figure-10', figureLabel: 'Figure 10', isSupplemental: false,
      analysis: { figureQuestion: 'Question ten?' } },
    { figureId: 'figure-2', figureLabel: 'Figure 2', isSupplemental: false,
      analysis: { figureQuestion: '' } }
  ], common);
  assert.deepEqual(mutations[0].scientificQuestions, [],
    'legacy fallback must not skip past an empty first main-Figure question');
});

test('content toggles regex, LLM, and manual decorations without hiding article text', () => {
  const script = read('content.js');
  assert.match(script, /function setHighlightSourceVisibility/);
  assert.match(script, /data-sci-show-regex/);
  assert.match(script, /data-sci-show-llm/);
  assert.match(script, /data-sci-show-manual/);
  assert.match(script, /background: transparent !important/);
  assert.doesNotMatch(
    script.slice(
      script.indexOf('function ensureHighlightSourceVisibilityStyle'),
      script.indexOf('function setHighlightSourceVisibility')
    ),
    /display:\s*none|visibility:\s*hidden/
  );
});

test('content script forwards the popup-prepared document identity after re-extraction', () => {
  const script = read('content.js');
  const analyzeStart = script.indexOf('async function analyzeArticleWithLLM');
  const analyzeEnd = script.indexOf('async function analyzeFiguresWithLLM', analyzeStart);
  const analyzeWorkflow = script.slice(analyzeStart, analyzeEnd);
  assert.match(analyzeWorkflow, /documentId:\s*archiveDocumentProof\?\.documentId\s*\|\|\s*options\.documentId/);
  assert.match(analyzeWorkflow, /previousDocumentHash:\s*archiveDocumentProof\?\.documentHash\s*\|\|\s*options\.documentHash/);

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

test('content creates a non-LLM workspace and autosaves separate restorable artifacts', () => {
  const script = read('content.js');
  const messenger = read('core/tab-messenger.js');
  assert.match(script, /createArticleWorkspaceIdentity/);
  assert.match(script, /action === 'ensureArticleWorkspace'/);
  assert.match(script, /ARTICLE_WORKSPACE_SAVE_ASSET/);
  ['article/structure.json', 'article/paragraphs.json', 'annotations/highlights.json',
    'analysis/full-analysis.json', 'chat/index.json', 'figures/inventory.json',
    'ui/state.json'].forEach(path => assert.match(script, new RegExp(path.replace('/', '\\/'))));
  assert.ok(messenger.indexOf("'core/article-workspace.js'") < messenger.indexOf("'content.js'"));
  assert.match(script, /action === 'applyArticleWorkspaceAssets'/);
});

test('dynamic article structure refresh observes prose containers used outside p tags', () => {
  const script = read('content.js');
  const start = script.indexOf('function isArticleStructureMutation(');
  const end = script.indexOf('function startArticleStructureObserver', start);
  const observer = script.slice(start, end);
  assert.match(observer, /blockquote,dd/);
  assert.match(observer, /div\[class\*="paragraph" i\]/);
  assert.match(observer, /div\[class\*="para" i\]/);
  assert.match(observer, /sourceAdapter\?\.paragraphSelectors/);
  const ArticleExtractor = require('../core/article-extractor.js');
  const isMutation = executableContentFunction('isArticleStructureMutation', {
    isBilingualDisplayOnlyMutation: () => false,
    articleStructureInternalRewriteRoots: new Set(), articleStructureBoundaryRoots: new Map(),
    Node: { ELEMENT_NODE: 1 }, SciLLM: {
      selectPublisherAdapter: () => ({ paragraphSelectors: ['.publisher-prose'] }),
      isArticleSourceMutationExcluded: ArticleExtractor.isArticleSourceMutationExcluded
    }
  });
  const prose = { nodeType: 1, children: [], closest: () => null,
    matches: selector => selector === '.publisher-prose' };
  assert.equal(isMutation({ type: 'childList', target: { nodeType: 1, closest: () => null },
    addedNodes: [prose], removedNodes: [] }), true, 'publisher-only prose must invalidate the structure');
  assert.match(script, /type:\s*'ARTICLE_STRUCTURE_CHANGED'/);
  assert.match(script, /if \(!articleStructureObserver\) startArticleStructureObserver\(\)/);
});

test('portable archives serialize one canonical Figure draft and restore legacy layouts', () => {
  const createFields = executableContentFunction('createPortableFigureWorkspaceArchiveFields');
  const resolveDraft = executableContentFunction('resolveArchivedFigureWorkspaceDraft');
  const draft = {
    schemaVersion: 1,
    revision: 7,
    meta: { backgroundItems: [{ id: 'one-copy-marker-7f68a2' }] },
    figures: {}
  };
  const liveNavigation = {
    revision: 4,
    figures: { draft, figures: [{ figureId: 'figure-2' }], totalFigures: 1 }
  };
  const liveFigureWorkspace = {
    draft,
    figures: [{ figureId: 'figure-2' }],
    totalFigures: 1
  };
  const fields = createFields(liveNavigation, liveFigureWorkspace, draft);
  const serialized = JSON.stringify(fields);
  assert.equal(serialized.split('one-copy-marker-7f68a2').length - 1, 1);
  assert.equal(fields.navigation.figures.draft, undefined);
  assert.equal(fields.figureWorkspace.draft, undefined);
  assert.equal(fields.figureWorkspaceDraft, draft);
  assert.equal(resolveDraft(fields), draft);

  const legacyFigureWorkspace = { revision: 3, figures: {} };
  assert.equal(resolveDraft({
    figureWorkspace: { draft: legacyFigureWorkspace }
  }), legacyFigureWorkspace);
  const legacyNavigation = { revision: 2, figures: {} };
  assert.equal(resolveDraft({
    navigation: { figures: { draft: legacyNavigation } }
  }), legacyNavigation);

  const script = read('content.js');
  const archive = script.slice(
    script.indexOf('function buildCurrentArticleArchive'),
    script.indexOf('async function persistCurrentArticleArchive')
  );
  assert.match(archive, /createPortableFigureWorkspaceArchiveFields/);
  const restore = script.slice(
    script.indexOf('function applyArticleArchiveSnapshotUnsafe'),
    script.indexOf('async function applyArticleWorkspaceAssets')
  );
  assert.match(restore, /resolveArchivedFigureWorkspaceDraft\(workspace\)/);
});

test('completed Figure model results merge through the active serialized draft controller', async () => {
  const merge = executableContentFunction(
    'mergeCompletedFigureResultIntoWorkspaceDraft'
  );
  const calls = [];
  let commits = 0;
  let lifecycle = 4;
  const controller = {
    async mergeModel(figure, modelResult) {
      calls.push({ figure, modelResult });
      return { success: true, draft: { revision: 3 } };
    }
  };
  const figure = { figureId: 'figure-2' };
  const modelResult = { figureId: 'figure-2', analysisDepth: 'standard' };
  const result = await merge(figure, modelResult, {
    getLifecycle: () => lifecycle,
    ensureController: async () => controller,
    getActiveController: () => controller,
    commit: active => {
      assert.equal(active, controller);
      commits += 1;
    }
  });
  assert.equal(result.success, true);
  assert.deepEqual(calls, [{ figure, modelResult }]);
  assert.equal(commits, 1);

  lifecycle = 7;
  await assert.rejects(() => merge(figure, modelResult, {
    getLifecycle: () => lifecycle,
    ensureController: async () => {
      lifecycle = 8;
      return controller;
    },
    getActiveController: () => controller,
    commit: () => { commits += 1; }
  }), error => error.code === 'FIGURE_WORKSPACE_MODEL_MERGE_STALE');
  assert.equal(commits, 1);
});

test('all completed Figure generation paths durably merge into the manual workspace layer', () => {
  const script = read('content.js');
  const deep = script.slice(
    script.indexOf('async function analyzeSingleFigureDeep'),
    script.indexOf('async function analyzeSingleFigureWithLLM')
  );
  const standard = script.slice(
    script.indexOf('async function analyzeSingleFigureWithLLM'),
    script.indexOf('function normalizeRequestedPanelId')
  );
  const panel = script.slice(
    script.indexOf('async function analyzeSingleFigurePanelWithLLM'),
    script.indexOf('function isSafePanelFollowupDataRecord')
  );
  const batch = script.slice(
    script.indexOf('async function analyzeFiguresWithLLM'),
    script.indexOf('function setReviewOutlineDepth')
  );
  [deep, standard, panel, batch].forEach(source => {
    assert.match(source, /await mergeCompletedFigureResultIntoWorkspaceDraft\(/);
  });
  const restore = script.slice(
    script.indexOf('function restoreFigureWorkspaceDraft'),
    script.indexOf('async function ensureFigureWorkspaceDraftController')
  );
  assert.match(restore, /figureWorkspaceCompletedModelResult/);
  assert.match(restore, /SciLLM\.mergeModelIntoFigureWorkspaceDraft/);
});

test('workspace restore target validation rejects Paper A assets on Paper B and binds content changes explicitly', () => {
  const own = executableContentFunction('ownArticleWorkspaceRestoreValue');
  const restoreError = executableContentFunction('articleWorkspaceRestoreError');
  const normalize = executableContentFunction('normalizedArticleWorkspaceRestoreIdentity', {
    ownArticleWorkspaceRestoreValue: own,
    SciLLM: {
      normalizeWorkspaceCanonicalUrl(value) {
        const parsed = new URL(value);
        return `${parsed.origin}${parsed.pathname.replace(/\/$/u, '')}`;
      }
    }
  });
  const same = executableContentFunction('sameArticleWorkspaceRestoreIdentity');
  const validate = executableContentFunction('validateArticleWorkspaceRestoreTarget', {
    ownArticleWorkspaceRestoreValue: own,
    normalizedArticleWorkspaceRestoreIdentity: normalize,
    sameArticleWorkspaceRestoreIdentity: same,
    articleWorkspaceRestoreError: restoreError,
    Object
  });
  const identity = letter => ({
    workspaceId: `workspace:${letter.repeat(64)}`,
    workspaceGeneration: 2,
    canonicalUrl: `https://example.org/paper-${letter}`,
    contentHash: letter.repeat(64)
  });
  const paperA = identity('a');
  const paperB = identity('b');
  const exact = {
    match: 'exact', manifest: paperA,
    restoreTarget: {
      authorizationToken: 'restore-token-123', current: paperA,
      manifest: paperA, allowContentChanged: false
    }
  };
  assert.equal(validate(exact, paperA, { identity: paperA }).current.workspaceId,
    paperA.workspaceId);
  assert.throws(() => validate(exact, paperB, { identity: paperB }),
    error => error.code === 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');
  assert.throws(() => validate({
    ...exact, manifest: paperB
  }, paperA, { identity: paperA }),
  error => error.code === 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');
  const futureA = { ...paperA, workspaceGeneration: paperA.workspaceGeneration + 1 };
  assert.throws(() => validate({
    ...exact,
    manifest: futureA,
    restoreTarget: { ...exact.restoreTarget, manifest: futureA }
  }, paperA, { identity: paperA }),
  error => error.code === 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');

  const oldA = { ...paperA, contentHash: 'c'.repeat(64) };
  assert.doesNotThrow(() => validate({
    match: 'content-changed', manifest: oldA,
    restoreTarget: {
      ...exact.restoreTarget, manifest: oldA, allowContentChanged: true
    }
  }, paperA, { identity: paperA }));
  assert.doesNotThrow(() => validate({
    match: 'content-changed', manifest: oldA,
    restoreTarget: {
      authorizationToken: 'restore-token-123', current: oldA,
      manifest: oldA, allowContentChanged: true
    }
  }, paperA, { identity: oldA }),
  'same publication may change content revision between scan and commit');
  assert.throws(() => validate({
    match: 'content-changed', manifest: oldA,
    restoreTarget: {
      ...exact.restoreTarget, manifest: oldA, allowContentChanged: false
    }
  }, paperA, { identity: paperA }),
  error => error.code === 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');
});

test('workspace restore guard invalidates old LLM work before validation and makes a mismatch zero-write', async () => {
  const script = read('content.js');
  const restoreError = executableContentFunction('articleWorkspaceRestoreError');
  const own = executableContentFunction('ownArticleWorkspaceRestoreValue');
  const same = executableContentFunction('sameArticleWorkspaceRestoreIdentity');
  const run = executableContentFunction('runAuthorizedArticleWorkspaceRestore', {
    ownArticleWorkspaceRestoreValue: own,
    sameArticleWorkspaceRestoreIdentity: same,
    articleWorkspaceRestoreError: restoreError
  });
  let lifecycle = 3;
  let frozen = false;
  let writes = 0;
  let lateMerges = 0;
  const oldLifecycle = lifecycle;
  const lateCompletion = () => {
    if (lifecycle === oldLifecycle) lateMerges += 1;
  };
  const paperB = {
    workspaceId: `workspace:${'b'.repeat(64)}`,
    workspaceGeneration: 1,
    canonicalUrl: 'https://example.org/b',
    contentHash: 'b'.repeat(64)
  };
  let prepares = 0;
  const draft = { value: 'before' };
  const dom = { value: 'before' };
  await assert.rejects(() => run({ restoreTarget: {} }, {
    invalidate() { lifecycle += 1; return lifecycle; },
    freeze() { frozen = true; },
    unfreeze() { frozen = false; },
    consume() { return { identity: paperB }; },
    capture: async () => paperB,
    validate() { throw restoreError(); },
    prepare: () => { prepares += 1; return { value: 'prepared' }; },
    commit: () => {
      writes += 1;
      draft.value = 'after';
      dom.value = 'after';
    },
    getLifecycle: () => lifecycle
  }), error => error.code === 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');
  lateCompletion();
  assert.equal(writes, 0);
  assert.equal(prepares, 0);
  assert.equal(draft.value, 'before');
  assert.equal(dom.value, 'before');
  assert.equal(lateMerges, 0);
  assert.equal(frozen, false);

  let validations = 0;
  let captures = 0;
  const paperAfterNavigation = { ...paperB, canonicalUrl: 'https://example.org/c' };
  await assert.rejects(() => run({ restoreTarget: {} }, {
    invalidate() { lifecycle += 1; return lifecycle; },
    freeze() { frozen = true; },
    unfreeze() { frozen = false; },
    consume() { return { identity: paperB }; },
    capture: async () => (++captures === 1 ? paperB : paperAfterNavigation),
    validate: (_input, live) => {
      if (live !== paperB) throw restoreError();
      return { current: paperB };
    },
    prepare: () => { prepares += 1; return { value: 'prepared' }; },
    commit: () => {
      writes += 1;
      draft.value = 'after';
      dom.value = 'after';
    },
    getLifecycle: () => lifecycle
  }), error => error.code === 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');
  assert.equal(prepares, 1, 'pure preparation may run before the second identity check');
  assert.equal(writes, 0, 'post-prepare navigation must prevent all commit mutations');
  assert.equal(draft.value, 'before');
  assert.equal(dom.value, 'before');

  validations = 0;
  const valid = await run({ restoreTarget: {} }, {
    invalidate() { lifecycle += 1; return lifecycle; },
    freeze() { frozen = true; },
    unfreeze() { frozen = false; },
    consume() { return { identity: paperB }; },
    capture: async () => paperB,
    validate: () => { validations += 1; return { current: paperB }; },
    prepare: () => ({ value: 'prepared' }),
    commit: prepared => {
      writes += 1;
      draft.value = prepared.value;
      dom.value = prepared.value;
      return { success: true };
    },
    getLifecycle: () => lifecycle
  });
  assert.equal(valid.success, true);
  assert.equal(writes, 1);
  assert.equal(validations, 2);
  assert.equal(draft.value, 'prepared');
  assert.equal(dom.value, 'prepared');
  assert.equal(frozen, false);

  const wrapper = script.slice(
    script.indexOf('async function applyArticleWorkspaceAssets(input'),
    script.indexOf('async function resetArticleWorkspaceState')
  );
  assert.ok(wrapper.indexOf('invalidateArticleWorkspaceLifecycle()') <
    wrapper.indexOf('applyArticleWorkspaceAssetsUnsafe'));
  assert.match(wrapper, /articleWorkspaceSaveFrozen = true/);
  assert.doesNotMatch(script.slice(
    script.indexOf('async function applyArticleWorkspaceAssetsUnsafe'),
    script.indexOf('async function applyArticleWorkspaceAssets(input')
  ), /currentArticleWorkspace\s*=\s*\{\s*\.\.\.input\.manifest/);
});

test('authorized mechanism import refuses a post-parse paper switch with zero writes', async () => {
  const restore = executableContentFunction('restoreMechanismNetworkForTarget');
  const paper = suffix => ({
    workspaceId: `workspace:${suffix.repeat(64)}`,
    workspaceGeneration: 2,
    canonicalUrl: `https://example.org/paper-${suffix}`,
    contentHash: suffix.repeat(64),
    documentId: `sha256:${suffix.repeat(64)}`
  });
  const paperA = paper('a');
  const paperB = paper('b');
  let captureIndex = 0;
  let writes = 0;
  let frozen = false;
  let lifecycle = 20;
  await assert.rejects(() => restore({
    jsonText: '{"safe":true}', expectedRevision: 4,
    restoreTarget: {
      authorizationToken: 'mechanism-restore-token',
      current: paperA,
      documentId: paperA.documentId
    }
  }, {
    invalidate: () => ++lifecycle,
    freeze: () => { frozen = true; },
    unfreeze: () => { frozen = false; },
    consume: () => ({ identity: paperA }),
    capture: async () => captureIndex++ === 0 ? paperA : paperB,
    normalize: value => ({ ...value }),
    parse: () => ({
      mechanismChain: { nodes: [], edges: [] }, mechanismGeneration: null
    }),
    mutate: async () => { writes += 1; return { revision: 5 }; },
    getLifecycle: () => lifecycle
  }), error => error?.code === 'MECHANISM_NETWORK_IMPORT_PAPER_MISMATCH');
  assert.equal(writes, 0);
  assert.equal(frozen, false);
});

test('authorized mechanism import consumes one token and commits one replacement', async () => {
  const restore = executableContentFunction('restoreMechanismNetworkForTarget');
  const paper = {
    workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 2,
    canonicalUrl: 'https://example.org/paper-a', contentHash: 'a'.repeat(64),
    documentId: `sha256:${'c'.repeat(64)}`
  };
  const writes = [];
  let lifecycle = 30;
  let frozen = false;
  const result = await restore({
    jsonText: '{"safe":true}', expectedRevision: 7,
    restoreTarget: {
      authorizationToken: 'mechanism-restore-token', current: paper,
      documentId: paper.documentId
    }
  }, {
    invalidate: () => ++lifecycle,
    freeze: () => { frozen = true; },
    unfreeze: () => { frozen = false; },
    consume: () => ({ identity: paper }),
    capture: async () => paper,
    normalize: value => ({ ...value }),
    parse: () => ({
      mechanismChain: { nodes: [{ id: 'a' }], edges: [] },
      mechanismGeneration: '{"durable":true}'
    }),
    mutate: async mutation => {
      assert.equal(frozen, false);
      writes.push(mutation);
      return { revision: 8 };
    },
    getLifecycle: () => lifecycle
  });
  assert.equal(result.success, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].type, 'import_mechanism_workspace');
  assert.equal(writes[0].expectedRevision, 7);
  assert.equal(writes[0].mechanismGeneration, '{"durable":true}');
});

test('authorized mechanism import never executes hostile parsed workspace getters', async () => {
  const restore = executableContentFunction('restoreMechanismNetworkForTarget');
  const paper = {
    workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 2,
    canonicalUrl: 'https://example.org/paper-a', contentHash: 'a'.repeat(64),
    documentId: `sha256:${'c'.repeat(64)}`
  };
  let getterReads = 0;
  let writes = 0;
  const parsed = {};
  Object.defineProperty(parsed, 'mechanismChain', {
    enumerable: true,
    get() { getterReads += 1; return { nodes: [], edges: [] }; }
  });
  Object.defineProperty(parsed, 'mechanismGeneration', {
    enumerable: true,
    get() { getterReads += 1; return null; }
  });
  await assert.rejects(() => restore({
    jsonText: '{"safe":true}', expectedRevision: 7,
    restoreTarget: {
      authorizationToken: 'mechanism-restore-token', current: paper,
      documentId: paper.documentId
    }
  }, {
    invalidate: () => 41,
    freeze: () => undefined,
    unfreeze: () => undefined,
    consume: () => ({ identity: paper }),
    capture: async () => paper,
    normalize: value => ({ ...value }),
    parse: () => parsed,
    mutate: async () => { writes += 1; return { revision: 8 }; },
    getLifecycle: () => 41
  }), error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID');
  assert.equal(getterReads, 0);
  assert.equal(writes, 0);
});

test('Figure draft persistence reports fixed frozen stale and generic failures', () => {
  const classify = executableContentFunction('figureWorkspacePersistFailureCode');
  assert.equal(classify({ frozen: true }), 'FIGURE_WORKSPACE_SAVE_FROZEN');
  assert.equal(classify({ stale: true }), 'FIGURE_WORKSPACE_LIFECYCLE_CHANGED');
  assert.equal(classify({ unchanged: true }), 'FIGURE_WORKSPACE_SAVE_UNCHANGED');
  assert.equal(classify({ saved: true }), 'FIGURE_WORKSPACE_SAVE_ASSET_MISSING');
  assert.equal(classify({ saved: false }), 'FIGURE_WORKSPACE_SAVE_REJECTED');
  assert.equal(classify({}), 'FIGURE_WORKSPACE_SAVE_REJECTED');
  assert.equal(classify(null), 'FIGURE_WORKSPACE_SAVE_RESPONSE_MISSING');
});

test('restore persistence capability is unforgeable and bound to frozen lifecycle and target', () => {
  const createGate = executableContentFunction(
    'createArticleWorkspaceRestorePersistenceGate'
  );
  let lifecycle = 7;
  let frozen = true;
  let binding = { documentId: 'doc-a', workspaceGeneration: 2 };
  const gate = createGate({
    getLifecycle: () => lifecycle,
    isFrozen: () => frozen,
    getBinding: () => binding,
    sameBinding: (left, right) => JSON.stringify(left) === JSON.stringify(right)
  });
  const assetPath = 'figures/workspace-draft.json';
  const capability = gate.issue(7, { ...binding }, assetPath);
  assert.equal(gate.allows(capability, assetPath), true);
  assert.equal(gate.allows(), false);
  assert.equal(gate.allows({}), false);
  lifecycle = 8;
  assert.equal(gate.allows(capability, assetPath), false);
  lifecycle = 7;
  binding = { ...binding, workspaceGeneration: 3 };
  assert.equal(gate.allows(capability, assetPath), false);
  binding = { documentId: 'doc-a', workspaceGeneration: 2 };
  frozen = false;
  assert.equal(gate.allows(capability, assetPath), false);
  frozen = true;
  gate.revoke(capability);
  assert.equal(gate.allows(capability, assetPath), false);

  const singleUse = gate.issue(7, { ...binding }, assetPath);
  assert.equal(gate.consume(singleUse, 'figures/other.json'), false);
  assert.equal(gate.allows(singleUse, assetPath), true,
    'a wrong-path attempt must not consume the capability');
  assert.equal(gate.consume(singleUse, assetPath), true);
  assert.equal(gate.allows(singleUse, assetPath), false);
  assert.equal(gate.consume(singleUse, assetPath), false);

  const detachedCapability = gate.issue(7, { ...binding }, assetPath);
  const detachedConsume = gate.consume;
  assert.equal(detachedConsume.call({ allows: () => true }, {}, assetPath), false,
    'a forged receiver must not authorize an unknown capability');
  assert.equal(detachedConsume(detachedCapability, assetPath), true,
    'consumption must depend only on private gate state, not a mutable receiver');
});

test('only an authorized restore flush bypasses saveFrozen while automatic saves remain frozen', async () => {
  const authorized = Object.freeze({ kind: 'private-restore-capability' });
  let writes = 0;
  let ensureCalls = 0;
  let releaseWrite;
  let signalWriteStarted;
  const writeStarted = new Promise(resolve => { signalWriteStarted = resolve; });
  const writeReleased = new Promise(resolve => { releaseWrite = resolve; });
  const currentArticleWorkspace = {
    workspaceId: 'workspace:a', workspaceGeneration: 1
  };
  let consumed = false;
  const dependencies = {
    articleWorkspaceSaveFrozen: true,
    articleWorkspaceLifecycleGeneration: 11,
    articleWorkspaceRestorePersistenceGate: {
      allows: token => token === authorized && !consumed,
      consume: token => {
        if (token !== authorized || consumed) return false;
        consumed = true;
        return true;
      }
    },
    articleWorkspaceAssetFingerprint: () => 'fingerprint',
    articleWorkspaceAssetFingerprints: new Map(),
    articleWorkspaceMutationTail: Promise.resolve(),
    currentArticleWorkspace,
    ensureCurrentArticleWorkspace: async () => {
      ensureCalls += 1;
      throw new Error('WORKSPACE_WRITES_FROZEN');
    },
    assertCurrentArticleWorkspaceLifecycle: value => assert.equal(value, 11),
    chrome: { runtime: { sendMessage: async () => {
      writes += 1;
      signalWriteStarted();
      await writeReleased;
      return { success: true, data: { saved: true, asset: {
        revision: 1, contentHash: 'hash-1'
      } } };
    } } }
  };
  const persist = executableContentFunction('persistWorkspaceAssetCheckpoint', dependencies);
  assert.deepEqual(await persist('figures/workspace-draft.json', {}), {
    saved: false, frozen: true
  });
  assert.deepEqual(await persist('figures/workspace-draft.json', {}, {
    restorePersistenceCapability: {}
  }), { saved: false, frozen: true });
  assert.equal(writes, 0);
  const authorizedSave = persist('figures/workspace-draft.json', {}, {
    force: true, restorePersistenceCapability: authorized
  });
  await writeStarted;
  const concurrentOrdinarySave = persist('figures/workspace-draft.json', {}, {
    force: true
  });
  releaseWrite();
  const saved = await authorizedSave;
  assert.equal(saved.saved, true);
  assert.deepEqual(await concurrentOrdinarySave, { saved: false, frozen: true });
  assert.equal(writes, 1);
  assert.equal(ensureCalls, 0);
  assert.deepEqual(await persist('figures/workspace-draft.json', {}, {
    force: true, restorePersistenceCapability: authorized
  }), { saved: false, frozen: true });
  assert.equal(writes, 1);

  consumed = false;
  dependencies.chrome.runtime.sendMessage = async () => {
    writes += 1;
    throw new Error('disk unavailable');
  };
  await assert.rejects(() => persist('figures/workspace-draft.json', {}, {
    force: true, restorePersistenceCapability: authorized
  }), /disk unavailable/u);
  assert.deepEqual(await persist('figures/workspace-draft.json', {}, {
    force: true, restorePersistenceCapability: authorized
  }), { saved: false, frozen: true }, 'a failed authorized write must still revoke access');
  assert.equal(writes, 2);
});

test('restore controller stays private until its one authorized flush completes', () => {
  const script = read('content.js');
  const start = script.indexOf('async function ensureFigureWorkspaceDraftController');
  const end = script.indexOf('\nfunction assertCurrentFigureWorkspaceEditTarget', start);
  const ensure = script.slice(start, end);
  assert.match(ensure, /privateRestoreController/u);
  assert.match(ensure, /if\s*\(!privateRestoreController\)[\s\S]*?figureWorkspaceDraftController\s*=\s*controller/u);
  const wrapperStart = script.indexOf('async function applyArticleArchiveSnapshot(');
  const wrapperEnd = script.indexOf('\nasync function applyArticleWorkspaceAssetsUnsafe', wrapperStart);
  const wrapper = script.slice(wrapperStart, wrapperEnd);
  const privateEnsure = wrapper.indexOf('privateRestoreController: true');
  const flush = script.indexOf('await controller.flush()',
    script.indexOf('async function commitArticleArchiveRestoreTransaction'));
  const publish = script.indexOf('commitController(controller)', flush);
  const receipt = script.indexOf('await registerReceipt(', publish);
  assert.ok(privateEnsure >= 0 && flush >= 0 && publish > flush && receipt > publish);
  const commitControllerStart = wrapper.indexOf('commitController: controller => {');
  const commitControllerEnd = wrapper.indexOf('registerReceipt:', commitControllerStart);
  assert.match(wrapper.slice(commitControllerStart, commitControllerEnd),
    /figureWorkspaceDraftController\s*=\s*controller/u);
  assert.match(wrapper,
    /ensureFigureWorkspaceDraftController\(\{[\s\S]*?workspace:\s*frozenTarget\.current/u);
});

test('frozen archive restore reads and flushes through its validated workspace without ensure', async () => {
  const commit = executableContentFunction('commitArticleArchiveRestoreTransaction');
  const readAsset = executableContentFunction('getWorkspaceAssetCheckpoint');
  const workspace = {
    workspaceId: 'workspace:a', workspaceGeneration: 3,
    canonicalUrl: 'https://example.test/paper', contentHash: 'hash-live'
  };
  const binding = {
    documentId: 'doc-live', documentHash: 'hash-live',
    canonicalUrl: workspace.canonicalUrl,
    workspaceId: workspace.workspaceId, workspaceGeneration: workspace.workspaceGeneration
  };
  const capability = Object.freeze({ kind: 'test-restore-capability' });
  let consumed = false;
  let ensureCalls = 0;
  const order = [];
  const gate = {
    allows: token => token === capability && !consumed,
    consume: token => {
      if (token !== capability || consumed) return false;
      consumed = true;
      return true;
    }
  };
  const ensureWorkspace = async () => {
    ensureCalls += 1;
    throw new Error('ENSURE_MUST_NOT_RUN_WHILE_FROZEN');
  };
  const getWorkspaceAssetCheckpoint = (relativePath, options = {}) =>
    readAsset(relativePath, {
      ...options,
      getLifecycle: () => 11,
      assertLifecycle: lifecycle => assert.equal(lifecycle, 11),
      ensureWorkspace,
      send: async message => {
        order.push('read');
        assert.equal(message.workspaceId, workspace.workspaceId);
        return { success: true, data: { asset: null } };
      }
    });
  const persistDependencies = {
    articleWorkspaceSaveFrozen: true,
    articleWorkspaceLifecycleGeneration: 11,
    articleWorkspaceRestorePersistenceGate: gate,
    articleWorkspaceAssetFingerprint: () => 'restored-draft',
    articleWorkspaceAssetFingerprints: new Map(),
    articleWorkspaceMutationTail: Promise.resolve(),
    currentArticleWorkspace: workspace,
    ensureCurrentArticleWorkspace: ensureWorkspace,
    assertCurrentArticleWorkspaceLifecycle: lifecycle => assert.equal(lifecycle, 11),
    chrome: { runtime: { sendMessage: async message => {
      order.push('flush');
      assert.equal(message.workspaceId, workspace.workspaceId);
      return { success: true, data: { saved: true, asset: {
        revision: 1, contentHash: 'durable-hash'
      } } };
    } } }
  };
  const persistBound = executableContentFunction(
    'persistWorkspaceAssetCheckpoint', persistDependencies
  );
  const SciLLM = {
    initializeFigureWorkspaceDraftState: () => ({
      draft: { binding, figures: {} },
      checkpoint: { revision: 0, contentHash: '' }, dirty: true
    }),
    createFigureWorkspaceDraftController: options => ({
      getBinding: () => binding,
      flush: async () => {
        await options.persist({
          draft: { binding, figures: {} },
          expectedRevision: 0, expectedContentHash: ''
        });
        return { stale: false };
      },
      getDraft: () => ({ binding, figures: {} }),
      getCheckpoint: () => ({ revision: 1, contentHash: 'durable-hash' }),
      isDirty: () => false
    }),
    publicFigureWorkspaceDraft: value => value
  };
  const createController = executableContentFunction('ensureFigureWorkspaceDraftController', {
    articleWorkspaceRestorePersistenceGate: gate,
    FIGURE_WORKSPACE_DRAFT_ASSET_PATH: 'figures/workspace-draft.json',
    articleWorkspaceLifecycleGeneration: 11,
    figureWorkspaceDraftController: null,
    figureWorkspaceDraftControllerPromise: null,
    figureWorkspaceDraftCheckpointLoaded: false,
    figureWorkspaceDraft: null,
    figureWorkspaceDraftCheckpoint: null,
    figureWorkspaceDraftDirty: false,
    currentArticleWorkspace: workspace,
    sameArticleWorkspaceRestoreIdentity: (left, right) =>
      JSON.stringify(left) === JSON.stringify(right),
    articleWorkspaceRestoreError: () => new Error('RESTORE_TARGET_MISMATCH'),
    getWorkspaceAssetCheckpoint,
    assertCurrentArticleWorkspaceLifecycle: lifecycle => assert.equal(lifecycle, 11),
    currentFigureWorkspaceRefreshBinding: () => binding,
    combinedFigureWorkspaceInventory: () => [],
    buildFigureWorkspaceSnapshot: () => ({ figures: [] }),
    persistWorkspaceAssetCheckpoint: persistBound,
    figureWorkspacePersistFailureCode: () => 'FIGURE_WORKSPACE_SAVE_FAILED',
    notifyFigureWorkspaceStateChanged: () => {},
    SciLLM
  });

  await assert.rejects(() => createController({
    privateRestoreController: true,
    restorePersistenceCapability: capability,
    workspace: { ...workspace, workspaceGeneration: 4 }
  }), /RESTORE_TARGET_MISMATCH/u);
  await assert.rejects(() => createController({
    privateRestoreController: true,
    restorePersistenceCapability: {},
    workspace
  }), /RESTORE_TARGET_MISMATCH/u);

  const result = await commit(
    { archive: {}, operationNonce: 'nonce-1234567890' },
    { current: workspace, currentArchive: binding, archive: binding }, 11, {
      assertTarget: async () => {},
      apply: async () => ({ success: true }),
      prepareManualProof: async () => ({ ...binding,
        contentWorldNonce: 'a'.repeat(32), documentEpoch: 2 }),
      ensureController: () => createController({
        privateRestoreController: true,
        restorePersistenceCapability: capability,
        workspace
      }),
      expectedBinding: () => binding,
      sameBinding: (left, right) => JSON.stringify(left) === JSON.stringify(right),
      commitController: () => { order.push('publish'); },
      registerReceipt: async () => { order.push('receipt'); return 'receipt'; }
    }
  );
  assert.equal(result.success, true);
  assert.equal(ensureCalls, 0);
  assert.deepEqual(order, ['read', 'flush', 'publish', 'receipt']);
});

test('frozen mechanism preparation reads the already validated workspace without ensure', async () => {
  const read = executableContentFunction('getWorkspaceAssetCheckpoint');
  const workspace = { workspaceId: `workspace:${'a'.repeat(64)}` };
  let ensureCalls = 0;
  const asset = await read('figures/workspace-draft.json', {
    workspace,
    getLifecycle: () => 9,
    assertLifecycle: lifecycle => assert.equal(lifecycle, 9),
    ensureWorkspace: async () => {
      ensureCalls += 1;
      throw new Error('ENSURE_MUST_NOT_RUN_WHILE_FROZEN');
    },
    send: async message => {
      assert.equal(message.workspaceId, workspace.workspaceId);
      return { success: true, data: { asset: { revision: 7 } } };
    }
  });
  assert.equal(ensureCalls, 0);
  assert.equal(asset.revision, 7);
});

test('workspace restore authorization expires at the exact deadline', () => {
  const isCurrent = executableContentFunction(
    'isArticleWorkspaceRestoreAuthorizationCurrent'
  );
  const authorization = { token: 'restore-token-1234', expiresAt: 5000 };
  assert.equal(isCurrent(authorization, 'restore-token-1234', 4999), true);
  assert.equal(isCurrent(authorization, 'restore-token-1234', 5000), false);
  assert.equal(isCurrent(authorization, 'restore-token-1234', 5001), false);
});

test('popup sends the one-time current-page restore authorization and exact manifest contract', () => {
  const popup = read('popup.js');
  const builder = popup.slice(
    popup.indexOf('function buildArticleWorkspaceRestoreTarget'),
    popup.indexOf('async function restoreCurrentArticleWorkspaceFromDirectory')
  );
  assert.match(builder, /authorizationToken/);
  assert.match(builder, /current:\s*identity\(workspace\)/);
  assert.match(builder, /manifest:\s*identity\(manifest\)/);
  assert.match(builder, /allowContentChanged/);
  assert.equal((popup.match(/action:\s*'applyArticleWorkspaceAssets'/g) || []).length, 2);
  assert.equal((popup.match(
    /const restoreTarget = buildArticleWorkspaceRestoreTarget\(ensured, scanned\.restore\)/g
  ) || []).length, 2);
  assert.equal((popup.match(/commitAuthorizedArticleWorkspaceScan\(/g) || []).length, 3);
});

test('portable archive restore is authorized by the live page and rejects another paper before apply', () => {
  const own = executableContentFunction('ownArticleWorkspaceRestoreValue');
  const restoreError = executableContentFunction('articleWorkspaceRestoreError');
  const normalizeWorkspace = executableContentFunction(
    'normalizedArticleWorkspaceRestoreIdentity', {
      ownArticleWorkspaceRestoreValue: own,
      SciLLM: { normalizeWorkspaceCanonicalUrl: value => new URL(value).href.replace(/\/$/u, '') }
    }
  );
  const normalizeArchive = executableContentFunction(
    'normalizedArticleArchiveRestoreIdentity', {
      ownArticleWorkspaceRestoreValue: own,
      SciLLM: { normalizeWorkspaceCanonicalUrl: value => new URL(value).href.replace(/\/$/u, '') }
    }
  );
  const sameWorkspace = executableContentFunction('sameArticleWorkspaceRestoreIdentity');
  const sameArchive = executableContentFunction('sameArticleArchiveRestoreIdentity');
  const validate = executableContentFunction('validateArticleArchiveRestoreTarget', {
    ownArticleWorkspaceRestoreValue: own,
    normalizedArticleWorkspaceRestoreIdentity: normalizeWorkspace,
    normalizedArticleArchiveRestoreIdentity: normalizeArchive,
    sameArticleWorkspaceRestoreIdentity: sameWorkspace,
    sameArticleArchiveRestoreIdentity: sameArchive,
    articleWorkspaceRestoreError: restoreError
  });
  const workspaceA = {
    workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 4,
    canonicalUrl: 'https://example.org/paper-a', contentHash: 'a'.repeat(64)
  };
  const workspaceB = {
    workspaceId: `workspace:${'b'.repeat(64)}`, workspaceGeneration: 4,
    canonicalUrl: 'https://example.org/paper-b', contentHash: 'b'.repeat(64)
  };
  const archiveA = {
    documentId: `sha256:${'c'.repeat(64)}`, documentHash: 'archive-a',
    canonicalUrl: workspaceA.canonicalUrl
  };
  assert.equal(normalizeArchive({
    ...archiveA, documentId: 'legacy.document:2026-08'
  }).documentId, 'legacy.document:2026-08');
  assert.equal(normalizeArchive({ ...archiveA, documentId: 'bad/document' }).documentId, '');
  const input = {
    archive: archiveA,
    restoreTarget: {
      current: workspaceA, currentArchive: archiveA,
      archive: archiveA, allowContentChanged: false
    }
  };
  assert.equal(validate(input, workspaceA, { identity: workspaceA }, archiveA)
    .archive.documentId, archiveA.documentId);
  assert.throws(() => validate(input, workspaceB, { identity: workspaceB }, {
    ...archiveA, documentId: `sha256:${'d'.repeat(64)}`,
    canonicalUrl: workspaceB.canonicalUrl
  }),
    error => error.code === 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');
  const changedArchive = {
    ...archiveA, documentId: `sha256:${'e'.repeat(64)}`, documentHash: 'changed'
  };
  assert.throws(() => validate({
    archive: changedArchive,
    restoreTarget: {
      ...input.restoreTarget, archive: changedArchive, allowContentChanged: false
    }
  }, workspaceA, { identity: workspaceA }, archiveA),
  error => error.code === 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');
  const changedTarget = validate({
    archive: changedArchive,
    restoreTarget: {
      ...input.restoreTarget, archive: changedArchive, allowContentChanged: true
    }
  }, workspaceA, { identity: workspaceA }, archiveA);
  assert.deepEqual(changedTarget.currentArchive, archiveA,
    'the frozen target retains the current live document identity');
  assert.equal(changedTarget.allowContentChanged, true);
  assert.deepEqual(changedTarget.archive, changedArchive,
    'the old archive remains a separately validated payload');

  const liveBinding = executableContentFunction('articleArchiveRestoreLiveFigureBinding');
  assert.deepEqual(liveBinding(changedTarget), {
    documentId: archiveA.documentId,
    documentHash: archiveA.documentHash,
    canonicalUrl: archiveA.canonicalUrl,
    workspaceId: workspaceA.workspaceId,
    workspaceGeneration: workspaceA.workspaceGeneration
  });

  const popup = read('popup.js');
  const applyStart = popup.indexOf('async function applyLoadedArticleArchive');
  const applyEnd = popup.indexOf('async function loadCurrentArticleArchive', applyStart);
  const apply = popup.slice(applyStart, applyEnd);
  assert.match(apply, /action:\s*'ensureArticleWorkspace'/);
  assert.match(apply, /buildArticleArchiveRestoreTarget/);
  assert.match(apply, /restoreTarget/);
  const contentApplyIndex = apply.indexOf("action: 'applyArticleArchiveSnapshot'");
  const durableApplyIndex = apply.indexOf("type: 'ARTICLE_ARCHIVE_COMMIT_RESTORE'");
  assert.ok(contentApplyIndex >= 0 && durableApplyIndex > contentApplyIndex,
    'archive persistence must follow the content-script authorization commit');
  assert.doesNotMatch(apply.slice(0, contentApplyIndex), /apply:\s*true/);
  assert.match(apply, /type:\s*'ARTICLE_ARCHIVE_COMMIT_RESTORE'/);
  assert.match(apply, /const currentArchive = \{ \.\.\.restoreTarget\.currentArchive \}/u);
  assert.match(apply, /type:\s*'ARTICLE_ARCHIVE_COMMIT_RESTORE'[\s\S]*?currentArchive,/u);
  assert.doesNotMatch(apply, /type:\s*'ARTICLE_ARCHIVE_LOAD'[\s\S]*apply:\s*true/);
  const archiveLoad = popup.slice(
    popup.indexOf('async function loadCurrentArticleArchive'),
    popup.indexOf('function downloadArticleArchive')
  );
  assert.match(archiveLoad, /ARTICLE_ARCHIVE_LOAD[\s\S]*apply:\s*false/);
  assert.match(popup, /currentArchive:/);
  assert.match(popup, /allowContentChanged:/);
  const content = read('content.js');
  assert.match(content, /applyArticleArchiveSnapshot\(request\.archive,\s*request\.restoreTarget\)/);
});

test('authorized content-changed Figure restore rebinds an old archive draft only to current live', () => {
  const restoreDraft = executableContentFunction('restoreFigureWorkspaceDraft', {
    combinedFigureWorkspaceInventory: () => [],
    currentFigureWorkspaceRefreshBinding: () => ({
      documentId: 'doc-live', documentHash: 'hash-live',
      canonicalUrl: 'https://example.test/paper',
      workspaceId: 'workspace:live', workspaceGeneration: 8
    }),
    figureWorkspaceCompletedModelResult: () => null,
    SciLLM: {
      createFigureWorkspaceDraft: () => ({ figures: {} }),
      initializeFigureWorkspaceDraftState: options => ({
        draft: options.memoryDraft, checkpoint: { revision: 0, contentHash: '' }, dirty: true
      })
    },
    figureWorkspaceDraft: null,
    figureWorkspaceDraftCheckpoint: null,
    figureWorkspaceDraftDirty: false,
    figureWorkspaceDraftCheckpointLoaded: false,
    figureWorkspaceDraftController: null,
    figureWorkspaceDraftControllerPromise: null,
    figureWorkspaceInventorySeedPromise: Promise.resolve()
  });
  const oldDraft = {
    figures: { old: { figureId: 'old' } },
    binding: {
      documentId: 'doc-old', documentHash: 'hash-old',
      canonicalUrl: 'https://example.test/paper',
      workspaceId: 'workspace:old', workspaceGeneration: 2
    }
  };
  const rebound = restoreDraft(oldDraft, [], null, {
    allowContentChangedBinding: true
  });
  assert.equal(rebound.figures.old.figureId, 'old');
  assert.deepEqual(rebound.binding, {
    documentId: 'doc-live', documentHash: 'hash-live',
    canonicalUrl: 'https://example.test/paper',
    workspaceId: 'workspace:live', workspaceGeneration: 8
  });
});

test('Figure inventory uses mutation-driven invalidation and throttled freshness checks', () => {
  const script = read('content.js');
  const inventoryStart = script.indexOf('function getFigureWorkspaceInventory(');
  const inventoryEnd = script.indexOf('function getActiveFigureAnalysisForDomino', inventoryStart);
  const inventory = script.slice(inventoryStart, inventoryEnd);
  assert.match(script, /let figureWorkspaceInventoryDirty = true/);
  assert.match(script, /FIGURE_WORKSPACE_FRESHNESS_TTL_MS = 2000/);
  assert.match(script, /function isFigureInventoryMutation\(/);
  assert.match(script, /markFigureWorkspaceInventoryDirty\(\{ notify: true \}\)/);
  assert.match(inventory, /freshnessCheckDue/);
  assert.match(inventory, /if \(!inventoryChanged\) \{\s*return figureWorkspaceInventory;/);
  assert.match(inventory, /figureWorkspaceInventoryDirty = false/);
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
  assert.match(script, /function focusArticleSourceQuote/);
  assert.match(script, /findCanonicalQuoteSourceSpan/);
  assert.match(script, /CSS\?\.highlights|CSS\.highlights/);
  assert.match(workflow, /focusedGranularity/);
  assert.match(workflow, /'sentence'/);
  assert.match(script, /citationResult/);
});

test('article chat progress is applied only to the matching active turn', () => {
  const script = read('content.js');
  const start = script.indexOf('function notifyArticleChatStateChanged');
  const end = script.indexOf('function createArticleChatTurn', start);
  const workflow = script.slice(start, end);
  assert.ok(start >= 0);
  assert.match(workflow, /chat_answer_block/);
  assert.match(workflow, /chat_context_ready/);
  assert.match(workflow, /chat_usage/);
  assert.match(workflow, /operationId/);
  assert.match(workflow, /turnId/);
  assert.match(workflow, /answerBlocks\.some/);
  assert.match(workflow, /ARTICLE_CHAT_STATE_CHANGED/);
});

test('article chat enqueue freezes web search and disables it for selection or highlight turns', () => {
  const normalizeContextScope = executableContentFunction(
    'normalizeArticleChatContextScope'
  );
  const createTurn = executableContentFunction('createArticleChatTurn', {
    SciLLM: {
      ...ArticleChat, ...ArticleChatAttachments,
      normalizePdfSelectionEvidence: value => value ? { ...value } : null
    },
    articleChatTurnSequence: 0,
    normalizeArticleChatContextScope: normalizeContextScope
  });
  const options = { webSearch: { enabled: true } };
  const ordinary = createTurn('最新进展是什么？', 'profile_web', options);
  options.webSearch.enabled = false;
  assert.deepEqual(ordinary.webSearch, {
    enabled: true, searched: false, completedOperationId: ''
  });

  const selection = createTurn('解释选中段落', 'profile_web', {
    webSearch: { enabled: true },
    selectionEvidence: { documentHash: 'doc', pageNumber: 1 }
  });
  const highlight = createTurn('检索全文', 'profile_web', {
    intent: 'highlight', webSearch: { enabled: true }
  });
  assert.equal(selection.webSearch.enabled, false);
  assert.equal(highlight.webSearch.enabled, false);
});

test('content admits only a binding-checked web grounding receipt into a public turn', () => {
  const source = contentFunctionSource('normalizeArticleChatWebGroundingForTurn');
  assert.match(source, /normalizeArticleChatWebGroundingReceipt/);
  assert.match(source, /providerId/);
  assert.match(source, /completedOperationId/);
  assert.match(source, /answerBlocks/);
  assert.doesNotMatch(source, /\.\.\.turn\.webGrounding|Object\.assign/);

  const seen = [];
  const normalize = executableContentFunction(
    'normalizeArticleChatWebGroundingForTurn', {
      SciLLM: {
        normalizeArticleChatWebGroundingReceipt(receipt, binding) {
          seen.push({ receipt, binding });
          return receipt?.safe === true ? { schemaVersion: 1, sources: [] } : null;
        }
      },
      articleChatTurnAnswerText: turn => turn.answerBlocks
        .map(block => block.markdown).join('\n\n')
    }
  );
  const base = {
    turnId: 'turn-web-1', question: 'question',
    answerBlocks: [{ blockId: 'block-1', markdown: 'answer' }],
    route: { providerId: 'deepseek', model: 'deepseek-v4-flash' },
    webSearch: {
      enabled: true, searched: true, completedOperationId: 'chat-op-1'
    }
  };
  assert.equal(normalize({ ...base, webGrounding: { safe: false } }), null);
  assert.deepEqual(normalize({ ...base, webGrounding: { safe: true } }), {
    schemaVersion: 1, sources: []
  });
  assert.equal(seen.at(-1).binding.operationId, 'chat-op-1');
  assert.equal(seen.at(-1).binding.providerId, 'deepseek');
  assert.equal(seen.at(-1).binding.answer, 'answer');
});

test('public chat restore retains only an exact answer-bound web receipt', () => {
  const answerText = executableContentFunction('articleChatTurnAnswerText');
  const normalizeReceipt = executableContentFunction(
    'normalizeArticleChatWebGroundingForTurn', {
      SciLLM: ArticleChatWebSources,
      articleChatTurnAnswerText: answerText
    }
  );
  const normalizeEvidence = executableContentFunction('normalizeArticleChatEvidence');
  const publicBlock = executableContentFunction('publicArticleChatBlock', {
    normalizeArticleChatEvidence: normalizeEvidence
  });
  const publicTurn = executableContentFunction('publicArticleChatTurn', {
    SciLLM: { ...ArticleChat, ...ArticleChatAttachments },
    normalizeArticleChatContextScope: executableContentFunction(
      'normalizeArticleChatContextScope'
    ),
    publicArticleChatBlock: publicBlock,
    publicArticleChatPlan: executableContentFunction('publicArticleChatPlan'),
    normalizeArticleChatWebGroundingForTurn: normalizeReceipt
  });
  const url = 'https://pubmed.ncbi.nlm.nih.gov/12345678/';
  const sourceId = `web-source-${crypto.createHash('sha256')
    .update(url).digest('hex').slice(0, 16)}`;
  const binding = {
    providerId: 'deepseek', model: 'deepseek-v4-flash-vision-exp',
    turnId: 'turn-web-restore', operationId: 'chat-web-restore',
    question: '最新证据是什么？', answer: '这是经验证的联网回答。',
    answerBlocks: [{ blockId: 'block-web-1', markdown: '这是经验证的联网回答。' }]
  };
  const webGrounding = ArticleChatWebSources.createArticleChatWebGroundingReceipt({
    ...binding,
    grounding: {
      schemaVersion: 1,
      providerId: binding.providerId,
      model: binding.model,
      providerResponseId: 'response-web-restore',
      searched: true,
      sources: [{
        sourceId, url, title: 'PubMed source',
        hostname: 'pubmed.ncbi.nlm.nih.gov', blockIds: ['block-web-1']
      }]
    }
  });
  const persisted = {
    turnId: binding.turnId,
    question: binding.question,
    intent: 'answer',
    answerBlocks: binding.answerBlocks,
    status: 'completed',
    route: { providerId: binding.providerId, model: binding.model },
    webSearch: {
      enabled: true, searched: true,
      completedOperationId: binding.operationId
    },
    webGrounding,
    createdAt: 1,
    updatedAt: 2
  };
  const restored = publicTurn(persisted);
  assert.equal(restored.webSearch.searched, true);
  assert.equal(restored.webGrounding.receiptId, webGrounding.receiptId);
  assert.equal(restored.webGrounding.grounding.sources[0].url, url);

  const tampered = publicTurn({
    ...persisted,
    answerBlocks: [{ ...binding.answerBlocks[0], markdown: '被篡改的回答。' }]
  });
  assert.equal(tampered.webSearch.searched, false);
  assert.equal(tampered.webSearch.completedOperationId, '');
  assert.equal(tampered.webGrounding, null);
  assert.deepEqual(tampered.answerBlocks, []);
  assert.equal(tampered.summary, '');
  assert.equal(tampered.status, 'error');
  assert.equal(tampered.errorCode, 'WEB_SEARCH_GROUNDING_MISSING');
  assert.match(tampered.error, /来源|凭据|验证/);

  const imported = publicTurn({
    ...persisted,
    answerBlocks: [{ ...binding.answerBlocks[0], markdown: '外部导入的可读回答。' }],
    summary: '外部导入摘要',
    answerProvenance: {
      origin: 'external_import', verification: 'unverified'
    }
  });
  assert.equal(imported.answerBlocks[0].markdown, '外部导入的可读回答。');
  assert.equal(imported.summary, '外部导入摘要');
  assert.equal(imported.status, 'completed');
  assert.deepEqual(imported.answerProvenance, {
    origin: 'external_import', verification: 'unverified'
  });
  assert.equal(imported.webGrounding, null);
  assert.equal(imported.webSearch.searched, false);
  const live = publicTurn({
    ...persisted,
    answerProvenance: { origin: 'provider_unverified', verification: 'unverified' }
  });
  assert.equal(live.status, 'completed');
  assert.equal(live.answerBlocks[0].markdown, binding.answer);
  assert.deepEqual(live.answerProvenance, { origin: 'provider_unverified', verification: 'unverified' });
  assert.equal(live.webGrounding, null, 'unverified status wins over an otherwise valid receipt');
  assert.equal(live.webSearch.searched, false);
  assert.deepEqual(publicTurn(JSON.parse(JSON.stringify(live))).answerProvenance, live.answerProvenance);
});

test('article chat history never reuses web-grounded answers without their sources', () => {
  const historyForTurn = executableContentFunction('articleChatHistoryForTurn', {
    articleChatState: {
      turns: [
        {
          turnId: 'offline', status: 'completed', question: '论文内问题',
          answerBlocks: [{ blockId: 'offline-block', markdown: '论文内回答' }],
          summary: '', createdAt: 1, webSearch: { enabled: false }
        },
        {
          turnId: 'online', status: 'completed', question: '联网问题',
          answerBlocks: [{ blockId: 'online-block', markdown: '联网回答' }],
          summary: '', createdAt: 2,
          webSearch: { enabled: true, searched: true }
        },
        {
          turnId: 'imported', status: 'completed', question: '外部导入问题',
          answerBlocks: [{ blockId: 'imported-block', markdown: '外部导入回答' }],
          summary: '', createdAt: 2,
          webSearch: { enabled: false },
          answerProvenance: {
            origin: 'external_import', verification: 'unverified'
          }
        },
        {
          turnId: 'current', status: 'queued', question: '当前问题',
          answerBlocks: [], summary: '', createdAt: 3,
          webSearch: { enabled: false }
        }
      ]
    },
    publicArticleChatTurn: value => structuredClone(value)
  });
  assert.deepEqual(historyForTurn('current').map(turn => turn.turnId), ['offline']);
});

test('grounded chat ignores progressive source injection and checkpoints answer plus receipt before completion', () => {
  const progress = contentFunctionSource('applyArticleChatProgress');
  assert.match(progress,
    /phase === 'chat_answer_block'[^\n]*turn\.webSearch\?\.enabled !== true/);
  assert.doesNotMatch(progress, /progress\.webGrounding|progress\.sources/);

  const run = contentFunctionSource('runArticleChatTurn');
  assert.match(run, /webSearch:\s*turn\.webSearch/);
  assert.match(run, /normalizeArticleChatWebGroundingReceipt/);
  assert.match(run, /WEB_SEARCH_GROUNDING_MISSING/);
  assert.match(run,
    /persistArticleChatCheckpoint\(terminalTurn,\s*\{[^}]*force:\s*true[^}]*requireTurnSave:/s);
  const receipt = run.indexOf('normalizeArticleChatWebGroundingReceipt');
  const stage = run.indexOf('const terminalTurn = {', receipt);
  assert.match(run.slice(stage, run.indexOf('mergeArticleChatAnswerBlocks', stage)),
    /answerBlocks:[\s\S]*?\.map\(block => \(\{ \.\.\.block \}\)\)/);
  const merge = run.indexOf('mergeArticleChatAnswerBlocks(terminalTurn', stage);
  const persist = run.indexOf('await persistArticleChatCheckpoint', merge);
  const finalGuard = run.indexOf('if (!isCurrentTurn()) {', persist);
  assert.match(run.slice(finalGuard, run.indexOf('Object.assign(turn, terminalTurn)', finalGuard)),
    /error\.code = 'CANCELLED';\s*throw error;/);
  const commit = run.indexOf('Object.assign(turn, terminalTurn)', finalGuard);
  const publish = run.indexOf("notifyArticleChatStateChanged('turn_updated'", commit);
  assert.ok(receipt >= 0 && stage > receipt && merge > stage && persist > merge &&
    finalGuard > persist && commit > finalGuard && publish > commit);
  assert.match(run,
    /indexState:\s*articleChatIndexStateWithStagedTurn\(terminalTurn\)/);

  const checkpoint = contentFunctionSource('persistArticleChatCheckpoint');
  assert.match(checkpoint, /requireTurnSave/);
  assert.match(checkpoint, /turnResult\?\.saved !== true/);
  assert.match(checkpoint, /ARTICLE_WORKSPACE_TURN_SAVE_FAILED/);
  assert.match(checkpoint, /indexWarning/);
});

test('grounded terminal save ACK precedes completion and failed save never publishes completion', async () => {
  for (const failSave of [false, true]) {
    const turn = { turnId: 'grounded-save-fixture', question: 'question', intent: 'answer',
      selectedProfileId: 'fixture', answerBlocks: [], webSearch: { enabled: true }, attachments: [] };
    const state = { turns: [turn], loading: false };
    const snapshot = { documentHash: 'grounded-document', revision: 1, paragraphs: [] };
    const events = [];
    let releaseSave, reachedSave;
    const saveReached = new Promise(resolve => { reachedSave = resolve; });
    const saveGate = new Promise(resolve => { releaseSave = resolve; });
    const answerBlocks = [{ blockId: 'grounded-block', markdown: 'grounded answer', evidence: [] }];
    const url = 'https://pubmed.ncbi.nlm.nih.gov/12345678/';
    const sourceId = `web-source-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 16)}`;
    const normalizeEvidence = executableContentFunction('normalizeArticleChatEvidence');
    const publicBlock = executableContentFunction('publicArticleChatBlock', { normalizeArticleChatEvidence: normalizeEvidence });
    const attachEvidence = executableContentFunction('attachArticleChatEvidenceIdentity', {
      articleChatCitationSnapshot: executableContentFunction('articleChatCitationSnapshot', {
        getCanonicalArticleSnapshot: () => snapshot
      }), SciLLM: ArticleChat
    });
    const deps = {
      articleChatState: state, articleChatGeneration: 0, articleWorkspaceLifecycleGeneration: 1,
      SciLLM: { ...ArticleChat, ...ArticleChatWebSources }, document: { title: 'fixture' },
      clearArticleChatWebGrounding: executableContentFunction('clearArticleChatWebGrounding', { SciLLM: ArticleChat }),
      getCanonicalArticleSnapshot: () => snapshot,
      resolveCurrentArticleChatScope: () => ({ contextScope: null,
        resolution: { requested: false, sectionIds: [] }, paragraphs: [] }),
      articleChatHistoryForTurn: () => [], currentArticleChatDocumentInputs: async () => ({}),
      currentArticleChatAuthorContext: () => ({}), effectiveArticlePageUrl: () => 'https://example.org/paper',
      articleChatRequestQuestion: executableContentFunction('articleChatRequestQuestion'),
      articleChatTurnAnswerText: executableContentFunction('articleChatTurnAnswerText'),
      mergeArticleChatAnswerBlocks: executableContentFunction('mergeArticleChatAnswerBlocks', {
        publicArticleChatBlock: publicBlock, attachArticleChatEvidenceIdentity: attachEvidence
      }),
      publicArticleChatPlan: executableContentFunction('publicArticleChatPlan'),
      articleChatIndexStateWithStagedTurn: () => ({}),
      persistArticleChatCheckpoint: async (draft, options) => {
        if (options?.requireTurnSave) {
          assert.equal(draft.status, 'completed');
          assert.ok(draft.webGrounding, 'actual receipt must survive into the persisted terminal draft');
          events.push('save-start'); reachedSave(); await saveGate;
          if (failSave) throw Object.assign(new Error('save rejected'), { code: 'ARTICLE_WORKSPACE_TURN_SAVE_FAILED' });
          events.push('save-ack');
        }
        return { turn: { saved: true } };
      },
      notifyArticleChatStateChanged: (_kind, _turn, value) => events.push(value.phase),
      scheduleCurrentArticleArchiveSave: () => {}, showLlmPageStatus: () => {},
      articleChatFailureMessage: error => error.message,
      chrome: { runtime: { sendMessage: async message => {
        if (message.type !== 'LLM_ASK_ARTICLE') return { success: true };
        const route = { providerId: 'deepseek', model: 'fixture' };
        const webGrounding = ArticleChatWebSources.createArticleChatWebGroundingReceipt({
          ...route, turnId: turn.turnId, operationId: message.operationId, question: turn.question,
          answer: 'grounded answer', answerBlocks: answerBlocks.map(({ blockId, markdown }) => ({ blockId, markdown })),
          grounding: { schemaVersion: 1, ...route, providerResponseId: 'fixture-response', searched: true,
            sources: [{ sourceId, url, title: 'source', hostname: 'pubmed.ncbi.nlm.nih.gov', blockIds: ['grounded-block'] }] }
        });
        return { success: true, data: { route, message: { answerBlocks, summary: 'summary', status: 'completed', webGrounding } } };
      } } }
    };
    const run = executableContentFunction('runArticleChatTurn', deps);
    const pending = run(turn);
    await Promise.race([saveReached, pending.then(() => {
      throw new Error(`fixture did not reach terminal save: ${turn.errorCode || turn.error || turn.status}`);
    })]);
    assert.equal(turn.status, 'generating');
    assert.equal(turn.webGrounding, null);
    assert.equal(events.includes('chat_completed'), false);
    releaseSave(); await pending;
    if (failSave) {
      assert.equal(turn.status, 'error');
      assert.equal(turn.webGrounding, null);
      assert.deepEqual(turn.answerBlocks, []);
      assert.equal(events.includes('chat_completed'), false);
    } else {
      assert.equal(turn.status, 'completed');
      assert.ok(turn.webGrounding);
      assert.ok(events.indexOf('chat_completed') > events.indexOf('save-ack'));
    }
  }
});

test('answer deletion and regeneration durably revoke prior web grounding authority', () => {
  for (const name of ['deleteArticleChatAnswer', 'regenerateArticleChatTurn']) {
    const source = contentFunctionSource(name);
    assert.match(source, /^async function/, name);
    assert.match(source, /clearArticleChatWebGrounding\(stagedTurn\)/, name);
    const persist = source.indexOf('await persistArticleChatCheckpoint(stagedTurn');
    const commit = source.indexOf('Object.assign(turn, stagedTurn)', persist);
    assert.ok(persist >= 0 && commit > persist,
      `${name} must not expose the revoked answer before its durable ACK`);
    assert.match(source, /requireTurnSave:\s*true/, name);
  }
  const remove = contentFunctionSource('removeArticleChatTurn');
  const removeAck = remove.indexOf('await deleteArticleChatCheckpoint');
  assert.ok(remove.startsWith('async function') && removeAck >= 0 &&
    remove.indexOf('.splice(', removeAck) > removeAck);

  const clear = contentFunctionSource('clearArticleChat');
  const clearAck = clear.indexOf('await deleteWorkspaceTurnCheckpoint');
  assert.ok(clear.startsWith('async function') && clearAck >= 0 &&
    clear.indexOf('articleChatState =', clearAck) > clearAck);

  const bridge = read('content.js');
  const askStart = bridge.indexOf("request.action === 'askArticleWithLLM'");
  const askEnd = bridge.indexOf("request.action === 'cancelArticleChatWithLLM'", askStart);
  assert.match(bridge.slice(askStart, askEnd), /webSearch:\s*request\.webSearch/);
  for (const action of [
    'deleteArticleChatTurn', 'deleteArticleChatAnswer',
    'deleteQueuedArticleChatTurn', 'regenerateArticleChatTurn', 'clearArticleChat'
  ]) {
    const start = bridge.indexOf(`request.action === '${action}'`);
    const end = bridge.indexOf("} else if (request.action ===", start + 1);
    assert.match(bridge.slice(start, end < 0 ? undefined : end),
      /\.then\(result => sendResponse\(result\)\)/, action);
  }
});

test('answer deletion keeps the live answer and source receipt until persistence acknowledges', async () => {
  const original = {
    turnId: 'turn-delete-ack', question: 'question', intent: 'answer',
    status: 'completed', summary: 'summary',
    answerBlocks: [{ blockId: 'block-1', markdown: 'answer' }],
    webSearch: {
      enabled: true, searched: true, completedOperationId: 'operation-1'
    },
    webGrounding: { receiptId: 'receipt-1' },
    answerProvenance: {
      origin: 'external_import', verification: 'unverified'
    },
    usage: { inputTokens: 1 }, plan: { mode: 'paper' }, error: '', errorCode: ''
  };
  const state = { turns: [original], memoryNeedsRebuild: false };
  let releaseSave;
  let rejectSave = false;
  let stagedSnapshot = null;
  const clearedSemanticOverlays = [];
  const saveGate = () => new Promise(resolve => { releaseSave = resolve; });
  const dependencies = {
    articleChatState: state,
    articleWorkspaceLifecycleGeneration: 4,
    articleChatMutationLocks: new Set(),
    articleChatClearInFlight: false,
    cloneArticleChatTurnForMutation: turn => ({
      ...turn,
      answerBlocks: turn.answerBlocks.map(block => ({ ...block })),
      webSearch: { ...turn.webSearch }
    }),
    clearArticleChatWebGrounding: executableContentFunction(
      'clearArticleChatWebGrounding', { SciLLM: ArticleChat }
    ),
    articleChatIndexStateWithStagedTurn: () => ({}),
    persistArticleChatCheckpoint: async turn => {
      stagedSnapshot = structuredClone(turn);
      await saveGate();
      if (rejectSave) throw new Error('save failed');
      return { turn: { saved: true } };
    },
    assertCurrentArticleWorkspaceLifecycle: () => {},
    scheduleCurrentArticleArchiveSave: () => {},
    notifyArticleChatStateChanged: () => {},
    clearNativePdfSemanticChatHighlights: turnId => {
      clearedSemanticOverlays.push(turnId);
    },
    publicArticleChatTurn: turn => structuredClone(turn)
  };
  const deleteAnswer = executableContentFunction('deleteArticleChatAnswer', dependencies);
  const pending = deleteAnswer(original.turnId);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(original.answerBlocks[0].markdown, 'answer');
  assert.equal(original.webGrounding.receiptId, 'receipt-1');
  assert.deepEqual(stagedSnapshot.answerBlocks, []);
  assert.equal(stagedSnapshot.webGrounding, null);
  assert.equal(stagedSnapshot.answerProvenance, null);
  assert.equal(original.answerProvenance.origin, 'external_import');
  assert.deepEqual(clearedSemanticOverlays, [],
    'semantic overlay must remain visible until the durable answer deletion ACK');
  releaseSave();
  const result = await pending;
  assert.equal(result.deleted, true);
  assert.deepEqual(original.answerBlocks, []);
  assert.equal(original.webGrounding, null);
  assert.equal(original.answerProvenance, null);
  assert.deepEqual(clearedSemanticOverlays, [original.turnId]);

  Object.assign(original, {
    status: 'completed', summary: 'restored summary',
    answerBlocks: [{ blockId: 'block-2', markdown: 'restored answer' }],
    webSearch: { enabled: true, searched: true, completedOperationId: 'operation-2' },
    webGrounding: { receiptId: 'receipt-2' },
    answerProvenance: {
      origin: 'external_import', verification: 'unverified'
    }
  });
  rejectSave = true;
  const failed = deleteAnswer(original.turnId);
  await new Promise(resolve => setImmediate(resolve));
  releaseSave();
  await assert.rejects(failed, /save failed/);
  assert.equal(original.answerBlocks[0].markdown, 'restored answer');
  assert.equal(original.webGrounding.receiptId, 'receipt-2');
  assert.equal(original.answerProvenance.origin, 'external_import');
  assert.deepEqual(clearedSemanticOverlays, [original.turnId],
    'a failed save must retain the live semantic overlay');
});

test('imported answer regeneration clears old provenance only after the queued save ACK', async () => {
  const importedProvenance = {
    origin: 'external_import', verification: 'unverified'
  };
  const createOriginal = () => ({
    turnId: 'turn-regenerate-imported', question: 'question', intent: 'answer',
    status: 'completed', summary: 'imported summary',
    answerBlocks: [{ blockId: 'block-imported', markdown: 'imported answer' }],
    webSearch: { enabled: false, searched: false, completedOperationId: '' },
    webGrounding: null,
    answerProvenance: { ...importedProvenance },
    selectedProfileId: 'profile-old', error: '', errorCode: ''
  });
  const makeDependencies = (state, persist, clearedSemanticOverlays) => ({
    articleChatState: state,
    articleWorkspaceLifecycleGeneration: 7,
    articleChatMutationLocks: new Set(),
    articleChatClearInFlight: false,
    cloneArticleChatTurnForMutation: turn => ({
      ...turn,
      answerBlocks: turn.answerBlocks.map(block => ({ ...block })),
      webSearch: { ...turn.webSearch }
    }),
    clearArticleChatWebGrounding: executableContentFunction(
      'clearArticleChatWebGrounding', { SciLLM: ArticleChat }
    ),
    articleChatIndexStateWithStagedTurn: () => ({}),
    persistArticleChatCheckpoint: persist,
    assertCurrentArticleWorkspaceLifecycle: () => {},
    scheduleCurrentArticleArchiveSave: () => {},
    notifyArticleChatStateChanged: () => {},
    clearNativePdfSemanticChatHighlights: turnId => {
      clearedSemanticOverlays.push(turnId);
    },
    pumpArticleChatQueue: () => {},
    publicArticleChatTurn: turn => structuredClone(turn)
  });

  const accepted = createOriginal();
  const acceptedState = { turns: [accepted], memoryNeedsRebuild: false };
  let acceptedSnapshot;
  let releaseAcceptedSave;
  const acceptedClears = [];
  const acceptedRegenerate = executableContentFunction(
    'regenerateArticleChatTurn',
    makeDependencies(acceptedState, async staged => {
      acceptedSnapshot = structuredClone(staged);
      await new Promise(resolve => { releaseAcceptedSave = resolve; });
      return { turn: { saved: true } };
    }, acceptedClears)
  );
  const acceptedPending = acceptedRegenerate(accepted.turnId, 'profile-new');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(accepted.status, 'completed');
  assert.deepEqual(accepted.answerProvenance, importedProvenance);
  assert.deepEqual(acceptedClears, [],
    'regeneration must retain provenance and overlay until the queued save ACK');
  releaseAcceptedSave();
  const queued = await acceptedPending;
  assert.equal(queued.queued, true);
  assert.deepEqual(acceptedSnapshot.answerBlocks, []);
  assert.equal(acceptedSnapshot.answerProvenance, null);
  assert.equal(accepted.status, 'queued');
  assert.equal(accepted.answerProvenance, null);
  assert.deepEqual(acceptedClears, [accepted.turnId]);

  const rejected = createOriginal();
  const rejectedState = { turns: [rejected], memoryNeedsRebuild: false };
  const rejectedClears = [];
  const rejectedRegenerate = executableContentFunction(
    'regenerateArticleChatTurn',
    makeDependencies(rejectedState, async staged => {
      assert.equal(staged.answerProvenance, null);
      throw new Error('queued save failed');
    }, rejectedClears)
  );
  await assert.rejects(
    rejectedRegenerate(rejected.turnId, 'profile-new'),
    /queued save failed/
  );
  assert.equal(rejected.status, 'completed');
  assert.equal(rejected.answerBlocks[0].markdown, 'imported answer');
  assert.deepEqual(rejected.answerProvenance, importedProvenance);
  assert.deepEqual(rejectedClears, [],
    'a rejected queued save must retain the imported overlay');
});

test('actual chat execution clears stale imported provenance before provider success or failure', () => {
  const clear = contentFunctionSource('clearArticleChatWebGrounding');
  const run = contentFunctionSource('runArticleChatTurn');
  assert.match(clear, /answerProvenance\s*=\s*null/);
  const generating = run.indexOf("turn.status = 'generating'");
  const clearAtStart = run.indexOf('clearArticleChatWebGrounding(turn)', generating);
  const providerRequest = run.indexOf('const requestArticleChat', clearAtStart);
  assert.ok(generating >= 0 && clearAtStart > generating && providerRequest > clearAtStart);
});

test('chat cancellation waits for durable acknowledgement and propagates save failure', async () => {
  for (const fail of [false, true]) {
    const turn = { turnId: 'cancel-ack', operationId: 'op', status: 'generating' };
    const state = { turns: [turn], activeTurnId: turn.turnId, operationId: 'op', loading: true };
    let release;
    let settled = false;
    let options;
    const locks = new Set();
    const cancel = executableContentFunction('cancelArticleChatWithLLM', {
      articleChatState: state, articleChatGeneration: 1,
      articleWorkspaceLifecycleGeneration: 1,
      articleChatMutationLocks: locks, articleChatClearInFlight: false,
      assertCurrentArticleWorkspaceLifecycle: () => {},
      persistArticleChatCheckpoint: async (_, opts) => {
        options = opts;
        await new Promise(resolve => { release = resolve; });
        if (fail) throw new Error('cancel save failed');
      },
      chrome: { runtime: { sendMessage: async () => ({ success: true }) } },
      scheduleArticleWorkspaceArtifactsSave: () => {},
      scheduleCurrentArticleArchiveSave: () => {},
      notifyArticleChatStateChanged: () => {},
      pumpArticleChatQueue: () => {}
    });
    const pending = cancel().finally(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'cancel must not succeed before the save ACK');
    assert.equal(locks.has(turn.turnId), true);
    assert.equal(options.requireTurnSave, true);
    release();
    if (fail) await assert.rejects(pending, /cancel save failed/);
    else assert.equal((await pending).cancelled, true);
    assert.equal(locks.size, 0);
  }
});

test('chat clear gate prevents the queue pump from respinning while durable deletes wait', () => {
  const pump = contentFunctionSource('pumpArticleChatQueue');
  assert.match(pump,
    /if \(queued && !articleChatClearInFlight && !articleChatState.loading\) \{\s*void pumpArticleChatQueue\(\)/);
  const clear = contentFunctionSource('clearArticleChat');
  const release = clear.indexOf('articleChatClearInFlight = false');
  const resume = clear.indexOf('pumpArticleChatQueue()', release);
  assert.ok(release >= 0 && resume > release,
    'a failed clear must resume any unchanged queued work only after releasing the gate');
});

test('grounded turn checkpoint requires the turn ACK but tolerates a stale derived index', async () => {
  let indexWrites = 0;
  const checkpointWithoutAck = executableContentFunction('persistArticleChatCheckpoint', {
    persistWorkspaceTurnCheckpoint: async () => ({ saved: false, stale: true }),
    persistWorkspaceAssetCheckpoint: async () => { indexWrites += 1; },
    getPublicArticleChatState: () => ({})
  });
  await assert.rejects(
    checkpointWithoutAck({ turnId: 'turn-web' }, { requireTurnSave: true }),
    error => error?.code === 'ARTICLE_WORKSPACE_TURN_SAVE_FAILED'
  );
  assert.equal(indexWrites, 0);

  const checkpointWithIndexFailure = executableContentFunction(
    'persistArticleChatCheckpoint', {
      persistWorkspaceTurnCheckpoint: async () => ({ saved: true }),
      persistWorkspaceAssetCheckpoint: async () => {
        indexWrites += 1;
        throw new Error('index unavailable');
      },
      getPublicArticleChatState: () => ({})
    }
  );
  const result = await checkpointWithIndexFailure(
    { turnId: 'turn-web' }, { force: true, requireTurnSave: true }
  );
  assert.equal(result.turn.saved, true);
  assert.equal(result.index, null);
  assert.equal(result.indexWarning, 'index unavailable');
  assert.equal(indexWrites, 1);
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

test('navigation snapshot and outline forwarding preserve whether analysis selection was customized', () => {
  const script = read('content.js');
  const snapshotStart = script.indexOf('function buildArticleWorkspaceSnapshot');
  const snapshotEnd = script.indexOf('function getArticleWorkspaceAssets', snapshotStart);
  const snapshot = script.slice(snapshotStart, snapshotEnd);
  assert.match(snapshot, /analysisSelectionCustomized:/);
  assert.match(snapshot, /deriveArticleAnalysisSelectionCustomized/);

  const workflowStart = script.indexOf('async function analyzeReviewOutlineWithLLM');
  const workflowEnd = script.indexOf('async function maybeAutoAnalyzeWithLLM', workflowStart);
  const workflow = script.slice(workflowStart, workflowEnd);
  assert.match(workflow, /buildReviewOutlineScopePayload\(options, paragraphs, paragraphOnly\)/);
});

test('restored navigation selection ignores stale legacy section ids', () => {
  const derive = executableContentFunction(
    'deriveArticleAnalysisSelectionCustomized',
    { defaultArticleAnalysisSectionSelection: kind => kind === 'main' }
  );
  const restoredSelection = new Map([
    ['legacy-section', true]
  ]);
  const currentSectionKinds = new Map([
    ['current-main', 'main']
  ]);

  assert.equal(derive(restoredSelection, currentSectionKinds), false);
});

test('restored navigation selection recognizes only applicable non-default overrides', () => {
  const derive = executableContentFunction(
    'deriveArticleAnalysisSelectionCustomized',
    { defaultArticleAnalysisSectionSelection: kind => kind === 'main' }
  );
  const currentSectionKinds = new Map([
    ['current-main', 'main'],
    ['current-methods', 'methods']
  ]);

  assert.equal(derive(new Map([['current-main', true]]), currentSectionKinds), false);
  assert.equal(derive(new Map([['current-main', false]]), currentSectionKinds), true);
  assert.equal(derive(new Map([['current-methods', true]]), currentSectionKinds), true);
});

test('full outline scope payload reserves paragraph ids for paragraph-only requests', () => {
  const buildScope = executableContentFunction('buildReviewOutlineScopePayload');
  const paragraphs = [{ paragraphId: 'p-1' }, { paragraphId: 'p-2' }];
  const fullOutline = buildScope({
    scopeSectionIds: ['sec-a'], scopeSelectionProvided: true
  }, paragraphs, false);
  const paragraphOnly = buildScope({
    scopeSectionIds: ['sec-a'], scopeSelectionProvided: true
  }, [paragraphs[0]], true);

  assert.deepEqual(fullOutline, {
    scopeSectionIds: ['sec-a'], scopeSelectionProvided: true
  });
  assert.deepEqual(paragraphOnly, {
    scopeSectionIds: ['sec-a'], scopeSelectionProvided: true,
    scopeParagraphIds: ['p-1']
  });
});

test('content script persists safe LLM failure diagnostics across regex fallback', () => {
  const script = read('content.js');
  assert.equal(
    executeContentRevisionAssignment(script),
    CONTENT_SCRIPT_REVISION
  );
  assert.match(script, /dataset\.sciLlmContentRevision/);
  assert.match(script, /dataset\.sciReaderSingleColumn\s*=\s*'true'/);
  assert.match(script, /dataset\.sciPublisherFamily/);
  assert.match(script, /selectPublisherAdapter\?\.\(location\)/);
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

test('section-scoped analysis accepts both stable paragraph ids and DOM source keys', () => {
  const script = read('content.js');
  const start = script.indexOf('function selectedArticleAnalysisParagraphIds');
  const end = script.indexOf('function filterParagraphsForArticleAnalysis', start);
  const workflow = script.slice(start, end);
  assert.match(workflow, /\.flatMap\(paragraph => \[/);
  assert.match(workflow, /paragraph\.paragraphId/);
  assert.match(workflow, /paragraph\.sourceKey/);
  assert.match(script, /const allowedParagraphIds = selectedArticleAnalysisParagraphIds\(\)/u);
  assert.match(script, /semanticAnalysisScope/u);
});

test('highlight message entry snapshots one current native semantic analysis scope', () => {
  const script = read('content.js');
  const start = script.indexOf("request.action === 'applyHighlight'");
  const end = script.indexOf("request.action === 'extractArticleForLLM'", start);
  const actions = script.slice(start, end);
  assert.match(actions, /currentNativePdfSemanticAnalysisScope\(/u);
  assert.match(actions, /semanticAnalysisScope/u);
  assert.match(actions, /getMatchCounts\(request\.rules,\s*\{[\s\S]*semanticAnalysisScope/u);
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

test('article preindex schedules a leading microtask and canonical idle pass without a panel round trip', () => {
  const script = read('content.js');
  assert.match(script, /scheduleArticlePreindex\('content-script-ready'\)/);
  assert.match(script, /queueMicrotask\(\(\) =>/);
  assert.match(script, /requestIdleCallback/);
  assert.match(script, /setTimeout\([^,]+, 0\)/);
  const warmStart = script.indexOf("request.action === 'warmArticleIndex'");
  assert.ok(warmStart >= 0);
  const warm = script.slice(warmStart, warmStart + 760);
  assert.match(warm, /scheduleArticlePreindex\('warm-article-index'\)/);
  assert.match(warm, /sendResponse\(\{ success: true, scheduled: true \}\)/);
  assert.doesNotMatch(warm, /startArticleStructureObserver\(/);
});

test('article preindex warmups are idempotent per URL and retry a failed leading pass', () => {
  const microtasks = [];
  const idleTasks = [];
  const state = {
    url: '', leadingQueued: false, canonicalQueued: false,
    generation: 0,
    leadingComplete: false, canonicalComplete: false,
    leadingIndex: null, records: null
  };
  let url = 'https://example.org/article-a';
  let extracts = 0;
  let builds = 0;
  let failLeading = false;
  let failCanonical = false;
  let canonicalRuns = 0;
  const schedule = executableContentFunction('scheduleArticlePreindex', {
    articlePreindexScheduler: state,
    canonicalArticlePreindexUrl: () => url.replace(/#.*/, ''),
    globalThis: { location: { get href() { return url; } }, requestIdleCallback: cb => idleTasks.push(cb) },
    queueMicrotask: cb => microtasks.push(cb),
    setTimeout: cb => idleTasks.push(cb),
    resetArticlePreindexForUrl: nextUrl => {
      state.url = nextUrl;
      state.generation += 1;
      state.leadingQueued = false;
      state.canonicalQueued = false;
      state.leadingComplete = false;
      state.canonicalComplete = false;
      state.leadingIndex = null;
      state.records = null;
    },
    runLeadingArticlePreindex: () => {
      if (failLeading) throw new Error('leading failed');
      extracts += 1;
      builds += 1;
    },
    runCanonicalArticlePreindex: () => {
      assert.equal(state.leadingComplete, true);
      canonicalRuns += 1;
      if (failCanonical) throw new Error('canonical failed');
    }
  });
  const flush = () => {
    while (microtasks.length) microtasks.shift()();
    while (idleTasks.length) idleTasks.shift()();
  };

  schedule('content-script-ready');
  flush();
  schedule('warm-article-index');
  schedule('warm-article-index');
  flush();
  assert.equal(extracts, 1);
  assert.equal(builds, 1);

  // A TTL-sized delay does not invalidate a successful same-document warmup.
  schedule('warm-after-ttl');
  flush();
  assert.equal(extracts, 1);
  assert.equal(builds, 1);

  url = 'https://example.org/article-b';
  schedule('new-url');
  flush();
  assert.equal(extracts, 2);
  assert.equal(builds, 2);

  url = 'https://example.org/article-c';
  failLeading = true;
  schedule('first-failure');
  flush();
  assert.equal(state.leadingComplete, false);
  failLeading = false;
  schedule('retry-after-failure');
  flush();
  assert.equal(extracts, 3);
  assert.equal(builds, 3);

  url = 'https://example.org/article-d';
  failCanonical = true;
  schedule('canonical-failure');
  flush();
  assert.equal(state.canonicalComplete, false);
  failCanonical = false;
  schedule('canonical-retry');
  flush();
  assert.equal(extracts, 4);
  assert.equal(builds, 4);
  assert.equal(canonicalRuns, 5);
});

test('article preindex callback rebinds itself when the live SPA URL changes', () => {
  const microtasks = [];
  const idleTasks = [];
  const state = {
    url: '', generation: 0, leadingQueued: false, canonicalQueued: false,
    leadingComplete: false, canonicalComplete: false, leadingIndex: null, records: null
  };
  let url = 'https://example.org/a';
  const runs = [];
  const schedule = executableContentFunction('scheduleArticlePreindex', {
    articlePreindexScheduler: state,
    canonicalArticlePreindexUrl: () => url.replace(/#.*/, ''),
    globalThis: { location: { get href() { return url; } }, requestIdleCallback: cb => idleTasks.push(cb) },
    queueMicrotask: cb => microtasks.push(cb),
    setTimeout: cb => idleTasks.push(cb),
    runLeadingArticlePreindex: () => runs.push(`leading:${url}`),
    runCanonicalArticlePreindex: () => runs.push(`canonical:${url}`),
    resetArticlePreindexForUrl: nextUrl => {
      state.url = nextUrl;
      state.generation += 1;
      state.leadingQueued = false;
      state.canonicalQueued = false;
      state.leadingComplete = false;
      state.canonicalComplete = false;
    }
  });
  schedule('ready-a');
  url = 'https://example.org/b';
  while (microtasks.length) microtasks.shift()();
  while (idleTasks.length) idleTasks.shift()();
  while (microtasks.length) microtasks.shift()();
  while (idleTasks.length) idleTasks.shift()();
  assert.deepEqual(runs, ['leading:https://example.org/b', 'canonical:https://example.org/b']);
  assert.equal(state.url, 'https://example.org/b');
  assert.equal(state.leadingComplete, true);
  assert.equal(state.canonicalComplete, true);
});

test('workspace persistence rechecks Figure retry guard after async preparation and before send', async () => {
  let liveInputHash = 'expected-input-hash';
  let releaseWorkspace;
  let markWorkspacePending;
  let writes = 0;
  const workspaceGate = new Promise(resolve => { releaseWorkspace = resolve; });
  const workspacePending = new Promise(resolve => { markWorkspacePending = resolve; });
  const dependencies = {
    articleWorkspaceSaveFrozen: false,
    articleWorkspaceLifecycleGeneration: 11,
    articleWorkspaceRestorePersistenceGate: { allows: () => false, consume: () => false },
    articleWorkspaceAssetFingerprint: () => 'retry-draft',
    articleWorkspaceAssetFingerprints: new Map(),
    articleWorkspaceMutationTail: Promise.resolve(),
    currentArticleWorkspace: null,
    ensureCurrentArticleWorkspace: async () => {
      markWorkspacePending();
      await workspaceGate;
      return { workspaceId: 'workspace:a', workspaceGeneration: 1 };
    },
    assertCurrentArticleWorkspaceLifecycle: lifecycle => assert.equal(lifecycle, 11),
    chrome: { runtime: { sendMessage: async () => {
      writes += 1;
      return { success: true, data: { saved: true, asset: {
        revision: 1, contentHash: 'hash-1'
      } } };
    } } }
  };
  const persist = executableContentFunction('persistWorkspaceAssetCheckpoint', dependencies);
  const expectedInputHash = liveInputHash;
  const pending = persist('figures/workspace-draft.json', { revision: 1 }, {
    force: true,
    commitGuard() {
      if (liveInputHash !== expectedInputHash) {
        const error = new Error('FIGURE_PANEL_RETRY_SCOPE_STALE');
        error.code = 'FIGURE_PANEL_RETRY_SCOPE_STALE';
        throw error;
      }
    }
  });
  await workspacePending;
  liveInputHash = 'mutated-while-workspace-preparation-pending';
  releaseWorkspace();
  await assert.rejects(pending,
    error => error.code === 'FIGURE_PANEL_RETRY_SCOPE_STALE');
  assert.equal(writes, 0);
});

test('late Figure mutation after staging put aborts quarantine with no confirm or live draft write', async () => {
  let liveInputHash = 'expected-input-hash';
  let releaseStagingPut;
  let markStagingPending;
  const stagingGate = new Promise(resolve => { releaseStagingPut = resolve; });
  const stagingPending = new Promise(resolve => { markStagingPending = resolve; });
  const messages = [];
  const durableMain = { revision: 4, marker: 'authoritative-human-draft' };
  const durableMainBefore = structuredClone(durableMain);
  let quarantinedCandidate = null;
  let mirrorWrites = 0;
  let guardSequence = 0;
  const dependencies = {
    articleWorkspaceSaveFrozen: false,
    articleWorkspaceLifecycleGeneration: 11,
    articleWorkspaceRestorePersistenceGate: { allows: () => false, consume: () => false },
    articleWorkspaceAssetFingerprint: () => 'retry-draft',
    articleWorkspaceAssetFingerprints: new Map(),
    articleWorkspaceMutationTail: Promise.resolve(),
    currentArticleWorkspace: null,
    ensureCurrentArticleWorkspace: async () => ({
      workspaceId: 'workspace:a', workspaceGeneration: 1
    }),
    assertCurrentArticleWorkspaceLifecycle: lifecycle => assert.equal(lifecycle, 11),
    issueFigureWorkspaceCommitGuard: () => `figure-retry-guard-token${++guardSequence}1234`,
    revokeFigureWorkspaceCommitGuard: () => {},
    chrome: { runtime: { sendMessage: async message => {
      messages.push(structuredClone(message));
      if (message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET') {
        markStagingPending();
        await stagingGate;
        quarantinedCandidate = structuredClone(message.content);
        return { success: true, data: {
          staged: true,
          stagingPath: 'internal/figure-retry-staging/figure-retry-guard-token11234.json',
          stagingRevision: 1,
          stagingContentHash: 'stage-hash'
        } };
      }
      if (message.type === 'ARTICLE_WORKSPACE_ABORT_STAGED_ASSET') {
        quarantinedCandidate = null;
        return { success: true, data: { aborted: true } };
      }
      if (message.type === 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET') {
        throw new Error('stale candidate must never be confirmed');
      }
      throw new Error(`unexpected ${message.type}`);
    } } }
  };
  const persist = executableContentFunction('persistWorkspaceAssetCheckpoint', dependencies);
  const expectedInputHash = liveInputHash;
  const pending = persist('figures/workspace-draft.json', { revision: 5 }, {
    force: true,
    commitGuard() {
      if (liveInputHash !== expectedInputHash) {
        const error = new Error('FIGURE_PANEL_RETRY_SCOPE_STALE');
        error.code = 'FIGURE_PANEL_RETRY_SCOPE_STALE';
        throw error;
      }
    }
  });
  await stagingPending;
  liveInputHash = 'mutated-after-guard-success-while-staging-put-pending';
  releaseStagingPut();
  await assert.rejects(pending,
    error => error.code === 'FIGURE_PANEL_RETRY_SCOPE_STALE');
  assert.deepEqual(messages.map(message => message.type), [
    'ARTICLE_WORKSPACE_SAVE_ASSET',
    'ARTICLE_WORKSPACE_ABORT_STAGED_ASSET'
  ]);
  assert.equal(dependencies.articleWorkspaceAssetFingerprints.size, 0);
  assert.deepEqual(durableMain, durableMainBefore);
  assert.equal(quarantinedCandidate, null);
  assert.equal(mirrorWrites, 0);
});

test('current Figure retry adopts only after staged promotion and guarded finalization', async () => {
  const messages = [];
  let guardCalls = 0;
  let guardSequence = 0;
  const dependencies = {
    articleWorkspaceSaveFrozen: false,
    articleWorkspaceLifecycleGeneration: 12,
    articleWorkspaceRestorePersistenceGate: { allows: () => false, consume: () => false },
    articleWorkspaceAssetFingerprint: () => 'confirmed-retry-draft',
    articleWorkspaceAssetFingerprints: new Map(),
    articleWorkspaceMutationTail: Promise.resolve(),
    currentArticleWorkspace: null,
    ensureCurrentArticleWorkspace: async () => ({
      workspaceId: 'workspace:a', workspaceGeneration: 1
    }),
    assertCurrentArticleWorkspaceLifecycle: lifecycle => assert.equal(lifecycle, 12),
    issueFigureWorkspaceCommitGuard: () =>
      `figure-retry-guard-happy${++guardSequence}abcd`,
    revokeFigureWorkspaceCommitGuard: () => {},
    chrome: { runtime: { sendMessage: async message => {
      messages.push(structuredClone(message));
      if (message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET') return {
        success: true, data: {
          staged: true,
          stagingPath:
            'internal/figure-retry-staging/figure-retry-guard-happy1abcd.json',
          stagingRevision: 1,
          stagingContentHash: 'stage-hash'
        }
      };
      if (message.type === 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET') return {
        success: true, data: { promoted: true, asset: {
          relativePath: 'figures/workspace-draft.json',
          revision: 8, contentHash: 'promoted-hash'
        } }
      };
      if (message.type === 'ARTICLE_WORKSPACE_FINALIZE_STAGED_ASSET') return {
        success: true, data: { confirmed: true, saved: true,
          directoryPersisted: true, asset: {
            relativePath: 'figures/workspace-draft.json',
            revision: 8, contentHash: 'promoted-hash'
          } }
      };
      if (message.type === 'ARTICLE_WORKSPACE_GET_ASSET') return { success:true,
        data:{found:true,workspaceGeneration:1,asset:{revision:8,contentHash:'promoted-hash',content:{revision:5}}} };
      throw new Error(`unexpected ${message.type}`);
    } } }
  };
  const persist = executableContentFunction('persistWorkspaceAssetCheckpoint', dependencies);
  const result = await persist('figures/workspace-draft.json', { revision: 5 }, {
    force: true,
    requireDirectoryPersistence: true,
    expectedWriteToken: 'workspace-write-v1-1234567890abcdef',
    commitGuard() { guardCalls += 1; }
  });
  assert.equal(result.confirmed, true);
  assert.equal(result.asset.revision, 8);
  assert.equal(guardCalls, 4);
  assert.deepEqual(messages.map(message => message.type), [
    'ARTICLE_WORKSPACE_SAVE_ASSET',
    'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET',
    'ARTICLE_WORKSPACE_FINALIZE_STAGED_ASSET',
    'ARTICLE_WORKSPACE_GET_ASSET'
  ]);
  assert.equal(messages[0].writeToken, 'workspace-write-v1-1234567890abcdef');
  assert.equal(messages[1].stagingPath, messages[2].stagingPath);
  assert.equal(messages[2].promotedRevision, 8);
  assert.equal(dependencies.articleWorkspaceAssetFingerprints.get(
    'figures/workspace-draft.json'
  ), 'confirmed-retry-draft');
});

test('Figure retry confirmation guard rejection aborts staging without compensation write', async () => {
  const messages = [];
  let guardSequence = 0;
  const dependencies = {
    articleWorkspaceSaveFrozen: false,
    articleWorkspaceLifecycleGeneration: 12,
    articleWorkspaceRestorePersistenceGate: { allows: () => false, consume: () => false },
    articleWorkspaceAssetFingerprint: () => 'rejected-before-promotion',
    articleWorkspaceAssetFingerprints: new Map(),
    articleWorkspaceMutationTail: Promise.resolve(),
    currentArticleWorkspace: null,
    ensureCurrentArticleWorkspace: async () => ({
      workspaceId: 'workspace:a', workspaceGeneration: 1
    }),
    assertCurrentArticleWorkspaceLifecycle: lifecycle => assert.equal(lifecycle, 12),
    issueFigureWorkspaceCommitGuard: () =>
      `figure-retry-guard-rejected${++guardSequence}abcd`,
    revokeFigureWorkspaceCommitGuard: () => {},
    chrome: { runtime: { sendMessage: async message => {
      messages.push(structuredClone(message));
      if (message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET') return {
        success: true, data: {
          staged: true,
          stagingPath:
            'internal/figure-retry-staging/figure-retry-guard-rejected1abcd.json',
          stagingRevision: 1,
          stagingContentHash: 'stage-hash'
        }
      };
      if (message.type === 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET') return {
        success: false,
        error: {
          code: 'FIGURE_PANEL_RETRY_SCOPE_STALE',
          message: 'FIGURE_PANEL_RETRY_SCOPE_STALE'
        }
      };
      if (message.type === 'ARTICLE_WORKSPACE_ABORT_STAGED_ASSET') return {
        success: true, data: { aborted: true }
      };
      if (message.type === 'ARTICLE_WORKSPACE_COMPENSATE_STAGED_ASSET') {
        throw new Error('no main receipt exists, so compensation must not write main');
      }
      throw new Error(`unexpected ${message.type}`);
    } } }
  };
  const persist = executableContentFunction(
    'persistWorkspaceAssetCheckpoint', dependencies
  );
  await assert.rejects(() => persist(
    'figures/workspace-draft.json', { revision: 5 }, {
      force: true,
      commitGuard() {}
    }
  ), error => error.code === 'FIGURE_PANEL_RETRY_SCOPE_STALE');
  assert.deepEqual(messages.map(message => message.type), [
    'ARTICLE_WORKSPACE_SAVE_ASSET',
    'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET',
    'ARTICLE_WORKSPACE_ABORT_STAGED_ASSET'
  ]);
  assert.equal(dependencies.articleWorkspaceAssetFingerprints.size, 0);
});

test('Figure retry compensation exposes the rollback checkpoint to the draft controller', async () => {
  const messages = [];
  let guardSequence = 0;
  const rollbackDraft = FigureWorkspace.createFigureWorkspaceDraft([{
    figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A']
  }]);
  rollbackDraft.figures['figure-1'].panels.A.note.value = 'concurrent human note';
  rollbackDraft.figures['figure-1'].panels.A.note.humanReviewed = true;
  const rollbackHash = FigureWorkspace.figureWorkspaceAssetContentFingerprint(
    rollbackDraft
  );
  const dependencies = {
    articleWorkspaceSaveFrozen: false,
    articleWorkspaceLifecycleGeneration: 12,
    articleWorkspaceRestorePersistenceGate: { allows: () => false, consume: () => false },
    articleWorkspaceAssetFingerprint: () => 'retry-that-will-rollback',
    articleWorkspaceAssetFingerprints: new Map(),
    articleWorkspaceMutationTail: Promise.resolve(),
    currentArticleWorkspace: null,
    ensureCurrentArticleWorkspace: async () => ({
      workspaceId: 'workspace:a', workspaceGeneration: 1
    }),
    assertCurrentArticleWorkspaceLifecycle: lifecycle => assert.equal(lifecycle, 12),
    issueFigureWorkspaceCommitGuard: () =>
      `figure-retry-guard-rollback${++guardSequence}abcd`,
    revokeFigureWorkspaceCommitGuard: () => {},
    SciLLM: {
      FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS:
        FigureWorkspace.FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS,
      figureWorkspaceAssetContentFingerprint:
        FigureWorkspace.figureWorkspaceAssetContentFingerprint
    },
    chrome: { runtime: { sendMessage: async message => {
      messages.push(structuredClone(message));
      if (message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET') return {
        success: true, data: {
          staged: true,
          stagingPath:
            'internal/figure-retry-staging/figure-retry-guard-rollback1abcd.json',
          stagingRevision: 1,
          stagingContentHash: 'stage-hash'
        }
      };
      if (message.type === 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET') return {
        success: true, data: { promoted: true, asset: {
          relativePath: 'figures/workspace-draft.json',
          revision: 8, contentHash: 'promoted-hash'
        } }
      };
      if (message.type === 'ARTICLE_WORKSPACE_FINALIZE_STAGED_ASSET') return {
        success: false,
        error: { code: 'ASSET_HASH_CONFLICT', message: 'finalize raced' }
      };
      if (message.type === 'ARTICLE_WORKSPACE_COMPENSATE_STAGED_ASSET') return {
        success: true, data: { compensated: true, asset: {
          relativePath: 'figures/workspace-draft.json',
          revision: 9, contentHash: rollbackHash, content: rollbackDraft
        } }
      };
      throw new Error(`unexpected ${message.type}`);
    } } }
  };
  const persist = executableContentFunction(
    'persistWorkspaceAssetCheckpoint', dependencies
  );
  await assert.rejects(() => persist(
    'figures/workspace-draft.json', { revision: 5 }, {
      force: true,
      commitGuard() {}
    }
  ), error => {
    assert.equal(error.code, 'ASSET_HASH_CONFLICT');
    assert.deepEqual(error.rollbackCheckpoint, {
      revision: 9, contentHash: rollbackHash, content: rollbackDraft
    });
    return true;
  });
  assert.deepEqual(messages.map(message => message.type), [
    'ARTICLE_WORKSPACE_SAVE_ASSET',
    'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET',
    'ARTICLE_WORKSPACE_FINALIZE_STAGED_ASSET',
    'ARTICLE_WORKSPACE_COMPENSATE_STAGED_ASSET'
  ]);
});

test('Figure retry abort and compensation cleanup failures surface one bounded error', async () => {
  for (const scenario of [
    { name: 'abort', staleCall: 2, cleanupType: 'ARTICLE_WORKSPACE_ABORT_STAGED_ASSET' },
    { name: 'compensate', staleCall: 3,
      cleanupType: 'ARTICLE_WORKSPACE_COMPENSATE_STAGED_ASSET' }
  ]) {
    let guardCalls = 0;
    let guardSequence = 0;
    const messages = [];
    const dependencies = {
      articleWorkspaceSaveFrozen: false,
      articleWorkspaceLifecycleGeneration: 13,
      articleWorkspaceRestorePersistenceGate: { allows: () => false, consume: () => false },
      articleWorkspaceAssetFingerprint: () => `cleanup-${scenario.name}`,
      articleWorkspaceAssetFingerprints: new Map(),
      articleWorkspaceMutationTail: Promise.resolve(),
      currentArticleWorkspace: null,
      ensureCurrentArticleWorkspace: async () => ({
        workspaceId: 'workspace:a', workspaceGeneration: 1
      }),
      assertCurrentArticleWorkspaceLifecycle: lifecycle => assert.equal(lifecycle, 13),
      issueFigureWorkspaceCommitGuard: () =>
        `figure-retry-guard-cleanup${++guardSequence}abcd`,
      revokeFigureWorkspaceCommitGuard: () => {},
      chrome: { runtime: { sendMessage: async message => {
        messages.push(structuredClone(message));
        if (message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET') return {
          success: true, data: {
            staged: true,
            stagingPath:
              'internal/figure-retry-staging/figure-retry-guard-cleanupabcd.json',
            stagingRevision: 1, stagingContentHash: 'stage-hash'
          }
        };
        if (message.type === 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET') return {
          success: true, data: { promoted: true, asset: {
            relativePath: 'figures/workspace-draft.json',
            revision: 8, contentHash: 'promoted-hash'
          } }
        };
        if (message.type === scenario.cleanupType) return {
          success: false,
          error: { code: 'ASSET_HASH_CONFLICT', message: 'secret provider payload' }
        };
        throw new Error(`unexpected ${message.type}`);
      } } }
    };
    const persist = executableContentFunction(
      'persistWorkspaceAssetCheckpoint', dependencies
    );
    await assert.rejects(() => persist(
      'figures/workspace-draft.json', { revision: 5 }, {
        force: true,
        commitGuard() {
          guardCalls += 1;
          if (guardCalls === scenario.staleCall) {
            const error = new Error('FIGURE_PANEL_RETRY_SCOPE_STALE');
            error.code = 'FIGURE_PANEL_RETRY_SCOPE_STALE';
            throw error;
          }
        }
      }
    ), error => {
      assert.equal(error.code, 'FIGURE_RETRY_CLEANUP_FAILED');
      assert.doesNotMatch(error.message, /secret|provider payload/iu);
      return true;
    });
    assert.equal(messages.at(-1).type, scenario.cleanupType);
    assert.equal(dependencies.articleWorkspaceAssetFingerprints.size, 0);
  }
});

test('Figure workspace commit guards are one-use TTL-bound capabilities', () => {
  const script = read('content.js');
  const start = script.indexOf('function issueFigureWorkspaceCommitGuard');
  const end = script.indexOf('function persistWorkspaceAssetCheckpoint', start);
  const guards = new Map();
  const context = new Function('figureWorkspaceCommitGuards', 'Date',
    'let figureWorkspaceCommitGuardSequence = 0;\n' +
    `${script.slice(start, end)}\n` +
    'return { issue: issueFigureWorkspaceCommitGuard, ' +
      'validate: validateFigureWorkspaceCommitGuardRequest };'
  )(guards, Date);
  const binding = {
    workspaceLifecycle: 7, workspaceId: 'workspace:a', workspaceGeneration: 3,
    relativePath: 'figures/workspace-draft.json'
  };
  const id = context.issue(binding, () => true);
  const request = {
    action: 'llmFigureWorkspaceCommitGuard', commitGuardKind: 'figure_retry',
    commitGuardId: id, ...binding
  };
  assert.equal(context.validate(request).success, true);
  assert.equal(context.validate(request).code, 'FIGURE_COMMIT_GUARD_UNAVAILABLE');
  assert.equal(guards.size, 0);
});

test('Figure recovery progress keeps explicit safe checkpoint fields and actionable coverage errors', () => {
  const sanitizeText = executableContentFunction('sanitizeFigureProgressText');
  const sanitizePanels = executableContentFunction('sanitizeFigureProgressPanels', {
    sanitizeFigureProgressText: sanitizeText
  });
  const normalize = executableContentFunction('normalizeFigureRecoveryProgressFields', {
    sanitizeFigureProgressText: sanitizeText,
    sanitizeFigureProgressPanels: sanitizePanels
  });
  const progress = normalize({
    missingPanels: ['D', 'E', '<script>'],
    unresolvedPanels: ['F'],
    inputMode: 'caption_context',
    savedPanelCount: 3,
    validatedPanelCount: 4,
    checkpointStatus: ''
  });
  assert.deepEqual(progress, {
    missingPanels: ['D', 'E'],
    unresolvedPanels: ['F'],
    inputMode: 'caption_context',
    savedPanelCount: 3,
    validatedPanelCount: 4,
    checkpointStatus: ''
  });
  const formatFailure = executableContentFunction('formatFigureCoverageFailure', {
    sanitizeFigureProgressPanels: sanitizePanels,
    translateFigureRecoveryText: value => String(value || '')
  });
  assert.equal(formatFailure({
    code: 'FIGURE_PANEL_COVERAGE_INCOMPLETE',
    message: 'Provider returned an invalid response',
    missingPanels: ['D', 'E']
  }, 'Figure 1'), 'Figure 1 尚缺 Panel D、E；已保存 0 个有效 Panel，可仅重试缺失项。');
  assert.doesNotMatch(formatFailure({
    code: 'FIGURE_PANEL_COVERAGE_INCOMPLETE',
    message: 'Provider returned an invalid response', missingPanels: ['D']
  }, 'Figure 1'), /Provider returned an invalid response/u);
});

test('partial Figure checkpoint commit is serialized, stale-safe, and preserves reload state', () => {
  const script = read('content.js');
  assert.match(script, /figurePartialCheckpointCommitTail/);
  assert.match(script, /commitFigurePartialCheckpoint/);
  assert.match(script, /mergeCompletedFigureResultIntoWorkspaceDraft/);
  assert.match(script, /scheduleArticleWorkspaceArtifactsSave\(\{ immediate: true \}\)/);
  assert.match(script, /pendingResults\[depth\]/);
  assert.match(script, /isCurrentFigureOperation\(operationId\)/);
  assert.match(script, /workspaceLifecycle !== articleWorkspaceLifecycleGeneration/);
  assert.match(script, /partial_checkpoint_committed/);
});

test('missing-Panel retry request is revision scoped and never includes completed Panels', () => {
  const normalizePanel = executableContentFunction('normalizeRequestedPanelId');
  const retryScope = executableContentFunction('normalizeFigurePanelRetryScope', {
    normalizeRequestedPanelId: normalizePanel
  });
  const figure = { figureId: 'figure-1', panelHints: ['A', 'B', 'C', 'D'] };
  const result = {
    figureId: 'figure-1', unresolvedPanels: ['C'],
    panelCoverage: { missingPanels: ['D'], unresolvedPanels: ['C'] },
    panels: [{ panel: 'A' }, { panel: 'B' },
      { panel: 'C', status: 'not_identifiable' }]
  };
  assert.deepEqual(retryScope(['C', 'D'], figure, result), ['C', 'D']);
  assert.throws(() => retryScope(['A', 'C', 'D'], figure, result),
    /FIGURE_PANEL_RETRY_SCOPE_STALE/u);
  assert.throws(() => retryScope(['C'], figure, result),
    /FIGURE_PANEL_RETRY_SCOPE_STALE/u);
  assert.match(read('content.js'), /retryMissingFigurePanelsWithLLM/);
});

test('missing-Panel retry outcome distinguishes attempted resolved and remaining Panels', () => {
  const normalizePanel = executableContentFunction('normalizeRequestedPanelId');
  const outcome = executableContentFunction('summarizeFigurePanelRetryOutcome', {
    normalizeRequestedPanelId: normalizePanel
  });
  const figure = { panelHints: ['A', 'B', 'C'] };
  const unresolved = outcome({
    panels: [{ panel: 'A' }, { panel: 'B', status: 'not_identifiable' }],
    panelCoverage: { missingPanels: ['C'], unresolvedPanels: ['B'] }
  }, figure, ['B', 'C'], []);
  assert.equal(unresolved.partial, true);
  assert.deepEqual(unresolved.attemptedPanels, ['B', 'C']);
  assert.deepEqual(unresolved.resolvedPanels, []);
  assert.deepEqual(unresolved.remainingMissingPanels, ['C']);
  assert.deepEqual(unresolved.remainingUnresolvedPanels, ['B']);
  const complete = outcome({
    panels: [{ panel: 'A' }, { panel: 'B' }, { panel: 'C' }],
    panelCoverage: { missingPanels: [], unresolvedPanels: [] }
  }, figure, ['B', 'C'], []);
  assert.equal(complete.partial, false);
  assert.deepEqual(complete.resolvedPanels, ['B', 'C']);
});

test('completed Figure recovery retains its checkpoint until durable clear and drops stale failures', () => {
  const completeRecovery = executableContentFunction(
    'completeFigureRecovery'
  );
  const state = {
    standard: { analysisDepth: 'standard' },
    deep: null,
    deepError: 'old deep coverage failure',
    pendingResults: { deep: { partial: true } },
    activeDepth: 'deep'
  };
  const figure = { figureId: 'figure-1', figureLabel: 'Figure 1' };
  const merged = { figureId: 'figure-1', analysisDepth: 'deep', panels: [] };
  const summary = completeRecovery(state, figure, merged, 'deep', {
    figures: 0, totalFigures: 2, failedFigures: 2,
    failures: [
      { figureId: 'figure-1', message: 'old failure' },
      { figureId: 'figure-2', message: 'other failure' }
    ],
    results: []
  });
  assert.equal(state.deep, merged);
  assert.equal(state.deepError, '');
  assert.deepEqual(state.pendingResults.deep, { partial: true },
    'the durable compare-clear helper owns pending checkpoint removal');
  assert.equal(state.activeDepth, 'deep');
  assert.equal(summary.failedFigures, 1);
  assert.deepEqual(summary.failures.map(item => item.figureId), ['figure-2']);
  assert.deepEqual(summary.results, [merged]);
});

test('failed deep recovery keeps a pending deep retry active and falls back only without it', () => {
  const retain = executableContentFunction('retainFailedFigureDepth');
  const partial = { analysisDepth: 'deep', panels: [{ panel: 'A' }] };
  const withPartial = {
    standard: { analysisDepth: 'standard' }, pendingResults: {}, activeDepth: 'standard'
  };
  assert.deepEqual(retain(withPartial, 'deep', partial), {
    pending: true, activeDepth: 'deep'
  });
  assert.equal(withPartial.pendingResults.deep, partial);
  assert.equal(withPartial.activeDepth, 'deep');
  const withoutPartial = {
    standard: { analysisDepth: 'standard' }, pendingResults: {}, activeDepth: 'deep'
  };
  assert.deepEqual(retain(withoutPartial, 'deep', null), {
    pending: false, activeDepth: 'standard'
  });
  assert.equal(withoutPartial.activeDepth, 'standard');
  const deepSource = contentFunctionSource('analyzeSingleFigureDeep');
  assert.match(deepSource, /stateFields:\s*\[[^\]]*'deepError'[^\]]*'activeDepth'[^\]]*'pendingDeep'/su);
  assert.match(deepSource, /completeFigureRecovery/u);
  assert.match(deepSource, /scheduleCurrentArticleArchiveSave/u);
});

test('Figure recovery idempotency is bound to workspace input and canonical Panel scope', async () => {
  const active = new Map();
  const receipts = new Map();
  const workspace = {
    workspaceId: `workspace:${'a'.repeat(64)}`,
    workspaceGeneration: 3
  };
  const run = executableContentFunction('runIdempotentFigureRecoveryAction', {
    figureRecoveryActiveOperations: active,
    figureRecoveryOperationReceipts: receipts,
    currentArticleWorkspace: workspace,
    articleWorkspaceLifecycleGeneration: 12,
    normalizeRequestedPanelId: executableContentFunction('normalizeRequestedPanelId'),
    Date,
    JSON
  });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let sends = 0;
  const task = async () => { sends += 1; await gate; return { success: true }; };
  const request = {
    operationId: 'figure-recovery:retry-12345678',
    figureId: 'figure-1', analysisDepth: 'standard',
    expectedFigureInputHash: 'full-input-hash-1', panelIds: ['B', 'A', 'A']
  };
  const first = run(request, 'missing_panels', task);
  const duplicate = run({ ...request, panelIds: ['A', 'B'] }, 'missing_panels', task);
  assert.equal(sends, 0);
  await Promise.resolve();
  assert.equal(sends, 1);
  await assert.rejects(
    run({
      ...request,
      operationId: 'figure-recovery:retry-87654321',
      panelIds: ['A', 'C']
    }, 'missing_panels', task),
    error => error.code === 'FIGURE_ANALYSIS_BUSY'
  );
  await assert.rejects(
    run({ ...request, expectedFigureInputHash: 'full-input-hash-2' },
      'missing_panels', task),
    error => error.code === 'FIGURE_PANEL_RETRY_SCOPE_STALE'
  );
  release();
  assert.deepEqual(await Promise.all([first, duplicate]), [
    { success: true }, { success: true }
  ]);
  const replay = await run(request, 'missing_panels', task);
  assert.deepEqual(replay, { success: true });
  assert.equal(sends, 1);
  workspace.workspaceGeneration = 4;
  let validatedAgain = 0;
  const crossSession = await run(request, 'missing_panels', async () => {
    validatedAgain += 1;
    return { success: true, generation: 4 };
  });
  assert.deepEqual(crossSession, { success: true, generation: 4 });
  assert.equal(validatedAgain, 1);

  for (let index = 0; index < 70; index += 1) {
    await run({
      ...request,
      operationId: `figure-recovery:retry-cap-${String(index).padStart(8, '0')}`,
      figureId: `figure-${index + 10}`
    }, 'missing_panels', async () => ({ success: true }));
  }
  assert.equal(receipts.size <= 64, true);
});

test('deep Figure recovery has a real idempotent message action with hash safeguards', () => {
  const script = read('content.js');
  assert.match(script, /request\.action === 'analyzeSingleFigureDeepWithLLM'/u);
  assert.match(script, /runIdempotentFigureRecoveryAction/u);
  const deep = contentFunctionSource('analyzeSingleFigureDeep');
  assert.match(deep, /expectedFigureInputHash/u);
  assert.match(deep, /verifyLiveFigureRetryInput/u);
  assert.match(deep, /preCommit:\s*\(\)\s*=>\s*assertFigureRetryCommitBinding/u);
});

test('Figure analysis promise reuse is bound to depth and action kind', () => {
  const activePromise = Promise.resolve({ analysisDepth: 'deep' });
  const reuse = executableContentFunction('reuseActiveFigureAnalysisPromise', {
    figureDepthAnalysisPromise: activePromise,
    figureDepthAnalysisId: 'figure-1',
    figureDepthAnalysisKind: 'deep',
    throwBusyFigureAnalysis: () => {
      const error = new Error('FIGURE_ANALYSIS_BUSY');
      error.code = 'FIGURE_ANALYSIS_BUSY';
      throw error;
    }
  });
  assert.equal(reuse('figure-1', 'deep'), activePromise);
  assert.throws(() => reuse('figure-1', 'standard'),
    error => error.code === 'FIGURE_ANALYSIS_BUSY');
  assert.throws(() => reuse('figure-1', 'panel:A'),
    error => error.code === 'FIGURE_ANALYSIS_BUSY');
  const script = read('content.js');
  assert.match(script, /figureDepthAnalysisKind = 'deep'/u);
  assert.match(script, /figureDepthAnalysisKind = 'standard'/u);
  assert.match(script, /figureDepthAnalysisKind = `panel:\$\{normalizedPanelId\}`/u);
});

test('exact Figure route preflight fails closed for stale or mismatched service workers', async () => {
  let response;
  let releaseResponse;
  let messages = [];
  const requireFigureTaskAdmission = executableContentFunction(
    'requireFigureTaskAdmission'
  );
  const preflight = executableContentFunction('preflightFigureTaskRoute', {
    requireFigureTaskAdmission,
    chrome: { runtime: { sendMessage(message) {
      messages.push(message);
      if (response === 'delayed') {
        return new Promise(resolve => { releaseResponse = resolve; });
      }
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve(response);
    } } }
  });
  const valid = taskId => ({
    success: true,
    data: {
      ...figureVisionAdmission(taskId),
      route: { taskType: taskId, capabilityMode: 'vision', providerId: 'openai' },
      taskPolicySignature: `policy-${taskId}`
    }
  });

  response = 'delayed';
  const pending = preflight('figure_walkthrough');
  assert.deepEqual(messages, [{
    type: 'LLM_PREFLIGHT_TASK_ROUTE', taskId: 'figure_walkthrough',
    evidenceContractToken: FigureAnalysis.FIGURE_EVIDENCE_CONTRACT_TOKEN
  }]);
  releaseResponse(valid('figure_walkthrough'));
  assert.deepEqual(await pending, { ...valid('figure_walkthrough').data,
    allowTextFallback: false });

  for (const [name, value, expectedCode] of [
    ['old worker', { success: false, error: { code: 'UNKNOWN_MESSAGE' } }, 'UNKNOWN_MESSAGE'],
    ['empty response', undefined, 'FIGURE_EVIDENCE_CONTRACT_MISMATCH'],
    ['missing data', { success: true }, 'FIGURE_EVIDENCE_CONTRACT_MISMATCH'],
    ['wrong evidence contract', { success: true, data: { ...valid('figure_walkthrough').data,
      evidenceContractToken: 'stale-contract' } }, 'FIGURE_EVIDENCE_CONTRACT_MISMATCH'],
    ['wrong task', valid('figure_panel_followup'), 'FIGURE_ROUTE_PREFLIGHT_INVALID'],
    ['wrong route', {
      success: true,
      data: {
        ...valid('figure_walkthrough').data,
        route: { taskType: 'figure_panel_followup', capabilityMode: 'vision' }
      }
    }, 'FIGURE_ROUTE_PREFLIGHT_INVALID'],
    ['text route', {
      success: true,
      data: {
        ...valid('figure_walkthrough').data,
        route: { taskType: 'figure_walkthrough', capabilityMode: 'text' }
      }
    }, 'CAPABILITY_MISMATCH'],
    ['missing signature', {
      success: true,
      data: { ...valid('figure_walkthrough').data, taskPolicySignature: '' }
    }, 'FIGURE_ROUTE_PREFLIGHT_INVALID'],
    ['oversized signature', {
      success: true,
      data: { ...valid('figure_walkthrough').data, taskPolicySignature: 'x'.repeat(257) }
    }, 'FIGURE_ROUTE_PREFLIGHT_INVALID'],
    ['transport failure', Object.assign(new Error('Extension context invalidated'), {
      code: 'TRANSPORT_FAILED'
    }), 'TRANSPORT_FAILED']
  ]) {
    response = value;
    await assert.rejects(
      () => preflight('figure_walkthrough'),
      error => error?.code === expectedCode,
      name
    );
  }

  const sentBeforeInvalidTask = messages.length;
  for (const taskId of [
    '', 'figure', ' figure_walkthrough', 'document_highlight', null
  ]) {
    await assert.rejects(
      () => preflight(taskId),
      error => error?.code === 'UNKNOWN_LLM_TASK'
    );
  }
  assert.equal(messages.length, sentBeforeInvalidTask,
    'invalid local task identities must fail before messaging the worker');
});

test('caption-only Figure admission skips all image reads for whole and Panel requests', async () => {
  const requireFigureTaskAdmission = executableContentFunction('requireFigureTaskAdmission');
  const imageUpgradePolicy = executableFigureImageUpgradePolicy();
  const figure = Object.defineProperties({}, {
    analysisImages: { get() { throw new Error('persisted pixels must not be read'); } },
    imageElements: { get() { throw new Error('DOM pixels must not be read'); } }
  });
  for (const taskId of ['figure_walkthrough', 'figure_panel_interpretation', 'figure_panel_followup']) {
    const admission = figureVisionAdmission(taskId);
    admission.route.capabilityMode = 'caption_text_only';
    const preflight = executableContentFunction('preflightFigureTaskRoute', {
      requireFigureTaskAdmission,
      chrome: { runtime: { sendMessage: async () => ({ success: true, data: admission }) } }
    });
    assert.deepEqual(await preflight(taskId), { ...admission, allowTextFallback: false });
    const prepare = executableContentFunction('prepareFigureImages', {
      requireFigureTaskAdmission,
      ...imageUpgradePolicy
    });
    assert.deepEqual(await prepare(figure, admission, taskId), []);
    const variants = executableContentFunction('prepareFigurePanelImageVariants', { requireFigureTaskAdmission });
    assert.deepEqual(await variants(figure, 'A', admission, taskId), []);
  }
});

test('Figure pixel preparation requires the exact signed task admission before early returns or reads', async () => {
  const requireAdmission = executableContentFunction('requireFigureTaskAdmission');
  const imageUpgradePolicy = executableFigureImageUpgradePolicy();
  const validateFigureProviderImage = image => ({
    mediaType: String(image?.mediaType || ''), dataUrl: String(image?.dataUrl || '')
  });
  const collectValidFigureProviderImages = (value, limit) => ({
    images: (Array.isArray(value) ? value : []).slice(0, limit)
      .map(validateFigureProviderImage),
    rejected: 0,
    truncated: false
  });
  const admitFigureProviderImages = async (value, limit) =>
    collectValidFigureProviderImages(value, limit);
  const prepareImages = executableContentFunction('prepareFigureImages', {
    requireFigureTaskAdmission: requireAdmission,
    ...imageUpgradePolicy,
    admitFigureProviderImages,
    collectValidFigureProviderImages,
    validateFigureProviderImage,
    figureImageError: executableContentFunction('figureImageError'),
    figureImageDiagnosticCode: () => 'FIGURE_IMAGE_INVALID',
    FIGURE_IMAGE_LIMIT: 3,
    FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
    prepareFigureImage: async () => {
      throw new Error('image preparation must not run for invalid admission');
    }
  });
  const figureImagePixelArea = executableContentFunction('figureImagePixelArea');
  const findDedicatedPanelImageElement = executableContentFunction(
    'findDedicatedPanelImageElement'
  );
  const preparePanelVariants = executableContentFunction(
    'prepareFigurePanelImageVariants', {
      requireFigureTaskAdmission: requireAdmission,
      admitFigureProviderImages,
      collectValidFigureProviderImages,
      validateFigureProviderImage,
      figureImageDiagnosticCode: () => 'FIGURE_IMAGE_INVALID',
      figureImagePixelArea,
      findDedicatedPanelImageElement,
      loadPreparedFigureSource: async () => {
        throw new Error('image source must not run for invalid admission');
      },
      loadFigureImage: async () => {
        throw new Error('persisted source must not run for invalid admission');
      },
      normalizePanelCropGeometry: () => null,
      encodeFigureImageVariant: () => {
        throw new Error('encoding must not run for invalid admission');
      }
    }
  );
  assert.doesNotMatch(contentFunctionSource('prepareFigureImages'),
    /LLM_GET_SETTINGS|figureRouteSupportsVision/u);
  assert.doesNotMatch(contentFunctionSource('prepareFigurePanelImageVariants'),
    /LLM_GET_SETTINGS|figureRouteSupportsVision/u);
  let figureReads = 0;
  const hostileFigure = {};
  for (const key of ['analysisImages', 'imageElements', 'panelGeometries']) {
    Object.defineProperty(hostileFigure, key, {
      get() {
        figureReads += 1;
        throw new Error(`Figure ${key} must not be read`);
      }
    });
  }
  const expectedTaskId = 'figure_panel_interpretation';
  const invalidAdmissions = [
    [undefined, 'FIGURE_EVIDENCE_CONTRACT_MISMATCH'],
    [{ ...figureVisionAdmission(expectedTaskId), evidenceContractToken: undefined }, 'FIGURE_EVIDENCE_CONTRACT_MISMATCH'],
    [{ ...figureVisionAdmission(expectedTaskId), evidenceContractToken: 'stale-contract' }, 'FIGURE_EVIDENCE_CONTRACT_MISMATCH'],
    [figureVisionAdmission('figure_panel_followup'), 'FIGURE_TASK_ADMISSION_INVALID'],
    [{
      ...figureVisionAdmission(expectedTaskId),
      route: { taskType: 'figure_walkthrough', capabilityMode: 'vision' }
    }, 'FIGURE_TASK_ADMISSION_INVALID'],
    [{
      ...figureVisionAdmission(expectedTaskId),
      route: { taskType: expectedTaskId, capabilityMode: 'text' }
    }, 'CAPABILITY_MISMATCH'],
    [{
      ...figureVisionAdmission(expectedTaskId), taskPolicySignature: ''
    }, 'FIGURE_TASK_ADMISSION_INVALID']
  ];
  for (const [admission, expectedCode] of invalidAdmissions) {
    await assert.rejects(
      () => prepareImages(hostileFigure, admission, expectedTaskId),
      error => error?.code === expectedCode
    );
    await assert.rejects(
      () => preparePanelVariants(hostileFigure, 'A', admission, expectedTaskId),
      error => error?.code === expectedCode
    );
  }
  assert.equal(figureReads, 0,
    'invalid admissions must fail before persisted pixels or DOM image sources are inspected');

  let liveInventoryReads = 0;
  const verifyRetryInput = executableContentFunction('verifyLiveFigureRetryInput', {
    requireFigureTaskAdmission: requireAdmission,
    getFigureWorkspaceInventory: () => { liveInventoryReads += 1; },
    combinedFigureWorkspaceInventory: () => [],
    prepareFigureImages: async () => [],
    buildFigureInputHash: () => '',
    buildFigureLiveRetryRevision: () => ''
  });
  await assert.rejects(
    () => verifyRetryInput({ figure: { figureId: 'figure-1' } }, '', undefined,
      expectedTaskId),
    error => error?.code === 'FIGURE_EVIDENCE_CONTRACT_MISMATCH'
  );
  assert.equal(liveInventoryReads, 0,
    'retry verification must validate its admission before refreshing Figure inventory');

  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.deepEqual(await prepareImages({
    analysisImages: [{ mediaType: 'image/png', dataUrl: png }],
    imageElements: []
  }, figureVisionAdmission('figure_walkthrough'), 'figure_walkthrough'), [{
    mediaType: 'image/png', dataUrl: png
  }]);
});

test('Figure provider image validation accepts only strict matching JPEG PNG and WebP payloads', () => {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageBytesMatchMediaType = executableContentFunction(
    'figureImageBytesMatchMediaType'
  );
  const validateFigureProviderImage = executableContentFunction(
    'validateFigureProviderImage', {
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      figureImageError,
      figureImageBytesMatchMediaType,
      atob: value => Buffer.from(value, 'base64').toString('binary')
    }
  );
  const valid = [
    ['image/jpeg', 'data:image/jpeg;base64,/9j/'],
    ['image/png', 'data:image/png;base64,iVBORw0KGgo='],
    ['image/webp', 'data:image/webp;base64,UklGRgAAAABXRUJQ']
  ];
  for (const [mediaType, dataUrl] of valid) {
    assert.deepEqual(validateFigureProviderImage({ mediaType, dataUrl }), {
      mediaType, dataUrl
    });
  }

  const malicious = '<svg onload=alert(1)>';
  for (const image of [
    { mediaType: 'image/gif', dataUrl: 'data:image/gif;base64,R0lGODlh' },
    { mediaType: 'image/jpeg', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
    { mediaType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0K Ggo=' },
    { mediaType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo' },
    { mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJDREVGR0g=' },
    { mediaType: 'image/png', dataUrl: `data:image/png;base64,${malicious}` },
    { mediaType: '', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }
  ]) {
    assert.throws(
      () => validateFigureProviderImage(image),
      error => error?.code === 'FIGURE_IMAGE_INVALID' &&
        error.message === 'FIGURE_IMAGE_INVALID' &&
      !error.message.includes(malicious)
    );
  }
  let accessorReads = 0;
  const accessorBacked = {};
  Object.defineProperty(accessorBacked, 'mediaType', {
    get() { accessorReads += 1; throw new Error(malicious); }
  });
  assert.throws(
    () => validateFigureProviderImage(accessorBacked),
    error => error?.code === 'FIGURE_IMAGE_INVALID' &&
      error.message === 'FIGURE_IMAGE_INVALID' && !error.message.includes(malicious)
  );
  assert.equal(accessorReads, 0,
    'persisted image accessors must be rejected without executing page code');
});

test('Figure provider image validation enforces the exact decoded 1.5 MiB boundary before decoding', () => {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageBytesMatchMediaType = executableContentFunction(
    'figureImageBytesMatchMediaType'
  );
  let prefixDecodes = 0;
  const validateFigureProviderImage = executableContentFunction(
    'validateFigureProviderImage', {
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      figureImageError,
      figureImageBytesMatchMediaType,
      atob(value) {
        prefixDecodes += 1;
        return Buffer.from(value, 'base64').toString('binary');
      }
    }
  );
  const validatorSource = contentFunctionSource('validateFigureProviderImage');
  assert.ok(validatorSource.indexOf('dataUrl.length >') >= 0 &&
    validatorSource.indexOf('dataUrl.length >') < validatorSource.indexOf('.exec(dataUrl)'),
  'encoded length must be rejected before the regex can capture a giant payload');
  const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex');
  const exactBytes = Buffer.alloc(1572864);
  pngHeader.copy(exactBytes);
  const exact = `data:image/png;base64,${exactBytes.toString('base64')}`;
  assert.equal(validateFigureProviderImage({
    mediaType: 'image/png', dataUrl: exact
  }).dataUrl, exact);
  assert.equal(prefixDecodes, 1,
    'a bounded prefix decode is enough to verify the image signature');

  const oversizedBytes = Buffer.alloc(1572865);
  pngHeader.copy(oversizedBytes);
  const oversized = `data:image/png;base64,${oversizedBytes.toString('base64')}`;
  assert.throws(
    () => validateFigureProviderImage({ mediaType: 'image/png', dataUrl: oversized }),
    error => error?.code === 'FIGURE_IMAGE_TOO_LARGE' &&
      error.message === 'FIGURE_IMAGE_TOO_LARGE'
  );
  assert.equal(prefixDecodes, 1,
    'oversized payloads must fail from encoded length before any base64 decode');
});

test('Figure persisted-image admission parses dimensions before its bounded browser decode', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageTimeoutError = executableContentFunction('figureImageTimeoutError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const figureImageBytesMatchMediaType = executableContentFunction(
    'figureImageBytesMatchMediaType'
  );
  const validateFigureProviderImage = executableContentFunction(
    'validateFigureProviderImage', {
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      figureImageError,
      figureImageBytesMatchMediaType,
      atob: value => Buffer.from(value, 'base64').toString('binary')
    }
  );
  const readFigureImageDimensions = executableContentFunction(
    'readFigureImageDimensions', {
      FIGURE_IMAGE_SOURCE_MAX_EDGE: 8192,
      FIGURE_IMAGE_SOURCE_MAX_PIXELS: 40000000,
      figureImageError,
      admitFigureImageDimensions
    }
  );
  const validateFigureProviderImageDimensions = executableContentFunction(
    'validateFigureProviderImageDimensions', {
      validateFigureProviderImage,
      readFigureImageDimensions,
      figureImageError,
      atob: value => Buffer.from(value, 'base64').toString('binary')
    }
  );
  const releaseFigureImage = executableContentFunction('releaseFigureImage', {
    releasedFigureImages: new WeakSet()
  });
  const headerOnly = [
    { mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/' },
    { mediaType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
    { mediaType: 'image/webp', dataUrl: 'data:image/webp;base64,UklGRgAAAABXRUJQ' }
  ];
  const loadCalls = [];
  const decodeFigureProviderImage = executableContentFunction(
    'decodeFigureProviderImage', {
      FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
      validateFigureProviderImage,
      validateFigureProviderImageDimensions,
      admitFigureImageDimensions,
      figureImageError,
      figureImageTimeoutError,
      releaseFigureImage,
      loadFigureImage: async (source, timeoutMs) => {
        loadCalls.push({ source, timeoutMs });
        throw new Error('browser rejected truncated image bytes');
      },
      setTimeout,
      clearTimeout,
      Date
    }
  );
  for (const image of headerOnly) {
    await assert.rejects(
      () => decodeFigureProviderImage(image, Date.now() + 100),
      error => error?.code === 'FIGURE_IMAGE_INVALID' &&
        error.message === 'FIGURE_IMAGE_INVALID'
    );
  }
  assert.deepEqual(loadCalls, [],
    'truncated headers must fail before creating a browser Image');

  const completePng = {
    mediaType: 'image/png',
    dataUrl: 'data:image/png;base64,' +
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  };
  let settleDecode;
  const decodeThatStalls = executableContentFunction(
    'decodeFigureProviderImage', {
      FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
      validateFigureProviderImage,
      validateFigureProviderImageDimensions,
      admitFigureImageDimensions,
      figureImageError,
      figureImageTimeoutError,
      releaseFigureImage,
      loadFigureImage: async () => ({
        naturalWidth: 1,
        naturalHeight: 1,
        decode() { return new Promise(resolve => { settleDecode = resolve; }); }
      }),
      setTimeout,
      clearTimeout,
      Date
    }
  );
  const stalled = decodeThatStalls(completePng, Date.now() + 20);
  const stalledOutcome = await Promise.race([
    stalled.then(() => 'resolved', error => error),
    new Promise(resolve => setTimeout(() => resolve('hung'), 100))
  ]);
  settleDecode?.();
  assert.notEqual(stalledOutcome, 'hung');
  assert.equal(stalledOutcome?.code, 'FIGURE_IMAGE_TIMEOUT');
});

test('persisted Figure decode re-admits browser dimensions and rejects header mismatch with cleanup', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageTimeoutError = executableContentFunction('figureImageTimeoutError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const releaseFigureImage = executableContentFunction('releaseFigureImage', {
    releasedFigureImages: new WeakSet()
  });
  const payload = {
    mediaType: 'image/png', dataUrl: 'data:image/png;base64,header-small'
  };
  const makeDecoded = (width, height) => {
    let source = payload.dataUrl;
    let clears = 0;
    let decodeCalls = 0;
    const image = {
      naturalWidth: width,
      naturalHeight: height,
      onload: () => undefined,
      onerror: () => undefined,
      decode() {
        decodeCalls += 1;
        return Promise.resolve();
      }
    };
    Object.defineProperty(image, 'src', {
      configurable: true,
      get() { return source; },
      set(value) {
        source = value;
        if (value === '') clears += 1;
      }
    });
    return {
      image,
      state: () => ({ source, clears, decodeCalls })
    };
  };
  for (const [width, height, expectedCode] of [
    [8193, 1, 'FIGURE_IMAGE_TOO_LARGE'],
    [2, 1, 'FIGURE_IMAGE_INVALID']
  ]) {
    const decoded = makeDecoded(width, height);
    const decodeFigureProviderImage = executableContentFunction(
      'decodeFigureProviderImage', {
        FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
        validateFigureProviderImageDimensions: () => ({
          image: payload, dimensions: { width: 1, height: 1 }
        }),
        admitFigureImageDimensions,
        figureImageError,
        figureImageTimeoutError,
        releaseFigureImage,
        loadFigureImage: async () => decoded.image,
        setTimeout,
        clearTimeout,
        Date
      }
    );
    await assert.rejects(
      () => decodeFigureProviderImage(payload, Date.now() + 1000),
      error => error?.code === expectedCode
    );
    assert.deepEqual(decoded.state(), {
      source: '', clears: 1, decodeCalls: 0
    }, 'invalid browser dimensions must be rejected before Image.decode and released once');
    assert.equal(decoded.image.onload, null);
    assert.equal(decoded.image.onerror, null);
  }

  let postDecodeWidth = 1;
  let postDecodeSource = payload.dataUrl;
  let postDecodeCalls = 0;
  let postDecodeClears = 0;
  const changesDuringDecode = {
    get naturalWidth() { return postDecodeWidth; },
    naturalHeight: 1,
    onload: () => undefined,
    onerror: () => undefined,
    decode() {
      postDecodeCalls += 1;
      postDecodeWidth = 8193;
      return Promise.resolve();
    }
  };
  Object.defineProperty(changesDuringDecode, 'src', {
    configurable: true,
    get() { return postDecodeSource; },
    set(value) {
      postDecodeSource = value;
      if (value === '') postDecodeClears += 1;
    }
  });
  const decodeChangingImage = executableContentFunction(
    'decodeFigureProviderImage', {
      FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
      validateFigureProviderImageDimensions: () => ({
        image: payload, dimensions: { width: 1, height: 1 }
      }),
      admitFigureImageDimensions,
      figureImageError,
      figureImageTimeoutError,
      releaseFigureImage,
      loadFigureImage: async () => changesDuringDecode,
      setTimeout,
      clearTimeout,
      Date
    }
  );
  await assert.rejects(
    () => decodeChangingImage(payload, Date.now() + 1000),
    error => error?.code === 'FIGURE_IMAGE_TOO_LARGE'
  );
  assert.equal(postDecodeCalls, 1);
  assert.equal(postDecodeSource, '');
  assert.equal(postDecodeClears, 1,
    'dimensions changed by Image.decode must be re-admitted and cleaned once');
});

test('JPEG dimension parsing records only valid EXIF orientation metadata', () => {
  const figureImageError = executableContentFunction('figureImageError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const readFigureImageDimensions = executableContentFunction(
    'readFigureImageDimensions', {
      FIGURE_IMAGE_SOURCE_MAX_EDGE: 8192,
      FIGURE_IMAGE_SOURCE_MAX_PIXELS: 40000000,
      figureImageError,
      admitFigureImageDimensions
    }
  );
  for (const [orientation, littleEndian] of [
    [5, true], [6, false], [7, true], [8, false]
  ]) {
    assert.deepEqual(readFigureImageDimensions(
      syntheticExifJpeg(40, 20, orientation, littleEndian), 'image/jpeg'
    ), { width: 40, height: 20, orientation });
  }
  const malformed = syntheticExifJpeg(40, 20, 6);
  new DataView(malformed.buffer, malformed.byteOffset, malformed.byteLength)
    .setUint32(16, 0xffffffff, true);
  assert.deepEqual(readFigureImageDimensions(malformed, 'image/jpeg'), {
    width: 40, height: 20, orientation: 1
  }, 'malformed EXIF must never grant swapped-dimension admission');
});

test('Figure decoded-dimension matching independently bounds both sides and limits swaps to EXIF JPEG', () => {
  const figureImageError = executableContentFunction('figureImageError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const matchFigureImageDimensions = executableContentFunction(
    'matchFigureImageDimensions', { admitFigureImageDimensions, figureImageError }
  );
  for (const orientation of [5, 6, 7, 8]) {
    assert.deepEqual(matchFigureImageDimensions(
      { width: 40, height: 20, orientation },
      { width: 20, height: 40 }, 'image/jpeg'
    ), { width: 20, height: 40 });
  }
  assert.deepEqual(matchFigureImageDimensions(
    { width: 40, height: 20, orientation: 1 },
    { width: 40, height: 20 }, 'image/jpeg'
  ), { width: 40, height: 20 });
  for (const [mediaType, orientation] of [
    ['image/jpeg', 4], ['image/jpeg', undefined],
    ['image/png', 6], ['image/webp', 8]
  ]) {
    assert.throws(() => matchFigureImageDimensions(
      { width: 40, height: 20, orientation },
      { width: 20, height: 40 }, mediaType
    ), error => error?.code === 'FIGURE_IMAGE_INVALID');
  }
  for (const [header, actual] of [
    [{ width: 8193, height: 1, orientation: 6 }, { width: 1, height: 8193 }],
    [{ width: 1, height: 1, orientation: 6 }, { width: 8193, height: 1 }]
  ]) {
    assert.throws(
      () => matchFigureImageDimensions(header, actual, 'image/jpeg'),
      error => error?.code === 'FIGURE_IMAGE_TOO_LARGE'
    );
  }
});

test('persisted and remote EXIF JPEG paths accept Chrome-swapped natural dimensions', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageTimeoutError = executableContentFunction('figureImageTimeoutError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const matchFigureImageDimensions = executableContentFunction(
    'matchFigureImageDimensions', { admitFigureImageDimensions, figureImageError }
  );
  const payload = {
    mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/'
  };
  const decodedPersisted = {
    naturalWidth: 20, naturalHeight: 40, decode: async () => undefined
  };
  const decodeFigureProviderImage = executableContentFunction(
    'decodeFigureProviderImage', {
      FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
      validateFigureProviderImageDimensions: () => ({
        image: payload,
        dimensions: { width: 40, height: 20, orientation: 6 }
      }),
      admitFigureImageDimensions,
      matchFigureImageDimensions,
      figureImageError,
      figureImageTimeoutError,
      releaseFigureImage: () => undefined,
      loadFigureImage: async () => decodedPersisted,
      setTimeout,
      clearTimeout,
      Date
    }
  );
  assert.equal((await decodeFigureProviderImage(
    payload, Date.now() + 1000
  )).sourceImage, decodedPersisted);

  const decodedRemote = { naturalWidth: 20, naturalHeight: 40 };
  const TestURL = class extends URL {};
  TestURL.createObjectURL = () => 'blob:exif-figure';
  TestURL.revokeObjectURL = () => undefined;
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError,
    readBoundedFigureImageBody: async () => new Uint8Array([0xff, 0xd8, 0xff]),
    figureImageBytesMatchMediaType: () => true,
    readFigureImageDimensions: () => ({
      width: 40, height: 20, orientation: 6
    }),
    admitFigureImageDimensions,
    matchFigureImageDimensions,
    releaseFigureImage: () => undefined,
    AbortController,
    Blob,
    URL: TestURL,
    document: {
      baseURI: 'https://paper.test/article',
      location: { href: 'https://paper.test/article' }
    },
    loadFigureImage: async () => decodedRemote,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    fetch: async () => ({
      ok: true,
      headers: { get: name => name === 'content-type' ? 'image/jpeg' : null },
      body: {}
    })
  });
  assert.equal(await fetchFigureImage(
    'https://cdn.test/oriented.jpg', 1000
  ), decodedRemote);
});

test('all Figure preparation entries decode-admit persisted JPEG PNG and WebP before return', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const imageUpgradePolicy = executableFigureImageUpgradePolicy();
  const figureImageBytesMatchMediaType = executableContentFunction(
    'figureImageBytesMatchMediaType'
  );
  const validateFigureProviderImage = executableContentFunction(
    'validateFigureProviderImage', {
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      figureImageError,
      figureImageBytesMatchMediaType,
      atob: value => Buffer.from(value, 'base64').toString('binary')
    }
  );
  const collectValidFigureProviderImages = executableContentFunction(
    'collectValidFigureProviderImages', {
      FIGURE_IMAGE_LIMIT: 4,
      validateFigureProviderImage
    }
  );
  const rejectedByDecode = [];
  const admitFigureProviderImages = executableContentFunction(
    'admitFigureProviderImages', {
      FIGURE_IMAGE_LIMIT: 4,
      FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
      collectValidFigureProviderImages,
      decodeFigureProviderImage: async image => {
        rejectedByDecode.push(image.mediaType);
        throw figureImageError('FIGURE_IMAGE_INVALID');
      },
      Date
    }
  );
  const headerOnly = [
    { mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/' },
    { mediaType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
    { mediaType: 'image/webp', dataUrl: 'data:image/webp;base64,UklGRgAAAABXRUJQ' }
  ];
  const requireAdmission = executableContentFunction('requireFigureTaskAdmission');
  const figureImageDiagnosticCode = executableContentFunction(
    'figureImageDiagnosticCode'
  );
  const quietConsole = { warn() {} };
  const prepareImages = executableContentFunction('prepareFigureImages', {
    requireFigureTaskAdmission: requireAdmission,
    ...imageUpgradePolicy,
    admitFigureProviderImages,
    collectValidFigureProviderImages,
    validateFigureProviderImage,
    figureImageDiagnosticCode,
    FIGURE_IMAGE_LIMIT: 4,
    FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
    prepareFigureImage: async () => { throw new Error('no live source'); },
    console: quietConsole
  });
  const preparePersisted = executableContentFunction(
    'preparePersistedFigureImages', {
      ...imageUpgradePolicy,
      admitFigureProviderImages,
      collectValidFigureProviderImages,
      validateFigureProviderImage,
      figureImageDiagnosticCode,
      FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
      prepareFigureImage: async () => { throw new Error('no live source'); },
      console: quietConsole
    }
  );
  const preparePanelVariants = executableContentFunction(
    'prepareFigurePanelImageVariants', {
      requireFigureTaskAdmission: requireAdmission,
      admitFigureProviderImages,
      collectValidFigureProviderImages,
      validateFigureProviderImage,
      figureImageDiagnosticCode,
      figureImagePixelArea: executableContentFunction('figureImagePixelArea'),
      findDedicatedPanelImageElement: executableContentFunction(
        'findDedicatedPanelImageElement'
      ),
      loadPreparedFigureSource: async () => null,
      loadFigureImage: async dataUrl => ({
        dataUrl, naturalWidth: 1, naturalHeight: 1
      }),
      normalizePanelCropGeometry: () => null,
      encodeFigureImageVariant: () => {
        throw new Error('decode-rejected persisted bytes must not be re-encoded');
      },
      console: quietConsole
    }
  );
  for (const image of headerOnly) {
    const figure = { analysisImages: [image], imageElements: [] };
    assert.deepEqual(await prepareImages(
      figure,
      figureVisionAdmission('figure_walkthrough'),
      'figure_walkthrough'
    ), []);
    assert.deepEqual(await preparePersisted(figure), []);
    assert.deepEqual(await preparePanelVariants(
      figure,
      'A',
      figureVisionAdmission('figure_panel_interpretation'),
      'figure_panel_interpretation'
    ), []);
  }
  assert.equal(rejectedByDecode.length, 9,
    'each persisted image must cross async decode admission in every entry point');
  const panelSource = contentFunctionSource('prepareFigurePanelImageVariants');
  assert.match(panelSource, /admitFigureProviderImages/u);
  assert.doesNotMatch(panelSource, /2097175|1572864|ABCDEFGHIJKLMNOPQRSTUVWXYZ/u,
    'Panel preparation must not carry a second drifting copy of the validator');
});

test('Figure source reader admits the exact 20 MiB boundary and releases its reader', async () => {
  assert.match(read('content.js'),
    /const FIGURE_IMAGE_SOURCE_MAX_BYTES = 20971520;/u);
  const figureImageError = executableContentFunction('figureImageError');
  const readBoundedFigureImageBody = executableContentFunction(
    'readBoundedFigureImageBody', {
      FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
      figureImageError,
      Uint8Array
    }
  );
  let released = 0;
  let cancelled = 0;
  const chunks = [new Uint8Array(20971519), new Uint8Array([4])];
  const reader = {
    async read() {
      return chunks.length ? { done: false, value: chunks.shift() } : { done: true };
    },
    async cancel() { cancelled += 1; },
    releaseLock() { released += 1; }
  };
  const bytes = await readBoundedFigureImageBody({
    body: { getReader: () => reader }
  }, 20971520);
  assert.equal(bytes.byteLength, 20971520);
  assert.equal(bytes[20971519], 4);
  assert.equal(cancelled, 0);
  assert.equal(released, 1);
});

test('Figure source reader cancels and releases on the first byte above its inbound limit', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const readBoundedFigureImageBody = executableContentFunction(
    'readBoundedFigureImageBody', {
      FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
      figureImageError,
      Uint8Array
    }
  );
  let released = 0;
  let cancelled = 0;
  const chunks = [new Uint8Array(20971520), new Uint8Array(1)];
  const reader = {
    async read() {
      return chunks.length ? { done: false, value: chunks.shift() } : { done: true };
    },
    async cancel() { cancelled += 1; },
    releaseLock() { released += 1; }
  };
  await assert.rejects(
    () => readBoundedFigureImageBody({
      body: { getReader: () => reader }
    }, 20971520),
    error => error?.code === 'FIGURE_IMAGE_TOO_LARGE' &&
      error.message === 'FIGURE_IMAGE_TOO_LARGE'
  );
  assert.equal(cancelled, 1);
  assert.equal(released, 1);

  let blobReads = 0;
  await assert.rejects(
    () => readBoundedFigureImageBody({
      body: null,
      blob() { blobReads += 1; }
    }, 4),
    error => error?.code === 'FIGURE_IMAGE_INVALID'
  );
  assert.equal(blobReads, 0,
    'a non-streaming response must fail closed instead of allocating an unbounded blob');
});

test('Figure source reader deadlines each read even when it ignores abort and settles late', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageTimeoutError = executableContentFunction('figureImageTimeoutError');
  const readBoundedFigureImageBody = executableContentFunction(
    'readBoundedFigureImageBody', {
      FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
      figureImageError,
      figureImageTimeoutError,
      Uint8Array,
      setTimeout,
      clearTimeout,
      Date
    }
  );
  let settleRead;
  let cancelled = 0;
  let released = 0;
  const controller = new AbortController();
  const pending = readBoundedFigureImageBody({
    body: { getReader: () => ({
      read() {
        return new Promise(resolve => { settleRead = resolve; });
      },
      cancel() { cancelled += 1; return Promise.resolve(); },
      releaseLock() { released += 1; }
    }) }
  }, 20971520, {
    signal: controller.signal,
    deadline: Date.now() + 20
  });
  const outcome = await Promise.race([
    pending.then(() => 'resolved', error => error),
    new Promise(resolve => setTimeout(() => resolve('hung'), 100))
  ]);
  settleRead?.({ done: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.notEqual(outcome, 'hung', 'an ignored abort must not strand the read');
  assert.equal(outcome?.code, 'FIGURE_IMAGE_TIMEOUT');
  assert.equal(outcome?.message, 'Figure image loading timed out');
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('Figure source reader retries a failed releaseLock after a late read settles', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageTimeoutError = executableContentFunction('figureImageTimeoutError');
  const readBoundedFigureImageBody = executableContentFunction(
    'readBoundedFigureImageBody', {
      FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
      figureImageError,
      figureImageTimeoutError,
      Uint8Array,
      setTimeout,
      clearTimeout,
      Date
    }
  );
  let settleRead;
  let readPending = true;
  let releaseAttempts = 0;
  let releases = 0;
  const reader = {
    read() {
      return new Promise(resolve => {
        settleRead = value => {
          readPending = false;
          resolve(value);
        };
      });
    },
    cancel() { return new Promise(() => {}); },
    releaseLock() {
      releaseAttempts += 1;
      if (readPending) throw new TypeError('read still pending');
      releases += 1;
    }
  };
  const pending = readBoundedFigureImageBody({
    body: { getReader: () => reader }
  }, 20971520, { deadline: Date.now() + 20 });
  const outcome = await Promise.race([
    pending.then(() => 'resolved', error => error),
    new Promise(resolve => setTimeout(() => resolve('hung'), 100))
  ]);
  assert.notEqual(outcome, 'hung', 'cleanup must not delay the deadline rejection');
  assert.equal(outcome?.code, 'FIGURE_IMAGE_TIMEOUT');
  assert.deepEqual({ releaseAttempts, releases }, { releaseAttempts: 1, releases: 0 });
  settleRead?.({ done: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual({ releaseAttempts, releases }, { releaseAttempts: 2, releases: 1 },
    'late read settlement must trigger one observed best-effort release retry');
});

test('Figure source reader caches methods and isolates hostile non-blocking cleanup', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageTimeoutError = executableContentFunction('figureImageTimeoutError');
  const readBoundedFigureImageBody = executableContentFunction(
    'readBoundedFigureImageBody', {
      FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
      figureImageError,
      figureImageTimeoutError,
      Uint8Array,
      setTimeout,
      clearTimeout,
      Date
    }
  );
  let readGets = 0;
  let cancelGets = 0;
  let releaseGets = 0;
  let releases = 0;
  const chunks = [new Uint8Array(4), null];
  const reader = {};
  Object.defineProperties(reader, {
    read: { get() {
      readGets += 1;
      return async function read() {
        const value = chunks.shift();
        return value ? { done: false, value } : { done: true };
      };
    } },
    cancel: { get() {
      cancelGets += 1;
      return function cancel() { return Promise.resolve(); };
    } },
    releaseLock: { get() {
      releaseGets += 1;
      return function releaseLock() { releases += 1; };
    } }
  });
  assert.equal((await readBoundedFigureImageBody({
    body: { getReader: () => reader }
  }, 4)).byteLength, 4);
  assert.deepEqual({ readGets, cancelGets, releaseGets, releases }, {
    readGets: 1, cancelGets: 1, releaseGets: 1, releases: 1
  });

  let blockingRelease = 0;
  const blockingCancelReader = {
    async read() { return { done: false, value: new Uint8Array(2) }; },
    cancel() { return new Promise(() => {}); },
    releaseLock() { blockingRelease += 1; }
  };
  const blocked = readBoundedFigureImageBody({
    body: { getReader: () => blockingCancelReader }
  }, 1);
  const blockedOutcome = await Promise.race([
    blocked.then(() => 'resolved', error => error),
    new Promise(resolve => setTimeout(() => resolve('hung'), 50))
  ]);
  assert.notEqual(blockedOutcome, 'hung', 'reader.cancel must never block rejection');
  assert.equal(blockedOutcome?.code, 'FIGURE_IMAGE_TOO_LARGE');
  assert.equal(blockingRelease, 1,
    'releaseLock must run without waiting for a hostile cancel promise');

  let hostileRelease = 0;
  const hostileReader = {};
  Object.defineProperties(hostileReader, {
    read: { get() { throw new Error('hostile read getter'); } },
    cancel: { get() { throw new Error('hostile cancel getter'); } },
    releaseLock: { get() {
      return function releaseLock() { hostileRelease += 1; };
    } }
  });
  await assert.rejects(
    () => readBoundedFigureImageBody({
      body: { getReader: () => hostileReader }
    }, 1),
    error => error?.code === 'FIGURE_IMAGE_INVALID' &&
      error.message === 'FIGURE_IMAGE_INVALID'
  );
  assert.equal(hostileRelease, 1,
    'one hostile cleanup getter must not prevent an independently cached release');

  const malicious = '<reader-error onload=alert(1)>';
  let rejectedRelease = 0;
  await assert.rejects(
    () => readBoundedFigureImageBody({
      body: { getReader: () => ({
        read() { return Promise.reject(new Error(malicious)); },
        cancel() { return Promise.reject(new Error('cancel rejected')); },
        releaseLock() { rejectedRelease += 1; throw new Error('release failed'); }
      }) }
    }, 1),
    error => error?.code === 'FIGURE_IMAGE_INVALID' &&
      error.message === 'FIGURE_IMAGE_INVALID' && !error.message.includes(malicious)
  );
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(rejectedRelease, 1);
});

test('remote Figure images reject unsafe MIME and Content-Length before body access', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async () => {
      throw new Error('response body must not be read');
    },
    figureImageBytesMatchMediaType: () => true,
    readFigureImageDimensions: () => ({ width: 1, height: 1 }),
    releaseFigureImage: () => undefined,
    AbortController,
    Blob,
    URL: {
      createObjectURL() { throw new Error('blob must not be allocated'); },
      revokeObjectURL() {}
    },
    loadFigureImage: async () => {
      throw new Error('image decode must not run');
    },
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    fetch: async source => source
  });
  const response = (contentType, contentLength) => {
    let bodyReads = 0;
    let cancellations = 0;
    const body = {
      cancel() {
        cancellations += 1;
        return Promise.reject(new Error('hostile cancellation must be observed'));
      }
    };
    const value = {
      ok: true,
      headers: { get(name) {
        const normalized = name.toLowerCase();
        if (normalized === 'content-type') return contentType;
        if (normalized === 'content-length') return contentLength;
        return null;
      } },
      get body() {
        bodyReads += 1;
        return body;
      }
    };
    return {
      value,
      bodyReads: () => bodyReads,
      cancellations: () => cancellations
    };
  };
  const unsafeMime = response('text/html', '12');
  await assert.rejects(
    () => fetchFigureImage(unsafeMime.value, 1000),
    error => error?.code === 'FIGURE_IMAGE_INVALID' &&
      error.message === 'FIGURE_IMAGE_INVALID'
  );
  assert.equal(unsafeMime.bodyReads(), 1);
  assert.equal(unsafeMime.cancellations(), 1,
    'a rejected response must be actively terminated before returning');

  const oversized = response('image/png', '20971521');
  await assert.rejects(
    () => fetchFigureImage(oversized.value, 1000),
    error => error?.code === 'FIGURE_IMAGE_TOO_LARGE' &&
      error.message === 'FIGURE_IMAGE_TOO_LARGE'
  );
  assert.equal(oversized.bodyReads(), 1);
  assert.equal(oversized.cancellations(), 1);

  const malformedLength = response('image/png', '12<script>');
  await assert.rejects(
    () => fetchFigureImage(malformedLength.value, 1000),
    error => error?.code === 'FIGURE_IMAGE_INVALID' &&
      !error.message.includes('<script>')
  );
  assert.equal(malformedLength.bodyReads(), 1);
  assert.equal(malformedLength.cancellations(), 1);

  const hostileLength = response('image/png', {
    toString() { throw new Error('<hostile content-length>'); }
  });
  await assert.rejects(
    () => fetchFigureImage(hostileLength.value, 1000),
    error => error?.code === 'FIGURE_IMAGE_INVALID' &&
      error.message === 'FIGURE_IMAGE_INVALID' &&
      !error.message.includes('hostile content-length')
  );
  assert.equal(hostileLength.bodyReads(), 1);
  assert.equal(hostileLength.cancellations(), 1,
    'Content-Length coercion failures are still preflight rejections');

  const enormousLength = response('image/png', '9'.repeat(200));
  await assert.rejects(
    () => fetchFigureImage(enormousLength.value, 1000),
    error => error?.code === 'FIGURE_IMAGE_TOO_LARGE' &&
      error.message === 'FIGURE_IMAGE_TOO_LARGE'
  );
  assert.equal(enormousLength.bodyReads(), 1);
  assert.equal(enormousLength.cancellations(), 1);
});

test('remote Figure images enforce unencoded Content-Length against actual streamed bytes', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const png = new Uint8Array(Buffer.from('89504e470d0a1a0a', 'hex'));
  let blobAllocations = 0;
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async (_response, _limit, options) => {
      assert.ok(options?.signal instanceof AbortSignal);
      assert.ok(Number.isFinite(options?.deadline));
      return png;
    },
    figureImageBytesMatchMediaType: executableContentFunction(
      'figureImageBytesMatchMediaType'
    ),
    readFigureImageDimensions: () => ({ width: 1, height: 1 }),
    admitFigureImageDimensions,
    releaseFigureImage: () => undefined,
    AbortController,
    Blob: class { constructor() { blobAllocations += 1; } },
    URL: { createObjectURL: () => 'blob:length-checked', revokeObjectURL() {} },
    loadFigureImage: async () => ({ naturalWidth: 1, naturalHeight: 1 }),
    setTimeout,
    clearTimeout,
    fetch: async source => source
  });
  const response = (declaredLength, contentEncoding = null) => ({
    ok: true,
    bytes: png,
    headers: { get(name) {
      const normalized = name.toLowerCase();
      if (normalized === 'content-type') return 'image/png';
      if (normalized === 'content-length') return declaredLength;
      if (normalized === 'content-encoding') return contentEncoding;
      return null;
    } },
    body: {}
  });
  for (const declaredLength of ['7', '9']) {
    await assert.rejects(
      () => fetchFigureImage(response(declaredLength), 1000),
      error => error?.code === 'FIGURE_IMAGE_INVALID' &&
        error.message === 'FIGURE_IMAGE_INVALID'
    );
  }
  assert.equal(blobAllocations, 0,
    'both low-reported and truncated unencoded bodies must fail before Blob allocation');
  assert.deepEqual(
    await fetchFigureImage(response('7', 'gzip'), 1000),
    { naturalWidth: 1, naturalHeight: 1 },
    'encoded transfer length cannot be compared to the decoded stream length'
  );
  assert.equal(blobAllocations, 1);
});

test('remote Figure images allocate a Blob only after a bounded body and MIME signature agree', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const png = new Uint8Array(Buffer.from('89504e470d0a1a0a', 'hex'));
  const reads = [];
  const blobs = [];
  const revoked = [];
  const decodedImage = { naturalWidth: 8, naturalHeight: 8 };
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async (response, maxBytes) => {
      reads.push({ response, maxBytes });
      return response.bytes;
    },
    figureImageBytesMatchMediaType: executableContentFunction(
      'figureImageBytesMatchMediaType'
    ),
    readFigureImageDimensions: () => ({ width: 8, height: 8 }),
    admitFigureImageDimensions,
    releaseFigureImage: () => undefined,
    AbortController,
    Blob: class {
      constructor(parts, options) {
        this.parts = parts;
        this.type = options.type;
        blobs.push(this);
      }
    },
    URL: {
      createObjectURL(blob) {
        assert.equal(blob.type, 'image/png');
        return 'blob:bounded-figure';
      },
      revokeObjectURL(value) { revoked.push(value); }
    },
    loadFigureImage: async source => {
      assert.equal(source, 'blob:bounded-figure');
      return decodedImage;
    },
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    fetch: async source => source
  });
  const response = {
    ok: true,
    bytes: png,
    headers: { get(name) {
      return name.toLowerCase() === 'content-type'
        ? 'image/png; charset=binary' : null;
    } },
    body: {}
  };
  assert.equal(await fetchFigureImage(response, 1000), decodedImage);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].maxBytes, 20971520);
  assert.equal(blobs.length, 1);
  assert.deepEqual(blobs[0].parts, [png]);
  assert.deepEqual(revoked, ['blob:bounded-figure']);

  const mismatch = {
    ...response,
    headers: { get(name) {
      return name.toLowerCase() === 'content-type' ? 'image/jpeg' : null;
    } }
  };
  await assert.rejects(
    () => fetchFigureImage(mismatch, 1000),
    error => error?.code === 'FIGURE_IMAGE_INVALID'
  );
  assert.equal(blobs.length, 1,
    'signature mismatch must fail before allocating another Blob');
});

test('remote Figure image timeout remains authoritative when a body reader ignores abort', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const png = new Uint8Array(Buffer.from('89504e470d0a1a0a', 'hex'));
  let fireTimeout;
  let blobAllocations = 0;
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async () => {
      fireTimeout();
      return png;
    },
    figureImageBytesMatchMediaType: executableContentFunction(
      'figureImageBytesMatchMediaType'
    ),
    readFigureImageDimensions: () => ({ width: 1, height: 1 }),
    releaseFigureImage: () => undefined,
    AbortController,
    Blob: class { constructor() { blobAllocations += 1; } },
    URL: { createObjectURL: () => 'blob:late', revokeObjectURL() {} },
    loadFigureImage: async () => ({ naturalWidth: 8, naturalHeight: 8 }),
    setTimeout(callback) {
      if (!fireTimeout) fireTimeout = callback;
      return 1;
    },
    clearTimeout: () => undefined,
    fetch: async () => ({
      ok: true,
      headers: { get: name => name === 'content-type' ? 'image/png' : null },
      body: {}
    })
  });
  await assert.rejects(
    () => fetchFigureImage('https://example.test/late.png', 1000),
    error => error?.code === 'FIGURE_IMAGE_TIMEOUT'
  );
  assert.equal(blobAllocations, 0,
    'a late body result must not allocate after the timeout won');
});

test('remote Figure deadline normalizes a late non-AbortError request failure to timeout', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const malicious = '<late-network-error onload=alert(1)>';
  let fireTimeout;
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async () => {
      throw new Error('body must not be reached');
    },
    figureImageBytesMatchMediaType: () => true,
    readFigureImageDimensions: () => ({ width: 1, height: 1 }),
    releaseFigureImage: () => undefined,
    AbortController,
    Blob,
    URL: { createObjectURL: () => 'blob:never', revokeObjectURL() {} },
    loadFigureImage: async () => null,
    setTimeout(callback) { fireTimeout = callback; return 1; },
    clearTimeout: () => undefined,
    fetch: async () => {
      fireTimeout();
      throw new Error(malicious);
    }
  });
  await assert.rejects(
    () => fetchFigureImage('https://example.test/late-request.png', 1),
    error => error?.code === 'FIGURE_IMAGE_TIMEOUT' &&
      !error.message.includes(malicious)
  );
});

test('remote Figure image races every body read with its deadline and ignores late success', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageTimeoutError = executableContentFunction('figureImageTimeoutError');
  const readBoundedFigureImageBody = executableContentFunction(
    'readBoundedFigureImageBody', {
      FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
      figureImageError,
      figureImageTimeoutError,
      Uint8Array,
      setTimeout,
      clearTimeout,
      Date
    }
  );
  const png = new Uint8Array(Buffer.from('89504e470d0a1a0a', 'hex'));
  let settleRead;
  let cancellations = 0;
  let releases = 0;
  let blobAllocations = 0;
  let decodeCalls = 0;
  const response = {
    ok: true,
    headers: { get(name) {
      return name.toLowerCase() === 'content-type' ? 'image/png' : null;
    } },
    body: { getReader: () => ({
      read() { return new Promise(resolve => { settleRead = resolve; }); },
      cancel() { cancellations += 1; return Promise.resolve(); },
      releaseLock() { releases += 1; }
    }) }
  };
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError,
    readBoundedFigureImageBody,
    figureImageBytesMatchMediaType: executableContentFunction(
      'figureImageBytesMatchMediaType'
    ),
    readFigureImageDimensions: () => ({ width: 1, height: 1 }),
    releaseFigureImage: () => undefined,
    AbortController,
    Blob: class { constructor() { blobAllocations += 1; } },
    URL: { createObjectURL: () => 'blob:late-reader', revokeObjectURL() {} },
    loadFigureImage: async () => {
      decodeCalls += 1;
      return { naturalWidth: 1, naturalHeight: 1 };
    },
    setTimeout,
    clearTimeout,
    fetch: async () => response
  });
  const pending = fetchFigureImage('https://example.test/hung-reader.png', 20);
  const outcome = await Promise.race([
    pending.then(() => 'resolved', error => error),
    new Promise(resolve => setTimeout(() => resolve('hung'), 500))
  ]);
  settleRead?.({ done: false, value: png });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.notEqual(outcome, 'hung', 'the fetch deadline must win over a stuck reader');
  assert.equal(outcome?.code, 'FIGURE_IMAGE_TIMEOUT');
  assert.equal(blobAllocations, 0);
  assert.equal(decodeCalls, 0);
  assert.equal(cancellations, 1);
  assert.equal(releases, 1);
});

test('remote Figure body success after the absolute deadline cannot allocate a Blob', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const png = new Uint8Array(Buffer.from('89504e470d0a1a0a', 'hex'));
  let now = 1000;
  let blobAllocations = 0;
  let decodeCalls = 0;
  const clock = { now: () => now };
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async (_response, _limit, options) => {
      now = options.deadline + 1;
      return png;
    },
    figureImageBytesMatchMediaType: executableContentFunction(
      'figureImageBytesMatchMediaType'
    ),
    readFigureImageDimensions: () => ({ width: 1, height: 1 }),
    releaseFigureImage: () => undefined,
    AbortController,
    Blob: class { constructor() { blobAllocations += 1; } },
    URL: { createObjectURL: () => 'blob:too-late', revokeObjectURL() {} },
    loadFigureImage: async () => {
      decodeCalls += 1;
      return { naturalWidth: 1, naturalHeight: 1 };
    },
    Date: clock,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    fetch: async () => ({
      ok: true,
      headers: { get: name => name === 'content-type' ? 'image/png' : null },
      body: {}
    })
  });
  await assert.rejects(
    () => fetchFigureImage('https://example.test/late-body.png', 1),
    error => error?.code === 'FIGURE_IMAGE_TIMEOUT'
  );
  assert.equal(blobAllocations, 0);
  assert.equal(decodeCalls, 0);
});

test('remote Figure post-body work keeps one exact deadline and never starts decode after Blob crosses it', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1, 16);
  png.writeUInt32BE(1, 20);
  let now = 1000;
  let bodyDeadline = null;
  let blobAllocations = 0;
  let objectUrls = 0;
  let decodeCalls = 0;
  const timerDelays = [];
  const clock = { now: () => now };
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async (_response, _limit, options) => {
      bodyDeadline = options.deadline;
      now = bodyDeadline - 1;
      return new Uint8Array(png);
    },
    figureImageBytesMatchMediaType: executableContentFunction(
      'figureImageBytesMatchMediaType'
    ),
    readFigureImageDimensions: () => ({ width: 1, height: 1 }),
    releaseFigureImage: () => undefined,
    AbortController,
    Blob: class {
      constructor() {
        blobAllocations += 1;
        now = bodyDeadline;
      }
    },
    URL: {
      createObjectURL() { objectUrls += 1; return 'blob:past-deadline'; },
      revokeObjectURL() { return new Promise(() => {}); }
    },
    loadFigureImage: async () => {
      decodeCalls += 1;
      return { naturalWidth: 1, naturalHeight: 1 };
    },
    Date: clock,
    setTimeout(_callback, delay) { timerDelays.push(delay); return 1; },
    clearTimeout: () => undefined,
    fetch: async () => ({
      ok: true,
      headers: { get: name => name === 'content-type' ? 'image/png' : null },
      body: {}
    })
  });
  await assert.rejects(
    () => fetchFigureImage('https://paper.test/figure.png', 10),
    error => error?.code === 'FIGURE_IMAGE_TIMEOUT'
  );
  assert.equal(bodyDeadline, 1010,
    'the body and post-body stages must share the caller\'s exact absolute deadline');
  assert.equal(timerDelays[0], 10, 'the transport timer must not add a 250 ms floor');
  assert.equal(blobAllocations, 1, 'the synchronous Blob constructor is the crossing point');
  assert.equal(objectUrls, 0, 'an object URL must not be created after Blob crossed the deadline');
  assert.equal(decodeCalls, 0, 'browser decode must not start after the deadline');

  let revocations = 0;
  const fetchWithHungDecode = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async () => new Uint8Array(png),
    figureImageBytesMatchMediaType: executableContentFunction(
      'figureImageBytesMatchMediaType'
    ),
    readFigureImageDimensions: () => ({ width: 1, height: 1 }),
    releaseFigureImage: () => undefined,
    AbortController,
    Blob,
    URL: {
      createObjectURL: () => 'blob:hung-decode',
      revokeObjectURL() {
        revocations += 1;
        return new Promise(() => {});
      }
    },
    loadFigureImage: () => new Promise(() => {}),
    setTimeout,
    clearTimeout,
    fetch: async () => ({
      ok: true,
      headers: { get: name => name === 'content-type' ? 'image/png' : null },
      body: {}
    })
  });
  const hungOutcome = await Promise.race([
    fetchWithHungDecode('https://paper.test/hung.png', 20)
      .then(() => 'resolved', error => error),
    new Promise(resolve => setTimeout(() => resolve('hung'), 500))
  ]);
  assert.notEqual(hungOutcome, 'hung', 'cleanup must not await a stuck decoder or URL revocation');
  assert.equal(hungOutcome?.code, 'FIGURE_IMAGE_TIMEOUT');
  assert.equal(revocations, 1);

  let boundaryNow = 2000;
  let boundaryCancellations = 0;
  const boundaryDeadline = 2010;
  const boundaryResponse = {
    ok: true,
    headers: { get: () => null },
    body: {
      cancel() {
        boundaryCancellations += 1;
        return new Promise(() => {});
      }
    }
  };
  const fetchAtBoundary = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async () => {
      throw new Error('a deadline-crossing response must not read its body');
    },
    figureImageBytesMatchMediaType: () => true,
    readFigureImageDimensions: () => ({ width: 1, height: 1 }),
    releaseFigureImage: () => undefined,
    AbortController,
    Blob,
    URL,
    loadFigureImage: async () => null,
    Date: { now: () => boundaryNow },
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    fetch: async () => {
      boundaryNow = boundaryDeadline;
      return boundaryResponse;
    }
  });
  await assert.rejects(
    () => fetchAtBoundary(
      'https://paper.test/deadline-boundary.png', 10, boundaryDeadline
    ),
    error => error?.code === 'FIGURE_IMAGE_TIMEOUT'
  );
  assert.equal(boundaryCancellations, 1,
    'a Response returned exactly at the post-race deadline must be cancelled');
});

test('persisted Figure decode timeout releases the Image idempotently and observes a late rejection', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageTimeoutError = executableContentFunction('figureImageTimeoutError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const figureImageBytesMatchMediaType = executableContentFunction(
    'figureImageBytesMatchMediaType'
  );
  const validateFigureProviderImage = executableContentFunction(
    'validateFigureProviderImage', {
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      figureImageError,
      figureImageBytesMatchMediaType,
      atob: value => Buffer.from(value, 'base64').toString('binary')
    }
  );
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(2, 16);
  png.writeUInt32BE(2, 20);
  const imagePayload = {
    mediaType: 'image/png',
    dataUrl: `data:image/png;base64,${png.toString('base64')}`
  };
  let rejectDecode;
  let sourceValue = imagePayload.dataUrl;
  let sourceClears = 0;
  const decoded = {
    naturalWidth: 2,
    naturalHeight: 2,
    onload: () => undefined,
    onerror: () => undefined,
    decode() {
      return new Promise((_resolve, reject) => { rejectDecode = reject; });
    }
  };
  Object.defineProperty(decoded, 'src', {
    configurable: true,
    get() { return sourceValue; },
    set(value) {
      sourceValue = value;
      if (value === '') sourceClears += 1;
    }
  });
  const releaseFigureImage = executableContentFunction('releaseFigureImage', {
    releasedFigureImages: new WeakSet()
  });
  const validateFigureProviderImageDimensions = image => ({
    image: validateFigureProviderImage(image), dimensions: { width: 2, height: 2 }
  });
  const decodeFigureProviderImage = executableContentFunction(
    'decodeFigureProviderImage', {
      FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
      validateFigureProviderImage,
      validateFigureProviderImageDimensions,
      admitFigureImageDimensions,
      figureImageError,
      figureImageTimeoutError,
      releaseFigureImage,
      loadFigureImage: async () => decoded,
      setTimeout,
      clearTimeout,
      // Keep the admission clock stable until decode starts; scheduler delays
      // under the full suite must not turn this into the pre-decode expiry test.
      Date: { now: () => 1000 }
    }
  );
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const outcome = await Promise.race([
      decodeFigureProviderImage(imagePayload, 1010)
        .then(() => 'resolved', error => error),
      new Promise(resolve => setTimeout(() => resolve('hung'), 500))
    ]);
    assert.notEqual(outcome, 'hung', 'a never-settling Image.decode must not hold admission');
    assert.equal(outcome?.code, 'FIGURE_IMAGE_TIMEOUT');
    assert.equal(sourceValue, '');
    assert.equal(sourceClears, 1, 'timeout cleanup must be idempotent');
    assert.equal(decoded.onload, null);
    assert.equal(decoded.onerror, null);
    rejectDecode(new Error('late decoder rejection'));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, [], 'the late decoder outcome must stay observed');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }

  let boundaryNow = 3000;
  let boundarySource = imagePayload.dataUrl;
  let boundaryClears = 0;
  const boundaryImage = {
    naturalWidth: 2,
    naturalHeight: 2,
    onload: () => undefined,
    onerror: () => undefined
  };
  Object.defineProperty(boundaryImage, 'src', {
    configurable: true,
    get() { return boundarySource; },
    set(value) {
      boundarySource = value;
      if (value === '') boundaryClears += 1;
    }
  });
  const decodeAtBoundary = executableContentFunction(
    'decodeFigureProviderImage', {
      FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
      validateFigureProviderImage,
      validateFigureProviderImageDimensions,
      admitFigureImageDimensions,
      figureImageError,
      figureImageTimeoutError,
      releaseFigureImage,
      loadFigureImage: async () => {
        boundaryNow = 3010;
        return boundaryImage;
      },
      setTimeout: () => 1,
      clearTimeout: () => undefined,
      Date: { now: () => boundaryNow }
    }
  );
  await assert.rejects(
    () => decodeAtBoundary(imagePayload, 3010),
    error => error?.code === 'FIGURE_IMAGE_TIMEOUT'
  );
  assert.equal(boundarySource, '');
  assert.equal(boundaryClears, 1,
    'an Image returned exactly at the post-race deadline must be released once');
});

test('Panel preparation threads one deadline, reuses admitted pixels, and decodes fallback only when selected', async () => {
  const requireAdmission = executableContentFunction('requireFigureTaskAdmission');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const figureImagePixelArea = executableContentFunction('figureImagePixelArea');
  const findDedicatedPanelImageElement = executableContentFunction(
    'findDedicatedPanelImageElement'
  );
  const persisted = {
    mediaType: 'image/png', dataUrl: 'data:image/png;base64,persisted'
  };
  const liveElement = {
    naturalWidth: 1200, naturalHeight: 800, complete: false,
    getAttribute: () => ''
  };
  const liveDecoded = { naturalWidth: 1200, naturalHeight: 800 };
  const persistedDecoded = { naturalWidth: 1000, naturalHeight: 700 };
  const encoded = (_source, maxEdge) => ({
    mediaType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${maxEdge}`,
    width: maxEdge, height: Math.round(maxEdge / 2), maxEdge
  });
  const validateDimensions = image => ({
    image: { mediaType: image.mediaType, dataUrl: image.dataUrl },
    dimensions: { width: image.width, height: image.height }
  });
  let now = 100;
  const clock = { now: () => now };
  const liveAdmissionCalls = [];
  const liveDeadlines = [];
  const prepareLive = executableContentFunction(
    'prepareFigurePanelImageVariants', {
      requireFigureTaskAdmission: requireAdmission,
      admitFigureProviderImages: async (...args) => {
        liveAdmissionCalls.push(args);
        return {
          images: args[0], decodedSources: [persistedDecoded],
          rejected: 0, truncated: false
        };
      },
      validateFigureProviderImageDimensions: validateDimensions,
      admitFigureImageDimensions,
      releaseFigureImage: () => undefined,
      figureImageDiagnosticCode: () => 'FIGURE_IMAGE_INVALID',
      figureImagePixelArea,
      findDedicatedPanelImageElement,
      loadPreparedFigureSource: async (_element, deadline) => {
        liveDeadlines.push(deadline);
        return liveDecoded;
      },
      loadFigureImage: async () => {
        throw new Error('an unselected persisted fallback must not be decoded');
      },
      normalizePanelCropGeometry: () => null,
      encodeFigureImageVariant: encoded,
      FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
      Date: clock,
      console: { warn() {} }
    }
  );
  const liveVariants = await prepareLive({
    analysisImages: [persisted], imageElements: [liveElement]
  }, 'A', figureVisionAdmission('figure_panel_interpretation'),
  'figure_panel_interpretation');
  assert.equal(liveVariants.length, 3);
  assert.deepEqual(liveDeadlines, [1100],
    'Panel live loading must receive the shared preparation deadline');
  assert.equal(liveAdmissionCalls.length, 0,
    'persisted fallback and generated variants must not trigger eager browser admission');

  now = 200;
  const fallbackAdmissionCalls = [];
  let fallbackLoadCalls = 0;
  const prepareFallback = executableContentFunction(
    'prepareFigurePanelImageVariants', {
      requireFigureTaskAdmission: requireAdmission,
      admitFigureProviderImages: async (...args) => {
        fallbackAdmissionCalls.push(args);
        return {
          images: [persisted], decodedSources: [persistedDecoded],
          rejected: 0, truncated: false
        };
      },
      validateFigureProviderImageDimensions: validateDimensions,
      admitFigureImageDimensions,
      releaseFigureImage: () => undefined,
      figureImageDiagnosticCode: () => 'FIGURE_IMAGE_INVALID',
      figureImagePixelArea,
      findDedicatedPanelImageElement,
      loadPreparedFigureSource: async () => null,
      loadFigureImage: async () => { fallbackLoadCalls += 1; return persistedDecoded; },
      normalizePanelCropGeometry: () => null,
      encodeFigureImageVariant: encoded,
      FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
      Date: clock,
      console: { warn() {} }
    }
  );
  const fallbackVariants = await prepareFallback({
    analysisImages: [persisted], imageElements: []
  }, 'B', figureVisionAdmission('figure_panel_interpretation'),
  'figure_panel_interpretation');
  assert.equal(fallbackVariants.length, 3);
  assert.equal(fallbackAdmissionCalls.length, 1,
    'a selected persisted source must be browser-admitted exactly once');
  assert.equal(fallbackAdmissionCalls[0][2], 1200);
  assert.equal(fallbackAdmissionCalls[0][3]?.retainDecodedSources, true);
  assert.equal(fallbackLoadCalls, 0,
    'the decoded source returned by admission must be reused without another load');

  const fallbackWarnings = [];
  const prepareUnavailable = executableContentFunction(
    'prepareFigurePanelImageVariants', {
      requireFigureTaskAdmission: requireAdmission,
      admitFigureProviderImages: async () => ({
        images: [], decodedSources: [], rejected: 0, truncated: false
      }),
      validateFigureProviderImageDimensions: validateDimensions,
      admitFigureImageDimensions,
      releaseFigureImage: () => undefined,
      figureImageDiagnosticCode: () => 'FIGURE_IMAGE_INVALID',
      figureImagePixelArea,
      findDedicatedPanelImageElement,
      loadPreparedFigureSource: async () => {
        const error = new Error('FIGURE_IMAGE_INVALID');
        error.code = 'FIGURE_IMAGE_INVALID';
        throw error;
      },
      loadFigureImage: async () => null,
      normalizePanelCropGeometry: () => null,
      encodeFigureImageVariant: encoded,
      FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
      Date,
      console: { warn(...parts) { fallbackWarnings.push(parts); } }
    }
  );
  assert.deepEqual(await prepareUnavailable({
    analysisImages: [], imageElements: [liveElement]
  }, 'C', figureVisionAdmission('figure_panel_interpretation'),
  'figure_panel_interpretation'), []);
  assert.equal(fallbackWarnings.length, 1,
    'exhausting the selected live source and persisted fallback must stay explicit');
});

test('Figure byte headers bound PNG JPEG and every WebP variant before browser allocation', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const png = (width, height) => {
    const bytes = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
    bytes.writeUInt32BE(13, 8);
    bytes.write('IHDR', 12, 'ascii');
    bytes.writeUInt32BE(width >>> 0, 16);
    bytes.writeUInt32BE(height >>> 0, 20);
    return new Uint8Array(bytes);
  };
  const jpeg = (width, height) => new Uint8Array(Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9
  ]));
  const webp = (kind, width, height) => {
    let payload;
    if (kind === 'VP8X') {
      payload = Buffer.alloc(10);
      payload.writeUIntLE(width - 1, 4, 3);
      payload.writeUIntLE(height - 1, 7, 3);
    } else if (kind === 'VP8L') {
      payload = Buffer.alloc(5);
      payload[0] = 0x2f;
      const dimensions = (((height - 1) << 14) | (width - 1)) >>> 0;
      payload.writeUInt32LE(dimensions, 1);
    } else {
      payload = Buffer.from([
        0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a,
        width & 0xff, (width >>> 8) & 0x3f,
        height & 0xff, (height >>> 8) & 0x3f
      ]);
    }
    const paddedLength = payload.length + (payload.length % 2);
    const bytes = Buffer.alloc(20 + paddedLength);
    bytes.write('RIFF', 0, 'ascii');
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WEBP', 8, 'ascii');
    bytes.write(kind === 'VP8' ? 'VP8 ' : kind, 12, 'ascii');
    bytes.writeUInt32LE(payload.length, 16);
    payload.copy(bytes, 20);
    return new Uint8Array(bytes);
  };
  const readFigureImageDimensions = executableContentFunction(
    'readFigureImageDimensions', {
      FIGURE_IMAGE_SOURCE_MAX_EDGE: 8192,
      FIGURE_IMAGE_SOURCE_MAX_PIXELS: 40000000,
      figureImageError,
      admitFigureImageDimensions
    }
  );
  assert.deepEqual(readFigureImageDimensions(png(4096, 4096), 'image/png'), {
    width: 4096, height: 4096
  });
  assert.deepEqual(readFigureImageDimensions(jpeg(6000, 4000), 'image/jpeg'), {
    width: 6000, height: 4000, orientation: 1
  });
  assert.deepEqual(readFigureImageDimensions(png(8192, 1), 'image/png'), {
    width: 8192, height: 1
  }, 'the exact edge limit remains admissible');
  assert.deepEqual(readFigureImageDimensions(png(8000, 5000), 'image/png'), {
    width: 8000, height: 5000
  }, 'the exact pixel-area limit remains admissible');
  for (const kind of ['VP8', 'VP8L', 'VP8X']) {
    assert.deepEqual(readFigureImageDimensions(webp(kind, 2048, 1024), 'image/webp'), {
      width: 2048, height: 1024
    }, kind);
  }
  const jpegWithZeroComponents = jpeg(20, 20);
  jpegWithZeroComponents[17] = 0;
  const oversizedVp8xChunk = (() => {
    const valid = Buffer.from(webp('VP8X', 20, 20));
    const bytes = Buffer.alloc(valid.length + 2);
    valid.copy(bytes);
    bytes.writeUInt32LE(12, 16);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    return new Uint8Array(bytes);
  })();
  const vp8lWithUnsupportedVersion = webp('VP8L', 20, 20);
  vp8lWithUnsupportedVersion[24] |= 0x20;
  for (const malformed of [
    png(20, 20).slice(0, 23),
    new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]),
    jpegWithZeroComponents,
    webp('VP8', 20, 20).slice(0, 29),
    webp('VP8L', 20, 20).slice(0, 24),
    webp('VP8X', 20, 20).slice(0, 29),
    oversizedVp8xChunk,
    vp8lWithUnsupportedVersion,
    (() => {
      const bytes = webp('VP8X', 20, 20);
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        .setUint32(4, 0xffffffff, true);
      return bytes;
    })()
  ]) {
    assert.throws(
      () => readFigureImageDimensions(malformed,
        malformed[0] === 0xff ? 'image/jpeg' :
          malformed[0] === 0x89 ? 'image/png' : 'image/webp'),
      error => error?.code === 'FIGURE_IMAGE_INVALID'
    );
  }
  for (const [bomb, mediaType] of [
    [png(8193, 1), 'image/png'],
    [png(8000, 6000), 'image/png'],
    [png(0xffffffff, 0xffffffff), 'image/png'],
    [jpeg(8193, 1), 'image/jpeg'],
    [webp('VP8X', 8000, 6000), 'image/webp']
  ]) {
    assert.throws(
      () => readFigureImageDimensions(bomb, mediaType),
      error => error?.code === 'FIGURE_IMAGE_TOO_LARGE'
    );
  }

  let blobAllocations = 0;
  let objectUrls = 0;
  let browserLoads = 0;
  const TestURL = class extends URL {};
  TestURL.createObjectURL = () => { objectUrls += 1; return 'blob:bomb'; };
  TestURL.revokeObjectURL = () => undefined;
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async () => png(8193, 1),
    figureImageBytesMatchMediaType: executableContentFunction(
      'figureImageBytesMatchMediaType'
    ),
    readFigureImageDimensions,
    releaseFigureImage: () => undefined,
    AbortController,
    Blob: class { constructor() { blobAllocations += 1; } },
    URL: TestURL,
    document: { baseURI: 'https://paper.test/article' },
    loadFigureImage: async () => {
      browserLoads += 1;
      return { naturalWidth: 8193, naturalHeight: 1 };
    },
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    fetch: async () => ({
      ok: true,
      headers: { get: name => name === 'content-type' ? 'image/png' : null },
      body: {}
    })
  });
  await assert.rejects(
    () => fetchFigureImage('https://cdn.test/bomb.png', 1000),
    error => error?.code === 'FIGURE_IMAGE_TOO_LARGE'
  );
  assert.equal(blobAllocations, 0);
  assert.equal(objectUrls, 0);
  assert.equal(browserLoads, 0);
});

test('remote Figure decode re-admits actual pixels against its bounded byte header', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  let source = 'blob:header-small';
  let releases = 0;
  let revocations = 0;
  const decoded = { naturalWidth: 8193, naturalHeight: 1 };
  Object.defineProperty(decoded, 'src', {
    configurable: true,
    get() { return source; },
    set(value) { source = value; }
  });
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async () => new Uint8Array([1]),
    figureImageBytesMatchMediaType: () => true,
    readFigureImageDimensions: () => ({ width: 1, height: 1 }),
    admitFigureImageDimensions,
    releaseFigureImage: image => {
      releases += 1;
      image.src = '';
    },
    AbortController,
    Blob,
    URL: {
      createObjectURL: () => 'blob:header-small',
      revokeObjectURL() { revocations += 1; }
    },
    document: {
      baseURI: 'https://paper.test/article',
      location: { href: 'https://paper.test/article' }
    },
    loadFigureImage: async () => decoded,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    fetch: async () => ({
      ok: true,
      url: 'https://paper.test/figure.png',
      headers: { get: name => name === 'content-type' ? 'image/png' : null },
      body: {}
    })
  });
  await assert.rejects(
    () => fetchFigureImage('https://paper.test/figure.png', 1000),
    error => error?.code === 'FIGURE_IMAGE_TOO_LARGE'
  );
  assert.equal(releases, 1,
    'a header-admitted browser Image must be released after actual pixels fail');
  assert.equal(source, '');
  assert.equal(revocations, 1);
});

test('bounded Figure fetch includes same-origin credentials and omits them for public CDNs', async () => {
  const requests = [];
  const figureImageError = executableContentFunction('figureImageError');
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async () => {
      throw new Error('an HTTP failure must not read its body');
    },
    figureImageBytesMatchMediaType: () => true,
    readFigureImageDimensions: () => ({ width: 1, height: 1 }),
    releaseFigureImage: () => undefined,
    AbortController,
    Blob,
    URL,
    document: {
      baseURI: 'https://public-cdn.test/assets/',
      location: {
        href: 'https://paper.test/articles/1',
        origin: 'https://paper.test'
      }
    },
    loadFigureImage: async () => null,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    fetch: async (source, options) => {
      requests.push({ source, options });
      return { ok: false, headers: { get: () => null }, body: null };
    }
  });
  for (const source of [
    'https://paper.test/figures/main.png',
    'https://public-cdn.test/paper/main.png',
    'relative-to-cross-origin-base.png'
  ]) {
    await assert.rejects(
      () => fetchFigureImage(source, 1000),
      error => error?.code === 'FIGURE_IMAGE_INVALID'
    );
  }
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[1].options.credentials, 'omit');
  assert.equal(requests[2].options.credentials, 'omit',
    'a cross-origin <base> must not expand the document credential boundary');
  assert.ok(requests.every(request => request.options.signal instanceof AbortSignal));
});

test('same-origin Figure vanity fetch keeps redirect-safe credentials for a CDN response URL', async () => {
  const requests = [];
  const decoded = { naturalWidth: 1, naturalHeight: 1 };
  const figureImageError = executableContentFunction('figureImageError');
  const RedirectURL = class extends URL {};
  RedirectURL.createObjectURL = () => 'blob:redirected-figure';
  RedirectURL.revokeObjectURL = () => undefined;
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const fetchFigureImage = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
    readBoundedFigureImageBody: async response => {
      assert.equal(response.url, 'https://public-cdn.test/final/figure.png');
      return new Uint8Array([1]);
    },
    figureImageBytesMatchMediaType: () => true,
    readFigureImageDimensions: () => ({ width: 1, height: 1 }),
    admitFigureImageDimensions,
    releaseFigureImage: () => undefined,
    AbortController,
    Blob,
    URL: RedirectURL,
    document: {
      baseURI: 'https://paper.test/article',
      location: { href: 'https://paper.test/article' }
    },
    loadFigureImage: async () => decoded,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    fetch: async (source, options) => {
      requests.push({ source, options });
      return {
        ok: true,
        url: 'https://public-cdn.test/final/figure.png',
        headers: { get: name => name === 'content-type' ? 'image/png' : null },
        body: {}
      };
    }
  });
  assert.equal(await fetchFigureImage(
    'https://paper.test/figure-vanity/main.png', 1000
  ), decoded);
  assert.equal(requests.length, 1, 'redirect handling must not issue a second fetch or HEAD');
  assert.equal(requests[0].options.credentials, 'same-origin',
    'the Fetch standard must strip same-origin credentials after a cross-origin redirect');
});

test('all Figure preparation entries reject persisted unsafe pixels and re-encode only live sources', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const imageUpgradePolicy = executableFigureImageUpgradePolicy();
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const figureImageBytesMatchMediaType = executableContentFunction(
    'figureImageBytesMatchMediaType'
  );
  const validateFigureProviderImage = executableContentFunction(
    'validateFigureProviderImage', {
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      figureImageError,
      figureImageBytesMatchMediaType,
      atob: value => Buffer.from(value, 'base64').toString('binary')
    }
  );
  const collectValidFigureProviderImages = executableContentFunction(
    'collectValidFigureProviderImages', {
      FIGURE_IMAGE_LIMIT: 4,
      validateFigureProviderImage
    }
  );
  const admitFigureProviderImages = executableContentFunction(
    'admitFigureProviderImages', {
      FIGURE_IMAGE_LIMIT: 4,
      FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
      collectValidFigureProviderImages,
      decodeFigureProviderImage: async image => validateFigureProviderImage(image),
      Date
    }
  );
  const figureImageDiagnosticCode = executableContentFunction(
    'figureImageDiagnosticCode'
  );
  const warnings = [];
  const boundedConsole = { warn(...parts) { warnings.push(parts.join(' ')); } };
  const requireAdmission = executableContentFunction('requireFigureTaskAdmission');
  const png = { mediaType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
  const malicious = '<svg onload=alert(1)>';
  const unsafe = {
    mediaType: 'image/png',
    dataUrl: `data:image/png;base64,${malicious}`
  };
  let liveEncodes = 0;
  const prepareFigureImage = async () => {
    liveEncodes += 1;
    return png;
  };
  const prepareImages = executableContentFunction('prepareFigureImages', {
    requireFigureTaskAdmission: requireAdmission,
    ...imageUpgradePolicy,
    admitFigureProviderImages,
    collectValidFigureProviderImages,
    validateFigureProviderImage,
    figureImageError,
    figureImageDiagnosticCode,
    FIGURE_IMAGE_LIMIT: 4,
    FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
    prepareFigureImage,
    console: boundedConsole
  });
  const nonTilingAdmission = figureVisionAdmission('figure_walkthrough');
  nonTilingAdmission.route.providerId = 'openai';
  assert.deepEqual(await prepareImages({
    analysisImages: [unsafe], imageElements: [{}]
  }, nonTilingAdmission, 'figure_walkthrough'), [png]);
  assert.equal(liveEncodes, 1,
    'invalid persisted pixels may be replaced only by a fresh bounded live encoding');

  const preparePersisted = executableContentFunction(
    'preparePersistedFigureImages', {
      ...imageUpgradePolicy,
      admitFigureProviderImages,
      collectValidFigureProviderImages,
      validateFigureProviderImage,
      figureImageError,
      figureImageDiagnosticCode,
      FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
      prepareFigureImage,
      console: boundedConsole
    }
  );
  assert.deepEqual(await preparePersisted({
    analysisImages: [unsafe], imageElements: []
  }), []);

  let persistedLoads = 0;
  const preparePanelVariants = executableContentFunction(
    'prepareFigurePanelImageVariants', {
      requireFigureTaskAdmission: requireAdmission,
      admitFigureProviderImages,
      collectValidFigureProviderImages,
      validateFigureProviderImage,
      admitFigureImageDimensions,
      figureImageDiagnosticCode,
      figureImagePixelArea: executableContentFunction('figureImagePixelArea'),
      findDedicatedPanelImageElement: executableContentFunction(
        'findDedicatedPanelImageElement'
      ),
      loadPreparedFigureSource: async () => null,
      loadFigureImage: async () => { persistedLoads += 1; },
      normalizePanelCropGeometry: () => null,
      encodeFigureImageVariant: () => png,
      console: boundedConsole
    }
  );
  assert.deepEqual(await preparePanelVariants({
    analysisImages: [unsafe], imageElements: []
  }, 'A', figureVisionAdmission('figure_panel_interpretation'),
  'figure_panel_interpretation'), []);
  assert.equal(persistedLoads, 0,
    'an invalid persisted data URL must never reach the browser decoder');

  let encodedCandidate = unsafe;
  const prepareLivePanelVariants = executableContentFunction(
    'prepareFigurePanelImageVariants', {
      requireFigureTaskAdmission: requireAdmission,
      admitFigureProviderImages,
      collectValidFigureProviderImages,
      validateFigureProviderImage,
      admitFigureImageDimensions,
      figureImageDiagnosticCode,
      figureImagePixelArea: executableContentFunction('figureImagePixelArea'),
      findDedicatedPanelImageElement: executableContentFunction(
        'findDedicatedPanelImageElement'
      ),
      loadPreparedFigureSource: async () => ({
        naturalWidth: 1200, naturalHeight: 800
      }),
      loadFigureImage: async () => null,
      normalizePanelCropGeometry: () => null,
      encodeFigureImageVariant: (_source, maxEdge) => ({
        ...encodedCandidate, width: maxEdge, height: 600, maxEdge
      }),
      console: boundedConsole
    }
  );
  const liveFigure = {
    analysisImages: [],
    imageElements: [{ naturalWidth: 1200, naturalHeight: 800 }]
  };
  assert.deepEqual(await prepareLivePanelVariants(
    liveFigure, 'A', figureVisionAdmission('figure_panel_interpretation'),
    'figure_panel_interpretation'
  ), [], 'invalid live encodings must not become provider panel variants');
  encodedCandidate = png;
  const panelVariants = await prepareLivePanelVariants(
    liveFigure, 'A', figureVisionAdmission('figure_panel_interpretation'),
    'figure_panel_interpretation'
  );
  assert.equal(panelVariants.length, 3);
  assert.ok(panelVariants.every(image => image.mediaType === 'image/png' &&
    image.dataUrl === png.dataUrl && image.pixelsSupplied === true));
  assert.ok(warnings.some(message => message.includes('FIGURE_IMAGE_INVALID')),
    'pixel degradation must be explicit with a fixed safe diagnostic code');
  assert.ok(warnings.every(message => !message.includes(malicious)),
    'diagnostics must never reflect malicious persisted payloads');
});

test('Figure provider preparation scans a bounded persisted set and validates encoded panel variants', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageBytesMatchMediaType = executableContentFunction(
    'figureImageBytesMatchMediaType'
  );
  const validateFigureProviderImage = executableContentFunction(
    'validateFigureProviderImage', {
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      figureImageError,
      figureImageBytesMatchMediaType,
      atob: value => Buffer.from(value, 'base64').toString('binary')
    }
  );
  const collect = executableContentFunction('collectValidFigureProviderImages', {
    FIGURE_IMAGE_LIMIT: 4,
    validateFigureProviderImage
  });
  const unsafe = Array.from({ length: 1000 }, () => ({
    mediaType: 'image/gif', dataUrl: 'data:image/gif;base64,R0lGODlh'
  }));
  const result = collect(unsafe, 2);
  assert.deepEqual(result.images, []);
  assert.equal(result.rejected, 8);
  assert.equal(result.truncated, true);

  const png = { mediaType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
  assert.deepEqual(collect([unsafe[0], png], 1), {
    images: [png], rejected: 1, truncated: false
  });
  let hostileLengthReads = 0;
  const hostileList = new Proxy([], {
    get(target, property, receiver) {
      if (property === 'length') {
        hostileLengthReads += 1;
        throw new Error('hostile persisted length');
      }
      return Reflect.get(target, property, receiver);
    }
  });
  assert.deepEqual(collect(hostileList, 1), {
    images: [], rejected: 0, truncated: false
  });
  assert.equal(hostileLengthReads, 0);

  let itemAccessorReads = 0;
  const accessorList = [];
  Object.defineProperty(accessorList, 0, {
    configurable: true,
    get() { itemAccessorReads += 1; return png; }
  });
  assert.deepEqual(collect(accessorList, 1), {
    images: [], rejected: 1, truncated: false
  });
  assert.equal(itemAccessorReads, 0,
    'persisted array item accessors must be rejected without execution');
});

test('unloaded Figure sources use bounded fetch instead of direct browser allocation', async () => {
  let directLoads = 0;
  let boundedFetches = 0;
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const decoded = { naturalWidth: 10, naturalHeight: 10 };
  const loadPreparedFigureSource = executableContentFunction(
    'loadPreparedFigureSource', {
      FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
      resolveFigureImageSources: async () => ['https://example.test/figure.png'],
      admitFigureImageDimensions,
      isFigureDomImageOriginClean: () => true,
      loadFigureImage: async () => {
        directLoads += 1;
        throw new Error('direct loading must not run for an unloaded remote source');
      },
      fetchFigureImage: async source => {
        boundedFetches += 1;
        assert.equal(source, 'https://example.test/figure.png');
        return decoded;
      },
      figureImageTimeoutError: executableContentFunction('figureImageTimeoutError')
    }
  );
  const imageElement = {
    complete: false,
    naturalWidth: 0,
    currentSrc: 'https://example.test/figure.png',
    src: 'https://example.test/figure.png',
    getAttribute: () => ''
  };
  assert.equal(await loadPreparedFigureSource(imageElement, Date.now() + 1000), decoded);
  assert.equal(directLoads, 0);
  assert.equal(boundedFetches, 1);

  const loaded = {
    ...imageElement, complete: true, naturalWidth: 10, naturalHeight: 10
  };
  assert.equal(await loadPreparedFigureSource(loaded, Date.now() + 1000), loaded);
  assert.equal(boundedFetches, 1,
    'an image the page already decoded can be re-used without allocating it again');
});

test('walkthrough replaces a tainted loaded DOM Figure through bounded anonymous bytes before Canvas', async () => {
  const canvasLog = [];
  const document = createOriginSemanticsDocument(canvasLog);
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageTimeoutError = executableContentFunction('figureImageTimeoutError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const matchFigureImageDimensions = executableContentFunction(
    'matchFigureImageDimensions', { admitFigureImageDimensions, figureImageError }
  );
  const isFigureDomImageOriginClean = executableContentFunction(
    'isFigureDomImageOriginClean', { document }
  );
  const figureImageBytesMatchMediaType = executableContentFunction(
    'figureImageBytesMatchMediaType'
  );
  const readFigureImageDimensions = executableContentFunction(
    'readFigureImageDimensions', {
      FIGURE_IMAGE_SOURCE_MAX_EDGE: 8192,
      FIGURE_IMAGE_SOURCE_MAX_PIXELS: 40000000,
      figureImageError,
      admitFigureImageDimensions
    }
  );
  const pngBytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(pngBytes);
  pngBytes.writeUInt32BE(13, 8);
  pngBytes.write('IHDR', 12, 'ascii');
  pngBytes.writeUInt32BE(2, 16);
  pngBytes.writeUInt32BE(2, 20);
  const requests = [];
  let blobAllocations = 0;
  let objectUrlAllocations = 0;
  let browserDecodes = 0;
  let releases = 0;
  const decoded = { naturalWidth: 2, naturalHeight: 2, originClean: true };
  const TestBlob = class {
    constructor(parts, options) {
      blobAllocations += 1;
      this.parts = parts;
      this.type = options?.type;
    }
  };
  const TestURL = class extends URL {};
  TestURL.createObjectURL = () => {
    objectUrlAllocations += 1;
    return 'blob:https://paper.test/bounded-figure';
  };
  TestURL.revokeObjectURL = () => undefined;
  const boundedFetch = executableContentFunction('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    figureImageError,
    figureImageTimeoutError,
    readBoundedFigureImageBody: async () => new Uint8Array(pngBytes),
    figureImageBytesMatchMediaType,
    readFigureImageDimensions,
    admitFigureImageDimensions,
    matchFigureImageDimensions,
    releaseFigureImage: () => { releases += 1; },
    AbortController,
    Blob: TestBlob,
    URL: TestURL,
    document,
    loadFigureImage: async source => {
      assert.equal(source, 'blob:https://paper.test/bounded-figure');
      browserDecodes += 1;
      return decoded;
    },
    setTimeout,
    clearTimeout,
    fetch: async (source, options) => {
      requests.push({ source, options });
      return {
        ok: true,
        url: source,
        headers: { get: name => name === 'content-type' ? 'image/png' : null },
        body: {}
      };
    }
  });
  const forwardedDeadlines = [];
  const loadPreparedFigureSource = executableContentFunction(
    'loadPreparedFigureSource', {
      FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
      resolveFigureImageSources: async figure => [figure.imageElements[0].src],
      admitFigureImageDimensions,
      isFigureDomImageOriginClean,
      fetchFigureImage: async (source, remaining, deadline) => {
        forwardedDeadlines.push({ source, remaining, deadline });
        return boundedFetch(source, remaining, deadline);
      },
      figureImageTimeoutError,
      setTimeout,
      clearTimeout,
      Date
    }
  );
  const encodeFigureImageVariant = executableContentFunction(
    'encodeFigureImageVariant', {
      admitFigureImageDimensions,
      normalizePanelCropGeometry: () => null,
      figureDataUrlBytes: () => 1,
      FIGURE_IMAGE_MAX_EDGE: 1600,
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      document
    }
  );
  const encodeFigureImage = executableContentFunction('encodeFigureImage', {
    encodeFigureImageVariant,
    FIGURE_IMAGE_MAX_EDGE: 1600
  });
  const prepareFigureImage = executableContentFunction('prepareFigureImage', {
    loadPreparedFigureSource,
    encodeFigureImage,
    releaseFigureImage: () => { releases += 1; },
    figureImageTimeoutError,
    Date
  });
  const source = 'https://cdn.test/paper/figure.png';
  const loadedTainted = {
    complete: true,
    naturalWidth: 2,
    naturalHeight: 2,
    originClean: false,
    currentSrc: source,
    src: source,
    crossOrigin: null,
    getAttribute: () => null
  };
  const deadline = Date.now() + 1000;
  assert.deepEqual(await prepareFigureImage(loadedTainted, deadline), {
    mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/'
  });
  assert.equal(forwardedDeadlines.length, 1);
  assert.equal(forwardedDeadlines[0].deadline, deadline,
    'taint fallback must preserve the walkthrough absolute deadline');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(blobAllocations, 1);
  assert.equal(objectUrlAllocations, 1);
  assert.equal(browserDecodes, 1);
  assert.equal(releases, 1, 'only the owned Blob-decoded Image is released');
  assert.ok(canvasLog.some(canvas => canvas.source === loadedTainted && canvas.exported),
    'the loaded DOM Image must be proven tainted before fallback');
  assert.ok(canvasLog.some(canvas => canvas.source === decoded && canvas.exported),
    'Canvas encoding must use the origin-clean Blob decode');
});

test('Panel variants replace a tainted loaded DOM Figure within one preparation deadline', async () => {
  const canvasLog = [];
  const document = createOriginSemanticsDocument(canvasLog);
  const figureImageError = executableContentFunction('figureImageError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const figureImageTimeoutError = executableContentFunction('figureImageTimeoutError');
  const isFigureDomImageOriginClean = executableContentFunction(
    'isFigureDomImageOriginClean', { document }
  );
  const source = 'https://cdn.test/paper/panel.png';
  const loadedTainted = {
    complete: true,
    naturalWidth: 2400,
    naturalHeight: 1600,
    originClean: false,
    currentSrc: source,
    src: source,
    crossOrigin: null,
    getAttribute: () => null
  };
  const decoded = {
    naturalWidth: 2400, naturalHeight: 1600, originClean: true
  };
  const fetchCalls = [];
  const loadPreparedFigureSource = executableContentFunction(
    'loadPreparedFigureSource', {
      FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
      resolveFigureImageSources: async () => [source],
      admitFigureImageDimensions,
      isFigureDomImageOriginClean,
      fetchFigureImage: async (...args) => {
        fetchCalls.push(args);
        return decoded;
      },
      figureImageError,
      figureImageTimeoutError,
      setTimeout,
      clearTimeout,
      Date
    }
  );
  const encodeFigureImageVariant = executableContentFunction(
    'encodeFigureImageVariant', {
      admitFigureImageDimensions,
      normalizePanelCropGeometry: () => null,
      figureDataUrlBytes: () => 1,
      FIGURE_IMAGE_MAX_EDGE: 1600,
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      document
    }
  );
  const requireAdmission = executableContentFunction('requireFigureTaskAdmission');
  const figureImagePixelArea = executableContentFunction('figureImagePixelArea');
  const findDedicatedPanelImageElement = executableContentFunction(
    'findDedicatedPanelImageElement'
  );
  let releases = 0;
  const started = Date.now();
  const preparePanelVariants = executableContentFunction(
    'prepareFigurePanelImageVariants', {
      requireFigureTaskAdmission: requireAdmission,
      admitFigureProviderImages: async () => {
        throw new Error('a successful live fallback must not decode persisted bytes');
      },
      validateFigureProviderImageDimensions: encoded => ({
        image: { mediaType: encoded.mediaType, dataUrl: encoded.dataUrl },
        dimensions: { width: encoded.width, height: encoded.height }
      }),
      admitFigureImageDimensions,
      releaseFigureImage: () => { releases += 1; },
      figureImageDiagnosticCode: error => error?.code || 'FIGURE_IMAGE_INVALID',
      figureImagePixelArea,
      findDedicatedPanelImageElement,
      loadPreparedFigureSource,
      loadFigureImage: async () => {
        throw new Error('no legacy persisted decode');
      },
      normalizePanelCropGeometry: () => null,
      encodeFigureImageVariant,
      FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
      Date,
      console: { warn() {} }
    }
  );
  const variants = await preparePanelVariants(
    { analysisImages: [], imageElements: [loadedTainted] },
    'A', figureVisionAdmission('figure_panel_interpretation'),
    'figure_panel_interpretation'
  );
  assert.equal(variants.length, 3);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0][0], source);
  assert.ok(fetchCalls[0][2] >= started + 900 &&
    fetchCalls[0][2] <= Date.now() + 1000);
  assert.equal(releases, 1, 'Panel must release only its owned clean fallback');
  assert.ok(canvasLog.some(canvas => canvas.source === loadedTainted && canvas.exported));
  assert.equal(canvasLog.filter(canvas => canvas.source === decoded).length, 3,
    'all Panel variants must reuse the one admitted clean decode');
});

test('loaded DOM Figure edge and pixel bombs fail before reuse or Panel provider variants', async () => {
  const figureImageError = executableContentFunction('figureImageError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  const figureImageTimeoutError = executableContentFunction('figureImageTimeoutError');
  let boundedFetches = 0;
  const loadPreparedFigureSource = executableContentFunction(
    'loadPreparedFigureSource', {
      FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
      resolveFigureImageSources: async figure => [figure.imageElements[0].src],
      admitFigureImageDimensions,
      fetchFigureImage: async () => {
        boundedFetches += 1;
        throw new Error('an already-loaded bomb must not be fetched again');
      },
      figureImageError,
      figureImageTimeoutError,
      setTimeout,
      clearTimeout,
      Date
    }
  );
  const bombs = [
    { naturalWidth: 8193, naturalHeight: 1 },
    { naturalWidth: 8000, naturalHeight: 6000 }
  ].map((dimensions, index) => ({
    ...dimensions,
    complete: true,
    currentSrc: `https://paper.test/bomb-${index}.png`,
    src: `https://paper.test/bomb-${index}.png`,
    getAttribute: () => ''
  }));
  for (const bomb of bombs) {
    await assert.rejects(
      () => loadPreparedFigureSource(bomb, Date.now() + 1000),
      error => error?.code === 'FIGURE_IMAGE_TOO_LARGE'
    );
  }
  assert.equal(boundedFetches, 0);

  const requireAdmission = executableContentFunction('requireFigureTaskAdmission');
  const figureImagePixelArea = executableContentFunction('figureImagePixelArea');
  const findDedicatedPanelImageElement = executableContentFunction(
    'findDedicatedPanelImageElement'
  );
  let variantEncodes = 0;
  let borrowedReleases = 0;
  const warnings = [];
  const preparePanelVariants = executableContentFunction(
    'prepareFigurePanelImageVariants', {
      requireFigureTaskAdmission: requireAdmission,
      admitFigureProviderImages: async () => ({
        images: [], decodedSources: [], rejected: 0, truncated: false
      }),
      validateFigureProviderImageDimensions: encoded => ({
        image: { mediaType: encoded.mediaType, dataUrl: encoded.dataUrl },
        dimensions: { width: encoded.width, height: encoded.height }
      }),
      admitFigureImageDimensions,
      figureImageTimeoutError,
      figureImageDiagnosticCode: error => error?.code || 'FIGURE_IMAGE_INVALID',
      figureImagePixelArea,
      findDedicatedPanelImageElement,
      loadPreparedFigureSource: async imageElement => imageElement,
      releaseFigureImage: () => { borrowedReleases += 1; },
      normalizePanelCropGeometry: () => null,
      encodeFigureImageVariant: (_source, maxEdge) => {
        variantEncodes += 1;
        return {
          mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/',
          width: maxEdge, height: 1, maxEdge
        };
      },
      FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
      Date,
      console: { warn(...parts) { warnings.push(parts); } }
    }
  );
  for (const bomb of bombs) {
    assert.deepEqual(await preparePanelVariants(
      { analysisImages: [], imageElements: [bomb] },
      'A', figureVisionAdmission('figure_panel_interpretation'),
      'figure_panel_interpretation'
    ), []);
  }
  assert.equal(variantEncodes, 0,
    'oversized borrowed DOM pixels must not reach Canvas-backed variant encoding');
  assert.equal(borrowedReleases, 0,
    'rejection must not clear an oversized Image owned by the page DOM');
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every(parts => parts.includes('FIGURE_IMAGE_TOO_LARGE')));
});

test('Figure Canvas rejects decoded edge and pixel bombs before allocation', () => {
  const figureImageError = executableContentFunction('figureImageError');
  const admitFigureImageDimensions = executableFigureDimensionAdmission();
  let canvasAllocations = 0;
  const encodeFigureImageVariant = executableContentFunction(
    'encodeFigureImageVariant', {
      admitFigureImageDimensions,
      normalizePanelCropGeometry: () => null,
      figureDataUrlBytes: () => 1,
      FIGURE_IMAGE_MAX_EDGE: 1600,
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      document: {
        createElement() {
          canvasAllocations += 1;
          return {
            getContext: () => ({
              fillRect() {},
              drawImage() {},
              set fillStyle(_value) {}
            }),
            toDataURL: () => 'data:image/jpeg;base64,/9j/'
          };
        }
      }
    }
  );
  for (const sourceImage of [
    { naturalWidth: 8193, naturalHeight: 1 },
    { naturalWidth: 8000, naturalHeight: 6000 }
  ]) {
    assert.throws(
      () => encodeFigureImageVariant(sourceImage, 1200),
      error => error?.code === 'FIGURE_IMAGE_TOO_LARGE'
    );
  }
  assert.equal(canvasAllocations, 0,
    'dimension bombs must fail before document.createElement allocates a Canvas');
});

test('all six Figure workflows preflight exact routes before destructive or pixel work', () => {
  const workflows = {
    batch: contentFunctionSource('analyzeFiguresWithLLM'),
    deep: contentFunctionSource('analyzeSingleFigureDeep'),
    single: contentFunctionSource('analyzeSingleFigureWithLLM'),
    retry: contentFunctionSource('retryMissingFigurePanelsWithLLM'),
    panel: contentFunctionSource('analyzeSingleFigurePanelWithLLM'),
    followup: contentFunctionSource('askFigurePanelWithLLM')
  };
  const expected = {
    batch: 'figure_walkthrough', deep: 'figure_walkthrough',
    single: 'figure_walkthrough', retry: 'figure_panel_interpretation',
    panel: 'figure_panel_interpretation', followup: 'figure_panel_followup'
  };
  for (const [name, source] of Object.entries(workflows)) {
    const admission = source.indexOf(
      'const admissionLifecycle = articleWorkspaceLifecycleGeneration'
    );
    const preflightExpression =
      `const visionAdmission = await preflightFigureTaskRoute('${expected[name]}')`;
    const preflight = source.indexOf(preflightExpression);
    const admissionCheck = source.indexOf(
      'assertCurrentArticleWorkspaceLifecycle(admissionLifecycle)', preflight
    );
    assert.ok(admission >= 0 && admission < preflight,
      `${name} must capture its lifecycle before preflight`);
    assert.ok(preflight >= 0, `${name} must preflight its exact task`);
    assert.ok(admissionCheck > preflight,
      `${name} must validate its captured lifecycle after preflight`);
    for (const sideEffect of [
      'getFigureWorkspaceInventory(', 'ensureFigureWorkspaceInventorySeeded(',
      'figureProgressById.clear(', 'clearFigureWalkthroughs(',
      'prepareFigureImages(', 'prepareFigurePanelImageVariants(',
      'deepLoading = true', 'panelAnalysisLoading[', 'panelFollowupLoading['
    ]) {
      const index = source.indexOf(sideEffect);
      if (index >= 0) {
        assert.ok(admissionCheck < index,
          `${name} admission check must precede ${sideEffect}`);
      }
    }
    const seed = source.indexOf('await ensureFigureWorkspaceInventorySeeded()');
    if (seed >= 0) {
      assert.ok(source.indexOf(
        'assertCurrentArticleWorkspaceLifecycle(admissionLifecycle)', seed
      ) > seed, `${name} must revalidate its lifecycle after inventory seeding`);
    }
  }
  for (const name of ['batch', 'deep', 'single']) {
    assert.match(workflows[name], new RegExp(
      `prepareFigureImages\\([^;]+visionAdmission,\\s*'figure_walkthrough'\\s*\\)`
    ), `${name} must bind walkthrough pixels to its exact admission`);
  }
  assert.match(workflows.retry,
    /verifyLiveFigureRetryInput\([\s\S]*?visionAdmission,\s*'figure_panel_interpretation'\s*\)/u);
  assert.match(workflows.panel,
    /prepareFigurePanelProductionInput\([\s\S]*?visionAdmission,\s*'figure_panel_interpretation'\s*\)/u);
  assert.match(workflows.followup,
    /prepareFigurePanelProductionInput\([\s\S]*?visionAdmission,\s*'figure_panel_followup'\s*\)/u);
  const retryPreflight = workflows.retry.indexOf(
    "await preflightFigureTaskRoute('figure_panel_interpretation')"
  );
  assert.ok(workflows.retry.indexOf('FIGURE_DEEP_RETRY_REQUIRES_RERUN') < retryPreflight,
    'the local deep-retry rejection must happen before route preflight');
  const panelPreflight = workflows.panel.indexOf(
    "await preflightFigureTaskRoute('figure_panel_interpretation')"
  );
  assert.ok(workflows.panel.indexOf('normalizeRequestedPanelId(panelId)') < panelPreflight);

  const batchPreflight = workflows.batch.indexOf(
    "await preflightFigureTaskRoute('figure_walkthrough')"
  );
  assert.ok(workflows.batch.indexOf('if (figureAnalysisPromise)') < batchPreflight);
  assert.ok(workflows.batch.indexOf('if (figureAnalysisPromise)', batchPreflight) > batchPreflight,
    'batch must recheck its promise after awaited preflight');
  for (const name of ['deep', 'single']) {
    const source = workflows[name];
    const preflight = source.indexOf(
      "await preflightFigureTaskRoute('figure_walkthrough')"
    );
    assert.ok(source.indexOf('reuseActiveFigureAnalysisPromise') < preflight);
    assert.ok(source.indexOf('reuseActiveFigureAnalysisPromise', preflight) > preflight,
      `${name} must recheck its promise after awaited preflight`);
  }
});

test('delayed Figure preflights cannot double-start batch deep or single work', async () => {
  async function exercise(kind) {
    const preflightResolvers = [];
    let starts = 0;
    let inventoryReads = 0;
    let signalWorkStarted;
    let releaseWork;
    const workStarted = new Promise(resolve => { signalWorkStarted = resolve; });
    const workGate = new Promise(resolve => { releaseWork = resolve; });
    const stopped = Object.assign(new Error(`stop-${kind}`), { code: 'TEST_STOP' });
    const dependencies = {
      captureFigureOperationPrimaryError: (operation, error) => {
        if (operation && error && typeof error === 'object') operation.primaryError = error;
        return error;
      },
      recoverPendingFigureOperationRelease: async () => ({ recovered: true }),
      synchronizeFigureWorkspaceLifecycle: async () => undefined,
      ensureCurrentArticleWorkspace: async () => ({ workspaceId: 'workspace-race' }),
      refreshSupplementalFigureAssets: async () => undefined,
      preflightFigureTaskRoute: taskId => new Promise(resolve => {
        preflightResolvers.push(() => resolve(figureVisionAdmission(taskId)));
      }),
      assertCurrentArticleWorkspaceLifecycle: () => undefined,
      beginFigureOperation: () => {
        starts += 1;
        return { operationId: `operation-${kind}`, cancelled: false };
      },
      getFigureWorkspaceInventory: () => { inventoryReads += 1; },
      ensureFigureWorkspaceInventorySeeded: async () => undefined,
      beginSingleFigureProgress: () => undefined,
      extractArticleWithTrace: () => [],
      waitForLocalOperation: async () => {
        signalWorkStarted();
        await workGate;
      },
      prepareFigureImages: async () => { throw stopped; },
      settleInterruptedFigureRecovery: async () => null,
      formatFigureCoverageFailure: () => stopped.message,
      retainFailedFigureDepth: () => undefined,
      persistImportedSupplementalFigureState: async () => ({ saved: true }),
      finishSingleFigureProgress: () => undefined,
      finishFigureOperation: () => undefined,
      scheduleCurrentArticleArchiveSave: () => undefined,
      scheduleArticleWorkspaceArtifactsSave: () => undefined,
      throwBusyFigureAnalysis: () => {
        const error = new Error('FIGURE_ANALYSIS_BUSY');
        error.code = 'FIGURE_ANALYSIS_BUSY';
        throw error;
      },
      document: { title: 'Preflight race' }
    };
    let harness;
    if (kind === 'batch') {
      Object.assign(dependencies, {
        figureProgressById: new Map(),
        updateFigureAnalysisStatus: () => undefined,
        clearFigureWalkthroughs: () => undefined,
        cancelPendingFigureProgress: () => undefined,
        showLlmPageStatus: () => undefined,
        SciLLM: { extractArticleFigures: () => [] },
        extractCurrentArticleFigures: () => [],
        ensureCurrentArticleWorkspace: async () => {
          signalWorkStarted();
          await workGate;
          throw stopped;
        }
      });
      harness = Function(...Object.keys(dependencies), `
        let figureAnalysisPromise = null;
        let articleWorkspaceLifecycleGeneration = 1;
        let figureWorkspaceInventory = [];
        let figureWorkspaceInventoryInitialized = false;
        let figureWorkspaceInventoryDirty = true;
        let figureWorkspaceLastFreshnessCheckAt = 0;
        const figureWalkthroughState = new Map();
        let lastFigureAnalysis = null;
        ${contentFunctionSource('analyzeFiguresWithLLM')}
        return { run: analyzeFiguresWithLLM };
      `)(...Object.values(dependencies));
    } else {
      const state = {
        figure: {
          figureId: 'figure-1', figureLabel: 'Figure 1', sourceExternal: false,
          caption: '', panelHints: [], contextParagraphs: [], imageElements: []
        },
        standard: kind === 'deep' ? { analysisDepth: 'standard' } : null,
        figureInputHash: 'input-hash',
        deepError: '', standardError: '', pendingResults: {}
      };
      dependencies.initialState = state;
      dependencies.ensureFigureWalkthroughState = () => state;
      harness = Function(...Object.keys(dependencies), `
        let figureDepthAnalysisPromise = null;
        let figureDepthAnalysisId = '';
        let figureDepthAnalysisKind = '';
        let articleWorkspaceLifecycleGeneration = 1;
        let lastFigureAnalysis = null;
        const figureWalkthroughState = new Map([['figure-1', initialState]]);
        ${contentFunctionSource('reuseActiveFigureAnalysisPromise')}
      ${contentFunctionSource('canApplyFigureFailure')}
        ${contentFunctionSource(kind === 'deep'
          ? 'analyzeSingleFigureDeep' : 'analyzeSingleFigureWithLLM')}
        return { run: ${kind === 'deep'
          ? 'analyzeSingleFigureDeep' : 'analyzeSingleFigureWithLLM'} };
      `)(...Object.values(dependencies));
    }

    const options = kind === 'deep' ? { expectedFigureInputHash: 'input-hash' } : {};
    const first = kind === 'batch'
      ? harness.run(options) : harness.run('figure-1', options);
    const second = kind === 'batch'
      ? harness.run(options) : harness.run('figure-1', options);
    assert.equal(preflightResolvers.length, 2, kind);
    assert.equal(starts, 0, kind);
    preflightResolvers[0]();
    await workStarted;
    assert.equal(starts, 1, kind);
    preflightResolvers[1]();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(starts, 1, `${kind} started twice after delayed preflight`);
    assert.equal(inventoryReads, kind === 'batch' ? 0 : 1, kind);
    releaseWork();
    const settled = await Promise.allSettled([first, second]);
    assert.deepEqual(settled.map(item => [item.status, item.reason?.code]), [
      ['rejected', 'TEST_STOP'], ['rejected', 'TEST_STOP']
    ], kind);
  }

  await exercise('batch');
  await exercise('deep');
  await exercise('single');
});

test('single Figure admission rechecks after shared inventory seeding', async () => {
  async function exercise(firstKind, secondKind = firstKind) {
    let preflightCalls = 0;
    let seedCalls = 0;
    let starts = 0;
    let releasePreflight;
    let releaseSeed;
    let releaseWork;
    let signalBothSeeded;
    const preflightGate = new Promise(resolve => { releasePreflight = resolve; });
    const seedGate = new Promise(resolve => { releaseSeed = resolve; });
    const workGate = new Promise(resolve => { releaseWork = resolve; });
    const bothSeeded = new Promise(resolve => { signalBothSeeded = resolve; });
    const stopped = Object.assign(new Error('seed-race-stop'), { code: 'TEST_STOP' });
    const state = {
      figure: {
        figureId: 'figure-1', figureLabel: 'Figure 1', sourceExternal: false,
        caption: '', panelHints: [], contextParagraphs: [], imageElements: []
      },
      standard: { analysisDepth: 'standard' }, figureInputHash: 'input-hash',
      deepError: '', standardError: '', pendingResults: {}
    };
    const dependencies = {
      captureFigureOperationPrimaryError: (operation, error) => {
        if (operation && error && typeof error === 'object') operation.primaryError = error;
        return error;
      },
      recoverPendingFigureOperationRelease: async () => ({ recovered: true }),
      synchronizeFigureWorkspaceLifecycle: async () => undefined,
      ensureCurrentArticleWorkspace: async () => ({ workspaceId: 'workspace-seed-race' }),
      refreshSupplementalFigureAssets: async () => undefined,
      preflightFigureTaskRoute: async taskId => {
        preflightCalls += 1;
        await preflightGate;
        return figureVisionAdmission(taskId);
      },
      assertCurrentArticleWorkspaceLifecycle: () => undefined,
      getFigureWorkspaceInventory: () => undefined,
      ensureFigureWorkspaceInventorySeeded: async () => {
        seedCalls += 1;
        if (seedCalls === 2) signalBothSeeded();
        await seedGate;
      },
      beginFigureOperation: kind => {
        starts += 1;
        return { operationId: `operation-${kind}-${starts}`, cancelled: false };
      },
      ensureFigureWalkthroughState: () => state,
      beginSingleFigureProgress: () => undefined,
      extractArticleWithTrace: () => [],
      waitForLocalOperation: async () => { await workGate; },
      prepareFigureImages: async () => { throw stopped; },
      settleInterruptedFigureRecovery: async () => null,
      formatFigureCoverageFailure: () => stopped.message,
      retainFailedFigureDepth: () => undefined,
      persistImportedSupplementalFigureState: async () => ({ saved: true }),
      finishSingleFigureProgress: () => undefined,
      finishFigureOperation: () => undefined,
      scheduleCurrentArticleArchiveSave: () => undefined,
      scheduleArticleWorkspaceArtifactsSave: () => undefined,
      throwBusyFigureAnalysis: () => {
        const error = new Error('FIGURE_ANALYSIS_BUSY');
        error.code = 'FIGURE_ANALYSIS_BUSY';
        throw error;
      },
      document: { title: 'Seed admission race' },
      initialState: state
    };
    const harness = Function(...Object.keys(dependencies), `
      let figureDepthAnalysisPromise = null;
      let figureDepthAnalysisId = '';
      let figureDepthAnalysisKind = '';
      let articleWorkspaceLifecycleGeneration = 1;
      let lastFigureAnalysis = null;
      const figureWalkthroughState = new Map([['figure-1', initialState]]);
      ${contentFunctionSource('reuseActiveFigureAnalysisPromise')}
      ${contentFunctionSource('canApplyFigureFailure')}
      ${contentFunctionSource('analyzeSingleFigureDeep')}
      ${contentFunctionSource('analyzeSingleFigureWithLLM')}
      return {
        deep: analyzeSingleFigureDeep,
        standard: analyzeSingleFigureWithLLM
      };
    `)(...Object.values(dependencies));
    const invoke = kind => kind === 'deep'
      ? harness.deep('figure-1', { expectedFigureInputHash: 'input-hash' })
      : harness.standard('figure-1');

    const first = invoke(firstKind);
    const second = invoke(secondKind);
    // Observe terminal admission errors before yielding through the IPC turn.
    void first.catch(() => {});
    void second.catch(() => {});
    assert.equal(preflightCalls, 2);
    releasePreflight();
    await bothSeeded;
    assert.equal(seedCalls, 2);
    assert.equal(starts, 0);
    releaseSeed();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(starts, 1, `${firstKind}/${secondKind} started twice after seeding`);
    releaseWork();
    const settled = await Promise.allSettled([first, second]);
    if (firstKind === secondKind) {
      assert.deepEqual(settled.map(item => [item.status, item.reason?.code]), [
        ['rejected', 'TEST_STOP'], ['rejected', 'TEST_STOP']
      ]);
    } else {
      assert.deepEqual(settled.map(item => [item.status, item.reason?.code]), [
        ['rejected', 'TEST_STOP'], ['rejected', 'FIGURE_ANALYSIS_BUSY']
      ]);
    }
  }

  await exercise('deep');
  await exercise('standard');
  await exercise('deep', 'standard');
});

test('delayed Figure preflights cannot cross an article lifecycle admission boundary', async () => {
  const cases = [
    ['analyzeFiguresWithLLM', [{}]],
    ['analyzeSingleFigureDeep', ['figure-1', { expectedFigureInputHash: 'input-hash' }]],
    ['analyzeSingleFigureWithLLM', ['figure-1', {}]],
    ['retryMissingFigurePanelsWithLLM', [{
      figureId: 'figure-1', analysisDepth: 'standard',
      expectedFigureInputHash: 'input-hash'
    }]],
    ['analyzeSingleFigurePanelWithLLM', ['figure-1', 'A', {}]],
    ['askFigurePanelWithLLM', ['figure-1', 'A', ['grouping'], '', '']]
  ];
  for (const [name, args] of cases) {
    const harness = Function(`
      const effects = { inventory: 0, state: 0, loading: 0, pixels: 0, provider: 0 };
      let articleWorkspaceLifecycleGeneration = 7;
      let figureAnalysisPromise = null;
      let releasePreflight;
      function sideEffect(kind) {
        effects[kind] += 1;
        const error = new Error('SIDE_EFFECT_REACHED');
        error.code = 'SIDE_EFFECT_REACHED';
        throw error;
      }
      function preflightFigureTaskRoute(taskId) {
        return new Promise(resolve => {
          releasePreflight = () => {
            articleWorkspaceLifecycleGeneration += 1;
            resolve({
              taskId,
              route: { taskType: taskId, capabilityMode: 'vision' },
              taskPolicySignature: 'policy-' + taskId
            });
          };
        });
      }
      function assertCurrentArticleWorkspaceLifecycle(expected) {
        if (expected !== articleWorkspaceLifecycleGeneration) {
          const error = new Error('ARTICLE_WORKSPACE_LIFECYCLE_CHANGED');
          error.code = 'CANCELLED';
          throw error;
        }
      }
      const reuseActiveFigureAnalysisPromise = () => null;
      const normalizeRequestedPanelId = value => String(value || '').toUpperCase();
      const getFigureWorkspaceInventory = () => sideEffect('inventory');
      const ensureFigureWorkspaceInventorySeeded = () => sideEffect('inventory');
      const ensureFigureWalkthroughState = () => sideEffect('state');
      const beginFigureOperation = () => sideEffect('loading');
      const prepareFigureImages = () => sideEffect('pixels');
      const prepareFigurePanelImageVariants = () => sideEffect('pixels');
      const chrome = { runtime: { sendMessage: () => sideEffect('provider') } };
      ${contentFunctionSource(name)}
      return {
        run: ${name}, effects,
        release: () => releasePreflight()
      };
    `)();
    const pending = harness.run(...args);
    harness.release();
    await assert.rejects(pending, error => error?.code === 'CANCELLED', name);
    assert.deepEqual(harness.effects, {
      inventory: 0, state: 0, loading: 0, pixels: 0, provider: 0
    }, name);
  }
});

test('Figure science checkpoints use a private acknowledged transport, never public progress', () => {
  const script = read('content.js');
  assert.match(script, /request\.action === 'llmFigureCheckpoint'/u);
  assert.match(script, /await commitFigurePartialCheckpoint/u);
  assert.doesNotMatch(
    contentFunctionSource('applyFigureProgressEvent'),
    /partialFigureResult|figureResult/u
  );
  const publicSnapshot = contentFunctionSource('sanitizeFigureProgressSnapshot');
  assert.doesNotMatch(publicSnapshot, /partialFigureResult|figureResult/u);
});

test('private checkpoint transport commits only a bound unlabeled zero-Panel overview', async () => {
  const figure = {
    figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: []
  };
  const state = { figure, pendingResults: {}, pendingResumeCheckpoints: {} };
  const notifications = [];
  const dependencies = {
    initialState: state,
    sanitizeFigureProgressText: value => String(value || '').slice(0, 100),
    isCurrentFigureOperation: value => value === 'figure-operation-current',
    mergeCompletedFigureResultIntoWorkspaceDraft: async () => undefined,
    buildFigureWorkspaceSnapshot: () => ({
      schemaVersion: 1, figures: [{
        figureId: figure.figureId,
        pendingStandardCheckpointEnvelope:
          state.pendingResumeCheckpoints.standard || null
      }]
    }),
    persistWorkspaceAssetCheckpoint: async () => ({ saved: true }),
    persistFigureInventoryWithCas: async () => ({ saved: true }),
    scheduleArticleWorkspaceArtifactsSave: () => undefined,
    notifyFigureWorkspaceStateChanged: (...args) => notifications.push(args)
  };
  const harness = Function(...Object.keys(dependencies), `
    let articleWorkspaceLifecycleGeneration = 31;
    let figurePartialCheckpointCommitTail = Promise.resolve();
    const figureWalkthroughState = new Map([['figure-1', initialState]]);
    ${contentFunctionSource('commitFigurePartialCheckpoint')}
    ${contentFunctionSource('applyPrivateFigureCheckpoint')}
    return { apply: applyPrivateFigureCheckpoint };
  `)(...Object.values(dependencies));
  const emptyOverview = {
    figureId: 'figure-1', analysisDepth: 'standard', basis: 'caption_context',
    unlabeledOverview: true, panels: [],
    figureQuestion: 'What does this Figure establish?',
    argumentChain: [{ established: 'A supported result.' }],
    coreConclusion: 'A supported result.', claimBoundary: 'No causal overclaim.'
  };
  const envelope = {
    version: 'figure-checkpoint-envelope-v1',
    figureId: 'figure-1', analysisDepth: 'standard',
    inputDigest: 'a'.repeat(64), routeDigest: 'b'.repeat(64),
    taskPolicyDigest: 'c'.repeat(64), planDigest: 'd'.repeat(64),
    immutableLimit: 48, inputMode: 'caption_context',
    visionFallback: false, fallbackReason: '',
    resultDigest: 'e'.repeat(64), bindingDigest: 'f'.repeat(64),
    figureResult: emptyOverview
  };
  const payload = JSON.parse(JSON.stringify({
    figureId: 'figure-1', operationId: 'figure-operation-current',
    workspaceLifecycle: 31,
    analysisDepth: 'standard', inputMode: 'caption_context',
    checkpointEnvelope: envelope
  }));
  for (const mode of [
    {
      inputMode: 'caption_context', basis: 'caption_context',
      visionFallback: false, fallbackReason: ''
    },
    {
      inputMode: 'figure_image', basis: 'vision_text',
      visionFallback: false, fallbackReason: ''
    },
    {
      inputMode: 'caption_context', basis: 'caption_context',
      visionFallback: true, fallbackReason: 'provider_rejected_pixels'
    }
  ]) {
    const validPayload = JSON.parse(JSON.stringify(payload));
    validPayload.inputMode = mode.inputMode;
    Object.assign(validPayload.checkpointEnvelope, mode);
    validPayload.checkpointEnvelope.figureResult.basis = mode.basis;
    const receipt = await harness.apply(validPayload);
    assert.deepEqual(receipt, { success: true, savedPanelCount: 0 },
      JSON.stringify(mode));
  }
  assert.equal(state.pendingResumeCheckpoints.standard.figureResult.unlabeledOverview, true);
  assert.equal(notifications.at(-1)?.[0], 'figure_checkpoint');

  const ordinaryEmpty = JSON.parse(JSON.stringify(payload));
  ordinaryEmpty.checkpointEnvelope.figureResult.unlabeledOverview = false;
  await assert.rejects(
    harness.apply(ordinaryEmpty),
    error => error?.code === 'FIGURE_CHECKPOINT_BINDING_INVALID'
  );
  figure.panelHints = ['A'];
  await assert.rejects(
    harness.apply(payload),
    error => error?.code === 'FIGURE_CHECKPOINT_BINDING_INVALID'
  );

  for (const forgedDepth of [undefined, 'standard-ish']) {
    const deepPayload = JSON.parse(JSON.stringify(payload));
    deepPayload.analysisDepth = 'deep';
    deepPayload.checkpointEnvelope.analysisDepth = 'deep';
    if (forgedDepth === undefined) {
      delete deepPayload.checkpointEnvelope.figureResult.analysisDepth;
    } else {
      deepPayload.checkpointEnvelope.figureResult.analysisDepth = forgedDepth;
    }
    await assert.rejects(
      harness.apply(deepPayload),
      error => error?.code === 'FIGURE_CHECKPOINT_BINDING_INVALID',
      `deep private transport rejects result depth ${String(forgedDepth)}`
    );
  }
});

test('private Figure checkpoint ACK waits for its inventory envelope to be durable', async () => {
  const figure = {
    figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A']
  };
  const state = { figure, pendingResults: {}, pendingResumeCheckpoints: {} };
  const durableWrites = [];
  let releaseDurableWrite;
  const durableWriteGate = new Promise(resolve => { releaseDurableWrite = resolve; });
  let autosaveCalls = 0;
  const dependencies = {
    initialState: state,
    sanitizeFigureProgressText: value => String(value || '').slice(0, 100),
    isCurrentFigureOperation: value => value === 'figure-operation-current',
    mergeCompletedFigureResultIntoWorkspaceDraft: async () => undefined,
    buildFigureWorkspaceSnapshot: () => ({
      schemaVersion: 1,
      figures: [{
        figureId: figure.figureId,
        pendingStandardCheckpointEnvelope:
          state.pendingResumeCheckpoints.standard || null
      }]
    }),
    persistFigureInventoryWithCas: async (content, options) => {
      durableWrites.push({
        path: 'figures/inventory.json', content: structuredClone(content), options
      });
      await durableWriteGate;
      return { saved: true, asset: { revision: 7 } };
    },
    scheduleArticleWorkspaceArtifactsSave: () => {
      autosaveCalls += 1;
      return new Promise(() => {});
    },
    notifyFigureWorkspaceStateChanged: () => undefined
  };
  const harness = Function(...Object.keys(dependencies), `
    let articleWorkspaceLifecycleGeneration = 31;
    let figurePartialCheckpointCommitTail = Promise.resolve();
    const figureWalkthroughState = new Map([['figure-1', initialState]]);
    ${contentFunctionSource('commitFigurePartialCheckpoint')}
    ${contentFunctionSource('applyPrivateFigureCheckpoint')}
    return { apply: applyPrivateFigureCheckpoint };
  `)(...Object.values(dependencies));
  const panelResult = {
    figureId: 'figure-1', analysisDepth: 'standard', basis: 'vision_text',
    panels: [{ panel: 'A', directObservation: 'A durable observation.' }]
  };
  const envelope = {
    version: 'figure-checkpoint-envelope-v1',
    figureId: 'figure-1', analysisDepth: 'standard',
    inputDigest: 'a'.repeat(64), routeDigest: 'b'.repeat(64),
    taskPolicyDigest: 'c'.repeat(64), planDigest: 'd'.repeat(64),
    immutableLimit: 48, inputMode: 'figure_image',
    visionFallback: false, fallbackReason: '',
    resultDigest: 'e'.repeat(64), bindingDigest: 'f'.repeat(64),
    figureResult: panelResult
  };
  let acknowledged = false;
  const pendingAck = harness.apply(JSON.parse(JSON.stringify({
    figureId: 'figure-1', operationId: 'figure-operation-current',
    workspaceLifecycle: 31,
    analysisDepth: 'standard', inputMode: 'figure_image',
    checkpointEnvelope: envelope
  }))).then(value => {
    acknowledged = true;
    return value;
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(durableWrites.length, 1,
    'the exact inventory checkpoint must enter its awaited durable writer');
  assert.equal(durableWrites[0].path, 'figures/inventory.json');
  assert.equal(durableWrites[0].options.figureId, 'figure-1');
  assert.equal(durableWrites[0].options.analysisDepth, 'standard');
  assert.equal(durableWrites[0].options.checkpointEnvelope.bindingDigest,
    envelope.bindingDigest);
  assert.deepEqual(
    durableWrites[0].content.figures[0].pendingStandardCheckpointEnvelope,
    envelope,
    'a crash after ACK must be able to restore the complete signed envelope'
  );
  assert.equal(acknowledged, false,
    'the private transport must not ACK while the durable write is pending');

  releaseDurableWrite();
  const receipt = await pendingAck;
  assert.deepEqual(receipt, { success: true, savedPanelCount: 1 });
  assert.equal(autosaveCalls, 1,
    'the broader best-effort autosave may run only after the exact write is durable');
});

test('external Figure checkpoint ACK waits for its supplemental CAS before inventory', async () => {
  const figure = {
    figureId: 'supp-figure-1', figureLabel: 'Supplemental Figure 1',
    panelHints: ['A'], sourceExternal: true, sourceMaterialId: 'supp-material-1'
  };
  const state = { figure, pendingResults: {}, pendingResumeCheckpoints: {} };
  const persistenceOrder = [];
  const dependencies = {
    initialState: state,
    sanitizeFigureProgressText: value => String(value || '').slice(0, 100),
    isCurrentFigureOperation: value => value === 'figure-operation-current',
    mergeCompletedFigureResultIntoWorkspaceDraft: async () => undefined,
    persistImportedSupplementalFigureState: async (_figure, suppliedState, options) => {
      persistenceOrder.push({ kind: 'supplemental', suppliedState, options });
      return { saved: true };
    },
    buildFigureWorkspaceSnapshot: () => ({
      schemaVersion: 1,
      figures: [{
        figureId: figure.figureId,
        pendingStandardCheckpointEnvelope:
          state.pendingResumeCheckpoints.standard || null
      }]
    }),
    persistFigureInventoryWithCas: async (content, options) => {
      persistenceOrder.push({
        kind: 'inventory', path: 'figures/inventory.json', content, options
      });
      return { saved: true };
    },
    scheduleArticleWorkspaceArtifactsSave: () => undefined,
    notifyFigureWorkspaceStateChanged: () => undefined
  };
  const harness = Function(...Object.keys(dependencies), `
    let articleWorkspaceLifecycleGeneration = 41;
    let figurePartialCheckpointCommitTail = Promise.resolve();
    const figureWalkthroughState = new Map([['supp-figure-1', initialState]]);
    ${contentFunctionSource('commitFigurePartialCheckpoint')}
    ${contentFunctionSource('applyPrivateFigureCheckpoint')}
    return { apply: applyPrivateFigureCheckpoint };
  `)(...Object.values(dependencies));
  const result = {
    figureId: figure.figureId, analysisDepth: 'standard', basis: 'vision_text',
    panels: [{ panel: 'A', directObservation: 'A durable observation.' }]
  };
  const envelope = {
    version: 'figure-checkpoint-envelope-v1',
    figureId: figure.figureId, analysisDepth: 'standard',
    inputDigest: 'a'.repeat(64), routeDigest: 'b'.repeat(64),
    taskPolicyDigest: 'c'.repeat(64), planDigest: 'd'.repeat(64),
    immutableLimit: 48, inputMode: 'figure_image', visionFallback: false,
    fallbackReason: '', resultDigest: 'e'.repeat(64),
    bindingDigest: 'f'.repeat(64), figureResult: result
  };
  await harness.apply(JSON.parse(JSON.stringify({
    figureId: figure.figureId, operationId: 'figure-operation-current',
    workspaceLifecycle: 41,
    analysisDepth: 'standard', inputMode: 'figure_image',
    checkpointEnvelope: envelope
  })));

  assert.deepEqual(persistenceOrder.map(item => item.kind), [
    'supplemental', 'inventory'
  ]);
  assert.deepEqual(persistenceOrder[0].options.stateFields, [
    'figureInputHash', 'pendingStandard'
  ]);
  assert.equal(
    persistenceOrder[1].content.figures[0]
      .pendingStandardCheckpointEnvelope.bindingDigest,
    envelope.bindingDigest
  );
});

test('supplemental PDF reader checkpoint ACK waits for parent-workspace CAS', async () => {
  const figure = {
    figureId: 'reader-figure-1', figureLabel: 'Supplemental Figure 1',
    panelHints: ['A'], sourceExternal: false
  };
  const state = { figure, pendingResults: {}, pendingResumeCheckpoints: {} };
  const persistenceOrder = [];
  let releaseParent;
  const parentGate = new Promise(resolve => { releaseParent = resolve; });
  let settled = false;
  let parentMutation = null;
  const dependencies = {
    initialState: state,
    supplementalPdfBinding: {
      materialId: 'supp-material-1', parentWorkspaceId: 'workspace-parent'
    },
    sanitizeFigureProgressText: value => String(value || '').slice(0, 100),
    isCurrentFigureOperation: value => value === 'figure-operation-current',
    mergeCompletedFigureResultIntoWorkspaceDraft: async () => undefined,
    persistImportedSupplementalFigureState: async () => {
      throw new Error('reader-local Figures must not use imported supplemental storage');
    },
    buildFigureWorkspaceSnapshot: () => ({
      schemaVersion: 1,
      figures: [{
        figureId: figure.figureId,
        pendingStandard: state.pendingResults.standard || null,
        pendingStandardCheckpointEnvelope:
          state.pendingResumeCheckpoints.standard || null
      }]
    }),
    persistFigureInventoryWithCas: async () => {
      persistenceOrder.push('reader-inventory');
      return { saved: true };
    },
    persistSupplementalFiguresToParentWorkspace: async (
      _inventory, _document, options
    ) => {
      persistenceOrder.push('parent-supplemental');
      parentMutation = options.checkpointMutation;
      await parentGate;
      return { saved: true };
    },
    scheduleArticleWorkspaceArtifactsSave: () => persistenceOrder.push('autosave'),
    notifyFigureWorkspaceStateChanged: () => undefined
  };
  const harness = Function(...Object.keys(dependencies), `
    let articleWorkspaceLifecycleGeneration = 51;
    let figurePartialCheckpointCommitTail = Promise.resolve();
    const figureWalkthroughState = new Map([['reader-figure-1', initialState]]);
    ${contentFunctionSource('commitFigurePartialCheckpoint')}
    ${contentFunctionSource('applyPrivateFigureCheckpoint')}
    return { apply: applyPrivateFigureCheckpoint };
  `)(...Object.values(dependencies));
  const result = {
    figureId: figure.figureId, analysisDepth: 'standard', basis: 'vision_text',
    panels: [{ panel: 'A', directObservation: 'A durable observation.' }]
  };
  const envelope = {
    version: 'figure-checkpoint-envelope-v1', figureId: figure.figureId,
    analysisDepth: 'standard', inputDigest: '1'.repeat(64),
    routeDigest: '2'.repeat(64), taskPolicyDigest: '3'.repeat(64),
    planDigest: '4'.repeat(64), immutableLimit: 48,
    inputMode: 'figure_image', visionFallback: false, fallbackReason: '',
    resultDigest: '5'.repeat(64), bindingDigest: '6'.repeat(64),
    figureResult: result
  };
  const pending = harness.apply(JSON.parse(JSON.stringify({
    figureId: figure.figureId, operationId: 'figure-operation-current',
    workspaceLifecycle: 51,
    analysisDepth: 'standard', inputMode: 'figure_image',
    checkpointEnvelope: envelope
  }))).then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(persistenceOrder, ['reader-inventory', 'parent-supplemental']);
  assert.equal(settled, false, 'ACK cannot precede parent-workspace durability');
  assert.equal(parentMutation.kind, 'upsert');
  assert.equal(parentMutation.checkpointEnvelope.bindingDigest, envelope.bindingDigest);
  releaseParent();
  assert.deepEqual(await pending, { success: true, savedPanelCount: 1 });
  assert.deepEqual(persistenceOrder, [
    'reader-inventory', 'parent-supplemental', 'autosave'
  ]);
});

test('external supplemental partial checkpoint persists its resume input identity', async () => {
  const sourceFigure = {
    figureId: 'supp-input-identity-1', sourceExternal: true,
    sourceMaterialId: 'material-input-identity-1', panelHints: ['A']
  };
  const checkpointEnvelope = {
    version: 'figure-checkpoint-envelope-v1',
    figureId: sourceFigure.figureId, analysisDepth: 'standard'
  };
  const state = {
    figure: sourceFigure,
    figureInputHash: 'supplemental-input-hash-v1',
    pendingResults: {
      standard: {
        figureId: sourceFigure.figureId, analysisDepth: 'standard',
        panels: [{ panel: 'A' }],
        operationId: 'figure-input-owner', workspaceLifecycle: 7
      }
    },
    pendingResumeCheckpoints: { standard: checkpointEnvelope }
  };
  let supplementalOptions = null;
  const dependencies = {
    initialState: state,
    isCurrentFigureOperation: value => value === 'figure-input-owner',
    mergeCompletedFigureResultIntoWorkspaceDraft: async () => undefined,
    persistImportedSupplementalFigureState: async (_figure, _state, options) => {
      supplementalOptions = structuredClone(options);
      return { saved: true };
    },
    buildFigureWorkspaceSnapshot: () => ({
      schemaVersion: 1,
      figures: [{
        ...sourceFigure,
        figureInputHash: state.figureInputHash,
        pendingStandard: state.pendingResults.standard,
        pendingStandardCheckpointEnvelope: checkpointEnvelope
      }]
    }),
    persistFigureInventoryWithCas: async () => ({ saved: true }),
    scheduleArticleWorkspaceArtifactsSave: () => undefined,
    notifyFigureWorkspaceStateChanged: () => undefined
  };
  const commit = Function(...Object.keys(dependencies), `
    let articleWorkspaceLifecycleGeneration = 7;
    let figurePartialCheckpointCommitTail = Promise.resolve();
    const figureWalkthroughState = new Map([
      ['supp-input-identity-1', initialState]
    ]);
    ${contentFunctionSource('commitFigurePartialCheckpoint')}
    return commitFigurePartialCheckpoint;
  `)(...Object.values(dependencies));

  await commit({
    figureId: sourceFigure.figureId,
    operationId: 'figure-input-owner',
    analysisDepth: 'standard',
    partialResult: state.pendingResults.standard
  });

  assert.deepEqual(supplementalOptions.stateFields, [
    'figureInputHash', 'pendingStandard'
  ]);
});

test('fresh supplemental state restores a source-ahead pending checkpoint', () => {
  const checkpointEnvelope = {
    version: 'figure-checkpoint-envelope-v1',
    figureId: 'supp-source-ahead-1', analysisDepth: 'standard'
  };
  const sourceFigure = {
    figureId: checkpointEnvelope.figureId,
    figureInputHash: 'source-ahead-input-hash',
    pendingStandard: {
      operationId: 'source-ahead-owner', workspaceLifecycle: 11
    },
    pendingStandardCheckpointEnvelope: checkpointEnvelope
  };
  const ensure = executableContentFunction('ensureFigureWalkthroughState', {
    SciLLM: FigureResultBinding,
    figureResultInputHashesFromSources: executableContentFunction('figureResultInputHashesFromSources', { SciLLM: FigureResultBinding }),
    figureWalkthroughState: new Map(),
    findFigureAnalysisTarget: () => sourceFigure,
    restoredFigureWorkspaceSnapshot: { figures: [] },
    normalizeFigurePanelFollowupCollections: () => ({
      panelFollowups: {}, panelFollowupHistories: {}
    }),
    panelFollowupOwnData: () => undefined,
    isUsableFigureAnalysisResult: () => false,
    cloneUserEditedFigureValue: value => structuredClone(value)
  });

  const state = ensure(sourceFigure.figureId);

  assert.deepEqual(state.pendingResults.standard, sourceFigure.pendingStandard);
  assert.deepEqual(
    state.pendingResumeCheckpoints.standard,
    checkpointEnvelope
  );
  assert.equal(state.figureInputHash, sourceFigure.figureInputHash);
});

test('checkpoint CAS rejects a new supplemental checkpoint on an older identity', async () => {
  let writes = 0;
  const durable = {
    revision: 4, contentHash: 'a'.repeat(64),
    content: {
      schemaVersion: 1,
      figures: [{
        figureId: 'supp-edit-crash-1', identityRevision: 1,
        caption: 'old caption', panelHints: ['A'], analysisStatus: 'draft'
      }]
    }
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async () => {
      writes += 1;
      return { saved: true };
    }
  });
  const envelope = {
    version: 'figure-checkpoint-envelope-v1',
    figureId: 'supp-edit-crash-1', analysisDepth: 'standard',
    inputDigest: '1'.repeat(64), routeDigest: '2'.repeat(64),
    taskPolicyDigest: '3'.repeat(64), planDigest: '4'.repeat(64),
    resultDigest: '5'.repeat(64), bindingDigest: '6'.repeat(64),
    immutableLimit: 48,
    figureResult: {
      figureId: 'supp-edit-crash-1', analysisDepth: 'standard',
      panels: [{ panel: 'B' }]
    }
  };
  const incoming = {
    schemaVersion: 1,
    figures: [{
      figureId: 'supp-edit-crash-1', identityRevision: 2,
      caption: 'new caption', panelHints: ['B'],
      pendingStandard: { operationId: 'new-owner', workspaceLifecycle: 12 },
      pendingStandardCheckpointEnvelope: envelope
    }]
  };

  await assert.rejects(
    persist(incoming, {
      figureId: envelope.figureId, analysisDepth: 'standard',
      checkpointEnvelope: envelope
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(writes, 0);
});

test('replica reconciliation CAS atomically replaces an expected Figure identity', async () => {
  const oldFigure = {
    figureId: 'supp-reconcile-cas-1', identityRevision: 1,
    caption: 'old caption', panelHints: ['A'], analysisStatus: 'draft'
  };
  const newFigure = {
    figureId: oldFigure.figureId, identityRevision: 2,
    caption: 'new caption', panelHints: ['B'], analysisStatus: 'draft'
  };
  let durable = {
    revision: 3, contentHash: '3'.repeat(64),
    content: { schemaVersion: 2, figures: [structuredClone(oldFigure)] }
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content) => {
      durable = {
        revision: durable.revision + 1,
        contentHash: String(durable.revision + 1).repeat(64).slice(0, 64),
        content: structuredClone(content)
      };
      return { saved: true };
    }
  });

  await persist({ schemaVersion: 2, figures: [newFigure] }, {
    figureId: newFigure.figureId,
    reconcileFigureReplica: true,
    expectedFigureReplica: oldFigure
  });

  assert.deepEqual(durable.content.figures, [newFigure]);
});

test('replica reconciliation CAS revives only a source newer than its tombstone predecessor', async () => {
  const tombstone = {
    figureId: 'supp-reconcile-revive-1', identityRevision: 100,
    predecessorIdentityRevision: 8,
    predecessorIdentityDigest: '8'.repeat(64),
    mutationId: 'figure-reconcile-revive-0001'
  };
  const newerSource = {
    figureId: tombstone.figureId, identityRevision: 9,
    caption: 'new source identity', panelHints: ['C'], analysisStatus: 'draft'
  };
  let durable = {
    revision: 5, contentHash: '5'.repeat(64),
    content: {
      schemaVersion: 2, figures: [], figureTombstones: [structuredClone(tombstone)]
    }
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content) => {
      durable = { revision: 6, contentHash: '6'.repeat(64), content };
      return { saved: true };
    }
  });

  await persist({ schemaVersion: 2, figures: [newerSource] }, {
    figureId: newerSource.figureId,
    reconcileFigureReplica: true,
    expectedFigureReplica: null,
    expectedFigureTombstone: tombstone
  });

  assert.deepEqual(durable.content.figures, [newerSource]);
  assert.deepEqual(durable.content.figureTombstones, []);
});

test('analysis-only replica CAS accepts a zero-revision reader identity without changing it', async () => {
  const fixture = supplementalReplicaFixture('reader-reconcile-cas-zero');
  const oldFigure = {
    ...fixture.identity, identityRevision: 0,
    sourceExternal: false, sourceTitle: 'reader local'
  };
  const nextFigure = {
    ...oldFigure,
    pendingStandard: fixture.pending,
    pendingStandardCheckpointEnvelope: fixture.envelope
  };
  let durable = {
    revision: 7, contentHash: '7'.repeat(64),
    content: { schemaVersion: 2, figures: [structuredClone(oldFigure)] }
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content) => {
      durable = { revision: 8, contentHash: '8'.repeat(64), content };
      return { saved: true };
    }
  });

  await persist({ schemaVersion: 2, figures: [nextFigure] }, {
    figureId: nextFigure.figureId,
    reconcileFigureReplica: true,
    reconcileFigureAnalysisOnly: true,
    expectedFigureReplica: oldFigure
  });

  assert.deepEqual(durable.content.figures, [nextFigure]);
  assert.equal(durable.content.figures[0].identityRevision, 0);
  assert.equal(durable.content.figures[0].sourceTitle, 'reader local');
});

test('an older captured autosave cannot overwrite a newly durable Figure envelope', async () => {
  const envelope = {
    version: 'figure-checkpoint-envelope-v1',
    figureId: 'figure-1', analysisDepth: 'standard',
    bindingDigest: 'a'.repeat(64),
    figureResult: { figureId: 'figure-1', panels: [{ panel: 'A' }] }
  };
  const oldInventory = {
    schemaVersion: 1,
    figures: [{ figureId: 'figure-1', pendingStandardCheckpointEnvelope: null }]
  };
  const liveInventory = {
    schemaVersion: 1,
    figures: [{
      figureId: 'figure-1', pendingStandardCheckpointEnvelope: envelope
    }]
  };
  let releaseOldAutosave;
  const oldAutosaveGate = new Promise(resolve => { releaseOldAutosave = resolve; });
  let persistedInventory = structuredClone(oldInventory);
  const writes = [];
  const lifecycle = { current: 31 };
  const dependencies = {
    articleWorkspaceLifecycleGeneration: lifecycle.current,
    assertCurrentArticleWorkspaceLifecycle: expected => {
      if (expected !== lifecycle.current) {
        const error = new Error('ARTICLE_WORKSPACE_LIFECYCLE_STALE');
        error.code = 'ARTICLE_WORKSPACE_LIFECYCLE_STALE';
        throw error;
      }
    },
    buildFigureWorkspaceSnapshot: () => liveInventory,
    captureArticleWorkspaceAssets: () => {
      throw new Error('the supplied stale capture must be used as the race fixture');
    },
    ensureCurrentArticleWorkspace: async () => ({ workspaceId: 'workspace-1' }),
    persistWorkspaceAssetCheckpoint: async (path, content) => {
      writes.push(path);
      if (path === 'article/structure.json') await oldAutosaveGate;
      return { saved: true };
    },
    persistFigureInventoryWithCas: async content => {
      writes.push('figures/inventory.json');
      persistedInventory = structuredClone(content);
      return { saved: true };
    },
    persistSupplementalFiguresToParentWorkspace: async () => ({ saved: true }),
    flushFigureWorkspaceDraftWithSingleRebase: async () => ({ success: true }),
    flushFigureWorkspaceDraft: async () => ({ success: true })
  };
  const persist = Function(...Object.keys(dependencies), `
    let articleWorkspaceSaveFrozen = false;
    const FIGURE_WORKSPACE_DRAFT_ASSET_PATH = 'figures/workspace-draft.json';
    const MECHANISM_CLEANUP_INTENTS_ASSET_PATH = 'mechanism/cleanup-intents.json';
    let supplementalPdfBinding = null;
    let supplementalParentSyncState = null;
    ${contentFunctionSource('persistArticleWorkspaceArtifacts')}
    return persistArticleWorkspaceArtifacts;
  `)(...Object.values(dependencies));
  const staleAssets = new Map([
    ['article/structure.json', { revision: 1 }],
    ['figures/inventory.json', structuredClone(oldInventory)]
  ]);
  const staleAutosave = persist({ assets: staleAssets });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, ['article/structure.json']);

  // This models the checkpoint's dedicated awaited write completing while the
  // earlier autosave is still blocked on a preceding asset.
  persistedInventory = structuredClone(liveInventory);
  releaseOldAutosave();
  await staleAutosave;
  assert.deepEqual(
    persistedInventory.figures[0].pendingStandardCheckpointEnvelope,
    envelope,
    'the stale loop must re-project Figure inventory immediately before its write'
  );
});

test('an older explicit save cannot overwrite a durable supplemental Figure envelope', async () => {
  const path = 'figures/supplemental/supp-material-1.json';
  const envelope = {
    version: 'figure-checkpoint-envelope-v1', figureId: 'supp-figure-1',
    analysisDepth: 'deep', bindingDigest: 'b'.repeat(64),
    figureResult: { figureId: 'supp-figure-1', panels: [{ panel: 'A' }] }
  };
  const staleAsset = {
    materialId: 'supp-material-1',
    figures: [{
      figureId: 'supp-figure-1', pendingDeepCheckpointEnvelope: null
    }]
  };
  const currentAsset = {
    materialId: 'supp-material-1',
    figures: [{
      figureId: 'supp-figure-1', pendingDeepCheckpointEnvelope: envelope
    }]
  };
  let releaseOldSave;
  const oldSaveGate = new Promise(resolve => { releaseOldSave = resolve; });
  let persistedAsset = structuredClone(staleAsset);
  const writes = [];
  const lifecycle = { current: 32 };
  const dependencies = {
    articleWorkspaceLifecycleGeneration: lifecycle.current,
    assertCurrentArticleWorkspaceLifecycle: expected => {
      if (expected !== lifecycle.current) {
        const error = new Error('ARTICLE_WORKSPACE_LIFECYCLE_STALE');
        error.code = 'ARTICLE_WORKSPACE_LIFECYCLE_STALE';
        throw error;
      }
    },
    supplementalFigureAssets: [currentAsset],
    SciLLM: {
      supplementalFigureAssetPath: materialId =>
        `figures/supplemental/${materialId}.json`
    },
    buildFigureWorkspaceSnapshot: () => ({ schemaVersion: 1, figures: [] }),
    captureArticleWorkspaceAssets: () => new Map(),
    ensureCurrentArticleWorkspace: async () => ({ workspaceId: 'workspace-1' }),
    persistWorkspaceAssetCheckpoint: async (relativePath, content) => {
      writes.push(relativePath);
      if (relativePath === 'article/structure.json') await oldSaveGate;
      return { saved: true };
    },
    persistFigureInventoryWithCas: async (content, options) => {
      writes.push(options.relativePath);
      if (options.relativePath === path) persistedAsset = structuredClone(content);
      return { saved: true };
    },
    persistSupplementalFiguresToParentWorkspace: async () => ({ saved: true }),
    flushFigureWorkspaceDraftWithSingleRebase: async () => ({ success: true }),
    flushFigureWorkspaceDraft: async () => ({ success: true })
  };
  const persist = Function(...Object.keys(dependencies), `
    let articleWorkspaceSaveFrozen = false;
    const FIGURE_WORKSPACE_DRAFT_ASSET_PATH = 'figures/workspace-draft.json';
    const MECHANISM_CLEANUP_INTENTS_ASSET_PATH = 'mechanism/cleanup-intents.json';
    let supplementalPdfBinding = null;
    let supplementalParentSyncState = null;
    ${contentFunctionSource('persistArticleWorkspaceArtifacts')}
    return persistArticleWorkspaceArtifacts;
  `)(...Object.values(dependencies));
  const oldSave = persist({ assets: new Map([
    ['article/structure.json', { revision: 1 }],
    [path, structuredClone(staleAsset)]
  ]) });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, ['article/structure.json']);

  // The supplemental CAS has committed currentAsset while the older explicit
  // workspace save is still blocked on its content phase.
  persistedAsset = structuredClone(currentAsset);
  releaseOldSave();
  await oldSave;
  assert.deepEqual(
    persistedAsset.figures[0].pendingDeepCheckpointEnvelope,
    envelope
  );
});

test('Figure inventory CAS preserves cross-context checkpoints and rejects ambiguity', async () => {
  const clone = value => structuredClone(value);
  const hex = value => value.repeat(64);
  function checkpointEnvelope(figureId, depth, panel, marker) {
    return {
      version: 'figure-checkpoint-envelope-v1',
      figureId,
      analysisDepth: depth,
      inputDigest: hex('1'), routeDigest: hex('2'),
      taskPolicyDigest: hex('3'), planDigest: hex('4'),
      immutableLimit: 48,
      inputMode: 'figure_image', visionFallback: false, fallbackReason: '',
      resultDigest: hex(marker), bindingDigest: hex(marker),
      figureResult: {
        figureId, analysisDepth: depth, basis: 'vision_text',
        panels: [{ panel, directObservation: `observation-${marker}` }]
      }
    };
  }
  function inventoryWith(figureId, depth, envelope, operationId) {
    const title = depth === 'standard' ? 'Standard' : 'Deep';
    return {
      schemaVersion: 1,
      figures: [{
        figureId,
        [`pending${title}`]: {
          ...clone(envelope.figureResult), operationId
        },
        [`pending${title}CheckpointEnvelope`]: clone(envelope)
      }]
    };
  }
  const emptyInventory = (...figureIds) => ({
    schemaVersion: 1,
    figures: figureIds.map(figureId => ({ figureId }))
  });
  let durable = {
    revision: 0,
    contentHash: hex('0'),
    content: {
      schemaVersion: 1,
      figures: [
        {
          figureId: 'figure-1',
          deep: { figureId: 'figure-1', marker: 'durable-deep' },
          manualEdits: { deep: { editedAt: 9, coreConclusion: 'kept' } }
        },
        {
          figureId: 'figure-2',
          panelFollowups: { A: { response: 'durable follow-up' } }
        },
        {
          figureId: 'figure-3',
          standard: { figureId: 'figure-3', marker: 'durable-only-figure' }
        }
      ]
    }
  };
  let saveCalls = 0;
  const dependencies = {
    getWorkspaceAssetCheckpoint: async () => clone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content, options) => {
      saveCalls += 1;
      if (options.expectedRevision !== durable.revision ||
          options.expectedContentHash !== durable.contentHash) {
        const error = new Error('ASSET_REVISION_CONFLICT');
        error.code = 'ASSET_REVISION_CONFLICT';
        throw error;
      }
      durable = {
        revision: durable.revision + 1,
        contentHash: String(durable.revision + 1).padStart(64, 'a').slice(-64),
        content: clone(content)
      };
      return { saved: true, asset: { revision: durable.revision } };
    }
  };
  const persist = executableContentFunction(
    'persistFigureInventoryWithCas', dependencies
  );
  const standard = checkpointEnvelope('figure-1', 'standard', 'A', 'a');
  const malformedDepth = clone(standard);
  delete malformedDepth.figureResult.analysisDepth;
  await assert.rejects(
    persist(inventoryWith(
      'figure-1', 'standard', malformedDepth, 'operation-standard-A'
    ), {
      figureId: 'figure-1', analysisDepth: 'standard',
      checkpointEnvelope: malformedDepth
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  await assert.rejects(
    persist(inventoryWith(
      'figure-1', 'standard', standard, 'operation-standard-A'
    ), {
      figureId: 'figure-1', checkpointEnvelope: standard
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(saveCalls, 0, 'malformed depth fails before durable writes');
  const firstIncoming = inventoryWith(
    'figure-1', 'standard', standard, 'operation-standard-A'
  );
  firstIncoming.figures[0].pendingDeep = { stale: true };
  firstIncoming.figures[0].pendingDeepCheckpointEnvelope = {
    version: 'untrusted-stale-envelope'
  };
  await persist(firstIncoming, {
    figureId: 'figure-1', analysisDepth: 'standard',
    checkpointEnvelope: standard
  });
  assert.equal(saveCalls, 1);
  assert.equal(durable.content.figures.find(item => item.figureId === 'figure-1')
    .deep.marker, 'durable-deep', 'target upsert touches only its pending pair');
  assert.equal(durable.content.figures.find(item => item.figureId === 'figure-1')
    .manualEdits.deep.coreConclusion, 'kept');
  assert.equal(durable.content.figures.find(item => item.figureId === 'figure-1')
    .pendingDeepCheckpointEnvelope, undefined,
  'target upsert cannot smuggle another depth pending pair');
  assert.equal(durable.content.figures.find(item => item.figureId === 'figure-2')
    .panelFollowups.A.response, 'durable follow-up');
  assert.equal(durable.content.figures.find(item => item.figureId === 'figure-3')
    .standard.marker, 'durable-only-figure');

  const fresh = checkpointEnvelope('figure-4', 'standard', 'D', 'd');
  const freshIncoming = inventoryWith(
    'figure-4', 'standard', fresh, 'operation-standard-D'
  );
  freshIncoming.figures[0].pendingDeep = { stale: true };
  freshIncoming.figures[0].pendingDeepCheckpointEnvelope = {
    version: 'untrusted-stale-envelope'
  };
  freshIncoming.figures[0].deep = { marker: 'stale-result' };
  await persist(freshIncoming, {
    figureId: 'figure-4', analysisDepth: 'standard', checkpointEnvelope: fresh
  });
  const created = durable.content.figures.find(item => item.figureId === 'figure-4');
  assert.equal(created.pendingStandardCheckpointEnvelope.bindingDigest,
    fresh.bindingDigest);
  assert.equal(created.pendingDeepCheckpointEnvelope, undefined);
  assert.equal(created.deep, undefined,
    'a newly created target is a minimal identity plus exact pending pair');

  // A second content realm captured this before the checkpoint ACK. Its later
  // generic save must merge the durable envelope rather than erase it.
  await persist(emptyInventory('figure-1', 'figure-2'));
  assert.deepEqual(
    durable.content.figures.find(item => item.figureId === 'figure-1')
      .pendingStandardCheckpointEnvelope,
    standard
  );
  assert.equal(durable.content.figures.find(item => item.figureId === 'figure-3')
    .standard.marker, 'durable-only-figure',
  'a stale generic inventory cannot delete an omitted durable Figure');

  const conflicting = checkpointEnvelope('figure-1', 'standard', 'A', 'b');
  const beforeConflict = clone(durable);
  const callsBeforeConflict = saveCalls;
  await assert.rejects(
    persist(inventoryWith(
      'figure-1', 'standard', conflicting, 'operation-standard-B'
    ), {
      figureId: 'figure-1', analysisDepth: 'standard',
      checkpointEnvelope: conflicting
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(saveCalls, callsBeforeConflict,
    'an equal-coverage conflicting result must fail before blind overwrite');
  assert.deepEqual(durable, beforeConflict);

  const deep = checkpointEnvelope('figure-2', 'deep', 'B', 'c');
  await persist(inventoryWith(
    'figure-2', 'deep', deep, 'operation-deep-C'
  ), {
    figureId: 'figure-2', analysisDepth: 'deep', checkpointEnvelope: deep
  });
  assert.deepEqual(
    durable.content.figures.find(item => item.figureId === 'figure-1')
      .pendingStandardCheckpointEnvelope,
    standard
  );
  assert.deepEqual(
    durable.content.figures.find(item => item.figureId === 'figure-2')
      .pendingDeepCheckpointEnvelope,
    deep,
    'a different Figure/depth checkpoint must merge without losing the first'
  );
});

test('concurrent Figure inventory CAS retries once and retains both checkpoints', async () => {
  const clone = value => structuredClone(value);
  const hex = value => value.repeat(64);
  const envelopeFor = (figureId, depth, marker) => ({
    version: 'figure-checkpoint-envelope-v1', figureId, analysisDepth: depth,
    inputDigest: hex('1'), routeDigest: hex('2'),
    taskPolicyDigest: hex('3'), planDigest: hex('4'), immutableLimit: 48,
    inputMode: 'figure_image', visionFallback: false, fallbackReason: '',
    resultDigest: hex(marker), bindingDigest: hex(marker),
    figureResult: {
      figureId, analysisDepth: depth, basis: 'vision_text',
      panels: [{ panel: marker.toUpperCase() }]
    }
  });
  const incoming = (envelope, operationId) => {
    const title = envelope.analysisDepth === 'standard' ? 'Standard' : 'Deep';
    return {
      schemaVersion: 1,
      figures: [{
        figureId: envelope.figureId,
        [`pending${title}`]: { ...clone(envelope.figureResult), operationId },
        [`pending${title}CheckpointEnvelope`]: clone(envelope)
      }]
    };
  };
  let durable = {
    revision: 0, contentHash: hex('0'),
    content: { schemaVersion: 1, figures: [
      { figureId: 'figure-1' }, { figureId: 'figure-2' }
    ] }
  };
  let initialReadCount = 0;
  let releaseInitialReads;
  const initialReadGate = new Promise(resolve => { releaseInitialReads = resolve; });
  let conflictCount = 0;
  const getParentAssetCheckpoint = async () => {
      const snapshot = clone(durable);
      if (snapshot.revision === 0 && initialReadCount < 2) {
        initialReadCount += 1;
        if (initialReadCount === 2) releaseInitialReads();
        await initialReadGate;
      }
      return snapshot;
    };
  const persistParentAssetCheckpoint = async (_path, content, options) => {
      if (options.expectedRevision !== durable.revision ||
          options.expectedContentHash !== durable.contentHash) {
        conflictCount += 1;
        const error = new Error('ASSET_REVISION_CONFLICT');
        error.code = 'ASSET_REVISION_CONFLICT';
        throw error;
      }
      durable = {
        revision: durable.revision + 1,
        contentHash: String(durable.revision + 1).padStart(64, 'd').slice(-64),
        content: clone(content)
      };
      return { saved: true };
    };
  // Independent factories model two content worlds sharing the same durable asset.
  const createPersist = () => executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => {
      throw new Error('parent CAS must use its injected reader');
    },
    persistWorkspaceAssetCheckpoint: async () => {
      throw new Error('parent CAS must use its injected writer');
    }
  });
  const persistA = createPersist();
  const persistB = createPersist();
  const standard = envelopeFor('figure-1', 'standard', 'a');
  const deep = envelopeFor('figure-2', 'deep', 'b');
  await Promise.all([
    persistA(incoming(standard, 'operation-A'), {
      relativePath: 'figures/supplemental/supp-material.json',
      figureId: 'figure-1', analysisDepth: 'standard', checkpointEnvelope: standard,
      getAssetCheckpoint: getParentAssetCheckpoint,
      persistAssetCheckpoint: persistParentAssetCheckpoint
    }),
    persistB(incoming(deep, 'operation-B'), {
      relativePath: 'figures/supplemental/supp-material.json',
      figureId: 'figure-2', analysisDepth: 'deep', checkpointEnvelope: deep,
      getAssetCheckpoint: getParentAssetCheckpoint,
      persistAssetCheckpoint: persistParentAssetCheckpoint
    })
  ]);
  assert.equal(conflictCount, 1, 'only the losing writer retries');
  assert.ok(durable.content.figures.find(item => item.figureId === 'figure-1')
    .pendingStandardCheckpointEnvelope);
  assert.ok(durable.content.figures.find(item => item.figureId === 'figure-2')
    .pendingDeepCheckpointEnvelope);
  const parentSyncSource = contentFunctionSource(
    'persistSupplementalFiguresToParentWorkspace'
  );
  assert.match(parentSyncSource, /persistFigureInventoryWithCas\(content/u);
  assert.match(parentSyncSource, /getAssetCheckpoint:\s*getParentAssetCheckpoint/u);
  assert.match(parentSyncSource, /persistAssetCheckpoint:\s*persistParentAssetCheckpoint/u);
});

test('stale supplemental reader sync cannot erase another reader completed Figure', async () => {
  const clone = value => structuredClone(value);
  const complete = (figureId, marker) => ({
    figureId, analysisDepth: 'standard', panels: [{ panel: 'A' }],
    figureQuestion: `Question ${marker}`, coreConclusion: `Conclusion ${marker}`
  });
  let durable = {
    revision: 4, contentHash: 'a'.repeat(64),
    content: {
      schemaVersion: 2, analyzedFigureCount: 1, analysisStatus: 'partial', figures: [
      {
        figureId: 'figure-1', standard: complete('figure-1', 'A'),
        figureInputHash: 'durable-input-A', activeDepth: 'standard',
        analysisStatus: 'complete', standardError: ''
      },
      { figureId: 'figure-2', standard: null }
      ]
    }
  };
  const read = async () => clone(durable);
  const write = async (_path, content, options) => {
    assert.equal(options.expectedRevision, durable.revision);
    assert.equal(options.expectedContentHash, durable.contentHash);
    durable = {
      revision: durable.revision + 1,
      contentHash: String(durable.revision + 1).padStart(64, 'b').slice(-64),
      content: clone(content)
    };
    return { saved: true };
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: read,
    persistWorkspaceAssetCheckpoint: write
  });
  await persist({
    schemaVersion: 2, analyzedFigureCount: 1, analysisStatus: 'partial', figures: [
    {
      figureId: 'figure-1', standard: null,
      figureInputHash: 'stale-input-A', activeDepth: 'deep',
      analysisStatus: 'draft', standardError: 'stale error'
    },
    {
      figureId: 'figure-2', standard: complete('figure-2', 'B'),
      figureInputHash: 'durable-input-B', activeDepth: 'standard',
      analysisStatus: 'complete'
    }
    ]
  });
  await persist({
    schemaVersion: 2, analyzedFigureCount: 1, analysisStatus: 'partial', figures: [
    {
      figureId: 'figure-1', standard: complete('figure-1', 'A'),
      figureInputHash: 'durable-input-A', activeDepth: 'standard',
      analysisStatus: 'complete'
    },
    {
      figureId: 'figure-2', standard: null,
      figureInputHash: 'stale-input-B', activeDepth: 'deep',
      analysisStatus: 'draft'
    }
    ]
  });
  assert.equal(durable.content.figures.find(item => item.figureId === 'figure-1')
    .standard.coreConclusion, 'Conclusion A');
  assert.equal(durable.content.figures.find(item => item.figureId === 'figure-2')
    .standard.coreConclusion, 'Conclusion B');
  assert.equal(durable.content.figures.find(item => item.figureId === 'figure-1')
    .figureInputHash, 'durable-input-A');
  assert.equal(durable.content.figures.find(item => item.figureId === 'figure-2')
    .figureInputHash, 'durable-input-B');
  assert.equal(durable.content.figures.find(item => item.figureId === 'figure-2')
    .activeDepth, 'standard');
  assert.equal(durable.content.figures.find(item => item.figureId === 'figure-2')
    .analysisStatus, 'complete');
  assert.equal(durable.content.analyzedFigureCount, 2);
  assert.equal(durable.content.analysisStatus, 'complete');
});

test('Figure inventory identity generations and deletion tombstones reject stale reader revival', async () => {
  const clone = value => structuredClone(value);
  let durable = {
    revision: 8, contentHash: '8'.repeat(64),
    content: {
      schemaVersion: 2,
      figureTombstones: [{
        figureId: 'deleted-figure', identityRevision: 4,
        mutationId: 'figure-mutation-delete-44444444'
      }],
      figures: [{
        figureId: 'figure-1', identityRevision: 3,
        caption: 'new durable caption', panelHints: ['B'],
        figureInputHash: 'new-input',
        standard: {
          figureId: 'figure-1', analysisDepth: 'standard',
          figureQuestion: 'New question', coreConclusion: 'New conclusion',
          panels: [{ panel: 'B' }]
        },
        analysisStatus: 'complete'
      }]
    }
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => clone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content, options) => {
      assert.equal(options.expectedRevision, durable.revision);
      assert.equal(options.expectedContentHash, durable.contentHash);
      durable = {
        revision: durable.revision + 1,
        contentHash: String(durable.revision + 1).padStart(64, '9').slice(-64),
        content: clone(content)
      };
      return { saved: true };
    }
  });
  await persist({
    schemaVersion: 2,
    figures: [
      {
        figureId: 'figure-1', identityRevision: 2,
        caption: 'stale old caption', panelHints: ['A'],
        figureInputHash: 'stale-input', analysisStatus: 'draft'
      },
      {
        figureId: 'deleted-figure', identityRevision: 3,
        caption: 'stale deleted caption', panelHints: ['A']
      }
    ]
  });
  const kept = durable.content.figures.find(figure => figure.figureId === 'figure-1');
  assert.equal(kept.identityRevision, 3);
  assert.equal(kept.caption, 'new durable caption');
  assert.deepEqual(kept.panelHints, ['B']);
  assert.equal(kept.figureInputHash, 'new-input');
  assert.equal(durable.content.figures.some(figure =>
    figure.figureId === 'deleted-figure'), false,
  'a lower-generation stale reader cannot revive a durable deletion tombstone');

  await persist({
    schemaVersion: 2,
    figures: [{
      figureId: 'figure-1', identityRevision: 4,
      caption: 'explicitly changed identity', panelHints: ['C'],
      figureInputHash: 'result-for-prior-identity',
      standard: {
        figureId: 'figure-1', analysisDepth: 'standard',
        figureQuestion: 'Stale question', coreConclusion: 'Stale conclusion',
        panels: [{ panel: 'B' }]
      },
      pendingDeep: { operationId: 'stale-operation' }
    }, {
      figureId: 'deleted-figure', identityRevision: 999,
      caption: 'forged resurrection above tombstone', panelHints: ['Z']
    }]
  });
  const advanced = durable.content.figures.find(figure => figure.figureId === 'figure-1');
  assert.equal(advanced.identityRevision, 4);
  assert.equal(advanced.caption, 'explicitly changed identity');
  for (const field of ['figureInputHash', 'standard', 'pendingDeep']) {
    assert.equal(advanced[field], undefined,
      `higher-generation identity changes cannot carry stale ${field}`);
  }
  assert.equal(durable.content.figures.some(figure =>
    figure.figureId === 'deleted-figure'), false,
  'generic input cannot resurrect a tombstoned ID even with a forged higher revision');
});

test('Figure CAS admits one absent identity instead of acknowledging a zero-write no-op', async () => {
  let writes = 0;
  let durable = {
    revision: 1, contentHash: 'a'.repeat(64),
    content: { schemaVersion: 2, figures: [] }
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content) => {
      writes += 1;
      durable = {
        revision: 2, contentHash: 'b'.repeat(64), content: structuredClone(content)
      };
      return { saved: true };
    }
  });
  const receipt = await persist({
    schemaVersion: 2,
    figures: [{
      figureId: 'supp-admit-1', identityRevision: 1,
      caption: 'new source identity', panelHints: ['A'],
      standard: { stale: true }, pendingDeep: { operationId: 'stale' }
    }]
  }, {
    figureId: 'supp-admit-1', resetFigureAnalysis: true,
    admitFigureIdentity: true
  });
  assert.equal(receipt.saved, true);
  assert.equal(receipt.noOp, undefined);
  assert.equal(writes, 1);
  assert.deepEqual(durable.content.figures, [{
    figureId: 'supp-admit-1', identityRevision: 1,
    caption: 'new source identity', panelHints: ['A'],
    analysisStatus: 'draft', activeDepth: 'deep', humanReviewed: false
  }]);
});

test('a higher Figure identity revision cannot inherit a prior identity checkpoint owner', async () => {
  const digest = marker => marker.repeat(64);
  const oldEnvelope = {
    version: 'figure-checkpoint-envelope-v1', figureId: 'supp-revision-1',
    analysisDepth: 'standard', implementationVersion: 'figure-v1',
    inputDigest: digest('1'), routeDigest: digest('2'),
    taskPolicyDigest: digest('3'), planDigest: digest('4'),
    resultDigest: digest('5'), bindingDigest: digest('6'), immutableLimit: 48,
    operationPlan: [{ figureId: 'supp-revision-1', panelCount: 1 }],
    inputMode: 'caption_context', visionFallback: false, fallbackReason: '',
    figureResult: {
      figureId: 'supp-revision-1', analysisDepth: 'standard',
      basis: 'caption_context', panels: [{ panel: 'A' }]
    }
  };
  let durable = {
    revision: 1, contentHash: digest('a'), content: {
      schemaVersion: 2, figures: [{
        figureId: 'supp-revision-1', identityRevision: 1,
        caption: 'old identity', panelHints: ['A'],
        pendingStandard: {
          ...structuredClone(oldEnvelope.figureResult), operationId: 'old-operation'
        },
        pendingStandardCheckpointEnvelope: oldEnvelope
      }]
    }
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content) => {
      durable = {
        revision: 2, contentHash: digest('b'), content: structuredClone(content)
      };
      return { saved: true };
    }
  });
  await persist({
    schemaVersion: 2, figures: [{
      figureId: 'supp-revision-1', identityRevision: 2,
      caption: 'new identity', panelHints: ['B']
    }]
  });
  const advanced = durable.content.figures[0];
  assert.equal(advanced.identityRevision, 2);
  assert.equal(advanced.caption, 'new identity');
  assert.equal(advanced.pendingStandard, undefined);
  assert.equal(advanced.pendingStandardCheckpointEnvelope, undefined);
});

test('generic stale tombstones cannot delete a newer durable Figure identity', async () => {
  let durable = {
    revision: 1, contentHash: 'a'.repeat(64), content: {
      schemaVersion: 2, figures: [{
        figureId: 'supp-live-1', identityRevision: 100,
        caption: 'authoritative live identity', panelHints: ['A']
      }], figureTombstones: []
    }
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content) => {
      durable = {
        revision: 2, contentHash: 'b'.repeat(64), content: structuredClone(content)
      };
      return { saved: true };
    }
  });
  await persist({
    schemaVersion: 2, figures: [], figureTombstones: [{
      figureId: 'supp-live-1', identityRevision: 1,
      mutationId: 'figure-delete-stale-11111111'
    }]
  });
  assert.equal(durable.content.figures.length, 1);
  assert.equal(durable.content.figures[0].caption, 'authoritative live identity');
  assert.deepEqual(durable.content.figureTombstones, []);

  const expectedIdentity = structuredClone(durable.content.figures[0]);
  const authoritativeTombstone = {
    figureId: 'supp-live-1', identityRevision: 101,
    mutationId: 'figure-delete-authoritative-11111111',
    predecessorIdentityRevision: 100,
    predecessorIdentityDigest: 'd'.repeat(64)
  };
  await persist({
    schemaVersion: 2, figures: [],
    figureTombstones: [authoritativeTombstone]
  }, {
    figureId: 'supp-live-1', deleteFigureIdentity: true,
    expectedFigureIdentity: expectedIdentity
  });
  assert.deepEqual(durable.content.figures, []);
  assert.deepEqual(durable.content.figureTombstones, [authoritativeTombstone]);
});

test('Figure CAS preserves the 129th Figure instead of silently truncating it', async () => {
  let durable = {
    revision: 1, contentHash: 'a'.repeat(64),
    content: { schemaVersion: 2, figures: [] }
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content) => {
      durable = {
        revision: 2, contentHash: 'b'.repeat(64), content: structuredClone(content)
      };
      return { saved: true };
    }
  });
  await persist({
    schemaVersion: 2,
    figures: Array.from({ length: 129 }, (_, index) => ({
      figureId: `supp-many-${index + 1}`, identityRevision: 1,
      caption: `Figure ${index + 1}`
    }))
  });
  assert.equal(durable.content.figures.length, 129);
  assert.equal(durable.content.figures.at(-1).figureId, 'supp-many-129');
});

test('Figure CAS rejects a 301st merged Figure without bricking the durable inventory', async () => {
  let writes = 0;
  const figures = Array.from({ length: 300 }, (_, index) => ({
    figureId: `supp-cap-${index + 1}`, identityRevision: 1
  }));
  const durable = {
    revision: 1, contentHash: 'a'.repeat(64),
    content: { schemaVersion: 2, figures: structuredClone(figures) }
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async () => {
      writes += 1;
      return { saved: true };
    }
  });
  await assert.rejects(persist({
    schemaVersion: 2,
    figures: [{ figureId: 'supp-cap-301', identityRevision: 1 }]
  }), error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT');
  assert.equal(writes, 0);
  assert.equal(durable.content.figures.length, 300);
  assert.equal(durable.content.figures.at(-1).figureId, 'supp-cap-300');
});

test('Figure CAS fails closed instead of erasing a malformed durable Figure', async () => {
  let writes = 0;
  const durable = {
    revision: 1, contentHash: 'a'.repeat(64),
    content: { schemaVersion: 2, figures: [{ figureId: 'valid-1' }, null] }
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async () => {
      writes += 1;
      return { saved: true };
    }
  });
  await assert.rejects(persist({
    schemaVersion: 2, figures: [{ figureId: 'unrelated-2' }]
  }), error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT');
  assert.equal(writes, 0);
  assert.equal(durable.content.figures.length, 2);
  assert.equal(durable.content.figures[1], null);
});

test('Figure CAS accepts only a missing legacy identity revision and rejects explicit malformed revisions', async () => {
  const malformed = ['1', -1, Number.MAX_SAFE_INTEGER + 1];
  for (const side of ['durable', 'incoming']) {
    for (const invalidRevision of malformed) {
      let writes = 0;
      const durableFigure = { figureId: 'figure-revision-1' };
      const incomingFigure = { figureId: 'figure-revision-1' };
      if (side === 'durable') durableFigure.identityRevision = invalidRevision;
      if (side === 'incoming') incomingFigure.identityRevision = invalidRevision;
      const durable = {
        revision: 1, contentHash: 'a'.repeat(64),
        content: { schemaVersion: 2, figures: [durableFigure] }
      };
      const persist = executableContentFunction('persistFigureInventoryWithCas', {
        getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
        persistWorkspaceAssetCheckpoint: async () => {
          writes += 1;
          return { saved: true };
        }
      });
      await assert.rejects(persist({
        schemaVersion: 2, figures: [incomingFigure]
      }), error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT',
      `${side} identityRevision ${String(invalidRevision)} must fail closed`);
      assert.equal(writes, 0);
    }
  }

  let legacyWrites = 0;
  const legacyDurable = {
    revision: 1, contentHash: 'b'.repeat(64),
    content: { schemaVersion: 2, figures: [{ figureId: 'legacy-figure-1' }] }
  };
  const persistLegacy = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(legacyDurable),
    persistWorkspaceAssetCheckpoint: async () => {
      legacyWrites += 1;
      return { saved: true };
    }
  });
  await persistLegacy({
    schemaVersion: 2, figures: [{ figureId: 'legacy-figure-1' }]
  });
  assert.equal(legacyWrites, 1);
});

test('Figure inventory checkpoint clear is explicit, compare-bound, and not revivable', async () => {
  const clone = value => structuredClone(value);
  const hex = value => value.repeat(64);
  const envelope = marker => ({
    version: 'figure-checkpoint-envelope-v1', figureId: 'figure-1',
    analysisDepth: 'standard', inputDigest: hex('1'), routeDigest: hex('2'),
    taskPolicyDigest: hex('3'), planDigest: hex('4'), immutableLimit: 48,
    operationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
    inputMode: 'figure_image', visionFallback: false, fallbackReason: '',
    resultDigest: hex(marker), bindingDigest: hex(marker),
    figureResult: {
      figureId: 'figure-1', analysisDepth: 'standard', basis: 'vision_text',
      panels: [{ panel: 'A' }],
      figureQuestion: 'What does this Figure establish?',
      coreConclusion: 'A complete result is durable.',
      panelCoverage: { missingPanels: [], unresolvedPanels: [] }
    }
  });
  const pendingInventory = (checkpoint, operationId) => ({
    schemaVersion: 1,
    figures: [{
      figureId: 'figure-1',
      pendingStandard: {
        ...clone(checkpoint.figureResult), operationId
      },
      pendingStandardCheckpointEnvelope: clone(checkpoint)
    }]
  });
  const completedInventory = operationId => ({
    schemaVersion: 1,
    figures: [{
      figureId: 'figure-1',
      standard: {
        figureId: 'figure-1', analysisDepth: 'standard',
        basis: 'vision_text', panels: [{ panel: 'A' }], operationId,
        figureQuestion: 'What does this Figure establish?',
        coreConclusion: 'A complete result is durable.',
        panelCoverage: { missingPanels: [], unresolvedPanels: [] },
        inputMode: 'figure_image', visionFallback: false, fallbackReason: '', cacheHit: false
      }
    }]
  });
  const first = envelope('a');
  let durable = {
    revision: 1, contentHash: hex('5'),
    content: pendingInventory(first, 'operation-A')
  };
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => clone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content, options) => {
      assert.equal(options.expectedRevision, durable.revision);
      assert.equal(options.expectedContentHash, durable.contentHash);
      durable = {
        revision: durable.revision + 1,
        contentHash: String(durable.revision + 1).padStart(64, 'e').slice(-64),
        content: clone(content)
      };
      return { saved: true };
    }
  });

  await persist(completedInventory('operation-A'));
  assert.deepEqual(
    durable.content.figures[0].pendingStandardCheckpointEnvelope,
    first,
    'ordinary autosave cannot infer authority to clear a durable slot'
  );
  await assert.rejects(
    persist({ schemaVersion: 1, figures: [{ figureId: 'figure-1' }] }, {
      figureId: 'figure-1', analysisDepth: 'standard',
      clearCheckpointEnvelope: first, operationId: 'operation-A'
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.ok(durable.content.figures[0].pendingStandardCheckpointEnvelope,
    'compare-bound clear also requires an atomic completed depth result');
  await assert.rejects(
    persist(completedInventory('operation-B'), {
      figureId: 'figure-1', analysisDepth: 'standard',
      clearCheckpointEnvelope: first, operationId: 'operation-A'
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.ok(durable.content.figures[0].pendingStandardCheckpointEnvelope,
    'a completed result from another operation cannot clear the pending owner');
  const alteredClearEnvelope = clone(first);
  alteredClearEnvelope.operationPlan = [
    { figureId: 'figure-1', panelCount: 1 },
    { figureId: 'figure-forged', panelCount: 0 }
  ];
  const writesBeforeAlteredClear = durable.revision;
  await assert.rejects(
    persist(completedInventory('operation-A'), {
      figureId: 'figure-1', analysisDepth: 'standard',
      clearCheckpointEnvelope: alteredClearEnvelope,
      operationId: 'operation-A'
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(durable.revision, writesBeforeAlteredClear,
    'same digests cannot authorize clearing with an altered full envelope');
  assert.ok(durable.content.figures[0].pendingStandardCheckpointEnvelope);
  for (const patch of [
    { inputMode: 'caption_context' }, { visionFallback: true },
    { fallbackReason: 'provider_rejected_pixels' }, { cacheHit: 'true' },
    { coreConclusion: 'Forged conclusion' }, { extraClaim: 'Forged extra field' }
  ]) {
    const forged = completedInventory('operation-A');
    Object.assign(forged.figures[0].standard, patch);
    await assert.rejects(persist(forged, {
      figureId: 'figure-1', analysisDepth: 'standard',
      clearCheckpointEnvelope: first, operationId: 'operation-A'
    }), error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT');
  }
  await persist(completedInventory('operation-A'), {
    figureId: 'figure-1', analysisDepth: 'standard',
    clearCheckpointEnvelope: first, operationId: 'operation-A'
  });
  assert.equal(
    durable.content.figures[0].pendingStandardCheckpointEnvelope,
    undefined
  );

  const afterFirstClear = clone(durable);
  await persist(completedInventory('operation-A'), {
    figureId: 'figure-1', analysisDepth: 'standard',
    clearCheckpointEnvelope: first, operationId: 'operation-A'
  });
  assert.deepEqual(durable.content, afterFirstClear.content,
    'an exact post-clear replay is an idempotent completed-result no-op');

  await persist(pendingInventory(first, 'operation-A'));
  assert.equal(durable.content.figures[0].pendingStandardCheckpointEnvelope,
    undefined, 'a stale generic save cannot resurrect a compare-cleared slot');

  const newer = envelope('b');
  durable = {
    revision: durable.revision + 1, contentHash: hex('6'),
    content: pendingInventory(newer, 'operation-B')
  };
  const beforeStaleClear = clone(durable);
  await assert.rejects(
    persist(completedInventory('operation-A'), {
      figureId: 'figure-1', analysisDepth: 'standard',
      clearCheckpointEnvelope: first, operationId: 'operation-A'
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.deepEqual(durable, beforeStaleClear,
    'a stale completion cannot clear a newer context checkpoint');

  durable = {
    revision: durable.revision + 1, contentHash: hex('7'),
    content: completedInventory('operation-B')
  };
  const newerCompletion = clone(durable);
  await assert.rejects(
    persist(completedInventory('operation-A'), {
      figureId: 'figure-1', analysisDepth: 'standard',
      clearCheckpointEnvelope: first, operationId: 'operation-A'
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.deepEqual(durable, newerCompletion,
    'an old clear cannot overwrite a newer completion after its slot was cleared');

  const partial = envelope('c');
  partial.operationPlan[0].panelCount = 2;
  partial.figureResult.panels[0].directObservation = 'signed-A';
  delete partial.figureResult.figureQuestion;
  delete partial.figureResult.coreConclusion;
  delete partial.figureResult.panelCoverage;
  const completedFromPartial = operationId => ({
    schemaVersion: 1,
    figures: [{
      figureId: 'figure-1',
      standard: {
        figureId: 'figure-1', analysisDepth: 'standard', basis: 'vision_text',
        panels: [
          { panel: 'A', directObservation: 'signed-A' },
          { panel: 'B', directObservation: 'recovered-B' }
        ],
        operationId,
        figureQuestion: 'What does the completed Figure establish?',
        coreConclusion: 'Both Panels now support the conclusion.',
        panelCoverage: { missingPanels: [], unresolvedPanels: [] }
      }
    }]
  });
  durable = {
    revision: durable.revision + 1, contentHash: hex('8'),
    content: pendingInventory(partial, 'operation-retry')
  };
  const tamperedUpgrade = completedFromPartial('operation-retry');
  tamperedUpgrade.figures[0].standard.panels[0].directObservation = 'changed-A';
  await assert.rejects(
    persist(tamperedUpgrade, {
      figureId: 'figure-1', analysisDepth: 'standard',
      clearCheckpointEnvelope: partial, operationId: 'operation-retry'
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.ok(durable.content.figures[0].pendingStandardCheckpointEnvelope,
    'a retry cannot rewrite an already signed Panel while clearing');
  await persist(completedFromPartial('operation-retry'), {
    figureId: 'figure-1', analysisDepth: 'standard',
    clearCheckpointEnvelope: partial, operationId: 'operation-retry'
  });
  assert.equal(durable.content.figures[0].pendingStandardCheckpointEnvelope,
    undefined, 'a signed partial may advance to a complete plan-bound result');
  assert.equal(durable.content.figures[0].standard.panels.length, 2);
});

test('Figure checkpoint slot advances partial records to synthesis without regression', async () => {
  const clone = value => structuredClone(value);
  const hex = value => value.repeat(64);
  const panelA = { panel: 'A', directObservation: 'stable-A' };
  const panelB = { panel: 'B', directObservation: 'stable-B' };
  const envelope = (marker, panels, complete = false) => ({
    version: 'figure-checkpoint-envelope-v1', figureId: 'figure-1',
    analysisDepth: 'deep', inputDigest: hex('1'), routeDigest: hex('2'),
    taskPolicyDigest: hex('3'), planDigest: hex('4'), immutableLimit: 48,
    operationPlan: [{ figureId: 'figure-1', panelCount: 2 }],
    inputMode: 'figure_image', visionFallback: false, fallbackReason: '',
    resultDigest: hex(marker), bindingDigest: hex(marker),
    figureResult: {
      figureId: 'figure-1', analysisDepth: 'deep', basis: 'vision_text',
      panels: clone(panels),
      ...(complete ? {
        figureQuestion: 'What does this Figure establish?',
        coreConclusion: 'The complete synthesis.',
        argumentChain: [{ established: 'A then B.' }],
        panelCoverage: { missingPanels: [], unresolvedPanels: [] }
      } : {})
    }
  });
  const inventory = (checkpoint, operationId = 'operation-A') => ({
    schemaVersion: 1,
    figures: [{
      figureId: 'figure-1',
      pendingDeep: { ...clone(checkpoint.figureResult), operationId },
      pendingDeepCheckpointEnvelope: clone(checkpoint)
    }]
  });
  let durable = {
    revision: 0, contentHash: hex('0'),
    content: { schemaVersion: 1, figures: [{ figureId: 'figure-1' }] }
  };
  let writes = 0;
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => clone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content, options) => {
      if (options.expectedRevision !== durable.revision ||
          options.expectedContentHash !== durable.contentHash) {
        const error = new Error('ASSET_REVISION_CONFLICT');
        error.code = 'ASSET_REVISION_CONFLICT';
        throw error;
      }
      writes += 1;
      durable = {
        revision: durable.revision + 1,
        contentHash: String(durable.revision + 1).padStart(64, '7').slice(-64),
        content: clone(content)
      };
      return { saved: true };
    }
  });
  const partialA = envelope('a', [panelA]);
  const partialAB = envelope('b', [panelA, panelB]);
  const completeAB = envelope('c', [panelA, panelB], true);
  await persist(inventory(partialA, 'operation-A'), {
    figureId: 'figure-1', analysisDepth: 'deep', checkpointEnvelope: partialA
  });
  const alteredExact = clone(partialA);
  alteredExact.operationPlan = [
    { figureId: 'figure-1', panelCount: 2 },
    { figureId: 'figure-forged', panelCount: 0 }
  ];
  const writesBeforeAlteredExact = writes;
  await assert.rejects(
    persist(inventory(alteredExact, 'operation-A'), {
      figureId: 'figure-1', analysisDepth: 'deep',
      checkpointEnvelope: alteredExact
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(writes, writesBeforeAlteredExact,
    'same digest fields do not make an altered envelope an exact replay');
  const alteredAdvance = clone(partialAB);
  alteredAdvance.inputMode = 'caption_context';
  alteredAdvance.visionFallback = true;
  alteredAdvance.fallbackReason = 'provider_rejected_pixels';
  await assert.rejects(
    persist(inventory(alteredAdvance, 'operation-B'), {
      figureId: 'figure-1', analysisDepth: 'deep',
      checkpointEnvelope: alteredAdvance
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(writes, writesBeforeAlteredExact,
    'rank advance cannot change stable modality metadata');
  await persist(inventory(partialAB, 'operation-B'), {
    figureId: 'figure-1', analysisDepth: 'deep', checkpointEnvelope: partialAB
  });
  assert.equal(durable.content.figures[0].pendingDeep.operationId, 'operation-B',
    'a strict Panel superset transfers the slot to the resumed operation');
  await persist(inventory(partialA), {
    figureId: 'figure-1', analysisDepth: 'deep', checkpointEnvelope: partialA
  });
  assert.equal(
    durable.content.figures[0].pendingDeepCheckpointEnvelope.bindingDigest,
    partialAB.bindingDigest,
    'a late strict subset adopts the already durable Panel superset'
  );
  await persist(inventory(completeAB, 'operation-C'), {
    figureId: 'figure-1', analysisDepth: 'deep', checkpointEnvelope: completeAB
  });
  assert.equal(
    durable.content.figures[0].pendingDeepCheckpointEnvelope.bindingDigest,
    completeAB.bindingDigest,
    'same-panel synthesis is a valid partial-to-complete rank advance'
  );
  assert.equal(durable.content.figures[0].pendingDeep.operationId, 'operation-C',
    'a complete synthesis transfers the slot to the completing operation');

  await persist(inventory(partialAB), {
    figureId: 'figure-1', analysisDepth: 'deep',
    checkpointEnvelope: partialAB
  });
  assert.equal(
    durable.content.figures[0].pendingDeepCheckpointEnvelope.bindingDigest,
    completeAB.bindingDigest,
    'a late partial checkpoint cannot downgrade a complete synthesis'
  );

  await persist(inventory(completeAB, 'operation-D'), {
    figureId: 'figure-1', analysisDepth: 'deep', checkpointEnvelope: completeAB
  });
  assert.equal(durable.content.figures[0].pendingDeep.operationId, 'operation-C',
    'an exact replay preserves the durable owner instead of rebinding it');

  const conflictingComplete = envelope('d', [panelA, panelB], true);
  const beforeConflict = clone(durable);
  const writesBeforeConflict = writes;
  await assert.rejects(
    persist(inventory(conflictingComplete, 'operation-B'), {
      figureId: 'figure-1', analysisDepth: 'deep',
      checkpointEnvelope: conflictingComplete
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(writes, writesBeforeConflict);
  assert.deepEqual(durable, beforeConflict);

  durable = {
    revision: durable.revision + 1, contentHash: hex('8'),
    content: inventory(partialA)
  };
  const changedPanelA = envelope('e', [
    { panel: 'A', directObservation: 'silently changed-A' }, panelB
  ]);
  await assert.rejects(
    persist(inventory(changedPanelA), {
      figureId: 'figure-1', analysisDepth: 'deep',
      checkpointEnvelope: changedPanelA
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
});

test('Figure checkpoint discard is explicit compare-bound and idempotent', async () => {
  const clone = value => structuredClone(value);
  const checkpoint = {
    version: 'figure-checkpoint-envelope-v1', figureId: 'figure-1',
    analysisDepth: 'standard', inputDigest: '1'.repeat(64),
    routeDigest: '2'.repeat(64), taskPolicyDigest: '3'.repeat(64),
    planDigest: '4'.repeat(64), immutableLimit: 48,
    operationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
    inputMode: 'figure_image', visionFallback: false, fallbackReason: '',
    resultDigest: '5'.repeat(64), bindingDigest: '6'.repeat(64),
    figureResult: {
      figureId: 'figure-1', analysisDepth: 'standard', basis: 'vision_text',
      panels: [{ panel: 'A', directObservation: 'signed-A' }]
    }
  };
  const pending = {
    schemaVersion: 1,
    figures: [{
      figureId: 'figure-1', caption: 'old input',
      pendingStandard: { ...clone(checkpoint.figureResult), operationId: 'operation-A' },
      pendingStandardCheckpointEnvelope: clone(checkpoint)
    }]
  };
  let durable = {
    revision: 1, contentHash: '7'.repeat(64), content: clone(pending)
  };
  let writes = 0;
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => clone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content) => {
      writes += 1;
      durable = {
        revision: durable.revision + 1,
        contentHash: String(durable.revision + 1).padStart(64, '8').slice(-64),
        content: clone(content)
      };
      return { saved: true };
    }
  });
  await assert.rejects(
    persist(pending, {
      figureId: 'figure-1', analysisDepth: 'standard',
      discardCheckpointEnvelope: checkpoint,
      pendingOperationId: 'operation-B'
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(writes, 0);
  const alteredCheckpoint = clone(checkpoint);
  alteredCheckpoint.fallbackReason = 'tampered-but-digests-unchanged';
  await assert.rejects(
    persist(pending, {
      figureId: 'figure-1', analysisDepth: 'standard',
      discardCheckpointEnvelope: alteredCheckpoint,
      pendingOperationId: 'operation-A'
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(writes, 0,
    'discard compares the complete canonical envelope, not only its digests');
  await persist(pending, {
    figureId: 'figure-1', analysisDepth: 'standard',
    discardCheckpointEnvelope: checkpoint,
    pendingOperationId: 'operation-A'
  });
  assert.equal(durable.content.figures[0].pendingStandard, undefined);
  assert.equal(durable.content.figures[0].pendingStandardCheckpointEnvelope, undefined);

  const afterDiscard = clone(durable.content);
  await persist(pending, {
    figureId: 'figure-1', analysisDepth: 'standard',
    discardCheckpointEnvelope: checkpoint,
    pendingOperationId: 'operation-A'
  });
  assert.deepEqual(durable.content, afterDiscard,
    'an exact discard replay is an idempotent no-op');
  await persist(pending);
  assert.equal(durable.content.figures[0].pendingStandardCheckpointEnvelope,
    undefined, 'a generic stale save cannot revive a discarded slot');

  durable = {
    revision: durable.revision + 1,
    contentHash: '9'.repeat(64),
    content: { schemaVersion: 1, figures: [] }
  };
  await persist(pending, {
    figureId: 'figure-1', analysisDepth: 'standard',
    discardCheckpointEnvelope: checkpoint,
    pendingOperationId: 'operation-A'
  });
  assert.deepEqual(durable.content.figures, [],
    'an idempotent discard cannot recreate a deleted Figure');
});

test('Figure checkpoint discard requires durable cancellation before any asset write', async () => {
  const envelope = {
    version: 'figure-checkpoint-envelope-v1', figureId: 'figure-1',
    analysisDepth: 'standard'
  };
  async function exercise(cancelled) {
    const state = {
      figure: { figureId: 'figure-1', sourceExternal: false },
      pendingResults: {
        standard: {
          operationId: 'figure-old-operation', workspaceLifecycle: 17
        }
      },
      pendingResumeCheckpoints: { standard: envelope }
    };
    const order = [];
    const dependencies = {
      initialState: state,
      chrome: { runtime: { sendMessage: async message => {
        order.push(['cancel', structuredClone(message)]);
        return { success: true, data: { cancelled } };
      } } },
      buildFigureWorkspaceSnapshot: () => ({
        schemaVersion: 1, figures: [{ figureId: 'figure-1' }]
      }),
      persistFigureInventoryWithCas: async (_inventory, options) => {
        order.push(['inventory', structuredClone(options)]);
        return { saved: true };
      },
      persistImportedSupplementalFigureState: async () => {
        throw new Error('main Figure must not use supplemental storage');
      },
      persistSupplementalFiguresToParentWorkspace: async () => {
        throw new Error('ordinary page must not use parent supplemental storage');
      }
    };
    const discard = Function(...Object.keys(dependencies), `
      let supplementalPdfBinding = null;
      ${contentFunctionSource('confirmFigureCheckpointOperationCancelled')}
      ${contentFunctionSource('discardFigureResumeCheckpoint')}
      return discardFigureResumeCheckpoint;
    `)(...Object.values(dependencies));
    const pending = discard(state, 'standard');
    if (!cancelled) {
      await assert.rejects(pending,
        error => error?.code === 'FIGURE_CHECKPOINT_DISCARD_UNCONFIRMED');
      assert.equal(order.length, 1, 'unconfirmed cancel forbids every asset write');
      assert.ok(state.pendingResumeCheckpoints.standard);
      return;
    }
    assert.deepEqual(await pending, { saved: true, checkpointDiscarded: true });
    assert.deepEqual(order.map(item => item[0]), ['cancel', 'inventory']);
    assert.deepEqual(order[0][1], {
      type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
      operationId: 'figure-old-operation', workspaceLifecycle: 17,
      command: 'cancel'
    });
    assert.deepEqual(order[1][1].discardCheckpointEnvelope, envelope);
    assert.equal(state.pendingResumeCheckpoints.standard, undefined);
    assert.equal(state.pendingResults.standard, undefined);
  }
  await exercise(false);
  await exercise(true);
});

test('Figure checkpoint CAS conflict exhaustion is bounded and cannot ACK', async () => {
  const hex = value => value.repeat(64);
  const checkpoint = {
    version: 'figure-checkpoint-envelope-v1', figureId: 'figure-1',
    analysisDepth: 'standard', inputDigest: hex('1'), routeDigest: hex('2'),
    taskPolicyDigest: hex('3'), planDigest: hex('4'), immutableLimit: 48,
    inputMode: 'figure_image', visionFallback: false, fallbackReason: '',
    resultDigest: hex('a'), bindingDigest: hex('a'),
    figureResult: {
      figureId: 'figure-1', analysisDepth: 'standard', basis: 'vision_text',
      panels: [{ panel: 'A' }]
    }
  };
  const inventory = {
    schemaVersion: 1,
    figures: [{
      figureId: 'figure-1',
      pendingStandard: { ...checkpoint.figureResult, operationId: 'operation-A' },
      pendingStandardCheckpointEnvelope: checkpoint
    }]
  };
  let loads = 0;
  let writes = 0;
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => {
      loads += 1;
      return {
        revision: loads, contentHash: String(loads).repeat(64).slice(0, 64),
        content: { schemaVersion: 1, figures: [{ figureId: 'figure-1' }] }
      };
    },
    persistWorkspaceAssetCheckpoint: async () => {
      writes += 1;
      const error = new Error('ASSET_REVISION_CONFLICT');
      error.code = 'ASSET_REVISION_CONFLICT';
      throw error;
    }
  });
  await assert.rejects(
    persist(inventory, {
      figureId: 'figure-1', analysisDepth: 'standard',
      checkpointEnvelope: checkpoint
    }),
    error => error?.code === 'ASSET_REVISION_CONFLICT'
  );
  assert.equal(loads, 2, 'initial read plus exactly one bounded rebase');
  assert.equal(writes, 2, 'no third blind force attempt is permitted');
});

test('supplemental Figure edit invalidates both pending depths before a new checkpoint', async () => {
  const clear = executableContentFunction('clearImportedSupplementalAnalysis');
  const oldEnvelope = marker => ({
    version: 'figure-checkpoint-envelope-v1', figureId: 'supp-figure-1',
    analysisDepth: marker === 'a' ? 'standard' : 'deep',
    inputDigest: marker.repeat(64), routeDigest: '2'.repeat(64),
    taskPolicyDigest: '3'.repeat(64), planDigest: '4'.repeat(64),
    immutableLimit: 48, inputMode: 'caption_context', visionFallback: false,
    fallbackReason: '', resultDigest: '5'.repeat(64),
    bindingDigest: '6'.repeat(64),
    figureResult: {
      figureId: 'supp-figure-1',
      analysisDepth: marker === 'a' ? 'standard' : 'deep',
      basis: 'caption_context', panels: [{ panel: 'A' }]
    }
  });
  const edited = {
    figureId: 'supp-figure-1', caption: 'old caption',
    pendingStandard: { operationId: 'old-standard', workspaceLifecycle: 11 },
    pendingStandardCheckpointEnvelope: oldEnvelope('a'),
    pendingDeep: { operationId: 'old-deep', workspaceLifecycle: 11 },
    pendingDeepCheckpointEnvelope: oldEnvelope('b'),
    standard: { stale: true }, deep: { stale: true }
  };
  const invalidationOrder = [];
  const checkpointBindings = executableContentFunction(
    'importedSupplementalFigureCheckpointBindings'
  );
  const confirmOwners = executableContentFunction(
    'confirmImportedSupplementalFigureCheckpointOwners', {
      importedSupplementalFigureCheckpointBindings: checkpointBindings,
      confirmFigureCheckpointOperationCancelled: async (...args) => {
        invalidationOrder.push(['cancel', ...args]);
      }
    }
  );
  const discardProjection = executableContentFunction(
    'discardImportedSupplementalFigureCheckpoints', {
      confirmImportedSupplementalFigureCheckpointOwners: confirmOwners,
      persistFigureInventoryWithCas: async (_content, options) => {
        invalidationOrder.push(['discard', options.analysisDepth]);
        return { saved: true };
      }
    }
  );
  await discardProjection(edited);
  assert.deepEqual(invalidationOrder.map(item => item[0]), [
    'cancel', 'cancel', 'discard', 'discard'
  ], 'all durable owners are cancelled before any projection is discarded');
  clear(edited);
  for (const field of [
    'pendingStandard', 'pendingStandardCheckpointEnvelope',
    'pendingDeep', 'pendingDeepCheckpointEnvelope', 'standard', 'deep'
  ]) assert.equal(edited[field], undefined, field);

  const resetProjection = executableContentFunction(
    'resetImportedSupplementalFigureInventoryProjection', {
      persistFigureInventoryWithCas: async (_content, options) => {
        assert.equal(options.resetFigureAnalysis, true);
        return { saved: true };
      }
    }
  );
  assert.equal((await resetProjection(edited)).saved, true);

  const next = oldEnvelope('a');
  next.inputDigest = '7'.repeat(64);
  next.resultDigest = '8'.repeat(64);
  next.bindingDigest = '9'.repeat(64);
  let durable = {
    revision: 1, contentHash: '0'.repeat(64),
    content: {
      schemaVersion: 1,
      figures: [{
        ...structuredClone(edited),
        caption: 'concurrent durable caption',
        panelHints: ['A', 'B'],
        figureInputHash: 'old-input-hash',
        standard: { stale: true }, modelStandard: { stale: true },
        manualEdits: { standard: { coreConclusion: 'stale edit' } },
        panelAnalyses: { A: { directObservation: 'stale Panel' } },
        analysisStatus: 'complete'
      }]
    }
  };
  let writes = 0;
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content) => {
      writes += 1;
      durable = { revision: 2, contentHash: '1'.repeat(64), content };
      return { saved: true };
    }
  });
  await persist({
    schemaVersion: 1,
    figures: [{ ...structuredClone(edited), caption: 'new caption' }]
  }, {
    figureId: 'supp-figure-1', resetFigureAnalysis: true,
    expectedFigureInputHash: 'old-input-hash'
  });
  const reset = durable.content.figures[0];
  assert.equal(reset.caption, 'concurrent durable caption',
    'reset preserves the fresh durable identity instead of copying stale input');
  assert.deepEqual(reset.panelHints, ['A', 'B']);
  for (const field of [
    'standard', 'modelStandard', 'manualEdits', 'panelAnalyses'
  ]) assert.equal(reset[field], undefined, `inventory reset clears ${field}`);
  assert.equal(reset.analysisStatus, 'draft');

  const preReplacementIdentity = structuredClone(reset);
  await persist({
    schemaVersion: 1,
    figures: [{
      ...structuredClone(reset), caption: 'new source caption', panelHints: ['C']
    }]
  }, {
    figureId: 'supp-figure-1', resetFigureAnalysis: true,
    replaceFigureIdentity: true,
    expectedFigureIdentity: preReplacementIdentity
  });
  assert.equal(durable.content.figures[0].caption, 'new source caption');
  assert.deepEqual(durable.content.figures[0].panelHints, ['C']);

  const staleExpectedIdentity = structuredClone(durable.content.figures[0]);
  durable = {
    ...durable,
    revision: durable.revision + 1,
    contentHash: 'f'.repeat(64),
    content: structuredClone(durable.content)
  };
  durable.content.figures[0].caption = 'newer concurrent source caption';
  const writesBeforeStaleReplacement = writes;
  await assert.rejects(
    persist({
      schemaVersion: 1,
      figures: [{ ...staleExpectedIdentity, caption: 'stale retry caption' }]
    }, {
      figureId: 'supp-figure-1', resetFigureAnalysis: true,
      replaceFigureIdentity: true,
      expectedFigureIdentity: staleExpectedIdentity
    }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(writes, writesBeforeStaleReplacement);
  assert.equal(durable.content.figures[0].caption,
    'newer concurrent source caption');

  durable = {
    revision: durable.revision + 1, contentHash: '2'.repeat(64),
    content: { schemaVersion: 1, figures: [] }
  };
  await persist({
    schemaVersion: 1,
    figures: [{ ...structuredClone(edited), caption: 'deleted stale Figure' }]
  }, {
    figureId: 'supp-figure-1', resetFigureAnalysis: true
  });
  assert.deepEqual(durable.content.figures, [],
    'reset cannot resurrect a target deleted by another context');

  durable = {
    revision: durable.revision + 1, contentHash: '3'.repeat(64),
    content: {
      schemaVersion: 1,
      figures: [{
        ...structuredClone(edited), caption: 'new source caption',
        figureInputHash: undefined, analysisStatus: 'draft'
      }]
    }
  };
  await persist({
    schemaVersion: 1,
    figures: [{
      ...structuredClone(edited),
      pendingStandard: { ...next.figureResult, operationId: 'new-operation' },
      pendingStandardCheckpointEnvelope: next
    }]
  }, {
    figureId: 'supp-figure-1', analysisDepth: 'standard',
    checkpointEnvelope: next
  });
  assert.equal(writes, 3);
  assert.equal(durable.content.figures[0]
    .pendingStandardCheckpointEnvelope.inputDigest, next.inputDigest);
});

test('explicit supplemental mutation classifies pre-envelope pending state as a legacy orphan', () => {
  const bindings = executableContentFunction(
    'importedSupplementalFigureCheckpointBindings'
  );
  const legacy = bindings({
    figureId: 'supp-legacy-1',
    pendingStandard: { operationId: 'legacy-operation-without-durable-ledger' }
  });
  assert.deepEqual(legacy, [{
    figureId: 'supp-legacy-1', depth: 'standard', envelope: null,
    pendingOperationId: 'legacy-operation-without-durable-ledger',
    pendingWorkspaceLifecycle: null, legacyOrphan: true
  }]);
  for (const workspaceLifecycle of [null, 0]) {
    assert.deepEqual(bindings({
      figureId: 'supp-legacy-1',
      pendingStandard: {
        operationId: 'legacy-operation-without-durable-ledger',
        workspaceLifecycle
      }
    }), legacy, `legacy lifecycle ${workspaceLifecycle} must remain safely migratable`);
  }
  assert.throws(() => bindings({
    figureId: 'supp-corrupt-1',
    pendingStandard: { operationId: 'modern-but-corrupt', workspaceLifecycle: 3 },
    pendingStandardCheckpointEnvelope: { version: 'corrupt' }
  }), error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT');
});

test('supplemental edit with no projection cancels source owners before one explicit identity admission', async () => {
  const sourceFigure = {
    figureId: 'supp-edit-1', figureLabel: 'Figure S1', figureKind: 'supplemental',
    isSupplemental: true, caption: 'old caption', panelHints: ['A'],
    sourceMode: 'caption', identityRevision: 0,
    pendingStandard: { operationId: 'legacy-source-owner' }
  };
  const supplementalFigureAssets = [{ materialId: 'material-1', figures: [sourceFigure] }];
  const order = [];
  let updatedFigure = null;
  const clearImportedSupplementalAnalysis = executableContentFunction(
    'clearImportedSupplementalAnalysis'
  );
  const update = executableContentFunction('updateImportedSupplementalFigureDraft', {
    SciLLM: {
      extractPanelHints: () => ['B'],
      splitFigureCaptionByPanelGroups: () => [{ panels: ['B'] }],
      normalizeManualFigureKind: () => 'supplemental',
      canonicalManualFigureLabel: () => 'Figure S1'
    },
    assertCurrentSupplementalImportTarget: () => ({ workspace: { workspaceId: 'ws-1' } }),
    refreshSupplementalFigureAssets: async () => supplementalFigureAssets,
    supplementalFigureAssets,
    supplementalAssetFigureMatch: (figure, target) => figure.figureId === target.figureId,
    getImportedSupplementalFigureInventoryProjection: async () => null,
    confirmImportedSupplementalFigureCheckpointOwners: async (...figures) => {
      order.push('cancel-all');
      assert.equal(figures[0], sourceFigure);
      assert.equal(figures[1], null);
      return [];
    },
    articleWorkspaceAssetFingerprint: value => JSON.stringify(value),
    mutateImportedSupplementalFigure: async (_request, mutation, options) => {
      order.push('source-write');
      assert.equal(options.expectedFigureFingerprint, JSON.stringify(sourceFigure));
      const asset = { figures: [structuredClone(sourceFigure)] };
      const outcome = await mutation(asset, 0);
      updatedFigure = asset.figures[0];
      return { ...outcome, directoryPersisted: true };
    },
    persistFigureInventoryWithCas: async (content, options) => {
      order.push('inventory-admit');
      assert.deepEqual(content.figures, [updatedFigure]);
      assert.equal(options.reconcileFigureReplica, true);
      assert.equal(options.expectedFigureReplica, null);
      return { saved: true, content: { schemaVersion: 2, figures: [updatedFigure] } };
    },
    clearImportedSupplementalAnalysis,
    figureWalkthroughState: new Map(), figureProgressById: new Map(),
    notifyFigureWorkspaceStateChanged: () => undefined
  });
  const result = await update({
    target: {}, figureId: 'supp-edit-1', caption: 'new caption', sourcePage: 1
  });
  assert.equal(result.success, true);
  assert.deepEqual(order, ['cancel-all', 'source-write', 'inventory-admit']);
  assert.equal(updatedFigure.identityRevision, 1);
  assert.equal(updatedFigure.caption, 'new caption');
  assert.deepEqual(updatedFigure.panelHints, ['B']);
  assert.equal(updatedFigure.pendingStandard, undefined);
});

test('supplemental edit commits source identity before inventory reconciliation', async () => {
  const sourceFigure = {
    figureId: 'supp-edit-ordered-1', figureLabel: 'Figure S1',
    figureKind: 'supplemental', isSupplemental: true,
    caption: 'old caption', panelHints: ['A'], sourceMode: 'caption',
    identityRevision: 4,
    pendingStandard: { operationId: 'old-owner', workspaceLifecycle: 9 },
    pendingStandardCheckpointEnvelope: supplementalReplicaFixture(
      'supp-edit-ordered-1'
    ).envelope
  };
  const projection = structuredClone(sourceFigure);
  const assets = [{ materialId: 'material-edit-ordered', figures: [sourceFigure] }];
  const order = [];
  let sourceAfterEdit = null;
  const update = executableContentFunction('updateImportedSupplementalFigureDraft', {
    SciLLM: {
      extractPanelHints: () => ['B'],
      splitFigureCaptionByPanelGroups: () => [{ panels: ['B'] }],
      normalizeManualFigureKind: () => 'supplemental',
      canonicalManualFigureLabel: () => 'Figure S1'
    },
    assertCurrentSupplementalImportTarget: () => ({ workspace: { workspaceId: 'ws' } }),
    refreshSupplementalFigureAssets: async () => assets,
    supplementalFigureAssets: assets,
    supplementalAssetFigureMatch: (figure, target) => figure.figureId === target.figureId,
    getImportedSupplementalFigureInventoryProjection: async () => projection,
    confirmImportedSupplementalFigureCheckpointOwners: async () => {
      order.push('cancel-all');
      return [];
    },
    articleWorkspaceAssetFingerprint: value => JSON.stringify(value),
    mutateImportedSupplementalFigure: async (_request, mutation, options) => {
      assert.equal(options.skipRefresh, true);
      order.push('source-write');
      const asset = { figures: [structuredClone(sourceFigure)] };
      const result = await mutation(asset, 0);
      sourceAfterEdit = asset.figures[0];
      return { ...result, directoryPersisted: true };
    },
    persistFigureInventoryWithCas: async (content, options) => {
      order.push('inventory-reconcile');
      assert.deepEqual(content.figures, [sourceAfterEdit]);
      assert.equal(options.reconcileFigureReplica, true);
      assert.deepEqual(options.expectedFigureReplica, projection);
      return { saved: true, content: { schemaVersion: 2, figures: [sourceAfterEdit] } };
    },
    clearImportedSupplementalAnalysis: executableContentFunction(
      'clearImportedSupplementalAnalysis'
    ),
    figureWalkthroughState: new Map(), figureProgressById: new Map(),
    notifyFigureWorkspaceStateChanged: () => undefined
  });

  const result = await update({
    target: {}, figureId: sourceFigure.figureId,
    caption: 'new caption', sourcePage: 1
  });

  assert.equal(result.success, true);
  assert.deepEqual(order, ['cancel-all', 'source-write', 'inventory-reconcile']);
  assert.equal(sourceAfterEdit.identityRevision, 5);
  assert.equal(sourceAfterEdit.caption, 'new caption');
  assert.equal(sourceAfterEdit.pendingStandard, undefined);
});

test('failed supplemental source edit leaves the inventory checkpoint intact', async () => {
  const fixture = supplementalReplicaFixture('supp-edit-source-fail');
  const sourceFigure = structuredClone(fixture.partial);
  const projection = structuredClone(fixture.partial);
  const assets = [{ materialId: 'material-edit-fail', figures: [sourceFigure] }];
  let inventoryWrites = 0;
  const update = executableContentFunction('updateImportedSupplementalFigureDraft', {
    SciLLM: {},
    assertCurrentSupplementalImportTarget: () => ({ workspace: { workspaceId: 'ws' } }),
    refreshSupplementalFigureAssets: async () => assets,
    supplementalFigureAssets: assets,
    supplementalAssetFigureMatch: (figure, target) => figure.figureId === target.figureId,
    getImportedSupplementalFigureInventoryProjection: async () => projection,
    confirmImportedSupplementalFigureCheckpointOwners: async () => [],
    articleWorkspaceAssetFingerprint: value => JSON.stringify(value),
    mutateImportedSupplementalFigure: async () => {
      const error = new Error('SIMULATED_SOURCE_WRITE_CRASH');
      error.code = 'SIMULATED_SOURCE_WRITE_CRASH';
      throw error;
    },
    persistFigureInventoryWithCas: async () => {
      inventoryWrites += 1;
      return { saved: true };
    },
    clearImportedSupplementalAnalysis: executableContentFunction(
      'clearImportedSupplementalAnalysis'
    ),
    figureWalkthroughState: new Map(), figureProgressById: new Map(),
    notifyFigureWorkspaceStateChanged: () => undefined
  });

  await assert.rejects(update({
    target: {}, figureId: sourceFigure.figureId,
    caption: 'new caption', sourcePage: 1
  }), error => error?.code === 'SIMULATED_SOURCE_WRITE_CRASH');
  assert.equal(inventoryWrites, 0);
  assert.deepEqual(projection, fixture.partial);
});

test('fresh reconciliation completes an edit crash from the newer source identity', async () => {
  const pair = executableContentFunction('reconcileSupplementalFigureReplicaPair');
  const reconcile = executableContentFunction(
    'reconcileSupplementalFigureAssetReplicas',
    { reconcileSupplementalFigureReplicaPair: pair }
  );
  const fixture = supplementalReplicaFixture('supp-edit-crash-recover');
  const oldInventoryFigure = {
    ...structuredClone(fixture.partial), identityRevision: 4,
    caption: 'old caption', panelHints: ['A']
  };
  const newSourceFigure = {
    ...structuredClone(fixture.identity), identityRevision: 5,
    caption: 'new caption', panelHints: ['B'], analysisStatus: 'draft'
  };
  for (const field of [
    'standard', 'modelStandard', 'deep', 'modelDeep',
    'pendingStandard', 'pendingStandardCheckpointEnvelope',
    'pendingDeep', 'pendingDeepCheckpointEnvelope'
  ]) delete newSourceFigure[field];
  let inventory = { schemaVersion: 2, figures: [oldInventoryFigure] };
  const result = await reconcile({
    schemaVersion: 2, materialId: 'material-edit-crash',
    figures: [newSourceFigure]
  }, inventory, {
    persistSource: async () => assert.fail('newer source must not be overwritten'),
    persistInventory: async ({ figure, expectedFigure }) => {
      assert.deepEqual(expectedFigure, oldInventoryFigure);
      inventory = { ...inventory, figures: [structuredClone(figure)] };
      return { saved: true, content: structuredClone(inventory) };
    }
  });
  assert.deepEqual(result.asset.figures, [newSourceFigure]);
  assert.deepEqual(result.inventory.figures, [newSourceFigure]);
  assert.equal(result.inventory.figures[0].pendingStandard, undefined);
});

test('supplemental delete durably tombstones the inventory before removing the source Figure', async () => {
  const sourceFigure = {
    figureId: 'supp-delete-1', figureLabel: 'Figure S2', identityRevision: 6,
    pendingDeep: { operationId: 'legacy-delete-owner' }
  };
  const projection = { ...structuredClone(sourceFigure), identityRevision: 7 };
  const supplementalFigureAssets = [{ materialId: 'material-2', figures: [sourceFigure] }];
  const order = [];
  let inventoryTombstone = null;
  let sourceAsset = null;
  const remove = executableContentFunction('deleteImportedSupplementalFigure', {
    assertCurrentSupplementalImportTarget: () => ({ workspace: { workspaceId: 'ws-1' } }),
    refreshSupplementalFigureAssets: async () => supplementalFigureAssets,
    supplementalFigureAssets,
    supplementalAssetFigureMatch: (figure, target) => figure.figureId === target.figureId,
    getImportedSupplementalFigureInventoryProjection: async () => projection,
    confirmImportedSupplementalFigureCheckpointOwners: async (...figures) => {
      order.push('cancel-all');
      assert.deepEqual(figures, [sourceFigure, projection]);
      return [];
    },
    articleWorkspaceAssetFingerprint: value => JSON.stringify(value),
    createFigureOperationId: () => 'figure-88888888-8888-4888-8888-888888888888',
    persistFigureInventoryWithCas: async content => {
      order.push('inventory-tombstone');
      inventoryTombstone = structuredClone(content.figureTombstones[0]);
      return { saved: true };
    },
    mutateImportedSupplementalFigure: async (_request, mutation, options) => {
      order.push('source-delete');
      assert.equal(options.expectedFigureFingerprint, JSON.stringify(sourceFigure));
      sourceAsset = { figures: [structuredClone(sourceFigure)] };
      return mutation(sourceAsset, 0);
    },
    figureWalkthroughState: new Map(), figureProgressById: new Map(),
    notifyFigureWorkspaceStateChanged: () => undefined
  });
  const result = await remove({ target: {}, figureId: 'supp-delete-1' });
  assert.equal(result.deleted, true);
  assert.deepEqual(order, ['cancel-all', 'inventory-tombstone', 'source-delete']);
  assert.equal(sourceAsset.figures.length, 0);
  assert.deepEqual(sourceAsset.figureTombstones, [inventoryTombstone]);
  assert.equal(inventoryTombstone.figureId, 'supp-delete-1');
  assert.ok(inventoryTombstone.identityRevision > 7);
});

test('supplemental delete reuses an inventory tombstone after a crash before source deletion', async () => {
  const sourceFigure = {
    figureId: 'supp-delete-retry', figureLabel: 'Figure S8', identityRevision: 8
  };
  const sourceAsset = {
    materialId: 'material-delete-retry', figures: [structuredClone(sourceFigure)],
    figureTombstones: []
  };
  let projectedFigure = structuredClone(sourceFigure);
  let inventoryTombstone = null;
  let createCalls = 0;
  let sourceMutationCalls = 0;
  const remove = executableContentFunction('deleteImportedSupplementalFigure', {
    assertCurrentSupplementalImportTarget: () => ({ workspace: { workspaceId: 'ws-1' } }),
    refreshSupplementalFigureAssets: async () => undefined,
    supplementalFigureAssets: [sourceAsset],
    supplementalAssetFigureMatch: (figure, target) => figure.figureId === target.figureId,
    getImportedSupplementalFigureInventoryProjection: async (_figureId, options) =>
      options?.includeDeletionState === true
        ? { figure: projectedFigure, tombstone: inventoryTombstone }
        : projectedFigure,
    confirmImportedSupplementalFigureCheckpointOwners: async () => [],
    articleWorkspaceAssetFingerprint: value => JSON.stringify(value),
    createFigureOperationId: () => {
      createCalls += 1;
      return `figure-delete-retry-000${createCalls}`;
    },
    persistFigureInventoryWithCas: async content => {
      const requested = structuredClone(content.figureTombstones[0]);
      if (inventoryTombstone) assert.deepEqual(requested, inventoryTombstone);
      else inventoryTombstone = requested;
      projectedFigure = null;
      return { saved: true };
    },
    mutateImportedSupplementalFigure: async (_request, mutation) => {
      sourceMutationCalls += 1;
      if (sourceMutationCalls === 1) {
        const error = new Error('SIMULATED_CRASH_AFTER_INVENTORY_TOMBSTONE');
        error.code = 'SIMULATED_CRASH_AFTER_INVENTORY_TOMBSTONE';
        throw error;
      }
      return mutation(sourceAsset, 0);
    },
    figureWalkthroughState: new Map(), figureProgressById: new Map(),
    notifyFigureWorkspaceStateChanged: () => undefined
  });

  await assert.rejects(
    remove({ target: {}, figureId: sourceFigure.figureId }),
    error => error?.code === 'SIMULATED_CRASH_AFTER_INVENTORY_TOMBSTONE'
  );
  const firstTombstone = structuredClone(inventoryTombstone);
  const retried = await remove({ target: {}, figureId: sourceFigure.figureId });
  assert.equal(retried.deleted, true);
  assert.equal(createCalls, 1);
  assert.deepEqual(inventoryTombstone, firstTombstone);
  assert.deepEqual(sourceAsset.figureTombstones, [firstTombstone]);
  assert.equal(sourceAsset.figures.length, 0);
});

test('supplemental delete crash recovery refuses a tombstone bound to an older source identity', async () => {
  const sourceFigure = {
    figureId: 'supp-delete-stale-retry', figureLabel: 'Figure S8',
    identityRevision: 8, caption: 'old identity'
  };
  const sourceAsset = {
    materialId: 'material-delete-stale-retry', figures: [structuredClone(sourceFigure)],
    figureTombstones: []
  };
  let projectedFigure = structuredClone(sourceFigure);
  let inventoryTombstone = null;
  let createCalls = 0;
  let inventoryWrites = 0;
  let sourceMutationCalls = 0;
  const remove = executableContentFunction('deleteImportedSupplementalFigure', {
    assertCurrentSupplementalImportTarget: () => ({ workspace: { workspaceId: 'ws-1' } }),
    refreshSupplementalFigureAssets: async () => undefined,
    supplementalFigureAssets: [sourceAsset],
    supplementalAssetFigureMatch: (figure, target) => figure.figureId === target.figureId,
    getImportedSupplementalFigureInventoryProjection: async (_figureId, options) =>
      options?.includeDeletionState === true
        ? { figure: projectedFigure, tombstone: inventoryTombstone }
        : projectedFigure,
    confirmImportedSupplementalFigureCheckpointOwners: async () => [],
    articleWorkspaceAssetFingerprint: value => JSON.stringify(value),
    createFigureOperationId: () => {
      createCalls += 1;
      return `figure-delete-stale-retry-000${createCalls}`;
    },
    persistFigureInventoryWithCas: async content => {
      inventoryWrites += 1;
      inventoryTombstone ||= structuredClone(content.figureTombstones[0]);
      projectedFigure = null;
      return { saved: true };
    },
    mutateImportedSupplementalFigure: async (_request, mutation) => {
      sourceMutationCalls += 1;
      if (sourceMutationCalls === 1) {
        const error = new Error('SIMULATED_CRASH_AFTER_INVENTORY_TOMBSTONE');
        error.code = 'SIMULATED_CRASH_AFTER_INVENTORY_TOMBSTONE';
        throw error;
      }
      return mutation(sourceAsset, 0);
    },
    figureWalkthroughState: new Map(), figureProgressById: new Map(),
    notifyFigureWorkspaceStateChanged: () => undefined
  });
  await assert.rejects(
    remove({ target: {}, figureId: sourceFigure.figureId }),
    error => error?.code === 'SIMULATED_CRASH_AFTER_INVENTORY_TOMBSTONE'
  );
  assert.equal(inventoryTombstone.predecessorIdentityRevision, 8);
  sourceAsset.figures[0].identityRevision = 9;
  sourceAsset.figures[0].caption = 'concurrent newer identity';
  await assert.rejects(
    remove({ target: {}, figureId: sourceFigure.figureId }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(createCalls, 1);
  assert.equal(inventoryWrites, 1);
  assert.equal(sourceMutationCalls, 1);
  assert.equal(sourceAsset.figures[0].caption, 'concurrent newer identity');
});

test('supplemental tombstone reconciliation deletes an exact predecessor replica', async () => {
  const reconcile = executableContentFunction(
    'reconcileSupplementalFigureAssetDeletions'
  );
  const digest = 'd'.repeat(64);
  const sourceFigure = {
    figureId: 'supp-refresh-delete-1', identityRevision: 8,
    caption: 'deleted source identity'
  };
  const tombstone = {
    figureId: sourceFigure.figureId, identityRevision: 20,
    predecessorIdentityRevision: 8, predecessorIdentityDigest: digest,
    mutationId: 'figure-delete-refresh-0001'
  };
  let cleanupCalls = 0;
  let reviveCalls = 0;

  const result = await reconcile({
    materialId: 'material-refresh-delete', figures: [sourceFigure]
  }, {
    figures: [], figureTombstones: [tombstone]
  }, {
    identityDigest: async () => digest,
    deleteExact: async ({ figure, deletion }) => {
      cleanupCalls += 1;
      assert.equal(figure, sourceFigure);
      assert.equal(deletion, tombstone);
    },
    reviveNewer: async () => { reviveCalls += 1; }
  });

  assert.deepEqual(result.asset.figures, []);
  assert.deepEqual(result.deletedFigureIds, [sourceFigure.figureId]);
  assert.equal(cleanupCalls, 1);
  assert.equal(reviveCalls, 0);
});

function supplementalReplicaFixture(figureId, options = {}) {
  const depth = options.depth || 'standard';
  const operationId = options.operationId || 'figure:replica-operation';
  const marker = options.marker || 'a';
  const envelope = {
    version: 'figure-checkpoint-envelope-v1', figureId,
    analysisDepth: depth,
    inputDigest: marker.repeat(64), routeDigest: 'b'.repeat(64),
    taskPolicyDigest: 'c'.repeat(64), planDigest: 'd'.repeat(64),
    resultDigest: 'e'.repeat(64), bindingDigest: 'f'.repeat(64),
    immutableLimit: 4,
    figureResult: {
      figureId, analysisDepth: depth,
      panels: [{ panel: 'A', finding: 'partial finding' }]
    }
  };
  const identity = {
    figureId, identityRevision: 3, figureLabel: 'Figure S3',
    caption: 'stable caption', panelHints: ['A'],
    figureInputHash: '9'.repeat(64), analysisStatus: 'draft'
  };
  const pending = {
    ...envelope.figureResult, operationId, workspaceLifecycle: 7
  };
  const complete = {
    figureId, analysisDepth: depth, operationId,
    figureQuestion: 'What does this show?', coreConclusion: 'Complete result.',
    panels: [{ panel: 'A', finding: 'complete finding' }],
    panelCoverage: { missingPanels: [], unresolvedPanels: [] }
  };
  return {
    identity, envelope, pending, complete,
    partial: {
      ...identity,
      [depth === 'deep' ? 'pendingDeep' : 'pendingStandard']: pending,
      [depth === 'deep'
        ? 'pendingDeepCheckpointEnvelope'
        : 'pendingStandardCheckpointEnvelope']: envelope
    },
    completed: {
      ...identity, analysisStatus: 'complete', activeDepth: depth,
      [depth]: complete
    }
  };
}

function legacyTask8MechanismResult() {
  const result = structuredClone(task8MechanismResult());
  const source = result.evidenceFirstMechanism.nodes[0];
  const target = result.evidenceFirstMechanism.nodes[1];
  source.nodeId = source.nodeId.replace('node-v2-', 'node-v1-');
  source.nodeType = 'cell_type';
  target.nodeId = target.nodeId.replace('node-v2-', 'node-v1-');
  target.nodeType = 'phenotype';
  result.evidenceFirstMechanism.relations[0].sourceNodeId = source.nodeId;
  result.evidenceFirstMechanism.relations[0].targetNodeId = target.nodeId;
  return result;
}

function realMappedTask8MechanismResult() {
  const ledgerEntry = {
    panelKey: 'figure-2:A', figureId: 'figure-2', panelId: 'A', panelOrder: 0
  };
  const figure = {
    figureId: 'figure-2',
    caption: 'Figure 2. Mediator X knockdown decreases Outcome Y.',
    panelAnalyses: { A: {
      panel: 'A', role: 'necessity', evidenceType: 'loss of function',
      purpose: 'Test whether Mediator X is required for Outcome Y.',
      design: 'Mediator X knockdown in mouse cells.',
      comparison: 'knockdown versus control',
      directObservation: 'Outcome Y decreased after Mediator X knockdown.',
      observationSource: 'panel_analysis', experimentalMethods: ['RNA interference'],
      statisticalMethods: ['two-sided test'], remainingQuestion: '',
      phenotypeName: 'Outcome Y'
    } }
  };
  const projected = EvidenceFirstMechanism.projectPanelAnalysisEvidence(
    figure, ledgerEntry
  );
  assert.equal(projected.ok, true);
  const extracted = EvidenceFirstMechanism.validatePanelEvidenceBatch({
    records: [{
      handle: projected.projection.handle,
      panelType: 'experimental', exclusionReason: '', extractionUncertainty: '',
      claims: [{
        semantics: 'causal', causalTest: 'necessity', outcome: 'supports',
        effectSign: 'decreases', subjectTerms: ['Mediator X'],
        objectTerms: ['Outcome Y'], perturbations: ['Mediator X knockdown'],
        observations: ['Outcome Y decreased'], biologicalContexts: [{
          species: 'mouse', tissue: '', cellType: '', compartment: '',
          condition: 'knockdown', timepoint: '', dose: ''
        }], candidateTerms: ['Mediator X', 'Outcome Y'],
        sourceFields: ['directObservation'], uncertaintyReasons: [],
        modelConfidence: 0.9
      }]
    }]
  }, [projected.projection]);
  assert.equal(extracted.ok, true, JSON.stringify(extracted));
  const records = extracted.records;
  const canonicalPrompt = EvidenceFirstMechanism.compileCanonicalNodeProposalPrompt(
    records
  );
  const candidates = JSON.parse(canonicalPrompt.userPrompt).validated_candidates;
  const canonical = EvidenceFirstMechanism.validateCanonicalNodeProposal({
    groups: candidates.map(candidate => ({
      preferred_handle: candidate.candidate_handle,
      member_handles: [candidate.candidate_handle]
    }))
  }, records);
  const mappingPrompt = EvidenceFirstMechanism.compilePanelRelationMappingPrompt(
    records, canonical, records
  );
  const mappingPayload = JSON.parse(mappingPrompt.userPrompt);
  const claim = records[0].claims[0];
  const source = mappingPayload.relevant_canonical_nodes.find(node =>
    node.source_claim_handles.includes(claim.claimId)
  );
  const target = mappingPayload.relevant_canonical_nodes.find(node =>
    node.target_claim_handles.includes(claim.claimId)
  );
  assert.ok(source && target);
  const mappings = EvidenceFirstMechanism.validatePanelRelationMapping({
    records: [{
      panel_handle: records[0].panelUid,
      mappings: [{
        claim_handle: claim.claimId,
        source_node_handle: source.node_handle,
        target_node_handle: target.node_handle,
        relation_kind: 'causal', evidence_class: 'necessity',
        polarity: 'decreases', unmappedTerm: ''
      }]
    }]
  }, records, canonical, records);
  const assembled = EvidenceFirstMechanism.assembleMappedEvidenceFirstMechanism({
    records,
    panelLedger: { version: '1', entries: [{
      ...ledgerEntry, originalDisplayId: ledgerEntry.panelKey, displayAlias: '',
      status: 'unreviewed', sources: ['panelAnalyses']
    }] },
    canonicalNodes: canonical,
    mappingRecords: mappings.records
  });
  assert.equal(assembled.ok, true, JSON.stringify(assembled));
  const labels = new Map(assembled.nodes.map(node => [node.nodeId, node.label]));
  return {
    mechanismEdges: assembled.relations.filter(relation => relation.renderable).map(
      relation => ({
        from: labels.get(relation.sourceNodeId),
        to: labels.get(relation.targetNodeId),
        polarity: relation.polarity === 'increases' ? 'positive' :
          relation.polarity === 'decreases' ? 'negative' : 'neutral',
        supportPanels: relation.assignments.map(assignment => assignment.panelKey)
      })
    ),
    evidenceFirstMechanism: assembled
  };
}

test('supplemental replica pair converges a one-sided partial in both directions', () => {
  const reconcile = executableContentFunction(
    'reconcileSupplementalFigureReplicaPair'
  );
  for (const partialOnPrimary of [true, false]) {
    const fixture = supplementalReplicaFixture(
      `supp-replica-partial-${partialOnPrimary ? 'primary' : 'secondary'}`
    );
    const primary = partialOnPrimary ? fixture.partial : fixture.identity;
    const secondary = partialOnPrimary ? fixture.identity : fixture.partial;
    const result = reconcile(primary, secondary);
    assert.deepEqual(result.primary.pendingStandard, fixture.pending);
    assert.deepEqual(result.secondary.pendingStandard, fixture.pending);
    assert.deepEqual(
      result.primary.pendingStandardCheckpointEnvelope, fixture.envelope
    );
    assert.deepEqual(
      result.secondary.pendingStandardCheckpointEnvelope, fixture.envelope
    );
    assert.equal(result.primary.figureInputHash, '9'.repeat(64));
    assert.equal(result.secondary.figureInputHash, '9'.repeat(64));
  }
});

test('supplemental replica pair converges matching complete over partial both ways', () => {
  const reconcile = executableContentFunction(
    'reconcileSupplementalFigureReplicaPair'
  );
  for (const completeOnPrimary of [true, false]) {
    const fixture = supplementalReplicaFixture(
      `supp-replica-complete-${completeOnPrimary ? 'primary' : 'secondary'}`
    );
    const primary = completeOnPrimary ? fixture.completed : fixture.partial;
    const secondary = completeOnPrimary ? fixture.partial : fixture.completed;
    const result = reconcile(primary, secondary);
    assert.deepEqual(result.primary.standard, fixture.complete);
    assert.deepEqual(result.secondary.standard, fixture.complete);
    assert.equal(result.primary.pendingStandard, undefined);
    assert.equal(result.secondary.pendingStandard, undefined);
    assert.equal(result.primary.pendingStandardCheckpointEnvelope, undefined);
    assert.equal(result.secondary.pendingStandardCheckpointEnvelope, undefined);
  }
});

test('supplemental replica pair fails closed on an immutable binding conflict', () => {
  const reconcile = executableContentFunction(
    'reconcileSupplementalFigureReplicaPair'
  );
  const fixture = supplementalReplicaFixture('supp-replica-binding-conflict');
  const conflicting = structuredClone(fixture.partial);
  conflicting.pendingStandardCheckpointEnvelope.bindingDigest = '0'.repeat(64);
  assert.throws(
    () => reconcile(fixture.partial, conflicting),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
});

test('reader parent replica convergence preserves both identity projections', () => {
  const reconcile = executableContentFunction(
    'reconcileSupplementalFigureReplicaPair'
  );
  const fixture = supplementalReplicaFixture('reader-replica-1');
  const local = {
    ...fixture.partial, sourceExternal: false,
    sourceMode: 'pdf', sourceTitle: 'reader local'
  };
  const parent = {
    ...fixture.identity, sourceExternal: true,
    sourceMode: 'workspace', sourceTitle: 'parent asset'
  };
  const result = reconcile(local, parent, { analysisOnly: true });
  assert.equal(result.primary.sourceExternal, false);
  assert.equal(result.primary.sourceTitle, 'reader local');
  assert.equal(result.secondary.sourceExternal, true);
  assert.equal(result.secondary.sourceTitle, 'parent asset');
  assert.deepEqual(result.primary.pendingStandard, fixture.pending);
  assert.deepEqual(result.secondary.pendingStandard, fixture.pending);
});

test('supplemental asset replica reconciliation durably converges partials both ways', async () => {
  const pair = executableContentFunction('reconcileSupplementalFigureReplicaPair');
  const reconcile = executableContentFunction(
    'reconcileSupplementalFigureAssetReplicas',
    { reconcileSupplementalFigureReplicaPair: pair }
  );
  for (const sourceAhead of [true, false]) {
    const fixture = supplementalReplicaFixture(
      `supp-asset-partial-${sourceAhead ? 'source' : 'inventory'}`
    );
    let sourceAsset = {
      schemaVersion: 2, materialId: `material-${sourceAhead}`,
      figures: [structuredClone(sourceAhead ? fixture.partial : fixture.identity)]
    };
    let inventory = {
      schemaVersion: 2,
      figures: [structuredClone(sourceAhead ? fixture.identity : fixture.partial)]
    };
    const writes = [];
    const persistSource = async ({ figure, expectedFigure }) => {
      writes.push('source');
      assert.deepEqual(expectedFigure, sourceAsset.figures[0]);
      sourceAsset = { ...sourceAsset, figures: [structuredClone(figure)] };
      return { saved: true, content: structuredClone(sourceAsset) };
    };
    const persistInventory = async ({ figure, expectedFigure }) => {
      writes.push('inventory');
      assert.deepEqual(expectedFigure, inventory.figures[0]);
      inventory = { ...inventory, figures: [structuredClone(figure)] };
      return { saved: true, content: structuredClone(inventory) };
    };

    const first = await reconcile(sourceAsset, inventory, {
      persistSource, persistInventory
    });
    assert.deepEqual(first.asset.figures[0].pendingStandard, fixture.pending);
    assert.deepEqual(first.inventory.figures[0].pendingStandard, fixture.pending);
    assert.deepEqual(writes, [sourceAhead ? 'inventory' : 'source']);
    writes.length = 0;
    const second = await reconcile(first.asset, first.inventory, {
      persistSource, persistInventory
    });
    assert.deepEqual(second.asset.figures, first.asset.figures);
    assert.deepEqual(second.inventory.figures, first.inventory.figures);
    assert.deepEqual(writes, []);
  }
});

test('supplemental asset replica reconciliation durably converges complete over partial', async () => {
  const pair = executableContentFunction('reconcileSupplementalFigureReplicaPair');
  const reconcile = executableContentFunction(
    'reconcileSupplementalFigureAssetReplicas',
    { reconcileSupplementalFigureReplicaPair: pair }
  );
  for (const sourceComplete of [true, false]) {
    const fixture = supplementalReplicaFixture(
      `supp-asset-complete-${sourceComplete ? 'source' : 'inventory'}`
    );
    let sourceAsset = {
      schemaVersion: 2, materialId: `material-complete-${sourceComplete}`,
      figures: [structuredClone(sourceComplete ? fixture.completed : fixture.partial)]
    };
    let inventory = {
      schemaVersion: 2,
      figures: [structuredClone(sourceComplete ? fixture.partial : fixture.completed)]
    };
    const writes = [];
    const result = await reconcile(sourceAsset, inventory, {
      persistSource: async ({ figure }) => {
        writes.push('source');
        sourceAsset = { ...sourceAsset, figures: [structuredClone(figure)] };
        return { saved: true, content: structuredClone(sourceAsset) };
      },
      persistInventory: async ({ figure }) => {
        writes.push('inventory');
        inventory = { ...inventory, figures: [structuredClone(figure)] };
        return { saved: true, content: structuredClone(inventory) };
      }
    });
    assert.deepEqual(result.asset.figures[0].standard, fixture.complete);
    assert.deepEqual(result.inventory.figures[0].standard, fixture.complete);
    assert.deepEqual(writes, [sourceComplete ? 'inventory' : 'source']);
  }
});

test('supplemental asset replica conflict performs zero durable writes', async () => {
  const pair = executableContentFunction('reconcileSupplementalFigureReplicaPair');
  const reconcile = executableContentFunction(
    'reconcileSupplementalFigureAssetReplicas',
    { reconcileSupplementalFigureReplicaPair: pair }
  );
  const fixture = supplementalReplicaFixture('supp-asset-conflict');
  const conflicting = structuredClone(fixture.partial);
  conflicting.pendingStandardCheckpointEnvelope.bindingDigest = '0'.repeat(64);
  let writes = 0;
  await assert.rejects(reconcile({
    schemaVersion: 2, materialId: 'material-conflict', figures: [fixture.partial]
  }, {
    schemaVersion: 2, figures: [conflicting]
  }, {
    persistSource: async () => { writes += 1; return { saved: true }; },
    persistInventory: async () => { writes += 1; return { saved: true }; }
  }), error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT');
  assert.equal(writes, 0);
});

test('reader local and parent replicas durably converge partial/complete both ways', async () => {
  const pair = executableContentFunction('reconcileSupplementalFigureReplicaPair');
  const reconcile = executableContentFunction(
    'reconcileSupplementalReaderParentReplicas',
    { reconcileSupplementalFigureReplicaPair: pair }
  );
  for (const stateKind of ['partial', 'complete']) {
    for (const localAhead of [true, false]) {
      const fixture = supplementalReplicaFixture(
        `reader-durable-${stateKind}-${localAhead ? 'local' : 'parent'}`
      );
      const ahead = stateKind === 'complete' ? fixture.completed : fixture.partial;
      const behind = stateKind === 'complete' ? fixture.partial : fixture.identity;
      let local = {
        schemaVersion: 2,
        figures: [{
          ...(localAhead ? ahead : behind), sourceExternal: false,
          sourceMode: 'pdf', sourceTitle: 'reader local'
        }]
      };
      let parent = {
        schemaVersion: 2, materialId: 'reader-material',
        figures: [{
          ...(localAhead ? behind : ahead), sourceExternal: true,
          sourceMode: 'workspace', sourceTitle: 'parent asset'
        }]
      };
      const writes = [];
      const persistLocal = async ({ figure, expectedFigure }) => {
        writes.push('local');
        assert.deepEqual(expectedFigure, local.figures[0]);
        local = { ...local, figures: [structuredClone(figure)] };
        return { saved: true, content: structuredClone(local) };
      };
      const persistParent = async ({ figure, expectedFigure }) => {
        writes.push('parent');
        assert.deepEqual(expectedFigure, parent.figures[0]);
        parent = { ...parent, figures: [structuredClone(figure)] };
        return { saved: true, content: structuredClone(parent) };
      };
      const first = await reconcile(local, parent, { persistLocal, persistParent });
      assert.equal(first.local.figures[0].sourceExternal, false);
      assert.equal(first.parent.figures[0].sourceExternal, true);
      if (stateKind === 'partial') {
        assert.deepEqual(first.local.figures[0].pendingStandard, fixture.pending);
        assert.deepEqual(first.parent.figures[0].pendingStandard, fixture.pending);
      } else {
        assert.deepEqual(first.local.figures[0].standard, fixture.complete);
        assert.deepEqual(first.parent.figures[0].standard, fixture.complete);
      }
      assert.deepEqual(writes, [localAhead ? 'parent' : 'local']);
      writes.length = 0;
      await reconcile(first.local, first.parent, { persistLocal, persistParent });
      assert.deepEqual(writes, []);
    }
  }
});

test('reader local and parent binding conflict performs zero writes', async () => {
  const pair = executableContentFunction('reconcileSupplementalFigureReplicaPair');
  const reconcile = executableContentFunction(
    'reconcileSupplementalReaderParentReplicas',
    { reconcileSupplementalFigureReplicaPair: pair }
  );
  const fixture = supplementalReplicaFixture('reader-durable-conflict');
  const localFigure = {
    ...structuredClone(fixture.partial), sourceExternal: false, sourceTitle: 'local'
  };
  const parentFigure = {
    ...structuredClone(fixture.partial), sourceExternal: true, sourceTitle: 'parent'
  };
  parentFigure.pendingStandardCheckpointEnvelope.bindingDigest = '0'.repeat(64);
  let writes = 0;
  await assert.rejects(reconcile(
    { schemaVersion: 2, figures: [localFigure] },
    { schemaVersion: 2, materialId: 'reader-material', figures: [parentFigure] },
    {
      persistLocal: async () => { writes += 1; return { saved: true }; },
      persistParent: async () => { writes += 1; return { saved: true }; }
    }
  ), error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT');
  assert.equal(writes, 0);
});

test('fresh reader refresh converges local and parent partial/complete both ways', async () => {
  const pair = executableContentFunction('reconcileSupplementalFigureReplicaPair');
  const reconcileReplicas = executableContentFunction(
    'reconcileSupplementalReaderParentReplicas',
    { reconcileSupplementalFigureReplicaPair: pair }
  );
  for (const stateKind of ['partial', 'complete']) {
    for (const localAhead of [true, false]) {
      const fixture = supplementalReplicaFixture(
        `reader-fresh-${stateKind}-${localAhead ? 'local' : 'parent'}`
      );
      const ahead = stateKind === 'complete' ? fixture.completed : fixture.partial;
      const behind = stateKind === 'complete' ? fixture.partial : fixture.identity;
      let local = {
        schemaVersion: 2,
        figures: [{
          ...(localAhead ? ahead : behind), sourceExternal: false,
          sourceMode: 'pdf', sourceTitle: 'reader local'
        }]
      };
      let parent = {
        schemaVersion: 2, materialId: 'reader-material',
        figures: [{
          ...(localAhead ? behind : ahead), sourceExternal: true,
          sourceMode: 'workspace', sourceTitle: 'parent asset'
        }]
      };
      const writes = [];
      const binding = {
        parentWorkspaceId: `workspace:${'4'.repeat(64)}`,
        parentWorkspaceGeneration: 5,
        materialId: 'reader-material'
      };
      const dependencies = {
        supplementalPdfBinding: binding,
        supplementalParentWorkspaceTarget: () => ({
          workspaceId: binding.parentWorkspaceId,
          workspaceGeneration: binding.parentWorkspaceGeneration
        }),
        SciLLM: {
          supplementalFigureAssetPath: () =>
            'figures/supplemental/reader-material.json'
        },
        chrome: { runtime: { sendMessage: async message => {
          assert.equal(message.type, 'ARTICLE_WORKSPACE_GET_ASSET');
          return {
            success: true,
            data: { asset: { revision: 2, contentHash: '2'.repeat(64),
              content: structuredClone(parent) } }
          };
        } } },
        getWorkspaceAssetCheckpoint: async path => {
          assert.equal(path, 'figures/inventory.json');
          return {
            revision: 3, contentHash: '3'.repeat(64),
            content: structuredClone(local)
          };
        },
        persistFigureInventoryWithCas: async (content, options) => {
          assert.equal(options.reconcileFigureReplica, true);
          assert.equal(options.reconcileFigureAnalysisOnly, true);
          const figure = structuredClone(content.figures[0]);
          if (options.relativePath === 'figures/inventory.json') {
            writes.push('local');
            assert.deepEqual(options.expectedFigureReplica, local.figures[0]);
            local = { ...local, figures: [figure] };
            return { saved: true, content: structuredClone(local) };
          }
          writes.push('parent');
          assert.equal(options.relativePath,
            'figures/supplemental/reader-material.json');
          assert.deepEqual(options.expectedFigureReplica, parent.figures[0]);
          parent = { ...parent, figures: [figure] };
          return { saved: true, content: structuredClone(parent) };
        },
        reconcileSupplementalReaderParentReplicas: reconcileReplicas,
        normalizeRestoredFigureWorkspace: value => structuredClone(value),
        restoredFigureWorkspaceSnapshot: null
      };
      const reconcileWorkspace = executableContentFunction(
        'reconcileSupplementalReaderParentWorkspace', dependencies
      );

      const first = await reconcileWorkspace();
      if (stateKind === 'partial') {
        assert.deepEqual(first.local.figures[0].pendingStandard, fixture.pending);
        assert.deepEqual(first.parent.figures[0].pendingStandard, fixture.pending);
      } else {
        assert.deepEqual(first.local.figures[0].standard, fixture.complete);
        assert.deepEqual(first.parent.figures[0].standard, fixture.complete);
      }
      assert.deepEqual(writes, [localAhead ? 'parent' : 'local']);
      writes.length = 0;
      await reconcileWorkspace();
      assert.deepEqual(writes, []);
    }
  }
});

test('all Figure provider admissions await replica reconciliation without swallowing conflicts', () => {
  for (const functionName of [
    'analyzeSingleFigureDeep',
    'analyzeSingleFigureWithLLM',
    'analyzeFiguresWithLLM'
  ]) {
    const source = contentFunctionSource(functionName);
    const refreshIndex = source.indexOf('await refreshSupplementalFigureAssets(');
    const providerIndex = source.indexOf('sendFigureAnalysisRequestWithReceipt(');
    assert.ok(refreshIndex >= 0, `${functionName} must reconcile before admission`);
    assert.ok(providerIndex > refreshIndex,
      `${functionName} must not dispatch before reconciliation`);
    const refreshStatement = source.slice(refreshIndex,
      source.indexOf(';', refreshIndex) + 1);
    assert.doesNotMatch(refreshStatement, /\.catch\s*\(/u,
      `${functionName} must fail closed on reconciliation conflict`);
  }
});

test('supplemental tombstone reconciliation preserves and revives a newer source', async () => {
  const reconcile = executableContentFunction(
    'reconcileSupplementalFigureAssetDeletions'
  );
  const oldDigest = 'd'.repeat(64);
  const sourceFigure = {
    figureId: 'supp-refresh-newer-1', identityRevision: 9,
    caption: 'newer concurrent source identity'
  };
  const tombstone = {
    figureId: sourceFigure.figureId, identityRevision: 20,
    predecessorIdentityRevision: 8, predecessorIdentityDigest: oldDigest,
    mutationId: 'figure-delete-refresh-0002'
  };
  let cleanupCalls = 0;
  let revivedFigure = null;

  const result = await reconcile({
    materialId: 'material-refresh-newer', figures: [sourceFigure]
  }, {
    figures: [], figureTombstones: [tombstone]
  }, {
    identityDigest: async () => 'e'.repeat(64),
    deleteExact: async () => { cleanupCalls += 1; },
    reviveNewer: async ({ figure }) => { revivedFigure = figure; }
  });

  assert.deepEqual(result.asset.figures, [sourceFigure]);
  assert.deepEqual(result.revivedFigureIds, [sourceFigure.figureId]);
  assert.equal(revivedFigure, sourceFigure);
  assert.equal(cleanupCalls, 0);
});

test('ordinary supplemental refresh applies durable inventory tombstones', async () => {
  const sourceFigure = {
    figureId: 'supp-refresh-ghost-1', identityRevision: 4,
    figureLabel: 'Figure S4', isSupplemental: true
  };
  const sourceAsset = {
    materialId: 'material-refresh-ghost', figures: [sourceFigure]
  };
  const tombstone = {
    figureId: sourceFigure.figureId, identityRevision: 10,
    predecessorIdentityRevision: 4,
    predecessorIdentityDigest: 'f'.repeat(64),
    mutationId: 'figure-delete-refresh-ghost'
  };
  const calls = [];
    const dependencies = {
      recoverPendingFigureOperationRelease: async () => ({ recovered: true }),
      synchronizeFigureWorkspaceLifecycle: async () => undefined,
      SciLLM: {
      SUPPLEMENTAL_FIGURE_ASSET_PREFIX: 'figures/supplemental/'
    },
    chrome: { runtime: { sendMessage: async message => {
      calls.push(message.type);
      return { success: true, data: { assets: [{
        relativePath: 'figures/supplemental/material-refresh-ghost.json',
        content: structuredClone(sourceAsset)
      }] } };
    } } },
    supplementalPdfBinding: null,
    getWorkspaceAssetCheckpoint: async path => {
      assert.equal(path, 'figures/inventory.json');
      return { content: { figures: [], figureTombstones: [tombstone] } };
    },
    supplementalFigureIdentityDigest: async () => 'f'.repeat(64),
    persistFigureInventoryWithCas: async () => ({ saved: true }),
    reconcileSupplementalFigureAssetDeletions: async asset => ({
      asset: { ...asset, figures: [] },
      deletedFigureIds: [sourceFigure.figureId], revivedFigureIds: []
    }),
    reconcileSupplementalFigureAssetReplicas: async (asset, inventory) => ({
      asset, inventory
    }),
    populateFigureWorkspaceDraft: async () => undefined,
    crossFigureLogicState: { result: null },
    invalidateCrossFigureLogic: () => undefined
  };
  const harness = Function(...Object.keys(dependencies), `
    let supplementalFigureAssets = [];
    let supplementalFigureAssetsFingerprint = '';
    ${contentFunctionSource('refreshSupplementalFigureAssets')}
    return {
      refresh: refreshSupplementalFigureAssets,
      assets: () => supplementalFigureAssets
    };
  `)(...Object.values(dependencies));

  await harness.refresh({ workspaceId: `workspace:${'1'.repeat(64)}` });

  assert.deepEqual(harness.assets().flatMap(asset => asset.figures), []);
  assert.deepEqual(calls, ['ARTICLE_WORKSPACE_LIST_ASSETS']);
});

test('ordinary supplemental refresh durably revives a newer source before exposing it', async () => {
  const sourceFigure = {
    figureId: 'supp-refresh-revive-1', identityRevision: 9,
    figureLabel: 'Figure S9', isSupplemental: true,
    caption: 'newer than deleted predecessor'
  };
  const sourceAsset = {
    schemaVersion: 2, materialId: 'material-refresh-revive',
    figures: [sourceFigure]
  };
  const tombstone = {
    figureId: sourceFigure.figureId, identityRevision: 20,
    predecessorIdentityRevision: 8,
    predecessorIdentityDigest: 'd'.repeat(64),
    mutationId: 'figure-delete-refresh-revive'
  };
  let resolvePersist;
  const persistGate = new Promise(resolve => { resolvePersist = resolve; });
  const persistCalls = [];
  const dependencies = {
    SciLLM: { SUPPLEMENTAL_FIGURE_ASSET_PREFIX: 'figures/supplemental/' },
    chrome: { runtime: { sendMessage: async () => ({ success: true, data: {
      assets: [{
        relativePath: 'figures/supplemental/material-refresh-revive.json',
        content: structuredClone(sourceAsset)
      }]
    } }) } },
    supplementalPdfBinding: null,
    getWorkspaceAssetCheckpoint: async () => ({
      content: { schemaVersion: 2, figures: [], figureTombstones: [tombstone] }
    }),
    supplementalFigureIdentityDigest: async () => 'e'.repeat(64),
    persistFigureInventoryWithCas: async (content, options) => {
      persistCalls.push({ content, options });
      await persistGate;
      return {
        saved: true,
        content: { schemaVersion: 2, figures: [sourceFigure], figureTombstones: [] }
      };
    },
    reconcileSupplementalFigureAssetReplicas: async (asset, inventory) => ({
      asset, inventory
    }),
    populateFigureWorkspaceDraft: async () => undefined,
    crossFigureLogicState: { result: null },
    invalidateCrossFigureLogic: () => undefined
  };
  const harness = Function(...Object.keys(dependencies), `
    let supplementalFigureAssets = [];
    let supplementalFigureAssetsFingerprint = '';
    ${contentFunctionSource('reconcileSupplementalFigureAssetDeletions')}
    ${contentFunctionSource('refreshSupplementalFigureAssets')}
    return {
      refresh: refreshSupplementalFigureAssets,
      assets: () => supplementalFigureAssets
    };
  `)(...Object.values(dependencies));

  const refreshPromise = harness.refresh({ workspaceId: `workspace:${'2'.repeat(64)}` });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(harness.assets(), []);
  assert.equal(persistCalls.length, 1);
  assert.equal(persistCalls[0].options.reconcileFigureReplica, true);
  assert.equal(persistCalls[0].options.expectedFigureReplica, null);
  assert.deepEqual(persistCalls[0].options.expectedFigureTombstone, tombstone);
  resolvePersist();
  await refreshPromise;
  assert.deepEqual(harness.assets().flatMap(asset => asset.figures), [sourceFigure]);
});

test('fresh supplemental refresh converges source and inventory partial/complete both ways', async () => {
  const pair = executableContentFunction('reconcileSupplementalFigureReplicaPair');
  const reconcileReplicas = executableContentFunction(
    'reconcileSupplementalFigureAssetReplicas',
    { reconcileSupplementalFigureReplicaPair: pair }
  );
  const reconcileDeletions = executableContentFunction(
    'reconcileSupplementalFigureAssetDeletions'
  );
  for (const stateKind of ['partial', 'complete']) {
    for (const sourceAhead of [true, false]) {
      const fixture = supplementalReplicaFixture(
        `supp-fresh-${stateKind}-${sourceAhead ? 'source' : 'inventory'}`
      );
      const ahead = stateKind === 'complete' ? fixture.completed : fixture.partial;
      const behind = stateKind === 'complete' ? fixture.partial : fixture.identity;
      let sourceAsset = {
        schemaVersion: 2,
        materialId: `material-fresh-${stateKind}-${sourceAhead}`,
        figures: [structuredClone(sourceAhead ? ahead : behind)]
      };
      let durableInventory = {
        schemaVersion: 2,
        figures: [structuredClone(sourceAhead ? behind : ahead)],
        figureTombstones: []
      };
      const writes = [];
      const dependencies = {
        SciLLM: { SUPPLEMENTAL_FIGURE_ASSET_PREFIX: 'figures/supplemental/' },
        chrome: { runtime: { sendMessage: async () => ({ success: true, data: {
          assets: [{
            relativePath: `figures/supplemental/${sourceAsset.materialId}.json`,
            content: structuredClone(sourceAsset)
          }]
        } }) } },
        supplementalPdfBinding: null,
        getWorkspaceAssetCheckpoint: async () => ({
          revision: 1, contentHash: '1'.repeat(64),
          content: structuredClone(durableInventory)
        }),
        supplementalFigureIdentityDigest: async () => '1'.repeat(64),
        reconcileSupplementalFigureAssetDeletions: reconcileDeletions,
        reconcileSupplementalFigureAssetReplicas: reconcileReplicas,
        persistFigureInventoryWithCas: async (content, options) => {
          assert.equal(options.reconcileFigureReplica, true);
          const next = structuredClone(content.figures[0]);
          if (options.relativePath) {
            writes.push('source');
            assert.deepEqual(options.expectedFigureReplica, sourceAsset.figures[0]);
            sourceAsset = { ...sourceAsset, figures: [next] };
            return { saved: true, content: structuredClone(sourceAsset) };
          }
          writes.push('inventory');
          assert.deepEqual(
            options.expectedFigureReplica, durableInventory.figures[0]
          );
          durableInventory = { ...durableInventory, figures: [next] };
          return { saved: true, content: structuredClone(durableInventory) };
        },
        populateFigureWorkspaceDraft: async () => undefined,
        crossFigureLogicState: { result: null },
        invalidateCrossFigureLogic: () => undefined
      };
      const harness = Function(...Object.keys(dependencies), `
        let supplementalFigureAssets = [];
        let supplementalFigureAssetsFingerprint = '';
        ${contentFunctionSource('refreshSupplementalFigureAssets')}
        return {
          refresh: refreshSupplementalFigureAssets,
          assets: () => supplementalFigureAssets
        };
      `)(...Object.values(dependencies));

      await harness.refresh({ workspaceId: `workspace:${'3'.repeat(64)}` });
      const visible = harness.assets().flatMap(asset => asset.figures)[0];
      if (stateKind === 'partial') {
        assert.deepEqual(visible.pendingStandard, fixture.pending);
      } else {
        assert.deepEqual(visible.standard, fixture.complete);
        assert.equal(visible.pendingStandard, undefined);
      }
      assert.deepEqual(writes, [sourceAhead ? 'inventory' : 'source']);
      writes.length = 0;
      await harness.refresh({ workspaceId: `workspace:${'3'.repeat(64)}` });
      assert.deepEqual(writes, []);
    }
  }
});

test('supplemental delete rejects identity revision overflow before any asset write', async () => {
  const sourceFigure = {
    figureId: 'supp-delete-overflow', figureLabel: 'Figure S9',
    identityRevision: Number.MAX_SAFE_INTEGER
  };
  let inventoryWrites = 0;
  let sourceWrites = 0;
  const remove = executableContentFunction('deleteImportedSupplementalFigure', {
    assertCurrentSupplementalImportTarget: () => ({ workspace: { workspaceId: 'ws-1' } }),
    refreshSupplementalFigureAssets: async () => undefined,
    supplementalFigureAssets: [{ materialId: 'material-overflow', figures: [sourceFigure] }],
    supplementalAssetFigureMatch: (figure, target) => figure.figureId === target.figureId,
    getImportedSupplementalFigureInventoryProjection: async () => null,
    confirmImportedSupplementalFigureCheckpointOwners: async () => [],
    articleWorkspaceAssetFingerprint: value => JSON.stringify(value),
    createFigureOperationId: () => 'figure-overflow-must-not-be-created',
    persistFigureInventoryWithCas: async () => {
      inventoryWrites += 1;
      return { saved: true };
    },
    mutateImportedSupplementalFigure: async () => {
      sourceWrites += 1;
      return { saved: true };
    },
    figureWalkthroughState: new Map(), figureProgressById: new Map(),
    notifyFigureWorkspaceStateChanged: () => undefined
  });
  await assert.rejects(
    remove({ target: {}, figureId: sourceFigure.figureId }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(inventoryWrites, 0);
  assert.equal(sourceWrites, 0);
});

test('supplemental delete fails before inventory mutation when the source tombstone ledger is full', async () => {
  const sourceFigure = {
    figureId: 'supp-delete-capacity', figureLabel: 'Figure S10', identityRevision: 5
  };
  const sourceAsset = {
    materialId: 'material-capacity', figures: [sourceFigure],
    figureTombstones: Array.from({ length: 512 }, (_, index) => ({
      figureId: `already-deleted-${index + 1}`,
      identityRevision: index + 1,
      mutationId: `figure-delete-capacity-${String(index + 1).padStart(4, '0')}`
    }))
  };
  let inventoryWrites = 0;
  let sourceWrites = 0;
  const remove = executableContentFunction('deleteImportedSupplementalFigure', {
    assertCurrentSupplementalImportTarget: () => ({ workspace: { workspaceId: 'ws-1' } }),
    refreshSupplementalFigureAssets: async () => undefined,
    supplementalFigureAssets: [sourceAsset],
    supplementalAssetFigureMatch: (figure, target) => figure.figureId === target.figureId,
    getImportedSupplementalFigureInventoryProjection: async () => null,
    confirmImportedSupplementalFigureCheckpointOwners: async () => [],
    articleWorkspaceAssetFingerprint: value => JSON.stringify(value),
    createFigureOperationId: () => 'figure-capacity-must-not-be-created',
    persistFigureInventoryWithCas: async () => {
      inventoryWrites += 1;
      return { saved: true };
    },
    mutateImportedSupplementalFigure: async () => {
      sourceWrites += 1;
      return { saved: true };
    },
    figureWalkthroughState: new Map(), figureProgressById: new Map(),
    notifyFigureWorkspaceStateChanged: () => undefined
  });
  await assert.rejects(
    remove({ target: {}, figureId: sourceFigure.figureId }),
    error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT'
  );
  assert.equal(inventoryWrites, 0);
  assert.equal(sourceWrites, 0);
  assert.equal(sourceAsset.figureTombstones.length, 512);
});

test('supplemental mutation rejects a post-cancel owner or identity change before its callback and CAS', async () => {
  const admitted = {
    figureId: 'supp-race-1', identityRevision: 2, caption: 'admitted identity',
    pendingStandard: {
      operationId: 'figure-admitted-owner', workspaceLifecycle: 4
    }
  };
  const raced = {
    ...structuredClone(admitted), identityRevision: 3, caption: 'concurrent identity',
    pendingStandard: {
      operationId: 'figure-new-owner', workspaceLifecycle: 5
    }
  };
  let mutationCalls = 0;
  let writes = 0;
  const mutate = executableContentFunction('mutateImportedSupplementalFigure', {
    assertCurrentSupplementalImportTarget: () => ({ workspace: { workspaceId: 'ws-1' } }),
    refreshSupplementalFigureAssets: async () => undefined,
    supplementalFigureAssets: [{ materialId: 'material-race', figures: [admitted] }],
    supplementalAssetFigureMatch: (figure, target) => figure.figureId === target.figureId,
    SciLLM: { supplementalFigureAssetPath: id => `figures/supplemental/${id}.json` },
    getWorkspaceAssetCheckpoint: async () => ({
      revision: 7, contentHash: 'a'.repeat(64),
      content: { materialId: 'material-race', figures: [structuredClone(raced)] }
    }),
    articleWorkspaceAssetFingerprint: value => JSON.stringify(value),
    updateSupplementalAssetSummary: asset => asset,
    persistWorkspaceAssetCheckpoint: async () => { writes += 1; return { saved: true }; },
    supplementalFigureAssetsFingerprint: '',
    invalidateCrossFigureLogic: () => undefined
  });
  await assert.rejects(mutate({ target: {}, figureId: 'supp-race-1' }, async () => {
    mutationCalls += 1;
  }, {
    expectedFigureFingerprint: JSON.stringify(admitted)
  }), error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT');
  assert.equal(mutationCalls, 0);
  assert.equal(writes, 0);
  assert.equal(raced.caption, 'concurrent identity');
  assert.equal(raced.pendingStandard.operationId, 'figure-new-owner');
});

test('Figure request receipts are created before dispatch and replay only a proven pre-dispatch loss', async () => {
  const createReceipt = executableContentFunction('createFigureAnalysisRequestReceipt');
  const receiptIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  ];
  const randomUUID = () => receiptIds.shift();
  const preDispatch = executableContentFunction('isPreDispatchFigureTransportError');
  const send = executableContentFunction('sendFigureAnalysisRequestWithReceipt', {
    isPreDispatchFigureTransportError: preDispatch,
    bindFigureOperationProgress: () => ({}),
    waitForLocalOperation: async operation => {
      if (operation.cancelled) {
        const error = new Error('cancelled');
        error.code = 'CANCELLED';
        throw error;
      }
    },
    chrome: { runtime: { sendMessage() { throw new Error('unexpected default transport'); } } },
    setTimeout
  });
  const receipt = createReceipt({
    operationId: 'figure-batch-operation-12345678',
    figureId: 'figure-1', analysisDepth: 'deep',
    figureInputHash: 'input-hash-1', requestIndex: 0
  }, randomUUID);
  assert.match(receipt,
    /^figure-request-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
  const independentReceipt = createReceipt({
    operationId: 'figure-batch-operation-12345678',
    figureId: 'figure-1', analysisDepth: 'deep',
    figureInputHash: 'input-hash-1', requestIndex: 0
  }, randomUUID);
  assert.notEqual(independentReceipt, receipt,
    'random receipts prevent chosen-input collisions in the production FNV hash');
  const payload = { type: 'LLM_ANALYZE_FIGURES', figureRequestReceipt: receipt };

  const replayed = [];
  const success = await send(payload, { cancelled: false }, {
    sleep: async () => undefined,
    sendMessage: async message => {
      replayed.push(structuredClone(message));
      if (replayed.length === 1) {
        const error = new Error('Could not establish connection. Receiving end does not exist.');
        error.code = 'NO_RECEIVING_END';
        throw error;
      }
      return { success: true, data: { ok: true } };
    }
  });
  assert.equal(success.success, true);
  assert.equal(replayed.length, 2);
  assert.ok(replayed.every(message => message.figureRequestReceipt === receipt));
  assert.deepEqual(replayed[1], replayed[0],
    'the same immutable logical request is replayed after a pre-dispatch loss');

  let structuredCalls = 0;
  const structuredError = await send(payload, { cancelled: false }, {
    sendMessage: async () => {
      structuredCalls += 1;
      return { success: false, error: { code: 'REQUEST_TIMEOUT', retryable: true } };
    }
  });
  assert.equal(structuredError.error.code, 'REQUEST_TIMEOUT');
  assert.equal(structuredCalls, 1, 'a received structured error proves dispatch and is never resent');

  const checkpointOrder = [];
  const checkpointPayload = {
    ...payload,
    operationId: 'figure-operation-current',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
    figureResumeCheckpoint: { version: 'figure-checkpoint-envelope-v1' },
    figures: [{ figureId: 'figure-1' }]
  };
  const recovered = await send(checkpointPayload, { cancelled: false }, {
    checkpointRetryReceipt: independentReceipt,
    onCheckpointInvalid: async () => { checkpointOrder.push('discarded'); },
    sendMessage: async message => {
      checkpointOrder.push(structuredClone(message));
      return checkpointOrder.length === 1
        ? { success: false, error: { code: 'FIGURE_CHECKPOINT_STALE' } }
        : { success: true, data: { recovered: true } };
    }
  });
  assert.equal(recovered.success, false);
  assert.equal(recovered.error.code, 'FIGURE_CHECKPOINT_STALE');
  assert.equal(checkpointOrder.length, 1, 'stale checkpoints stop without discard or redispatch');
  assert.equal(checkpointOrder[0].figureRequestReceipt, receipt);
  assert.deepEqual(checkpointOrder[0].figureResumeCheckpoint, checkpointPayload.figureResumeCheckpoint);

  let invalidCalls = 0;
  let invalidDiscardCalls = 0;
  const invalid = await send(checkpointPayload, { cancelled: false }, {
    checkpointRetryReceipt: independentReceipt,
    onCheckpointInvalid: async () => { invalidDiscardCalls += 1; },
    sendMessage: async () => {
      invalidCalls += 1;
      return { success: false, error: { code: 'FIGURE_CHECKPOINT_INVALID' } };
    }
  });
  assert.equal(invalid.error.code, 'FIGURE_CHECKPOINT_INVALID');
  assert.equal(invalidCalls, 1, 'corrupt checkpoints are never retried');
  assert.equal(invalidDiscardCalls, 0, 'corrupt checkpoints are never discarded');

  let staleTwiceCalls = 0;
  const staleTwice = await send(checkpointPayload, { cancelled: false }, {
    checkpointRetryReceipt: independentReceipt,
    onCheckpointInvalid: async () => undefined,
    sendMessage: async () => {
      staleTwiceCalls += 1;
      return { success: false, error: { code: 'FIGURE_CHECKPOINT_STALE' } };
    }
  });
  assert.equal(staleTwice.error.code, 'FIGURE_CHECKPOINT_STALE');
  assert.equal(staleTwiceCalls, 1, 'a stale checkpoint is preserved without automatic retry');

  let lostResponseCalls = 0;
  await assert.rejects(send(payload, { cancelled: false }, {
    sendMessage: async () => {
      lostResponseCalls += 1;
      throw new Error('The message port closed before a response was received.');
    }
  }), /message port closed/u);
  assert.equal(lostResponseCalls, 1,
    'an ambiguous lost final response must not restart confirmed provider work');

  const cancelledOperation = { cancelled: false };
  let cancellationCalls = 0;
  await assert.rejects(send(payload, cancelledOperation, {
    sendMessage: async () => {
      cancellationCalls += 1;
      const error = new Error('no receiver');
      error.code = 'NO_RECEIVING_END';
      throw error;
    },
    sleep: async () => { cancelledOperation.cancelled = true; }
  }), error => error?.code === 'CANCELLED');
  assert.equal(cancellationCalls, 1, 'cancellation during replay backoff prevents another send');
});

test('Panel interpretation and follow-up build the same durable Figure request contract', () => {
  let receiptSequence = 0;
  const build = executableContentFunction('buildFigurePanelProviderContract', {
    createFigureAnalysisRequestReceipt: () =>
      `figure-request-panel-contract-${++receiptSequence}-12345678`,
    currentFigureProviderAttemptsConsumed: operationId =>
      operationId === 'figure-operation-panel' ? 3 : 0,
    normalizeRequestedPanelId: value => String(value || '').toUpperCase()
  });
  const operation = {
    operationId: 'figure-operation-panel', workspaceLifecycle: 29
  };
  const figure = { figureId: 'figure-1', panelHints: ['A', 'B'] };
  const first = build(operation, figure, 'a');
  const second = build(operation, figure, 'B');
  assert.deepEqual(first, {
    operationScope: 'figure', workspaceLifecycle: 29,
    operationId: 'figure-operation-panel',
    figureRequestReceipt: 'figure-request-panel-contract-1-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
    providerAttemptsConsumed: 3, analysisDepth: 'standard'
  });
  assert.equal(second.figureRequestReceipt,
    'figure-request-panel-contract-2-12345678');
  for (const name of [
    'analyzeSingleFigurePanelWithLLM', 'askFigurePanelWithLLM'
  ]) {
    const source = contentFunctionSource(name);
    assert.match(source, /buildFigurePanelProviderContract\(/u, name);
    assert.match(source, /sendFigureAnalysisRequestWithReceipt\(/u, name);
    assert.match(source, /finishFigureOperation\(operation\)/u, name);
  }
});

test('Figure operations use a cryptographically random UUID and fail closed without one', () => {
  const createOperationId = executableContentFunction('createFigureOperationId');
  assert.equal(
    createOperationId(() => '33333333-3333-4333-8333-333333333333'),
    'figure-33333333-3333-4333-8333-333333333333'
  );
  assert.throws(() => createOperationId(null), error =>
    error?.code === 'FIGURE_RANDOM_UNAVAILABLE');
  assert.throws(() => createOperationId(() => 'predictable'), error =>
    error?.code === 'FIGURE_RANDOM_UNAVAILABLE');
  assert.match(contentFunctionSource('beginFigureOperation'),
    /createFigureOperationId\(\)/u);
});

test('Figure finish retains a failed durable release and retries it before clearing local ownership', async () => {
  const operation = {
    operationId: 'figure-33333333-3333-4333-8333-333333333333',
    generation: 7,
    workspaceLifecycle: 11,
    waiters: []
  };
  const figureOperationState = { active: operation, generation: 7 };
  const finish = executableContentFunction('finishFigureOperation', {
    figureOperationState,
    isCurrentFigureOperation: candidate =>
      figureOperationState.active === candidate,
    chrome: { runtime: { sendMessage: async () => {
      throw new Error('the service worker is temporarily unavailable');
    } } }
  });
  let attempts = 0;
  await assert.rejects(finish(operation, {
    maxAttempts: 2,
    sleep: async () => undefined,
    sendMessage: async () => {
      attempts += 1;
      throw new Error('release transport failed');
    }
  }), error => error?.code === 'FIGURE_OPERATION_RELEASE_UNCONFIRMED');
  assert.equal(attempts, 2);
  assert.equal(figureOperationState.active, operation,
    'failed release keeps the owner available for an explicit cleanup retry');
  assert.equal(operation.releasePending, true);

  const primaryError = new Error('provider rejected the request');
  primaryError.code = 'PROVIDER_REJECTED';
  operation.primaryError = primaryError;
  const preserved = await finish(operation, {
    maxAttempts: 1,
    sendMessage: async () => ({
      success: false,
      error: { code: 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE' }
    })
  });
  assert.equal(preserved.primaryErrorPreserved, true);
  assert.equal(primaryError.code, 'PROVIDER_REJECTED');
  assert.equal(primaryError.cleanupPending, true);
  assert.equal(primaryError.cleanupErrorCode, 'FIGURE_OPERATION_RELEASE_UNCONFIRMED');
  delete operation.primaryError;

  const recovered = await finish(operation, {
    maxAttempts: 2,
    sleep: async () => undefined,
    sendMessage: async () => ({ success: true, data: {
      operationId: operation.operationId, released: true,
      cleanupComplete: true, requestedCommand: 'release'
    } })
  });
  assert.equal(recovered.released, true);
  assert.equal(figureOperationState.active, null);
  assert.equal(operation.releasePending, false);
});

test('Figure cleanup accepts only an accessor-free exact terminal acknowledgement for its current command', async () => {
  const operationId = 'figure-3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
  const strictAck = (command = 'release', overrides = {}) => ({
    success: true,
    data: {
      operationId,
      active: false,
      cancelled: command === 'cancel',
      released: command === 'release',
      cleanupComplete: true,
      requestedCommand: command,
      terminalCode: 'PROVIDER_REJECTED',
      immutableLimit: 8,
      reservedAttempts: 1,
      ...overrides
    }
  });
  const run = async (response, options = {}) => {
    const primaryError = Object.assign(new Error('primary Figure failure'), {
      code: 'PROVIDER_REJECTED'
    });
    const operation = {
      operationId,
      generation: 71,
      workspaceLifecycle: 41,
      cleanupCommand: options.command || 'release',
      primaryError,
      waiters: []
    };
    const figureOperationState = { active: operation, generation: 71 };
    const finish = executableContentFunction('finishFigureOperation', {
      figureOperationState,
      isCurrentFigureOperation: candidate => figureOperationState.active === candidate,
      chrome: { runtime: { sendMessage: async () => response } }
    });
    const result = await finish(operation, {
      command: options.command || 'release',
      maxAttempts: 1,
      sendMessage: options.sendMessage || (async () => response)
    });
    return { result, operation, primaryError, figureOperationState };
  };

  const accepted = await run(strictAck());
  assert.equal(accepted.result.released, true);
  assert.equal(accepted.figureOperationState.active, null);
  assert.equal(accepted.operation.cleanupPending, false);

  const invalidAcks = [
    ['wrong operation', strictAck('release', { operationId: `${operationId}-wrong` })],
    ['missing cleanup marker', (() => {
      const ack = strictAck();
      delete ack.data.cleanupComplete;
      return ack;
    })()],
    ['wrong command', strictAck('cancel', { released: true, cancelled: false })],
    ['unsuccessful envelope', { ...strictAck(), success: false }]
  ];
  for (const [label, ack] of invalidAcks) {
    const rejected = await run(ack);
    assert.equal(rejected.result.pending, true, label);
    assert.equal(rejected.figureOperationState.active, rejected.operation, label);
    assert.equal(rejected.operation.cleanupPending, true, label);
    assert.equal(rejected.primaryError.code, 'PROVIDER_REJECTED', label);
  }

  for (const field of ['success', 'data', 'operationId', 'cleanupComplete',
    'requestedCommand']) {
    let getterReads = 0;
    const ack = strictAck();
    const target = field === 'success' || field === 'data' ? ack : ack.data;
    Object.defineProperty(target, field, {
      configurable: true,
      enumerable: true,
      get() {
        getterReads += 1;
        if (field === 'success' || field === 'cleanupComplete') return true;
        if (field === 'data') return strictAck().data;
        if (field === 'operationId') return operationId;
        return 'release';
      }
    });
    const rejected = await run(ack);
    assert.equal(rejected.result.pending, true, `${field} accessor`);
    assert.equal(rejected.figureOperationState.active, rejected.operation, field);
    assert.equal(getterReads, 0, `${field} getter must never execute`);
  }

  const primaryError = Object.assign(new Error('late cleanup primary'), {
    code: 'PROVIDER_REJECTED'
  });
  const lateOperation = {
    operationId,
    generation: 72,
    workspaceLifecycle: 41,
    cleanupCommand: 'release',
    primaryError,
    waiters: []
  };
  const lateState = { active: lateOperation, generation: 72 };
  let resolveAck;
  let markSent;
  const sent = new Promise(resolve => { markSent = resolve; });
  const finish = executableContentFunction('finishFigureOperation', {
    figureOperationState: lateState,
    isCurrentFigureOperation: candidate => lateState.active === candidate,
    chrome: { runtime: { sendMessage: async () => assert.fail('injected sender required') } }
  });
  const lateCleanup = finish(lateOperation, {
    command: 'release',
    maxAttempts: 1,
    sendMessage: message => new Promise(resolve => {
      resolveAck = resolve;
      markSent(message);
    })
  });
  const releaseMessage = await sent;
  assert.equal(releaseMessage.command, 'release');
  lateOperation.cleanupCommand = 'cancel';
  resolveAck(strictAck('release'));
  const lateResult = await lateCleanup;
  assert.equal(lateResult.pending, true,
    'a late release ACK cannot clear a newer cancel cleanup command');
  assert.equal(lateState.active, lateOperation);
  assert.equal(lateOperation.cleanupPending, true);
  assert.equal(primaryError.code, 'PROVIDER_REJECTED');
});

test('terminal Figure failures release exact cleanup ownership and admit the next Figure without provider redispatch', async () => {
  const terminalCodes = [
    'FIGURE_REQUEST_REPLAY_AMBIGUOUS',
    'REQUEST_TIMEOUT',
    'PROVIDER_REJECTED',
    'INVALID_RESPONSE'
  ];
  for (const [index, terminalCode] of terminalCodes.entries()) {
    const operation = {
      operationId: `figure-${index + 4}a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a`,
      generation: index + 80,
      workspaceLifecycle: 42,
      cleanupCommand: 'release',
      cleanupPending: true,
      releasePending: true,
      primaryError: Object.assign(new Error(terminalCode), { code: terminalCode }),
      waiters: []
    };
    const figureOperationState = { active: operation, generation: operation.generation };
    let cleanupCalls = 0;
    let providerCalls = 0;
    const finish = executableContentFunction('finishFigureOperation', {
      figureOperationState,
      isCurrentFigureOperation: candidate => figureOperationState.active === candidate,
      chrome: { runtime: { sendMessage: async () => assert.fail('injected sender required') } }
    });
    const result = await finish(operation, {
      maxAttempts: 1,
      sendMessage: async message => {
        cleanupCalls += 1;
        if (message.type === 'LLM_ANALYZE_FIGURES') providerCalls += 1;
        assert.deepEqual(message, {
          type: 'LLM_CONTROL_OPERATION',
          operationScope: 'figure',
          operationId: operation.operationId,
          workspaceLifecycle: 42,
          command: 'release'
        }, terminalCode);
        return {
          success: true,
          data: {
            operationId: operation.operationId,
            active: false,
            cancelled: terminalCode === 'FIGURE_REQUEST_REPLAY_AMBIGUOUS',
            released: true,
            cleanupComplete: true,
            requestedCommand: 'release',
            terminalCode,
            immutableLimit: 8,
            reservedAttempts: 1
          }
        };
      }
    });
    assert.equal(result.released, true, terminalCode);
    assert.equal(operation.primaryError.code, terminalCode);
    assert.equal(operation.cleanupPending, false, terminalCode);
    assert.equal(operation.releasePending, false, terminalCode);
    assert.equal(figureOperationState.active, null, terminalCode);
    assert.equal(cleanupCalls, 1, terminalCode);
    assert.equal(providerCalls, 0,
      `${terminalCode} cleanup cannot redispatch an old Figure receipt`);

    const begin = executableContentFunction('beginFigureOperation', {
      figureOperationState,
      throwFigureOperationBusy: () => assert.fail(`${terminalCode} poisoned admission`),
      createFigureOperationId: () =>
        `figure-${index + 8}b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b`,
      sanitizeFigureProgressText: value => String(value),
      articleWorkspaceLifecycleGeneration: 42
    });
    const next = begin('single', `next-${index}`);
    assert.equal(next.figureId, `next-${index}`);
  }
});

test('all four single-Figure entry paths preserve their primary failure over release cleanup', async () => {
  const capturePrimary = executableContentFunction(
    'captureFigureOperationPrimaryError'
  );
  const entries = [
    'analyzeSingleFigureDeep',
    'analyzeSingleFigureWithLLM',
    'analyzeSingleFigurePanelWithLLM',
    'askFigurePanelWithLLM'
  ];
  for (const name of entries) {
    assert.match(
      contentFunctionSource(name),
      /catch \(error\) \{\s*captureFigureOperationPrimaryError\(operation, error\);/u,
      `${name} must capture the thrown primary error before any lifecycle branch`
    );
    const primaryError = Object.assign(new Error(`${name} provider failure`), {
      code: name.includes('Panel') ? 'INVALID_RESPONSE' : 'PROVIDER_REJECTED'
    });
    const operation = {
      operationId: `figure-${entries.indexOf(name) + 1}3333333-3333-4333-8333-333333333333`,
      generation: entries.indexOf(name) + 1,
      workspaceLifecycle: 17,
      waiters: []
    };
    assert.equal(capturePrimary(operation, primaryError), primaryError, name);
    const figureOperationState = { active: operation, generation: operation.generation };
    const finish = executableContentFunction('finishFigureOperation', {
      figureOperationState,
      isCurrentFigureOperation: candidate => figureOperationState.active === candidate,
      chrome: { runtime: { sendMessage: async () => ({ success: false }) } }
    });
    const cleanup = await finish(operation, {
      maxAttempts: 1,
      sendMessage: async () => ({
        success: false,
        error: { code: 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE' }
      })
    });
    assert.equal(cleanup.primaryErrorPreserved, true, name);
    assert.equal(operation.primaryError, primaryError, name);
    assert.equal(primaryError.code,
      name.includes('Panel') ? 'INVALID_RESPONSE' : 'PROVIDER_REJECTED', name);
    assert.equal(primaryError.cleanupPending, true, name);
    assert.equal(primaryError.cleanupErrorCode,
      'FIGURE_OPERATION_RELEASE_UNCONFIRMED', name);
  }
});

test('a durably cancelled Figure is a successful cleanup acknowledgement for the next operation', async () => {
  const cancelledOperation = {
    operationId: 'figure-44444444-4444-4444-8444-444444444444',
    generation: 8, workspaceLifecycle: 12, cancelled: true, waiters: []
  };
  const figureOperationState = { active: cancelledOperation, generation: 8 };
  const isCurrentFigureOperation = candidate => figureOperationState.active === candidate;
  const finish = executableContentFunction('finishFigureOperation', {
    figureOperationState,
    isCurrentFigureOperation,
    chrome: { runtime: { sendMessage: async () => ({
      success: true, data: {
        operationId: cancelledOperation.operationId,
        cancelled: true, released: false,
        cleanupComplete: true, requestedCommand: 'release'
      }
    }) } }
  });
  const terminal = await finish(cancelledOperation);
  assert.deepEqual(terminal, { released: false, cancelled: true, attempts: 1 });
  assert.equal(figureOperationState.active, null);

  const begin = executableContentFunction('beginFigureOperation', {
    figureOperationState,
    throwFigureOperationBusy: () => assert.fail('durable cancellation must not stay busy'),
    createFigureOperationId: () => 'figure-55555555-5555-4555-8555-555555555555',
    sanitizeFigureProgressText: value => String(value),
    articleWorkspaceLifecycleGeneration: 12
  });
  const next = begin('single', 'figure-2');
  assert.equal(next.operationId, 'figure-55555555-5555-4555-8555-555555555555');
});

test('workspace invalidation retains exact Figure cleanup until scoped cancel ACK', async () => {
  const operation = {
    operationId: 'figure-88888888-8888-4888-8888-888888888888',
    generation: 10, workspaceLifecycle: 17,
    paused: true, cancelled: false, waiters: []
  };
  const figureOperationState = { active: operation, generation: 10 };
  let resolveAck;
  const ackGate = new Promise(resolve => { resolveAck = resolve; });
  const messages = [];
  const finish = executableContentFunction('finishFigureOperation', {
    figureOperationState,
    isCurrentFigureOperation: candidate => figureOperationState.active === candidate,
    chrome: { runtime: { sendMessage: async message => {
      messages.push(message);
      await ackGate;
      return { success: true, data: {
        operationId: operation.operationId,
        active: false, cancelled: true, released: false,
        cleanupComplete: true, requestedCommand: 'cancel'
      } };
    } } }
  });
  const queue = executableContentFunction('queueFigureOperationLifecycleCleanup', {
    figureOperationState,
    articleWorkspaceLifecycleError: () => Object.assign(
      new Error('ARTICLE_WORKSPACE_LIFECYCLE_CHANGED'), { code: 'CANCELLED' }
    ),
    finishFigureOperation: finish
  });

  const retained = queue();
  assert.equal(retained, operation);
  assert.equal(figureOperationState.active, operation);
  assert.equal(operation.cancelled, true);
  assert.equal(operation.paused, false);
  assert.equal(operation.cleanupPending, true);
  assert.equal(operation.releasePending, true);
  assert.equal(operation.primaryError.code, 'CANCELLED');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(messages, [{
    type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
    operationId: operation.operationId, command: 'cancel',
    workspaceLifecycle: 17
  }]);
  assert.equal(figureOperationState.active, operation,
    'the local owner remains held before the exact ACK');
  resolveAck();
  const cleanup = await operation.lifecycleCleanupPromise;
  assert.equal(cleanup.cancelled, true);
  assert.equal(figureOperationState.active, null);
  assert.equal(operation.cleanupPending, false);
  assert.equal(operation.releasePending, false);

  const begin = executableContentFunction('beginFigureOperation', {
    figureOperationState,
    throwFigureOperationBusy: () => assert.fail('confirmed lifecycle cancel stayed busy'),
    createFigureOperationId: () => 'figure-a8a8a8a8-a8a8-4a8a-8a8a-a8a8a8a8a8a8',
    sanitizeFigureProgressText: value => String(value),
    articleWorkspaceLifecycleGeneration: 18
  });
  assert.equal(begin('single', 'after-lifecycle-cancel').figureId,
    'after-lifecycle-cancel');
});

test('Figure lifecycle cleanup rejects a mismatched ACK and preserves its retry intent', async () => {
  const operation = {
    operationId: 'figure-99999999-9999-4999-8999-999999999999',
    generation: 11, workspaceLifecycle: 18,
    paused: false, cancelled: false, waiters: []
  };
  const figureOperationState = { active: operation, generation: 11 };
  const finish = executableContentFunction('finishFigureOperation', {
    figureOperationState,
    isCurrentFigureOperation: candidate => figureOperationState.active === candidate,
    chrome: { runtime: { sendMessage: async () => ({ success: false }) } }
  });
  const queue = executableContentFunction('queueFigureOperationLifecycleCleanup', {
    figureOperationState,
    articleWorkspaceLifecycleError: () => Object.assign(
      new Error('ARTICLE_WORKSPACE_LIFECYCLE_CHANGED'), { code: 'CANCELLED' }
    ),
    finishFigureOperation: finish
  });
  queue();
  const result = await operation.lifecycleCleanupPromise;
  assert.equal(result.pending, true);
  assert.equal(figureOperationState.active, operation);
  assert.equal(operation.cleanupPending, true);
  assert.equal(operation.primaryError.code, 'CANCELLED');
  assert.equal(operation.primaryError.cleanupPending, true);
  assert.match(contentFunctionSource('invalidateArticleWorkspaceLifecycle'),
    /queueFigureOperationLifecycleCleanup\(figureOperationState\.active\)/u);
  assert.doesNotMatch(contentFunctionSource('invalidateArticleWorkspaceLifecycle'),
    /figureOperationState\.active\s*=\s*null/u);
});

test('the next production Figure admission retries a pending durable release before it can start', async () => {
  const pendingOperation = {
    operationId: 'figure-66666666-6666-4666-8666-666666666666',
    generation: 9, workspaceLifecycle: 13, releasePending: true, waiters: []
  };
  const figureOperationState = { active: pendingOperation, generation: 9 };
  let cleanupCalls = 0;
  const recover = executableContentFunction('recoverPendingFigureOperationRelease', {
    figureOperationState,
    finishFigureOperation: async operation => {
      cleanupCalls += 1;
      assert.equal(operation, pendingOperation);
      figureOperationState.active = null;
      operation.releasePending = false;
      return { released: true, attempts: 1 };
    }
  });
  const result = await recover();
  assert.deepEqual(result, { recovered: true, released: true, attempts: 1 });
  assert.equal(cleanupCalls, 1);

  const begin = executableContentFunction('beginFigureOperation', {
    figureOperationState,
    throwFigureOperationBusy: () => assert.fail('confirmed cleanup must admit the next operation'),
    createFigureOperationId: () => 'figure-77777777-7777-4777-8777-777777777777',
    sanitizeFigureProgressText: value => String(value),
    articleWorkspaceLifecycleGeneration: 13
  });
  assert.equal(begin('single', 'figure-2').operationId,
    'figure-77777777-7777-4777-8777-777777777777');

  for (const name of [
    'analyzeSingleFigureDeep', 'analyzeSingleFigureWithLLM',
    'analyzeSingleFigurePanelWithLLM', 'askFigurePanelWithLLM',
    'analyzeFiguresWithLLM'
  ]) {
    assert.match(contentFunctionSource(name),
      /await recoverPendingFigureOperationRelease\(\)/u, name);
  }
});

test('Figure operation planning and public progress expose one bounded immutable attempt limit', () => {
  const plan = executableContentFunction('buildFigureOperationProviderPlan');
  assert.deepEqual(plan([
    { figureId: 'figure-1', panelHints: [] },
    { figureId: 'figure-2', panelHints: ['A', 'B', 'C'] },
    { figureId: 'figure-2', panelHints: ['A'] },
    { figureId: 'figure-3', panelHints: Array.from({ length: 40 }, (_, index) => `${index}`) }
  ]), [
    { figureId: 'figure-1', panelCount: 0 },
    { figureId: 'figure-2', panelCount: 3 },
    { figureId: 'figure-3', panelCount: 30 }
  ]);

  const normalizeAttempts = executableContentFunction(
    'normalizeFigureProviderAttemptProgress'
  );
  assert.deepEqual(normalizeAttempts({
    providerAttempt: 140, providerAttemptLimit: 500
  }), { providerAttempt: 96, providerAttemptLimit: 96 });
  assert.deepEqual(normalizeAttempts({
    providerAttempt: 7, providerAttemptLimit: 12
  }), { providerAttempt: 7, providerAttemptLimit: 12 });

  const mergeAttempts = executableContentFunction(
    'mergeFigureProviderAttemptProgress',
    { normalizeFigureProviderAttemptProgress: normalizeAttempts }
  );
  assert.deepEqual(mergeAttempts(
    { providerAttempt: 7, providerAttemptLimit: 12 },
    { providerAttempt: 4, providerAttemptLimit: 40 }
  ), { providerAttempt: 7, providerAttemptLimit: 12 },
  'late public progress cannot lower the attempt or raise its first bound limit');
  assert.deepEqual(mergeAttempts(
    { providerAttempt: 7, providerAttemptLimit: 12 },
    { providerAttempt: 15, providerAttemptLimit: 12 }
  ), { providerAttempt: 12, providerAttemptLimit: 12 },
  'attempt progress remains clamped to the immutable bound');

  const formatSuffix = executableContentFunction('formatFigureProviderAttemptSuffix');
  assert.equal(formatSuffix({ providerAttempt: 7, providerAttemptLimit: 12 }),
    '（模型尝试 7/12）');
  const formatMessage = executableContentFunction('formatFigureProgressMessage', {
    formatFigureProviderAttemptSuffix: formatSuffix
  });
  assert.match(formatMessage({
    figureLabel: 'Figure 2', phase: 'figure_provider_attempt',
    providerAttempt: 7, providerAttemptLimit: 12,
    completedFigures: 0, totalFigures: 2
  }), /模型尝试 7\/12/u);

  const updateSource = contentFunctionSource('updateFigureProgress');
  assert.match(updateSource,
    /mergeFigureProviderAttemptProgress\(operationPrevious, patch\)/u);
  const workflow = contentFunctionSource('analyzeFiguresWithLLM');
  assert.match(workflow, /buildFigureOperationProviderPlan\(figures\)/u);
  assert.match(workflow, /createFigureAnalysisRequestReceipt\(/u);
  assert.match(workflow, /sendFigureAnalysisRequestWithReceipt\(/u);
  assert.doesNotMatch(workflow, /for\s*\(let requestAttempt\s*=\s*1/u);
});

test('a new single Figure operation cannot inherit an earlier operation attempt ledger', () => {
  const dependencies = {
    sanitizeFigureProgressText: (value, maxLength) =>
      String(value || '').slice(0, maxLength),
    sanitizeFigureProgressPanels: value => Array.isArray(value) ? [...value] : [],
    normalizeFigureRecoveryProgressFields: () => ({}),
    sanitizeFigureProgressRoute: value => value || null,
    updateFigureAnalysisStatus: () => undefined
  };
  const harness = Function(...Object.keys(dependencies), `
    const figureProgressById = new Map();
    const figureOperationState = { active: null };
    function isCurrentFigureOperation(value) {
      const operationId = String(value?.operationId || value || '');
      return operationId === String(figureOperationState.active?.operationId || '');
    }
    ${contentFunctionSource('normalizeFigureProviderAttemptProgress')}
    ${contentFunctionSource('mergeFigureProviderAttemptProgress')}
    ${contentFunctionSource('sanitizeFigureProgressSnapshot')}
    ${contentFunctionSource('updateFigureProgress')}
    ${contentFunctionSource('beginSingleFigureProgress')}
    ${contentFunctionSource('currentFigureProviderAttemptsConsumed')}
    return {
      begin: beginSingleFigureProgress,
      update: updateFigureProgress,
      consumed: currentFigureProviderAttemptsConsumed,
      setActive(operation) { figureOperationState.active = operation; },
      getProgress(figureId) { return figureProgressById.get(figureId); }
    };
  `)(...Object.values(dependencies));
  const figure = {
    figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A']
  };
  const oldOperation = { operationId: 'figure-old-operation' };
  harness.setActive(oldOperation);
  harness.begin(figure, oldOperation);
  harness.update(figure.figureId, {
    operationId: oldOperation.operationId,
    providerAttempt: 7,
    providerAttemptLimit: 48
  });
  assert.equal(harness.consumed(oldOperation.operationId), 7);

  for (const kind of ['standard', 'deep']) {
    const nextOperation = { operationId: `figure-${kind}-new-operation` };
    harness.setActive(nextOperation);
    harness.begin(figure, nextOperation);
    assert.equal(harness.consumed(nextOperation.operationId), 0, kind);
    assert.deepEqual(
      {
        providerAttempt: harness.getProgress(figure.figureId).providerAttempt,
        providerAttemptLimit: harness.getProgress(figure.figureId).providerAttemptLimit
      },
      { providerAttempt: 0, providerAttemptLimit: 0 },
      `${kind} must start with a clean receipt-owned attempt projection`
    );
  }
});

test('Figure checkpoint resume is admitted only for the exact persisted input identity', () => {
  const selectCheckpoint = executableContentFunction('selectFigureResumeCheckpoint', { SciLLM: FigureAnalysis });
  const currentHash = FigureAnalysis.bindFigureEvidenceInputHash('aaaaaaaa');
  const oldHash = FigureAnalysis.bindFigureEvidenceInputHash('bbbbbbbb');
  const checkpointEnvelope = {
    version: 'figure-checkpoint-envelope-v1',
    figureId: 'figure-1', analysisDepth: 'deep', panels: [{ panel: 'A' }]
  };
  const state = {
    pendingResults: { deep: { figureId: 'figure-1', panels: [{ panel: 'A' }] } },
    pendingResumeCheckpoints: { deep: checkpointEnvelope }
  };
  assert.equal(selectCheckpoint(
    state, 'deep', currentHash, currentHash
  ), checkpointEnvelope);
  assert.equal(selectCheckpoint(
    state, 'deep', oldHash, currentHash
  ), undefined);
  assert.equal(selectCheckpoint(state, 'deep', 'input-hash-current', 'input-hash-current'), undefined,
    'matching legacy hashes still lack the current evidence contract');
  assert.equal(selectCheckpoint(
    state, 'deep', '', currentHash
  ), undefined, 'legacy unbound checkpoints fail closed');
  assert.equal(selectCheckpoint(
    state, 'standard', currentHash, currentHash
  ), undefined);
  assert.equal(selectCheckpoint({ pendingResults: { deep: {
    figureId: 'figure-1', panels: [{ panel: 'A' }]
  } } }, 'deep', currentHash, currentHash), undefined,
  'legacy raw checkpoints fail closed');
});

test('single standard and deep Figure retries send the matching checkpoint under a new receipt', async () => {
  async function exercise(depth) {
    const inputHash = FigureAnalysis.bindFigureEvidenceInputHash('aaaaaaaa');
    const checkpointEnvelope = {
      version: 'figure-checkpoint-envelope-v1',
      figureId: 'figure-1',
      analysisDepth: depth,
      bindingDigest: `binding-${depth}`,
      operationPlan: [
        { figureId: 'figure-1', panelCount: 1 },
        { figureId: 'figure-2', panelCount: 5 }
      ]
    };
    const figure = {
      figureId: 'figure-1', figureLabel: 'Figure 1', caption: 'Caption',
      panelHints: ['A'], contextParagraphs: [], sourceExternal: false
    };
    const state = {
      figure,
      standard: { figureId: 'figure-1', analysisDepth: 'standard' },
      deep: null,
      figureInputHash: inputHash,
      deepLoading: false,
      deepError: '',
      standardError: '',
      pendingResults: { [depth]: { figureId: 'figure-1', panels: [{ panel: 'A' }] } },
      pendingResumeCheckpoints: { [depth]: checkpointEnvelope }
    };
    const sent = [];
    const completedCheckpointWrites = [];
    const result = {
      figureId: 'figure-1', analysisDepth: depth, panels: [{ panel: 'A' }]
    };
    const dependencies = {
      initialState: state,
      SciLLM: { ...FigureResultBinding, ...FigureAnalysis },
      captureFigureOperationPrimaryError: executableContentFunction('captureFigureOperationPrimaryError'),
      recoverPendingFigureOperationRelease: async () => ({ recovered: true }),
      synchronizeFigureWorkspaceLifecycle: async () => undefined,
      ensureCurrentArticleWorkspace: async () => ({ workspaceId: 'workspace-retry' }),
      refreshSupplementalFigureAssets: async () => undefined,
      preflightFigureTaskRoute: async () => figureVisionAdmission('figure_walkthrough'),
      assertCurrentArticleWorkspaceLifecycle: () => undefined,
      getFigureWorkspaceInventory: () => [],
      ensureFigureWorkspaceInventorySeeded: async () => undefined,
      ensureFigureWalkthroughState: () => state,
      beginFigureOperation: () => ({
        operationId: `operation-${depth}-new`, cancelled: false
      }),
      beginSingleFigureProgress: () => undefined,
      extractArticleWithTrace: () => [],
      waitForLocalOperation: async () => undefined,
      prepareFigureImages: async () => [{ dataUrl: 'data:image/png;base64,AA==' }],
      buildFigureInputHash: () => inputHash,
      verifyLiveFigureRetryInput: async () => ({ liveRevision: 'live-revision' }),
      buildFigureOperationProviderPlan: () => [{ figureId: 'figure-1', panelCount: 1 }],
      createFigureAnalysisRequestReceipt: () =>
        `figure-request-single-${depth}-new-12345678`,
      currentFigureProviderAttemptsConsumed: () => 3,
      sendFigureAnalysisRequestWithReceipt: async payload => {
        sent.push(payload);
        return {
          success: true,
          data: {
            figureResults: [result], cacheHits: 0, visionFallbacks: 0,
            route: null, notificationUsage: null
          }
        };
      },
      isCurrentFigureOperation: () => true,
      throwStaleFigureOperation: () => { throw new Error('unexpected stale operation'); },
      isCompleteFigureAnalysisResult: () => true,
      invalidCommittedFigureResult: () => new Error('unexpected invalid result'),
      mergeCompletedFigureResultIntoWorkspaceDraft: async () => undefined,
      assertFigureRetryCommitBinding: () => undefined,
      completeFigureRecovery: (target, _figure, merged, completedDepth, summary) => {
        target[completedDepth] = merged;
        return summary || { results: [merged] };
      },
      persistCompletedFigureCheckpointState: async (
        target, completedDepth, operationId, completedCheckpoint
      ) => {
        completedCheckpointWrites.push({
          completedDepth, operationId, completedCheckpoint
        });
        delete target.pendingResults?.[completedDepth];
        delete target.pendingResumeCheckpoints?.[completedDepth];
        return { saved: true, checkpointCleared: true };
      },
      refreshRuntimePdfFigureInventory:async()=>{},
      persistImportedSupplementalFigureState: async () => ({ saved: true }),
      invalidateCrossFigureLogic: () => undefined,
      scheduleCurrentArticleArchiveSave: () => undefined,
      scheduleArticleWorkspaceArtifactsSave: () => undefined,
      buildFigureWorkspaceSnapshot: () => ({ figures: [figure] }),
      settleInterruptedFigureRecovery: async () => null,
      formatFigureCoverageFailure: error => error.message,
      retainFailedFigureDepth: () => undefined,
      finishSingleFigureProgress: () => undefined,
      finishFigureOperation: () => undefined,
      throwBusyFigureAnalysis: () => { throw new Error('unexpected busy operation'); },
      document: { title: 'Checkpoint retry' }
    };
    const targetName = depth === 'deep'
      ? 'analyzeSingleFigureDeep' : 'analyzeSingleFigureWithLLM';
    const harness = Function(...Object.keys(dependencies), `
      let figureDepthAnalysisPromise = null;
      let figureDepthAnalysisId = '';
      let figureDepthAnalysisKind = '';
      let articleWorkspaceLifecycleGeneration = 17;
      let lastFigureAnalysis = null;
      const figureWalkthroughState = new Map([['figure-1', initialState]]);
      ${contentFunctionSource('reuseActiveFigureAnalysisPromise')}
      ${contentFunctionSource('canApplyFigureFailure')}
      ${contentFunctionSource('selectFigureResumeCheckpoint')}
      ${contentFunctionSource('selectFigureResumeOperationPlan')}
      ${contentFunctionSource(targetName)}
      return { run: ${targetName} };
    `)(...Object.values(dependencies));
    const options = depth === 'deep'
      ? { expectedFigureInputHash: inputHash }
      : { forceRefresh: false };
    const response = await harness.run('figure-1', options);
    assert.equal(response.success, true, depth);
    assert.equal(sent.length, 1, depth);
    assert.equal(sent[0].figureResumeCheckpoint, checkpointEnvelope, depth);
    assert.deepEqual(sent[0].figureOperationPlan, checkpointEnvelope.operationPlan,
      `${depth} preserves the operation-wide plan bound into the checkpoint`);
    assert.equal(sent[0].figureRequestReceipt,
      `figure-request-single-${depth}-new-12345678`, depth);
    assert.equal(state.pendingResumeCheckpoints[depth], undefined,
      `${depth} checkpoint is cleared only after complete success`);
    assert.deepEqual(completedCheckpointWrites, [{
      completedDepth: depth,
      operationId: `operation-${depth}-new`,
      completedCheckpoint: checkpointEnvelope
    }]);
  }

  await exercise('standard');
  await exercise('deep');
});

test('Figure timeout, cancellation and attempt exhaustion are operation-terminal', () => {
  const terminal = executableContentFunction('isTerminalFigureProviderError');
  for (const code of [
    'CANCELLED', 'REQUEST_TIMEOUT', 'FIGURE_PROVIDER_ATTEMPT_LIMIT',
    'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE',
    'FIGURE_REQUEST_RECEIPT_INVALID', 'FIGURE_REQUEST_RECEIPT_MISMATCH',
    'FIGURE_REQUEST_REPLAY_AMBIGUOUS', 'FIGURE_REQUEST_RECEIPT_CAPACITY',
    'FIGURE_CHECKPOINT_TRANSPORT_UNAVAILABLE',
    'FIGURE_CHECKPOINT_PERSIST_FAILED', 'FIGURE_CHECKPOINT_INVALID',
    'FIGURE_CHECKPOINT_STALE', 'FIGURE_CHECKPOINT_CONFLICT',
    'FIGURE_CHECKPOINT_DISCARD_UNCONFIRMED',
    'FIGURE_CHECKPOINT_BINDING_INVALID', 'FIGURE_COMMIT_GUARD_UNAVAILABLE',
    'FIGURE_PANEL_RETRY_SCOPE_STALE', 'FIGURE_RETRY_CLEANUP_FAILED'
  ]) assert.equal(terminal({ code }), true, code);
  for (const code of ['INVALID_RESPONSE', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED']) {
    assert.equal(terminal({ code }), false, code);
  }
  const workflow = contentFunctionSource('analyzeFiguresWithLLM');
  assert.match(workflow, /isTerminalFigureProviderError\(error\)/u);
});

test('missing-Panel retry rebuilds live Figure input and aborts mutation before merge', async () => {
  const requireFigureTaskAdmission = executableContentFunction(
    'requireFigureTaskAdmission'
  );
  const visionAdmission = figureVisionAdmission('figure_panel_interpretation');
  const verify = executableContentFunction('verifyLiveFigureRetryInput', {
    requireFigureTaskAdmission,
    getFigureWorkspaceInventory: () => [],
    combinedFigureWorkspaceInventory: () => [{
      figureId: 'figure-1', caption: 'live caption', panelHints: ['A', 'B']
    }],
    prepareFigureImages: async figure => [{ dataUrl: `data:,${figure.caption}` }],
    buildFigureInputHash: figure => figure.caption === 'live caption'
      ? 'live-hash' : 'mutated-hash',
    buildFigureLiveRetryRevision: figure => `revision:${figure.caption}`
  });
  const state = { figure: { figureId: 'figure-1' }, figureInputHash: 'live-hash' };
  assert.equal((await verify(
    state, 'live-hash', visionAdmission, 'figure_panel_interpretation'
  )).inputHash, 'live-hash');

  const mutatedVerify = executableContentFunction('verifyLiveFigureRetryInput', {
    requireFigureTaskAdmission,
    getFigureWorkspaceInventory: () => [],
    combinedFigureWorkspaceInventory: () => [{
      figureId: 'figure-1', caption: 'mutated caption', panelHints: ['A', 'B']
    }],
    prepareFigureImages: async () => [],
    buildFigureInputHash: () => 'mutated-hash',
    buildFigureLiveRetryRevision: figure => `revision:${figure.caption}`
  });
  await assert.rejects(
    () => mutatedVerify(
      state, 'live-hash', visionAdmission, 'figure_panel_interpretation'
    ),
    error => error?.code === 'FIGURE_PANEL_RETRY_SCOPE_STALE'
  );
  const retrySource = contentFunctionSource('retryMissingFigurePanelsWithLLM');
  assert.ok((retrySource.match(/verifyLiveFigureRetryInput\(/gu) || []).length >= 3);
  assert.match(retrySource, /deferMerge:\s*true/u);
  assert.match(retrySource, /preCommit:\s*\(\)\s*=>\s*assertFigureRetryCommitBinding/u);
  assert.match(retrySource,
    /analysisDepth === 'deep'[\s\S]*FIGURE_DEEP_RETRY_REQUIRES_RERUN/u);
});

test('retry commit binding synchronously rejects a live Figure revision change', () => {
  let liveCaption = 'original caption';
  const state = {
    figure: { figureId: 'figure-1' }, figureInputHash: 'input-hash'
  };
  const stateMap = new Map([['figure-1', state]]);
  const boundAssert = executableContentFunction('assertFigureRetryCommitBinding', {
    getFigureWorkspaceInventory: () => [],
    combinedFigureWorkspaceInventory: () => [{
      figureId: 'figure-1', caption: liveCaption, panelHints: ['A']
    }],
    buildFigureLiveRetryRevision: figure => `revision:${figure.caption}`,
    figureWalkthroughState: stateMap,
    articleWorkspaceLifecycleGeneration: 9
  });
  assert.doesNotThrow(() => boundAssert(
    state, 'input-hash', 'revision:original caption', 9
  ));
  liveCaption = 'mutated after outer precheck';
  assert.throws(() => boundAssert(
    state, 'input-hash', 'revision:original caption', 9
  ), error => error?.code === 'FIGURE_PANEL_RETRY_SCOPE_STALE');
});

test('live article structure tracks removals, text edits, and root replacement', () => {
  const script = read('content.js');
  const start = script.indexOf('function isArticleStructureMutation');
  const end = script.indexOf('function flattenArticleNodes', start);
  const observer = script.slice(start, end);
  assert.match(observer, /mutation\?\.removedNodes/);
  assert.match(observer, /mutation\?\.type === 'characterData'/);
  assert.match(observer, /articleStructureBoundaryRoots/);
  assert.match(observer, /characterData:\s*true/);
  assert.match(observer, /observe\(parent,\s*\{\s*childList:\s*true\s*\}\)/);
  assert.match(observer, /startArticleStructureObserver\(\)/);
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
  assert.match(script, /paragraph_checkpoint/);
  assert.match(script, /scheduleCurrentArticleArchiveSave\(\)/);
  assert.match(router, /checkpointAnnotations:\s*Array\.isArray\(completed\.annotations\)/);
  assert.match(pipeline, /await serializeCheckpoint\(completed\)/);
  assert.match(pipeline, /serializeParagraphCheckpoint\(completed\)/);
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

test('external workspace deletion invalidates stale tasks before rebuilding an empty generation', () => {
  const script = read('content.js');
  const background = read('background.js');
  for (const action of [
    'prepareExternalArticleWorkspaceDeletion',
    'finalizeExternalArticleWorkspaceDeletion'
  ]) {
    assert.match(script, new RegExp(`request\\.action === '${action}'`));
    assert.match(background, new RegExp(action));
  }
  assert.match(script, /function invalidateArticleWorkspaceLifecycle\(/);
  assert.match(script, /articleWorkspaceLifecycleGeneration \+= 1/);
  for (const promiseName of [
    'llmAnalysisPromise',
    'figureAnalysisPromise',
    'figureDepthAnalysisPromise',
    'crossFigureLogicPromise',
    'reviewOutlinePromise',
    'articleChatPumpPromise'
  ]) {
    assert.match(script, new RegExp(`${promiseName} = null`));
  }
  assert.match(script, /articleWorkspaceMutationTail = Promise\.resolve\(\)/);
  assert.match(script, /generation !== articleChatGeneration/);
  const legacyChat = contentFunctionSource('legacyAskArticleWithLLM');
  const staleGuard = legacyChat.indexOf('if (generation !== articleChatGeneration) {');
  const publish = legacyChat.indexOf('articleChatState.messages.push(assistantMessage)', staleGuard);
  assert.ok(staleGuard >= 0 && publish > staleGuard);
  assert.match(legacyChat.slice(staleGuard, legacyChat.indexOf('if (!response?.success', staleGuard)),
    /const error = new Error\('ARTICLE_CHAT_STALE'\);\s*error\.code = 'CANCELLED';\s*throw error;/);
  assert.match(legacyChat.slice(legacyChat.indexOf('} finally {')),
    /if \(generation === articleChatGeneration\) \{[\s\S]*?articleChatState\.loading = false;[\s\S]*?command: 'release'/);
  assert.match(script, /STALE_WORKSPACE_LIFECYCLE/);
  assert.match(script, /standaloneReviewParagraphSummaries\.clear\(\)/);
  assert.match(script, /articleSectionOutlines\.clear\(\)/);
  assert.match(script, /notifyFigureWorkspaceStateChanged\('workspace_cleared'\)/);
  assert.match(background, /coordinateOpenArticleWorkspaceTabs/);
  assert.match(background, /workspaceLifecycle:\s*Number\.isInteger\(message\.workspaceLifecycle\)/);
});

test('legacy chat late reply is cancelled before assistant publication and releases its operation', async () => {
  const state = { messages: [], loading: false };
  const requests = [], published = [];
  let releaseReply;
  const reply = new Promise(resolve => { releaseReply = resolve; });
  const deps = {
    articleChatState: state,
    publicArticleChatMessage: value => ({ ...value }),
    getCanonicalArticleSnapshot: () => ({ paragraphs: [], documentHash: 'fixture' }),
    filterParagraphsForArticleAnalysis: paragraphs => paragraphs,
    document: { title: 'fixture' }, effectiveArticlePageUrl: () => 'https://example.org/paper',
    attachArticleChatEvidenceIdentity: () => [],
    scheduleCurrentArticleArchiveSave: () => published.push('archive'),
    chrome: { runtime: { sendMessage: message => {
      requests.push(message);
      return message.type === 'LLM_ASK_ARTICLE' ? reply : Promise.resolve({ success: true });
    } } }
  };
  const harness = Function(...Object.keys(deps), `let articleChatGeneration = 0;
    ${contentFunctionSource('legacyAskArticleWithLLM')}
    return { ask: legacyAskArticleWithLLM, invalidate: () => { articleChatGeneration += 1; } };
  `)(...Object.values(deps));
  const pending = harness.ask('question', 'profile');
  assert.equal(requests.length, 1);
  harness.invalidate();
  releaseReply({ success: true, data: { message: { answer: 'late answer' } } });
  await assert.rejects(pending, error => error.code === 'CANCELLED');
  assert.deepEqual(state.messages.map(message => message.role), ['user']);
  assert.deepEqual(published, []);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].type, 'LLM_CONTROL_OPERATION');
  assert.equal(requests[1].command, 'release');
  assert.equal(requests[1].operationId, requests[0].operationId);
});

test('stale Figure completions and persistence mutations are generation guarded', () => {
  const script = read('content.js');
  const router = read('core/background-router.js');
  const guardedFigureFinishes = script.match(
    /finishSingleFigureProgress\(state\.figure, (?:error|null), operation\)/g
  ) || [];
  assert.ok(guardedFigureFinishes.length >= 5);
  assert.match(script,
    /while \(!articleChatClearInFlight && !articleChatState.loading &&\s*workspaceLifecycle === articleWorkspaceLifecycleGeneration\)/);
  assert.match(script, /if \(articleChatPumpPromise === pumpPromise\)/);
  assert.match(script, /workspaceGeneration: Number\(workspace\.workspaceGeneration\) \|\| 1/);
  assert.match(script, /return \{ saved: false, stale: true \}/);
  assert.match(script, /function deleteWorkspaceTurnCheckpoint\(/);
  assert.match(script, /articleWorkspaceMutationTail\.then\(async \(\) =>/);
  assert.match(script, /deleteArticleChatCheckpoint\(normalizedTurnId/);
  assert.match(router, /function assertWorkspaceMutationGeneration\(/);
  assert.match(router, /WORKSPACE_GENERATION_CONFLICT/);
});

test('native PDF selection Q&A awaits page evidence and rejects stale replies', () => {
  const script = read('content.js');
  const actionStart = script.indexOf('async function runManualSelectionLlmAction');
  const actionEnd = script.indexOf('function showManualSelectionToolbar', actionStart);
  const action = script.slice(actionStart, actionEnd);
  const chatStart = script.indexOf('async function runArticleChatTurn');
  const chatEnd = script.indexOf('function pumpArticleChatQueue', chatStart);
  const chat = script.slice(chatStart, chatEnd);

  assert.match(action, /prepareNativePdfSelectionEvidence/);
  assert.match(action, /ensurePageIndexed/);
  assert.match(action, /extractCurrentArticleStructure\(\{ forceRefresh: true \}\)/);
  assert.match(action, /selectionEvidence/);
  assert.match(chat, /selectionEvidence/);
  assert.match(chat, /selectedEvidenceParagraph/);
  assert.match(chat, /paragraphs\.unshift\(selectedEvidenceParagraph\)/);
  assert.match(chat, /isNativePdfSelectionReplyCurrent/);
  assert.match(chat, /STALE_PDF_SELECTION/);
  const send = chat.indexOf("type: 'LLM_ASK_ARTICLE'");
  const postAwaitGuard = chat.indexOf('isNativePdfSelectionReplyCurrent', send);
  const merge = chat.indexOf('mergeArticleChatAnswerBlocks', send);
  assert.ok(send >= 0 && postAwaitGuard > send && postAwaitGuard < merge);
  assert.match(chat, /createNativePdfSelectionTurnGuard/);
  assert.match(chat, /sanitizeArticleChatDocumentUrl/);
  assert.doesNotMatch(action + chat,
    /selectionEvidence\s*:\s*\{[^}]*?(?:pdfBytes|objectUrl|sourcePath)/s);
});

test('native PDF chat cancellation invalidates the active operation before late replies merge', () => {
  const script = read('content.js');
  const start = script.indexOf('async function cancelArticleChatWithLLM');
  const end = script.indexOf('function removeArticleChatTurn', start);
  const cancel = script.slice(start, end);

  assert.match(cancel, /articleChatGeneration\s*\+=\s*1/);
  assert.match(cancel, /turn\.operationId\s*=\s*''/);
  assert.match(cancel, /articleChatState\.operationId\s*=\s*''/);
  const invalidate = cancel.indexOf('articleChatGeneration += 1');
  const backendCancel = cancel.indexOf("type: 'LLM_CONTROL_OPERATION'");
  assert.ok(invalidate >= 0 && invalidate < backendCancel);
});

test('figure workspace seeding contains no misplaced PDF selection guard', () => {
  const script = read('content.js');
  const start = script.indexOf('async function seedFigureWorkspaceMetaFromCrossFigure');
  const end = script.indexOf('async function analyzeCrossFigureLogicWithLLM', start);
  const seed = script.slice(start, end);
  assert.doesNotMatch(seed, /selectionEvidence|STALE_PDF_SELECTION/);
});

test('full-text progress never exposes NaN or undefined chunk counts', () => {
  const script = read('content.js');
  const start = script.indexOf("if (request.action === 'llmAnalysisProgress')");
  const end = script.indexOf(
    "} else if (request.action === 'getReviewOutlineStatus')",
    start
  );
  const progress = script.slice(start, end);
  assert.match(progress, /Number\.isFinite\(Number\(progress\.completedChunks\)\)/);
  assert.match(progress, /Number\.isFinite\(Number\(progress\.totalChunks\)\)/);
  assert.match(progress, /LLM 正在分析正文分块/);
  assert.doesNotMatch(
    progress,
    /progress\.completedChunks\s*\+\s*1[^]*progress\.totalChunks/
  );
});

test('LLM progress forwards only a bounded public heartbeat to the active extension panel', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  assert.match(script, /function publishPublicLlmOperationProgress/);
  assert.match(script, /type:\s*'LLM_OPERATION_PROGRESS'/);
  assert.match(script, /elapsedSeconds:/);
  assert.match(script, /timeoutSeconds:/);
  assert.doesNotMatch(script, /LLM_OPERATION_PROGRESS[^]*\.\.\.progress/);
});

test('a last-call Figure heartbeat cannot enter a newly navigated document or sidebar', () => {
  const oldBinding = {
    documentIdentity: 'browser-document-a',
    navigationIdentity: 'https://paper.test/article/a',
    documentId: 'document-a',
    workspaceId: 'workspace:a',
    workspaceGeneration: 3,
    workspaceLifecycle: 11
  };
  let currentBinding = { ...oldBinding };
  const oldOperation = {
    operationId: 'figure-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    generation: 4,
    workspaceLifecycle: 11,
    progressBinding: { ...oldBinding },
    cancelled: false
  };
  const figureOperationState = { active: oldOperation };
  const own = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
  const sameOwner = executableContentFunction('sameFigureLlmProgressOwner');
  const accepts = executableContentFunction('isCurrentFigureLlmProgress', {
    figureOperationState,
    articleWorkspaceLifecycleGeneration: 11,
    crossFigureMechanismOwnData: own,
    currentFigureLlmProgressBinding: () => ({ ...currentBinding }),
    sameFigureLlmProgressOwner: sameOwner
  });
  const pageUpdates = [];
  const sidebarHeartbeats = [];
  const route = executableContentFunction('applyAndPublishFigureProgressEvent', {
    isCurrentFigureLlmProgress: accepts,
    applyFigureProgressEvent: progress => {
      pageUpdates.push(progress);
      return { ...progress, failed: false };
    },
    publishPublicLlmOperationProgress: progress => sidebarHeartbeats.push(progress)
  });
  const heartbeat = {
    taskType: 'figure', phase: 'figure_model_processing', figureId: 'figure-1',
    operationId: oldOperation.operationId, workspaceLifecycle: 11,
    documentId: 'document-a', workspaceId: 'workspace:a', workspaceGeneration: 3
  };

  assert.equal(route(heartbeat)?.figureId, 'figure-1');
  assert.equal(pageUpdates.length, 1);
  assert.equal(sidebarHeartbeats.length, 1);

  currentBinding = {
    documentIdentity: 'browser-document-b',
    navigationIdentity: 'https://paper.test/article/b',
    documentId: 'document-b',
    workspaceId: 'workspace:b',
    workspaceGeneration: 1,
    workspaceLifecycle: 11
  };
  assert.equal(route(heartbeat), null);
  assert.equal(pageUpdates.length, 1, 'the old heartbeat must not mutate the new page');
  assert.equal(sidebarHeartbeats.length, 1,
    'the old heartbeat must not be republished into the new document sidebar');

  const newOperation = {
    operationId: 'figure-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    generation: 5,
    workspaceLifecycle: 11,
    progressBinding: { ...currentBinding },
    cancelled: false
  };
  figureOperationState.active = newOperation;
  assert.equal(route({ ...heartbeat, operationId: newOperation.operationId }), null,
    'reusing a new operation ID cannot bypass the exact app document/workspace binding');
  assert.equal(pageUpdates.length, 1);
  assert.equal(sidebarHeartbeats.length, 1);
});

test('mechanism generation sends the exact evidence-first v2 identity through popup and content', () => {
  const popup = read('popup.js');
  const content = read('content.js');
  const popupRun = popup.slice(
    popup.indexOf('async function runCrossFigureLogic'),
    popup.indexOf('async function runReviewOutlineAnalysis')
  );
  const contentRun = content.slice(
    content.indexOf('async function analyzeCrossFigureLogicWithLLM'),
    content.indexOf('const paperMetaAnalysisPromises')
  );
  const contentBuilder = content.slice(
    content.indexOf('function buildEvidenceFirstMechanismBackgroundMessage'),
    content.indexOf('function sameCrossFigureMechanismBinding')
  );
  const contentProductionPath = `${contentRun}\n${contentBuilder}`;
  for (const field of [
    'evidenceFirstVersion', 'evidenceFirstRouterVersion', 'evidenceFirstVersions',
    'operationId', 'documentId', 'workspaceId', 'baseWorkspaceRevision',
    'mechanismChainFingerprint', 'workspaceGeneration', 'workspaceLifecycle'
  ]) {
    assert.match(popupRun, new RegExp(`\\b${field}\\b`), `popup must send ${field}`);
    assert.match(contentProductionPath, new RegExp(`\\b${field}\\b`),
      `content must forward ${field}`);
  }
  assert.match(popupRun, /createMechanismOperationId\(/);
  assert.match(contentBuilder, /type:\s*'LLM_ANALYZE_CROSS_FIGURE_LOGIC'/);
  assert.match(contentRun, /evidenceFirstVersion:\s*'2'/);
  assert.doesNotMatch(contentRun, /operationId:\s*`cross-figure-/);
});

test('content rejects partial and accessor-backed mechanism identities before provider dispatch', () => {
  const normalize = executableContentFunction('normalizeEvidenceFirstMechanismRequest', {
    SciLLM: EvidenceFirstMechanism,
    mechanismChainFingerprint: () => 'mechanism-chain-v1-deadbeef'
  });
  const versions = EVIDENCE_FIRST_VERSIONS;
  const live = {
    documentId: 'sha256:document', workspaceId: `workspace:${'a'.repeat(64)}`,
    workspaceGeneration: 3, workspaceLifecycle: 9, baseWorkspaceRevision: 12,
    mechanismChainFingerprint: 'mechanism-chain-v1-deadbeef'
  };
  const request = {
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions,
    operationId: 'mechanism:run-1234567890',
    documentId: live.documentId, workspaceId: live.workspaceId,
    workspaceGeneration: 3, workspaceLifecycle: 9,
    baseWorkspaceRevision: 12,
    mechanismChainFingerprint: live.mechanismChainFingerprint
  };
  assert.deepEqual(normalize(request, live), request);
  assert.throws(() => normalize({ ...request, workspaceId: '' }, live), error =>
    error?.code === 'MECHANISM_REQUEST_INVALID');
  let getterReads = 0;
  const hostile = { ...request };
  Object.defineProperty(hostile, 'operationId', {
    enumerable: true,
    get() { getterReads += 1; return request.operationId; }
  });
  assert.throws(() => normalize(hostile, live), error =>
    error?.code === 'MECHANISM_REQUEST_INVALID');
  assert.equal(getterReads, 0);
});

test('mechanism state accepts only exact bound stages and keeps incomplete results pending', () => {
  const apply = executableContentFunction('applyCrossFigureMechanismProgress');
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData: (value, key) =>
      Object.getOwnPropertyDescriptor(value, key)?.value }
  );
  const settle = executableContentFunction('settleCrossFigureMechanismState', {
    isSeedableCrossFigureLogicResult,
    SciLLM: EvidenceFirstMechanism
  });
  const binding = {
    documentId: 'sha256:document', workspaceId: `workspace:${'b'.repeat(64)}`,
    workspaceGeneration: 4, workspaceLifecycle: 11, baseWorkspaceRevision: 7,
    mechanismChainFingerprint: 'mechanism-chain-v1-01234567'
  };
  const initial = {
    result: { nodes: [{ id: 'old' }] }, pendingResult: null,
    operation: { operationId: 'mechanism:active-12345678', epoch: 0, binding,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
      startedAt: 1000, cancelled: false },
    status: 'queued', progress: null, audit: { code: '', updatedAt: 1000 },
    supplementalFingerprint: ''
  };
  const accepted = apply(initial, {
    phase: 'collecting_panel_evidence', operationId: initial.operation.operationId,
    operationEpoch: 2, completedPanels: 1, totalPanels: 6
  }, 2000);
  assert.equal(accepted.status, 'working');
  assert.equal(accepted.operation.epoch, 2);
  assert.equal(accepted.progress.stage, 'collecting_panel_evidence');
  assert.equal(accepted.progress.progressSequence, 1,
    'the first accepted upstream heartbeat advances the content-local checkpoint');
  assert.equal(apply(accepted, {
    phase: 'assembling_graph', operationId: 'mechanism:other-12345678',
    operationEpoch: 2
  }, 3000), accepted, 'other-operation progress must be ignored by identity');
  assert.equal(apply(accepted, {
    phase: 'provider_waiting', operationId: accepted.operation.operationId,
    operationEpoch: 2
  }, 3000), accepted, 'non-fixed provider phases must not enter public mechanism state');

  const pending = {
    nodes: [{ id: 'candidate' }],
    mechanismEdges: [{ from: 'upstream', to: 'downstream', supportPanels: ['1A'] }]
  };
  const needsReview = settle(accepted, {
    status: 'needs_review', crossFigureLogic: pending,
    evidenceFirstStage0: { operationId: accepted.operation.operationId, operationEpoch: 2,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS }
  }, binding, 4000);
  assert.deepEqual(needsReview.result, initial.result);
  assert.deepEqual(needsReview.pendingResult, pending);
  assert.equal(needsReview.status, 'needs_review');
  const complete = settle(accepted, {
    status: 'complete', crossFigureLogic: pending,
    evidenceFirstStage0: { operationId: accepted.operation.operationId, operationEpoch: 2,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS }
  }, binding, 4000);
  assert.deepEqual(complete.result, pending);
  assert.equal(complete.pendingResult, null);
  assert.equal(complete.status, 'complete');
  const changed = settle(accepted, {
    status: 'complete', crossFigureLogic: pending,
    evidenceFirstStage0: { operationId: accepted.operation.operationId, operationEpoch: 2,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS }
  }, { ...binding, baseWorkspaceRevision: 8 }, 4000);
  assert.deepEqual(changed.result, initial.result);
  assert.deepEqual(changed.pendingResult, pending);
  assert.equal(changed.status, 'revision_conflict');

  for (const malformed of [null, [], {}, { mechanismEdges: [] }, {
    mechanismEdges: [{ from: '', to: 'downstream' }]
  }]) {
    const rejected = settle(accepted, {
      status: 'complete', crossFigureLogic: malformed,
    evidenceFirstStage0: { operationId: accepted.operation.operationId, operationEpoch: 2,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS }
    }, binding, 5000);
    assert.deepEqual(rejected.result, initial.result,
      'a malformed complete result must preserve the last complete result');
    assert.equal(rejected.pendingResult, null);
    assert.equal(rejected.status, 'failed');
    assert.equal(rejected.audit.code, 'INVALID_RESPONSE');
  }
  let coercions = 0;
  const hostileCode = settle(accepted, {
    status: 'failed', errorCode: {
      toString() { coercions += 1; throw new Error('must not execute'); }
    },
    evidenceFirstStage0: {
      operationId: accepted.operation.operationId, operationEpoch: 2,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
    }
  }, binding, 5001);
  assert.equal(coercions, 0);
  assert.equal(hostileCode.audit.code, 'PROVIDER_UNAVAILABLE');
});

test('mechanism complete validation fails closed on revoked Proxy DTOs', () => {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const settle = executableContentFunction('settleCrossFigureMechanismState', {
    isSeedableCrossFigureLogicResult,
    SciLLM: EvidenceFirstMechanism
  });
  const binding = {
    documentId: 'sha256:proxy-dto', workspaceId: `workspace:${'2'.repeat(64)}`,
    workspaceGeneration: 7, workspaceLifecycle: 23, baseWorkspaceRevision: 4,
    mechanismChainFingerprint: 'mechanism-chain-v1-22334455'
  };
  const operationId = 'mechanism:proxy-dto-12345678';
  const initial = {
    result: { mechanismEdges: [{ from: 'old-a', to: 'old-b' }] },
    pendingResult: null,
    operation: { operationId, epoch: 1, binding, startedAt: 1000, cancelled: false,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS },
    status: 'working', progress: null, audit: { code: '', updatedAt: 1000 },
    supplementalFingerprint: ''
  };
  const revoked = Proxy.revocable({
    mechanismEdges: [{ from: 'new-a', to: 'new-b' }]
  }, {});
  revoked.revoke();
  assert.equal(isSeedableCrossFigureLogicResult(revoked.proxy), false);
  const rejected = settle(initial, {
    status: 'complete', crossFigureLogic: revoked.proxy,
    evidenceFirstStage0: { operationId, operationEpoch: 1,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS }
  }, binding, 2000);
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.audit.code, 'INVALID_RESPONSE');
  assert.deepEqual(rejected.result, initial.result);
  assert.equal(rejected.pendingResult, null);
});

test('mechanism DTO validation never executes Proxy array getters', () => {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const validate = executableContentFunction('isSeedableCrossFigureLogicResult', {
    crossFigureMechanismOwnData
  });
  let getterReads = 0;
  const edges = new Proxy([{ from: 'node-a', to: 'node-b' }], {
    get() { getterReads += 1; throw new Error('ARRAY_GETTER_EXECUTED'); }
  });
  assert.equal(validate({ mechanismEdges: edges }), true);
  assert.equal(getterReads, 0);
});

test('mechanism progress resets counts on stage changes and is monotonic only within one stage', () => {
  const apply = executableContentFunction('applyCrossFigureMechanismProgress');
  const binding = {
    documentId: 'sha256:document', workspaceId: `workspace:${'8'.repeat(64)}`,
    workspaceGeneration: 2, workspaceLifecycle: 4, baseWorkspaceRevision: 8,
    mechanismChainFingerprint: 'mechanism-chain-v1-1234abcd'
  };
  const operation = {
    operationId: 'mechanism:stage-reset-12345678', epoch: 3, binding,
    startedAt: 1000, cancelled: false
  };
  const base = {
    result: null, pendingResult: null, operation, status: 'working',
    progress: { stage: 'collecting_panel_evidence', completed: 6, total: 6,
      elapsedSeconds: 1, heartbeatAt: 1000 },
    audit: { code: '', updatedAt: 1000 }, supplementalFingerprint: ''
  };
  const changed = apply(base, {
    phase: 'canonicalizing_nodes', operationId: operation.operationId,
    operationEpoch: 3, completedPanels: 0, totalPanels: 0
  }, 2000);
  assert.equal(changed.progress.stage, 'canonicalizing_nodes');
  assert.equal(changed.progress.completed, 0);
  assert.equal(changed.progress.total, 0);
  assert.equal(changed.progress.progressSequence, 1);
  const advanced = apply(changed, {
    phase: 'canonicalizing_nodes', operationId: operation.operationId,
    operationEpoch: 3, completedPanels: 2, totalPanels: 8
  }, 3000);
  const regressed = apply(advanced, {
    phase: 'canonicalizing_nodes', operationId: operation.operationId,
    operationEpoch: 3, completedPanels: 1, totalPanels: 8
  }, 4000);
  assert.equal(regressed.progress.completed, 2);
  assert.equal(regressed.progress.total, 8);
  assert.equal(regressed.progress.progressSequence, 3,
    'every accepted upstream heartbeat advances the monotonic checkpoint');
});

test('content builds one stable-ID generated workspace mutation from the validated evidence-first result', () => {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const build = executableContentFunction(
    'buildGeneratedMechanismV2WorkspaceMutation', {
      crossFigureMechanismOwnData, normalizeCrossFigureMechanismPendingPreview,
      createMechanismGenerationCandidateEnvelope:
        FigureWorkspace.createMechanismGenerationCandidateEnvelope
    }
  );
  const operation = task8MechanismOperation();
  const withFigureOverviewNodes = {
    ...task8MechanismResult(),
    nodes: [{ figureId: 'figure-2', figureLabel: 'Figure 2', role: 'mechanism',
      established: 'Article argument overview; not a biological mechanism node.' }]
  };
  const canonicalProjection = normalizeCrossFigureMechanismPendingPreview(
    withFigureOverviewNodes, 'node-v2'
  );
  assert.ok(canonicalProjection,
    'valid canonical mechanism survives coexisting legacy Figure argument nodes');
  assert.deepEqual(canonicalProjection.nodes.map(node => node.id), [
    `node-v2-${'1'.repeat(16)}`, `node-v2-${'2'.repeat(16)}`
  ]);
  const mutation = build(task8MechanismResult(), operation);
  assert.equal(mutation.type, 'replace_generated_mechanism_v2');
  assert.equal(mutation.expectedRevision, 7);
  assert.equal(typeof mutation.generationEnvelope, 'string');
  assert.equal(Object.hasOwn(mutation, 'generation'), false);
  const generation = JSON.parse(mutation.generationEnvelope);
  assert.equal(generation.identity.operationId, operation.operationId);
  assert.equal(generation.identity.operationEpoch, 3);
  assert.deepEqual(mutation.chain.nodes.map(node => node.id), [
    `node-v2-${'1'.repeat(16)}`, `node-v2-${'2'.repeat(16)}`
  ]);
  assert.deepEqual(mutation.chain.edges[0], {
    id: `relation-v1-${'3'.repeat(16)}`,
    from: `node-v2-${'1'.repeat(16)}`, to: `node-v2-${'2'.repeat(16)}`,
    label: '', polarity: 'negative',
    panelEvidence: [{
      figureId: 'figure-2', panelId: 'A', evidenceClass: 'necessity',
      evidenceClassSource: 'inferred'
    }]
  });
  assert.equal(generation.preview.relations[0]
    .relationKind, 'causal');
  assert.equal(generation.preview.relations[0]
    .context.condition, 'vehicle');
  assert.equal(generation.preview.claims[0].outcome,
    'supports');
});

test('content rejects a legacy v1 live result but restores the same strict durable dialect', () => {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const build = executableContentFunction(
    'buildGeneratedMechanismV2WorkspaceMutation', {
      crossFigureMechanismOwnData, normalizeCrossFigureMechanismPendingPreview,
      createMechanismGenerationCandidateEnvelope:
        FigureWorkspace.createMechanismGenerationCandidateEnvelope
    }
  );
  const settle = executableContentFunction('settleCrossFigureMechanismState', {
    isSeedableCrossFigureLogicResult,
    normalizeCrossFigureMechanismPendingPreview,
    SciLLM: EvidenceFirstMechanism
  });
  const createCrossFigureLogicState = executableContentFunction(
    'createCrossFigureLogicState'
  );
  const restore = executableContentFunction('restoreCrossFigureMechanismState', {
    crossFigureMechanismOwnData,
    normalizeCrossFigureMechanismPendingPreview,
    createCrossFigureLogicState
  });
  const legacy = legacyTask8MechanismResult();
  const operation = task8MechanismOperation();

  assert.ok(normalizeCrossFigureMechanismPendingPreview(legacy),
    'the bounded durable normalizer retains the strict legacy dialect');
  assert.equal(normalizeCrossFigureMechanismPendingPreview(legacy, 'node-v2'), null);
  assert.equal(build(legacy, operation), null,
    'a current workspace mutation cannot be minted from a legacy dialect');
  const settled = settle({
    result: null, pendingResult: null, operation,
    status: 'working', progress: null, audit: { code: '', updatedAt: 0 },
    supplementalFingerprint: ''
  }, {
    status: 'complete', crossFigureLogic: legacy,
    evidenceFirstStage0: {
      operationId: operation.operationId, operationEpoch: operation.epoch,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
    }
  }, operation.binding, 5000);
  assert.equal(settled.status, 'failed');
  assert.equal(settled.audit.code, 'INVALID_RESPONSE');
  assert.equal(settled.result, null);

  const restored = restore({
    result: legacy, pendingResult: null, status: 'complete',
    audit: { code: '', updatedAt: 4000 }, supplementalFingerprint: ''
  });
  assert.equal(restored.status, 'complete');
  assert.ok(restored.result.evidenceFirstMechanism.nodes.every(node =>
    node.nodeId.startsWith('node-v1-')
  ));
});

test('real mapped evidence v2 normalizes settles and commits through the Figure workspace', async () => {
  const result = realMappedTask8MechanismResult();
  assert.ok(result.evidenceFirstMechanism.nodes.every(node =>
    /^node-v2-[a-f0-9]{16}$/u.test(node.nodeId)
  ));
  assert.ok(result.evidenceFirstMechanism.nodes.every(node =>
    ['entity', 'intervention', 'outcome', 'state'].includes(node.nodeType)
  ));
  assert.ok(FigureWorkspace.normalizeGeneratedMechanismPreview(
    result.evidenceFirstMechanism
  ), 'the workspace must accept the current mapped assembler dialect');

  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const buildGeneratedMechanismV2WorkspaceMutation = executableContentFunction(
    'buildGeneratedMechanismV2WorkspaceMutation', {
      crossFigureMechanismOwnData, normalizeCrossFigureMechanismPendingPreview,
      createMechanismGenerationCandidateEnvelope:
        FigureWorkspace.createMechanismGenerationCandidateEnvelope
    }
  );
  const sameCrossFigureMechanismBinding = executableContentFunction(
    'sameCrossFigureMechanismBinding', { crossFigureMechanismOwnData }
  );
  const settle = executableContentFunction('settleCrossFigureMechanismState', {
    isSeedableCrossFigureLogicResult,
    normalizeCrossFigureMechanismPendingPreview,
    SciLLM: EvidenceFirstMechanism
  });
  const operation = task8MechanismOperation();
  const settled = settle({
    result: null, pendingResult: null, operation,
    status: 'working', progress: null, audit: { code: '', updatedAt: 0 },
    supplementalFingerprint: ''
  }, {
    status: 'complete', crossFigureLogic: result,
    evidenceFirstStage0: {
      operationId: operation.operationId, operationEpoch: operation.epoch,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
    }
  }, operation.binding, 5000);
  assert.equal(settled.status, 'complete');
  assert.deepEqual(
    settled.result.evidenceFirstMechanism.nodes.map(node => node.nodeId),
    result.evidenceFirstMechanism.nodes.map(node => node.nodeId)
  );

  let draft = FigureWorkspace.createFigureWorkspaceDraft([{
    figureId: 'figure-2', figureLabel: 'Figure 2', panelHints: ['A']
  }]);
  draft.revision = operation.binding.baseWorkspaceRevision;
  draft.binding = {
    documentId: operation.binding.documentId, documentHash: 'document-hash',
    canonicalUrl: 'https://example.test/paper',
    workspaceId: operation.binding.workspaceId,
    workspaceGeneration: operation.binding.workspaceGeneration
  };
  draft = FigureWorkspace.normalizeFigureWorkspaceDraft(draft);
  const controller = {
    async mutate(mutation) {
      draft = FigureWorkspace.applyFigureWorkspaceMutation(draft, mutation, 5100);
      return { stale: false, revision: draft.revision };
    },
    getDraft: () => draft,
    getCheckpoint: () => null,
    isDirty: () => true
  };
  const commit = executableContentFunction(
    'commitGeneratedMechanismV2ToWorkspace', {
      crossFigureMechanismOwnData,
      buildGeneratedMechanismV2WorkspaceMutation,
      readMechanismGenerationEnvelope:
        FigureWorkspace.readMechanismGenerationEnvelope,
      sameCrossFigureMechanismBinding
    }
  );
  const committed = await commit({
    providerStatus: 'complete', result: settled.result, operation,
    previousResult: null
  }, {
    captureBinding: () => operation.binding,
    ensureController: async () => controller,
    getActiveController: () => controller,
    getLifecycle: () => operation.binding.workspaceLifecycle,
    commitController: () => undefined
  });
  assert.equal(committed.success, true, JSON.stringify(committed));
  assert.equal(draft.revision, operation.binding.baseWorkspaceRevision + 1);
  const audit = FigureWorkspace.readMechanismGenerationAudit(
    draft.mechanismGeneration
  );
  assert.deepEqual(audit.nodes.map(node => node.id),
    result.evidenceFirstMechanism.nodes.map(node => node.nodeId));
});

test('content preserves counter-only evidence as needs-review pending without seeding a graph', async () => {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const build = executableContentFunction(
    'buildGeneratedMechanismV2WorkspaceMutation', {
      crossFigureMechanismOwnData, normalizeCrossFigureMechanismPendingPreview,
      createMechanismGenerationCandidateEnvelope:
        FigureWorkspace.createMechanismGenerationCandidateEnvelope
    }
  );
  const result = task8CounterOnlyMechanismResult();
  const operation = task8MechanismOperation();
  assert.equal(isSeedableCrossFigureLogicResult(result), false,
    'the legacy empty-edge DTO remains non-seedable without strict v2 normalization');
  const pending = normalizeCrossFigureMechanismPendingPreview(result);
  assert.ok(pending);
  const mutation = build(result, operation);
  assert.equal(mutation, null,
    'counter-only canonical metadata is reviewable but never a seedable graph');
  const settle = executableContentFunction('settleCrossFigureMechanismState', {
    isSeedableCrossFigureLogicResult,
    normalizeCrossFigureMechanismPendingPreview,
    SciLLM: EvidenceFirstMechanism
  });
  const previousResult = task8MechanismResult();
  const settled = settle({
    result: previousResult, pendingResult: null, operation,
    status: 'working', progress: null, audit: { code: '', updatedAt: 0 },
    supplementalFingerprint: ''
  }, {
    status: 'needs_review', crossFigureLogic: result,
    evidenceFirstStage0: {
      operationId: operation.operationId, operationEpoch: operation.epoch,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
    }
  }, operation.binding, 5000);
  assert.equal(settled.status, 'needs_review');
  assert.equal(settled.result, previousResult);
  assert.equal(settled.pendingResult.evidenceFirstMechanism.relations[0]
    .relationStatus, 'counter_only');
  assert.equal(settled.pendingResult.evidenceFirstMechanism.relations[0]
    .renderable, false);

  let controllerCalls = 0;
  const commit = executableContentFunction(
    'commitGeneratedMechanismV2ToWorkspace', {
      buildGeneratedMechanismV2WorkspaceMutation: build,
      crossFigureMechanismOwnData,
      sameCrossFigureMechanismBinding: (left, right) =>
        JSON.stringify(left) === JSON.stringify(right)
    }
  );
  const outcome = await commit({
    providerStatus: 'complete', result, operation, previousResult
  }, {
    captureBinding: () => operation.binding,
    ensureController: async () => {
      controllerCalls += 1;
      throw new Error('must not enter controller');
    },
    getActiveController: () => null,
    getLifecycle: () => operation.binding.workspaceLifecycle,
    commitController: () => undefined
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.code, 'INVALID_RESPONSE');
  assert.equal(outcome.result, previousResult);
  assert.equal(controllerCalls, 0);
});

test('content pending preview rejects array-like and hostile outer shapes without coercion', async () => {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const malformed = task8MechanismResult();
  malformed.nodes = {
    0: { id: 'node-source', label: 'Source' }, length: 1
  };
  assert.equal(normalizeCrossFigureMechanismPendingPreview(malformed), null,
    'array-like provider objects must not be accepted as arrays');
  const forgedCases = [
    value => { value.evidenceFirstMechanism.canonicalDigest = 'mechanism-v2-old'; },
    value => { value.evidenceFirstMechanism.nodes[0].nodeId = 'node-forged'; },
    value => { value.evidenceFirstMechanism.relations[0].relationId = 'relation-forged'; },
    value => { value.evidenceFirstMechanism.claims[0].claimId = 'claim-forged'; },
    value => { value.evidenceFirstMechanism.claims[0].sourceAnalysisDigest = 'C:\\private\\paper.txt'; },
    value => { value.evidenceFirstMechanism.claims[0].sourceRefs = ['../../paper.txt']; },
    value => {
      value.evidenceFirstMechanism.claims[0].outcome = 'refutes';
      value.evidenceFirstMechanism.relations[0].assignments[0].role = 'counterclaim';
      value.evidenceFirstMechanism.relations[0].assignments[0].outcome = 'refutes';
    }
  ];
  for (const forge of forgedCases) {
    const candidate = structuredClone(task8MechanismResult());
    forge(candidate);
    assert.equal(normalizeCrossFigureMechanismPendingPreview(candidate), null,
      'a present but noncanonical or scientifically inconsistent v2 preview fails closed');
  }

  let coercions = 0;
  const commit = executableContentFunction(
    'commitGeneratedMechanismV2ToWorkspace', {
      buildGeneratedMechanismV2WorkspaceMutation: () => assert.fail(
        'a hostile terminal status must fail before building a mutation'
      ),
      crossFigureMechanismOwnData,
      sameCrossFigureMechanismBinding: () => false
    }
  );
  const prior = { mechanismEdges: [{ from: 'Old', to: 'Chain' }] };
  const outcome = await commit({
    providerStatus: {
      toString() { coercions += 1; throw new Error('must not execute'); }
    },
    previousResult: prior
  });
  assert.equal(coercions, 0);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.result, prior);
});

test('content generated commit promotes only after one successful controller CAS', async () => {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const buildGeneratedMechanismV2WorkspaceMutation = executableContentFunction(
    'buildGeneratedMechanismV2WorkspaceMutation', {
      crossFigureMechanismOwnData, normalizeCrossFigureMechanismPendingPreview,
      createMechanismGenerationCandidateEnvelope:
        FigureWorkspace.createMechanismGenerationCandidateEnvelope
    }
  );
  const commit = executableContentFunction(
    'commitGeneratedMechanismV2ToWorkspace', {
      buildGeneratedMechanismV2WorkspaceMutation,
      crossFigureMechanismOwnData,
      sameCrossFigureMechanismBinding: (left, right) =>
        JSON.stringify(left) === JSON.stringify(right)
    }
  );
  const operation = task8MechanismOperation();
  const prior = { mechanismEdges: [{ from: 'Old', to: 'Chain' }] };
  const calls = [];
  const controller = {
    mutate: async mutation => {
      calls.push(mutation);
      return { success: true, draft: { revision: 8 } };
    },
    getDraft: () => ({ revision: 8 }), getCheckpoint: () => ({}), isDirty: () => false
  };
  let committed = 0;
  const outcome = await commit({
    providerStatus: 'complete', result: task8MechanismResult(), operation,
    previousResult: prior
  }, {
    captureBinding: () => operation.binding,
    ensureController: async () => controller,
    getActiveController: () => controller,
    getLifecycle: () => 12,
    commitController: () => { committed += 1; }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].expectedRevision, 7);
  assert.equal(committed, 1);
  assert.equal(outcome.status, 'complete');
  assert.equal(outcome.pendingResult, null);
  assert.equal(outcome.result.evidenceFirstMechanism.relations[0].relationKind,
    'causal');
});

test('content generated commit never retries revision conflict and preserves bounded pending preview', async () => {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const buildGeneratedMechanismV2WorkspaceMutation = executableContentFunction(
    'buildGeneratedMechanismV2WorkspaceMutation', {
      crossFigureMechanismOwnData, normalizeCrossFigureMechanismPendingPreview,
      createMechanismGenerationCandidateEnvelope:
        FigureWorkspace.createMechanismGenerationCandidateEnvelope
    }
  );
  const commit = executableContentFunction(
    'commitGeneratedMechanismV2ToWorkspace', {
      buildGeneratedMechanismV2WorkspaceMutation,
      crossFigureMechanismOwnData,
      sameCrossFigureMechanismBinding: (left, right) =>
        JSON.stringify(left) === JSON.stringify(right)
    }
  );
  const operation = task8MechanismOperation();
  const prior = { mechanismEdges: [{ from: 'Old', to: 'Chain' }] };
  let calls = 0;
  const controller = {
    mutate: async () => {
      calls += 1;
      const error = new Error('FIGURE_WORKSPACE_REVISION_CONFLICT');
      error.code = 'FIGURE_WORKSPACE_REVISION_CONFLICT';
      throw error;
    }
  };
  const outcome = await commit({
    providerStatus: 'complete', result: task8MechanismResult(), operation,
    previousResult: prior
  }, {
    captureBinding: () => operation.binding,
    ensureController: async () => controller,
    getActiveController: () => controller,
    getLifecycle: () => 12,
    commitController: () => assert.fail('conflict must not commit memory')
  });
  assert.equal(calls, 1);
  assert.equal(outcome.status, 'revision_conflict');
  assert.equal(outcome.code, 'MECHANISM_REVISION_CONFLICT');
  assert.equal(outcome.result, prior);
  assert.equal(outcome.pendingResult.mechanismEdges[0].from, 'Source');
  assert.equal(outcome.pendingResult.evidenceFirstMechanism.claims[0].outcome,
    'supports');
  assert.equal(Object.hasOwn(outcome.pendingResult, 'providerSecret'), false);
});

test('content generated commit never publishes a lifecycle-stale durable receipt into the new page', async () => {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const buildGeneratedMechanismV2WorkspaceMutation = executableContentFunction(
    'buildGeneratedMechanismV2WorkspaceMutation', {
      crossFigureMechanismOwnData, normalizeCrossFigureMechanismPendingPreview,
      createMechanismGenerationCandidateEnvelope:
        FigureWorkspace.createMechanismGenerationCandidateEnvelope
    }
  );
  const commit = executableContentFunction(
    'commitGeneratedMechanismV2ToWorkspace', {
      buildGeneratedMechanismV2WorkspaceMutation,
      crossFigureMechanismOwnData,
      sameCrossFigureMechanismBinding: (left, right) =>
        JSON.stringify(left) === JSON.stringify(right)
    }
  );
  const operation = task8MechanismOperation();
  const prior = { mechanismEdges: [{ from: 'Old', to: 'Chain' }] };
  let globalCommits = 0;
  const controller = {
    mutate: async () => ({ success: true, stale: true, draft: { revision: 8 } })
  };
  const outcome = await commit({
    providerStatus: 'complete', result: task8MechanismResult(), operation,
    previousResult: prior
  }, {
    captureBinding: () => operation.binding,
    ensureController: async () => controller,
    getActiveController: () => controller,
    getLifecycle: () => 12,
    commitController: () => { globalCommits += 1; }
  });
  assert.equal(globalCommits, 0,
    'an old committed controller must not overwrite the new page globals');
  assert.equal(outcome.status, 'revision_conflict');
  assert.equal(outcome.code, 'MECHANISM_REVISION_CONFLICT');
  assert.equal(outcome.result, prior);
  assert.ok(outcome.pendingResult);
  assert.equal(outcome.durableWorkspaceCommitted, true,
    'a stale projection after controller mutate still proves the workspace CAS committed');
});

test('content generated commit maps persistence failure safely and non-complete states never mutate', async () => {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const buildGeneratedMechanismV2WorkspaceMutation = executableContentFunction(
    'buildGeneratedMechanismV2WorkspaceMutation', {
      crossFigureMechanismOwnData, normalizeCrossFigureMechanismPendingPreview,
      createMechanismGenerationCandidateEnvelope:
        FigureWorkspace.createMechanismGenerationCandidateEnvelope
    }
  );
  const commit = executableContentFunction(
    'commitGeneratedMechanismV2ToWorkspace', {
      buildGeneratedMechanismV2WorkspaceMutation,
      crossFigureMechanismOwnData,
      sameCrossFigureMechanismBinding: (left, right) =>
        JSON.stringify(left) === JSON.stringify(right)
    }
  );
  const operation = task8MechanismOperation();
  const prior = { mechanismEdges: [{ from: 'Old', to: 'Chain' }] };
  let calls = 0;
  const failingController = {
    mutate: async () => {
      calls += 1;
      throw Object.assign(new Error('private disk path'), { code: 'SAVE_FAILED' });
    }
  };
  const dependencies = {
    captureBinding: () => operation.binding,
    ensureController: async () => failingController,
    getActiveController: () => failingController,
    getLifecycle: () => 12,
    commitController: () => assert.fail('failure must not commit memory')
  };
  const failed = await commit({
    providerStatus: 'complete', result: task8MechanismResult(), operation,
    previousResult: prior
  }, dependencies);
  assert.equal(calls, 1);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.code, 'MECHANISM_WORKSPACE_COMMIT_FAILED');
  assert.equal(failed.result, prior);
  assert.ok(failed.pendingResult);
  for (const providerStatus of ['needs_review', 'failed', 'cancelled']) {
    const skipped = await commit({
      providerStatus, result: task8MechanismResult(), operation,
      previousResult: prior
    }, dependencies);
    assert.equal(skipped.status, providerStatus);
  }
  assert.equal(calls, 1, 'non-complete outcomes must never enter the workspace controller');
});

test('bounded pending mechanism state survives both archive restore paths without raw provider fields', () => {
  const script = read('content.js');
  const restore = executableContentFunction('restoreCrossFigureMechanismState', {
    createCrossFigureLogicState: result => ({
      result, pendingResult: null, operation: null, status: result ? 'complete' : 'idle',
      progress: null, audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    }),
    normalizeCrossFigureMechanismPendingPreview: value => {
      if (!value?.mechanismEdges || !value?.evidenceFirstMechanism) return null;
      return task8MechanismResult();
    },
    crossFigureMechanismOwnData: (value, key) =>
      Object.getOwnPropertyDescriptor(value, key)?.value
  });
  const saved = {
    result: task8MechanismResult(), pendingResult: {
      ...task8MechanismResult(), providerSecret: 'must-not-restore'
    },
    status: 'revision_conflict',
    audit: { code: 'MECHANISM_REVISION_CONFLICT', updatedAt: 1234 },
    supplementalFingerprint: 'supplemental-v1'
  };
  const restored = restore(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.status, 'revision_conflict');
  assert.equal(restored.audit.code, 'MECHANISM_REVISION_CONFLICT');
  assert.equal(restored.pendingResult.evidenceFirstMechanism.relations[0]
    .relationKind, 'causal');
  assert.equal(Object.hasOwn(restored.pendingResult, 'providerSecret'), false);
  let timestampCoercions = 0;
  const hostileTimestamp = restore({
    ...saved,
    audit: {
      code: 'MECHANISM_REVISION_CONFLICT',
      updatedAt: {
        valueOf() { timestampCoercions += 1; throw new Error('must not execute'); }
      }
    }
  });
  assert.equal(timestampCoercions, 0);
  assert.equal(hostileTimestamp.audit.updatedAt, 0);
  const interrupted = restore({
    result: task8MechanismResult(), pendingResult: task8MechanismResult(),
    status: 'working',
    audit: { code: 'MECHANISM_COMMIT_PENDING', updatedAt: 2345 },
    supplementalFingerprint: 'supplemental-v1'
  });
  assert.equal(interrupted.status, 'revision_conflict',
    'a crash during durable CAS must restore as an explicit reviewable interruption');
  assert.equal(interrupted.audit.code, 'MECHANISM_COMMIT_INTERRUPTED');
  assert.ok(interrupted.result, 'the last complete result remains visible');
  assert.ok(interrupted.pendingResult, 'the bounded candidate survives recovery');
  const interruptedWithoutPrior = restore({
    result: null, pendingResult: task8MechanismResult(), status: 'queued',
    audit: { code: 'MECHANISM_COMMIT_PENDING', updatedAt: 3456 }
  });
  assert.equal(interruptedWithoutPrior.status, 'revision_conflict');
  assert.equal(interruptedWithoutPrior.audit.code, 'MECHANISM_COMMIT_INTERRUPTED');
  assert.ok(interruptedWithoutPrior.pendingResult);
  const interruptedWithRejectedCandidate = restore({
    result: task8MechanismResult(), pendingResult: { providerSecret: 'reject' },
    status: 'working', audit: { code: 'MECHANISM_COMMIT_PENDING', updatedAt: 4567 }
  });
  assert.equal(interruptedWithRejectedCandidate.status, 'revision_conflict');
  assert.equal(interruptedWithRejectedCandidate.audit.code,
    'MECHANISM_COMMIT_INTERRUPTED');
  assert.equal(interruptedWithRejectedCandidate.pendingResult, null,
    'an invalid candidate is dropped without disguising an interrupted commit as complete');
  assert.ok((script.match(/restoreCrossFigureMechanismState\(/gu) || []).length >= 3,
    'both direct archive restore and asset restore must use the bounded restore helper');
});

test('exact-owner mechanism cleanup intent survives archive restore and fresh-realm recovery', async () => {
  const script = read('content.js');
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const buildControl = executableContentFunction(
    'buildCrossFigureMechanismControlMessage', { crossFigureMechanismOwnData: own }
  );
  const normalizeIntent = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntent', {
      crossFigureMechanismOwnData: own
    }
  );
  const normalizeIntents = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntents', {
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const serialize = executableContentFunction(
    'serializeCrossFigureMechanismCleanupIntents', {
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const hydrate = executableContentFunction(
    'hydrateCrossFigureMechanismCleanupIntents', {
      normalizeCrossFigureMechanismCleanupIntents: normalizeIntents,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const operation = {
    ...task8MechanismOperation(),
    providerSecret: 'must-never-survive-cleanup-archive'
  };
  const controlMessage = buildControl(operation, 'cancel');
  const sourceIntents = new Map([[operation.operationId, {
    operation,
    operationId: operation.operationId,
    command: 'cancel',
    controlMessage,
    serializedControl: JSON.stringify(controlMessage),
    primaryCode: 'MECHANISM_OPERATION_CANCELLED',
    cleanupPending: true,
    cleanupErrorCode: 'NETWORK_ERROR'
  }]]);
  const serialized = serialize(sourceIntents);
  assert.equal(serialized.length, 1);
  assert.deepEqual(Object.keys(serialized[0]).sort(), [
    'cleanupErrorCode', 'controlMessage', 'phase', 'primaryCode', 'version'
  ]);
  assert.doesNotMatch(JSON.stringify(serialized), /providerSecret|must-never-survive/u);
  assert.deepEqual(serialized[0].controlMessage, controlMessage);

  const restore = executableContentFunction('restoreCrossFigureMechanismState', {
    createCrossFigureLogicState: result => ({
      result, pendingResult: null, operation: null,
      status: result ? 'complete' : 'idle', progress: null,
      audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    }),
    normalizeCrossFigureMechanismPendingPreview: () => null,
    normalizeCrossFigureMechanismCleanupIntents: normalizeIntents,
    crossFigureMechanismOwnData: own
  });
  const restoredState = restore(JSON.parse(JSON.stringify({
    status: 'idle', cleanupIntents: serialized
  })));
  assert.equal(restoredState.cleanupIntents.length, 1);

  const freshIntents = new Map();
  const hydrated = hydrate(restoredState.cleanupIntents, freshIntents);
  assert.deepEqual(hydrated, { restored: 1, rejected: 0, conflicts: 0 });
  const restoredIntent = freshIntents.get(operation.operationId);
  assert.equal(restoredIntent.retryReady, true);
  assert.deepEqual(buildControl(restoredIntent.operation, 'cancel'), controlMessage);

  const sent = [];
  const queue = executableContentFunction('queueCrossFigureMechanismCleanup', {
    crossFigureLogicCleanupIntents: freshIntents,
    crossFigureMechanismOwnData: own,
    buildCrossFigureMechanismControlMessage: buildControl,
    chrome: { runtime: { sendMessage: async message => {
      sent.push(message);
      return { success: true, data: {
        operationId: operation.operationId, cancelled: true
      } };
    } } }
  });
  const recover = executableContentFunction(
    'recoverPendingCrossFigureMechanismCleanup', {
      crossFigureLogicCleanupIntents: freshIntents,
      queueCrossFigureMechanismCleanup: queue
    }
  );
  assert.deepEqual(await recover(), { recovered: true });
  assert.equal(freshIntents.size, 0);
  assert.deepEqual(sent, [controlMessage]);
  assert.match(script,
    /cleanupIntents:\s*serializeCrossFigureMechanismCleanupIntents\(/u,
    'Figure workspace snapshots must persist pending exact-owner cleanup intents');
  assert.match(script,
    /\['mechanism\/cleanup-intents\.json',\s*\{[\s\S]*?serializeCrossFigureMechanismCleanupIntents\(\)/u,
    'workspace saves need a dedicated current-value cleanup checkpoint');
  assert.match(script,
    /path === MECHANISM_CLEANUP_INTENTS_ASSET_PATH[\s\S]*?serializeCrossFigureMechanismCleanupIntents\(\)/u,
    'stale captured autosaves must rebuild cleanup intents at write time');
  const workspaceAssetsStart = script.indexOf('function buildArticleWorkspaceAssets');
  const cleanupAssetIndex = script.indexOf("['mechanism/cleanup-intents.json'", workspaceAssetsStart);
  const inventoryAssetIndex = script.indexOf("['figures/inventory.json'", workspaceAssetsStart);
  assert.ok(cleanupAssetIndex > workspaceAssetsStart && cleanupAssetIndex < inventoryAssetIndex,
    'the authoritative cleanup checkpoint must commit before the legacy inventory projection');
  assert.ok((script.match(/hydrateCrossFigureMechanismCleanupIntents\(/gu) || []).length >= 3,
    'both archive and asset restore paths must hydrate pending cleanup intents');
});

test('cleanup intent restore rejects duplicate operation ids with conflicting owners', () => {
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const normalizeIntent = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntent', {
      crossFigureMechanismOwnData: own
    }
  );
  const normalizeIntents = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntents', {
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const base = {
    version: 'mechanism-cleanup-intent-v1',
    primaryCode: 'MECHANISM_OPERATION_CANCELLED', cleanupErrorCode: '',
    controlMessage: {
      type: 'LLM_CONTROL_OPERATION', operationScope: 'mechanism', command: 'cancel',
      operationId: 'mechanism:cleanup-conflict-12345678',
      evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
      documentId: 'sha256:cleanup-conflict', workspaceId: `workspace:${'a'.repeat(64)}`,
      workspaceGeneration: 2, workspaceLifecycle: 3, baseWorkspaceRevision: 1,
      mechanismChainFingerprint: 'mechanism-chain-v1-aabbccdd',
      ...EVIDENCE_FIRST_VERSIONS
    }
  };
  const conflicting = structuredClone(base);
  conflicting.controlMessage.workspaceLifecycle = 4;
  const normalized = normalizeIntents([base, conflicting]);
  assert.deepEqual(normalized, []);
  const initialLifecycle = structuredClone(base);
  initialLifecycle.controlMessage.workspaceLifecycle = 0;
  assert.ok(normalizeIntent(initialLifecycle),
    'the first content lifecycle is a valid exact owner, not an absent binding');
  const forgedPending = structuredClone(base);
  forgedPending.phase = 'commit_pending';
  assert.equal(normalizeIntent(forgedPending), null,
    'commit-pending must carry a non-mutating status command');
  const forgedReady = structuredClone(base);
  forgedReady.phase = 'cleanup_ready';
  forgedReady.controlMessage.command = 'status';
  assert.equal(normalizeIntent(forgedReady), null,
    'a ready cleanup cannot disguise a status envelope as a terminal command');
  const hydrate = executableContentFunction(
    'hydrateCrossFigureMechanismCleanupIntents', {
      normalizeCrossFigureMechanismCleanupIntents: normalizeIntents,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const preserved = new Map([['existing', { serializedControl: 'existing' }]]);
  assert.throws(
    () => hydrate([base, conflicting], preserved, { strict: true, replace: true }),
    error => error?.code === 'MECHANISM_CLEANUP_CHECKPOINT_INVALID'
  );
  assert.equal(preserved.size, 1,
    'strict conflict validation must finish before replacing live cleanup intents');
  assert.deepEqual(
    hydrate([], preserved, { strict: true, replace: true }),
    { restored: 0, rejected: 0, conflicts: 0 }
  );
  assert.equal(preserved.size, 0,
    'an authoritative empty checkpoint must prevent legacy intent resurrection');
});

test('mechanism cleanup intent capacity fails closed without evicting an owner', () => {
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const buildControl = executableContentFunction(
    'buildCrossFigureMechanismControlMessage', { crossFigureMechanismOwnData: own }
  );
  const intents = new Map(Array.from({ length: 64 }, (_, index) => [
    `mechanism:retained-cleanup-${index}-12345678`,
    { cleanupPending: true }
  ]));
  let sends = 0;
  const queue = executableContentFunction('queueCrossFigureMechanismCleanup', {
    crossFigureLogicCleanupIntents: intents,
    crossFigureMechanismOwnData: own,
    buildCrossFigureMechanismControlMessage: buildControl,
    chrome: { runtime: { sendMessage: async () => { sends += 1; } } }
  });
  assert.throws(
    () => queue(task8MechanismOperation(), 'cancel'),
    error => error?.code === 'MECHANISM_CLEANUP_CAPACITY_EXCEEDED'
  );
  assert.equal(intents.size, 64);
  assert.equal(sends, 0);
});

test('committed mechanism release is write-ahead durable across every crash window', async () => {
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const buildControl = executableContentFunction(
    'buildCrossFigureMechanismControlMessage', { crossFigureMechanismOwnData: own }
  );
  const normalizeIntent = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntent', {
      crossFigureMechanismOwnData: own
    }
  );
  const normalizeIntents = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntents', {
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const hydrate = executableContentFunction(
    'hydrateCrossFigureMechanismCleanupIntents', {
      normalizeCrossFigureMechanismCleanupIntents: normalizeIntents,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const recoverCommitted = executableContentFunction(
    'committedCrossFigureMechanismOperation', {
      crossFigureMechanismOwnData: own
    }
  );
  const finalize = executableContentFunction(
    'finalizeCommittedCrossFigureMechanismOperation', {
      crossFigureMechanismOwnData: own,
      buildCrossFigureMechanismControlMessage: buildControl,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const sourceOperation = task8MechanismOperation();
  const committedSnapshot = {
    status: 'complete', evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
    identity: {
      ...sourceOperation.binding,
      operationId: sourceOperation.operationId,
      operationEpoch: sourceOperation.epoch
    },
    committedWorkspaceRevision: sourceOperation.binding.baseWorkspaceRevision + 1,
    preview: { status: 'complete' }
  };
  const recoveredOperation = recoverCommitted({ mechanismGeneration: 'durable-envelope' }, {
    readEnvelope: value => value === 'durable-envelope' ? committedSnapshot : null
  });
  assert.equal(recoveredOperation.operationId, sourceOperation.operationId,
    'a crash after workspace commit but before intent creation is recoverable from the commit');
  assert.deepEqual(recoveredOperation.binding, sourceOperation.binding);
  assert.deepEqual(recoveredOperation.evidenceFirstVersions, EVIDENCE_FIRST_VERSIONS);

  let durableIntents = [];
  let releaseInitialPersist;
  let markInitialPersist;
  const initialPersistStarted = new Promise(resolve => { markInitialPersist = resolve; });
  const initialPersistGate = new Promise(resolve => { releaseInitialPersist = resolve; });
  const order = [];
  let sends = 0;
  const firstIntents = new Map();
  const firstRun = finalize(recoveredOperation, {
    intents: firstIntents,
    persistCleanupCheckpoint: async records => {
      order.push(`persist:${records.length}`);
      markInitialPersist();
      await initialPersistGate;
      durableIntents = structuredClone(records);
      return { saved: true };
    },
    sendMessage: async message => {
      order.push('release');
      sends += 1;
      assert.equal(message.evidenceFirstVersion, '2');
      assert.equal(message.evidenceFirstRouterVersion, '2');
      assert.deepEqual(message.evidenceFirstVersions, EVIDENCE_FIRST_VERSIONS);
      assert.equal(message.baseWorkspaceRevision,
        recoveredOperation.binding.baseWorkspaceRevision);
      return { success: true, data: {
        operationId: recoveredOperation.operationId,
        released: true, compacted: true, cleanupPending: false
      } };
    }
  });
  await initialPersistStarted;
  assert.equal(sends, 0,
    'release cannot be sent before the dedicated non-empty checkpoint ACK');
  releaseInitialPersist();
  const firstResult = await firstRun;
  assert.equal(firstResult.released, true);
  assert.equal(firstResult.cleanupPending, false);
  assert.deepEqual(order, ['persist:1', 'release', 'persist:0']);
  assert.deepEqual(durableIntents, []);

  // Crash/failure after the non-empty checkpoint and before a release ACK.
  const beforeSendIntents = new Map();
  durableIntents = [];
  const beforeSend = await finalize(recoveredOperation, {
    intents: beforeSendIntents,
    persistCleanupCheckpoint: async records => {
      durableIntents = structuredClone(records);
      return { saved: true };
    },
    sendMessage: async () => { throw new Error('simulated process loss before ACK'); }
  });
  assert.equal(beforeSend.cleanupPending, true);
  assert.equal(durableIntents.length, 1);
  assert.equal(durableIntents[0].controlMessage.command, 'release');

  const restoredBeforeSend = new Map();
  assert.equal(hydrate(durableIntents, restoredBeforeSend, {
    strict: true, replace: true
  }).restored, 1);
  let providerCalls = 0;
  const replayBeforeSend = await finalize(recoveredOperation, {
    intents: restoredBeforeSend,
    persistCleanupCheckpoint: async records => {
      durableIntents = structuredClone(records);
      return { saved: true };
    },
    sendMessage: async message => ({ success: true, data: {
      operationId: message.operationId, released: true
    } }),
    dispatchProvider: async () => { providerCalls += 1; }
  });
  assert.equal(replayBeforeSend.released, true);
  assert.deepEqual(durableIntents, []);
  assert.equal(providerCalls, 0, 'same-ID cleanup replay must never dispatch the provider');

  // Crash/failure after release ACK but before the empty checkpoint ACK.
  const afterSendIntents = new Map();
  durableIntents = [];
  let persistCalls = 0;
  let releaseCalls = 0;
  const afterSend = await finalize(recoveredOperation, {
    intents: afterSendIntents,
    persistCleanupCheckpoint: async records => {
      persistCalls += 1;
      if (persistCalls === 2) throw new Error('simulated loss before clear ACK');
      durableIntents = structuredClone(records);
      return { saved: true };
    },
    sendMessage: async message => {
      releaseCalls += 1;
      return { success: true, data: {
        operationId: message.operationId, released: true
      } };
    }
  });
  assert.equal(afterSend.cleanupPending, true,
    'a failed empty-checkpoint ACK preserves replay intent without changing primary success');
  assert.equal(releaseCalls, 1);
  assert.equal(durableIntents.length, 1);

  const restoredAfterSend = new Map();
  hydrate(durableIntents, restoredAfterSend, { strict: true, replace: true });
  const replayAfterSend = await finalize(recoveredOperation, {
    intents: restoredAfterSend,
    persistCleanupCheckpoint: async records => {
      durableIntents = structuredClone(records);
      return { saved: true };
    },
    sendMessage: async message => {
      releaseCalls += 1;
      return { success: true, data: {
        operationId: message.operationId, released: true
      } };
    }
  });
  assert.equal(replayAfterSend.released, true);
  assert.equal(releaseCalls, 2, 'an idempotent exact-owner release is replayed once');
  assert.deepEqual(durableIntents, []);
});

test('terminal mechanism commit-pending intent is durable before mutation and never sends cleanup', async () => {
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const buildControl = executableContentFunction(
    'buildCrossFigureMechanismControlMessage', { crossFigureMechanismOwnData: own }
  );
  const normalizeIntent = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntent', {
      crossFigureMechanismOwnData: own
    }
  );
  const stage = executableContentFunction(
    'stageCrossFigureMechanismCommitPending', {
      crossFigureMechanismOwnData: own,
      buildCrossFigureMechanismControlMessage: buildControl,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const operation = task8MechanismOperation();
  const intents = new Map();
  const order = [];
  let releasePersist;
  let markPersistStarted;
  const persistStarted = new Promise(resolve => { markPersistStarted = resolve; });
  const persistGate = new Promise(resolve => { releasePersist = resolve; });
  const stagedPromise = stage(operation, {
    intents,
    persistCleanupCheckpoint: async records => {
      order.push(`persist:${records[0]?.phase}:${records[0]?.controlMessage?.command}`);
      markPersistStarted();
      await persistGate;
      return { saved: true };
    },
    sendMessage: async () => assert.fail(
      'commit-pending is a durable decision intent, never a cleanup command'
    )
  });
  await persistStarted;
  assert.deepEqual(order, ['persist:commit_pending:status']);
  assert.equal(intents.get(operation.operationId)?.cleanupPending, true);
  releasePersist();
  assert.deepEqual(await stagedPromise, {
    staged: true, commitPending: true, cleanupPending: true,
    cleanupErrorCode: ''
  });
  assert.equal(intents.get(operation.operationId)?.phase, 'commit_pending');
  assert.equal(intents.get(operation.operationId)?.command, 'status');
});

test('commit-pending recovery chooses release only for the exact authoritative generation', async () => {
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const buildControl = executableContentFunction(
    'buildCrossFigureMechanismControlMessage', { crossFigureMechanismOwnData: own }
  );
  const normalizeIntent = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntent', {
      crossFigureMechanismOwnData: own
    }
  );
  const stage = executableContentFunction(
    'stageCrossFigureMechanismCommitPending', {
      crossFigureMechanismOwnData: own,
      buildCrossFigureMechanismControlMessage: buildControl,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const recover = executableContentFunction(
    'recoverPendingCrossFigureMechanismCleanup', {
      crossFigureLogicCleanupIntents: new Map(),
      crossFigureMechanismOwnData: own,
      buildCrossFigureMechanismControlMessage: buildControl,
      queueCrossFigureMechanismCleanup: () => assert.fail(
        'a terminal decision cannot fall back to cancel'
      )
    }
  );
  const operation = task8MechanismOperation();
  const decisions = [];
  const runCase = async committed => {
    const intents = new Map();
    await stage(operation, {
      intents,
      persistCleanupCheckpoint: async () => ({ saved: true })
    });
    assert.equal(intents.get(operation.operationId)?.phase, 'commit_pending');
    const result = await recover({
      intents,
      authoritativeDraft: true,
      draft: { authoritative: true },
      releasedOperationIds: new Set(),
      recoverCommitted: () => committed ? operation : null,
      finalizeCommitted: async (resolved, options) => {
        const command = options?.cleanupCommand;
        decisions.push(command);
        assert.equal(resolved.operationId, operation.operationId);
        intents.delete(operation.operationId);
        return command === 'release'
          ? { released: true, cleanupPending: false }
          : { released: false, abandoned: true, cleanupPending: false };
      }
    });
    assert.deepEqual(result, { recovered: true });
    assert.equal(intents.size, 0,
      'a decided terminal cleanup cannot poison a later admission');
  };
  await runCase(true);
  await runCase(false);
  assert.deepEqual(decisions, ['release', 'abandon']);
});

test('fresh realm restores commit-pending intent and abandons provider-free after authoritative miss', async () => {
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const buildControl = executableContentFunction(
    'buildCrossFigureMechanismControlMessage', { crossFigureMechanismOwnData: own }
  );
  const normalizeIntent = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntent', {
      crossFigureMechanismOwnData: own
    }
  );
  const normalizeIntents = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntents', {
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const serialize = executableContentFunction(
    'serializeCrossFigureMechanismCleanupIntents', {
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const hydrate = executableContentFunction(
    'hydrateCrossFigureMechanismCleanupIntents', {
      normalizeCrossFigureMechanismCleanupIntents: normalizeIntents,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const stage = executableContentFunction(
    'stageCrossFigureMechanismCommitPending', {
      crossFigureMechanismOwnData: own,
      buildCrossFigureMechanismControlMessage: buildControl,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const operation = task8MechanismOperation();
  const firstRealm = new Map();
  await stage(operation, {
    intents: firstRealm,
    persistCleanupCheckpoint: async () => ({ saved: true })
  });
  const durable = JSON.parse(JSON.stringify(serialize(firstRealm)));
  assert.equal(durable.length, 1);
  assert.equal(durable[0].phase, 'commit_pending');
  assert.equal(durable[0].controlMessage.command, 'status');

  const freshRealm = new Map();
  assert.deepEqual(hydrate(durable, freshRealm, {
    strict: true, replace: true
  }), { restored: 1, rejected: 0, conflicts: 0 });
  let providerCalls = 0;
  const decisions = [];
  const recover = executableContentFunction(
    'recoverPendingCrossFigureMechanismCleanup', {
      crossFigureLogicCleanupIntents: freshRealm,
      crossFigureMechanismOwnData: own,
      buildCrossFigureMechanismControlMessage: buildControl,
      queueCrossFigureMechanismCleanup: () => assert.fail(
        'restored commit-pending cannot become cancel'
      )
    }
  );
  assert.deepEqual(await recover({
    intents: freshRealm,
    authoritativeDraft: true,
    draft: { mechanismGeneration: null },
    recoverCommitted: () => null,
    finalizeCommitted: async (resolved, options) => {
      decisions.push(options?.cleanupCommand);
      assert.equal(resolved.operationId, operation.operationId);
      freshRealm.delete(operation.operationId);
      return { released: false, abandoned: true, cleanupPending: false };
    },
    dispatchProvider: async () => { providerCalls += 1; }
  }), { recovered: true });
  assert.deepEqual(decisions, ['abandon']);
  assert.equal(providerCalls, 0);
  assert.equal(freshRealm.size, 0);
});

test('abandon requires its strict ACK and clears intent only after empty checkpoint ACK', async () => {
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const buildControl = executableContentFunction(
    'buildCrossFigureMechanismControlMessage', { crossFigureMechanismOwnData: own }
  );
  const normalizeIntent = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntent', {
      crossFigureMechanismOwnData: own
    }
  );
  const stage = executableContentFunction(
    'stageCrossFigureMechanismCommitPending', {
      crossFigureMechanismOwnData: own,
      buildCrossFigureMechanismControlMessage: buildControl,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const finalize = executableContentFunction(
    'finalizeCommittedCrossFigureMechanismOperation', {
      crossFigureMechanismOwnData: own,
      buildCrossFigureMechanismControlMessage: buildControl,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const operation = task8MechanismOperation();
  const invalidAcks = [{
    success: true, data: {
      operationId: operation.operationId, abandoned: true, compacted: true,
      cleanupComplete: true, released: true
    }
  }, {
    success: true, data: {
      operationId: operation.operationId, abandoned: true, compacted: true,
      released: false
    }
  }, {
    success: true, data: {
      operationId: 'mechanism:wrong-owner-12345678', abandoned: true,
      compacted: true, cleanupComplete: true, released: false
    }
  }];
  for (const response of invalidAcks) {
    const intents = new Map();
    await stage(operation, {
      intents,
      persistCleanupCheckpoint: async () => ({ saved: true })
    });
    const persisted = [];
    const result = await finalize(operation, {
      intents, cleanupCommand: 'abandon',
      persistCleanupCheckpoint: async records => {
        persisted.push(structuredClone(records));
        return { saved: true };
      },
      sendMessage: async () => response
    });
    assert.equal(result.abandoned, false);
    assert.equal(result.released, false);
    assert.equal(result.cleanupPending, true);
    assert.equal(intents.has(operation.operationId), true);
    assert.equal(persisted.length, 1,
      'an invalid ACK cannot clear the durable intent checkpoint');
    assert.equal(persisted[0][0].controlMessage.command, 'abandon');
  }

  const intents = new Map();
  await stage(operation, {
    intents,
    persistCleanupCheckpoint: async () => ({ saved: true })
  });
  const writes = [];
  let providerCalls = 0;
  const validAck = { success: true, data: {
    operationId: operation.operationId, abandoned: true, compacted: true,
    cleanupComplete: true, released: false
  } };
  const result = await finalize(operation, {
    intents, cleanupCommand: 'abandon',
    persistCleanupCheckpoint: async records => {
      writes.push(structuredClone(records));
      return { saved: true };
    },
    sendMessage: async message => {
      assert.equal(message.command, 'abandon');
      return validAck;
    },
    dispatchProvider: async () => { providerCalls += 1; }
  });
  assert.deepEqual(result, {
    released: false, abandoned: true,
    cleanupPending: false, cleanupErrorCode: ''
  });
  assert.equal(providerCalls, 0);
  assert.deepEqual(writes.map(records => records.length), [1, 0]);
  assert.equal(intents.size, 0);

  const lostClear = new Map();
  await stage(operation, {
    intents: lostClear,
    persistCleanupCheckpoint: async () => ({ saved: true })
  });
  let persistCalls = 0;
  const pending = await finalize(operation, {
    intents: lostClear, cleanupCommand: 'abandon',
    persistCleanupCheckpoint: async records => {
      persistCalls += 1;
      if (records.length === 0) throw new Error('lost empty checkpoint ACK');
      return { saved: true };
    },
    sendMessage: async () => validAck
  });
  assert.equal(pending.cleanupPending, true);
  assert.equal(lostClear.has(operation.operationId), true);
  assert.equal(persistCalls, 2);
});

test('content abandon intent converges through the real exact-owner router without provider replay', async () => {
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const buildControl = executableContentFunction(
    'buildCrossFigureMechanismControlMessage', { crossFigureMechanismOwnData: own }
  );
  const normalizeIntent = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntent', {
      crossFigureMechanismOwnData: own
    }
  );
  const finalize = executableContentFunction(
    'finalizeCommittedCrossFigureMechanismOperation', {
      crossFigureMechanismOwnData: own,
      buildCrossFigureMechanismControlMessage: buildControl,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const memoryStorage = () => {
    const values = {};
    return {
      values,
      get(query, callback) {
        const keys = Array.isArray(query) ? query
          : query && typeof query === 'object' ? Object.keys(query) : [query];
        const result = {};
        for (const key of keys) {
          if (Object.hasOwn(values, key)) result[key] = values[key];
          else if (query && typeof query === 'object' && !Array.isArray(query)) {
            result[key] = query[key];
          }
        }
        callback(result);
      },
      set(input, callback) {
        Object.assign(values, structuredClone(input));
        callback?.();
      },
      remove(keys, callback) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
        callback?.();
      }
    };
  };
  const storageArea = memoryStorage();
  const sessionStorageArea = memoryStorage();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const originalFactory = globalThis.SciLLM.createMechanismOperationCoordinator;
  let coordinator = null;
  globalThis.SciLLM.createMechanismOperationCoordinator = options => {
    coordinator = originalFactory(options);
    return coordinator;
  };
  let router;
  try {
    router = createBackgroundRouter({
      storageArea,
      sessionStorageArea,
      cacheStore,
      corpusStore: {},
      documentStore: {},
      figureProviderAttemptLedger: {},
      runtimeExtensionId: 'extension-id',
      fetchImpl: async () => assert.fail('cleanup must not dispatch a provider')
    });
  } finally {
    globalThis.SciLLM.createMechanismOperationCoordinator = originalFactory;
  }
  assert.ok(coordinator, 'the real router must own a durable mechanism coordinator');

  const operation = task8MechanismOperation();
  const owner = {
    trustedExtensionSender: true,
    senderExtensionId: 'extension-id',
    senderTabId: 29,
    senderFrameId: 0,
    senderDocumentId: '29292929-2929-4929-8929-292929292929'
  };
  const durableOperation = await coordinator.beginEvidenceFirstOperation({
    operationId: operation.operationId,
    documentId: operation.binding.documentId,
    documentHash: 'a'.repeat(64),
    workspaceId: operation.binding.workspaceId,
    workspaceGeneration: operation.binding.workspaceGeneration,
    workspaceLifecycle: operation.binding.workspaceLifecycle,
    baseWorkspaceRevision: operation.binding.baseWorkspaceRevision,
    mechanismChainFingerprint: operation.binding.mechanismChainFingerprint,
    profileSignature: '',
    senderExtensionId: owner.senderExtensionId,
    senderTabId: owner.senderTabId,
    senderFrameId: owner.senderFrameId,
    senderDocumentId: owner.senderDocumentId
  });
  await coordinator.finalize(durableOperation, 'failed');

  const controlMessage = buildControl(operation, 'abandon');
  const wrongOwner = await router.handle(controlMessage, {
    ...owner, senderTabId: owner.senderTabId + 1
  });
  assert.equal(wrongOwner.success, false);
  assert.equal(wrongOwner.error.code, 'MECHANISM_OPERATION_STALE');
  const unscoped = await router.handle({
    ...controlMessage, operationScope: undefined
  }, owner);
  assert.equal(unscoped.success, false);
  assert.equal(unscoped.error.code, 'INVALID_SETTINGS');

  const intents = new Map();
  const checkpointWrites = [];
  let firstAck = null;
  let providerCalls = 0;
  const result = await finalize(operation, {
    intents,
    cleanupCommand: 'abandon',
    persistCleanupCheckpoint: async records => {
      checkpointWrites.push(structuredClone(records));
      return { saved: true };
    },
    sendMessage: async message => {
      firstAck = await router.handle(message, owner);
      return firstAck;
    },
    dispatchProvider: async () => { providerCalls += 1; }
  });
  assert.deepEqual(result, {
    released: false,
    abandoned: true,
    cleanupPending: false,
    cleanupErrorCode: ''
  });
  assert.equal(firstAck.success, true, JSON.stringify(firstAck));
  assert.deepEqual({
    operationId: firstAck.data.operationId,
    abandoned: firstAck.data.abandoned,
    compacted: firstAck.data.compacted,
    cleanupComplete: firstAck.data.cleanupComplete,
    released: firstAck.data.released
  }, {
    operationId: operation.operationId,
    abandoned: true,
    compacted: true,
    cleanupComplete: true,
    released: false
  });
  assert.deepEqual(checkpointWrites.map(records => records.length), [1, 0]);
  assert.equal(intents.size, 0);
  assert.equal(providerCalls, 0);

  const replay = await router.handle(controlMessage, owner);
  assert.deepEqual(replay, firstAck, 'a lost exact ACK must replay byte-equivalently');
  let providerClaims = 0;
  await assert.rejects(
    coordinator.beginEvidenceFirstOperation({
      operationId: operation.operationId,
      documentId: operation.binding.documentId,
      documentHash: 'a'.repeat(64),
      workspaceId: operation.binding.workspaceId,
      workspaceGeneration: operation.binding.workspaceGeneration,
      workspaceLifecycle: operation.binding.workspaceLifecycle,
      baseWorkspaceRevision: operation.binding.baseWorkspaceRevision,
      mechanismChainFingerprint: operation.binding.mechanismChainFingerprint,
      profileSignature: '',
      senderExtensionId: owner.senderExtensionId,
      senderTabId: owner.senderTabId,
      senderFrameId: owner.senderFrameId,
      senderDocumentId: owner.senderDocumentId
    }).then(async restored => {
      providerClaims += 1;
      return coordinator.claimProviderRequest(restored);
    }),
    error => error?.code === 'MECHANISM_OPERATION_FINALIZED'
  );
  assert.equal(providerClaims, 0);
  assert.equal((await cacheStore.listProtectedByPrefix(
    'mechanism-run-state:'
  )).size, 0);
  assert.equal((await cacheStore.listProtectedByPrefix(
    'mechanism-checkpoint:'
  )).size, 0);
  assert.equal((await cacheStore.listProtectedByPrefix(
    'mechanism-run-index:'
  )).size, 1);
});

test('successful abandon releases bounded cleanup capacity for the next operation', async () => {
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const buildControl = executableContentFunction(
    'buildCrossFigureMechanismControlMessage', { crossFigureMechanismOwnData: own }
  );
  const normalizeIntent = executableContentFunction(
    'normalizeCrossFigureMechanismCleanupIntent', {
      crossFigureMechanismOwnData: own
    }
  );
  const stage = executableContentFunction(
    'stageCrossFigureMechanismCommitPending', {
      crossFigureMechanismOwnData: own,
      buildCrossFigureMechanismControlMessage: buildControl,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const finalize = executableContentFunction(
    'finalizeCommittedCrossFigureMechanismOperation', {
      crossFigureMechanismOwnData: own,
      buildCrossFigureMechanismControlMessage: buildControl,
      normalizeCrossFigureMechanismCleanupIntent: normalizeIntent
    }
  );
  const base = task8MechanismOperation();
  const operationAt = index => ({
    ...base,
    operationId: `mechanism:capacity-terminal-${index}-12345678`
  });
  const intents = new Map();
  for (let index = 0; index < 64; index += 1) {
    const staged = await stage(operationAt(index), {
      intents,
      persistCleanupCheckpoint: async () => ({ saved: true })
    });
    assert.equal(staged.staged, true);
  }
  assert.equal(intents.size, 64);
  const rejected = await stage(operationAt(64), {
    intents,
    persistCleanupCheckpoint: async () => ({ saved: true })
  });
  assert.equal(rejected.cleanupErrorCode, 'MECHANISM_CLEANUP_CAPACITY_EXCEEDED');
  let providerCalls = 0;
  const abandoned = await finalize(operationAt(0), {
    intents, cleanupCommand: 'abandon',
    persistCleanupCheckpoint: async () => ({ saved: true }),
    sendMessage: async message => ({ success: true, data: {
      operationId: message.operationId, abandoned: true, compacted: true,
      cleanupComplete: true, released: false
    } }),
    dispatchProvider: async () => { providerCalls += 1; }
  });
  assert.equal(abandoned.abandoned, true);
  assert.equal(intents.size, 63);
  assert.equal((await stage(operationAt(64), {
    intents,
    persistCleanupCheckpoint: async () => ({ saved: true })
  })).staged, true);
  assert.equal(intents.size, 64);
  assert.equal(providerCalls, 0);
});

test('lifecycle invalidation defers a terminal operation while workspace CAS is unresolved', () => {
  const operation = {
    ...task8MechanismOperation(), terminalCommitted: true,
    commitResolutionPending: true, workspaceCommitted: false, cancelled: false
  };
  const active = { operation, heartbeatTimer: null };
  const cleanupCommands = [];
  Function('publishCrossFigureMechanismProgress',
    'queueCrossFigureMechanismCleanup',
    'finalizeCommittedCrossFigureMechanismOperation', 'active', `
    let crossFigureLogicRuntime = active;
    const crossFigureLogicAdmissions = new Map();
    const crossFigureLogicAdmissionCancelReceipts = new Map();
    const crossFigureLogicAdmissionTombstones = new Map();
    let crossFigureLogicAdmissionSequence = 0;
    let crossFigureLogicLastPromotedSequence = 0;
    let crossFigureLogicPromise = Promise.resolve();
    let crossFigureLogicState = {
      result: null, pendingResult: null, status: 'working', progress: null,
      operation: { ...active.operation },
      audit: { code: 'MECHANISM_COMMIT_PENDING', updatedAt: 1000 },
      supplementalFingerprint: ''
    };
    ${contentFunctionSource('invalidateCrossFigureMechanismOperations')}
    invalidateCrossFigureMechanismOperations(2000);
  `)(() => false, (_operation, command) => cleanupCommands.push(command),
    (_operation, options) => cleanupCommands.push(options?.cleanupCommand || 'release'),
    active);
  assert.deepEqual(cleanupCommands, [],
    'a lifecycle change cannot choose cancel or abandon while durable CAS is unresolved');
  assert.equal(operation.cancelled, true);
});

test('fresh restore replays a committed mechanism release before provider admission', async () => {
  const operation = task8MechanismOperation();
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const intents = new Map();
  const releasedOperationIds = new Set();
  let releaseCalls = 0;
  let providerCalls = 0;
  const recover = executableContentFunction(
    'recoverPendingCrossFigureMechanismCleanup', {
      crossFigureLogicCleanupIntents: intents,
      crossFigureMechanismOwnData,
      queueCrossFigureMechanismCleanup: () => assert.fail(
        'a committed release must not use the legacy immediate-send queue'
      )
    }
  );
  const options = {
    draft: { mechanismGeneration: 'durable-generation' },
    intents,
    releasedOperationIds,
    recoverCommitted: draft => draft.mechanismGeneration === 'durable-generation'
      ? operation : null,
    finalizeCommitted: async recovered => {
      releaseCalls += 1;
      assert.equal(recovered.operationId, operation.operationId);
      return { released: true, cleanupPending: false };
    },
    dispatchProvider: async () => { providerCalls += 1; }
  };
  assert.deepEqual(await recover(options), { recovered: true });
  assert.equal(releaseCalls, 1);
  assert.equal(providerCalls, 0);
  assert.equal(releasedOperationIds.has(operation.operationId), true);
  assert.deepEqual(await recover(options), { recovered: true });
  assert.equal(releaseCalls, 1, 'the restored operation is released once per realm');

  const nextRealmIds = new Set();
  assert.deepEqual(await recover({
    ...options, releasedOperationIds: nextRealmIds
  }), { recovered: true });
  assert.equal(releaseCalls, 2,
    'a new realm safely replays the same compacted operation idempotently');
  assert.equal(providerCalls, 0);
});

test('fixed mechanism terminal codes survive background settle and archive restore', async () => {
  const codes = [
    'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS',
    'MECHANISM_PROVIDER_RECEIPT_MISMATCH',
    'MECHANISM_OPERATION_CAPACITY_EXCEEDED',
    'MECHANISM_DISPATCH_BINDING_UNAVAILABLE',
    'MECHANISM_OPERATION_FINALIZED'
  ];
  const operation = task8MechanismOperation();
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const isSeedable = executableContentFunction('isSeedableCrossFigureLogicResult', {
    crossFigureMechanismOwnData: own
  });
  const normalizePreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData: own,
      isSeedableCrossFigureLogicResult: isSeedable,
      SciLLM: FigureWorkspace
    }
  );
  const settle = executableContentFunction('settleCrossFigureMechanismState', {
    normalizeCrossFigureMechanismPendingPreview: normalizePreview,
    isSeedableCrossFigureLogicResult: isSeedable,
    SciLLM: EvidenceFirstMechanism
  });
  const restore = executableContentFunction('restoreCrossFigureMechanismState', {
    createCrossFigureLogicState: result => ({
      result, pendingResult: null, operation: null,
      status: result ? 'complete' : 'idle', progress: null,
      audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    }),
    normalizeCrossFigureMechanismPendingPreview: normalizePreview,
    crossFigureMechanismOwnData: own
  });
  const initial = {
    result: task8MechanismResult(), pendingResult: null,
    operation: {
      ...operation, startedAt: 1000, cancelled: false
    },
    status: 'working', progress: null,
    audit: { code: '', updatedAt: 1000 }, supplementalFingerprint: ''
  };

  for (const code of codes) {
    const settled = settle(initial, {
      status: 'failed', errorCode: code,
      providerSecret: `must-not-archive-${code}`,
      evidenceFirstStage0: {
        operationId: operation.operationId,
        operationEpoch: operation.epoch,
        evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
      }
    }, operation.binding, 2000);
    assert.equal(settled.status, 'failed', code);
    assert.equal(settled.audit.code, code, `${code} must survive settle`);
    const serialized = JSON.stringify(settled);
    assert.doesNotMatch(serialized, /must-not-archive/u);
    const restored = restore(JSON.parse(serialized));
    assert.equal(restored.audit.code, code, `${code} must survive archive restore`);

    for (const transport of ['response', 'throw']) {
      let providerCalls = 0;
      const chrome = { runtime: { sendMessage: async () => {
        providerCalls += 1;
        if (transport === 'throw') {
          const error = new Error('fixed terminal');
          error.code = code;
          throw error;
        }
        return { success: false, error: { code, providerSecret: 'do-not-copy' } };
      } } };
      const harness = createMechanismAnalyzeAdmissionHarness({
        versions: EVIDENCE_FIRST_VERSIONS,
        chrome,
        captureBinding: () => operation.binding,
        lifecycle: operation.binding.workspaceLifecycle,
        initialState: structuredClone(initial)
      });
      const outcome = await harness.analyze({
        evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
        evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
        operationId: `${operation.operationId}-${code.toLowerCase()}-${transport}`,
        ...operation.binding
      });
      assert.equal(outcome.code, code, `${code} ${transport}`);
      assert.equal(outcome.retryable, undefined, `${code} is fixed terminal`);
      assert.equal(providerCalls, 1, `${code} ${transport} must not retry`);
      assert.equal(harness.state().audit.code, code);
    }
  }
});

test('production analyze commits the frozen revision once before promotion and logic-map creation', async () => {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const sameCrossFigureMechanismBinding = executableContentFunction(
    'sameCrossFigureMechanismBinding', { crossFigureMechanismOwnData }
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const buildGeneratedMechanismV2WorkspaceMutation = executableContentFunction(
    'buildGeneratedMechanismV2WorkspaceMutation', {
      crossFigureMechanismOwnData, normalizeCrossFigureMechanismPendingPreview,
      createMechanismGenerationCandidateEnvelope:
        FigureWorkspace.createMechanismGenerationCandidateEnvelope
    }
  );
  const operation = task8MechanismOperation();
  const calls = [];
  let releaseCommit;
  let markCommitEntered;
  const commitGate = new Promise(resolve => { releaseCommit = resolve; });
  const commitEntered = new Promise(resolve => { markCommitEntered = resolve; });
  const controller = {
    mutate: async mutation => {
      calls.push(mutation);
      markCommitEntered();
      await commitGate;
      return { success: true, draft: { revision: 8 } };
    },
    getDraft: () => ({ revision: 8 }), getCheckpoint: () => ({}), isDirty: () => false
  };
  const commit = executableContentFunction(
    'commitGeneratedMechanismV2ToWorkspace', {
      buildGeneratedMechanismV2WorkspaceMutation,
      crossFigureMechanismOwnData,
      sameCrossFigureMechanismBinding
    }
  );
  const commitBound = input => commit(input, {
    captureBinding: () => operation.binding,
    ensureController: async () => controller,
    getActiveController: () => controller,
    getLifecycle: () => 12,
    commitController: () => undefined
  });
  let maps = 0;
  const releasedOperations = [];
  const versions = EVIDENCE_FIRST_VERSIONS;
  const chrome = { runtime: { sendMessage: async message => ({
    success: true,
    data: {
      status: 'complete', crossFigureLogic: task8MechanismResult(),
      evidenceFirstStage0: { operationId: message.operationId, operationEpoch: 3,
        evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS }
    }
  }) } };
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome, captureBinding: () => operation.binding,
    commitGeneratedMechanism: commitBound,
    finalizeCommittedMechanism: async committedOperation => {
      releasedOperations.push(structuredClone(committedOperation));
      return {
        released: false, cleanupPending: true,
        cleanupErrorCode: 'MECHANISM_CLEANUP_CHECKPOINT_WRITE_FAILED'
      };
    },
    createLogicMap: async () => { maps += 1; return {}; },
    lifecycle: 12,
    initialState: {
      result: { mechanismEdges: [{ from: 'Old', to: 'Chain' }] },
      pendingResult: null, operation: null, status: 'complete', progress: null,
      audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    }
  });
  const analysis = harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions, operationId: operation.operationId,
    ...operation.binding
  });
  await commitEntered;
  const lateCancel = await harness.cancel({
    operationId: operation.operationId, operationEpoch: 3, ...operation.binding
  });
  assert.equal(lateCancel.cancelled, false,
    'validated provider terminal owns the atomic workspace commit boundary');
  const overlappingPromise = harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions,
    operationId: 'mechanism:task8-overlap-12345678', ...operation.binding
  });
  const promptOverlap = await Promise.race([
    overlappingPromise,
    new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 20))
  ]);
  releaseCommit();
  const overlapping = promptOverlap?.timedOut === true
    ? await overlappingPromise : promptOverlap;
  assert.equal(overlapping.success, false);
  assert.equal(overlapping.code, 'MECHANISM_OPERATION_BUSY',
    'a new generation cannot displace a terminal result during durable CAS');
  assert.equal(calls.length, 1);
  const response = await analysis;
  assert.equal(response.status, 'complete');
  assert.equal(response.workspaceCommitted, true);
  assert.equal(response.cleanupPending, true,
    'cleanup failure is reported without replacing the committed primary result');
  assert.equal(response.cleanupErrorCode,
    'MECHANISM_CLEANUP_CHECKPOINT_WRITE_FAILED');
  assert.equal(releasedOperations.length, 1);
  assert.equal(releasedOperations[0].operationId, operation.operationId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].expectedRevision, 7);
  assert.equal(maps, 1, 'logic map may be created only after durable CAS success');
  assert.equal(harness.state().status, 'complete');
  assert.equal(harness.state().pendingResult, null);
  assert.equal(harness.state().result.evidenceFirstMechanism.claims[0].outcome,
    'supports');
});

test('failed workspace commit abandons and never admits release', async () => {
  const operation = task8MechanismOperation();
  const cleanupCommands = [];
  const previousResult = { mechanismEdges: [{ from: 'Prior', to: 'Result' }] };
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions: EVIDENCE_FIRST_VERSIONS,
    chrome: { runtime: { sendMessage: async message => ({
      success: true,
      data: {
        status: 'complete', crossFigureLogic: task8MechanismResult(),
        evidenceFirstStage0: {
          operationId: message.operationId, operationEpoch: 3,
          evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
        }
      }
    }) } },
    captureBinding: () => operation.binding,
    lifecycle: operation.binding.workspaceLifecycle,
    initialState: {
      result: previousResult, pendingResult: null, operation: null,
      status: 'complete', progress: null,
      audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    },
    commitGeneratedMechanism: async input => ({
      success: false, status: 'failed', code: 'MECHANISM_WORKSPACE_COMMIT_FAILED',
      result: previousResult, pendingResult: input.result
    }),
    finalizeCommittedMechanism: async (_resolved, options) => {
      cleanupCommands.push(options?.cleanupCommand);
      return { released: false, abandoned: true, cleanupPending: false };
    }
  });
  const outcome = await harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
    operationId: operation.operationId, ...operation.binding
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.code, 'MECHANISM_WORKSPACE_COMMIT_FAILED');
  assert.deepEqual(cleanupCommands, ['abandon']);
  assert.equal(cleanupCommands.includes('release'), false);
});

test('a durable workspace commit wins lifecycle invalidation and still releases exactly once', async () => {
  const operation = task8MechanismOperation();
  const order = [];
  let releaseCommit;
  let markCommitStarted;
  const commitStarted = new Promise(resolve => { markCommitStarted = resolve; });
  const commitGate = new Promise(resolve => { releaseCommit = resolve; });
  const cleanupCommands = [];
  const cancelCommands = [];
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions: EVIDENCE_FIRST_VERSIONS,
    chrome: { runtime: { sendMessage: async message => ({
      success: true,
      data: {
        status: 'complete', crossFigureLogic: task8MechanismResult(),
        evidenceFirstStage0: {
          operationId: message.operationId, operationEpoch: 3,
          evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
        }
      }
    }) } },
    captureBinding: () => operation.binding,
    lifecycle: operation.binding.workspaceLifecycle,
    initialState: {
      result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null,
      audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    },
    stageCommitPending: async () => {
      order.push('intent-ack');
      return { staged: true, commitPending: true, cleanupPending: true,
        cleanupErrorCode: '' };
    },
    commitGeneratedMechanism: async input => {
      order.push('mutate');
      markCommitStarted();
      await commitGate;
      return {
        success: true, status: 'complete', code: '',
        result: input.result, pendingResult: null,
        durableWorkspaceCommitted: true
      };
    },
    finalizeCommittedMechanism: async (_resolved, options) => {
      const command = options?.cleanupCommand || 'release';
      cleanupCommands.push(command);
      return { released: true, abandoned: false, cleanupPending: false };
    },
    queueCleanup: (_resolved, command) => {
      cancelCommands.push(command);
      return { cleanupPending: true, promise: Promise.resolve({ cancelled: true }) };
    }
  });
  const analysis = harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
    operationId: operation.operationId, ...operation.binding
  });
  await commitStarted;
  harness.invalidate();
  releaseCommit();
  const outcome = await analysis;
  assert.deepEqual(order, ['intent-ack', 'mutate'],
    'the commit-pending checkpoint ACK must precede workspace mutate');
  assert.deepEqual(cancelCommands, [],
    'invalidation during a durable CAS cannot race it with cancel');
  assert.deepEqual(cleanupCommands, ['release']);
  assert.equal(outcome.status, 'cancelled',
    'the old document stays cancelled even though its durable cleanup converges');
});

test('a workspace commit loss after lifecycle invalidation abandons exactly once', async () => {
  const operation = task8MechanismOperation();
  let resolveCommit;
  let markCommitStarted;
  const commitStarted = new Promise(resolve => { markCommitStarted = resolve; });
  const commitGate = new Promise(resolve => { resolveCommit = resolve; });
  const cleanupCommands = [];
  const cancelCommands = [];
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions: EVIDENCE_FIRST_VERSIONS,
    chrome: { runtime: { sendMessage: async message => ({
      success: true,
      data: {
        status: 'complete', crossFigureLogic: task8MechanismResult(),
        evidenceFirstStage0: {
          operationId: message.operationId, operationEpoch: 3,
          evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
        }
      }
    }) } },
    captureBinding: () => operation.binding,
    lifecycle: operation.binding.workspaceLifecycle,
    initialState: {
      result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null,
      audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    },
    commitGeneratedMechanism: async input => {
      markCommitStarted();
      await commitGate;
      return {
        success: false, status: 'failed',
        code: 'MECHANISM_WORKSPACE_COMMIT_FAILED',
        result: null, pendingResult: input.result,
        durableWorkspaceCommitted: false
      };
    },
    finalizeCommittedMechanism: async (_resolved, options) => {
      const command = options?.cleanupCommand;
      cleanupCommands.push(command);
      return command === 'abandon'
        ? { released: false, abandoned: true, cleanupPending: false }
        : { released: true, abandoned: false, cleanupPending: false };
    },
    queueCleanup: (_resolved, command) => {
      cancelCommands.push(command);
      return { cleanupPending: true, promise: Promise.resolve({ cancelled: true }) };
    }
  });
  const analysis = harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
    operationId: operation.operationId, ...operation.binding
  });
  await commitStarted;
  harness.invalidate();
  resolveCommit();
  const result = await analysis;
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(cancelCommands, []);
  assert.deepEqual(cleanupCommands, ['abandon']);
});

test('lifecycle invalidation defers while the durable abandon checkpoint is awaiting ACK', async () => {
  const operation = task8MechanismOperation();
  let finishAbandon;
  let markAbandonStarted;
  const abandonStarted = new Promise(resolve => { markAbandonStarted = resolve; });
  const abandonGate = new Promise(resolve => { finishAbandon = resolve; });
  const cleanupCommands = [];
  let providerCalls = 0;
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions: EVIDENCE_FIRST_VERSIONS,
    chrome: { runtime: { sendMessage: async message => {
      providerCalls += 1;
      return { success: true, data: {
        status: 'complete', crossFigureLogic: task8MechanismResult(),
        evidenceFirstStage0: {
          operationId: message.operationId, operationEpoch: 3,
          evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
        }
      } };
    } } },
    captureBinding: () => operation.binding,
    lifecycle: operation.binding.workspaceLifecycle,
    initialState: {
      result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null,
      audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    },
    commitGeneratedMechanism: async input => ({
      success: false, status: 'failed',
      code: 'MECHANISM_WORKSPACE_COMMIT_FAILED',
      result: null, pendingResult: input.result,
      durableWorkspaceCommitted: false
    }),
    finalizeCommittedMechanism: async (_resolved, options) => {
      cleanupCommands.push(options?.cleanupCommand);
      markAbandonStarted();
      await abandonGate;
      return { released: false, abandoned: true, cleanupPending: false };
    },
    queueCleanup: () => {
      throw Object.assign(new Error('cancel conflicts with abandon'), {
        code: 'MECHANISM_CLEANUP_CONFLICT'
      });
    }
  });
  const analysis = harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
    operationId: operation.operationId, ...operation.binding
  });
  await abandonStarted;
  assert.doesNotThrow(() => harness.invalidate(),
    'workspace invalidation must not synchronously collide cancel with abandon');
  finishAbandon();
  const result = await analysis;
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(cleanupCommands, ['abandon']);
  assert.equal(providerCalls, 1,
    'only the original provider terminal ran; cleanup never redispatches it');
});

test('terminal workspace commit failures durably abandon without replacing the primary result', async () => {
  const operation = task8MechanismOperation();
  const outcomes = [{
    success: false, status: 'revision_conflict', code: 'MECHANISM_REVISION_CONFLICT'
  }, {
    success: false, status: 'failed', code: 'MECHANISM_WORKSPACE_COMMIT_FAILED'
  }];
  for (const commitOutcome of outcomes) {
    const order = [];
    const cleanupCommands = [];
    const previousResult = { mechanismEdges: [{ from: 'Prior', to: 'Result' }] };
    const harness = createMechanismAnalyzeAdmissionHarness({
      versions: EVIDENCE_FIRST_VERSIONS,
      chrome: { runtime: { sendMessage: async message => ({
        success: true,
        data: {
          status: 'complete', crossFigureLogic: task8MechanismResult(),
          evidenceFirstStage0: {
            operationId: message.operationId, operationEpoch: 3,
            evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
          }
        }
      }) } },
      captureBinding: () => operation.binding,
      lifecycle: operation.binding.workspaceLifecycle,
      initialState: {
        result: previousResult, pendingResult: null, operation: null,
        status: 'complete', progress: null,
        audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
      },
      stageCommitPending: async () => {
        order.push('intent-ack');
        return { staged: true, commitPending: true, cleanupPending: true,
          cleanupErrorCode: '' };
      },
      commitGeneratedMechanism: async input => {
        order.push('mutate');
        return {
          ...commitOutcome,
          result: previousResult,
          pendingResult: input.result,
          durableWorkspaceCommitted: false
        };
      },
      finalizeCommittedMechanism: async (_resolved, options) => {
        cleanupCommands.push(options?.cleanupCommand);
        return {
          released: false, abandoned: true,
          cleanupPending: false, cleanupErrorCode: ''
        };
      }
    });
    const result = await harness.analyze({
      evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
      operationId: operation.operationId, ...operation.binding
    });
    assert.deepEqual(order, ['intent-ack', 'mutate']);
    assert.deepEqual(cleanupCommands, ['abandon']);
    assert.equal(result.status, commitOutcome.status);
    assert.equal(result.code, commitOutcome.code);
    assert.equal(result.cleanupPending, false);
    assert.deepEqual(harness.state().result, previousResult);
  }
});

test('fresh admission resolves restored terminal intent from authoritative draft before provider', async () => {
  const operation = task8MechanismOperation();
  const order = [];
  let providerCalls = 0;
  let recoverCalls = 0;
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions: EVIDENCE_FIRST_VERSIONS,
    chrome: { runtime: { sendMessage: async message => {
      providerCalls += 1;
      order.push('provider');
      return { success: true, data: {
        status: 'needs_review', crossFigureLogic: task8MechanismResult(),
        evidenceFirstStage0: {
          operationId: message.operationId, operationEpoch: 3,
          evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
        }
      } };
    } } },
    captureBinding: () => operation.binding,
    lifecycle: operation.binding.workspaceLifecycle,
    initialState: {
      result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null,
      audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    },
    ensureInventory: async () => { order.push('inventory'); },
    ensureWorkspace: async () => { order.push('workspace'); },
    recoverCleanup: async options => {
      recoverCalls += 1;
      if (recoverCalls === 1) {
        assert.notEqual(options?.authoritativeDraft, true);
        order.push('recover-deferred');
      } else {
        assert.equal(options?.authoritativeDraft, true);
        assert.deepEqual(options?.draft, { authoritative: true });
        order.push('recover-authoritative');
      }
      return { recovered: true };
    }
  });
  const result = await harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
    operationId: 'mechanism:fresh-after-cleanup-12345678', ...operation.binding
  });
  assert.equal(result.status, 'needs_review');
  assert.equal(providerCalls, 1,
    'cleanup replay itself is provider-free and the later new admission dispatches once');
  assert.deepEqual(order, [
    'recover-deferred', 'inventory', 'workspace',
    'recover-authoritative', 'provider'
  ]);
});

test('a pre-admitted generation cannot displace a runtime after its terminal CAS begins', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const operation = task8MechanismOperation();
  const activeRuntime = {
    operation: {
      operationId: operation.operationId, epoch: 3, binding: operation.binding,
      startedAt: 1000, cancelled: false, terminalCommitted: false
    },
    heartbeatTimer: null, cancelPromise: null,
    promise: Promise.resolve({ status: 'working' }), providerDispatchStarted: true
  };
  let releasePrepare;
  const prepare = new Promise(resolve => { releasePrepare = resolve; });
  let providerCalls = 0;
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions,
    chrome: { runtime: { sendMessage: async () => {
      providerCalls += 1;
      return { success: false };
    } } },
    captureBinding: () => operation.binding,
    lifecycle: operation.binding.workspaceLifecycle,
    initialRuntime: activeRuntime,
    initialState: {
      result: { mechanismEdges: [{ from: 'Old', to: 'Chain' }] },
      pendingResult: task8MechanismResult(),
      operation: { ...activeRuntime.operation }, status: 'working', progress: null,
      audit: { code: 'MECHANISM_COMMIT_PENDING', updatedAt: 1000 },
      supplementalFingerprint: ''
    },
    ensureInventory: () => prepare
  });
  const queuedId = 'mechanism:task8-preadmitted-12345678';
  const queued = harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions, operationId: queuedId, ...operation.binding
  });
  assert.ok(harness.admission(queuedId));
  activeRuntime.operation.terminalCommitted = true;
  releasePrepare();
  const outcome = await queued;
  assert.equal(outcome.code, 'MECHANISM_OPERATION_BUSY');
  assert.equal(providerCalls, 0);
  assert.equal(harness.runtime(), activeRuntime);
  assert.equal(harness.state().operation.operationId, operation.operationId);
});

test('a hung auxiliary logic map never blocks completion a new generation or lifecycle navigation', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const operation = task8MechanismOperation();
  let releaseMap;
  let signalMapStarted;
  const mapStarted = new Promise(resolve => { signalMapStarted = resolve; });
  const hungMap = new Promise(resolve => { releaseMap = resolve; });
  let providerCalls = 0;
  const chrome = { runtime: { sendMessage: async message => {
    providerCalls += 1;
    const second = message.operationId.includes('second');
    return { success: true, data: {
      status: second ? 'needs_review' : 'complete',
      crossFigureLogic: task8MechanismResult(),
      evidenceFirstStage0: {
        operationId: message.operationId, operationEpoch: 3,
        evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
      }
    } };
  } } };
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome, captureBinding: () => operation.binding,
    lifecycle: operation.binding.workspaceLifecycle,
    initialState: {
      result: null, pendingResult: null, operation: null, status: 'idle',
      progress: null, audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    },
    commitGeneratedMechanism: async input => ({
      success: true, status: 'complete', code: '',
      result: input.result, pendingResult: null
    }),
    createLogicMap: () => {
      signalMapStarted();
      return hungMap;
    }
  });
  const first = harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions, operationId: operation.operationId,
    ...operation.binding
  });
  await mapStarted;
  const prompt = await Promise.race([
    first,
    new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 25))
  ]);
  if (prompt?.timedOut === true) {
    releaseMap({ mapId: 'cleanup-after-timeout' });
    await first;
  }
  assert.notEqual(prompt?.timedOut, true,
    'auxiliary logic-map work must not keep terminal CAS busy');
  assert.equal(prompt.status, 'complete');
  assert.equal(harness.runtime(), null);

  const second = await harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions,
    operationId: 'mechanism:task8-second-12345678', ...operation.binding
  });
  assert.equal(second.status, 'needs_review');
  assert.equal(providerCalls, 2);
  harness.setLifecycle(operation.binding.workspaceLifecycle + 1);
  releaseMap({ mapId: 'late-old-page-map' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(harness.runtime(), null);
});

test('production analyze revision conflict keeps the old complete result and never creates a map', async () => {
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const sameCrossFigureMechanismBinding = executableContentFunction(
    'sameCrossFigureMechanismBinding', { crossFigureMechanismOwnData }
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const buildGeneratedMechanismV2WorkspaceMutation = executableContentFunction(
    'buildGeneratedMechanismV2WorkspaceMutation', {
      crossFigureMechanismOwnData, normalizeCrossFigureMechanismPendingPreview,
      createMechanismGenerationCandidateEnvelope:
        FigureWorkspace.createMechanismGenerationCandidateEnvelope
    }
  );
  const operation = task8MechanismOperation();
  let calls = 0;
  const controller = {
    mutate: async () => {
      calls += 1;
      throw Object.assign(new Error('FIGURE_WORKSPACE_REVISION_CONFLICT'), {
        code: 'FIGURE_WORKSPACE_REVISION_CONFLICT'
      });
    }
  };
  const commit = executableContentFunction(
    'commitGeneratedMechanismV2ToWorkspace', {
      buildGeneratedMechanismV2WorkspaceMutation,
      crossFigureMechanismOwnData,
      sameCrossFigureMechanismBinding
    }
  );
  const commitBound = input => commit(input, {
    captureBinding: () => operation.binding,
    ensureController: async () => controller,
    getActiveController: () => controller,
    getLifecycle: () => 12,
    commitController: () => assert.fail('conflict cannot promote memory')
  });
  const versions = EVIDENCE_FIRST_VERSIONS;
  const chrome = { runtime: { sendMessage: async message => ({
    success: true,
    data: {
      status: 'complete', crossFigureLogic: task8MechanismResult(),
      evidenceFirstStage0: { operationId: message.operationId, operationEpoch: 3,
        evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS }
    }
  }) } };
  let maps = 0;
  const old = { mechanismEdges: [{ from: 'Old', to: 'Chain' }] };
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome, captureBinding: () => operation.binding,
    commitGeneratedMechanism: commitBound,
    createLogicMap: async () => { maps += 1; return {}; }, lifecycle: 12,
    initialState: {
      result: old, pendingResult: null, operation: null, status: 'complete',
      progress: null, audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    }
  });
  const response = await harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions, operationId: operation.operationId,
    ...operation.binding
  });
  assert.equal(response.status, 'revision_conflict');
  assert.equal(response.code, 'MECHANISM_REVISION_CONFLICT');
  assert.equal(calls, 1);
  assert.equal(maps, 0);
  assert.equal(harness.state().result, old);
  assert.equal(harness.state().status, 'revision_conflict');
  assert.equal(harness.state().pendingResult.evidenceFirstMechanism.relations[0]
    .relationKind, 'causal');
});

test('public mechanism snapshots preserve the exact content-local progress checkpoint', () => {
  const apply = executableContentFunction('applyCrossFigureMechanismProgress');
  const binding = {
    documentId: 'sha256:public-checkpoint', workspaceId: `workspace:${'d'.repeat(64)}`,
    workspaceGeneration: 17, workspaceLifecycle: 47, baseWorkspaceRevision: 23,
    mechanismChainFingerprint: 'mechanism-chain-v1-ddee0011'
  };
  const operation = { operationId: 'mechanism:public-checkpoint-12345678',
    epoch: 1, binding, startedAt: Date.now() - 1000, cancelled: false };
  const state = apply({ result: null, pendingResult: null, operation,
    status: 'queued', progress: { stage: 'collecting_panel_evidence',
      completed: 0, total: 0, elapsedSeconds: 0,
      heartbeatAt: operation.startedAt, progressSequence: 0 },
    audit: { code: '', updatedAt: 0 }, supplementalFingerprint: '' }, {
    phase: 'canonicalizing_nodes', operationId: operation.operationId,
    operationEpoch: 1, completedPanels: 1, totalPanels: 4
  });
  const publicProgress = Function('state', `
    let crossFigureLogicState = state;
    ${contentFunctionSource('publicCrossFigureMechanismProgress')}
    return publicCrossFigureMechanismProgress();
  `)(state);
  assert.equal(publicProgress.progressSequence, 1);
  assert.equal(publicProgress.heartbeatAt, state.progress.heartbeatAt);
  assert.equal(publicProgress.operationId, operation.operationId);
  assert.equal(publicProgress.operationEpoch, 1);
});

test('mechanism cancellation invalidates local apply before awaiting durable completion', () => {
  const script = read('content.js');
  const start = script.indexOf('function cancelCrossFigureLogicWithLLM');
  const end = script.indexOf('async function analyzeCrossFigureLogicWithLLM', start);
  const cancel = script.slice(start, end);
  assert.match(cancel, /cancelled:\s*true/);
  assert.match(cancel, /status:\s*'cancelled'/);
  const localInvalidate = cancel.indexOf("status: 'cancelled'");
  const durableSend = cancel.indexOf('buildCrossFigureMechanismControlMessage');
  const durableAwait = cancel.indexOf('await ', durableSend - 20);
  assert.ok(localInvalidate >= 0 && durableSend > localInvalidate && durableAwait >= 0,
    'local cancellation must precede the awaited durable cancel message');
  assert.match(cancel,
    /buildCrossFigureMechanismControlMessage\(runtime\.operation,\s*'cancel'\)/);
  assert.match(cancel, /cancelPromise/);
  assert.match(cancel, /providerDispatchStarted !== true/);
  assert.match(cancel, /safeTerminal:\s*'not_dispatched'/);
  assert.match(cancel, /Date\.now\(\) \+ 8_000/);
  assert.match(cancel, /Promise\.race/);
  assert.match(cancel, /setTimeout\(\(\) => resolve\(null\), 600\)/);
});

test('mechanism production analyze installs an epoch-zero tombstone before its first await', () => {
  const script = read('content.js');
  const start = script.indexOf('async function analyzeCrossFigureLogicWithLLM');
  const end = script.indexOf('const paperMetaAnalysisPromises', start);
  const analyze = script.slice(start, end);
  const firstAwait = analyze.indexOf('await ');
  const admissionInstall = analyze.indexOf('crossFigureLogicAdmissions.set(');
  const runtimePromotion = analyze.indexOf('crossFigureLogicRuntime = runtime');
  const promiseInstall = analyze.indexOf('runtime.promise =');
  assert.ok(admissionInstall >= 0 && admissionInstall < firstAwait,
    'the exact provisional admission must be visible to cancel before preparation awaits');
  assert.ok(runtimePromotion > firstAwait,
    'an admission must not replace the active runtime before hydrated live validation');
  assert.ok(promiseInstall >= 0 && promiseInstall < firstAwait,
    'the shared operation promise must also be installed before preparation awaits');
  assert.match(analyze.slice(0, firstAwait), /normalizeEvidenceFirstMechanismRequest/);
  assert.match(analyze, /providerDispatchStarted/);
  assert.doesNotMatch(analyze, /setInterval\(/,
    'local elapsed ticks must not masquerade as upstream mechanism heartbeats');
  const finalCancelGuard = analyze.lastIndexOf('runtime.operation.cancelled',
    analyze.indexOf('runtime.providerDispatchStarted = true'));
  const providerDispatch = analyze.indexOf('chrome.runtime.sendMessage(backgroundRequest)');
  assert.ok(finalCancelGuard >= 0 && providerDispatch > finalCancelGuard,
    'the epoch-zero tombstone must prevent the production background dispatch');
});

test('production mechanism analyze immediate cancel during deferred prepare is zero-provider and durable', async () => {
  let releasePrepare;
  const prepare = new Promise(resolve => { releasePrepare = resolve; });
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:immediate-cancel', workspaceId: `workspace:${'9'.repeat(64)}`,
    workspaceGeneration: 3, workspaceLifecycle: 12, baseWorkspaceRevision: 5,
    mechanismChainFingerprint: 'mechanism-chain-v1-99aabbcc'
  });
  const operationId = 'mechanism:immediate-cancel-12345678';
  const request = {
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions, operationId, ...binding
  };
  const sent = [];
  let logicMaps = 0;
  let archiveSaves = 0;
  const chrome = { runtime: { sendMessage(message) {
    sent.push(message);
    if (message.type === 'LLM_CONTROL_OPERATION') {
      return Promise.resolve({ success: true, data: {
        operationId, cancelled: true, epoch: 1
      } });
    }
    return Promise.resolve({ success: false });
  } } };
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const sameCrossFigureMechanismBinding = executableContentFunction(
    'sameCrossFigureMechanismBinding', { crossFigureMechanismOwnData }
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const settleCrossFigureMechanismState = executableContentFunction(
    'settleCrossFigureMechanismState', {
      isSeedableCrossFigureLogicResult, SciLLM: EvidenceFirstMechanism
    }
  );
  const normalizeEvidenceFirstMechanismRequest = executableContentFunction(
    'normalizeEvidenceFirstMechanismRequest', {
      SciLLM: EvidenceFirstMechanism
    }
  );
  const buildEvidenceFirstMechanismBackgroundMessage = executableContentFunction(
    'buildEvidenceFirstMechanismBackgroundMessage'
  );
  const dependencies = {
    chrome,
    captureEvidenceFirstMechanismBinding: () => binding,
    normalizeEvidenceFirstMechanismRequest,
    sameCrossFigureMechanismBinding,
    crossFigureMechanismOwnData,
    settleCrossFigureMechanismState,
    buildEvidenceFirstMechanismBackgroundMessage,
    getFigureWorkspaceInventory: () => [],
    ensureFigureWorkspaceInventorySeeded: () => prepare,
    ensureCurrentArticleWorkspace: async () => ({}),
    buildCrossFigureLogicInput: () => [
      { figureId: 'figure-1', isSupplemental: false },
      { figureId: 'figure-2', isSupplemental: false }
    ],
    collectResearchLogicMapBackgroundItems: () => [],
    buildCrossFigureRepresentativeContext: () => [],
    recoverPendingCrossFigureMechanismCleanup: async () => ({ recovered: true }),
    publishCrossFigureMechanismProgress: () => true,
    scheduleArticleWorkspaceArtifactsSave: () => undefined,
    scheduleCurrentArticleArchiveSave: () => { archiveSaves += 1; },
    createArticleLogicMap: async () => { logicMaps += 1; return {}; },
    document: { title: 'Immediate cancel paper' }
  };
  const dependencyNames = Object.keys(dependencies);
  const harness = Function(...dependencyNames, `
    let crossFigureLogicPromise = null;
    let crossFigureLogicRuntime = null;
    const crossFigureLogicAdmissions = new Map();
    const crossFigureLogicAdmissionCancelReceipts = new Map();
    const crossFigureLogicAdmissionTombstones = new Map();
    let crossFigureLogicAdmissionSequence = 0;
    let crossFigureLogicLastPromotedSequence = 0;
    const CROSS_FIGURE_MECHANISM_MAX_ADMISSIONS = 8;
    const CROSS_FIGURE_MECHANISM_MAX_TOMBSTONES = 64;
    let crossFigureLogicState = {
      result: { mechanismEdges: [{ from: 'old-a', to: 'old-b' }] },
      pendingResult: null, operation: null, status: 'complete', progress: null,
      audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    };
    let supplementalFigureAssetsFingerprint = '';
    let articleWorkspaceLifecycleGeneration = 12;
    let lastPreparedStudy = null;
    let lastLlmAnalysis = null;
    ${contentFunctionSource('buildCrossFigureMechanismControlMessage')}
    ${contentFunctionSource('cancelCrossFigureLogicWithLLM')}
    ${contentFunctionSource('analyzeCrossFigureLogicWithLLM')}
    return {
      analyzeCrossFigureLogicWithLLM, cancelCrossFigureLogicWithLLM,
      state: () => crossFigureLogicState,
      runtime: () => crossFigureLogicRuntime,
      admission: operationId => operationId
        ? crossFigureLogicAdmissions.get(operationId)
        : [...crossFigureLogicAdmissions.values()][0] || null
    };
  `)(...dependencyNames.map(key => dependencies[key]));

  const analysis = harness.analyzeCrossFigureLogicWithLLM(request);
  assert.equal(harness.admission().operation.epoch, 0,
    'the production analyze function must expose its provisional admission synchronously');
  const firstCancel = harness.cancelCrossFigureLogicWithLLM({
    operationId, operationEpoch: 0, ...binding
  });
  const secondCancel = harness.cancelCrossFigureLogicWithLLM({
    operationId, operationEpoch: 0, ...binding
  });
  assert.equal(firstCancel, secondCancel, 'immediate cancellation shares one durable promise');
  const cancelled = await firstCancel;
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.safeTerminal, 'not_dispatched');
  assert.equal(harness.state().status, 'cancelled');
  releasePrepare();
  const result = await analysis;
  assert.equal(result.status, 'cancelled');
  assert.equal(sent.filter(message =>
    message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC').length, 0);
  assert.equal(logicMaps, 0);
  assert.equal(archiveSaves, 0);
});

test('provisional epoch-zero cancel survives the background epoch publication race', async () => {
  const binding = {
    documentId: 'sha256:epoch-race', workspaceId: `workspace:${'7'.repeat(64)}`,
    workspaceGeneration: 4, workspaceLifecycle: 9, baseWorkspaceRevision: 6,
    mechanismChainFingerprint: 'mechanism-chain-v1-778899aa'
  };
  const operationId = 'mechanism:epoch-race-12345678';
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const same = executableContentFunction('sameCrossFigureMechanismBinding', {
    crossFigureMechanismOwnData: own
  });
  const makeCancel = () => {
    const chrome = { runtime: { sendMessage: async message => ({
      success: message.type === 'LLM_CONTROL_OPERATION',
      data: { operationId, cancelled: true, epoch: 1 }
    }) } };
    return Function('chrome', 'crossFigureMechanismOwnData',
      'sameCrossFigureMechanismBinding', 'publishCrossFigureMechanismProgress', `
        let crossFigureLogicState = {
          result: null, pendingResult: null, status: 'working', progress: null,
          operation: { operationId: ${JSON.stringify(operationId)}, epoch: 1,
            binding: ${JSON.stringify(binding)}, startedAt: Date.now(), cancelled: false },
          audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
        };
        let crossFigureLogicRuntime = {
          operation: { ...crossFigureLogicState.operation }, heartbeatTimer: null,
          cancelPromise: null, providerDispatchStarted: true
        };
        const crossFigureLogicAdmissions = new Map();
        const crossFigureLogicAdmissionCancelReceipts = new Map();
        const crossFigureLogicAdmissionTombstones = new Map();
        const CROSS_FIGURE_MECHANISM_MAX_TOMBSTONES = 64;
        ${contentFunctionSource('buildCrossFigureMechanismControlMessage')}
        ${contentFunctionSource('cancelCrossFigureLogicWithLLM')}
        return cancelCrossFigureLogicWithLLM;
      `)(chrome, own, same, () => true);
  };
  const cancel = makeCancel();
  const response = await cancel({ operationId, operationEpoch: 0, ...binding });
  assert.equal(response.cancelled, true);
  assert.equal(response.epoch, 1);
  await assert.rejects(
    makeCancel()({ operationId, operationEpoch: 2, ...binding }),
    error => error?.code === 'MECHANISM_OPERATION_STALE'
  );
});

test('late durable cancel acknowledgement for operation A cannot tombstone replacement B', async () => {
  const bindingA = {
    documentId: 'sha256:cancel-a', workspaceId: `workspace:${'a'.repeat(64)}`,
    workspaceGeneration: 1, workspaceLifecycle: 5, baseWorkspaceRevision: 3,
    mechanismChainFingerprint: 'mechanism-chain-v1-aaaaaaaa'
  };
  const bindingB = {
    documentId: 'sha256:cancel-b', workspaceId: `workspace:${'b'.repeat(64)}`,
    workspaceGeneration: 2, workspaceLifecycle: 6, baseWorkspaceRevision: 4,
    mechanismChainFingerprint: 'mechanism-chain-v1-bbbbbbbb'
  };
  const operationA = 'mechanism:cancel-a-12345678';
  const operationB = 'mechanism:cancel-b-12345678';
  let acknowledgeCancel;
  const chrome = { runtime: { sendMessage: () => new Promise(resolve => {
    acknowledgeCancel = resolve;
  }) } };
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const same = executableContentFunction('sameCrossFigureMechanismBinding', {
    crossFigureMechanismOwnData: own
  });
  const harness = Function('chrome', 'crossFigureMechanismOwnData',
    'sameCrossFigureMechanismBinding', 'publishCrossFigureMechanismProgress', `
      let crossFigureLogicState = {
        result: null, pendingResult: null, status: 'working', progress: null,
        operation: { operationId: ${JSON.stringify(operationA)}, epoch: 1,
          binding: ${JSON.stringify(bindingA)}, startedAt: Date.now(), cancelled: false },
        audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
      };
      let crossFigureLogicRuntime = {
        operation: { ...crossFigureLogicState.operation }, heartbeatTimer: null,
        cancelPromise: null, providerDispatchStarted: true
      };
      const crossFigureLogicAdmissions = new Map();
      const crossFigureLogicAdmissionCancelReceipts = new Map();
      const crossFigureLogicAdmissionTombstones = new Map();
      const CROSS_FIGURE_MECHANISM_MAX_TOMBSTONES = 64;
      ${contentFunctionSource('buildCrossFigureMechanismControlMessage')}
      ${contentFunctionSource('cancelCrossFigureLogicWithLLM')}
      return {
        cancelCrossFigureLogicWithLLM,
        replace() {
          crossFigureLogicState = {
            ...crossFigureLogicState, status: 'queued',
            operation: { operationId: ${JSON.stringify(operationB)}, epoch: 0,
              binding: ${JSON.stringify(bindingB)}, startedAt: Date.now(), cancelled: false }
          };
          crossFigureLogicRuntime = {
            operation: { ...crossFigureLogicState.operation }, heartbeatTimer: null,
            cancelPromise: null, providerDispatchStarted: false
          };
        },
        state: () => crossFigureLogicState
      };
    `)(chrome, own, same, () => true);
  const pending = harness.cancelCrossFigureLogicWithLLM({
    operationId: operationA, operationEpoch: 1, ...bindingA
  });
  harness.replace();
  acknowledgeCancel({
    success: true,
    data: { operationId: operationA, cancelled: true, epoch: 2 }
  });
  const response = await pending;
  assert.equal(response.operationId, operationA);
  assert.equal(response.epoch, 2);
  assert.equal(harness.state().status, 'queued');
  assert.equal(harness.state().operation.operationId, operationB);
  assert.equal(harness.state().operation.epoch, 0);
  assert.equal(harness.state().operation.cancelled, false);
});

test('accepted provider terminal rejects an exact cancel while logic-map creation is auxiliary', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:terminal-linearization',
    workspaceId: `workspace:${'8'.repeat(64)}`,
    workspaceGeneration: 5, workspaceLifecycle: 18, baseWorkspaceRevision: 7,
    mechanismChainFingerprint: 'mechanism-chain-v1-8899aabb'
  });
  const operationId = 'mechanism:terminal-linearization-12345678';
  let releaseLogicMap;
  let signalLogicMapStarted;
  const logicMapStarted = new Promise(resolve => { signalLogicMapStarted = resolve; });
  const logicMap = new Promise(resolve => { releaseLogicMap = resolve; });
  const sent = [];
  const chrome = { runtime: { sendMessage: async message => {
    sent.push(message);
    if (message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC') {
      return { success: true, data: {
        evidenceFirstStage0: { operationId, operationEpoch: 1,
          evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS },
        status: 'complete',
        crossFigureLogic: {
          mechanismEdges: [{ from: 'node-a', to: 'node-b', supportPanels: ['fig-1:a'] }],
          nodes: [], dominoChain: []
        }
      } };
    }
    return { success: true, data: { operationId, cancelled: true, epoch: 1 } };
  } } };
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const sameCrossFigureMechanismBinding = executableContentFunction(
    'sameCrossFigureMechanismBinding', { crossFigureMechanismOwnData }
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const settleCrossFigureMechanismState = executableContentFunction(
    'settleCrossFigureMechanismState', {
      isSeedableCrossFigureLogicResult, SciLLM: EvidenceFirstMechanism
    }
  );
  const normalizeEvidenceFirstMechanismRequest = executableContentFunction(
    'normalizeEvidenceFirstMechanismRequest', {
      SciLLM: EvidenceFirstMechanism
    }
  );
  const buildEvidenceFirstMechanismBackgroundMessage = executableContentFunction(
    'buildEvidenceFirstMechanismBackgroundMessage'
  );
  const dependencies = {
    chrome,
    captureEvidenceFirstMechanismBinding: () => binding,
    normalizeEvidenceFirstMechanismRequest,
    sameCrossFigureMechanismBinding,
    crossFigureMechanismOwnData,
    settleCrossFigureMechanismState,
    buildEvidenceFirstMechanismBackgroundMessage,
    getFigureWorkspaceInventory: () => [],
    ensureFigureWorkspaceInventorySeeded: async () => undefined,
    ensureCurrentArticleWorkspace: async () => ({}),
    buildCrossFigureLogicInput: () => [
      { figureId: 'figure-1', isSupplemental: false },
      { figureId: 'figure-2', isSupplemental: false }
    ],
    collectResearchLogicMapBackgroundItems: () => [],
    buildCrossFigureRepresentativeContext: () => [],
    recoverPendingCrossFigureMechanismCleanup: async () => ({ recovered: true }),
    stageCrossFigureMechanismCommitPending: async () => ({
      staged: true, commitPending: true, cleanupPending: true, cleanupErrorCode: ''
    }),
    finalizeCommittedCrossFigureMechanismOperation: async () => ({
      released: true, abandoned: false, cleanupPending: false, cleanupErrorCode: ''
    }),
    publishCrossFigureMechanismProgress: () => true,
    scheduleArticleWorkspaceArtifactsSave: () => undefined,
    scheduleCurrentArticleArchiveSave: () => undefined,
    createArticleLogicMap: () => {
      signalLogicMapStarted();
      return logicMap;
    },
    figureWorkspaceDraft: { authoritative: true },
    document: { title: 'Terminal linearization paper' }
  };
  const dependencyNames = Object.keys(dependencies);
  const harness = Function(...dependencyNames, `
    let crossFigureLogicPromise = null;
    let crossFigureLogicRuntime = null;
    const crossFigureLogicAdmissions = new Map();
    const crossFigureLogicAdmissionCancelReceipts = new Map();
    const crossFigureLogicAdmissionTombstones = new Map();
    let crossFigureLogicAdmissionSequence = 0;
    let crossFigureLogicLastPromotedSequence = 0;
    const CROSS_FIGURE_MECHANISM_MAX_ADMISSIONS = 8;
    const CROSS_FIGURE_MECHANISM_MAX_TOMBSTONES = 64;
    let crossFigureLogicState = {
      result: null, pendingResult: null, operation: null, status: 'idle', progress: null,
      audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    };
    let supplementalFigureAssetsFingerprint = '';
    let articleWorkspaceLifecycleGeneration = 18;
    let lastPreparedStudy = null;
    let lastLlmAnalysis = null;
    ${contentFunctionSource('buildCrossFigureMechanismControlMessage')}
    ${contentFunctionSource('cancelCrossFigureLogicWithLLM')}
    ${contentFunctionSource('analyzeCrossFigureLogicWithLLM')}
    return {
      analyzeCrossFigureLogicWithLLM, cancelCrossFigureLogicWithLLM,
      state: () => crossFigureLogicState,
      runtime: () => crossFigureLogicRuntime
    };
  `)(...dependencyNames.map(key => dependencies[key]));
  const request = {
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions, operationId, ...binding
  };
  const analysis = harness.analyzeCrossFigureLogicWithLLM(request);
  await logicMapStarted;
  const cancellation = await harness.cancelCrossFigureLogicWithLLM({
    operationId, operationEpoch: 0, ...binding
  });
  assert.equal(cancellation.cancelled, false,
    'once the provider terminal is committed, cancellation must be explicitly rejected');
  assert.equal(cancellation.active, false);
  assert.equal(harness.state().status, 'complete');
  assert.equal(sent.filter(message => message.type === 'LLM_CONTROL_OPERATION').length, 0);
  const result = await analysis;
  assert.equal(result.status, 'complete');
  assert.equal(result.logicMap, null);
  releaseLogicMap({ mapId: 'late-auxiliary-map' });
});

test('hot reinjection validates the exact request binding only after workspace ensure', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:hot-reinjection',
    workspaceId: `workspace:${'1'.repeat(64)}`,
    workspaceGeneration: 6, workspaceLifecycle: 22, baseWorkspaceRevision: 2,
    mechanismChainFingerprint: 'mechanism-chain-v1-11223344'
  });
  const operationId = 'mechanism:hot-reinjection-12345678';
  let workspaceReady = false;
  let bindingCaptures = 0;
  let bindingCapturesBeforeEnsure = 0;
  let providerDispatches = 0;
  const captureEvidenceFirstMechanismBinding = () => {
    bindingCaptures += 1;
    if (!workspaceReady) bindingCapturesBeforeEnsure += 1;
    return workspaceReady ? binding : {
      documentId: '', workspaceId: '', workspaceGeneration: 0,
      workspaceLifecycle: 0, baseWorkspaceRevision: 0,
      mechanismChainFingerprint: 'mechanism-chain-v1-00000000'
    };
  };
  const chrome = { runtime: { sendMessage: async message => {
    if (message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC') {
      providerDispatches += 1;
      return { success: true, data: {
        evidenceFirstStage0: { operationId, operationEpoch: 1,
          evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS },
        status: 'needs_review',
        errorCode: 'MECHANISM_UNRESOLVED_EVIDENCE',
        crossFigureLogic: { mechanismEdges: [] }
      } };
    }
    return { success: false };
  } } };
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const sameCrossFigureMechanismBinding = executableContentFunction(
    'sameCrossFigureMechanismBinding', { crossFigureMechanismOwnData }
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const settleCrossFigureMechanismState = executableContentFunction(
    'settleCrossFigureMechanismState', {
      isSeedableCrossFigureLogicResult, SciLLM: EvidenceFirstMechanism
    }
  );
  const normalizeEvidenceFirstMechanismRequest = executableContentFunction(
    'normalizeEvidenceFirstMechanismRequest', {
      SciLLM: EvidenceFirstMechanism
    }
  );
  const buildEvidenceFirstMechanismBackgroundMessage = executableContentFunction(
    'buildEvidenceFirstMechanismBackgroundMessage'
  );
  const dependencies = {
    chrome, captureEvidenceFirstMechanismBinding,
    normalizeEvidenceFirstMechanismRequest,
    sameCrossFigureMechanismBinding,
    crossFigureMechanismOwnData,
    settleCrossFigureMechanismState,
    buildEvidenceFirstMechanismBackgroundMessage,
    getFigureWorkspaceInventory: () => [],
    ensureFigureWorkspaceInventorySeeded: async () => undefined,
    ensureCurrentArticleWorkspace: async () => { workspaceReady = true; },
    buildCrossFigureLogicInput: () => [
      { figureId: 'figure-1', isSupplemental: false },
      { figureId: 'figure-2', isSupplemental: false }
    ],
    collectResearchLogicMapBackgroundItems: () => [],
    buildCrossFigureRepresentativeContext: () => [],
    recoverPendingCrossFigureMechanismCleanup: async () => ({ recovered: true }),
    publishCrossFigureMechanismProgress: () => true,
    scheduleArticleWorkspaceArtifactsSave: () => undefined,
    scheduleCurrentArticleArchiveSave: () => undefined,
    createArticleLogicMap: async () => ({}),
    document: { title: 'Hot reinjection paper' }
  };
  const dependencyNames = Object.keys(dependencies);
  const analyze = Function(...dependencyNames, `
    let crossFigureLogicPromise = null;
    let crossFigureLogicRuntime = null;
    const crossFigureLogicAdmissions = new Map();
    const crossFigureLogicAdmissionCancelReceipts = new Map();
    const crossFigureLogicAdmissionTombstones = new Map();
    let crossFigureLogicAdmissionSequence = 0;
    let crossFigureLogicLastPromotedSequence = 0;
    const CROSS_FIGURE_MECHANISM_MAX_ADMISSIONS = 8;
    const CROSS_FIGURE_MECHANISM_MAX_TOMBSTONES = 64;
    let crossFigureLogicState = {
      result: null, pendingResult: null, operation: null, status: 'idle', progress: null,
      audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    };
    let supplementalFigureAssetsFingerprint = '';
    let articleWorkspaceLifecycleGeneration = 22;
    let lastPreparedStudy = null;
    let lastLlmAnalysis = null;
    ${contentFunctionSource('analyzeCrossFigureLogicWithLLM')}
    return analyzeCrossFigureLogicWithLLM;
  `)(...dependencyNames.map(key => dependencies[key]));
  const response = await analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions, operationId, ...binding
  });
  assert.equal(response.status, 'needs_review');
  assert.equal(bindingCapturesBeforeEnsure, 0,
    'request-shape validation must not depend on an unhydrated live workspace');
  assert.equal(bindingCaptures, 2,
    'the hydrated binding is checked before dispatch and again at terminal apply');
  assert.equal(providerDispatches, 1);
});

test('stale admission A cannot cancel or replace active runtime B before live validation', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const liveBinding = Object.freeze({
    documentId: 'sha256:admission-stale',
    workspaceId: `workspace:${'3'.repeat(64)}`,
    workspaceGeneration: 8, workspaceLifecycle: 30, baseWorkspaceRevision: 10,
    mechanismChainFingerprint: 'mechanism-chain-v1-33445566'
  });
  const staleBinding = Object.freeze({ ...liveBinding, baseWorkspaceRevision: 9 });
  const operationB = 'mechanism:active-admission-b-12345678';
  const operationA = 'mechanism:stale-admission-a-12345678';
  const activeRuntime = {
    operation: { operationId: operationB, epoch: 2, binding: liveBinding,
      startedAt: 1000, cancelled: false, terminalCommitted: false },
    heartbeatTimer: null, cancelPromise: null, providerDispatchStarted: true,
    terminalCommitted: false, promise: Promise.resolve({ status: 'working' })
  };
  const activeState = {
    result: { mechanismEdges: [{ from: 'old-a', to: 'old-b' }] },
    pendingResult: null,
    operation: { ...activeRuntime.operation },
    status: 'working',
    progress: { stage: 'mapping_claim_relations', completed: 4, total: 8,
      elapsedSeconds: 2, heartbeatAt: 2000 },
    audit: { code: '', updatedAt: 2000 }, supplementalFingerprint: 'stable-b'
  };
  const sent = [];
  const chrome = { runtime: { sendMessage: async message => {
    sent.push(message);
    return { success: false };
  } } };
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome, captureBinding: () => liveBinding,
    initialRuntime: activeRuntime, initialState: activeState, lifecycle: 30
  });
  const response = await harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions, operationId: operationA, ...staleBinding
  });
  assert.equal(response.status, 'revision_conflict');
  assert.equal(response.code, 'MECHANISM_REVISION_CONFLICT');
  assert.equal(sent.filter(message => message.type === 'LLM_CONTROL_OPERATION').length, 0);
  assert.equal(sent.filter(message =>
    message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC').length, 0);
  assert.equal(harness.runtime(), activeRuntime,
    'the active runtime object must remain byte-for-byte authoritative');
  assert.equal(harness.state(), activeState,
    'stale admission must leave the active state object exactly untouched');
  assert.equal(activeRuntime.operation.cancelled, false);
});

test('hydrated valid admission C atomically cancels and replaces active runtime B', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:admission-valid', workspaceId: `workspace:${'4'.repeat(64)}`,
    workspaceGeneration: 9, workspaceLifecycle: 31, baseWorkspaceRevision: 11,
    mechanismChainFingerprint: 'mechanism-chain-v1-44556677'
  });
  const operationB = 'mechanism:active-valid-b-12345678';
  const operationC = 'mechanism:valid-admission-c-12345678';
  const activeRuntime = {
    operation: { operationId: operationB, epoch: 3, binding,
      startedAt: 1000, cancelled: false, terminalCommitted: false },
    heartbeatTimer: null, cancelPromise: null, providerDispatchStarted: true,
    terminalCommitted: false, promise: Promise.resolve({ status: 'working' })
  };
  const activeState = {
    result: { mechanismEdges: [{ from: 'old-a', to: 'old-b' }] },
    pendingResult: null, operation: { ...activeRuntime.operation }, status: 'working',
    progress: { stage: 'mapping_claim_relations', completed: 5, total: 9,
      elapsedSeconds: 2, heartbeatAt: 2000 },
    audit: { code: '', updatedAt: 2000 }, supplementalFingerprint: 'stable-b'
  };
  let liveValidated = false;
  let releaseProvider;
  let signalProviderStarted;
  const providerStarted = new Promise(resolve => { signalProviderStarted = resolve; });
  const providerResponse = new Promise(resolve => { releaseProvider = resolve; });
  const sent = [];
  const controlValidationStates = [];
  const chrome = { runtime: { sendMessage: message => {
    sent.push(message);
    if (message.type === 'LLM_CONTROL_OPERATION') {
      controlValidationStates.push(liveValidated);
      return Promise.resolve({ success: true });
    }
    signalProviderStarted();
    return providerResponse;
  } } };
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome,
    captureBinding: () => { liveValidated = true; return binding; },
    initialRuntime: activeRuntime, initialState: activeState, lifecycle: 31
  });
  const analysis = harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions, operationId: operationC, ...binding
  });
  await providerStarted;
  assert.deepEqual(controlValidationStates, [true],
    'active B may be cancelled only after C passes exact hydrated binding validation');
  assert.equal(activeRuntime.operation.cancelled, true);
  assert.equal(harness.runtime().operation.operationId, operationC);
  assert.equal(harness.state().operation.operationId, operationC);
  releaseProvider({ success: true, data: {
    evidenceFirstStage0: { operationId: operationC, operationEpoch: 1,
      evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS },
    status: 'needs_review', errorCode: 'MECHANISM_UNRESOLVED_EVIDENCE',
    crossFigureLogic: { mechanismEdges: [] }
  } });
  const response = await analysis;
  assert.equal(response.status, 'needs_review');
  assert.equal(sent.filter(message => message.type === 'LLM_CONTROL_OPERATION').length, 1);
  assert.equal(sent.filter(message =>
    message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC').length, 1);
});

test('stale later admission cannot preempt an independently validating request', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:parallel-admissions', workspaceId: `workspace:${'5'.repeat(64)}`,
    workspaceGeneration: 10, workspaceLifecycle: 32, baseWorkspaceRevision: 12,
    mechanismChainFingerprint: 'mechanism-chain-v1-55667788'
  });
  const staleBinding = Object.freeze({ ...binding, baseWorkspaceRevision: 11 });
  let releaseFirstPrepare;
  let prepareCalls = 0;
  const firstPrepare = new Promise(resolve => { releaseFirstPrepare = resolve; });
  const providerOperations = [];
  const chrome = { runtime: { sendMessage: async message => {
    if (message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC') {
      providerOperations.push(message.operationId);
      return { success: true, data: {
        evidenceFirstStage0: { operationId: message.operationId, operationEpoch: 1,
          evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS },
        status: 'needs_review', errorCode: 'MECHANISM_UNRESOLVED_EVIDENCE',
        crossFigureLogic: { mechanismEdges: [] }
      } };
    }
    return { success: true };
  } } };
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome, captureBinding: () => binding, initialState: {
      result: null, pendingResult: null, operation: null, status: 'idle', progress: null,
      audit: { code: '', updatedAt: 0 }, supplementalFingerprint: ''
    }, lifecycle: 32,
    ensureInventory: () => (++prepareCalls === 1 ? firstPrepare : Promise.resolve())
  });
  const operationA = 'mechanism:parallel-valid-a-12345678';
  const operationC = 'mechanism:parallel-stale-c-12345678';
  const validA = harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions, operationId: operationA, ...binding
  });
  const staleC = harness.analyze({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions, operationId: operationC, ...staleBinding
  });
  assert.equal((await staleC).status, 'revision_conflict');
  releaseFirstPrepare();
  assert.equal((await validA).status, 'needs_review');
  assert.deepEqual(providerOperations, [operationA],
    'a stale later candidate must not cancel a valid admission that is still preparing');
});

test('latest validated mechanism admission wins regardless of prepare completion order', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:latest-valid', workspaceId: `workspace:${'6'.repeat(64)}`,
    workspaceGeneration: 11, workspaceLifecycle: 33, baseWorkspaceRevision: 13,
    mechanismChainFingerprint: 'mechanism-chain-v1-66778899'
  });
  let releaseA;
  let prepareCalls = 0;
  const waitA = new Promise(resolve => { releaseA = resolve; });
  const dispatched = [];
  const chrome = { runtime: { sendMessage: async message => {
    if (message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC') {
      dispatched.push(message.operationId);
      return { success: true, data: {
        evidenceFirstStage0: { operationId: message.operationId, operationEpoch: 1,
          evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS },
        status: 'needs_review', crossFigureLogic: { mechanismEdges: [] }
      } };
    }
    return { success: true };
  } } };
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome, captureBinding: () => binding, lifecycle: 33,
    initialState: { result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null, audit: { code: '', updatedAt: 0 },
      supplementalFingerprint: '' },
    ensureInventory: () => (++prepareCalls === 1 ? waitA : Promise.resolve())
  });
  const operationA = 'mechanism:latest-valid-a-12345678';
  const operationC = 'mechanism:latest-valid-c-12345678';
  const pendingA = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId: operationA, ...binding });
  const pendingC = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId: operationC, ...binding });
  assert.equal((await pendingC).status, 'needs_review');
  releaseA();
  assert.equal((await pendingA).status, 'cancelled');
  assert.deepEqual(dispatched, [operationC]);
});

test('an earlier stale admission cannot disturb a later valid promotion', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:stale-first', workspaceId: `workspace:${'c'.repeat(64)}`,
    workspaceGeneration: 16, workspaceLifecycle: 46, baseWorkspaceRevision: 22,
    mechanismChainFingerprint: 'mechanism-chain-v1-ccddee00'
  });
  const staleBinding = Object.freeze({ ...binding, baseWorkspaceRevision: 21 });
  let releaseStale;
  let prepareCalls = 0;
  const waitStale = new Promise(resolve => { releaseStale = resolve; });
  const dispatched = [];
  const chrome = { runtime: { sendMessage: async message => {
    if (message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC') {
      dispatched.push(message.operationId);
      return { success: true, data: {
        evidenceFirstStage0: { operationId: message.operationId, operationEpoch: 1,
          evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS },
        status: 'needs_review', crossFigureLogic: { mechanismEdges: [] }
      } };
    }
    return { success: true };
  } } };
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome, captureBinding: () => binding, lifecycle: 46,
    initialState: { result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null, audit: { code: '', updatedAt: 0 },
      supplementalFingerprint: '' },
    ensureInventory: () => (++prepareCalls === 1 ? waitStale : Promise.resolve())
  });
  const operationC = 'mechanism:stale-first-c-12345678';
  const operationA = 'mechanism:valid-later-a-12345678';
  const pendingC = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId: operationC, ...staleBinding });
  const pendingA = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId: operationA, ...binding });
  assert.equal((await pendingA).status, 'needs_review');
  releaseStale();
  assert.equal((await pendingC).status, 'revision_conflict');
  assert.deepEqual(dispatched, [operationA]);
});

test('epoch-zero cancellation targets each pending admission independently', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:cancel-admissions', workspaceId: `workspace:${'7'.repeat(64)}`,
    workspaceGeneration: 12, workspaceLifecycle: 34, baseWorkspaceRevision: 14,
    mechanismChainFingerprint: 'mechanism-chain-v1-778899aa'
  });
  let releasePrepare;
  const prepare = new Promise(resolve => { releasePrepare = resolve; });
  const chrome = { runtime: { sendMessage: async () => ({ success: false }) } };
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome, captureBinding: () => binding, lifecycle: 34,
    initialState: { result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null, audit: { code: '', updatedAt: 0 },
      supplementalFingerprint: '' }, ensureInventory: () => prepare
  });
  const operationA = 'mechanism:cancel-pending-a-12345678';
  const operationC = 'mechanism:cancel-pending-c-12345678';
  const pendingA = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId: operationA, ...binding });
  const pendingC = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId: operationC, ...binding });
  assert.ok(harness.admission(operationA));
  assert.ok(harness.admission(operationC));
  assert.equal((await harness.cancel({ operationId: operationA,
    operationEpoch: 0, ...binding })).operationId, operationA);
  assert.ok(harness.admission(operationC), 'cancelling A must preserve pending C');
  assert.equal((await harness.cancel({ operationId: operationC,
    operationEpoch: 0, ...binding })).operationId, operationC);
  releasePrepare();
  assert.equal((await pendingA).status, 'cancelled');
  assert.equal((await pendingC).status, 'cancelled');
});

test('cancelled non-dispatched admissions release all bounded slots immediately', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:release-admissions', workspaceId: `workspace:${'e'.repeat(64)}`,
    workspaceGeneration: 18, workspaceLifecycle: 48, baseWorkspaceRevision: 24,
    mechanismChainFingerprint: 'mechanism-chain-v1-ee001122'
  });
  let releasePrepare;
  const prepare = new Promise(resolve => { releasePrepare = resolve; });
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome: { runtime: { sendMessage: async () => ({ success: false }) } },
    captureBinding: () => binding, lifecycle: 48,
    initialState: { result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null, audit: { code: '', updatedAt: 0 },
      supplementalFingerprint: '' }, ensureInventory: () => prepare
  });
  const pending = [];
  for (let index = 0; index < 8; index += 1) {
    const operationId = `mechanism:release-slot-${index}-12345678`;
    pending.push(harness.analyze({ evidenceFirstVersion: '2',
      evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
      operationId, ...binding }));
    await harness.cancel({ operationId, operationEpoch: 0, ...binding });
  }
  assert.equal(harness.admissionCount(), 0,
    'not-dispatched cancellation must release each admission capacity slot');
  const ninthId = 'mechanism:release-slot-ninth-12345678';
  const ninth = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId: ninthId, ...binding });
  assert.ok(harness.admission(ninthId), 'the ninth request must be admitted synchronously');
  await harness.cancel({ operationId: ninthId, operationEpoch: 0, ...binding });
  releasePrepare();
  assert.equal((await ninth).status, 'cancelled');
  for (const result of await Promise.all(pending)) assert.equal(result.status, 'cancelled');
});

test('cancelled operation identity cannot be reused by analyze or a delayed cancel', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:admission-cas', workspaceId: `workspace:${'f'.repeat(64)}`,
    workspaceGeneration: 19, workspaceLifecycle: 49, baseWorkspaceRevision: 25,
    mechanismChainFingerprint: 'mechanism-chain-v1-ff112233'
  });
  const releases = [];
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome: { runtime: { sendMessage: async () => ({ success: false }) } },
    captureBinding: () => binding, lifecycle: 49,
    initialState: { result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null, audit: { code: '', updatedAt: 0 },
      supplementalFingerprint: '' },
    ensureInventory: () => new Promise(resolve => { releases.push(resolve); })
  });
  const operationId = 'mechanism:admission-cas-same-id-12345678';
  const first = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId, ...binding });
  const firstRuntime = harness.admission(operationId);
  await harness.cancel({ operationId, operationEpoch: 0, ...binding });
  const repeated = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId, ...binding });
  assert.equal(harness.admission(operationId), undefined,
    'same-id analyze must return the cancellation tombstone without a replacement');
  assert.equal((await repeated).cancelled, true);
  const delayedCancel = await harness.cancel({ operationId, operationEpoch: 0, ...binding });
  assert.equal(delayedCancel.cancelled, true);
  assert.equal(delayedCancel.epoch, 0);
  assert.equal(releases.length, 0,
    'cleanup recovery and cancellation must short-circuit before inventory preparation');
  assert.equal((await first).status, 'cancelled');
  assert.equal(harness.admission(operationId), undefined);
  assert.equal(firstRuntime.operation.cancelled, true);
});

test('cancel replay remains exact after the bounded Promise receipt cache evicts it', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:tombstone-replay', workspaceId: `workspace:${'1'.repeat(64)}`,
    workspaceGeneration: 21, workspaceLifecycle: 51, baseWorkspaceRevision: 27,
    mechanismChainFingerprint: 'mechanism-chain-v1-11224455'
  });
  let releasePrepare;
  const prepare = new Promise(resolve => { releasePrepare = resolve; });
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome: { runtime: { sendMessage: async () => ({ success: false }) } },
    captureBinding: () => binding, lifecycle: 51,
    initialState: { result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null, audit: { code: '', updatedAt: 0 },
      supplementalFingerprint: '' }, ensureInventory: () => prepare
  });
  const pending = [];
  const ids = [];
  for (let index = 0; index < 10; index += 1) {
    const operationId = `mechanism:tombstone-replay-${index}-12345678`;
    ids.push(operationId);
    pending.push(harness.analyze({ evidenceFirstVersion: '2',
      evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
      operationId, ...binding }));
    await harness.cancel({ operationId, operationEpoch: 0, ...binding });
  }
  assert.ok(harness.receiptCount() <= 8, 'Promise receipts remain independently bounded');
  const replay = await harness.cancel({
    operationId: ids[0], operationEpoch: 0, ...binding
  });
  assert.deepEqual(replay, {
    success: true, active: false, cancelled: true, operationId: ids[0],
    epoch: 0, safeTerminal: 'not_dispatched'
  });
  releasePrepare();
  for (const result of await Promise.all(pending)) assert.equal(result.status, 'cancelled');
});

test('queue saturation cannot erase an existing cancellation receipt or identity', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:receipt-ordering', workspaceId: `workspace:${'2'.repeat(64)}`,
    workspaceGeneration: 22, workspaceLifecycle: 52, baseWorkspaceRevision: 28,
    mechanismChainFingerprint: 'mechanism-chain-v1-22335566'
  });
  let releasePrepare;
  const prepare = new Promise(resolve => { releasePrepare = resolve; });
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome: { runtime: { sendMessage: async () => ({ success: false }) } },
    captureBinding: () => binding, lifecycle: 52,
    initialState: { result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null, audit: { code: '', updatedAt: 0 },
      supplementalFingerprint: '' }, ensureInventory: () => prepare
  });
  const operationX = 'mechanism:receipt-ordering-x-12345678';
  const cancelledAnalysis = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions, operationId: operationX, ...binding });
  const originalReceipt = harness.cancel({
    operationId: operationX, operationEpoch: 0, ...binding
  });
  const fills = [];
  for (let index = 0; index < 8; index += 1) {
    fills.push(harness.analyze({ evidenceFirstVersion: '2',
      evidenceFirstRouterVersion: '2',
      evidenceFirstVersions: versions,
      operationId: `mechanism:receipt-fill-${index}-12345678`, ...binding }));
  }
  const sameIdAnalyze = await harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId: operationX, ...binding });
  assert.equal(sameIdAnalyze.cancelled, true);
  assert.equal(harness.cancel({ operationId: operationX,
    operationEpoch: 0, ...binding }), originalReceipt,
  'queue checks must not delete the already published exact receipt');
  releasePrepare();
  assert.equal((await cancelledAnalysis).status, 'cancelled');
  await Promise.all(fills);
});

test('tombstone capacity fails closed without forgetting cancelled identities', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:tombstone-capacity', workspaceId: `workspace:${'3'.repeat(64)}`,
    workspaceGeneration: 23, workspaceLifecycle: 53, baseWorkspaceRevision: 29,
    mechanismChainFingerprint: 'mechanism-chain-v1-33446677'
  });
  let releasePrepare;
  const prepare = new Promise(resolve => { releasePrepare = resolve; });
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome: { runtime: { sendMessage: async () => ({ success: false }) } },
    captureBinding: () => binding, lifecycle: 53,
    initialState: { result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null, audit: { code: '', updatedAt: 0 },
      supplementalFingerprint: '' }, ensureInventory: () => prepare
  });
  const pending = [];
  for (let index = 0; index < 64; index += 1) {
    const operationId = `mechanism:tombstone-cap-${index}-12345678`;
    pending.push(harness.analyze({ evidenceFirstVersion: '2',
      evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
      operationId, ...binding }));
    await harness.cancel({ operationId, operationEpoch: 0, ...binding });
  }
  assert.equal(harness.tombstoneCount(), 64);
  const overflowId = 'mechanism:tombstone-cap-overflow-12345678';
  const overflow = await harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId: overflowId, ...binding });
  assert.equal(overflow.status, 'failed');
  assert.equal(overflow.code, 'MECHANISM_OPERATION_QUEUE_FULL');
  assert.equal(harness.admission(overflowId), undefined);
  const oldest = await harness.cancel({
    operationId: 'mechanism:tombstone-cap-0-12345678',
    operationEpoch: 0, ...binding
  });
  assert.equal(oldest.cancelled, true);
  assert.equal(oldest.epoch, 0);
  releasePrepare();
  await Promise.all(pending);
});

test('lifecycle reset clears tombstones while old binding cannot cancel the new identity', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const oldBinding = Object.freeze({
    documentId: 'sha256:lifecycle-tombstone', workspaceId: `workspace:${'4'.repeat(64)}`,
    workspaceGeneration: 24, workspaceLifecycle: 54, baseWorkspaceRevision: 30,
    mechanismChainFingerprint: 'mechanism-chain-v1-44557788'
  });
  const newBinding = Object.freeze({ ...oldBinding, workspaceLifecycle: 55,
    baseWorkspaceRevision: 31, mechanismChainFingerprint: 'mechanism-chain-v1-55668899' });
  let liveBinding = oldBinding;
  const releases = [];
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome: { runtime: { sendMessage: async () => ({ success: false }) } },
    captureBinding: () => liveBinding, lifecycle: 54,
    initialState: { result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null, audit: { code: '', updatedAt: 0 },
      supplementalFingerprint: '' },
    ensureInventory: () => new Promise(resolve => { releases.push(resolve); })
  });
  const operationId = 'mechanism:lifecycle-tombstone-same-id-12345678';
  const oldAnalysis = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId, ...oldBinding });
  await harness.cancel({ operationId, operationEpoch: 0, ...oldBinding });
  assert.equal(harness.tombstoneCount(), 1);
  harness.invalidate();
  harness.setLifecycle(55);
  liveBinding = newBinding;
  assert.equal(harness.tombstoneCount(), 0);
  const newAnalysis = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId, ...newBinding });
  const newRuntime = harness.admission(operationId);
  await assert.rejects(
    harness.cancel({ operationId, operationEpoch: 0, ...oldBinding }),
    error => error?.code === 'MECHANISM_OPERATION_STALE'
  );
  assert.equal(harness.admission(operationId), newRuntime);
  assert.equal(newRuntime.operation.cancelled, false);
  await harness.cancel({ operationId, operationEpoch: 0, ...newBinding });
  releases.forEach(resolve => resolve());
  assert.equal((await oldAnalysis).status, 'cancelled');
  assert.equal((await newAnalysis).status, 'cancelled');
});

test('cancel tombstone lookup never executes hostile identity accessors', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:hostile-tombstone', workspaceId: `workspace:${'5'.repeat(64)}`,
    workspaceGeneration: 25, workspaceLifecycle: 56, baseWorkspaceRevision: 32,
    mechanismChainFingerprint: 'mechanism-chain-v1-667799aa'
  });
  let releasePrepare;
  const prepare = new Promise(resolve => { releasePrepare = resolve; });
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome: { runtime: { sendMessage: async () => ({ success: false }) } },
    captureBinding: () => binding, lifecycle: 56,
    initialState: { result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null, audit: { code: '', updatedAt: 0 },
      supplementalFingerprint: '' }, ensureInventory: () => prepare
  });
  const operationId = 'mechanism:hostile-tombstone-12345678';
  const analysis = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId, ...binding });
  await harness.cancel({ operationId, operationEpoch: 0, ...binding });
  let getterReads = 0;
  const hostile = { operationEpoch: 0, ...binding };
  Object.defineProperty(hostile, 'operationId', {
    enumerable: true,
    get() { getterReads += 1; return operationId; }
  });
  const response = await harness.cancel(hostile);
  assert.equal(getterReads, 0);
  assert.equal(response.cancelled, false);
  releasePrepare();
  assert.equal((await analysis).status, 'cancelled');
});

test('active mechanism runtime rejects same-id analyze with a different frozen binding', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:active-binding', workspaceId: `workspace:${'6'.repeat(64)}`,
    workspaceGeneration: 26, workspaceLifecycle: 57, baseWorkspaceRevision: 33,
    mechanismChainFingerprint: 'mechanism-chain-v1-7788aabb'
  });
  const wrongBinding = Object.freeze({ ...binding, baseWorkspaceRevision: 32 });
  const operationId = 'mechanism:active-binding-12345678';
  const activeRuntime = {
    operation: { operationId, epoch: 3, binding, startedAt: 1000,
      cancelled: false, terminalCommitted: false },
    heartbeatTimer: null, cancelPromise: null, providerDispatchStarted: true,
    terminalCommitted: false, promise: Promise.resolve({ status: 'working' })
  };
  const activeState = {
    result: null, pendingResult: null, operation: { ...activeRuntime.operation },
    status: 'working', progress: { stage: 'mapping_claim_relations', completed: 2,
      total: 6, elapsedSeconds: 1, heartbeatAt: 1000, progressSequence: 2 },
    audit: { code: '', updatedAt: 1000 }, supplementalFingerprint: ''
  };
  const sent = [];
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome: { runtime: { sendMessage: async message => {
      sent.push(message); return { success: false };
    } } }, captureBinding: () => binding,
    initialRuntime: activeRuntime, initialState: activeState, lifecycle: 57
  });
  const response = await harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId, ...wrongBinding });
  assert.equal(response.status, 'revision_conflict');
  assert.equal(response.code, 'MECHANISM_OPERATION_STALE');
  assert.equal(harness.runtime(), activeRuntime);
  assert.equal(harness.state(), activeState);
  assert.equal(activeRuntime.operation.cancelled, false);
  assert.equal(sent.length, 0);
});

test('new-lifecycle admission rejects delayed same-id analyze from the old binding', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const newBinding = Object.freeze({
    documentId: 'sha256:delayed-old-analyze',
    workspaceId: `workspace:${'7'.repeat(64)}`,
    workspaceGeneration: 27, workspaceLifecycle: 59, baseWorkspaceRevision: 35,
    mechanismChainFingerprint: 'mechanism-chain-v1-8899bbcc'
  });
  const oldBinding = Object.freeze({ ...newBinding, workspaceLifecycle: 58,
    baseWorkspaceRevision: 34, mechanismChainFingerprint: 'mechanism-chain-v1-99aaccdd' });
  let releasePrepare;
  const prepare = new Promise(resolve => { releasePrepare = resolve; });
  const operationId = 'mechanism:delayed-old-analyze-12345678';
  const sent = [];
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome: { runtime: { sendMessage: async message => {
      sent.push(message);
      return { success: true, data: { evidenceFirstStage0: {
        operationId, operationEpoch: 1,
        evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS
      }, status: 'needs_review', crossFigureLogic: { mechanismEdges: [] } } };
    } } }, captureBinding: () => newBinding, lifecycle: 59,
    initialState: { result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null, audit: { code: '', updatedAt: 0 },
      supplementalFingerprint: '' }, ensureInventory: () => prepare
  });
  const current = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId, ...newBinding });
  const delayedOld = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId, ...oldBinding });
  releasePrepare();
  const oldResponse = await delayedOld;
  assert.equal(oldResponse.status, 'revision_conflict');
  assert.equal(oldResponse.code, 'MECHANISM_OPERATION_STALE');
  assert.equal((await current).status, 'needs_review');
  assert.equal(sent.filter(message =>
    message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC').length, 1);
});

test('tombstone and public cancelled state reject same-id cancel with wrong binding', async () => {
  const versions = EVIDENCE_FIRST_VERSIONS;
  const binding = Object.freeze({
    documentId: 'sha256:tombstone-wrong-binding',
    workspaceId: `workspace:${'8'.repeat(64)}`,
    workspaceGeneration: 28, workspaceLifecycle: 60, baseWorkspaceRevision: 36,
    mechanismChainFingerprint: 'mechanism-chain-v1-aabbccdd'
  });
  const wrongBinding = Object.freeze({ ...binding, baseWorkspaceRevision: 37 });
  let releasePrepare;
  const prepare = new Promise(resolve => { releasePrepare = resolve; });
  const operationId = 'mechanism:tombstone-wrong-binding-12345678';
  const harness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome: { runtime: { sendMessage: async () => ({ success: false }) } },
    captureBinding: () => binding, lifecycle: 60,
    initialState: { result: null, pendingResult: null, operation: null,
      status: 'idle', progress: null, audit: { code: '', updatedAt: 0 },
      supplementalFingerprint: '' }, ensureInventory: () => prepare
  });
  const analysis = harness.analyze({ evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2', evidenceFirstVersions: versions,
    operationId, ...binding });
  await harness.cancel({ operationId, operationEpoch: 0, ...binding });
  const beforeState = harness.state();
  await assert.rejects(
    harness.cancel({ operationId, operationEpoch: 0, ...wrongBinding }),
    error => error?.code === 'MECHANISM_OPERATION_STALE'
  );
  assert.equal(harness.state(), beforeState);
  assert.equal(harness.dropReceipt(operationId), true);
  await assert.rejects(
    harness.cancel({ operationId, operationEpoch: 0, ...wrongBinding }),
    error => error?.code === 'MECHANISM_OPERATION_STALE'
  );
  assert.equal(harness.state(), beforeState);
  let getterReads = 0;
  const hostile = { operationId, operationEpoch: 0, ...binding };
  Object.defineProperty(hostile, 'workspaceId', {
    enumerable: true,
    get() { getterReads += 1; return binding.workspaceId; }
  });
  await assert.rejects(
    harness.cancel(hostile), error => error?.code === 'MECHANISM_OPERATION_STALE'
  );
  assert.equal(getterReads, 0);

  const publicState = {
    result: null, pendingResult: null,
    operation: { operationId, epoch: 2, binding, startedAt: 2000,
      cancelled: true, terminalCommitted: false },
    status: 'cancelled', progress: null,
    audit: { code: 'MECHANISM_OPERATION_CANCELLED', updatedAt: 2001 },
    supplementalFingerprint: ''
  };
  const publicHarness = createMechanismAnalyzeAdmissionHarness({
    versions, chrome: { runtime: { sendMessage: async () => ({ success: false }) } },
    captureBinding: () => binding, lifecycle: 60, initialState: publicState
  });
  await assert.rejects(
    publicHarness.cancel({ operationId, operationEpoch: 2, ...wrongBinding }),
    error => error?.code === 'MECHANISM_OPERATION_STALE'
  );
  assert.equal(publicHarness.state(), publicState);
  assert.equal((await publicHarness.cancel({ operationId, operationEpoch: 2,
    ...binding })).cancelled, true);
  releasePrepare();
  assert.equal((await analysis).status, 'cancelled');
});

test('workspace lifecycle invalidation cancels every admission and clears queued public state', () => {
  assert.match(contentFunctionSource('invalidateArticleWorkspaceLifecycle'),
    /invalidateCrossFigureMechanismOperations\(\)/,
    'the production workspace freeze/invalidation route must use the same mechanism reset');
  const binding = {
    documentId: 'sha256:lifecycle-admission', workspaceId: `workspace:${'8'.repeat(64)}`,
    workspaceGeneration: 13, workspaceLifecycle: 35, baseWorkspaceRevision: 15,
    mechanismChainFingerprint: 'mechanism-chain-v1-8899aabb'
  };
  const operationA = 'mechanism:lifecycle-admission-a-12345678';
  const operationC = 'mechanism:lifecycle-admission-c-12345678';
  const admissionA = { operation: { operationId: operationA, epoch: 0, binding,
    startedAt: 1000, cancelled: false }, heartbeatTimer: null };
  const admissionC = { operation: { operationId: operationC, epoch: 0, binding,
    startedAt: 1001, cancelled: false }, heartbeatTimer: null };
  let published = 0;
  const cleanupOperationIds = [];
  const invalidate = Function('chrome', 'publishCrossFigureMechanismProgress',
    'queueCrossFigureMechanismCleanup', 'admissionA', 'admissionC', `
    let crossFigureLogicRuntime = null;
    const crossFigureLogicAdmissions = new Map([
      [${JSON.stringify(operationA)}, admissionA],
      [${JSON.stringify(operationC)}, admissionC]
    ]);
    const crossFigureLogicAdmissionCancelReceipts = new Map();
    const crossFigureLogicAdmissionTombstones = new Map();
    let crossFigureLogicAdmissionSequence = 2;
    let crossFigureLogicLastPromotedSequence = 0;
    let crossFigureLogicPromise = Promise.resolve();
    let crossFigureLogicState = {
      result: null, pendingResult: null, status: 'queued', progress: {
        stage: 'collecting_panel_evidence', completed: 0, total: 0,
        elapsedSeconds: 0, heartbeatAt: 1000
      }, operation: { ...admissionA.operation },
      audit: { code: '', updatedAt: 1000 }, supplementalFingerprint: ''
    };
    ${contentFunctionSource('invalidateCrossFigureMechanismOperations')}
    invalidateCrossFigureMechanismOperations(2000);
    return { state: crossFigureLogicState, admissions: crossFigureLogicAdmissions,
      promise: crossFigureLogicPromise, admissionSequence: crossFigureLogicAdmissionSequence,
      promotedSequence: crossFigureLogicLastPromotedSequence };
  `)({ runtime: { sendMessage: async () => ({}) } },
    () => { published += 1; }, operation => {
      cleanupOperationIds.push(operation.operationId);
      return { cleanupPending: true };
    }, admissionA, admissionC);
  const result = invalidate;
  assert.equal(admissionA.operation.cancelled, true);
  assert.equal(admissionC.operation.cancelled, true);
  assert.equal(result.admissions.size, 0);
  assert.equal(result.promise, null);
  assert.equal(result.admissionSequence, 0);
  assert.equal(result.promotedSequence, 0);
  assert.equal(result.state.operation.operationId, operationA);
  assert.equal(result.state.operation.cancelled, true);
  assert.equal(result.state.status, 'cancelled');
  assert.equal(result.state.audit.code, 'MECHANISM_OPERATION_CANCELLED');
  assert.equal(published, 1);
  assert.deepEqual(cleanupOperationIds, [operationA, operationC]);
});

test('mechanism control message contains only the complete exact owner scope', () => {
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const build = executableContentFunction(
    'buildCrossFigureMechanismControlMessage',
    { crossFigureMechanismOwnData: own }
  );
  const operation = task8MechanismOperation();
  assert.deepEqual(build(operation, 'cancel'), {
    type: 'LLM_CONTROL_OPERATION', operationScope: 'mechanism',
    operationId: operation.operationId, command: 'cancel',
    evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
    documentId: operation.binding.documentId,
    workspaceId: operation.binding.workspaceId,
    workspaceGeneration: operation.binding.workspaceGeneration,
    workspaceLifecycle: operation.binding.workspaceLifecycle,
    baseWorkspaceRevision: operation.binding.baseWorkspaceRevision,
    mechanismChainFingerprint: operation.binding.mechanismChainFingerprint,
    evidenceSchemaVersion: EVIDENCE_FIRST_VERSIONS.evidenceSchemaVersion,
    canonicalSchemaVersion: EVIDENCE_FIRST_VERSIONS.canonicalSchemaVersion,
    idAlgorithmVersion: EVIDENCE_FIRST_VERSIONS.idAlgorithmVersion,
    normalizationVersion: EVIDENCE_FIRST_VERSIONS.normalizationVersion,
    promptVersion: EVIDENCE_FIRST_VERSIONS.promptVersion,
    cacheVersion: EVIDENCE_FIRST_VERSIONS.cacheVersion
  });
});

test('mechanism lifecycle cleanup retains each exact owner until strict cancel ACK', async () => {
  const own = executableContentFunction('crossFigureMechanismOwnData');
  const build = executableContentFunction(
    'buildCrossFigureMechanismControlMessage',
    { crossFigureMechanismOwnData: own }
  );
  const cleanupIntents = new Map();
  const queue = executableContentFunction('queueCrossFigureMechanismCleanup', {
    crossFigureLogicCleanupIntents: cleanupIntents,
    buildCrossFigureMechanismControlMessage: build,
    crossFigureMechanismOwnData: own,
    chrome: { runtime: { sendMessage: async () => ({ success: false }) } }
  });
  const first = task8MechanismOperation();
  const second = {
    ...task8MechanismOperation(),
    operationId: 'mechanism:cleanup-second-12345678'
  };
  let releaseFirst;
  let releaseSecond;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const secondGate = new Promise(resolve => { releaseSecond = resolve; });
  const sent = [];
  const firstIntent = queue(first, 'cancel', {
    primaryCode: 'MECHANISM_OPERATION_CANCELLED',
    sendMessage: async message => {
      sent.push(message);
      await firstGate;
      return { success: true, data: {
        operationId: first.operationId, cancelled: true, active: false
      } };
    }
  });
  const secondIntent = queue(second, 'cancel', {
    primaryCode: 'MECHANISM_OPERATION_CANCELLED',
    sendMessage: async message => {
      sent.push(message);
      await secondGate;
      return { success: true, data: {
        operationId: 'mechanism:wrong-owner-12345678',
        cancelled: true, active: false
      } };
    }
  });
  assert.equal(cleanupIntents.size, 2);
  assert.equal(firstIntent.cleanupPending, true);
  assert.equal(secondIntent.cleanupPending, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 2);
  releaseFirst();
  releaseSecond();
  const firstResult = await firstIntent.promise;
  assert.equal(firstResult.cancelled, true);
  assert.equal((await secondIntent.promise).pending, true);
  assert.equal(cleanupIntents.has(first.operationId), false);
  assert.equal(cleanupIntents.get(second.operationId), secondIntent);
  assert.equal(secondIntent.cleanupPending, true);
  assert.equal(secondIntent.primaryCode, 'MECHANISM_OPERATION_CANCELLED');
});

test('lifecycle invalidation preserves active public identity when another admission is pending', () => {
  const binding = {
    documentId: 'sha256:lifecycle-active', workspaceId: `workspace:${'9'.repeat(64)}`,
    workspaceGeneration: 14, workspaceLifecycle: 36, baseWorkspaceRevision: 16,
    mechanismChainFingerprint: 'mechanism-chain-v1-99aabbcc'
  };
  const operationB = 'mechanism:lifecycle-active-b-12345678';
  const operationA = 'mechanism:lifecycle-pending-a-12345678';
  const active = { operation: { operationId: operationB, epoch: 2, binding,
    startedAt: 1000, cancelled: false }, heartbeatTimer: null };
  const admission = { operation: { operationId: operationA, epoch: 0, binding,
    startedAt: 1500, cancelled: false }, heartbeatTimer: null };
  const controls = [];
  const result = Function('chrome', 'publishCrossFigureMechanismProgress',
    'queueCrossFigureMechanismCleanup', 'active', 'admission', `
    let crossFigureLogicRuntime = active;
    const crossFigureLogicAdmissions = new Map([[${JSON.stringify(operationA)}, admission]]);
    const crossFigureLogicAdmissionCancelReceipts = new Map();
    const crossFigureLogicAdmissionTombstones = new Map();
    let crossFigureLogicAdmissionSequence = 1;
    let crossFigureLogicLastPromotedSequence = 1;
    let crossFigureLogicPromise = Promise.resolve();
    let crossFigureLogicState = {
      result: null, pendingResult: null, status: 'working', progress: {
        stage: 'mapping_claim_relations', completed: 3, total: 8,
        elapsedSeconds: 1, heartbeatAt: 1800
      }, operation: { ...active.operation },
      audit: { code: '', updatedAt: 1800 }, supplementalFingerprint: ''
    };
    ${contentFunctionSource('invalidateCrossFigureMechanismOperations')}
    invalidateCrossFigureMechanismOperations(2000);
    return crossFigureLogicState;
  `)({ runtime: { sendMessage: async () => ({}) } }, () => true,
    operation => {
      controls.push(operation.operationId);
      return { cleanupPending: true };
    }, active, admission);
  assert.equal(result.operation.operationId, operationB);
  assert.equal(result.operation.cancelled, true);
  assert.equal(result.status, 'cancelled');
  assert.equal(active.operation.cancelled, true);
  assert.equal(admission.operation.cancelled, true);
  assert.deepEqual(controls, [operationB, operationA]);
});

test('lifecycle invalidation releases rather than cancels a workspace-committed mechanism', () => {
  const operation = task8MechanismOperation();
  const active = {
    operation: {
      ...operation, startedAt: 1000, cancelled: false, terminalCommitted: true,
      workspaceCommitted: true
    },
    heartbeatTimer: null
  };
  const controls = [];
  Function('publishCrossFigureMechanismProgress',
    'queueCrossFigureMechanismCleanup',
    'finalizeCommittedCrossFigureMechanismOperation', 'active', `
    let crossFigureLogicRuntime = active;
    const crossFigureLogicAdmissions = new Map();
    const crossFigureLogicAdmissionCancelReceipts = new Map();
    const crossFigureLogicAdmissionTombstones = new Map();
    let crossFigureLogicAdmissionSequence = 0;
    let crossFigureLogicLastPromotedSequence = 0;
    let crossFigureLogicPromise = Promise.resolve();
    let crossFigureLogicState = {
      result: null, pendingResult: null, status: 'working', progress: null,
      operation: { ...active.operation },
      audit: { code: '', updatedAt: 1000 }, supplementalFingerprint: ''
    };
    ${contentFunctionSource('invalidateCrossFigureMechanismOperations')}
    invalidateCrossFigureMechanismOperations(2000);
  `)(() => false, () => assert.fail(
    'a committed release cannot use the immediate-send cleanup queue'
  ), async committed => {
    controls.push(committed.operationId === operation.operationId ? 'release' : 'wrong');
    return { cleanupPending: true };
  }, active);
  assert.deepEqual(controls, ['release']);
});
