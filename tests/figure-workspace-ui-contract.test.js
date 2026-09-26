const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  compactPanelId,
  figurePanelDisplayId,
  figureWorkspaceViewInputFingerprint,
  createFigureWorkspaceDraft,
  applyFigureWorkspaceMutation
} = require('../core/figure-workspace.js');
const {
  normalizeWorkspaceCanonicalUrl
} = require('../core/article-workspace.js');
const I18n = require('../core/i18n.js');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function functionBody(script, name, nextName) {
  const start = script.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = nextName ? script.indexOf(`function ${nextName}`, start + 1) : script.length;
  return script.slice(start, end < 0 ? script.length : end);
}

function executableFunctionSource(script, name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const bodyStart = script.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === '{') depth += 1;
    if (script[index] === '}') depth -= 1;
    if (depth === 0) return script.slice(start, index + 1);
  }
  assert.fail(`${name} must have a complete body`);
}

function numericConstant(script, name) {
  const match = script.match(new RegExp(`const ${name} = (\\d+);`));
  assert.ok(match, `${name} must be an explicit numeric constant`);
  return Number(match[1]);
}

function loadPanelHeaderFormatter(script) {
  const names = [
    'FIGURE_PANEL_HEADER_MAX_LIST_ITEMS',
    'FIGURE_PANEL_HEADER_MAX_SEGMENT_CODE_POINTS',
    'FIGURE_PANEL_HEADER_MAX_DETAILS_CODE_POINTS'
  ];
  const truncateSource = executableFunctionSource(
    script, 'truncateFigurePanelHeaderText'
  );
  const detailsSource = executableFunctionSource(
    script, 'formatFigurePanelHeaderDetails'
  );
  const headerSource = executableFunctionSource(script, 'formatFigurePanelHeader');
  return new Function(...names,
    `${truncateSource}\n${detailsSource}\n${headerSource}\n` +
    'return { formatFigurePanelHeaderDetails, formatFigurePanelHeader };'
  )(...names.map(name => numericConstant(script, name)));
}

function hasBrokenSurrogate(value) {
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) return true;
  }
  return false;
}

function loadInlineEditingHelpers(script) {
  const mapper = executableFunctionSource(script, 'mapFigureWorkspaceEditDescriptor');
  const controller = executableFunctionSource(
    script, 'createFigureWorkspaceInlineEditController'
  );
  return new Function(
    `${mapper}\n${controller}\n` +
    'return { mapFigureWorkspaceEditDescriptor, createFigureWorkspaceInlineEditController };'
  )();
}

function loadSupplementalPlacementGesture(script) {
  return new Function(
    `${executableFunctionSource(script, 'createSupplementalFigurePlacementGesture')}\n` +
    'return createSupplementalFigurePlacementGesture;'
  )();
}

function loadSupplementalPointerCaptureHelpers(script) {
  return new Function(
    `${executableFunctionSource(script, 'trySetSupplementalPointerCapture')}\n` +
    `${executableFunctionSource(script, 'tryReleaseSupplementalPointerCapture')}\n` +
    'return { trySetSupplementalPointerCapture, tryReleaseSupplementalPointerCapture };'
  )();
}

function loadSupplementalPlacementKeyboardController(script) {
  return new Function(
    `${executableFunctionSource(script, 'createSupplementalPlacementKeyboardController')}\n` +
    'return createSupplementalPlacementKeyboardController;'
  )();
}

function loadMechanismSeedCoordinator(script) {
  return new Function(
    `${executableFunctionSource(script, 'createMechanismChainSeedCoordinator')}\n` +
    'return createMechanismChainSeedCoordinator;'
  )();
}

function loadMechanismActionCoordinator(script) {
  return new Function(
    `${executableFunctionSource(script, 'createMechanismActionCoordinator')}\n` +
    'return createMechanismActionCoordinator;'
  )();
}

function loadMechanismNetworkViewController(script) {
  return new Function(
    `${executableFunctionSource(script, 'createMechanismNetworkViewController')}\n` +
    'return createMechanismNetworkViewController;'
  )();
}

function loadMechanismMatrixNodeAxisModel(script) {
  return new Function(
    `${executableFunctionSource(script, 'mechanismMatrixNodeAxisModel')}\n` +
    'return mechanismMatrixNodeAxisModel;'
  )();
}

function loadMechanismMatrixCellEditorController(script) {
  return new Function(
    `${executableFunctionSource(script, 'createMechanismMatrixCellEditorController')}\n` +
    'return createMechanismMatrixCellEditorController;'
  )();
}

function loadOpenFigureWorkspaceInlineEditor(script, dependencies) {
  const openSource = executableFunctionSource(
    script, 'openFigureWorkspaceInlineEditor'
  ).replace(/^function /u, 'async function ');
  return new Function(
    'figureWorkspaceEditorLifecycle', 'activeSupplementalPlacementCleanup',
    'captureFigureWorkspaceEditContext', 'figureWorkspaceEditDescriptorKey',
    'findFigureWorkspaceEditTarget', 'figureWorkspaceInlineEditController',
    'createWorkspaceElement',
    `${executableFunctionSource(script, 'resolveFigureWorkspaceInlineEditMount')}\n` +
    `${openSource}\n` +
    'return openFigureWorkspaceInlineEditor;'
  )(...dependencies);
}

function loadMechanismNodeRemovalCoordinator(script) {
  return new Function(
    `${executableFunctionSource(script, 'createMechanismNodeRemovalCoordinator')}\n` +
    'return createMechanismNodeRemovalCoordinator;'
  )();
}

function loadFigureWorkspaceEditTargetSelector(script) {
  return new Function(
    `${executableFunctionSource(script, 'selectFigureWorkspaceEditTarget')}\n` +
    'return selectFigureWorkspaceEditTarget;'
  )();
}

function loadMechanismNetworkResizeController(script) {
  return new Function(
    `${executableFunctionSource(script, 'createMechanismNetworkResizeController')}\n` +
    'return createMechanismNetworkResizeController;'
  )();
}

function loadMechanismNetworkCanvasScale(script) {
  return new Function(
    `${executableFunctionSource(script, 'mechanismNetworkCanvasScale')}\n` +
    'return mechanismNetworkCanvasScale;'
  )();
}

function loadMechanismNetworkViewModeHelpers(script, document = undefined) {
  return new Function('document',
    `${executableFunctionSource(script, 'normalizeMechanismNetworkViewMode')}\n` +
    `${executableFunctionSource(script, 'mechanismNetworkViewPaperKey')}\n` +
    `${executableFunctionSource(script, 'createMechanismNetworkViewModeCache')}\n` +
    `${executableFunctionSource(script, 'applyMechanismMermaidViewMode')}\n` +
    `${executableFunctionSource(script, 'createMechanismMermaidViewControls')}\n` +
    'return { normalizeMechanismNetworkViewMode, mechanismNetworkViewPaperKey, ' +
      'createMechanismNetworkViewModeCache, applyMechanismMermaidViewMode, ' +
      'createMechanismMermaidViewControls };'
  )(document);
}

function loadFigureWorkspaceMetaActionCoordinator(script) {
  return new Function(
    `${executableFunctionSource(script, 'createFigureWorkspaceMetaActionCoordinator')}\n` +
    'return createFigureWorkspaceMetaActionCoordinator;'
  )();
}

function loadFigureMetaExpansionHelpers(script) {
  return new Function(
    `${executableFunctionSource(script, 'normalizeFigureMetaExpansionEntries')}\n` +
    `${executableFunctionSource(script, 'restoreFigureMetaExpansionState')}\n` +
    'return { normalizeFigureMetaExpansionEntries, restoreFigureMetaExpansionState };'
  )();
}

function loadMechanismGenerationFinalizer(script) {
  return new Function(
    `${executableFunctionSource(script, 'finalizeSuccessfulMechanismGeneration')}\n` +
    'return finalizeSuccessfulMechanismGeneration;'
  )();
}

function loadFigureRecoveryUiHelpers(script) {
  return new Function('t',
    `${executableFunctionSource(script, 'normalizeFigureRecoveryPanelLabels')}\n` +
    `${executableFunctionSource(script, 'figureRecoveryInputModeBadge')}\n` +
    `${executableFunctionSource(script, 'figureRecoveryRetryLabels')}\n` +
    `${executableFunctionSource(script, 'figureRecoveryPhaseText')}\n` +
    `${executableFunctionSource(script, 'figureRecoveryRetryPresentation')}\n` +
    'return { figureRecoveryInputModeBadge, figureRecoveryRetryLabels, ' +
      'figureRecoveryPhaseText, figureRecoveryRetryPresentation };'
  )(value => String(value || ''));
}

function loadFigureProgressFormatter(script, translate) {
  return new Function('t',
    `${functionBody(script, 'normalizeFigureRecoveryPanelLabels', 'compactFigureResultConclusion')}\n` +
    'return formatFigureProgress;'
  )(translate);
}

test('Figure recovery UI badges input provenance and scopes retry to unresolved labels', () => {
  const helpers = loadFigureRecoveryUiHelpers(read('popup.js'));
  assert.equal(helpers.figureRecoveryInputModeBadge('caption_context'), '图注/正文回退');
  assert.equal(helpers.figureRecoveryInputModeBadge('figure_image'), '整张 Figure 图片');
  assert.equal(helpers.figureRecoveryInputModeBadge('panel_crop'), 'Panel 裁切图');
  const labels = helpers.figureRecoveryRetryLabels({
    panelHints: ['A', 'B', 'C', 'D']
  }, {
    panels: [{ panel: 'A' }, { panel: 'B' },
      { panel: 'C', status: 'not_identifiable' }],
    panelCoverage: { missingPanels: ['D'], unresolvedPanels: ['C'] }
  }, { missingPanels: ['D'], unresolvedPanels: ['C'] });
  assert.deepEqual(labels, ['C', 'D']);
  assert.deepEqual(helpers.figureRecoveryRetryLabels({ panelHints: ['A'] }, {
    panels: [{ panel: 'A' }], panelCoverage: { missingPanels: [] }
  }, {}), []);
  const popup = read('popup.js');
  assert.match(popup, /retryMissingFigurePanelsWithLLM/);
  assert.match(popup, /aria-label/);
  assert.match(popup, /重试缺失 Panel/);
  assert.doesNotMatch(popup, /Provider returned an invalid response[^\n]*覆盖/u);
});

test('Figure recovery strings have Chinese and English accessible translations', () => {
  const i18n = read('core/i18n.js');
  assert.match(i18n, /'图注\/正文回退':\s*'Caption\/article-text fallback'/u);
  assert.match(i18n, /'重试缺失 Panel':\s*'Retry missing Panels'/u);
  assert.match(i18n, /'待补 Panel':\s*'Missing Panels'/u);
  const helpers = loadFigureRecoveryUiHelpers(read('popup.js'));
  const en = value => I18n.translateInterfaceText(value, 'en');
  const badge = helpers.figureRecoveryInputModeBadge('caption_context', en);
  const phase = helpers.figureRecoveryPhaseText(
    'figure_panel_recovery_checkpoint_pending', en
  );
  const retry = helpers.figureRecoveryRetryPresentation({
    activeDepth: 'deep', pendingDeep: {}, panelHints: ['A', 'B']
  }, {
    panels: [{ panel: 'A' }, { panel: 'B', status: 'not_identifiable' }],
    unresolvedPanels: ['B']
  }, { unresolvedPanels: ['B'] }, en);
  assert.equal(badge, 'Caption/article-text fallback');
  assert.equal(phase, 'Validated Panels are waiting to be saved');
  assert.equal(retry.enabled, true);
  assert.equal(retry.action, 'deep_rerun');
  assert.match(retry.explanation, /deep analysis/i);
  assert.doesNotMatch(
    [badge, phase, retry.label, retry.ariaLabel, retry.explanation].join(' '),
    /[\u3400-\u9fff]/u
  );
  const popup = read('popup.js');
  assert.match(popup, /figureRecoveryRetryPresentation\(/u);
  assert.match(popup,
    /retry\.disabled = loading \|\| recoveryLocked \|\| !retryPresentation\.enabled/u);
});

test('Figure recovery popup lock coalesces double-click dispatch and unlocks in finally', async () => {
  const script = read('popup.js');
  const lock = new Map();
  const run = new Function('figureRecoveryInFlightActions',
    `${executableFunctionSource(script, 'runKeyedFigureRecoveryAction')}\n` +
    'return runKeyedFigureRecoveryAction;'
  )(lock);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let dispatches = 0;
  let locks = 0;
  let unlocks = 0;
  const task = () => { dispatches += 1; return gate.then(() => 'done'); };
  const first = run('12:figure-1:missing_panels', task,
    () => { locks += 1; }, () => { unlocks += 1; });
  const duplicate = run('12:figure-1:missing_panels', task,
    () => { locks += 1; }, () => { unlocks += 1; });
  assert.equal(first, duplicate);
  assert.equal(dispatches, 0);
  await Promise.resolve();
  assert.equal(dispatches, 1);
  assert.equal(locks, 1);
  release();
  assert.equal(await first, 'done');
  assert.equal(unlocks, 1);
  assert.equal(lock.size, 0);
  assert.match(script, /aria-busy/u);
  assert.match(script, /analyzeSingleFigureDeepWithLLM/u);
});

test('English Figure recovery progress contains no untranslated Chinese status or detail text', () => {
  const en = value => I18n.translateInterfaceText(value, 'en');
  const formatProgress = loadFigureProgressFormatter(read('popup.js'), en);
  const rendered = formatProgress({
    phase: 'figure_panel_recovery_checkpoint_pending',
    totalFigures: 2,
    completedFigures: 1,
    expectedPanels: ['A', 'B'],
    totalPanelBatches: 2,
    completedPanelBatches: 1,
    recognizedPanelCount: 1,
    batchRecognizedPanelCount: 1,
    missingPanels: ['B'],
    validatedPanelCount: 1,
    checkpointStatus: 'pending_save',
    inputMode: 'caption_context',
    visionFallback: true,
    route: { effectiveProfileName: 'Vision', model: 'model-v', capabilityMode: 'vision' },
    elapsedSeconds: 3
  });
  assert.doesNotMatch([rendered.phaseText, ...rendered.details].join(' '), /[\u3400-\u9fff]/u);
  assert.equal(rendered.elapsedDetailIndex, rendered.details.length - 1);
  assert.doesNotMatch(read('popup.js'), /detail\.startsWith\('已用时 '\)/u);
});

test('supplemental placement gesture requires a 400ms left-button hold and cancels before activation', () => {
  const createGesture = loadSupplementalPlacementGesture(read('popup.js'));
  const scheduled = [];
  const cancelled = [];
  const activations = [];
  const gesture = createGesture({
    schedule(callback, delay) { scheduled.push({ callback, delay }); return scheduled.length; },
    cancelSchedule(token) { cancelled.push(token); },
    isConnected: () => true,
    activate: record => activations.push(record)
  });

  assert.equal(gesture.pointerDown({ button: 2, pointerId: 1, clientX: 0, clientY: 0 }), false);
  assert.equal(scheduled.length, 0);
  assert.equal(gesture.pointerDown({ button: 0, pointerId: 2, clientX: 10, clientY: 20 }), true);
  assert.equal(scheduled[0].delay, 400);
  gesture.pointerMove({ pointerId: 2, clientX: 17, clientY: 20 });
  scheduled[0].callback();
  assert.equal(activations.length, 0);
  assert.deepEqual(cancelled, [1]);

  gesture.pointerDown({ button: 0, pointerId: 3, clientX: 1, clientY: 2 });
  gesture.pointerUp({ pointerId: 3, clientX: 1, clientY: 2 });
  scheduled[1].callback();
  assert.equal(activations.length, 0);
});

test('active supplemental placement gesture captures movement and drops exactly once', () => {
  const createGesture = loadSupplementalPlacementGesture(read('popup.js'));
  const scheduled = [];
  const events = [];
  const gesture = createGesture({
    schedule(callback) { scheduled.push(callback); return scheduled.length; },
    cancelSchedule() {},
    isConnected: () => true,
    activate: record => events.push(['activate', record.pointerId]),
    move: (_record, event) => events.push(['move', event.clientY]),
    drop: (_record, event) => events.push(['drop', event.clientY]),
    cancel: (_record, reason) => events.push(['cancel', reason])
  });

  gesture.pointerDown({ button: 0, pointerId: 7, clientX: 4, clientY: 5 });
  scheduled[0]();
  assert.equal(gesture.getState().active, true);
  gesture.pointerMove({ pointerId: 7, clientX: 50, clientY: 70 });
  gesture.pointerUp({ pointerId: 7, clientX: 50, clientY: 80 });
  gesture.pointerUp({ pointerId: 7, clientX: 50, clientY: 90 });
  assert.deepEqual(events, [
    ['activate', 7], ['move', 70], ['drop', 80]
  ]);

  gesture.pointerDown({ button: 0, pointerId: 8, clientX: 1, clientY: 1 });
  scheduled[1]();
  gesture.pointerCancel({ pointerId: 8 });
  assert.equal(events.at(-1)[0], 'cancel');
  gesture.destroy();
  assert.equal(gesture.getState().tracking, false);
});

test('pointer capture failures cancel safely, clean once, and allow a fresh long press', () => {
  const popup = read('popup.js');
  const createGesture = loadSupplementalPlacementGesture(popup);
  const capture = loadSupplementalPointerCaptureHelpers(popup);
  const scheduled = [];
  let shouldThrow = true;
  let cleanups = 0;
  let errors = 0;
  let drops = 0;
  const target = {
    setPointerCapture() {
      if (shouldThrow) throw Object.assign(new Error('capture failed'), {
        name: 'NotFoundError'
      });
    },
    releasePointerCapture() { throw new Error('release failed'); }
  };
  const gesture = createGesture({
    schedule(callback) { scheduled.push(callback); return scheduled.length; },
    cancelSchedule() {},
    isConnected: () => true,
    activate: record => capture.trySetSupplementalPointerCapture(target, record.pointerId),
    drop: record => {
      capture.tryReleaseSupplementalPointerCapture(target, record.pointerId);
      drops += 1;
    },
    cleanup: () => { cleanups += 1; },
    onError: () => { errors += 1; }
  });

  gesture.pointerDown({ button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  assert.doesNotThrow(() => scheduled[0]());
  assert.deepEqual(gesture.getState(), { tracking: false, active: false, pointerId: null });
  assert.equal(cleanups, 1);
  assert.equal(drops, 0);

  shouldThrow = false;
  gesture.pointerDown({ button: 0, pointerId: 2, clientX: 0, clientY: 0 });
  scheduled[1]();
  assert.doesNotThrow(() => gesture.pointerUp({ pointerId: 2 }));
  assert.equal(cleanups, 2);
  assert.equal(drops, 1);
  assert.equal(errors, 0);
});

test('cancel and lost-capture paths swallow callback errors and run idempotent cleanup', () => {
  const createGesture = loadSupplementalPlacementGesture(read('popup.js'));
  const scheduled = [];
  let cleanups = 0;
  let errors = 0;
  const gesture = createGesture({
    schedule(callback) { scheduled.push(callback); return scheduled.length; },
    cancelSchedule() {},
    isConnected: () => true,
    activate: () => true,
    cancel: () => { throw new Error('release failed'); },
    cleanup: () => { cleanups += 1; },
    onError: () => { errors += 1; }
  });
  gesture.pointerDown({ button: 0, pointerId: 3, clientX: 0, clientY: 0 });
  scheduled[0]();
  assert.doesNotThrow(() => gesture.pointerCancel({ pointerId: 3 }));
  assert.equal(gesture.pointerCancel({ pointerId: 3 }), false);
  assert.equal(cleanups, 1);
  assert.equal(errors, 1);
});

test('touch movement before activation cancels without preventing scroll or creating drag UI', () => {
  const createGesture = loadSupplementalPlacementGesture(read('popup.js'));
  const scheduled = [];
  let prevented = 0;
  let activated = 0;
  const gesture = createGesture({
    schedule(callback) { scheduled.push(callback); return scheduled.length; },
    cancelSchedule() {},
    isConnected: () => true,
    activate: () => { activated += 1; return true; }
  });
  gesture.pointerDown({ button: 0, pointerId: 4, pointerType: 'touch', clientX: 0, clientY: 0 });
  gesture.pointerMove({
    pointerId: 4, pointerType: 'touch', clientX: 0, clientY: 7,
    preventDefault: () => { prevented += 1; }
  });
  scheduled[0]();
  assert.equal(prevented, 0);
  assert.equal(activated, 0);
  assert.equal(gesture.getState().tracking, false);
});

test('keyboard and pointer placement helpers derive bounded supplement slots without moving mains', () => {
  const popup = read('popup.js');
  const helpers = new Function('SciLLM',
    `${executableFunctionSource(popup, 'supplementalPlacementForMove')}\n` +
    `${executableFunctionSource(popup, 'supplementalPlacementsFromOrder')}\n` +
    `${executableFunctionSource(popup, 'supplementalDropOrder')}\n` +
    'return { supplementalPlacementForMove, supplementalPlacementsFromOrder, ' +
    'supplementalDropOrder };'
  )({ normalizeSupplementalPlacements: require('../core/figure-workspace.js')
    .normalizeSupplementalPlacements });
  const main1 = { figureId: 'm1', figureLabel: 'Figure 1', isSupplemental: false };
  const main2 = { figureId: 'm2', figureLabel: 'Figure 2', isSupplemental: false };
  const supp1 = { figureId: 's1', figureLabel: 'Figure S1', isSupplemental: true };
  const supp2 = { figureId: 's2', figureLabel: 'Figure S2', isSupplemental: true };
  const ordered = [main1, supp1, main2, supp2];

  assert.deepEqual(helpers.supplementalPlacementForMove('s1', -1, ordered), [
    { figureId: 's1', slot: 0, rank: 0 },
    { figureId: 's2', slot: 2, rank: 0 }
  ]);
  assert.deepEqual(helpers.supplementalPlacementForMove('s1', 1, ordered), [
    { figureId: 's1', slot: 2, rank: 0 },
    { figureId: 's2', slot: 2, rank: 1 }
  ]);
  assert.equal(helpers.supplementalPlacementForMove('s2', 1, ordered), null);
  const cards = ordered.map((item, index) => ({
    isConnected: true,
    dataset: { figureId: item.figureId },
    getBoundingClientRect: () => ({ top: index * 100, height: 80 })
  }));
  const dropped = helpers.supplementalDropOrder('s2', ordered, cards, -1);
  assert.deepEqual(dropped.ordered.map(item => item.figureId), ['s2', 'm1', 's1', 'm2']);
  assert.deepEqual(helpers.supplementalPlacementsFromOrder(dropped.ordered), [
    { figureId: 's2', slot: 0, rank: 0 },
    { figureId: 's1', slot: 1, rank: 0 }
  ]);
  const duplicate = [main1, supp1, { ...supp1 }, main2];
  assert.equal(helpers.supplementalPlacementForMove('s1', 1, duplicate), null);
  assert.equal(helpers.supplementalPlacementsFromOrder(duplicate), null);
  assert.equal(helpers.supplementalDropOrder('s1', duplicate, cards, 50), null);
});

test('supplemental keyboard placement restores valid controls after a failed CAS save', async () => {
  const createController = loadSupplementalPlacementKeyboardController(read('popup.js'));
  const disabled = [];
  let calls = 0;
  const controller = createController({
    canMove: direction => direction < 0,
    setDisabled: (up, down) => disabled.push([up, down]),
    getPlacements: () => [{ figureId: 's2', slot: 1, rank: 0 }],
    captureContext: () => ({ key: 'paper-a' }),
    isContextCurrent: context => context.key === 'paper-a',
    isAttached: () => true,
    persist: async () => {
      calls += 1;
      throw Object.assign(new Error('conflict'), {
        code: 'FIGURE_WORKSPACE_REVISION_CONFLICT'
      });
    }
  });

  assert.equal((await controller.move(-1)).status, 'failed');
  assert.deepEqual(disabled, [[true, true], [false, true]]);
  assert.equal((await controller.move(-1)).status, 'failed');
  assert.equal(calls, 2);
});

test('supplemental keyboard placement coalesces clicks and keeps stale controls inert', async () => {
  const createController = loadSupplementalPlacementKeyboardController(read('popup.js'));
  let release;
  let contextCurrent = true;
  let attached = true;
  let calls = 0;
  const disabled = [];
  const controller = createController({
    canMove: () => true,
    setDisabled: (up, down) => disabled.push([up, down]),
    getPlacements: () => [{ figureId: 's1', slot: 0, rank: 0 }],
    captureContext: () => ({ key: 'paper-a' }),
    isContextCurrent: () => contextCurrent,
    isAttached: () => attached,
    persist: () => {
      calls += 1;
      return new Promise((_, reject) => { release = reject; });
    }
  });
  const first = controller.move(1);
  const duplicate = controller.move(1);
  assert.equal(first, duplicate);
  assert.equal(calls, 1);
  contextCurrent = false;
  attached = false;
  release(new Error('late failure'));
  assert.equal((await first).status, 'stale');
  assert.deepEqual(disabled, [[true, true]]);

  const successfulDisabled = [];
  const successful = createController({
    canMove: () => true,
    setDisabled: (up, down) => successfulDisabled.push([up, down]),
    getPlacements: () => [{ figureId: 's1', slot: 0, rank: 0 }],
    captureContext: () => ({ key: 'paper-a' }),
    isContextCurrent: () => true,
    isAttached: () => true,
    persist: async () => ({ success: true })
  });
  assert.equal((await successful.move(1)).status, 'saved');
  assert.deepEqual(successfulDisabled, [[true, true]]);
});

test('Figure renderer orders from the draft and binds drag only to supplemental summaries', () => {
  const popup = read('popup.js');
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceSnapshot', 'reconcileArticleWorkspaceSnapshot'
  );
  assert.match(renderer,
    /SciLLM\.orderFigureWorkspaceItems\(figures,\s*figureWorkspaceDraft\?\.supplementalPlacements\)/);
  assert.match(renderer, /movableSupplementalFigureIds/);
  assert.match(renderer,
    /figure\.isSupplemental === true &&\s*movableSupplementalFigureIds\.has\(figure\.figureId\)/);
  assert.doesNotMatch(renderer, /supplementalIdsByMain/);
});

test('supplemental placement UI persists one CAS mutation and exposes keyboard moves', () => {
  const popup = read('popup.js');
  const persistence = functionBody(
    popup, 'persistSupplementalFigurePlacements', 'supplementalPlacementForMove'
  );
  const binding = functionBody(
    popup, 'bindSupplementalFigurePlacementInteractions', 'renderFigureWorkspaceSnapshot'
  );
  assert.match(persistence, /type: 'set_supplemental_placements'/);
  assert.match(persistence, /expectedRevision/);
  assert.match(persistence, /workspaceTarget: buildFigureWorkspaceEditTarget\(context\)/);
  assert.match(binding, /createSupplementalFigurePlacementGesture/);
  assert.match(binding, /workspace-supplemental-drag-ghost/);
  assert.match(binding, /workspace-supplemental-drop-line/);
  assert.match(binding, /上移/);
  assert.match(binding, /下移/);
  assert.match(binding, /disabled/);
  assert.match(binding, /figureWorkspaceRenderCoordinator\.getState\(\)\.editing/);
  assert.match(binding, /请先完成当前 Figure 编辑/);
  assert.match(binding, /createSupplementalPlacementKeyboardController/);
  assert.match(binding, /contextmenu/);
  assert.match(binding, /touchAction/);
  assert.match(binding, /trySetSupplementalPointerCapture/);
  assert.match(binding, /tryReleaseSupplementalPointerCapture/);
  const inlineOpen = functionBody(
    popup, 'openFigureWorkspaceInlineEditor', 'appendFigureWorkspaceViewField'
  );
  assert.match(inlineOpen, /activeSupplementalPlacementCleanup/);
  const css = read('popup.css');
  assert.match(css, /\.workspace-supplemental-drag-ghost/);
  assert.match(css, /\.workspace-supplemental-drop-line/);
});

function loadFigureWorkspaceLifecycleHelpers(script) {
  const mapper = executableFunctionSource(script, 'mapFigureWorkspaceEditDescriptor');
  const controller = executableFunctionSource(
    script, 'createFigureWorkspaceInlineEditController'
  );
  const renderer = executableFunctionSource(
    script, 'createFigureWorkspaceRenderCoordinator'
  );
  const lifecycle = executableFunctionSource(
    script, 'createFigureWorkspaceEditorLifecycleCoordinator'
  );
  return new Function(
    `${mapper}\n${controller}\n${renderer}\n${lifecycle}\n` +
    'return { createFigureWorkspaceInlineEditController, ' +
    'createFigureWorkspaceRenderCoordinator, ' +
    'createFigureWorkspaceEditorLifecycleCoordinator };'
  )();
}

function loadArticleWorkspaceSnapshotReconciler(script) {
  const reconciler = executableFunctionSource(
    script, 'reconcileArticleWorkspaceSnapshot'
  );
  return new Function(
    'SciLLM', `${reconciler}\nreturn { reconcileArticleWorkspaceSnapshot };`
  )({ normalizeWorkspaceCanonicalUrl });
}

function loadEvidenceUiHelpers(script) {
  const bind = executableFunctionSource(script, 'bindFigureEvidenceExpansion');
  const summary = executableFunctionSource(script, 'summarizeFigureEvidenceLabel');
  const state = new Map();
  return new Function('figureEvidenceExpansionState',
    `${bind}\n${summary}\nreturn { bindFigureEvidenceExpansion, ` +
    'summarizeFigureEvidenceLabel };'
  )(state);
}

test('inline Figure descriptor mapping allowlists every rendered field', () => {
  const { mapFigureWorkspaceEditDescriptor } = loadInlineEditingHelpers(read('popup.js'));
  const overviewFields = [
    'figureQuestion', 'coreConclusion', 'claimBoundary', 'authorAssembly',
    'remainingQuestion'
  ];
  overviewFields.forEach(field => assert.deepEqual(
    mapFigureWorkspaceEditDescriptor({
      scope: 'overview', figureId: 'figure-1', field
    }, 'new value', 7),
    {
      type: 'set_figure_field', expectedRevision: 7,
      figureId: 'figure-1', field, value: 'new value'
    }
  ));

  const scalarFields = [
    'purpose', 'evidenceType', 'phenotypeName', 'design', 'comparison',
    'directObservation', 'localInference', 'contribution', 'note'
  ];
  scalarFields.forEach(field => assert.deepEqual(
    mapFigureWorkspaceEditDescriptor({
      scope: 'panel', figureId: 'figure-1', panelId: 'A', field
    }, 'new value', 8),
    {
      type: 'set_panel_field', expectedRevision: 8,
      figureId: 'figure-1', panelId: 'A', field, value: 'new value'
    }
  ));

  ['experimentalMethods', 'statisticalMethods'].forEach(field => assert.deepEqual(
    mapFigureWorkspaceEditDescriptor({
      scope: 'panel', figureId: 'figure-1', panelId: 'A', field
    }, ' microscopy \n\n ANOVA ', 9),
    {
      type: 'set_panel_list', expectedRevision: 9,
      figureId: 'figure-1', panelId: 'A', field,
      value: ['microscopy', 'ANOVA']
    }
  ));

  for (const descriptor of [
    { scope: 'overview', figureId: 'figure-1', field: '__proto__' },
    { scope: 'panel', figureId: 'figure-1', panelId: 'A', field: 'constructor' },
    { scope: 'panel', figureId: 'prototype', panelId: 'A', field: 'note' },
    { scope: 'panel', figureId: 'figure-1', panelId: '__PROTO__', field: 'note' },
    { scope: 'unknown', figureId: 'figure-1', field: 'figureQuestion' }
  ]) {
    assert.throws(
      () => mapFigureWorkspaceEditDescriptor(descriptor, 'x', 1),
      error => error.code === 'FIGURE_WORKSPACE_EDIT_DESCRIPTOR_INVALID'
    );
  }
});

test('mechanism inline descriptors reuse the conflict-safe Figure draft editor', () => {
  const { mapFigureWorkspaceEditDescriptor } = loadInlineEditingHelpers(read('popup.js'));
  assert.deepEqual(mapFigureWorkspaceEditDescriptor({
    scope: 'mechanism-node', nodeId: 'node-1', field: 'label'
  }, '新节点', 12), {
    type: 'update_mechanism_node', expectedRevision: 12,
    nodeId: 'node-1', field: 'label', value: '新节点'
  });
  assert.deepEqual(mapFigureWorkspaceEditDescriptor({
    scope: 'mechanism-edge', edgeId: 'edge-1', field: 'label'
  }, '促进', 13), {
    type: 'update_mechanism_edge', expectedRevision: 13,
    edgeId: 'edge-1', field: 'label', value: '促进'
  });
  assert.throws(() => mapFigureWorkspaceEditDescriptor({
    scope: 'mechanism-node', nodeId: '__proto__', field: 'label'
  }, 'x', 1), error => error.code === 'FIGURE_WORKSPACE_EDIT_DESCRIPTOR_INVALID');
});

test('research meta inline descriptors reuse the conflict-safe Figure draft editor', () => {
  const { mapFigureWorkspaceEditDescriptor } = loadInlineEditingHelpers(read('popup.js'));
  assert.deepEqual(mapFigureWorkspaceEditDescriptor({
    scope: 'meta', collection: 'backgroundItems', index: 0, field: 'value'
  }, 'Known biology', 14), {
    type: 'update_background_item', expectedRevision: 14,
    index: 0, value: 'Known biology'
  });
  assert.deepEqual(mapFigureWorkspaceEditDescriptor({
    scope: 'meta', collection: 'scientificQuestions', index: 3, field: 'value'
  }, 'What is necessary?', 15), {
    type: 'update_scientific_question', expectedRevision: 15,
    index: 3, value: 'What is necessary?'
  });
  for (const descriptor of [
    { scope: 'meta', collection: '__proto__', index: 0, field: 'value' },
    { scope: 'meta', collection: 'backgroundItems', index: -1, field: 'value' },
    { scope: 'meta', collection: 'backgroundItems', index: 64, field: 'value' },
    { scope: 'meta', collection: 'backgroundItems', index: 0, field: 'constructor' }
  ]) {
    assert.throws(
      () => mapFigureWorkspaceEditDescriptor(descriptor, 'x', 1),
      error => error.code === 'FIGURE_WORKSPACE_EDIT_DESCRIPTOR_INVALID'
    );
  }
});

test('Figure ordering stays independent after the extra note extraction section is removed', () => {
  const popup = read('popup.js');
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceSnapshot', 'reconcileArticleWorkspaceSnapshot'
  );
  assert.doesNotMatch(renderer, /renderFigureWorkspaceMetaSnapshot\(/);
  assert.ok(renderer.indexOf('SciLLM.orderFigureWorkspaceItems(') <
    renderer.indexOf('displayFigures.forEach('));
  // The user explicitly removed the separate background/innovation tools.
  // Ordinary template fields and their AI generation remain in the drawer.
  assert.doesNotMatch(popup, /function renderLiteratureNotePaperMetaTools\(/);
  assert.doesNotMatch(read('popup.html'), /id="literatureNotePaperMeta"/);
  assert.match(read('popup.html'), /id="autofillLiteratureNote"/);
  assert.match(read('popup.html'), /id="literatureNoteFields"/);
});

test('research meta actions use frozen context, serialized CAS saves, and retain editor failures', () => {
  const popup = read('popup.js');
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceMetaSnapshot', 'syncFigureQuickNavFromScroll'
  );
  assert.match(renderer, /captureFigureWorkspaceEditContext\(\)/);
  assert.match(renderer, /safelyPersistFigureWorkspaceMetaMutation/);
  const persistence = functionBody(
    popup, 'persistFigureWorkspaceMetaMutation', 'safelyPersistFigureWorkspaceMetaMutation'
  );
  assert.match(persistence, /mechanismChainContextKey\(context\)/);
  assert.match(persistence, /expectedRevision/);
  assert.match(persistence, /workspaceTarget: buildFigureWorkspaceEditTarget\(context\)/);
  assert.doesNotMatch(persistence,
    /integrateMechanismChainDraft\(response\.draft, context\)/,
    'raw persistence must not integrate before the action attachment/context guard');
  const coordinator = executableFunctionSource(
    popup, 'createFigureWorkspaceMetaActionCoordinator'
  );
  assert.match(coordinator, /integrate\(response\.draft, context\)/);
  const safePersistence = functionBody(
    popup, 'safelyPersistFigureWorkspaceMetaMutation', 'renderFigureWorkspaceMetaSnapshot'
  );
  assert.match(safePersistence, /response\?\.success === false/);
  assert.match(safePersistence, /输入已保留/);
  const inline = functionBody(
    popup, 'openFigureWorkspaceInlineEditor', 'appendFigureWorkspaceViewField'
  );
  assert.match(inline, /figureWorkspaceEditorLifecycle\.begin/);
  assert.match(inline, /figureWorkspaceInlineEditController\.update/);
  assert.match(inline, /figureWorkspaceInlineEditController\.save/);
});

test('research meta structure actions reject old-index replay and persist exactly once', async () => {
  const createCoordinator = loadFigureWorkspaceMetaActionCoordinator(read('popup.js'));
  let resolvePersist;
  const persisted = [];
  const disabled = [];
  const integrated = [];
  const focused = [];
  const context = { key: 'paper-a' };
  const coordinator = createCoordinator({
    keyForContext: value => value.key,
    isContextCurrent: () => true,
    persist: (mutation, frozen) => new Promise(resolve => {
      persisted.push([mutation, frozen]);
      resolvePersist = resolve;
    }),
    integrate: draft => integrated.push(draft)
  });
  const operation = {
    isAttached: () => true,
    setDisabled: value => disabled.push(value),
    focus: response => focused.push(response.draft.revision)
  };
  const first = coordinator.run({ type: 'remove_background_item', index: 0 }, context, operation);
  const doubleSame = await coordinator.run(
    { type: 'remove_background_item', index: 0 }, context, operation
  );
  const differentOldIndex = await coordinator.run(
    { type: 'remove_background_item', index: 1 }, context, operation
  );
  assert.equal(doubleSame.code, 'FIGURE_WORKSPACE_META_ACTION_PENDING');
  assert.equal(differentOldIndex.code, 'FIGURE_WORKSPACE_META_ACTION_PENDING');
  assert.equal(persisted.length, 1);
  resolvePersist({ success: true, draft: { revision: 9 } });
  assert.equal((await first).success, true);
  assert.deepEqual(integrated, [{ revision: 9 }]);
  assert.deepEqual(focused, [9]);
  assert.deepEqual(disabled, [true, false]);
  assert.deepEqual(coordinator.getState(), { pendingKeys: [] });
});

test('research meta structure actions never integrate or steal focus when stale or detached', async () => {
  const createCoordinator = loadFigureWorkspaceMetaActionCoordinator(read('popup.js'));
  for (const failure of ['stale', 'detached']) {
    let current = true;
    let attached = true;
    let resolvePersist;
    const integrated = [];
    const focused = [];
    const disabled = [];
    const coordinator = createCoordinator({
      keyForContext: () => failure,
      isContextCurrent: () => current,
      persist: () => new Promise(resolve => { resolvePersist = resolve; }),
      integrate: draft => integrated.push(draft)
    });
    const pending = coordinator.run({ type: 'add_background_item' }, { key: failure }, {
      isAttached: () => attached,
      setDisabled: value => disabled.push(value),
      focus: () => focused.push('focus')
    });
    if (failure === 'stale') current = false;
    else attached = false;
    resolvePersist({ success: true, draft: { revision: 2 } });
    const result = await pending;
    assert.equal(result.stale, true, failure);
    assert.deepEqual(integrated, [], failure);
    assert.deepEqual(focused, [], failure);
    assert.equal(disabled[0], true, failure);
    assert.deepEqual(coordinator.getState(), { pendingKeys: [] }, failure);
  }
});

test('research meta expansion cache restores per-paper state before rendering', () => {
  const popup = read('popup.js');
  const { restoreFigureMetaExpansionState } = loadFigureMetaExpansionHelpers(popup);
  const state = new Map();
  restoreFigureMetaExpansionState(state, [
    ['backgroundItems', true], ['scientificQuestions', false], ['__proto__', true]
  ]);
  assert.deepEqual([...state], [
    ['backgroundItems', true], ['scientificQuestions', false]
  ]);
  restoreFigureMetaExpansionState(state, [['scientificQuestions', true]]);
  assert.deepEqual([...state], [['scientificQuestions', true]],
    'Paper B must not inherit Paper A expansion state');
  const cache = functionBody(popup, 'cacheCurrentPanelTabState', 'resetPanelArticleState');
  assert.match(cache, /figureMetaExpansion:/);
  const restore = functionBody(popup, 'restorePanelTabState', 'synchronizeActiveTabContext');
  const restoreIndex = restore.indexOf('restoreFigureMetaExpansionState(');
  const renderIndex = restore.indexOf('renderArticleWorkspaceSnapshot(');
  assert.ok(restoreIndex >= 0 && restoreIndex < renderIndex);
});

test('successful research meta mutations restore intentional focus while stale results do not', () => {
  const popup = read('popup.js');
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceMetaSnapshot', 'syncFigureQuickNavFromScroll'
  );
  assert.match(renderer, /focusFigureWorkspaceMetaMutation/);
  assert.match(renderer, /workspace-figure-meta-add/);
  const coordinator = executableFunctionSource(
    popup, 'createFigureWorkspaceMetaActionCoordinator'
  );
  assert.match(coordinator, /if \(!isContextCurrent\(context\) \|\| !isAttached\(\)\)/);
  assert.match(coordinator, /integrate\(response\.draft, context\)/);
  assert.match(coordinator, /focus\(response\)/);
});

test('research logic and paper-level points are extracted independently into the durable draft', () => {
  const popup = read('popup.js');
  const content = read('content.js');
  const crossGeneration = functionBody(
    content, 'analyzeCrossFigureLogicWithLLM', 'analyzeFiguresWithLLM'
  );
  assert.doesNotMatch(crossGeneration, /seedFigureWorkspaceMetaFromCrossFigure\(result, figures\)/);
  assert.match(content, /action === 'analyzeResearchLogicWithLLM'/);
  assert.match(content, /action === 'analyzePaperInnovationWithLLM'/);
  assert.match(content, /action === 'analyzePaperLimitationsWithLLM'/);
  assert.match(content, /type: 'seed_research_logic'/);
  assert.match(content, /type: 'seed_innovation_points'/);
  assert.match(content, /type: 'seed_limitation_points'/);
  const runIndependent = functionBody(
    popup, 'runPaperMetaExtraction', 'runFigureAnalysis'
  );
  assert.match(runIndependent, /analyzeResearchLogicWithLLM/);
  assert.match(runIndependent, /analyzePaperInnovationWithLLM/);
  assert.match(runIndependent, /analyzePaperLimitationsWithLLM/);
  assert.doesNotMatch(runIndependent, /analyzeFiguresFromFigures|runCrossFigureLogic/);
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceMetaSnapshot', 'syncFigureQuickNavFromScroll'
  );
  assert.match(renderer, /提取研究背景与科学问题/);
  assert.match(renderer, /提取创新点/);
  assert.match(renderer, /提取研究局限/);
  assert.match(popup, /核心问题/);
  assert.match(popup, /为什么值得问/);
  assert.match(popup, /论文如何推进/);
  assert.match(popup, /证据强度/);
  assert.doesNotMatch(functionBody(
    popup, 'renderFigureWorkspaceMetaSnapshot', 'syncFigureQuickNavFromScroll'
  ), /requireUsableLlm|llmUnavailableMessage/);
});

test('MECH021 all-Figure analysis ends without implicitly starting global synthesis', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  assert.doesNotMatch(html, /id="analyzeCrossFigureLogic"/);
  const run = functionBody(popup, 'runFigureAnalysis', 'showFigureOriginalImage');
  assert.match(run, /action: 'analyzeFiguresWithLLM'/);
  assert.doesNotMatch(run, /runCrossFigureLogic\(/);
  const entry = executableFunctionSource(popup, 'renderResearchLogicMapSnapshot');
  assert.match(entry, /AI生成/);
  assert.match(entry, /runCrossFigureLogic/);
  const mechanism = functionBody(
    popup, 'renderMechanismChainWorkspace', 'renderResearchLogicMapSnapshot'
  );
  assert.doesNotMatch(mechanism, /生成机制链/,
    'the standalone LLM generation button must not reappear in the empty mechanism view');
  const wiring = popup.slice(popup.indexOf("document.addEventListener('DOMContentLoaded'"));
  assert.doesNotMatch(wiring, /getElementById\('analyzeCrossFigureLogic'\)/);
});

test('Figure workspace exposes editable full-paper innovation and limitation collections', () => {
  const popup = read('popup.js');
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceMetaSnapshot', 'syncFigureQuickNavFromScroll'
  );
  assert.match(renderer, /collection:\s*'innovationPoints'/);
  assert.match(renderer, /collection:\s*'limitationPoints'/);
  assert.match(renderer, /add_innovation_point/);
  assert.match(renderer, /remove_innovation_point/);
  assert.match(renderer, /add_limitation_point/);
  assert.match(renderer, /remove_limitation_point/);
});

test('Panel catalog keeps canonical order independently from evidence block order', () => {
  const popup = read('popup.js');
  const orderSource = executableFunctionSource(popup, 'canonicalFigurePanelOrder');
  const canonicalFigurePanelOrder = new Function(
    `${orderSource}\nreturn canonicalFigurePanelOrder;`
  )();
  const ordered = canonicalFigurePanelOrder(
    [{ panelId: 'A' }, { panelId: 'B' }, { panelId: 'C' }, { panelId: 'D' }],
    [{ kind: 'evidence', panelIds: ['A', 'C'] },
      { kind: 'evidence', panelIds: ['B', 'D'] }]
  );
  assert.deepEqual(ordered.map(item => item.panelId), ['A', 'B', 'C', 'D']);
  const panelRenderer = functionBody(
    popup, 'appendFigurePanelCatalog', 'figurePanelEvidenceGroup'
  );
  assert.match(panelRenderer, /canonicalFigurePanelOrder\(viewPanels,\s*storedEvidenceLayout\)/);
  assert.match(panelRenderer,
    /buildFigureEvidenceDisplayLayout\(storedEvidenceLayout,\s*orderedPanels\)/);
});

test('LLM activity has a restrained visible pulse with reduced-motion support', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceSnapshot', 'renderArticleWorkspaceSnapshot'
  );
  assert.match(renderer, /classList\.toggle\('is-llm-pending',\s*loading\)/);
  assert.match(css, /@keyframes\s+workspace-soft-pulse/);
  assert.match(css, /\.is-llm-pending/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('every mapped overview mutation executes against a real Task5 draft', () => {
  const { mapFigureWorkspaceEditDescriptor } = loadInlineEditingHelpers(read('popup.js'));
  const fields = [
    'figureQuestion', 'coreConclusion', 'claimBoundary', 'authorAssembly',
    'remainingQuestion'
  ];
  let draft = createFigureWorkspaceDraft([{
    figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A']
  }]);
  const initialRevision = draft.revision;
  fields.forEach((field, index) => {
    const value = `reviewed ${field}`;
    const mutation = mapFigureWorkspaceEditDescriptor({
      scope: 'overview', figureId: 'figure-1', field
    }, value, draft.revision);
    draft = applyFigureWorkspaceMutation(draft, mutation, 1000 + index);
    assert.deepEqual(draft.figures['figure-1'].overview[field], {
      value,
      humanReviewed: true,
      editedAt: 1000 + index
    });
    assert.equal(draft.revision, initialRevision + index + 1);
  });
});

test('inline edit controller saves changed values once and closes unchanged values', async () => {
  const { createFigureWorkspaceInlineEditController } = loadInlineEditingHelpers(
    read('popup.js')
  );
  let revision = 4;
  const mutations = [];
  const integrated = [];
  const focused = [];
  const controller = createFigureWorkspaceInlineEditController({
    getExpectedRevision: () => revision,
    persist: async mutation => {
      mutations.push(mutation);
      revision += 1;
      return { success: true, draft: { revision } };
    },
    integrate: (draft, options) => integrated.push([draft, options]),
    focus: descriptor => focused.push(descriptor)
  });
  const descriptor = {
    scope: 'overview', figureId: 'figure-1', field: 'figureQuestion'
  };

  assert.equal((await controller.begin(descriptor, 'old')).status, 'started');
  assert.equal((await controller.blur()).status, 'unchanged');
  assert.equal(mutations.length, 0);

  await controller.begin(descriptor, 'old');
  controller.update('new');
  const first = controller.save('shortcut');
  const duplicate = controller.save('blur');
  assert.equal(first, duplicate, 'pending save must be shared');
  assert.equal((await first).status, 'saved');
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].expectedRevision, 4);
  assert.deepEqual(integrated, [[{ revision: 5 }, { keepOpen: false }]]);
  assert.deepEqual(focused, [descriptor, descriptor]);
  assert.equal(controller.getState().active, null);
});

test('inline edit controller retains typed input on failure and conflict for retry', async () => {
  const { createFigureWorkspaceInlineEditController } = loadInlineEditingHelpers(
    read('popup.js')
  );
  let revision = 2;
  let attempt = 0;
  const statuses = [];
  const integrated = [];
  const descriptor = {
    scope: 'panel', figureId: 'figure-1', panelId: 'A', field: 'purpose'
  };
  const controller = createFigureWorkspaceInlineEditController({
    getExpectedRevision: () => revision,
    persist: async mutation => {
      attempt += 1;
      if (attempt === 1) throw new Error('offline');
      if (attempt === 2) {
        const error = new Error('stale');
        error.code = 'FIGURE_WORKSPACE_REVISION_CONFLICT';
        throw error;
      }
      revision += 1;
      return { success: true, draft: { revision, mutation } };
    },
    refresh: async () => {
      revision = 6;
      return { revision: 6 };
    },
    integrate: (draft, options) => integrated.push([draft, options]),
    status: value => statuses.push(value)
  });

  await controller.begin(descriptor, 'old');
  controller.update('typed value');
  assert.equal((await controller.save('shortcut')).status, 'failed');
  assert.equal(controller.getState().active.value, 'typed value');
  assert.equal((await controller.save('retry')).status, 'conflict');
  assert.equal(controller.getState().active.value, 'typed value');
  assert.deepEqual(integrated.at(-1), [{ revision: 6 }, { keepOpen: true }]);
  assert.equal((await controller.save('retry')).status, 'saved');
  assert.equal(integrated.at(-1)[0].mutation.expectedRevision, 6);
  assert.ok(statuses.some(item => item.type === 'error'));
  assert.ok(statuses.some(item => item.type === 'conflict'));
});

test('Panel note debounce is 400ms, serialized, and latest input wins', async () => {
  const { createFigureWorkspaceInlineEditController } = loadInlineEditingHelpers(
    read('popup.js')
  );
  let revision = 1;
  let scheduled = null;
  const pendingResolvers = [];
  const savedValues = [];
  const integratedValues = [];
  const controller = createFigureWorkspaceInlineEditController({
    getExpectedRevision: () => revision,
    schedule(callback, delay) {
      scheduled = { callback, delay };
      return scheduled;
    },
    cancelSchedule(token) {
      if (scheduled === token) scheduled = null;
    },
    persist: mutation => new Promise(resolve => {
      savedValues.push(mutation.value);
      pendingResolvers.push(() => {
        revision += 1;
        resolve({ success: true, draft: { revision, value: mutation.value } });
      });
    }),
    integrate: draft => integratedValues.push(draft.value),
    flushDraft: async () => ({ success: true })
  });
  const note = {
    scope: 'panel', figureId: 'figure-1', panelId: 'A', field: 'note'
  };

  await controller.begin(note, '');
  controller.update('first');
  assert.equal(scheduled.delay, 400);
  scheduled.callback();
  await Promise.resolve();
  assert.deepEqual(savedValues, ['first']);
  controller.update('latest');
  assert.equal(savedValues.length, 1, 'note saves must be serialized');
  pendingResolvers.shift()();
  for (let index = 0; index < 8 && savedValues.length < 2; index += 1) {
    await Promise.resolve();
  }
  assert.deepEqual(savedValues, ['first', 'latest']);
  assert.deepEqual(integratedValues, [], 'superseded completion must not replace live snapshot');
  pendingResolvers.shift()();
  for (let index = 0; index < 8 && controller.getState().active.dirty; index += 1) {
    await Promise.resolve();
  }
  assert.equal(controller.getState().active.value, 'latest');
  assert.equal(controller.getState().active.dirty, false);
  assert.deepEqual(integratedValues, ['latest']);
});

test('Panel note blur flushes the latest queued value and closes after pending save', async () => {
  const { createFigureWorkspaceInlineEditController } = loadInlineEditingHelpers(
    read('popup.js')
  );
  let revision = 1;
  let scheduled;
  const resolvers = [];
  const values = [];
  const controller = createFigureWorkspaceInlineEditController({
    getExpectedRevision: () => revision,
    schedule: callback => { scheduled = callback; return callback; },
    cancelSchedule: () => undefined,
    persist: mutation => new Promise(resolve => {
      values.push(mutation.value);
      resolvers.push(() => resolve({ success: true, draft: { revision: ++revision } }));
    })
  });
  await controller.begin({
    scope: 'panel', figureId: 'figure-1', panelId: 'A', field: 'note'
  }, '');
  controller.update('first');
  scheduled();
  await Promise.resolve();
  controller.update('latest');
  const blurred = controller.blur();
  resolvers.shift()();
  for (let index = 0; index < 8 && values.length < 2; index += 1) await Promise.resolve();
  assert.deepEqual(values, ['first', 'latest']);
  resolvers.shift()();
  await blurred;
  for (let index = 0; index < 8 && controller.getState().active; index += 1) {
    await Promise.resolve();
  }
  assert.equal(controller.getState().active, null);
});

test('inline Figure DOM wiring exposes accessible editable values and note ordering', () => {
  const popup = read('popup.js');
  const fieldRenderer = functionBody(
    popup, 'appendFigureWorkspaceViewField', 'appendFigureWorkspaceOverview'
  );
  const catalog = functionBody(
    popup, 'appendFigurePanelCatalog', 'createCollapsibleFigureResultSection'
  );
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceSnapshot', 'renderArticleWorkspaceSnapshot'
  );
  assert.match(fieldRenderer, /dataset\.figureEditPath/);
  assert.match(fieldRenderer, /target\.dataset\.figureEditPath/);
  assert.doesNotMatch(fieldRenderer, /row\.dataset\.figureEditPath/);
  assert.match(fieldRenderer, /addEventListener\('dblclick'/);
  assert.match(fieldRenderer, /event\.key === 'Enter'/);
  assert.match(fieldRenderer, /event\.key === ' '/);
  assert.match(fieldRenderer, /role', 'button'/);
  assert.match(fieldRenderer, /aria-keyshortcuts/);
  assert.doesNotMatch(fieldRenderer, /workspace-figure-edit-button|editButton/);
  assert.doesNotMatch(fieldRenderer, /aria-disabled/);
  assert.match(popup, /event\.(ctrlKey|metaKey)/);
  assert.match(popup, /event\.key === 'Escape'/);
  assert.match(popup, /addEventListener\('blur'/);
  assert.match(popup, /textarea/);
  assert.match(popup, /每行一项/);
  assert.match(catalog,
    /panelDetails\.appendChild\(followup\);[\s\S]*appendFigureWorkspaceViewField\([\s\S]*note/s);
  assert.doesNotMatch(renderer, /编辑结果|继续编辑|openFigureResultEditor/);
  assert.doesNotMatch(fieldRenderer, /\.innerHTML\s*=/);
});

test('render coordinator defers self notifications and quick navigation until editing ends', async () => {
  const {
    createFigureWorkspaceInlineEditController,
    createFigureWorkspaceRenderCoordinator
  } = loadFigureWorkspaceLifecycleHelpers(read('popup.js'));
  const renders = [];
  const navigation = [];
  const coordinator = createFigureWorkspaceRenderCoordinator({
    render: snapshot => renders.push(snapshot)
  });
  const controller = createFigureWorkspaceInlineEditController({
    getExpectedRevision: () => 1,
    captureContext: () => ({ tabId: 1, contextKey: 'paper-a', documentId: 'a' }),
    isContextCurrent: () => true,
    isMountAvailable: () => true,
    onActiveChange: active => coordinator.setEditing(active),
    persist: async mutation => ({ success: true, draft: {
      revision: 2, value: mutation.value
    } }),
    integrate: () => coordinator.request({ source: 'self-notification' })
  });
  await controller.begin({
    scope: 'panel', figureId: 'figure-1', panelId: 'A', field: 'note'
  }, '', { mount: {} });
  controller.update('note');
  assert.equal((await controller.save('debounce')).status, 'saved');
  assert.equal(controller.getState().active.value, 'note');
  assert.deepEqual(renders, [], 'note autosave must not destroy its textarea');
  coordinator.request({ source: 'quick-nav' }, () => navigation.push('focused'));
  coordinator.request({ source: 'workspace-refresh' });
  assert.deepEqual(renders, []);
  assert.deepEqual(navigation, []);
  await controller.blur();
  assert.deepEqual(renders, [{ source: 'workspace-refresh' }]);
  assert.deepEqual(navigation, ['focused']);
});

test('render coordinator retains only the latest deferred navigation callback', () => {
  const { createFigureWorkspaceRenderCoordinator } =
    loadFigureWorkspaceLifecycleHelpers(read('popup.js'));
  const callbacks = [];
  const renders = [];
  const coordinator = createFigureWorkspaceRenderCoordinator({
    render: snapshot => renders.push(snapshot)
  });
  coordinator.setEditing(true);
  for (let index = 0; index < 50; index += 1) {
    coordinator.request({ revision: index }, () => callbacks.push(index));
  }
  coordinator.request({ revision: 50 });
  coordinator.setEditing(false);
  assert.deepEqual(renders, [{ revision: 50 }]);
  assert.deepEqual(callbacks, [49]);
});

test('switching inline fields keeps the second mount live while the first edit commits', async () => {
  const {
    createFigureWorkspaceInlineEditController,
    createFigureWorkspaceRenderCoordinator
  } = loadFigureWorkspaceLifecycleHelpers(read('popup.js'));
  const firstMount = { connected: true };
  const secondMount = { connected: true };
  const renders = [];
  const coordinator = createFigureWorkspaceRenderCoordinator({
    render(snapshot) {
      renders.push(snapshot);
      firstMount.connected = false;
      secondMount.connected = false;
    }
  });
  let revision = 1;
  const controller = createFigureWorkspaceInlineEditController({
    getExpectedRevision: () => revision,
    isMountAvailable: mount => mount?.connected === true,
    onActiveChange: (active, record, transition) => {
      coordinator.setEditing(active, transition);
    },
    close: descriptor => coordinator.request({ closed: descriptor.field }),
    persist: async () => ({ success: true, draft: { revision: ++revision } })
  });
  const first = {
    scope: 'overview', figureId: 'figure-1', field: 'figureQuestion'
  };
  const second = {
    scope: 'overview', figureId: 'figure-1', field: 'coreConclusion'
  };

  assert.equal((await controller.begin(first, 'old', { mount: firstMount })).status, 'started');
  controller.update('saved first');
  assert.equal(
    (await controller.begin(second, 'second', { mount: secondMount })).status,
    'started'
  );
  assert.equal(controller.getState().active.descriptor.field, 'coreConclusion');
  assert.equal(secondMount.connected, true, 'intermediate replay must not detach field two');
  assert.deepEqual(renders, []);

  controller.cancel();
  assert.deepEqual(renders, [{ closed: 'coreConclusion' }]);
});

test('refresh/render snapshot reconciliation never replaces a newer saved Figure draft', () => {
  const popup = read('popup.js');
  const { reconcileArticleWorkspaceSnapshot } =
    loadArticleWorkspaceSnapshotReconciler(popup);
  const oldRefresh = {
    title: 'refreshed article metadata',
    localWorkspace: {
      workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
      canonicalUrl: 'https://journal.example/paper-a', contentHash: 'c'.repeat(64)
    },
    figures: {
      figures: [{ figureId: 'figure-1' }],
      draft: { revision: 4, marker: 'old request value' }
    },
    figureWorkspaceDraft: { revision: 4, marker: 'old request value' }
  };
  const afterSave = {
    title: 'before refresh',
    localWorkspace: {
      workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
      canonicalUrl: 'https://journal.example/paper-a?tracking=old',
      contentHash: 'c'.repeat(64)
    },
    figures: {
      figures: [{ figureId: 'figure-1' }],
      draft: { revision: 5, marker: 'new saved value' }
    },
    figureWorkspaceDraft: { revision: 5, marker: 'new saved value' }
  };

  const accepted = reconcileArticleWorkspaceSnapshot(afterSave, oldRefresh);
  assert.equal(accepted.title, 'refreshed article metadata');
  assert.deepEqual(accepted.figures.draft, afterSave.figures.draft);
  assert.deepEqual(accepted.figureWorkspaceDraft, afterSave.figures.draft);

  const newerRefresh = {
    ...oldRefresh,
    figures: { ...oldRefresh.figures, draft: { revision: 6, marker: 'server newer' } },
    figureWorkspaceDraft: { revision: 6, marker: 'server newer' }
  };
  assert.equal(
    reconcileArticleWorkspaceSnapshot(afterSave, newerRefresh).figures.draft.marker,
    'server newer'
  );

  const otherWorkspace = {
    ...oldRefresh,
    localWorkspace: {
      ...oldRefresh.localWorkspace,
      workspaceId: `workspace:${'b'.repeat(64)}`
    }
  };
  assert.equal(
    reconcileArticleWorkspaceSnapshot(afterSave, otherWorkspace).figures.draft.marker,
    'old request value',
    'a different article must never inherit the prior article draft'
  );

  for (const field of [
    'workspaceId', 'workspaceGeneration', 'canonicalUrl', 'contentHash'
  ]) {
    for (const side of ['current', 'incoming']) {
      const current = structuredClone(afterSave);
      const incoming = structuredClone(oldRefresh);
      delete (side === 'current' ? current : incoming).localWorkspace[field];
      assert.equal(
        reconcileArticleWorkspaceSnapshot(current, incoming).figures.draft.marker,
        'old request value',
        `missing ${side} ${field} must accept the incoming draft`
      );
    }
  }
  for (const localWorkspace of [
    { ...oldRefresh.localWorkspace, canonicalUrl: 'https://journal.example/paper-b' },
    { ...oldRefresh.localWorkspace, contentHash: 'd'.repeat(64) }
  ]) {
    assert.equal(
      reconcileArticleWorkspaceSnapshot(afterSave, {
        ...oldRefresh, localWorkspace
      }).figures.draft.marker,
      'old request value',
      'URL or content hash mismatch must accept the incoming draft'
    );
  }

  const renderer = functionBody(
    popup, 'renderArticleWorkspaceSnapshot', 'getArticleChatProfiles'
  );
  const refresh = functionBody(
    popup, 'refreshArticleWorkspace', 'requestArticleWorkspaceExport'
  );
  assert.match(renderer, /reconcileArticleWorkspaceSnapshot\(currentWorkspaceSnapshot, snapshot\)/);
  assert.match(refresh,
    /const snapshot = renderArticleWorkspaceSnapshot\(refreshedSnapshot\)[\s\S]*resumeFigureProgressFromWorkspaceSnapshot\(snapshot/);
  assert.match(refresh, /return snapshot/);
});

test('detached targets never leave an active controller record', async () => {
  const { createFigureWorkspaceInlineEditController } =
    loadFigureWorkspaceLifecycleHelpers(read('popup.js'));
  const controller = createFigureWorkspaceInlineEditController({
    captureContext: () => ({ tabId: 1, contextKey: 'paper-a', documentId: 'a' }),
    isMountAvailable: mount => mount?.connected === true
  });
  const result = await controller.begin({
    scope: 'overview', figureId: 'figure-1', field: 'figureQuestion'
  }, 'value', { mount: { connected: false } });
  assert.equal(result.status, 'detached');
  assert.equal(controller.getState().active, null);
});

test('immutable editor context prevents Paper A edits from dispatching to Paper B', async () => {
  const {
    createFigureWorkspaceInlineEditController,
    createFigureWorkspaceEditorLifecycleCoordinator
  } = loadFigureWorkspaceLifecycleHelpers(read('popup.js'));
  let liveContext = { tabId: 1, contextKey: 'paper-a', documentId: 'a' };
  const persistedContexts = [];
  const warnings = [];
  const controller = createFigureWorkspaceInlineEditController({
    getExpectedRevision: () => 1,
    captureContext: () => liveContext,
    isContextCurrent: context => context.contextKey === liveContext.contextKey,
    isMountAvailable: () => true,
    persist: async (_mutation, context) => {
      persistedContexts.push(context);
      return { success: true, draft: { revision: 2 } };
    }
  });
  const lifecycle = createFigureWorkspaceEditorLifecycleCoordinator({
    controller,
    warn: state => warnings.push(state)
  });
  await lifecycle.begin({
    scope: 'overview', figureId: 'figure-1', field: 'figureQuestion'
  }, 'old', { mount: {} });
  controller.update('Paper A edit');
  liveContext = { tabId: 2, contextKey: 'paper-b', documentId: 'b' };
  const result = await lifecycle.leaveContext();
  assert.equal(result.status, 'context_changed');
  assert.deepEqual(persistedContexts, []);
  assert.equal(controller.getState().active, null);
  assert.equal(warnings.at(-1).type, 'unsaved');
});

test('late or lower-revision responses never regress the live Figure draft', async () => {
  const { createFigureWorkspaceInlineEditController } =
    loadFigureWorkspaceLifecycleHelpers(read('popup.js'));
  const context = { tabId: 1, contextKey: 'paper-a', documentId: 'a' };
  let liveRevision = 5;
  let resolvePersist;
  const integrated = [];
  const controller = createFigureWorkspaceInlineEditController({
    getExpectedRevision: () => liveRevision,
    getCurrentRevision: () => liveRevision,
    captureContext: () => context,
    isContextCurrent: () => true,
    isMountAvailable: () => true,
    persist: () => new Promise(resolve => { resolvePersist = resolve; }),
    integrate: draft => integrated.push(draft)
  });
  await controller.begin({
    scope: 'overview', figureId: 'figure-1', field: 'coreConclusion'
  }, 'old', { mount: {} });
  controller.update('new');
  const pending = controller.save('shortcut');
  await Promise.resolve();
  liveRevision = 8;
  resolvePersist({ success: true, draft: { revision: 6 } });
  assert.equal((await pending).status, 'stale_response');
  assert.deepEqual(integrated, []);
  controller.cancel();

  await controller.begin({
    scope: 'overview', figureId: 'figure-1', field: 'coreConclusion'
  }, 'old', { mount: {} });
  controller.update('later');
  const late = controller.save('shortcut');
  await Promise.resolve();
  liveRevision = 9;
  resolvePersist({ success: true, draft: { revision: 10 } });
  assert.equal((await late).status, 'saved');
  assert.equal(integrated.at(-1).revision, 10);
});

test('hidden and pagehide flush synchronously dispatch captured-context edits', async () => {
  const {
    createFigureWorkspaceInlineEditController,
    createFigureWorkspaceEditorLifecycleCoordinator
  } = loadFigureWorkspaceLifecycleHelpers(read('popup.js'));
  const order = [];
  const context = Object.freeze({
    tabId: 11, contextKey: 'paper-a', documentKey: 'hash-a', documentId: 'a'
  });
  const controller = createFigureWorkspaceInlineEditController({
    getExpectedRevision: () => 1,
    captureContext: () => context,
    isContextCurrent: () => true,
    isMountAvailable: () => true,
    persist: (_mutation, captured) => {
      order.push(`persist:${captured.contextKey}`);
      return Promise.resolve({ success: true, draft: { revision: 2 } });
    },
    flushDraft: captured => {
      order.push(`flush:${captured.contextKey}`);
      return Promise.resolve({ success: true });
    }
  });
  const lifecycle = createFigureWorkspaceEditorLifecycleCoordinator({ controller });
  const descriptor = {
    scope: 'panel', figureId: 'figure-1', panelId: 'A', field: 'note'
  };
  await lifecycle.begin(descriptor, '', { mount: {} });
  controller.update('hidden note');
  const hidden = lifecycle.visibilityChanged(true);
  assert.equal(order[0], 'persist:paper-a');
  await hidden;
  assert.deepEqual(order, ['persist:paper-a', 'flush:paper-a']);

  await lifecycle.begin(descriptor, 'hidden note', { mount: {} });
  controller.update('pagehide note');
  const pagehide = lifecycle.pagehide();
  assert.equal(order[2], 'persist:paper-a');
  await pagehide;
  assert.deepEqual(order.slice(2), ['persist:paper-a', 'flush:paper-a']);
});

test('popup wires controlled context leave, visibility flush, and caught pagehide dispatch', () => {
  const popup = read('popup.js');
  const sync = functionBody(
    popup, 'synchronizeActiveTabContext', 'scheduleActiveTabContextSync'
  );
  const lifecycleIndex = sync.indexOf('await figureWorkspaceEditorLifecycle.leaveContext()');
  const swapIndex = sync.indexOf('activePanelTabContext = {');
  assert.ok(lifecycleIndex >= 0 && lifecycleIndex < swapIndex);
  assert.match(popup,
    /document\.addEventListener\('visibilitychange'[\s\S]*document\.visibilityState === 'hidden'[\s\S]*figureWorkspaceEditorLifecycle\.visibilityChanged\(true\)/);
  assert.match(popup,
    /window\.addEventListener\('pagehide'[\s\S]*figureWorkspaceEditorLifecycle\.pagehide\(\)\.catch/);
  assert.match(popup, /captureFigureWorkspaceEditContext/);
  assert.match(popup, /contextKey/);
  assert.match(popup, /documentKey/);
  assert.match(popup, /documentId/);
  assert.match(popup,
    /action: 'updateFigureWorkspaceDraft', mutation,\s*workspaceTarget: buildFigureWorkspaceEditTarget\(context\)/);
  assert.match(popup,
    /action: 'flushFigureWorkspaceDraft',\s*workspaceTarget: buildFigureWorkspaceEditTarget\(context\)/);
});

test('Figure cards resolve cached shared views from the live public draft', () => {
  const popup = read('popup.js');
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceSnapshot', 'renderArticleWorkspaceSnapshot'
  );
  assert.match(renderer, /const view = figureWorkspaceViewState\.resolve\(\{\s*figure,\s*modelResult: result,\s*draft: snapshot\?\.figures\?\.draft \|\| snapshot\?\.figureWorkspaceDraft\s*\}\)/s);
  assert.doesNotMatch(renderer, /figureWorkspaceViewState\.clear\(\)/);
  assert.match(renderer, /appendFigureWorkspaceOverview\(details, view, snapshot\)/);
  assert.match(renderer, /appendFigurePanelCatalog\(details, figure, result, view\)/);
  assert.match(renderer,
    /renderFigureProgress\(details, progress, result, figure, view\);\s*appendFigureWorkspaceOverview\(details, view, snapshot\);[\s\S]*?appendFigurePanelCatalog\(details, figure, result, view\);\s*if \(result\)/s);
});

test('the complete no-LLM overview and Panel template is rendered unconditionally', () => {
  const popup = read('popup.js');
  const overview = functionBody(
    popup, 'appendFigureWorkspaceOverview', 'formatFigurePanelHeader'
  );
  const fields = functionBody(
    popup, 'appendFigureWorkspaceViewPanelFields', 'appendFigurePanelCatalog'
  );
  assert.match(overview, /view\.overview/);
  assert.match(overview, /appendFigureWorkspaceViewField/);
  assert.doesNotMatch(overview, /if\s*\(result\)/);
  for (const key of [
    'purpose', 'evidenceType', 'phenotypeName', 'experimentalMethods',
    'statisticalMethods', 'design', 'comparison', 'directObservation',
    'localInference', 'contribution'
  ]) {
    assert.match(fields, new RegExp(`['"]${key}['"]`), key);
  }
  const catalog = functionBody(
    popup, 'appendFigurePanelCatalog', 'createCollapsibleFigureResultSection'
  );
  assert.match(catalog, /field\.key === 'note'/);
  assert.match(popup, /双击填写/);
  assert.match(popup, /workspace-figure-empty-value/);
  assert.match(popup, /tabIndex = 0/);
  assert.doesNotMatch(fields, /aria-disabled/);
});

test('Figure evidence blocks contain their Panels and one upstream row', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const catalog = functionBody(
    popup, 'createFigureEvidenceBlockDetails', 'createCollapsibleFigureResultSection'
  );
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceSnapshot', 'renderArticleWorkspaceSnapshot'
  );

  assert.match(catalog, /SciLLM\.buildEvidenceBlocks\(result\)/);
  assert.match(catalog, /SciLLM\.buildFigureEvidenceDisplayLayout/);
  assert.match(catalog, /\.open = false/);
  assert.match(catalog, /item\?\.fromBlockId/);
  assert.doesNotMatch(catalog, /precedingBlockId/);
  assert.match(catalog, /workspace-evidence-direction is-upstream/);
  assert.match(catalog, /resolveFigureEvidenceUpstreamContext/);
  assert.match(catalog, /'upstreamContext'/);
  assert.doesNotMatch(catalog, /workspace-evidence-direction is-downstream|启下/);
  assert.match(catalog, /data-evidence-panels-body/);
  assert.match(catalog, /panelHostByBlock/);
  assert.match(catalog, /\(panelHost \|\| parent\)\.appendChild\(panelDetails\)/);
  assert.match(catalog, /workspace-evidence-orphans/);
  assert.match(catalog, /'待确认分组'/);
  assert.doesNotMatch(catalog, /appendChild\(createFigureEvidenceTransitionDetails/);
  assert.match(catalog, /panelDetails\.dataset\.evidenceGroup/);
  assert.match(css, /\.workspace-figure-panel-card\[data-evidence-group="1"\]/);
  assert.match(css, /\.workspace-evidence-panels-body/);
  assert.match(css, /\.workspace-evidence-orphans/);
  assert.doesNotMatch(css, /\.workspace-evidence-transition|is-downstream/);
  assert.doesNotMatch(renderer,
    /createCollapsibleFigureResultSection\(\s*figure\.figureId,\s*'argument-chain'/);
  assert.doesNotMatch(renderer,
    /createCollapsibleFigureResultSection\(\s*figure\.figureId,\s*'panel-groups'/);
  assert.doesNotMatch(renderer,
    /createCollapsibleFigureResultSection\(\s*figure\.figureId,\s*'logic-bridges'/);
});

test('evidence blocks reuse direct draft editing with Figure-scoped descriptors', () => {
  const popup = read('popup.js');
  const { mapFigureWorkspaceEditDescriptor } = loadInlineEditingHelpers(popup);
  assert.deepEqual(mapFigureWorkspaceEditDescriptor({
    scope: 'evidence-block', figureId: 'figure-1',
    blockId: 'evidence-group-1', field: 'groupConclusion'
  }, 'human conclusion', 8), {
    type: 'update_evidence_block', expectedRevision: 8,
    figureId: 'figure-1', blockId: 'evidence-group-1',
    field: 'groupConclusion', value: 'human conclusion'
  });
  assert.deepEqual(mapFigureWorkspaceEditDescriptor({
    scope: 'evidence-transition', figureId: 'figure-2',
    blockId: 'evidence-transition-bridge-1', field: 'transitionToNext'
  }, 'human handoff', 9), {
    type: 'update_evidence_block', expectedRevision: 9,
    figureId: 'figure-2', blockId: 'evidence-transition-bridge-1',
    field: 'transitionToNext', value: 'human handoff'
  });
  const catalog = functionBody(
    popup, 'createFigureEvidenceBlockDetails', 'createCollapsibleFigureResultSection'
  );
  const editable = functionBody(
    popup, 'appendFigureEvidenceEditableField', 'bindFigureEvidenceEditFlush'
  );
  assert.match(catalog, /appendFigureEvidenceEditableField/);
  assert.match(editable, /appendFigureWorkspaceViewField/);
  assert.match(catalog, /'evidence-block'/);
  assert.match(catalog, /'upstreamContext'/);
  assert.doesNotMatch(catalog, /'evidence-transition'/);
  assert.match(catalog, /blockId/);
  assert.match(popup, /data-figure-edit-path|figureEditPath/);
});

test('evidence edit descriptors reject hostile identities without coercion', () => {
  const { mapFigureWorkspaceEditDescriptor } = loadInlineEditingHelpers(read('popup.js'));
  let coercions = 0;
  const hostile = {
    toString() {
      coercions += 1;
      throw new Error('must not coerce evidence identity');
    }
  };
  assert.throws(() => mapFigureWorkspaceEditDescriptor({
    scope: 'evidence-block', figureId: hostile,
    blockId: 'evidence-group-1', field: 'groupGoal'
  }, 'x', 1), /FIGURE_WORKSPACE_EDIT_DESCRIPTOR_INVALID/);
  assert.throws(() => mapFigureWorkspaceEditDescriptor({
    scope: 'evidence-transition', figureId: 'figure-1',
    blockId: hostile, field: 'transitionToNext'
  }, 'x', 1), /FIGURE_WORKSPACE_EDIT_DESCRIPTOR_INVALID/);
  assert.equal(coercions, 0);
});

test('evidence details preserve stable expansion across snapshot rerenders', () => {
  const { bindFigureEvidenceExpansion } = loadEvidenceUiHelpers(read('popup.js'));
  function fakeDetails() {
    const listeners = new Map();
    return {
      open: false,
      addEventListener(type, listener) { listeners.set(type, listener); },
      toggle(open) { this.open = open; listeners.get('toggle')?.(); }
    };
  }
  const first = fakeDetails();
  bindFigureEvidenceExpansion(first, 'figure-1::evidence::group-1');
  assert.equal(first.open, false);
  first.toggle(true);

  const rerendered = fakeDetails();
  bindFigureEvidenceExpansion(rerendered, 'figure-1::evidence::group-1');
  assert.equal(rerendered.open, true);
  rerendered.toggle(false);
  const third = fakeDetails();
  bindFigureEvidenceExpansion(third, 'figure-1::evidence::group-1');
  assert.equal(third.open, false);
});

test('FIG019 evidence headings preserve complete Unicode content as well as body fields', () => {
  const popup = read('popup.js');
  const { summarizeFigureEvidenceLabel } = loadEvidenceUiHelpers(popup);
  const input = `${'🧬'.repeat(150)}${'结论'.repeat(2000)}`;
  const summary = summarizeFigureEvidenceLabel(input, '证据块');
  assert.equal(summary, input);
  assert.equal(/(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
    .test(summary), false);
  const blockRenderer = functionBody(
    popup, 'createFigureEvidenceBlockDetails', 'canonicalFigurePanelOrder'
  );
  assert.match(blockRenderer, /summarizeFigureEvidenceLabel\(/);
  assert.match(blockRenderer, /bindFigureEvidenceExpansion\(/);
  assert.match(blockRenderer, /'groupConclusion'/);
  assert.match(blockRenderer, /appendFigureEvidenceEditableField/);
  assert.doesNotMatch(blockRenderer,
    /appendFigureEvidenceEditableField\([^)]*summarizeFigureEvidenceLabel/);
});

test('evidence summary fallback never executes hostile object coercion', () => {
  const { summarizeFigureEvidenceLabel } = loadEvidenceUiHelpers(read('popup.js'));
  let calls = 0;
  const hostileObject = {
    toString() {
      calls += 1;
      throw new Error('must not execute');
    }
  };
  const hostileFunction = () => undefined;
  hostileFunction.toString = () => {
    calls += 1;
    throw new Error('must not execute');
  };

  assert.equal(summarizeFigureEvidenceLabel('', hostileObject), '证据条目');
  assert.equal(summarizeFigureEvidenceLabel(null, hostileFunction), '证据条目');
  assert.equal(summarizeFigureEvidenceLabel('', 42), '42');
  assert.equal(calls, 0);
});

test('evidence expansion state resets with the article workspace context', () => {
  const popup = read('popup.js');
  const reset = functionBody(popup, 'resetPanelArticleState', 'captureActiveTabContext');
  assert.match(reset, /figureEvidenceExpansionState\.clear\(\)/);
});

test('Figure view cache normalizes once per draft snapshot and rebuilds only changed models', () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(popup, 'createFigureWorkspaceViewCache');
  let preparedCount = 0;
  let fingerprintCount = 0;
  const built = [];
  const SciLLM = {
    prepareFigureWorkspaceViewContext(draft) {
      preparedCount += 1;
      return { draft, revision: Number(draft?.revision) || 0 };
    },
    figureWorkspaceViewInputFingerprint({ figure, modelResult }) {
      fingerprintCount += 1;
      return figureWorkspaceViewInputFingerprint({ figure, modelResult });
    },
    createFigureWorkspaceView({ figure, modelResult, context }) {
      built.push(figure.figureId);
      return { figureId: figure.figureId, modelResult, context };
    }
  };
  const createFigureWorkspaceViewCache = new Function(
    'SciLLM', `${source}\nreturn createFigureWorkspaceViewCache;`
  )(SciLLM);
  const cache = createFigureWorkspaceViewCache();
  const draft = { revision: 8 };
  const figures = Array.from({ length: 40 }, (_, index) => ({
    figureId: `figure-${index + 1}`,
    figureLabel: `Figure ${index + 1}`,
    panelHints: ['A']
  }));
  const models = figures.map((_, index) => ({ coreConclusion: `version ${index}` }));

  const first = figures.map((figure, index) => cache.resolve({
    figure, modelResult: models[index], draft
  }));
  const quickNavigation = figures.map((figure, index) => cache.resolve({
    figure, modelResult: models[index], draft
  }));
  assert.equal(preparedCount, 1);
  assert.equal(fingerprintCount, 40);
  assert.equal(built.length, 40);
  assert.deepEqual(quickNavigation, first);

  const sameReferenceRerender = figures.map((figure, index) => cache.resolve({
    figure, modelResult: models[index], draft
  }));
  assert.equal(fingerprintCount, 40);
  assert.deepEqual(sameReferenceRerender, first);

  const clonedFigures = figures.map(figure => ({
    ...figure, panelHints: [...figure.panelHints]
  }));
  const clonedModels = models.map(model => ({ ...model }));
  const clonedRerender = clonedFigures.map((figure, index) => cache.resolve({
    figure, modelResult: clonedModels[index], draft: { revision: 8 }
  }));
  assert.equal(fingerprintCount, 80);
  assert.equal(built.length, 40);
  assert.deepEqual(clonedRerender, first);

  const changedModels = clonedModels.slice();
  changedModels[17] = { coreConclusion: 'version 99' };
  const updated = clonedFigures.map((figure, index) => cache.resolve({
    figure, modelResult: changedModels[index], draft: { revision: 8 }
  }));
  assert.equal(preparedCount, 1);
  assert.equal(fingerprintCount, 81);
  assert.equal(built.length, 41);
  assert.equal(built.at(-1), 'figure-18');
  assert.notEqual(updated[17], first[17]);
  assert.equal(updated[16], first[16]);

  const nextDraft = { revision: 9 };
  cache.resolve({
    figure: clonedFigures[0], modelResult: changedModels[0], draft: nextDraft
  });
  assert.equal(preparedCount, 2);
  assert.equal(fingerprintCount, 82);

  cache.clear();
  const unrevisioned = {};
  cache.resolve({ figure: figures[0], modelResult: models[0], draft: unrevisioned });
  cache.resolve({ figure: figures[0], modelResult: models[0], draft: unrevisioned });
  assert.equal(preparedCount, 3);
  assert.equal(fingerprintCount, 83);
  cache.resolve({ figure: figures[0], modelResult: models[0], draft: {} });
  assert.equal(preparedCount, 4);
  assert.equal(fingerprintCount, 84);

  cache.clear();
  const onDemandFigure = {
    figureId: 'figure-on-demand', figureLabel: 'Figure 41', panelHints: ['A'],
    panelAnalyses: null
  };
  const onDemandDraft = { revision: 10 };
  const beforeOnDemand = fingerprintCount;
  const beforeOnDemandBuilds = built.length;
  const onDemandFirst = cache.resolve({ figure: onDemandFigure, draft: onDemandDraft });
  assert.equal(cache.resolve({ figure: onDemandFigure, draft: onDemandDraft }),
    onDemandFirst);
  assert.equal(fingerprintCount, beforeOnDemand + 1);
  onDemandFigure.panelAnalyses = {
    A: { purpose: 'new on-demand analysis' }
  };
  const onDemandUpdated = cache.resolve({ figure: onDemandFigure, draft: onDemandDraft });
  assert.equal(fingerprintCount, beforeOnDemand + 2);
  assert.equal(built.length, beforeOnDemandBuilds + 2);
  assert.notEqual(onDemandUpdated, onDemandFirst);
});

test('Figure workspace Panel UI consumes compact display IDs without reconstructing generic labels', () => {
  const popup = read('popup.js');
  const summary = functionBody(
    popup, 'appendFigurePanelSummary', 'panelFollowupPresetOptions'
  );
  const catalog = functionBody(
    popup, 'appendFigurePanelCatalog', 'createCollapsibleFigureResultSection'
  );
  const quickNav = functionBody(
    popup, 'renderFigureQuickNav', 'syncFigureQuickNavFromScroll'
  );
  const followup = functionBody(
    popup, 'createPanelFollowupControl', 'revealPanelFollowupAnswer'
  );

  assert.match(summary, /displayId/);
  assert.doesNotMatch(summary, /`Panel \$\{/);
  assert.match(catalog, /view\.panels/);
  assert.match(catalog, /viewPanel\.displayId/);
  assert.match(quickNav, /viewPanel\.displayId/);
  assert.match(quickNav,
    /figureWorkspaceViewState\.get\(figure\.figureId\)\s*\|\|\s*figureWorkspaceViewState\.resolve/);
  assert.doesNotMatch(quickNav, /`Panel \$\{panelId\}`/);
  assert.match(followup, /displayId/);
  assert.doesNotMatch(followup, /`Panel \$\{panelId\}/);
});

test('Panel heading detail formatter is deterministic, compact, and text-safe', () => {
  const popup = read('popup.js');
  const { formatFigurePanelHeaderDetails } = loadPanelHeaderFormatter(popup);
  const viewPanel = {
    displayId: '2A',
    evidenceType: '因果证据',
    purpose: '验证通路',
    experimentalMethods: ['Western blot', '', 'qPCR'],
    statisticalMethods: ['ANOVA'],
    comparison: '处理组 vs 对照组',
    directObservation: '<img src=x onerror=alert(1)>'
  };

  assert.deepEqual(formatFigurePanelHeaderDetails(viewPanel, {
    evidenceType: true,
    purpose: true,
    experimentalMethods: true,
    statisticalMethods: true,
    comparison: true,
    directObservation: true
  }), [
    '因果证据', '验证通路', 'Western blot、qPCR', 'ANOVA',
    '处理组 vs 对照组', '<img src=x onerror=alert(1)>'
  ]);
  assert.deepEqual(formatFigurePanelHeaderDetails(viewPanel, {
    evidenceType: false,
    purpose: false,
    experimentalMethods: false,
    statisticalMethods: false,
    comparison: false,
    directObservation: false
  }), []);
  assert.equal(viewPanel.displayId, '2A');
  assert.deepEqual(formatFigurePanelHeaderDetails({
    ...viewPanel, displayId: 'S2A', evidenceType: '', experimentalMethods: []
  }, { evidenceType: true, experimentalMethods: true }), []);
});

test('compact Panel heading details enforce Unicode-safe item, segment, and total budgets', () => {
  const popup = read('popup.js');
  const {
    formatFigurePanelHeaderDetails,
    formatFigurePanelHeader
  } = loadPanelHeaderFormatter(popup);
  const maxItems = numericConstant(popup, 'FIGURE_PANEL_HEADER_MAX_LIST_ITEMS');
  const maxSegment = numericConstant(
    popup, 'FIGURE_PANEL_HEADER_MAX_SEGMENT_CODE_POINTS'
  );
  const maxDetails = numericConstant(
    popup, 'FIGURE_PANEL_HEADER_MAX_DETAILS_CODE_POINTS'
  );
  const huge = '🧬'.repeat(4000);
  const methods = Array.from({ length: 16 }, (_, index) =>
    `${index}-${huge}`
  );
  const viewPanel = {
    displayId: `S${'9'.repeat(80)}A`,
    evidenceType: huge,
    purpose: huge,
    experimentalMethods: methods,
    statisticalMethods: methods,
    comparison: huge,
    directObservation: huge
  };
  const allEnabled = {
    evidenceType: true,
    purpose: true,
    experimentalMethods: true,
    statisticalMethods: true,
    comparison: true,
    directObservation: true
  };

  const scalarOnly = formatFigurePanelHeaderDetails(viewPanel, {
    ...allEnabled,
    experimentalMethods: false,
    statisticalMethods: false
  });
  assert.ok(scalarOnly.every(segment => [...segment].length <= maxSegment));
  const listOnly = formatFigurePanelHeaderDetails(viewPanel, {
    experimentalMethods: true,
    statisticalMethods: true
  });
  listOnly.forEach(segment => {
    assert.ok([...segment].length <= maxSegment);
    const items = segment.split('、');
    assert.ok(items.length <= maxItems);
    assert.ok(items.every(item => [...item].length <= maxSegment));
  });
  const details = formatFigurePanelHeaderDetails(viewPanel, allEnabled);
  const detailText = details.join(' · ');
  assert.ok(details.every(segment => [...segment].length <= maxSegment));
  assert.ok([...detailText].length <= maxDetails);
  assert.ok(details.every(segment => !hasBrokenSurrogate(segment)));
  assert.equal(details.includes(viewPanel.displayId), false);

  const header = formatFigurePanelHeader(viewPanel, allEnabled);
  assert.equal(header.slice(0, viewPanel.displayId.length), viewPanel.displayId);
  assert.ok(header.startsWith(`${viewPanel.displayId} · `));
});

test('Panel heading preference persistence isolates save failure from success rendering', async () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(
    popup, 'runFigurePanelHeaderFieldsMutation'
  );
  const runFigurePanelHeaderFieldsMutation = new Function(
    `${source}\nreturn runFigurePanelHeaderFieldsMutation;`
  )();
  const previous = { evidenceType: true };
  const next = { evidenceType: false };

  let persistCalls = 0;
  const pending = await runFigurePanelHeaderFieldsMutation({
    isPending: () => true,
    previous,
    next,
    persist: async () => { persistCalls += 1; },
    setState: () => assert.fail('pending mutation must not update state'),
    setPending: () => assert.fail('pending mutation must not toggle pending'),
    render: () => assert.fail('pending mutation must not render')
  });
  assert.equal(pending.status, 'pending');
  assert.equal(persistCalls, 0);

  const failedStates = [];
  const failedRenders = [];
  let saveFailures = 0;
  const failed = await runFigurePanelHeaderFieldsMutation({
    isPending: () => false,
    previous,
    next,
    persist: async () => { throw new Error('storage failed'); },
    normalizeSaved: value => value,
    setState: value => failedStates.push(value),
    setPending: () => undefined,
    render: value => failedRenders.push(value),
    onSaveFailed: () => { saveFailures += 1; }
  });
  assert.equal(failed.status, 'save_failed');
  assert.deepEqual(failedStates, [next, previous]);
  assert.deepEqual(failedRenders, [next, previous]);
  assert.equal(saveFailures, 1);

  const equalRenders = [];
  const savedEqual = await runFigurePanelHeaderFieldsMutation({
    isPending: () => false,
    previous,
    next,
    persist: async () => ({ ...next }),
    normalizeSaved: value => value,
    setState: () => undefined,
    setPending: () => undefined,
    render: value => equalRenders.push(value)
  });
  assert.equal(savedEqual.status, 'saved');
  assert.deepEqual(equalRenders, [next]);

  const normalized = { evidenceType: false, purpose: true };
  const normalizedStates = [];
  const normalizedRenders = [];
  const savedNormalized = await runFigurePanelHeaderFieldsMutation({
    isPending: () => false,
    previous,
    next,
    persist: async () => normalized,
    normalizeSaved: value => value,
    setState: value => normalizedStates.push(value),
    setPending: () => undefined,
    render: value => normalizedRenders.push(value)
  });
  assert.equal(savedNormalized.status, 'reconciled');
  assert.deepEqual(normalizedStates, [next, normalized]);
  assert.deepEqual(normalizedRenders, [next, normalized]);

  const retainedStates = [];
  let renderFailures = 0;
  let falseSaveFailures = 0;
  const renderFailed = await runFigurePanelHeaderFieldsMutation({
    isPending: () => false,
    previous,
    next,
    persist: async () => normalized,
    normalizeSaved: value => value,
    setState: value => retainedStates.push(value),
    setPending: () => undefined,
    render(value) {
      if (value === normalized) throw new Error('render failed after save');
    },
    onSaveFailed: () => { falseSaveFailures += 1; },
    onRenderFailed: () => { renderFailures += 1; }
  });
  assert.equal(renderFailed.status, 'saved_render_failed');
  assert.deepEqual(retainedStates, [next, normalized]);
  assert.equal(renderFailures, 1);
  assert.equal(falseSaveFailures, 0);
});

test('Panel heading preference control exposes six accessible persistent options', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const css = read('popup.css');
  const labels = {
    evidenceType: '证据类型',
    purpose: '目的',
    experimentalMethods: '实验方法',
    statisticalMethods: '统计学方法',
    comparison: '比较/分组',
    directObservation: '直接观察'
  };

  assert.match(html, /id="figurePanelHeaderFieldsButton"/);
  assert.match(html, /class="figure-panel-header-fields-control"[^>]*hidden/);
  assert.match(html, /figure-panel-header-fields-triangle/);
  assert.doesNotMatch(html, /<span>Panel 标题信息<\/span>/);
  assert.match(html, /id="figurePanelHeaderFieldsMenu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="figurePanelHeaderFieldsMenu"/);
  Object.entries(labels).forEach(([key, label]) => {
    assert.match(html, new RegExp(`data-figure-panel-header-field="${key}"`));
    assert.match(html, new RegExp(label.replace('/', '\\/')));
  });
  const setup = functionBody(
    popup, 'setupFigurePanelHeaderFieldsMenu', 'setupEventListeners'
  );
  assert.match(setup, /figurePanelHeaderFieldsMenuInitialized/);
  assert.match(setup, /aria-expanded/);
  assert.match(setup, /event\.key === 'Escape'/);
  assert.match(setup, /button\.focus\(\)/);
  assert.match(setup, /document\.addEventListener\('pointerdown'/);
  assert.match(setup, /runFigurePanelHeaderFieldsMutation\(\{/);
  assert.match(setup,
    /updateLlmPreferencesCore\(\{\s*figurePanelHeaderFields:\s*value\s*\}\)/s);
  assert.match(setup, /previous/);
  assert.match(setup, /renderFigureWorkspaceSnapshot\(currentWorkspaceSnapshot\)/);
  assert.match(setup, /showStatus\(/);
  assert.doesNotMatch(setup, /figurePanelExpansionState\.clear\(/);
  assert.doesNotMatch(setup, /figureWorkspaceViewState\.clear\(/);
  assert.doesNotMatch(setup, /figureQuickNavActiveId\s*=/);
  assert.match(css, /\.figure-panel-header-fields-menu\s*\{[^}]*position:\s*absolute/s);
});

test('Panel heading control is visible only in the Figure workspace', () => {
  const popup = read('popup.js');
  const body = functionBody(popup, 'switchWorkspaceView', 'scheduleActiveWorkspaceUiStateSave');
  assert.match(body, /figurePanelHeaderFieldsControl/);
  assert.match(body, /target\s*!==\s*'figures'/);
});

test('Panel heading preference button is a compact square logo button', () => {
  const css = read('popup.css');
  assert.match(css,
    /\.side-panel-tool-button\.figure-panel-header-fields-button\s*\{[^}]*width:\s*32px;/s);
});

test('Panel heading preference menu stays inside the narrow side-panel viewport', () => {
  const css = read('popup.css');
  assert.match(css,
    /@media \(max-width:\s*460px\)[\s\S]*?\.figure-panel-header-fields-menu\s*\{[^}]*position:\s*fixed;[^}]*left:\s*10px;[^}]*right:\s*10px;[^}]*width:\s*auto;/s);
});

test('Panel summaries consume view fields without changing expanded content coverage', () => {
  const popup = read('popup.js');
  const summary = functionBody(
    popup, 'appendFigurePanelSummary', 'panelFollowupPresetOptions'
  );
  const catalog = functionBody(
    popup, 'appendFigurePanelCatalog', 'createCollapsibleFigureResultSection'
  );
  const expanded = functionBody(
    popup, 'appendFigureWorkspaceViewPanelFields', 'appendFigurePanelCatalog'
  );

  assert.match(summary, /formatFigurePanelHeaderDetails\(viewPanel,/);
  assert.match(summary, /description\.textContent\s*=/);
  assert.match(summary, /summary\.replaceChildren\(label,/);
  assert.match(catalog, /viewPanel/);
  assert.match(catalog, /displayId:\s*formatFigurePanelHeader\(panel, viewPanel\.displayId\)/);
  for (const key of [
    'purpose', 'evidenceType', 'phenotypeName', 'experimentalMethods',
    'statisticalMethods', 'design', 'comparison', 'directObservation',
    'localInference', 'contribution'
  ]) assert.match(expanded, new RegExp(`['"]${key}['"]`));
  assert.match(catalog, /field\.key === 'note'/);
});

test('expanded Panel method fields localize known labels and preserve unknown labels safely', () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(popup, 'localizeFigureWorkspacePanelField');
  const SciLLM = {
    localizeFigureMethodLabel(value) {
      return value === 'representative images' ? '代表性图像' : String(value);
    }
  };
  const localizeFigureWorkspacePanelField = new Function(
    'SciLLM', `${source}\nreturn localizeFigureWorkspacePanelField;`
  )(SciLLM);

  const experimental = localizeFigureWorkspacePanelField({
    key: 'experimentalMethods', value: ['representative images', 'Novel Assay <x>']
  });
  const statistical = localizeFigureWorkspacePanelField({
    key: 'statisticalMethods', value: ['ANOVA']
  });
  const comparison = { key: 'comparison', value: 'treated vs control' };

  assert.deepEqual(experimental.value, ['代表性图像', 'Novel Assay <x>']);
  assert.deepEqual(statistical.value, ['ANOVA']);
  assert.deepEqual(localizeFigureWorkspacePanelField(comparison), comparison);
  assert.notEqual(experimental.value[0], '<span>代表性图像</span>');

  const expanded = functionBody(
    popup, 'appendFigureWorkspaceViewPanelFields', 'appendFigurePanelCatalog'
  );
  assert.match(expanded, /localizeFigureWorkspacePanelField\(field\)/);
});

test('compact Panel UI text is executable for main and supplemental Figures', () => {
  const popup = read('popup.js');
  const source = functionBody(
    popup, 'createFigurePanelUiText', 'figurePanelUiText'
  );
  const createFigurePanelUiText = new Function(
    'SciLLM', `${source}\nreturn createFigurePanelUiText;`
  )({ figurePanelDisplayId });

  const main = createFigurePanelUiText('Figure 2', 'A', {
    round: 2, totalRounds: 3
  });
  const supplement = createFigurePanelUiText('Figure S2', 'A', {
    round: 1, totalRounds: 1
  });
  assert.deepEqual(main, {
    displayId: '2A',
    historyHeading: '历史追问 · 2A（3 轮）',
    roundHeading: '2A · 第 2 轮',
    followupRunning: '正在追问 2A…',
    followupComplete: '已完成 2A 的定向追问',
    analysisRunning: '正在解读 2A…',
    analysisComplete: '2A 解读完成'
  });
  assert.equal(supplement.displayId, 'S2A');
  assert.equal(supplement.historyHeading, '历史追问 · S2A（1 轮）');
  assert.equal(supplement.analysisComplete, 'S2A 解读完成');
});

test('follow-up history and async status paths consume shared compact Panel text', () => {
  const popup = read('popup.js');
  const history = functionBody(
    popup, 'appendPanelFollowupHistory', 'createPanelFollowupControl'
  );
  const followup = functionBody(
    popup, 'runFigurePanelFollowup', 'runSingleFigureAnalysis'
  );
  const analysis = functionBody(
    popup, 'runSingleFigurePanelAnalysis', 'runCrossFigureLogic'
  );
  assert.match(history, /panelDisplayId/);
  assert.match(history, /historyText\.historyHeading/);
  assert.match(history, /uiText\.roundHeading/);
  assert.doesNotMatch(history, /`Panel \$\{/);
  assert.match(followup, /figurePanelUiText\(figureId, panelId\)/);
  assert.match(followup, /panelText\.followupRunning/);
  assert.match(followup, /panelText\.followupComplete/);
  assert.doesNotMatch(followup, /\$\{figureId\}[^`]*Panel \$\{panelId\}/);
  assert.match(analysis, /figurePanelUiText\(figureId, panelId\)/);
  assert.match(analysis, /panelText\.analysisRunning/);
  assert.match(analysis, /panelText\.analysisComplete/);
  assert.doesNotMatch(analysis, /\$\{figureId\}[^`]*Panel \$\{panelId\}/);
});

test('follow-up and Figure fallback paths pass supplemental identity to the shared formatter', () => {
  const popup = read('popup.js');
  const content = read('content.js');
  assert.match(popup, /SciLLM\.figurePanelDisplayId\([^)]*isSupplemental/s);
  assert.match(content, /SciLLM\.figurePanelDisplayId\([^)]*isSupplemental/s);
});

test('generated Panel reference fallback and DOM anchors preserve compact and stable identity', () => {
  const popup = read('popup.js');
  const references = functionBody(
    popup, 'formatFigurePanelReferences', 'figurePanelEvidenceGroup'
  );
  const formatFigurePanelReferences = new Function(
    'SciLLM', `${references}\nreturn formatFigurePanelReferences;`
  )({ figurePanelDisplayId });
  const catalog = functionBody(
    popup, 'appendFigurePanelCatalog', 'createCollapsibleFigureResultSection'
  );
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceSnapshot', 'renderArticleWorkspaceSnapshot'
  );
  assert.match(references,
    /panels\.get\(panelId\) \|\|\s*SciLLM\.figurePanelDisplayId\(/);
  assert.equal(formatFigurePanelReferences({
    figureLabel: 'Figure 2', panels: [{ panelId: 'A', displayId: '2A' }]
  }, ['A', 'B']), '2A、2B');
  assert.equal(formatFigurePanelReferences({
    figureLabel: 'Figure S2', panels: []
  }, ['A', 'C']), 'S2A、S2C');
  assert.match(catalog, /panelDetails\.id = viewPanel\.panelAnchorId/);
  assert.match(renderer, /details\.id = view\.figureAnchorId/);
  assert.doesNotMatch(popup, /function workspaceAnchorToken\(/);
});

test('Figure caption Panel group headings use compact IDs from the shared helper', () => {
  const popup = read('popup.js');
  const captionLabel = functionBody(
    popup, 'figureCaptionPanelLabel', 'figureCaptionBlocks'
  );
  const captionRenderer = functionBody(
    popup, 'renderFigureCaptionSidebarSnapshot', 'showFigureCaptionSidebar'
  );
  assert.match(captionLabel, /SciLLM\.figurePanelDisplayId\(/);
  assert.doesNotMatch(captionLabel, /`Panel \$\{/);
  assert.match(captionRenderer, /figureCaptionPanelLabel\(block, blocks\.length, figure\)/);
});

test('live Figure snapshots publish only the normalized public draft needed by the popup', () => {
  const content = read('content.js');
  const snapshot = functionBody(
    content, 'buildFigureWorkspaceSnapshot', 'ensureGlobalAbbreviationMemory'
  );
  assert.match(snapshot,
    /draft:\s*SciLLM\.publicFigureWorkspaceDraft\(figureWorkspaceDraft\)/);
  assert.doesNotMatch(snapshot, /analysisImages:\s*figureWorkspaceDraft/);
});

test('no-LLM notebook styling is compact, keyboard-visible, and preserves structural notes', () => {
  const css = read('popup.css');
  assert.match(css, /\.workspace-figure-overview\s*\{/);
  assert.match(css, /\.workspace-figure-view-field\s*\{/);
  assert.match(css, /\.workspace-figure-empty-value\s*\{/);
  assert.match(css, /\.workspace-figure-empty-value:focus-visible\s*\{/);
  assert.match(css, /\.workspace-panel-note\s*\{/);
});

test('side panel loads the article workspace canonicalizer before editable workspace code', () => {
  const html = read('popup.html');
  const workspaceModule = html.indexOf('src="core/article-workspace.js"');
  const popupController = html.indexOf('src="popup.js"');
  assert.notEqual(workspaceModule, -1);
  assert.ok(workspaceModule < popupController);
});

test('mechanism workspace defaults to a compact HTML and SVG network reading mode', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const css = read('popup.css');
  assert.match(html, /data-workspace-view="mechanism"/);
  assert.match(html, /<h2>图表梳理<\/h2>/u);
  assert.match(html, /id="backFromMechanismChain"/);
  assert.match(html, /id="mechanismChainSaveStatus"/);
  assert.match(html, /id="mechanismNetworkViewport"/);
  assert.match(html, /id="mechanismChainList"/);
  assert.match(html, /id="addMechanismChainNode"/);
  assert.match(html, /id="focusMechanismPath"/);
  assert.match(html, /id="openMechanismExportMenu"/);
  assert.match(html, /id="mechanismSelectionInspector"/);
  assert.doesNotMatch(html, /节点与联系按一条纵向链显示/u);
  assert.match(popup, /function renderMechanismChainWorkspace/);
  assert.match(popup, /function renderMechanismNetwork/);
  assert.match(popup, /createMechanismNetworkLayout\(/);
  assert.match(popup, /createElementNS\([^,]+,\s*'svg'\)/);
  assert.match(popup, /marker-end/);
  assert.match(popup, /switchWorkspaceView\('mechanism'/);
  assert.match(popup, /insert_mechanism_node/);
  assert.match(popup, /update_mechanism_node/);
  assert.match(popup, /remove_mechanism_node/);
  assert.match(popup, /reorder_mechanism_node/);
  assert.match(popup, /add_mechanism_edge_evidence/);
  assert.match(popup, /remove_mechanism_edge_evidence/);
  assert.match(popup, /update_mechanism_edge_evidence/);
  assert.match(popup, /workspace-mechanism-evidence-class/);
  assert.match(popup, /workspace-mechanism-manual-reference/);
  assert.match(popup, /workspace-mechanism-evidence is-\$\{evidenceClass\}/);
  assert.match(popup, /evidenceClass \|\| 'other'/);
  assert.match(css, /\.workspace-view\[data-workspace-view="mechanism"\]/);
  assert.match(css, /\.workspace-mechanism-network-viewport/);
  assert.match(css, /\.workspace-mechanism-network-canvas/);
  assert.match(css, /\.workspace-mechanism-edge-layer/);
  assert.match(css, /\.workspace-mechanism-evidence\.is-sufficiency/);
  assert.match(css, /\.workspace-mechanism-evidence\.is-necessity/);
  assert.match(css, /\.workspace-mechanism-evidence-item/);
  assert.match(css, /\.workspace-mechanism-manual-reference/);
  assert.match(css, /\.workspace-mechanism-evidence-class/);
});

test('mechanism read mode uses Mermaid and keeps editing behind graph selection', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const renderer = functionBody(
    popup, 'renderMechanismNetwork', 'renderMechanismChainWorkspace'
  );
  assert.match(renderer, /createMechanismMermaidDefinition/);
  assert.match(renderer, /renderMechanismEvidenceMatrix/);
  assert.match(renderer, /bindMechanismMermaidInteractions/);
  assert.doesNotMatch(renderer, /workspace-mechanism-evidence-select/);
  assert.doesNotMatch(renderer, /workspace-mechanism-evidence-replacement/);
  assert.doesNotMatch(renderer, /workspace-mechanism-evidence-class/);
  assert.match(css, /\.workspace-mechanism-mermaid-target:focus-visible/);
});

test('mechanism graph renderers omit Panel chips while matrix uses alias display names', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const legacy = functionBody(
    popup, 'renderLegacyMechanismNetwork', 'let mechanismMermaidInitialized'
  );
  const matrix = functionBody(
    popup, 'renderMechanismEvidenceMatrix', 'function bindMechanismMermaidInteractions'
  );
  assert.doesNotMatch(legacy, /workspace-mechanism-evidence-chips/);
  assert.doesNotMatch(legacy, /workspace-mechanism-evidence-chip/);
  assert.doesNotMatch(css, /\.workspace-mechanism-evidence-chips/);
  assert.doesNotMatch(css, /\.workspace-mechanism-evidence-chip/);
  assert.match(matrix, /item\.displayName/);
});

test('mechanism evidence matrix derives both axes and every cell from one node model', () => {
  const axisModel = loadMechanismMatrixNodeAxisModel(read('popup.js'));
  const model = axisModel({ nodes: [
    { id: 'a', label: 'Source' },
    { id: 'b', label: 'Mediator' },
    { id: 'c', label: 'Result' }
  ] });
  assert.deepEqual(model.columns.map(node => node.id), ['a', 'b', 'c']);
  assert.deepEqual(model.rows.map(node => node.id), ['a', 'b', 'c']);
  assert.equal(Object.hasOwn(model, 'cells'), false);
  assert.equal(model.orientation, 'column-source-row-target');
  assert.deepEqual(axisModel({ nodes: [] }).columns, []);
  const bounded = axisModel({ nodes: Array.from(
    { length: 70 }, (_, index) => ({ id: `n${index}`, label: `Node ${index}` })
  ) });
  assert.equal(bounded.columns.length, 64);
  assert.equal(bounded.rows.length, 64);
});

test('mechanism matrix exposes synchronized node editors and one atomic delete action', () => {
  const popup = read('popup.js');
  const renderer = functionBody(
    popup, 'renderMechanismEvidenceMatrix', 'function bindMechanismMermaidInteractions'
  );
  assert.match(renderer, /workspace-mechanism-matrix-add-node/);
  assert.match(renderer, /addMechanismNodeAfter\(\)/);
  assert.equal((renderer.match(/appendMechanismMatrixNodeHeader\(/g) || []).length, 2);
  const header = functionBody(
    popup, 'appendMechanismMatrixNodeHeader', 'renderMechanismEvidenceMatrix'
  );
  assert.match(header, /appendMechanismInlineField/);
  assert.match(header, /scope:\s*'mechanism-node'/);
  assert.match(header, /removeMechanismNode\(node\.id\)/);
  assert.equal((header.match(/removeMechanismNode\(/g) || []).length, 1);
  assert.match(header, /aria-label/);
  assert.match(header, /t\('删除节点'\)/);
});

test('matrix cell controller adds a real ledger Panel with one atomic generated-id upsert', async () => {
  const createController = loadMechanismMatrixCellEditorController(read('popup.js'));
  const writes = [];
  const pending = [];
  const focused = [];
  const context = Object.freeze({ key: 'paper-a' });
  const panels = new Map([['figure-2\u0000C', {
    figureId: 'figure-2', panelId: 'C', displayId: '2C', evidenceClass: 'other'
  }]]);
  const controller = createController({
    captureContext: () => context,
    isContextCurrent: value => value === context,
    getPanel: key => panels.get(key),
    createId: prefix => `${prefix}-generated`,
    mutate: async (mutation, seenContext) => {
      writes.push([mutation, seenContext]);
      return { success: true };
    },
    setPending: value => pending.push(value),
    restoreFocus: cell => focused.push(cell)
  });
  const cell = { sourceId: 'source', sourceLabel: 'Source', targetId: 'target',
    targetLabel: 'Target', edgeId: '', focusKey: 'source\u0000target' };
  controller.open(cell);
  const result = await controller.add('figure-2\u0000C', 'necessity', 'negative');
  assert.equal(result.success, true);
  assert.deepEqual(writes, [[{
    type: 'upsert_mechanism_cell_evidence',
    edgeId: 'mechanism-edge-generated',
    edge: { from: 'source', to: 'target', polarity: 'neutral' },
    evidence: {
      figureId: 'figure-2', panelId: 'C', evidenceClass: 'necessity',
      evidenceClassSource: 'manual'
    }
  }, context]]);
  assert.deepEqual(pending, [true, false]);
  assert.deepEqual(focused, ['source\u0000target']);
});

test('matrix cell controller requires signed self-loop polarity and rejects stale ledger Panels', async () => {
  const createController = loadMechanismMatrixCellEditorController(read('popup.js'));
  const writes = [];
  const panel = { figureId: 'figure-1', panelId: 'A' };
  let present = true;
  const controller = createController({
    captureContext: () => ({ key: 'paper-a' }),
    isContextCurrent: () => true,
    getPanel: () => present ? panel : null,
    createId: () => 'loop-edge',
    mutate: async mutation => { writes.push(mutation); return { success: true }; }
  });
  controller.open({ sourceId: 'same', sourceLabel: 'Same', targetId: 'same',
    targetLabel: 'Same', edgeId: '', focusKey: 'same\u0000same' });
  assert.equal((await controller.add('figure-1\u0000A', 'other', 'neutral')).code,
    'MECHANISM_NETWORK_SELF_LOOP_POLARITY_REQUIRED');
  assert.equal(writes.length, 0);
  present = false;
  assert.equal((await controller.add('figure-1\u0000A', 'other', 'negative')).code,
    'FIGURE_WORKSPACE_PANEL_CONTEXT_STALE');
  present = true;
  await controller.add('figure-1\u0000A', 'other', 'negative');
  assert.equal(writes[0].edge.polarity, 'negative');
});

test('matrix chip edits use only alias update replacement and removal allowlisted mutations', async () => {
  const createController = loadMechanismMatrixCellEditorController(read('popup.js'));
  const writes = [];
  const panels = new Map([
    ['figure-1\u0000A', { figureId: 'figure-1', panelId: 'A' }],
    ['figure-2\u0000B', { figureId: 'figure-2', panelId: 'B' }]
  ]);
  const controller = createController({
    captureContext: () => ({ key: 'paper-a' }), isContextCurrent: () => true,
    getPanel: key => panels.get(key),
    mutate: async mutation => { writes.push(mutation); return { success: true }; }
  });
  controller.open({ sourceId: 'a', targetId: 'b', edgeId: 'edge-a-b',
    focusKey: 'a\u0000b' });
  const item = { edgeId: 'edge-a-b', index: 0, figureId: 'figure-1', panelId: 'A' };
  await controller.alias(item, '<b>causal alias</b>');
  await controller.setClass(item, 'sufficiency');
  await controller.replace(item, 'figure-2\u0000B', 'necessity');
  await controller.remove(item);
  assert.deepEqual(writes, [
    { type: 'set_mechanism_panel_alias', figureId: 'figure-1', panelId: 'A',
      value: '<b>causal alias</b>' },
    { type: 'update_mechanism_edge_evidence', edgeId: 'edge-a-b', index: 0,
      expectedFigureId: 'figure-1', expectedPanelId: 'A',
      evidence: { figureId: 'figure-1', panelId: 'A', evidenceClass: 'sufficiency',
        evidenceClassSource: 'manual' } },
    { type: 'update_mechanism_edge_evidence', edgeId: 'edge-a-b', index: 0,
      expectedFigureId: 'figure-1', expectedPanelId: 'A',
      evidence: { figureId: 'figure-2', panelId: 'B', evidenceClass: 'necessity',
        evidenceClassSource: 'manual' } },
    { type: 'remove_mechanism_edge_evidence', edgeId: 'edge-a-b', index: 0,
      expectedFigureId: 'figure-1', expectedPanelId: 'A' }
  ]);
  assert.equal(writes.some(mutation => mutation.type === 'remove_mechanism_edge'), false);
});

test('matrix chip edit stays on its owning parallel edge and bounds hostile values', async () => {
  const createController = loadMechanismMatrixCellEditorController(read('popup.js'));
  const writes = [];
  const panels = new Map([
    ['figure-1\u0000A', { figureId: 'figure-1', panelId: 'A' }]
  ]);
  const controller = createController({
    captureContext: () => ({ key: 'paper-a' }), isContextCurrent: () => true,
    getPanel: key => panels.get(key),
    mutate: async mutation => { writes.push(mutation); return { success: true }; }
  });
  controller.open({ sourceId: 'a', targetId: 'b', edgeId: 'edge-primary',
    edgeIds: ['edge-primary', 'edge-secondary'], focusKey: 'a\u0000b' });
  const item = { edgeId: 'edge-secondary', index: 0,
    figureId: 'figure-1', panelId: 'A' };
  await controller.setClass(item, 'necessity');
  assert.equal(writes[0].edgeId, 'edge-secondary');
  const longAlias = '<img src=x onerror=alert(1)>' + '🧪'.repeat(100);
  await controller.alias(item, longAlias);
  assert.equal(Array.from(writes[1].value).length, 80);
  assert.equal((await controller.setClass(item, 'constructor')).code,
    'FIGURE_WORKSPACE_VALUE_INVALID');
  assert.equal((await controller.replace(item, '__proto__', 'other')).code,
    'FIGURE_WORKSPACE_PANEL_CONTEXT_STALE');
  assert.equal(writes.length, 2);
});

test('matrix cell mutation retries one CAS conflict while blocking stale and double submits', async () => {
  const createController = loadMechanismMatrixCellEditorController(read('popup.js'));
  let current = true;
  let attempts = 0;
  let release;
  const refreshes = [];
  const controller = createController({
    captureContext: () => ({ key: 'paper-a' }), isContextCurrent: () => current,
    getPanel: () => ({ figureId: 'figure-1', panelId: 'A' }),
    createId: () => 'edge-generated',
    async mutate() {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('conflict');
        error.code = 'FIGURE_WORKSPACE_REVISION_CONFLICT';
        throw error;
      }
      return new Promise(resolve => { release = resolve; });
    },
    async refresh(context) { refreshes.push(context.key); }
  });
  controller.open({ sourceId: 'a', targetId: 'b', edgeId: '', focusKey: 'a\u0000b' });
  const first = controller.add('figure-1\u0000A', 'other', 'neutral');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await controller.add('figure-1\u0000A', 'other', 'neutral')).code,
    'FIGURE_WORKSPACE_MATRIX_CELL_PENDING');
  release({ success: true });
  assert.equal((await first).success, true);
  assert.equal(attempts, 2);
  assert.deepEqual(refreshes, ['paper-a']);
  current = false;
  assert.equal((await controller.add('figure-1\u0000A', 'other', 'neutral')).code,
    'FIGURE_WORKSPACE_EDIT_CONTEXT_CHANGED');
  assert.equal(attempts, 2);
});

test('matrix evidence edits re-resolve immutable identity after CAS conflict', async () => {
  const createController = loadMechanismMatrixCellEditorController(read('popup.js'));
  for (const action of ['class', 'replace', 'remove']) {
    let index = 0;
    let attempts = 0;
    const writes = [];
    const panels = new Map([
      ['figure-1\u0000A', { figureId: 'figure-1', panelId: 'A' }],
      ['figure-2\u0000B', { figureId: 'figure-2', panelId: 'B' }]
    ]);
    const controller = createController({
      captureContext: () => ({ key: action }), isContextCurrent: () => true,
      getPanel: key => panels.get(key),
      resolveEvidence: (edgeId, figureId, panelId) =>
        edgeId === 'edge' && figureId === 'figure-1' && panelId === 'A'
          ? { edgeId, index, figureId, panelId } : null,
      async mutate(mutation) {
        attempts += 1;
        writes.push(mutation);
        if (attempts === 1) {
          const error = new Error('conflict');
          error.code = 'FIGURE_WORKSPACE_REVISION_CONFLICT';
          throw error;
        }
        return { success: true };
      },
      async refresh() { index = 1; }
    });
    controller.open({ sourceId: 'a', targetId: 'b', edgeId: 'edge',
      edgeIds: ['edge'], focusKey: 'a\u0000b' });
    const item = { edgeId: 'edge', index: 0, figureId: 'figure-1', panelId: 'A' };
    const result = action === 'class'
      ? await controller.setClass(item, 'necessity')
      : action === 'replace'
        ? await controller.replace(item, 'figure-2\u0000B', 'other')
        : await controller.remove(item);
    assert.equal(result.success, true, action);
    assert.deepEqual(writes.map(mutation => mutation.index), [0, 1], action);
    assert.equal(writes[1].expectedFigureId, 'figure-1', action);
    assert.equal(writes[1].expectedPanelId, 'A', action);
  }
});

test('matrix evidence conflict never replays when the Panel left its owning edge', async () => {
  const createController = loadMechanismMatrixCellEditorController(read('popup.js'));
  let present = true;
  let attempts = 0;
  const controller = createController({
    captureContext: () => ({ key: 'paper' }), isContextCurrent: () => true,
    getPanel: () => ({ figureId: 'figure-1', panelId: 'A' }),
    resolveEvidence: () => present
      ? { edgeId: 'edge', index: 0, figureId: 'figure-1', panelId: 'A' } : null,
    async mutate() {
      attempts += 1;
      const error = new Error('conflict');
      error.code = 'FIGURE_WORKSPACE_REVISION_CONFLICT';
      throw error;
    },
    async refresh() { present = false; }
  });
  controller.open({ sourceId: 'a', targetId: 'b', edgeId: 'edge',
    edgeIds: ['edge'], focusKey: 'a\u0000b' });
  const result = await controller.remove({
    edgeId: 'edge', index: 0, figureId: 'figure-1', panelId: 'A'
  });
  assert.equal(result.code, 'FIGURE_WORKSPACE_PANEL_CONTEXT_STALE');
  assert.equal(attempts, 1);
});

test('adding evidence to an existing signed self-loop preserves the owner polarity', async () => {
  const createController = loadMechanismMatrixCellEditorController(read('popup.js'));
  const writes = [];
  const controller = createController({
    captureContext: () => ({ key: 'paper' }), isContextCurrent: () => true,
    getPanel: () => ({ figureId: 'figure-1', panelId: 'A' }),
    mutate: async mutation => { writes.push(mutation); return { success: true }; }
  });
  controller.open({ sourceId: 'loop', targetId: 'loop', edgeId: 'signed-loop',
    edgeIds: ['signed-loop'], edgePolarities: { 'signed-loop': 'negative' },
    focusKey: 'loop\u0000loop' });
  const result = await controller.add('figure-1\u0000A', 'other', 'neutral', 'signed-loop');
  assert.equal(result.success, true);
  assert.equal(writes[0].edgeId, 'signed-loop');
  assert.equal(writes[0].edge.polarity, 'negative');
});

test('adding evidence to a parallel-edge cell honors the explicitly selected owner', async () => {
  const createController = loadMechanismMatrixCellEditorController(read('popup.js'));
  const writes = [];
  const controller = createController({
    captureContext: () => ({ key: 'paper' }), isContextCurrent: () => true,
    getPanel: () => ({ figureId: 'figure-1', panelId: 'A' }),
    mutate: async mutation => { writes.push(mutation); return { success: true }; }
  });
  controller.open({ sourceId: 'a', targetId: 'b', edgeId: 'first',
    edgeIds: ['first', 'second'],
    edgePolarities: { first: 'positive', second: 'negative' },
    focusKey: 'a\u0000b' });
  const result = await controller.add(
    'figure-1\u0000A', 'sufficiency', 'neutral', 'second'
  );
  assert.equal(result.success, true);
  assert.equal(writes[0].edgeId, 'second');
  assert.deepEqual(writes[0].edge, { from: 'a', to: 'b', polarity: 'neutral' });
});

test('existing-only evidence identity preserves the audited original display ID verbatim', () => {
  const source = executableFunctionSource(
    read('popup.js'), 'mechanismMatrixEvidenceEditItem'
  );
  const editItem = Function(`${source}\nreturn mechanismMatrixEvidenceEditItem;`)();
  const originalDisplayId = 'Ｆig\u00a0１D';
  const item = editItem({
    edges: [{
      id: 'relation-ab', from: 'a', to: 'b', polarity: 'positive',
      panelEvidence: [{ figureId: 'figure-1', panelId: 'D', value: 'fallback' }]
    }]
  }, 'a', 'b', {
    ownerEdgeId: 'relation-ab', evidenceIndex: 0,
    figureId: 'figure-1', panelId: 'D', displayName: 'Alias', originalDisplayId
  });
  assert.equal(item.originalDisplayId, originalDisplayId);
});

test('every matrix evidence cell exposes native edit controls and a portal dialog', () => {
  const popup = read('popup.js');
  const renderer = functionBody(
    popup, 'renderMechanismEvidenceMatrix', 'function bindMechanismMermaidInteractions'
  );
  const editor = functionBody(
    popup, 'openMechanismMatrixCellEditor', 'function renderMechanismEvidenceMatrix'
  );
  assert.match(renderer, /cell\.dataset\.sourceNodeId\s*=\s*source\.id/);
  assert.match(renderer, /cell\.dataset\.targetNodeId\s*=\s*target\.id/);
  assert.doesNotMatch(renderer, /setAttribute\('role',\s*'grid(?:cell)?'\)/);
  assert.match(renderer, /workspace-mechanism-matrix-cell-edit/);
  assert.doesNotMatch(renderer, /cell\.setAttribute\('role',\s*'button'\)/);
  assert.doesNotMatch(renderer, /cell\.addEventListener\('keydown'/);
  assert.match(renderer, /openMechanismMatrixCellEditor/);
  assert.match(editor, /role',\s*'dialog'/);
  assert.match(editor, /formatMechanismMatrixUiText\('cellHeading'/);
  assert.match(editor, /\.slice\(0,\s*512\)/);
  assert.match(editor, /editorHost\.appendChild\(editor\)/);
  assert.match(editor, /workspace-mechanism-matrix-cell-alias/);
  assert.match(editor, /workspace-mechanism-matrix-cell-replacement/);
  assert.match(editor, /workspace-mechanism-matrix-cell-class/);
  assert.match(editor, /workspace-mechanism-matrix-cell-remove/);
  assert.match(renderer, /chip\.textContent\s*=\s*item\.displayName/);
  assert.match(renderer, /chip\.title\s*=/);
  assert.match(renderer, /chip\.setAttribute\('aria-label',\s*chip\.title\)/);
  assert.doesNotMatch(renderer, /textContent\s*=.*充分|textContent\s*=.*必要/);
});

test('real DOM native matrix buttons activate with Enter and Space without select bubbling', async () => {
  const { chromium } = require('playwright');
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].find(candidate => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {})
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="host"></main>');
    const rendererSource = functionBody(
      read('popup.js'), 'renderMechanismEvidenceMatrix',
      'bindMechanismMermaidInteractions'
    );
    const dispositionNormalizerSource = executableFunctionSource(
      read('popup.js'), 'normalizeMechanismPanelDispositions'
    );
    const dispositionAuditSource = executableFunctionSource(
      read('popup.js'), 'createMechanismPanelDispositionAudit'
    );
    const formatterSource = executableFunctionSource(
      read('popup.js'), 'formatMechanismMatrixUiText'
    );
    const controllerSource = functionBody(
      read('popup.js'), 'createMechanismMatrixCellEditorController',
      'formatMechanismMatrixUiText'
    );
    const evidenceItemSource = executableFunctionSource(
      read('popup.js'), 'mechanismMatrixEvidenceEditItem'
    );
    const resolverSource = executableFunctionSource(
      read('popup.js'), 'resolveCurrentMechanismEvidence'
    );
    const editorSource = functionBody(
      read('popup.js'), 'openMechanismMatrixCellEditor',
      'renderMechanismEvidenceMatrix'
    );
    await page.evaluate(({
      source, formatterSource, dispositionNormalizerSource, dispositionAuditSource
    }) => {
      window.opens = [];
      window.SciLLM = { createMechanismEvidenceMatrix: () => ({
        nodes: [{ id: 'a', label: 'Source' }, { id: 'b', label: 'Target' }],
        cells: [
          { from: 'a', to: 'a', edgeIds: [], evidence: [] },
          { from: 'a', to: 'b', edgeIds: ['edge'], evidence: [{
            figureId: 'figure-1', panelId: 'A', displayName: '1A',
            evidenceClass: 'other', ownerEdgeId: 'edge', edgeId: 'edge', evidenceIndex: 0
          }] },
          { from: 'b', to: 'a', edgeIds: [], evidence: [] },
          { from: 'b', to: 'b', edgeIds: [], evidence: [] }
        ]
      }) };
      window.mechanismMatrixNodeAxisModel = matrix => ({
        columns: matrix.nodes, rows: matrix.nodes
      });
      window.createWorkspaceElement = (tag, className = '', text = '') => {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        return element;
      };
      window.t = value => value;
      window.interfaceLanguage = () => 'zh-CN';
      window.appendMechanismMatrixNodeHeader = (parent, node) => {
        parent.textContent = node.label;
      };
      window.addMechanismNodeAfter = () => {};
      window.mechanismEvidenceClassAccessibleLabel = () => 'other evidence';
      window.openMechanismMatrixCellEditor = options => {
        window.opens.push([options.source.id, options.target.id,
          options.selectedEvidence?.panelId || '']);
        const portal = document.createElement('div');
        portal.id = 'portal';
        const select = document.createElement('select');
        select.innerHTML = '<option>A</option><option>B</option>';
        portal.append(select);
        options.editorHost.append(portal);
      };
      window.eval(`${dispositionNormalizerSource}\n${dispositionAuditSource}\n` +
        `${formatterSource}\n${source}\n` +
        'window.renderMechanismEvidenceMatrix = renderMechanismEvidenceMatrix;');
      window.renderMechanismEvidenceMatrix({}, document.getElementById('host'), {
        evidenceOptions: [], optionsByIdentity: new Map()
      });
    }, {
      source: rendererSource, formatterSource,
      dispositionNormalizerSource, dispositionAuditSource
    });
    const emptyEdit = page.locator(
      'td[data-source-node-id="a"][data-target-node-id="a"] .workspace-mechanism-matrix-cell-edit'
    );
    await emptyEdit.focus();
    await emptyEdit.press('Enter');
    const chip = page.getByRole('button', { name: /1A/ });
    await chip.focus();
    await chip.press('Space');
    await page.locator('#portal select').last().selectOption('B');
    assert.deepEqual(await page.evaluate(() => window.opens), [
      ['a', 'a', ''], ['a', 'b', 'A']
    ]);
    assert.equal(await page.locator('td button button').count(), 0);
    await page.evaluate(({
      controllerSource, evidenceItemSource, resolverSource, editorSource
    }) => {
      document.getElementById('host').replaceChildren();
      const anchor = document.createElement('button');
      anchor.id = 'real-anchor';
      const editorHost = document.createElement('div');
      editorHost.id = 'real-editor-host';
      document.body.append(anchor, editorHost);
      window.capturePanelContext = () => ({ key: 'paper' });
      window.captureFigureWorkspaceEditContext = () => ({ key: 'paper' });
      window.isCurrentFigureWorkspaceEditContext = () => true;
      window.liveMechanismChain = { edges: [] };
      window.mechanismWorkspaceDraft = () => ({
        mechanismChain: window.liveMechanismChain
      });
      window.mechanismWorkspaceId = () => 'generated';
      window.mutations = [];
      window.mechanismActionCoordinator = { run: async mutation => {
        window.mutations.push(mutation);
        return { success: true };
      } };
      window.refreshArticleWorkspace = async () => null;
      window.setMechanismChainSaveStatus = () => {};
      window.eval(`${controllerSource}\n${evidenceItemSource}\n${resolverSource}\n` +
        `${editorSource}\n` +
        'window.openRealEditor = openMechanismMatrixCellEditor;' +
        'window.openMechanismMatrixCellEditor = openMechanismMatrixCellEditor;');
      anchor.focus();
      window.openRealEditor({
        anchor, editorHost,
        chain: { edges: [] },
        source: { id: 'a', label: 'Source' },
        target: { id: 'b', label: 'Target' },
        matrixCell: { edgeIds: [], evidence: [] },
        evidenceOptions: [], optionsByIdentity: new Map()
      });
    }, { controllerSource, evidenceItemSource, resolverSource, editorSource });
    await page.locator('.workspace-mechanism-matrix-cell-editor select').first().press('Escape');
    assert.equal(await page.locator('.workspace-mechanism-matrix-cell-editor').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'real-anchor');

    await page.evaluate(() => {
      const evidence = (edgeId, evidenceIndex) => ({
        figureId: 'figure-1', panelId: 'A', originalDisplayId: '1A',
        displayName: 'shared Panel',
        evidenceClass: 'other', ownerEdgeId: edgeId, edgeId, evidenceIndex
      });
      const chain = { edges: [
          { id: 'first', from: 'a', to: 'b', polarity: 'positive',
            label: { value: 'activates' },
            panelEvidence: [{ figureId: 'figure-1', panelId: 'A' }] },
          { id: 'second', from: 'a', to: 'b', polarity: 'negative',
            label: { value: 'inhibits' },
            panelEvidence: [{ figureId: 'figure-1', panelId: 'A' }] }
        ] };
      window.liveMechanismChain = chain;
      window.SciLLM.createMechanismEvidenceMatrix = () => ({
        nodes: [{ id: 'a', label: 'Source' }, { id: 'b', label: 'Target' }],
        cells: [{
          from: 'a', to: 'b',
          edgeIds: ['first', 'second'],
          evidence: [evidence('first', 0), evidence('second', 0)]
        }]
      });
      const host = document.getElementById('host');
      host.replaceChildren();
      window.renderMechanismEvidenceMatrix(chain, host, {
        evidenceOptions: [{
          figureId: 'figure-1', panelId: 'A', displayId: '1A'
        }],
        optionsByIdentity: new Map([['figure-1\u0000A', {
          figureId: 'figure-1', panelId: 'A', displayId: '1A'
        }]])
      });
    });
    assert.deepEqual(await page.locator(
      '.workspace-mechanism-matrix-relation-badge'
    ).allTextContents(), [
      '第 1 条联系 · activates · 因果联系 · 正向/促进',
      '第 2 条联系 · inhibits · 因果联系 · 负向/抑制'
    ], 'same-named evidence remains visibly attributable to a stable parallel relation');
    assert.deepEqual(await page.locator(
      '.workspace-mechanism-matrix-evidence'
    ).evaluateAll(items => items.map(item => ({
      aria: item.getAttribute('aria-label'), title: item.title
    }))), [{
      aria: 'Panel 证据 shared Panel；类别：其他或相关性证据；第 1 条联系 · activates · 因果联系 · 正向/促进',
      title: 'Panel 证据 shared Panel；类别：其他或相关性证据；第 1 条联系 · activates · 因果联系 · 正向/促进'
    }, {
      aria: 'Panel 证据 shared Panel；类别：其他或相关性证据；第 2 条联系 · inhibits · 因果联系 · 负向/抑制',
      title: 'Panel 证据 shared Panel；类别：其他或相关性证据；第 2 条联系 · inhibits · 因果联系 · 负向/抑制'
    }], 'parallel evidence also has distinct accessible relation identities');
    await page.locator('.workspace-mechanism-matrix-evidence').nth(1).click();
    assert.equal(await page.locator('.workspace-mechanism-matrix-cell-evidence').count(), 2);
    const selected = page.locator(
      '.workspace-mechanism-matrix-cell-evidence.is-selected'
    );
    assert.equal(await selected.count(), 1);
    assert.equal(await selected.getAttribute('data-owner-edge-id'), 'second');
    assert.equal(await selected.getAttribute('data-evidence-index'), '0');
    assert.equal(await page.evaluate(() =>
      document.activeElement?.closest('.workspace-mechanism-matrix-cell-evidence')
        ?.dataset.ownerEdgeId
    ), 'second');
    await selected.locator('.workspace-mechanism-matrix-cell-class')
      .selectOption('necessity');
    await page.waitForFunction(() => window.mutations.length === 1, null, { timeout: 1000 });
    const mutations = await page.evaluate(() => window.mutations);
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].edgeId, 'second');
    assert.equal(mutations[0].expectedFigureId, 'figure-1');
    assert.equal(mutations[0].expectedPanelId, 'A');
  } finally {
    await browser.close();
  }
});

test('matrix dialog awaits every mutation and reports bounded retryable status', () => {
  const editor = functionBody(
    read('popup.js'), 'openMechanismMatrixCellEditor', 'function renderMechanismEvidenceMatrix'
  );
  assert.match(editor, /const perform = async operation/);
  assert.match(editor, /await perform\(\(\) => controller\.add/);
  assert.match(editor, /await perform\(\(\) => controller\.alias/);
  assert.match(editor, /await perform\(\(\) => controller\.replace/);
  assert.match(editor, /await perform\(\(\) => controller\.setClass/);
  assert.match(editor, /await perform\(\(\) => controller\.remove/);
  assert.match(editor, /workspace-mechanism-matrix-cell-status/);
  assert.match(editor, /FIGURE_WORKSPACE_PANEL_CONTEXT_STALE/);
  assert.doesNotMatch(editor, /void controller\.(?:add|alias|replace|setClass|remove)/);
});

test('duplicate matrix node headers mount and focus editors on the activated axis', async () => {
  const key = '{"scope":"mechanism-node","nodeId":"a","field":"label"}';
  const makeTarget = () => ({
    isConnected: true, dataset: { figureEditPath: key }, children: [],
    removeAttribute() {},
    replaceChildren(...children) { this.children = children; }
  });
  const makeElement = (_tag, className) => ({
    className, value: '', dataset: {}, attributes: {}, focused: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {},
    focus() { this.focused = true; },
    setSelectionRange() {}
  });
  const column = makeTarget();
  const row = makeTarget();
  let globalTarget = row;
  const sessions = [];
  const openEditor = loadOpenFigureWorkspaceInlineEditor(read('popup.js'), [
    { async begin(_descriptor, _value, options) {
      sessions.push(options); return { status: 'started' };
    } },
    null,
    () => ({}),
    () => key,
    () => globalTarget,
    { abort() {}, update() {}, cancel() {}, save() {}, blur() {} },
    makeElement
  ]);
  const descriptor = { scope: 'mechanism-node', nodeId: 'a', field: 'label' };
  column.dataset.figureEditOccurrence = 'column';
  column.dataset.mechanismNodeId = 'a';
  row.dataset.figureEditOccurrence = 'row';
  row.dataset.mechanismNodeId = 'a';
  await openEditor(column, descriptor, 'Source', 'Mechanism node 1', false);
  assert.equal(sessions[0].mount, column);
  assert.deepEqual(sessions[0].presentationHint, { occurrence: 'column', nodeId: 'a' });
  assert.equal(column.children[0].focused, true);
  assert.equal(row.children.length, 0);
  globalTarget = column;
  await openEditor(row, descriptor, 'Source', 'Mechanism node 1', false);
  assert.equal(sessions[1].mount, row);
  assert.deepEqual(sessions[1].presentationHint, { occurrence: 'row', nodeId: 'a' });
  assert.equal(row.children[0].focused, true);
});

test('matrix inline edit focus returns to the saved row or column occurrence after rerender', async () => {
  const popup = read('popup.js');
  const { createFigureWorkspaceInlineEditController } =
    loadFigureWorkspaceLifecycleHelpers(popup);
  const selectTarget = loadFigureWorkspaceEditTargetSelector(popup);
  const descriptor = { scope: 'mechanism-node', nodeId: 'a', field: 'label' };
  const key = JSON.stringify(descriptor);
  let candidates = [];
  let focused = '';
  let revision = 1;
  const controller = createFigureWorkspaceInlineEditController({
    captureContext: () => ({}), isContextCurrent: () => true,
    isMountAvailable: () => true, getExpectedRevision: () => revision,
    getCurrentRevision: () => revision,
    persist: async () => ({ success: true, draft: { revision: ++revision } }),
    integrate() {
      candidates = [
        { id: 'column-new', dataset: { figureEditPath: key,
          figureEditOccurrence: 'column', mechanismNodeId: 'a' } },
        { id: 'row-new', dataset: { figureEditPath: key,
          figureEditOccurrence: 'row', mechanismNodeId: 'a' } }
      ];
    },
    focus(_descriptor, hint) {
      focused = selectTarget(candidates, key, hint)?.id || '';
    }
  });
  await controller.begin(descriptor, 'old', {
    mount: {}, presentationHint: { occurrence: 'row', nodeId: 'a' }
  });
  controller.update('new');
  assert.equal((await controller.save('shortcut')).status, 'saved');
  assert.equal(focused, 'row-new');

  focused = '';
  await controller.begin(descriptor, 'new', {
    mount: {}, presentationHint: { occurrence: 'column', nodeId: 'a' }
  });
  assert.equal((await controller.save('blur')).status, 'unchanged');
  assert.equal(focused, 'column-new');

  assert.equal(selectTarget(candidates, key, {
    occurrence: 'row', nodeId: 'missing'
  }).id, 'column-new');
});

test('matrix node deletion latches both axis controls and dispatches once', async () => {
  const createCoordinator = loadMechanismNodeRemovalCoordinator(read('popup.js'));
  const pending = [];
  const removals = [];
  let release;
  const deferred = new Promise(resolve => { release = resolve; });
  const coordinator = createCoordinator({
    setPending(nodeId, value) { pending.push([nodeId, value]); },
    async remove(nodeId) { removals.push(nodeId); await deferred; return { success: true }; }
  });
  const first = coordinator.remove('a');
  const duplicate = await coordinator.remove('a');
  assert.deepEqual(duplicate, { success: false, pending: true });
  assert.deepEqual(removals, ['a']);
  assert.deepEqual(pending, [['a', true]]);
  release();
  assert.deepEqual(await first, { success: true });
  assert.deepEqual(pending, [['a', true], ['a', false]]);
  assert.equal(coordinator.isPending('a'), false);
});

test('matrix node controls have themed focus and narrow-label styles', () => {
  const css = read('popup.css');
  assert.match(css, /\.workspace-mechanism-matrix-toolbar\s*\{/);
  assert.match(css, /\.workspace-mechanism-matrix-add-node/);
  assert.match(css, /\.workspace-mechanism-matrix-remove-node/);
  assert.match(css, /\.workspace-mechanism-matrix-node-label[^}]*text-overflow:\s*ellipsis/s);
  assert.match(css, /workspace-mechanism-matrix-(?:add|remove)-node[^}]*:focus-visible/s);
  assert.match(css, /@media\s*\(max-width:\s*520px\)[\s\S]*workspace-mechanism-matrix-toolbar/);
});

test('mechanism matrix separates direction help from the bottom evidence legend', () => {
  const renderer = functionBody(
    read('popup.js'), 'renderMechanismEvidenceMatrix', 'bindMechanismMermaidInteractions'
  );
  const directionHelp = '列为上游节点，行为下游节点。';
  assert.match(renderer, new RegExp(directionHelp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(renderer, /格内列出支持该联系/);
  assert.doesNotMatch(renderer, /红色为充分性证据|蓝色为必要性证据|黑色为其他或相关性证据/);
  assert.match(renderer, /workspace-mechanism-matrix-legend/);
  assert.match(renderer, /\['other', '其他或相关性证据'\]/);
  assert.match(renderer, /\['sufficiency', '充分性证据'\]/);
  assert.match(renderer, /\['necessity', '必要性证据'\]/);
  assert.match(renderer, /workspace-mechanism-matrix-legend-item is-\$\{className\}/);
  assert.match(renderer, /wrap\.append\(scroll, editorHost\)/);
  assert.match(renderer, /wrap\.appendChild\(legend\)/);
});

test('mechanism matrix normalizes only bounded canonical non-linked Panel dispositions', () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(
    popup, 'normalizeMechanismPanelDispositions'
  );
  const normalize = new Function(
    `${source}\nreturn normalizeMechanismPanelDispositions;`
  )();
  const alias = '  用户 Alias α  ';
  const chain = {
    panelAliases: {
      'figure-1:A': { value: alias },
      'figure-1:B': { value: 'Excluded alias' }
    },
    panelDispositions: [
      { panelKey: 'figure-1:A', status: 'unlinked', statusReason: 'No safe edge' },
      { panelKey: 'figure-1:B', status: 'excluded', reason: 'Control only' },
      { panelKey: 'figure-1:C', status: 'ambiguous', statusReason: 'Two candidates' },
      { panelKey: 'figure-1:D', status: 'linked', edgeIds: ['edge-1'] },
      { panelKey: 'figure-1:E', status: 'invented', statusReason: 'must disappear' },
      { panelKey: 'figure-1:F', status: 'ambiguous',
        candidatePanelKeys: ['figure-1:A', 'figure-1:B'] },
      { panelKey: 'unknown:X', status: 'unlinked', statusReason: 'must disappear' }
    ]
  };
  const options = ['A', 'B', 'C', 'D', 'E', 'F'].map(panelId => ({
    figureId: 'figure-1', panelId, displayId: `1${panelId}`
  }));
  assert.deepEqual(normalize(chain, options), [
    { panelKey: 'figure-1:A', originalDisplayId: '1A', displayAlias: alias,
      displayName: alias, status: 'unlinked', statusReason: 'No safe edge' },
    { panelKey: 'figure-1:B', originalDisplayId: '1B', displayAlias: 'Excluded alias',
      displayName: 'Excluded alias', status: 'excluded', statusReason: 'Control only' },
    { panelKey: 'figure-1:C', originalDisplayId: '1C', displayAlias: '',
      displayName: '1C', status: 'ambiguous', statusReason: 'Two candidates' },
    { panelKey: 'figure-1:F', originalDisplayId: '1F', displayAlias: '',
      displayName: '1F', status: 'ambiguous', statusReason: '',
      candidateDisplayNames: [alias, 'Excluded alias'] }
  ]);

  const getter = {};
  Object.defineProperty(getter, 'panelKey', { get() { throw new Error('getter ran'); } });
  const inherited = Object.create({ panelKey: 'figure-1:A', status: 'unlinked' });
  inherited.statusReason = 'prototype data must not render';
  const oversized = Array.from({ length: 513 }, () => ({
    panelKey: 'figure-1:A', status: 'unlinked', statusReason: 'overflow'
  }));
  assert.deepEqual(normalize({ panelDispositions: [getter, inherited] }, options), []);
  assert.deepEqual(normalize({ panelDispositions: oversized }, options), []);
  const revokedObject = Proxy.revocable({}, {});
  revokedObject.revoke();
  const revokedArray = Proxy.revocable([], {});
  revokedArray.revoke();
  assert.doesNotThrow(() => normalize({ panelDispositions: [revokedObject.proxy] }, options));
  assert.deepEqual(normalize({ panelDispositions: revokedArray.proxy }, options), []);
  assert.deepEqual(normalize(chain, options, undefined, new Set([
    'figure-1:B', 'figure-1:D'
  ])), [
    { panelKey: 'figure-1:A', originalDisplayId: '1A', displayAlias: alias,
      displayName: alias, status: 'unlinked', statusReason: 'No safe edge' },
    { panelKey: 'figure-1:C', originalDisplayId: '1C', displayAlias: '',
      displayName: '1C', status: 'ambiguous', statusReason: 'Two candidates' },
    { panelKey: 'figure-1:F', originalDisplayId: '1F', displayAlias: '',
      displayName: '1F', status: 'ambiguous', statusReason: '',
      candidateDisplayNames: [alias, 'Excluded alias'] }
  ], 'live chips suppress stale non-linked dispositions and keep linked chips table-only');
  assert.deepEqual(normalize(chain, options, undefined, new Set()), [
    { panelKey: 'figure-1:A', originalDisplayId: '1A', displayAlias: alias,
      displayName: alias, status: 'unlinked', statusReason: 'No safe edge' },
    { panelKey: 'figure-1:B', originalDisplayId: '1B', displayAlias: 'Excluded alias',
      displayName: 'Excluded alias', status: 'excluded', statusReason: 'Control only' },
    { panelKey: 'figure-1:C', originalDisplayId: '1C', displayAlias: '',
      displayName: '1C', status: 'ambiguous', statusReason: 'Two candidates' },
    { panelKey: 'figure-1:D', originalDisplayId: '1D', displayAlias: '',
      displayName: '1D', status: 'unlinked', statusReason: '',
      missingLiveLink: true },
    { panelKey: 'figure-1:F', originalDisplayId: '1F', displayAlias: '',
      displayName: '1F', status: 'ambiguous', statusReason: '',
      candidateDisplayNames: [alias, 'Excluded alias'] }
  ], 'a canonical linked Panel removed from the live table remains visibly auditable');
});

test('zero-node mechanism fallback still mounts every non-linked disposition audit row', () => {
  const popup = read('popup.js');
  const auditFactory = executableFunctionSource(
    popup, 'createMechanismPanelDispositionAudit'
  );
  assert.match(auditFactory, /workspace-mechanism-panel-disposition-audit/);
  const workspace = functionBody(
    popup, 'renderMechanismChainWorkspace', 'function scheduleMechanismNetworkRender'
  );
  const emptyBranch = workspace.slice(
    workspace.indexOf('if (!nodes.length)'), workspace.indexOf('renderMechanismNetwork')
  );
  assert.match(emptyBranch, /createMechanismPanelDispositionAudit/);
  assert.match(emptyBranch, /panelDispositions/);
});

test('mechanism matrix renders non-linked Panel audit rows outside linked evidence cells', async () => {
  const { chromium } = require('playwright');
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].find(candidate => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {})
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="host"></main>');
    const popup = read('popup.js');
    const normalizerSource = executableFunctionSource(
      popup, 'normalizeMechanismPanelDispositions'
    );
    const auditSource = executableFunctionSource(
      popup, 'createMechanismPanelDispositionAudit'
    );
    const rendererSource = functionBody(
      popup, 'renderMechanismEvidenceMatrix', 'bindMechanismMermaidInteractions'
    );
    const formatterSource = executableFunctionSource(
      popup, 'formatMechanismMatrixUiText'
    );
    await page.evaluate(({
      normalizerSource, auditSource, rendererSource, formatterSource
    }) => {
      window.SciLLM = { createMechanismEvidenceMatrix: () => ({
        nodes: [{ id: 'a', label: 'Source' }],
        cells: [{ from: 'a', to: 'a', edgeIds: ['edge'], evidence: [{
          panelKey: 'figure-1:A', figureId: 'figure-1', panelId: 'A',
          displayName: 'Linked alias',
          evidenceClass: 'other', ownerEdgeId: 'edge', edgeId: 'edge', evidenceIndex: 0
        }] }]
      }) };
      window.mechanismMatrixNodeAxisModel = matrix => ({
        columns: matrix.nodes, rows: matrix.nodes
      });
      window.createWorkspaceElement = (tag, className = '', text = '') => {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        return element;
      };
      window.t = value => ({
        '未关联 Panel 审计': 'Non-linked Panel audit',
        '未关联': 'Unlinked', '已排除': 'Excluded', '存在歧义': 'Ambiguous',
        '候选 Panel': 'Candidate Panels'
      })[value] || value;
      window.interfaceLanguage = () => 'en';
      window.appendMechanismMatrixNodeHeader = (parent, node) => {
        parent.textContent = node.label;
      };
      window.addMechanismNodeAfter = () => {};
      window.openMechanismMatrixCellEditor = () => {};
      window.eval(`${normalizerSource}\n${auditSource}\n${formatterSource}\n` +
        `${rendererSource}\n` +
        'window.renderMatrix = renderMechanismEvidenceMatrix;');
      const chain = {
        panelAliases: { 'figure-1:B': { value: 'Alias B 原样' } },
        panelDispositions: [
          { panelKey: 'figure-1:A', status: 'linked', edgeIds: ['edge'] },
          { panelKey: 'figure-1:B', status: 'unlinked', reason: 'No bounded edge' },
          { panelKey: 'figure-1:C', status: 'excluded', reason: 'Control only' },
          { panelKey: 'figure-1:D', status: 'ambiguous', reason: 'Could map twice' },
          { panelKey: 'figure-1:F', status: 'ambiguous',
            candidatePanelKeys: ['figure-1:A', 'figure-1:B'] }
        ]
      };
      const evidenceOptions = ['A', 'B', 'C', 'D', 'F'].map(panelId => ({
        figureId: 'figure-1', panelId, displayId: `1${panelId}`
      }));
      window.renderMatrix(chain, document.getElementById('host'), { evidenceOptions });
    }, { normalizerSource, auditSource, rendererSource, formatterSource });
    const audit = page.locator('.workspace-mechanism-panel-disposition-audit');
    assert.equal(await audit.count(), 1);
    assert.equal(await audit.getAttribute('aria-label'), 'Non-linked Panel audit');
    assert.deepEqual(await audit.locator('[data-panel-disposition-key]').evaluateAll(rows =>
      rows.map(row => [row.dataset.panelDispositionKey,
        row.dataset.panelDispositionStatus, row.textContent.trim()])), [
      ['figure-1:B', 'unlinked', 'Alias B 原样UnlinkedNo bounded edge'],
      ['figure-1:C', 'excluded', '1CExcludedControl only'],
      ['figure-1:D', 'ambiguous', '1DAmbiguousCould map twice'],
      ['figure-1:F', 'ambiguous', '1FAmbiguousCandidate Panels: 1A, Alias B 原样']
    ]);
    assert.equal(await audit.getByText('Linked alias').count(), 0);
    assert.equal(await page.evaluate(() => {
      const auditNode = document.querySelector('.workspace-mechanism-panel-disposition-audit');
      const legendNode = document.querySelector('.workspace-mechanism-matrix-legend');
      return Boolean(auditNode.compareDocumentPosition(legendNode) &
        Node.DOCUMENT_POSITION_FOLLOWING);
    }), true, 'the evidence legend must remain at the bottom after the audit region');
    assert.equal(await page.locator('td .workspace-mechanism-matrix-evidence', {
      hasText: 'Linked alias'
    }).count(), 1);
    assert.equal(await page.locator(
      'td [data-panel-disposition-key], .workspace-mechanism-panel-disposition-audit .workspace-mechanism-matrix-evidence'
    ).count(), 0);
  } finally {
    await browser.close();
  }
});

test('Task 9 real large-matrix render path exposes coded chips and reachable audit areas', async () => {
  const { chromium } = require('playwright');
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].find(candidate => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {})
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    await page.setContent('<main id="host"></main>');
    await page.addStyleTag({ content: read('popup.css') });
    const popup = read('popup.js');
    const rendererSource = functionBody(
      popup, 'renderMechanismEvidenceMatrix', 'bindMechanismMermaidInteractions'
    );
    const formatterSource = executableFunctionSource(
      popup, 'formatMechanismMatrixUiText'
    );
    await page.evaluate(({ rendererSource, formatterSource }) => {
      const nodes = [
        { id: 'a', label: 'Source' },
        { id: 'b', label: 'Target' },
        ...Array.from({ length: 9 }, (_, index) => ({
          id: `middle-${index + 1}`, label: `Intermediate ${index + 1}`
        })),
        { id: 'isolated', label: 'Observed state' }
      ];
      const empty = (from, to) => ({
        from, to, relationIds: [], evidence: [], lineStyle: 'none',
        contested: false, positiveEdge: false
      });
      const cells = nodes.flatMap(row => nodes.map(column => empty(row.id, column.id)));
      Object.assign(cells.find(cell => cell.from === 'a' && cell.to === 'b'), {
        relationIds: ['causal', 'association'], lineStyle: 'solid',
        contested: true, positiveEdge: true,
        evidence: [
          { claimId: 'claim-s', panelKey: 'figure-1:A', displayName: '1A',
            evidenceClass: 'sufficiency', code: 'S', claimCode: 'S',
            placementKind: 'relation', mappingStatus: 'unmapped', role: 'supporting' },
          { claimId: 'claim-c', panelKey: 'figure-1:B', displayName: '1B',
            evidenceClass: 'other', code: 'C', claimCode: 'C',
            placementKind: 'relation', mappingStatus: 'unmapped', role: 'counterclaim' },
          { claimId: 'claim-a', panelKey: 'figure-1:C', displayName: '1C',
            evidenceClass: 'other', code: 'A', claimCode: 'A',
            placementKind: 'relation', mappingStatus: 'unmapped', role: 'supporting' }
        ]
      });
      Object.assign(cells.find(cell => cell.from === 'b' && cell.to === 'a'), {
        relationIds: ['association-only'], lineStyle: 'dashed', positiveEdge: true,
        evidence: [{
          claimId: 'claim-association', panelKey: 'figure-1:D',
          displayName: '1D', evidenceClass: 'other', code: 'A', claimCode: 'A',
          placementKind: 'relation', mappingStatus: 'unmapped', role: 'supporting'
        }]
      });
      Object.assign(cells.find(cell =>
        cell.from === 'isolated' && cell.to === 'isolated'), {
        evidence: [{
          claimId: 'claim-o', panelKey: 'figure-1:E', displayName: '1E',
          evidenceClass: 'other', code: 'O', claimCode: 'O',
          placementKind: 'node_only', mappingStatus: 'node_only', role: 'supporting'
        }]
      });
      window.SciLLM = {
        createMechanismAuditEvidenceView: () => ({ nodes, cells }),
        createMechanismEvidenceMatrix: () => { throw new Error('legacy path used'); }
      };
      window.mechanismMatrixNodeAxisModel = matrix => ({
        columns: matrix.nodes, rows: matrix.nodes
      });
      window.createWorkspaceElement = (tag, className = '', text = '') => {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        return element;
      };
      window.t = value => value;
      window.interfaceLanguage = () => 'en';
      window.appendMechanismMatrixNodeHeader = (parent, node) => {
        parent.textContent = node.label;
      };
      window.addMechanismNodeAfter = () => {};
      window.openMechanismMatrixCellEditor = () => {};
      window.createMechanismPanelDispositionAudit = () => null;
      window.eval(`${formatterSource}\n${rendererSource}\n` +
        'window.renderTask9Matrix = renderMechanismEvidenceMatrix;');
      window.renderTask9Matrix({}, document.getElementById('host'), {
        audit: {
          version: 'mechanism-audit-view-v1', nodes, relations: [], placements: [],
          disconnectedEvidence: [{
            nodeId: 'isolated', label: 'Observed state', codes: ['O'], claimCount: 1
          }],
          exclusions: [{ panelKey: 'figure-s1:A', reason: 'source_backed_schematic' }]
          , unresolvedEvidence: [{
            claimId: 'claim-unresolved', panelKey: 'figure-1:U', code: '?',
            reason: 'unsupported_composite_relation'
          }]
        },
        evidenceOptions: [], optionsByIdentity: new Map()
      });
    }, { rendererSource, formatterSource });

    const contested = page.locator(
      'td[data-source-node-id="a"][data-target-node-id="b"]'
    );
    assert.equal(await contested.getAttribute('data-line-style'), 'solid');
    assert.equal(await contested.getAttribute('data-contested'), 'true');
    assert.deepEqual(await contested.locator('[data-evidence-code]').evaluateAll(items =>
      items.map(item => [item.dataset.evidenceCode, item.textContent.trim()])), [
      ['S', '1ANo verified owner relation; view only'],
      ['C', '1BNo verified owner relation; view only'],
      ['A', '1CNo verified owner relation; view only']
    ]);
    assert.equal(await page.locator(
      'td[data-source-node-id="b"][data-target-node-id="a"]'
    ).getAttribute('data-line-style'), 'dashed');
    assert.equal(await page.locator(
      'td[data-source-node-id="isolated"][data-target-node-id="isolated"]'
    ).getAttribute('data-diagonal'), 'true');
    assert.deepEqual(await page.locator(
      '.workspace-mechanism-matrix-legend-item [data-evidence-code]'
    ).evaluateAll(items => items.map(item => item.textContent.trim())), [
      'S', 'N', 'R', 'E', 'I', 'A', 'O', '0', 'C', '?'
    ]);
    assert.equal(await page.locator('.workspace-mechanism-disconnected-audit').count(), 1);
    assert.equal(await page.locator('.workspace-mechanism-exclusion-audit').count(), 1);
    assert.equal(await page.locator('.workspace-mechanism-unresolved-audit').count(), 1);
    assert.match(await page.locator('.workspace-mechanism-unresolved-audit').innerText(),
      /unsupported_composite_relation/u);
    assert.match(await page.locator('.workspace-mechanism-exclusion-audit').innerText(),
      /source_backed_schematic/u);
    const normalLayout = await page.evaluate(() => {
      const scroll = document.querySelector('.workspace-mechanism-matrix-scroll');
      const audit = document.querySelector('.workspace-mechanism-unresolved-audit');
      return {
        horizontalOverflow: scroll.scrollWidth > scroll.clientWidth,
        scrollOverflow: getComputedStyle(scroll).overflow,
        auditOverflow: getComputedStyle(audit).overflow,
        focusableChips: document.querySelectorAll('[data-evidence-code][tabindex="0"]').length,
        staticEvidence: document.querySelectorAll(
          '[data-evidence-code][role="note"]:not([tabindex])'
        ).length
      };
    });
    assert.equal(normalLayout.horizontalOverflow, true);
    assert.match(normalLayout.scrollOverflow, /auto/u);
    assert.match(normalLayout.auditOverflow, /auto/u);
    assert.equal(normalLayout.focusableChips, 0);
    assert.ok(normalLayout.staticEvidence >= 5);
    await page.setViewportSize({ width: 360, height: 640 });
    await page.locator('.workspace-mechanism-exclusion-audit').scrollIntoViewIfNeeded();
    const box = await page.locator('.workspace-mechanism-exclusion-audit').boundingBox();
    assert.ok(box && box.y < 640 && box.y + box.height > 0,
      'large-matrix audit controls remain reachable on a narrow screen');
  } finally {
    await browser.close();
  }
});

test('audited Mermaid bindings follow rendered DTO order and skip ambiguous aggregate edges', () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(popup, 'createMechanismAuditInteractionModel');
  const createMechanismAuditInteractionModel = new Function(
    `${source}\nreturn createMechanismAuditInteractionModel;`
  )();
  const graph = {
    nodes: [{ id: 'a', label: 'Audited A' }, { id: 'b', label: 'Audited B' }],
    edges: [{ id: 'graph-edge-1', from: 'a', to: 'b',
      label: 'associated with', polarity: 'neutral' }]
  };
  const chain = {
    nodes: [{ id: 'disconnected' }, { id: 'a' }, { id: 'b' }],
    edges: [
      { id: 'ab-context-1', from: 'a', to: 'b', polarity: 'positive',
        label: { value: 'activates' }, panelEvidence: [{}, {}] },
      { id: 'ab-context-2', from: 'a', to: 'b' }
    ]
  };
  const ambiguousModel = createMechanismAuditInteractionModel(graph, chain);
  assert.deepEqual(ambiguousModel, {
    nodes: [{ id: 'a', label: 'Audited A' }, { id: 'b', label: 'Audited B' }],
    edges: [{ id: '', from: 'a', to: 'b', label: 'associated with',
      polarity: 'neutral', evidenceCount: 0 }]
  });
  assert.equal(ambiguousModel.edges[0].labelSource, 'generated');
  assert.equal(Object.keys(ambiguousModel.edges[0]).includes('labelSource'), false,
    'view provenance stays explicit without changing the interaction DTO contract');
  chain.edges.pop();
  assert.deepEqual(createMechanismAuditInteractionModel(graph, chain).edges, [{
    id: 'ab-context-1', from: 'a', to: 'b', label: 'associated with',
    polarity: 'neutral', evidenceCount: 2
  }]);
  const renderer = functionBody(popup, 'renderMechanismNetwork', 'renderMechanismChainWorkspace');
  assert.match(renderer, /createMechanismAuditInteractionModel\(auditGraph, chain\)/u);
  assert.match(renderer, /bindMechanismMermaidInteractions\(diagram, interactionModel\)/u);
  assert.match(renderer, /generatedRelationLabels:\s*true/u);
});

test('a node-only audit renders an intentional graph empty state without invoking Mermaid', () => {
  const renderer = functionBody(
    read('popup.js'), 'renderMechanismNetwork', 'renderMechanismChainWorkspace'
  );
  assert.match(renderer, /auditGraph && !auditGraph\.edges\.length/u);
  assert.match(renderer, /diagram\.classList\.remove\('mermaid'\)/u);
  assert.match(renderer, /当前仅有节点证据；未生成关系边/u);
  assert.match(renderer, /if \(auditGraph && !auditGraph\.edges\.length\) return/u);
});

test('matrix chips expose only their display name while class stays accessible', () => {
  const renderer = functionBody(
    read('popup.js'), 'renderMechanismEvidenceMatrix', 'bindMechanismMermaidInteractions'
  );
  assert.match(renderer, /chip\.textContent\s*=\s*item\.displayName/);
  assert.match(renderer, /chip\.title\s*=\s*formatMechanismMatrixUiText\('evidence'/);
  assert.match(renderer, /chip\.setAttribute\('aria-label', chip\.title\)/);
});

test('audited unique evidence opens an existing-only editor while legacy keeps add', async () => {
  const popup = read('popup.js');
  const renderer = functionBody(
    popup, 'renderMechanismEvidenceMatrix', 'bindMechanismMermaidInteractions'
  );
  assert.match(renderer,
    /createMechanismAuditEvidenceView\(chain,\s*options\.audit,\s*evidenceOptions\)/u);

  const { chromium } = require('playwright');
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].find(candidate => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {})
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="host"></main>');
    await page.addScriptTag({
      path: path.join(__dirname, '..', 'core', 'mechanism-network.js')
    });
    const formatterSource = executableFunctionSource(
      popup, 'formatMechanismMatrixUiText'
    );
    const relationFormatterSource = executableFunctionSource(
      popup, 'formatMechanismRelationUiText'
    );
    const editItemSource = executableFunctionSource(
      popup, 'mechanismMatrixEvidenceEditItem'
    );
    const controllerSource = executableFunctionSource(
      popup, 'createMechanismMatrixCellEditorController'
    );
    const resolverSource = executableFunctionSource(
      popup, 'resolveCurrentMechanismEvidence'
    );
    const editorSource = functionBody(
      popup, 'openMechanismMatrixCellEditor', 'renderMechanismEvidenceMatrix'
    );
    await page.evaluate(({
      renderer, formatterSource, relationFormatterSource, editItemSource, controllerSource,
      resolverSource, editorSource
    }) => {
      const fillerPanels = Array.from({ length: 62 }, (_, index) => ({
        figureId: 'figure-1', panelId: `F${index}`, value: `1F${index}`,
        evidenceClass: 'other'
      }));
      window.auditChain = {
        nodes: [
          { id: 'a', label: { value: 'Source' } },
          { id: 'b', label: { value: 'Target' } },
          { id: 'observed', label: { value: 'Observed state' } }
        ],
        panelAliases: {
          'figure-1:A': { value: 'Reviewed Panel alias' }
        },
        edges: [{
          id: 'relation-ab', from: 'a', to: 'b', polarity: 'negative',
          label: { value: 'inhibits' },
          panelEvidence: [
            { figureId: 'figure-1', panelId: 'A', value: '1A',
              evidenceClass: 'necessity' },
            ...fillerPanels,
            { figureId: 'figure-1', panelId: 'D', value: '1D',
              evidenceClass: 'sufficiency' }
          ]
        }, {
          id: 'relation-ab-2', from: 'a', to: 'b', polarity: 'neutral',
          label: { value: 'increases', humanReviewed: true },
          panelEvidence: [
            { figureId: 'figure-1', panelId: 'B', value: '1B',
              evidenceClass: 'other' },
            { figureId: 'figure-1', panelId: 'E', value: '1E',
              evidenceClass: 'sufficiency' }
          ]
        }, {
          id: 'relation-ab-3', from: 'a', to: 'b', polarity: 'neutral',
          panelEvidence: [{ figureId: 'figure-1', panelId: 'B', value: '1B',
            evidenceClass: 'other' }]
        }]
      };
      const relationEvidence = (claimId, panelKey, code) => ({
        claimId, panelKey, code, role: 'supporting'
      });
      const fillerRelationEvidence = fillerPanels.map((panel, index) =>
        relationEvidence(`claim-f${index}`, `figure-1:${panel.panelId}`, 'O'));
      window.auditView = {
        version: 'mechanism-audit-view-v1', status: 'complete',
        nodes: [
          { id: 'a', label: 'Source', nodeType: 'entity' },
          { id: 'b', label: 'Target', nodeType: 'entity' },
          { id: 'observed', label: 'Observed state', nodeType: 'state' }
        ],
        relations: [{
          id: 'relation-ab', from: 'a', to: 'b', relationKind: 'causal',
          renderable: true, contested: false, polarity: 'decreases',
          evidence: [
            relationEvidence('claim-n', 'figure-1:A', 'N'),
            ...fillerRelationEvidence,
            relationEvidence('claim-s', 'figure-1:D', 'S')
          ]
        }, {
          id: 'relation-ab-2', from: 'a', to: 'b', relationKind: 'correlative',
          renderable: true, contested: true, polarity: 'increases',
          evidence: [
            relationEvidence('claim-a', 'figure-1:B', 'A'),
            relationEvidence('claim-e', 'figure-1:E', 'S')
          ]
        }, {
          id: 'relation-ab-3', from: 'a', to: 'b', relationKind: 'correlative',
          renderable: true, contested: false, polarity: 'unknown',
          evidence: [relationEvidence('claim-a', 'figure-1:B', 'A')]
        }],
        placements: [{
          claimId: 'claim-n', panelKey: 'figure-1:A', from: 'a', to: 'b',
          code: 'N', role: 'supporting', relationIds: ['relation-ab']
        }, {
          claimId: 'claim-a', panelKey: 'figure-1:B', from: 'a', to: 'b',
          code: 'A', role: 'supporting',
          relationIds: ['relation-ab-2', 'relation-ab-3']
        }, ...fillerPanels.map((panel, index) => ({
          claimId: `claim-f${index}`, panelKey: `figure-1:${panel.panelId}`,
          from: 'a', to: 'b', code: 'O', role: 'supporting',
          relationIds: ['relation-ab']
        })), {
          claimId: 'claim-s', panelKey: 'figure-1:D', from: 'a', to: 'b',
          code: 'S', role: 'supporting', relationIds: ['relation-ab']
        }, {
          claimId: 'claim-e', panelKey: 'figure-1:E', from: 'a', to: 'b',
          code: 'S', role: 'supporting', relationIds: ['relation-ab-2']
        }, {
          claimId: 'claim-o', panelKey: 'figure-1:C',
          from: 'observed', to: 'observed', code: 'O', role: 'supporting',
          relationIds: []
        }],
        disconnectedEvidence: [{
          nodeId: 'observed', label: 'Observed state', codes: ['O'], claimCount: 1
        }],
        exclusions: []
      };
      window.auditOptions = [
        { figureId: 'figure-1', panelId: 'A', displayId: '1A',
          evidenceClass: 'necessity' },
        { figureId: 'figure-1', panelId: 'B', displayId: '1B', evidenceClass: 'other' },
        { figureId: 'figure-1', panelId: 'C', displayId: '1C', evidenceClass: 'other' },
        { figureId: 'figure-1', panelId: 'E', displayId: '1E',
          evidenceClass: 'sufficiency' },
        ...fillerPanels.map(panel => ({
          figureId: panel.figureId, panelId: panel.panelId,
          displayId: panel.value, evidenceClass: panel.evidenceClass
        })),
        { figureId: 'figure-1', panelId: 'D', displayId: 'Ｆig １D',
          evidenceClass: 'sufficiency' }
      ];
      window.mechanismMatrixNodeAxisModel = matrix => ({
        columns: matrix.nodes, rows: matrix.nodes
      });
      window.createWorkspaceElement = (tag, className = '', text = '') => {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        return element;
      };
      window.t = value => value;
      window.testInterfaceLanguage = 'en';
      window.interfaceLanguage = () => window.testInterfaceLanguage;
      window.appendMechanismMatrixNodeHeader = (parent, node) => {
        parent.textContent = node.label;
      };
      window.addMechanismNodeAfter = () => {};
      window.createMechanismPanelDispositionAudit = () => null;
      window.mutations = [];
      window.auditedRerenders = 0;
      window.addOutOfBoundsOrdinalSentinel = false;
      window.capturePanelContext = () => ({ key: 'paper' });
      window.captureFigureWorkspaceEditContext = () => ({ key: 'paper' });
      window.isCurrentFigureWorkspaceEditContext = () => true;
      window.mechanismWorkspaceId = () => 'generated-edge';
      window.mechanismWorkspaceDraft = () => ({ mechanismChain: window.auditChain });
      window.mechanismActionCoordinator = { run: async mutation => {
        window.mutations.push(structuredClone(mutation));
        if (mutation.type === 'set_mechanism_panel_alias') {
          const host = document.getElementById('host');
          host.replaceChildren();
          window.renderAuditedMatrix(window.auditChain, host, {
            audit: window.auditView,
            evidenceOptions: window.auditOptions,
            optionsByIdentity: new Map(window.auditOptions.map(option => [
              `${option.figureId}\u0000${option.panelId}`, option
            ]))
          });
          if (window.addOutOfBoundsOrdinalSentinel) {
            const targetCell = [...host.querySelectorAll(
              'td[data-source-node-id][data-target-node-id]'
            )].find(cell => cell.dataset.sourceNodeId === 'a' &&
              cell.dataset.targetNodeId === 'b');
            const sentinel = document.createElement('button');
            sentinel.className = 'workspace-mechanism-matrix-evidence is-editable';
            sentinel.dataset.auditedEvidenceOrdinal = '1024';
            sentinel.textContent = 'out-of-bounds sentinel';
            targetCell.appendChild(sentinel);
          }
          window.auditedRerenders += 1;
        }
        return { success: true };
      } };
      window.refreshArticleWorkspace = async () => null;
      window.eval(`${relationFormatterSource}\n${formatterSource}\n${controllerSource}\n` +
        `${editItemSource}\n` +
        `${resolverSource}\n${editorSource}\n${renderer}\n` +
        'window.renderAuditedMatrix = renderMechanismEvidenceMatrix;' +
        'window.openRealMechanismMatrixCellEditor = openMechanismMatrixCellEditor;');
      window.renderAuditedMatrix(window.auditChain, document.getElementById('host'), {
        audit: window.auditView,
        evidenceOptions: window.auditOptions,
        optionsByIdentity: new Map(window.auditOptions.map(option => [
          `${option.figureId}\u0000${option.panelId}`, option
        ]))
      });
    }, {
      renderer, formatterSource, relationFormatterSource, editItemSource, controllerSource,
      resolverSource, editorSource
    });

    const exactCorrelative = page.locator(
      '.workspace-mechanism-matrix-evidence.is-editable' +
      '[data-audited-evidence-ordinal="65"]'
    );
    assert.equal(await exactCorrelative.count(), 1);
    const exactCorrelativeBadge = exactCorrelative.locator(
      '.workspace-mechanism-matrix-relation-badge'
    );
    assert.equal(await exactCorrelativeBadge.textContent(),
      'Relation 2 · increases · Correlative relation · Positive / promoting · Contested relation');
    assert.deepEqual(await exactCorrelativeBadge.evaluate(badge => ({
      ownerEdgeId: badge.dataset.ownerEdgeId,
      relationKind: badge.dataset.relationKind,
      polarity: badge.dataset.polarity,
      contested: badge.dataset.contested,
      labelSource: badge.dataset.labelSource
    })), {
      ownerEdgeId: 'relation-ab-2', relationKind: 'correlative',
      polarity: 'increases', contested: 'true', labelSource: 'source'
    });
    assert.match(await exactCorrelative.getAttribute('aria-label'),
      /Relation 2 · increases · Correlative relation · Positive \/ promoting · Contested relation/u);
    assert.match(await exactCorrelative.getAttribute('title'),
      /Relation 2 · increases · Correlative relation · Positive \/ promoting · Contested relation/u);
    await exactCorrelative.click();
    assert.deepEqual(await page.locator(
      '.workspace-mechanism-matrix-cell-evidence.is-selected'
    ).evaluate(item => [item.dataset.ownerEdgeId, item.dataset.evidenceIndex]), [
      'relation-ab-2', '1'
    ], 'the audited descriptor never changes exact editable ownership');
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
      window.testInterfaceLanguage = 'zh-CN';
      const host = document.getElementById('host');
      host.replaceChildren();
      window.renderAuditedMatrix(window.auditChain, host, {
        audit: window.auditView,
        evidenceOptions: window.auditOptions,
        optionsByIdentity: new Map(window.auditOptions.map(option => [
          `${option.figureId}\u0000${option.panelId}`, option
        ]))
      });
    });
    const chineseCorrelative = page.locator(
      '.workspace-mechanism-matrix-evidence.is-editable' +
      '[data-audited-evidence-ordinal="65"]'
    );
    assert.equal(await chineseCorrelative.locator(
      '.workspace-mechanism-matrix-relation-badge'
    ).textContent(), '第 2 条联系 · increases · 相关联系 · 正向/促进 · 争议联系');
    assert.match(await chineseCorrelative.getAttribute('aria-label'), /证据代码：S/u);
    assert.doesNotMatch(await chineseCorrelative.getAttribute('aria-label'), /claim code/iu);
    assert.match(await chineseCorrelative.getAttribute('title'),
      /第 2 条联系 · increases · 相关联系 · 正向\/促进 · 争议联系/u);

    await page.evaluate(() => {
      window.testInterfaceLanguage = 'en';
      const host = document.getElementById('host');
      host.replaceChildren();
      window.renderAuditedMatrix(window.auditChain, host, {
        audit: window.auditView,
        evidenceOptions: window.auditOptions,
        optionsByIdentity: new Map(window.auditOptions.map(option => [
          `${option.figureId}\u0000${option.panelId}`, option
        ]))
      });
    });

    const unique = page.locator(
      '.workspace-mechanism-matrix-evidence.is-editable' +
      '[data-audited-evidence-ordinal="64"]'
    );
    assert.equal(await unique.count(), 1);
    assert.equal(await unique.textContent(),
      'Ｆig １DRelation 1 · inhibits · Causal relation · Negative / inhibitory');
    assert.match(await unique.getAttribute('aria-label'), /Ｆig １D.*S/u);
    assert.match(await unique.getAttribute('aria-label'), /Relation 1 · inhibits/u);
    assert.match(await unique.getAttribute('title'), /Relation 1 · inhibits/u);
    assert.equal(await page.locator(
      '.workspace-mechanism-matrix-evidence.is-editable'
    ).first().textContent(),
    'Reviewed Panel aliasRelation 1 · inhibits · Causal relation · Negative / inhibitory');
    const staticEvidence = page.locator(
      '.workspace-mechanism-matrix-evidence.is-view-only' +
      '[data-audited-evidence-ordinal="1"]'
    );
    assert.equal(await staticEvidence.getAttribute('tabindex'), null);
    assert.equal(await staticEvidence.getAttribute('role'), 'note');
    assert.equal(await staticEvidence.locator(
      '.workspace-mechanism-matrix-relation-badge'
    ).count(), 0, 'an aggregate audited placement never acquires an editable owner badge');
    await page.locator(
      '.workspace-mechanism-matrix-evidence.is-editable' +
      '[data-audited-evidence-ordinal="0"]'
    ).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(
      () => document.activeElement?.dataset?.auditedEvidenceOrdinal || ''
    ), '2', 'Tab skips static audited evidence without hiding its accessible label');
    await unique.click();
    const auditedEditor = page.locator('.workspace-mechanism-matrix-cell-editor');
    assert.equal(await auditedEditor.count(), 1);
    assert.equal(await auditedEditor.locator('.workspace-mechanism-matrix-cell-add').count(), 0);
    assert.equal(await auditedEditor.locator('.workspace-mechanism-matrix-cell-panel').count(), 0);
    assert.equal(await auditedEditor.locator('.workspace-mechanism-matrix-cell-owner-edge').count(), 0);
    assert.equal(await auditedEditor.locator('.workspace-mechanism-matrix-cell-polarity').count(), 0);
    assert.equal(await auditedEditor.locator('.workspace-mechanism-matrix-cell-evidence').count(), 1);
    const selected = auditedEditor.locator(
      '.workspace-mechanism-matrix-cell-evidence.is-selected'
    );
    assert.equal(await selected.getAttribute('data-owner-edge-id'), 'relation-ab');
    assert.equal(await selected.getAttribute('data-evidence-index'), '63');
    assert.deepEqual(await auditedEditor.locator(
      '.workspace-mechanism-matrix-evidence-identity [data-mechanism-identity]'
    ).evaluateAll(items => items.map(item => [
      item.dataset.mechanismIdentity, item.textContent.trim()
    ])), [
      ['original-display-id', 'Original display IDＦig １D'],
      ['figure-id', 'Figure IDfigure-1'],
      ['panel-id', 'Panel IDD'],
      ['owner-relation', 'Owner relationRelation 1 (Negative / inhibitory) · inhibits · relation-ab']
    ]);
    assert.equal(await selected.locator('.workspace-mechanism-matrix-cell-alias').count(), 1);
    assert.equal(await selected.locator('.workspace-mechanism-matrix-cell-class').count(), 1);
    assert.equal(await selected.locator('.workspace-mechanism-matrix-cell-replacement').count(), 1);
    assert.equal(await selected.locator('.workspace-mechanism-matrix-cell-remove').count(), 1);
    await selected.locator('.workspace-mechanism-matrix-cell-class')
      .selectOption('necessity');
    await page.waitForFunction(() => window.mutations.length === 1);
    await selected.locator('.workspace-mechanism-matrix-cell-replacement')
      .selectOption({ label: '1B' });
    await page.waitForFunction(() => window.mutations.length === 2);
    await selected.locator('.workspace-mechanism-matrix-cell-remove').click();
    await page.waitForFunction(() => window.mutations.length === 3);
    await selected.locator('.workspace-mechanism-matrix-cell-alias')
      .fill('Updated audited alias');
    await selected.getByRole('button', { name: '保存名称' }).click();
    await page.waitForFunction(() => window.mutations.length === 4);
    await page.waitForFunction(() => window.auditedRerenders === 1);
    assert.deepEqual(await page.evaluate(() => window.mutations.map(mutation => mutation.type)), [
      'update_mechanism_edge_evidence', 'update_mechanism_edge_evidence',
      'remove_mechanism_edge_evidence', 'set_mechanism_panel_alias'
    ]);
    assert.equal(await page.evaluate(() => window.mutations.some(
      mutation => mutation.type === 'upsert_mechanism_cell_evidence'
    )), false);
    assert.deepEqual(await page.evaluate(() => ({
      text: document.activeElement?.textContent || '',
      ordinal: document.activeElement?.dataset?.auditedEvidenceOrdinal || ''
    })), {
      text: 'Ｆig １DRelation 1 · inhibits · Causal relation · Negative / inhibitory',
      ordinal: '64'
    });

    await page.evaluate(() => {
      window.mutations = [];
      window.auditedRerenders = 0;
      window.addOutOfBoundsOrdinalSentinel = true;
      const matrix = window.SciLLM.createMechanismAuditEvidenceView(
        window.auditChain, window.auditView, window.auditOptions
      );
      const source = matrix.nodes.find(node => node.id === 'a');
      const target = matrix.nodes.find(node => node.id === 'b');
      const matrixCell = matrix.cells.find(cell => cell.from === 'a' && cell.to === 'b');
      const selectedEvidence = matrixCell.evidence.find(item => item.claimId === 'claim-s');
      window.openRealMechanismMatrixCellEditor({
        anchor: document.querySelector('[data-evidence-code="S"]'),
        editorHost: document.querySelector('.workspace-mechanism-matrix-editor-host'),
        chain: window.auditChain, source, target, matrixCell,
        evidenceOptions: window.auditOptions,
        optionsByIdentity: new Map(window.auditOptions.map(option => [
          `${option.figureId}\u0000${option.panelId}`, option
        ])),
        selectedEvidence, existingEvidenceOnly: true,
        auditedEvidenceOrdinal: 1024
      });
    });
    const outOfBoundsEditor = page.locator('.workspace-mechanism-matrix-cell-editor');
    await outOfBoundsEditor.locator('.workspace-mechanism-matrix-cell-alias')
      .fill('Out-of-bounds ordinal');
    await outOfBoundsEditor.getByRole('button', { name: '保存名称' }).click();
    await page.waitForFunction(() => window.mutations.length === 1);
    await page.waitForFunction(() => window.auditedRerenders === 1);
    assert.deepEqual(await page.evaluate(() => ({
      ordinal: document.activeElement?.dataset?.auditedEvidenceOrdinal || '',
      editable: document.activeElement?.classList?.contains('is-editable') === true
    })), { ordinal: '', editable: false });

    await page.evaluate(() => {
      window.originalAuditView = window.auditView;
      window.addOutOfBoundsOrdinalSentinel = false;
      window.mutations = [];
      window.auditedRerenders = 0;
      window.auditView = {
        version: 'mechanism-audit-view-v1', status: 'complete',
        nodes: window.originalAuditView.nodes,
        relations: [{
          id: 'relation-ab', from: 'a', to: 'b', relationKind: 'causal',
          renderable: true, contested: false, polarity: 'decreases', evidence: []
        }],
        placements: Array.from({ length: 1024 }, (_, index) => ({
          claimId: `boundary-claim-${index}`, panelKey: 'figure-1:A',
          from: 'a', to: 'b', code: 'N', role: 'supporting',
          relationIds: ['relation-ab']
        })),
        disconnectedEvidence: [], exclusions: []
      };
      const host = document.getElementById('host');
      host.replaceChildren();
      window.renderAuditedMatrix(window.auditChain, host, {
        audit: window.auditView,
        evidenceOptions: window.auditOptions,
        optionsByIdentity: new Map(window.auditOptions.map(option => [
          `${option.figureId}\u0000${option.panelId}`, option
        ]))
      });
    });
    const upperBound = page.locator(
      '.workspace-mechanism-matrix-evidence.is-editable' +
      '[data-audited-evidence-ordinal="1023"]'
    );
    assert.equal(await upperBound.count(), 1);
    await upperBound.click();
    const upperBoundEditor = page.locator('.workspace-mechanism-matrix-cell-editor');
    await upperBoundEditor.locator('.workspace-mechanism-matrix-cell-alias')
      .fill('Upper-bound ordinal');
    await upperBoundEditor.getByRole('button', { name: '保存名称' }).click();
    await page.waitForFunction(() => window.mutations.length === 1);
    await page.waitForFunction(() => window.auditedRerenders === 1);
    assert.equal(await page.evaluate(
      () => document.activeElement?.dataset?.auditedEvidenceOrdinal || ''
    ), '1023');

    await page.evaluate(() => {
      window.auditView = window.originalAuditView;
      window.mutations = [];
      const host = document.getElementById('host');
      host.replaceChildren();
      window.renderAuditedMatrix(window.auditChain, host, {
        audit: window.auditView,
        evidenceOptions: window.auditOptions,
        optionsByIdentity: new Map(window.auditOptions.map(option => [
          `${option.figureId}\u0000${option.panelId}`, option
        ]))
      });
    });

    const viewOnly = page.locator('.workspace-mechanism-matrix-evidence.is-view-only');
    assert.deepEqual(await viewOnly.evaluateAll(items => items.map(item => ({
      text: item.textContent,
      code: item.dataset.evidenceCode,
      kind: item.dataset.placementKind,
      mapping: item.dataset.mappingStatus,
      tag: item.tagName,
      reasonTag: item.querySelector('.workspace-mechanism-matrix-view-reason')?.tagName || '',
      tabindex: item.getAttribute('tabindex'),
      buttons: item.querySelectorAll('button').length,
      aria: item.getAttribute('aria-label')
    }))), [
      { text: '1BMultiple candidate relations; view only', code: 'A',
        kind: 'relation', mapping: 'ambiguous', tag: 'SPAN', reasonTag: 'SPAN',
        tabindex: null, buttons: 0,
        aria: 'Audited Panel evidence 1B; class: Related / other evidence; claim code: A; ambiguous mapping, view only' },
      { text: '1CNode-only evidence with no owner relation; view only', code: 'O',
        kind: 'node_only', mapping: 'node_only', tag: 'SPAN', reasonTag: 'SPAN',
        tabindex: null, buttons: 0,
        aria: 'Audited Panel evidence 1C; class: Related / other evidence; claim code: O; node-only placement, view only' }
    ]);
    const mutationCount = await page.evaluate(() => window.mutations.length);
    await viewOnly.nth(0).click();
    await viewOnly.nth(1).press('Enter');
    assert.equal(await page.evaluate(() => window.mutations.length), mutationCount);
    assert.equal(await page.locator('.workspace-mechanism-matrix-cell-edit').count(), 0,
      'audited cells expose no add/upsert entry point');

    await page.evaluate(() => {
      const createView = window.SciLLM.createMechanismAuditEvidenceView;
      window.SciLLM.createMechanismAuditEvidenceView = (...args) => {
        const view = createView(...args);
        return {
          ...view,
          cells: view.cells.map(cell => ({
            ...cell,
            evidence: cell.evidence.map(item => item.claimId === 'claim-n'
              ? { ...item, evidenceIndex: 63 } : item)
          }))
        };
      };
      document.getElementById('host').replaceChildren();
      window.renderAuditedMatrix(window.auditChain, document.getElementById('host'), {
        audit: window.auditView,
        evidenceOptions: window.auditOptions,
        optionsByIdentity: new Map(window.auditOptions.map(option => [
          `${option.figureId}\u0000${option.panelId}`, option
        ]))
      });
    });
    const staleUnique = page.locator(
      '.workspace-mechanism-matrix-evidence[data-evidence-code="N"]'
    );
    assert.equal(await staleUnique.evaluate(item => item.tagName), 'SPAN');
    assert.equal(await staleUnique.getAttribute('data-mapping-status'), 'unmapped');
    assert.equal(await staleUnique.locator(
      '.workspace-mechanism-matrix-view-reason'
    ).textContent(), 'No verified owner relation; view only');
    assert.equal(await staleUnique.getAttribute('tabindex'), null);
    assert.match(await staleUnique.getAttribute('aria-label'),
      /unresolved mapping, view only/u);
    assert.equal(await page.getByRole('button', { name: /Reviewed Panel alias/u }).count(), 0);

    await page.evaluate(() => {
      window.mutations = [];
      const host = document.getElementById('host');
      host.replaceChildren();
      window.renderAuditedMatrix(window.auditChain, host, {
        evidenceOptions: window.auditOptions,
        optionsByIdentity: new Map(window.auditOptions.map(option => [
          `${option.figureId}\u0000${option.panelId}`, option
        ]))
      });
    });
    await page.locator('.workspace-mechanism-matrix-evidence').first().click();
    const legacyEditor = page.locator('.workspace-mechanism-matrix-cell-editor');
    assert.equal(await legacyEditor.locator('.workspace-mechanism-matrix-cell-add').count(), 1);
    assert.equal(await legacyEditor.locator('.workspace-mechanism-matrix-cell-panel').count(), 1);
    assert.equal(await legacyEditor.locator(
      '.workspace-mechanism-matrix-cell-add .workspace-mechanism-matrix-cell-class'
    ).count(), 1);
    assert.ok(await legacyEditor.locator(
      '.workspace-mechanism-matrix-cell-evidence .workspace-mechanism-matrix-cell-class'
    ).count() > 0, 'legacy retains existing-evidence class controls');
    await legacyEditor.locator('.workspace-mechanism-matrix-cell-panel')
      .selectOption({ label: '1B' });
    await legacyEditor.locator('.workspace-mechanism-matrix-cell-add button').click();
    await page.waitForFunction(() => window.mutations.length === 1);
    assert.equal(await page.evaluate(() => window.mutations[0].type),
      'upsert_mechanism_cell_evidence');
  } finally {
    await browser.close();
  }
});

test('mechanism matrix keeps spacious sticky cells and a rounded portal editor', () => {
  const css = read('popup.css');
  assert.match(css, /\.workspace-mechanism-matrix-scroll\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.workspace-mechanism-matrix th,\s*\.workspace-mechanism-matrix td\s*\{[^}]*min-width:\s*132px[^}]*height:\s*78px[^}]*padding:\s*12px/s);
  assert.match(css, /\.workspace-mechanism-matrix thead th\s*\{[^}]*top:\s*0/s);
  assert.match(css, /\.workspace-mechanism-matrix tbody th\s*\{[^}]*left:\s*0/s);
  assert.match(css, /\.workspace-mechanism-matrix-node-label[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.workspace-mechanism-matrix-node-label[^}]*text-overflow:\s*ellipsis/s);
  assert.match(css, /\.workspace-mechanism-matrix-evidence:focus-visible/);
  assert.match(css, /\.workspace-mechanism-matrix-view-reason\s*\{/);
  assert.match(css, /\.workspace-mechanism-matrix-cell-edit:focus-visible/);
  assert.match(css, /\.workspace-mechanism-matrix-cell-editor\s*\{[^}]*border-radius:/s);
  assert.match(css, /\.workspace-mechanism-matrix-editor-host\s*\{/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)[\s\S]*workspace-mechanism-matrix-scroll/);
});

test('native matrix rows and cells own alternating and hover styles without dead roles', () => {
  const css = read('popup.css');
  assert.doesNotMatch(css, /workspace-mechanism-matrix td\.is-interactive/);
  assert.match(css, /\.workspace-mechanism-matrix tbody tr:nth-child\(even\) td\s*\{/);
  assert.match(css, /\.workspace-mechanism-matrix tbody tr:hover td\s*\{/);
  assert.match(css, /\.workspace-mechanism-matrix tbody td:hover\s*\{/);
  assert.match(css, /\.workspace-mechanism-matrix tbody td:focus-within\s*\{/);
  assert.doesNotMatch(css, /tbody tr(?::nth-child\([^)]*\))?:hover th/);
});

test('native matrix computed styles preserve sticky headers while rows and cells respond', async () => {
  const { chromium } = require('playwright');
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].find(candidate => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {})
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>${read('popup.css')}</style>
      <div class="workspace-mechanism-matrix-scroll">
        <table class="workspace-mechanism-matrix">
          <thead><tr><th id="corner">Target / Source</th><th>Source</th></tr></thead>
          <tbody>
            <tr><th>First</th><td id="first"><button>One</button></td></tr>
            <tr><th id="sticky-row">Second</th><td id="second"><button id="focus">Two</button></td></tr>
          </tbody>
        </table>
      </div>`);
    const before = await page.evaluate(() => ({
      first: getComputedStyle(document.getElementById('first')).backgroundColor,
      second: getComputedStyle(document.getElementById('second')).backgroundColor,
      headerPosition: getComputedStyle(document.getElementById('sticky-row')).position,
      headerBackground: getComputedStyle(document.getElementById('sticky-row')).backgroundColor
    }));
    assert.notEqual(before.first, before.second);
    assert.equal(before.headerPosition, 'sticky');
    await page.locator('#second').hover();
    const hover = await page.evaluate(() => ({
      cellBackground: getComputedStyle(document.getElementById('second')).backgroundColor,
      headerBackground: getComputedStyle(document.getElementById('sticky-row')).backgroundColor,
      cellShadow: getComputedStyle(document.getElementById('second')).boxShadow
    }));
    assert.notEqual(hover.cellBackground, before.second);
    assert.equal(hover.headerBackground, before.headerBackground);
    assert.notEqual(hover.cellShadow, 'none');
    await page.locator('#focus').focus();
    assert.notEqual(
      await page.locator('#second').evaluate(element => getComputedStyle(element).boxShadow),
      'none'
    );
  } finally {
    await browser.close();
  }
});

test('English matrix editor DOM and ARIA contain no untranslated interface CJK', async () => {
  const popup = read('popup.js');
  const formatterSource = executableFunctionSource(popup, 'formatMechanismMatrixUiText');
  const controllerSource = functionBody(
    popup, 'createMechanismMatrixCellEditorController',
    'formatMechanismMatrixUiText'
  );
  const evidenceItemSource = executableFunctionSource(
    popup, 'mechanismMatrixEvidenceEditItem'
  );
  const resolverSource = executableFunctionSource(
    popup, 'resolveCurrentMechanismEvidence'
  );
  const editorSource = functionBody(
    popup, 'openMechanismMatrixCellEditor', 'renderMechanismEvidenceMatrix'
  );
  assert.match(editorSource, /formatMechanismMatrixUiText/);

  const { chromium } = require('playwright');
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].find(candidate => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {})
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="anchor">Edit</button><div id="portal"></div>');
    await page.evaluate((sources) => {
      window.eval(sources.i18n);
      window.interfaceLanguage = () => 'en';
      window.t = value => window.SciLLM.translateInterfaceText(value, 'en');
      window.createWorkspaceElement = (tag, className = '', text = '') => {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        return element;
      };
      window.capturePanelContext = () => ({ key: 'paper' });
      window.captureFigureWorkspaceEditContext = () => ({ key: 'paper' });
      window.isCurrentFigureWorkspaceEditContext = () => true;
      window.mechanismWorkspaceId = () => 'generated';
      window.mechanismActionCoordinator = { run: async () => ({ success: true }) };
      window.refreshArticleWorkspace = async () => null;
      window.liveMechanismChain = { edges: [{
        id: 'edge', from: 'source', to: 'target', polarity: 'positive',
        panelEvidence: [{ figureId: 'figure-1', panelId: 'A' }]
      }] };
      window.mechanismWorkspaceDraft = () => ({
        mechanismChain: window.liveMechanismChain
      });
      window.eval(`${sources.formatter}\n` +
        `${sources.controller}\n${sources.evidenceItem}\n${sources.resolver}\n` +
        `${sources.editor}\nwindow.openEnglishMatrixEditor = openMechanismMatrixCellEditor;`);
      window.openEnglishMatrixEditor({
        anchor: document.getElementById('anchor'),
        editorHost: document.getElementById('portal'),
        chain: window.liveMechanismChain,
        source: { id: 'source', label: '中性' },
        target: { id: 'target', label: '关闭' },
        matrixCell: { edgeIds: ['edge'], evidence: [{
          figureId: 'figure-1', panelId: 'A', displayName: '必要性证据',
          evidenceClass: 'other', ownerEdgeId: 'edge', edgeId: 'edge', evidenceIndex: 0
        }] },
        evidenceOptions: [{
          figureId: 'figure-1', panelId: 'A', displayId: '必要性证据'
        }],
        optionsByIdentity: new Map([['figure-1\u0000A', {
          figureId: 'figure-1', panelId: 'A', displayId: '必要性证据'
        }]])
      });
    }, {
      i18n: read('core/i18n.js'), formatter: formatterSource,
      controller: controllerSource,
      evidenceItem: evidenceItemSource, resolver: resolverSource, editor: editorSource
    });
    const strings = await page.locator('.workspace-mechanism-matrix-cell-editor')
      .evaluate(editor => {
        const values = [editor.innerText];
        editor.querySelectorAll('[aria-label], [title], option').forEach(element => {
          values.push(element.getAttribute('aria-label') || '');
          values.push(element.getAttribute('title') || '');
          if (element.tagName === 'OPTION') values.push(element.textContent || '');
        });
        return values.filter(Boolean);
      });
    const interfaceOnly = strings.join('\n')
      .replaceAll('中性', '').replaceAll('关闭', '').replaceAll('必要性证据', '');
    assert.doesNotMatch(interfaceOnly, /[\u3400-\u9fff]/u);
    assert.match(strings.join('\n'), /Evidence cell: 中性 → 关闭/);
    assert.match(strings.join('\n'), /Panel name: 必要性证据/);
    assert.match(strings.join('\n'), /Replace Panel: 必要性证据/);
    assert.match(strings.join('\n'), /Select Panel evidence/);
    assert.match(strings.join('\n'), /Related \/ other/);
    assert.match(strings.join('\n'), /Positive/);
  } finally {
    await browser.close();
  }
});

test('mechanism evidence colors are exact and readable on white', () => {
  const css = read('popup.css');
  const expected = {
    other: '#27343b', sufficiency: '#c22f2f', necessity: '#2165b5'
  };
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  };
  Object.entries(expected).forEach(([name, color]) => {
    assert.match(css, new RegExp(
      `\\.workspace-mechanism-matrix-(?:evidence|legend-item)\\.is-${name}[^}]*${color}`
    ));
    const contrast = 1.05 / (luminance(color) + .05);
    assert.ok(contrast >= 4.5, `${name} contrast ${contrast.toFixed(2)} must meet WCAG AA`);
  });
});

test('Task 9 evidence codes have non-color labels warning states and reachable audit CSS', () => {
  const css = read('popup.css');
  const popup = read('popup.js');
  for (const codeClass of [
    's', 'n', 'r', 'e', 'i', 'a', 'o', 'zero', 'c', 'unknown'
  ]) {
    assert.match(css, new RegExp(
      `\\.workspace-mechanism-evidence-code\\.is-${codeClass}\\b`
    ));
  }
  assert.match(css,
    /\.workspace-mechanism-evidence-code\.is-s[^}]*#c22f2f/su);
  assert.match(css,
    /\.workspace-mechanism-evidence-code\.is-n[^}]*#2165b5/su);
  assert.match(css,
    /\.workspace-mechanism-evidence-code:is\(\.is-r, \.is-e\)[^}]*#7048a8/su);
  assert.match(css,
    /\.workspace-mechanism-evidence-code\.is-i[^}]*#9a5a00/su);
  assert.match(css,
    /\.workspace-mechanism-evidence-code:is\(\.is-zero, \.is-c, \.is-unknown\)[^}]*border/su);
  assert.match(css, /\.workspace-mechanism-matrix-scroll\s*\{[^}]*overflow:\s*auto/su);
  assert.match(css, /\.workspace-mechanism-audit-region[^}]*overflow/su);
  const renderer = functionBody(
    popup, 'renderMechanismEvidenceMatrix', 'bindMechanismMermaidInteractions'
  );
  assert.match(renderer, /dataEvidenceCode|dataset\.evidenceCode/u);
  assert.match(renderer, /aria-label/u);
  assert.match(renderer, /title/u);
});

test('mechanism Mermaid nodes and edges expose keyboard-accessible atomic selection', () => {
  const popup = read('popup.js');
  const renderer = functionBody(
    popup, 'bindMechanismMermaidInteractions', 'renderMechanismNetwork'
  );
  assert.match(renderer, /querySelectorAll\('g\.node'\)/);
  assert.match(renderer, /querySelectorAll\('g\.edgePath'\)/);
  assert.match(renderer, /querySelectorAll\('path\.flowchart-link'\)/);
  assert.doesNotMatch(renderer, /querySelectorAll\('g\.edgePath, path\.flowchart-link'\)/);
  assert.match(renderer, /tabIndex\s*=\s*0/);
  assert.match(renderer, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(renderer, /selectNode/);
  assert.match(renderer, /selectEdge/);
});

test('real Mermaid bindings expose deterministic names and one carrier per eligible edge', async () => {
  const { chromium } = require('playwright');
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].find(candidate => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {})
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="diagram"><svg width="320" height="160">
      <g class="node" id="node-a"><text x="10" y="20">Source</text></g>
      <g class="node" id="node-b"><text x="220" y="20">Target</text></g>
      <g class="edgePath" id="edge-carrier-1"><path id="edge-path-1" class="flowchart-link" d="M 20 40 L 250 40" stroke="black"></path></g>
      <path id="edge-loose-duplicate" class="flowchart-link" d="M 20 40 L 250 40" stroke="black"></path>
      <g class="edgePath" id="edge-carrier-2"><path id="edge-path-2" class="flowchart-link" d="M 20 80 L 250 80" stroke="black"></path></g>
      <g class="edgePath" id="edge-aggregate"><path id="edge-path-aggregate" class="flowchart-link" d="M 20 120 L 250 120" stroke="black"></path></g>
    </svg></div><div id="loose-diagram"><svg width="320" height="100">
      <path id="loose-edge-1" class="flowchart-link" d="M 20 30 L 250 30" stroke="black"></path>
      <path id="loose-edge-2" class="flowchart-link" d="M 20 70 L 250 70" stroke="black"></path>
    </svg></div>`);
    const binder = executableFunctionSource(
      read('popup.js'), 'bindMechanismMermaidInteractions'
    );
    await page.evaluate(source => {
      window.calls = [];
      window.interfaceLanguage = () => 'en';
      window.mechanismNetworkViewController = {
        selectNode: id => { window.calls.push(`node:${id}`); return id; },
        selectEdge: id => { window.calls.push(`edge:${id}`); return id; }
      };
      window.eval(`${source}\nwindow.bindDiagram = bindMechanismMermaidInteractions;`);
      window.bindDiagram(document.getElementById('diagram'), {
        nodes: [
          { id: 'a', label: { value: 'Source' } },
          { id: 'b', label: { value: 'Target' } }
        ],
        edges: [
          { id: 'first', from: 'a', to: 'b', polarity: 'negative',
            label: { value: 'inhibits' }, panelEvidence: [{}] },
          { id: 'second', from: 'a', to: 'b', polarity: 'positive',
            label: { value: 'activates' }, panelEvidence: [] },
          { id: '', from: 'a', to: 'b', polarity: 'neutral',
            label: 'aggregate' }
        ]
      });
      window.bindDiagram(document.getElementById('loose-diagram'), {
        nodes: [],
        edges: [
          { id: 'loose-first', from: 'a', to: 'b', polarity: 'negative',
            label: { value: 'inhibits' } },
          { id: 'loose-second', from: 'a', to: 'b', polarity: 'positive',
            label: { value: 'activates' } }
        ]
      });
    }, binder);
    assert.deepEqual(await page.locator('g.node').evaluateAll(nodes => nodes.map(node => ({
      role: node.getAttribute('role'), tabindex: node.getAttribute('tabindex'),
      aria: node.getAttribute('aria-label')
    }))), [
      { role: 'button', tabindex: '0', aria: 'Mechanism node 1: Source' },
      { role: 'button', tabindex: '0', aria: 'Mechanism node 2: Target' }
    ]);
    assert.deepEqual(await page.locator('g.edgePath').evaluateAll(edges => edges.map(edge => ({
      id: edge.dataset.mechanismEdgeId || '', role: edge.getAttribute('role'),
      tabindex: edge.getAttribute('tabindex'), aria: edge.getAttribute('aria-label')
    }))), [
      { id: 'first', role: 'button', tabindex: '0',
        aria: 'Relation 1: Source → Target; inhibits' },
      { id: 'second', role: 'button', tabindex: '0',
        aria: 'Relation 2: Source → Target; activates' },
      { id: '', role: null, tabindex: null, aria: null }
    ]);
    assert.deepEqual(await page.locator('path.flowchart-link').evaluateAll(paths =>
      paths.map(pathNode => ({
        id: pathNode.dataset.mechanismEdgeId || '',
        role: pathNode.getAttribute('role'), tabindex: pathNode.getAttribute('tabindex')
      }))), [
      { id: '', role: null, tabindex: null },
      { id: '', role: null, tabindex: null },
      { id: '', role: null, tabindex: null },
      { id: '', role: null, tabindex: null },
      { id: 'loose-first', role: 'button', tabindex: '0' },
      { id: 'loose-second', role: 'button', tabindex: '0' }
    ], 'nested Mermaid paths never become duplicate relation controls');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'node-a');
    await page.keyboard.press('Enter');
    await page.locator('#edge-path-1').dispatchEvent('click');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'edge-carrier-2');
    await page.keyboard.press('Space');
    await page.locator('#edge-aggregate').dispatchEvent('keydown', { key: 'Enter' });
    assert.deepEqual(await page.evaluate(() => window.calls), [
      'node:a', 'edge:first', 'edge:second'
    ]);
  } finally {
    await browser.close();
  }
});

test('Mermaid keyboard selection restores semantic focus only in the next current-paper render', async () => {
  const popup = read('popup.js');
  const focusHandoffSource = executableFunctionSource(
    popup, 'createMechanismMermaidFocusHandoff'
  );
  const binderSource = executableFunctionSource(
    popup, 'bindMechanismMermaidInteractions'
  );
  const renderer = functionBody(popup, 'renderMechanismNetwork', 'renderMechanismSelectionInspector');
  assert.match(renderer, /mechanismMermaidFocusHandoff\.restore\(diagram, generation\)/u);

  const { chromium } = require('playwright');
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].find(candidate => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {})
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="host"></main>');
    await page.evaluate(({ focusHandoffSource, binderSource }) => {
      window.eval(`${focusHandoffSource}\n${binderSource}\n` +
        'window.createFocusHandoff = createMechanismMermaidFocusHandoff;' +
        'window.bindDiagram = bindMechanismMermaidInteractions;');
      window.interfaceLanguage = () => 'en';
      window.currentPaper = 'paper-a';
      window.renderGeneration = 20;
      window.renderMode = 'current';
      window.selectionCalls = [];
      window.focusHandoff = window.createFocusHandoff({
        captureContext: () => ({ paper: window.currentPaper }),
        isContextCurrent: context => context?.paper === window.currentPaper
      });
      const model = {
        nodes: [
          { id: 'a', label: { value: 'Source' } },
          { id: 'b', label: { value: 'Target' } }
        ],
        edges: [{
          id: 'ab', from: 'a', to: 'b', polarity: 'positive',
          label: { value: 'activates' }, panelEvidence: []
        }]
      };
      window.mountDiagram = generation => {
        window.renderGeneration = generation;
        const diagram = document.createElement('div');
        diagram.className = 'test-diagram';
        diagram.innerHTML = `<svg width="320" height="100">
          <g class="node"><text x="10" y="20">Source</text></g>
          <g class="node"><text x="220" y="20">Target</text></g>
          <g class="edgePath"><path class="flowchart-link" d="M 20 60 L 250 60" stroke="black"></path></g>
        </svg>`;
        const rerender = (kind, id) => {
          window.selectionCalls.push(`${kind}:${id}`);
          const nextGeneration = generation + (window.renderMode === 'skipped' ? 2 : 1);
          if (window.renderMode === 'stale-paper') window.currentPaper = 'paper-b';
          const next = window.mountDiagram(nextGeneration);
          window.focusHandoff.restore(next, nextGeneration);
          return id;
        };
        window.bindDiagram(diagram, model, {
          renderGeneration: generation,
          focusHandoff: window.focusHandoff,
          selectNode: id => rerender('node', id),
          selectEdge: id => rerender('edge', id)
        });
        document.getElementById('host').replaceChildren(diagram);
        return diagram;
      };
      window.mountDiagram(window.renderGeneration);
    }, { focusHandoffSource, binderSource });

    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(
      () => document.activeElement?.dataset?.mechanismNodeId
    ), 'a');
    await page.locator('[data-mechanism-edge-id="ab"]').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(
      () => document.activeElement?.dataset?.mechanismEdgeId
    ), 'ab');

    await page.evaluate(() => { window.renderMode = 'stale-paper'; });
    await page.locator('[data-mechanism-node-id="a"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => Boolean(
      document.activeElement?.dataset?.mechanismNodeId ||
      document.activeElement?.dataset?.mechanismEdgeId
    )), false, 'a different paper cannot inherit graph focus');

    await page.evaluate(() => {
      window.currentPaper = 'paper-a';
      window.renderMode = 'current';
      window.mountDiagram(window.renderGeneration + 1);
      window.renderMode = 'skipped';
    });
    await page.locator('[data-mechanism-edge-id="ab"]').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => Boolean(
      document.activeElement?.dataset?.mechanismNodeId ||
      document.activeElement?.dataset?.mechanismEdgeId
    )), false, 'a later render generation cannot consume an older focus handoff');
    assert.deepEqual(await page.evaluate(() => window.selectionCalls), [
      'node:a', 'edge:ab', 'node:a', 'edge:ab'
    ]);
  } finally {
    await browser.close();
  }
});

test('active mechanism selection exposes one atomic graph action', async () => {
  const writes = [];
  let renders = 0;
  const createController = loadMechanismNetworkViewController(read('popup.js'));
  const controller = createController({
    getChain: () => ({
      revision: 7,
      nodes: [{ id: 'source' }, { id: 'branch-b' }],
      edges: [{ id: 'source-b', from: 'source', to: 'branch-b' }]
    }),
    createId: prefix => `${prefix}-new`,
    runMutation: async mutation => { writes.push(mutation); return { success: true }; },
    render: () => { renders += 1; },
    focusSet: () => ({ nodeIds: new Set(['branch-b']), edgeIds: new Set() })
  });

  controller.selectNode('branch-b');
  assert.deepEqual(controller.getState(), {
    selectedNodeId: 'branch-b', selectedEdgeId: '', focusEnabled: false
  });
  const result = await controller.addBranch('branch-b', 'downstream');
  assert.equal(result.success, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].type, 'add_mechanism_branch');
  assert.equal(writes[0].edge.from, 'branch-b');
  assert.equal(writes[0].edge.to, 'mechanism-node-new');
  assert.equal(renders, 1);
});

test('focus path is view-only and self-feedback requires signed polarity', async () => {
  const writes = [];
  const chain = {
    revision: 12,
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }]
  };
  const createController = loadMechanismNetworkViewController(read('popup.js'));
  const controller = createController({
    getChain: () => chain,
    createId: prefix => `${prefix}-${writes.length}`,
    runMutation: async mutation => { writes.push(mutation); return { success: true }; },
    render: () => undefined,
    focusSet: () => ({ nodeIds: new Set(['a']), edgeIds: new Set(['ab']) })
  });
  controller.selectEdge('ab');
  controller.toggleFocus();
  assert.equal(chain.revision, 12);
  assert.deepEqual([...controller.focused().nodeIds], ['a']);

  const rejected = await controller.addConnection('a', 'a', 'neutral');
  assert.equal(rejected.code, 'MECHANISM_NETWORK_SELF_LOOP_POLARITY_REQUIRED');
  assert.equal(writes.length, 0);
  await controller.addConnection('a', 'a', 'negative');
  assert.equal(writes[0].edge.polarity, 'negative');
});

test('mechanism export menu exposes PNG SVG JSON and authorized JSON import', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  assert.match(html, /id="mechanismNetworkExportMenu"/u);
  assert.match(html, /data-mechanism-export="png"/u);
  assert.match(html, /data-mechanism-export="svg"/u);
  assert.match(html, /data-mechanism-export="json"/u);
  assert.match(html,
    /id="importMechanismNetworkFile"[^>]+accept="application\/json,\.json"/u);
  assert.match(popup, /function exportMechanismNetwork\(/u);
  assert.match(popup, /function importMechanismNetworkFile\(/u);
  assert.match(popup, /restoreMechanismNetworkDraft/u);
  assert.match(popup, /MECHANISM_NETWORK_IMPORT_MAX_BYTES/u);
  assert.match(popup, /event\.key === 'Escape'/u);
  assert.match(popup, /aria-expanded/u);
});

test('mechanism JSON export is lossless before graph projection and legacy import confirms before messaging', () => {
  const popup = read('popup.js');
  const exporter = functionBody(
    popup, 'exportMechanismNetwork', 'mechanismNetworkImportFailureCode'
  );
  const importer = functionBody(
    popup, 'importMechanismNetworkFile', 'closeMechanismNetworkExportMenu'
  );
  assert.match(exporter, /createMechanismNetworkJson\(\{[\s\S]*mechanismGeneration/u);
  assert.ok(exporter.indexOf('createMechanismNetworkJson') <
    exporter.indexOf('createMechanismGraphExportDto'),
  'node-only JSON must serialize before visual graph validation');
  assert.match(exporter, /JSON\.stringify\(/u);
  assert.match(importer, /parseMechanismGraphExport/u);
  assert.match(importer, /confirm\(/u);
  assert.ok(importer.indexOf('confirm(') < importer.indexOf('sendTabMessage('),
    'lossy graph confirmation must precede every workspace ensure/write message');
  assert.match(importer, /mechanismGeneration:\s*null/u);
});

test('mechanism paper identity canonicalizes or omits optional page titles before v2 export', () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(popup, 'mechanismNetworkPaperIdentity');
  let title = '  Ａ  Study\nTitle  ';
  const identity = new Function(
    'currentWorkspaceSnapshot', 'currentArticleArchiveIdentity',
    `${source}\nreturn mechanismNetworkPaperIdentity;`
  )({
    localWorkspace: {
      workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
      canonicalUrl: 'https://example.test/paper', contentHash: 'b'.repeat(64)
    }, url: 'https://example.test/paper'
  }, () => ({ documentId: 'sha256:title-paper', title }));
  const SciLLM = require('../core/mechanism-network.js');
  const chain = {
    initialized: true,
    nodes: [{ id: 'only', label: {
      value: 'Only', humanReviewed: true, editedAt: 1
    } }],
    edges: [], panelAliases: {},
    reviewTombstones: { nodes: [], edges: [], evidence: [] }
  };
  const canonical = identity();
  assert.equal(canonical.title, 'A Study Title');
  assert.doesNotThrow(() => SciLLM.createMechanismNetworkJson({
    chain, paper: canonical
  }));
  title = '  \n\t ';
  const withoutTitle = identity();
  assert.equal(Object.hasOwn(withoutTitle, 'title'), false);
  assert.doesNotThrow(() => SciLLM.createMechanismNetworkJson({
    chain, paper: withoutTitle
  }));
});

test('real JSON export canonicalizes raw titles and never projects a graph', async () => {
  const popup = read('popup.js');
  const exportSource = executableFunctionSource(popup, 'exportMechanismNetwork');
  const paperSource = executableFunctionSource(popup, 'mechanismNetworkPaperIdentity');
  const network = require('../core/mechanism-network.js');
  let graphCalls = 0;
  const SciLLM = {
    ...network,
    createMechanismGraphExportDto() {
      graphCalls += 1;
      throw new Error('graph projection must not run for JSON');
    }
  };
  const workspace = {
    workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
    canonicalUrl: 'https://example.test/paper', contentHash: 'b'.repeat(64)
  };
  const draft = {
    revision: 1,
    mechanismChain: {
      initialized: true,
      nodes: [{ id: 'only', label: {
        value: 'Only', humanReviewed: true, editedAt: 1
      } }],
      edges: [], panelAliases: {},
      reviewTombstones: { nodes: [], edges: [], evidence: [] }
    }
  };
  let rawTitle = '';
  const paperIdentity = new Function(
    'currentWorkspaceSnapshot', 'currentArticleArchiveIdentity',
    `${paperSource}\nreturn mechanismNetworkPaperIdentity;`
  )({ localWorkspace: workspace, url: workspace.canonicalUrl }, () => ({
    documentId: 'sha256:json-title-paper', title: rawTitle
  }));
  const button = { disabled: false };
  const downloads = [];
  const run = new Function(
    'SciLLM', 'document', 'mechanismWorkspaceDraft',
    'mechanismNetworkPaperIdentity', 'downloadBlob',
    'mechanismNetworkExportFilename', 'closeMechanismNetworkExportMenu',
    'showStatus',
    `async ${exportSource}\nreturn exportMechanismNetwork;`
  )(
    SciLLM,
    { getElementById: id => id === 'openMechanismExportMenu' ? button : null },
    () => draft,
    paperIdentity,
    (blob, filename) => downloads.push([blob, filename]),
    extension => `mechanism.${extension}`,
    () => undefined,
    () => undefined
  );
  for (const [candidate, expectedTitle] of [
    ['  Ａ  Export\nTitle  ', 'A Export Title'],
    ['', undefined]
  ]) {
    rawTitle = candidate;
    downloads.length = 0;
    await run('json');
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0][1], 'mechanism.json');
    const jsonText = await downloads[0][0].text();
    const payload = JSON.parse(jsonText);
    assert.equal(payload.paper.title, expectedTitle);
    assert.doesNotThrow(() => network.parseMechanismNetworkJson(
      jsonText, paperIdentity()
    ));
  }
  assert.equal(graphCalls, 0);
});

test('confirmed legacy graph bridge succeeds with noncanonical or empty raw page titles', async () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(popup, 'importMechanismNetworkFile');
  const paperSource = executableFunctionSource(popup, 'mechanismNetworkPaperIdentity');
  const SciLLM = {
    ...require('../core/mechanism-network.js'),
    ...require('../core/figure-workspace.js'),
    ...require('../core/export-bundle.js')
  };
  const authoritativeValidate = SciLLM.validateMechanismWorkspaceImport;
  let validations = 0;
  SciLLM.validateMechanismWorkspaceImport = (...args) => {
    validations += 1;
    return authoritativeValidate(...args);
  };
  const legacyText = SciLLM.serializeMechanismGraphExport(
    SciLLM.createMechanismGraphExportDto({
      nodes: [{ id: 'source', label: 'Source' }], edges: []
    })
  );
  const workspace = {
    workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
    canonicalUrl: 'https://example.test/paper', contentHash: 'b'.repeat(64)
  };
  let rawTitle = '';
  const paperIdentity = new Function(
    'currentWorkspaceSnapshot', 'currentArticleArchiveIdentity',
    `${paperSource}\nreturn mechanismNetworkPaperIdentity;`
  )({ localWorkspace: workspace, url: workspace.canonicalUrl }, () => ({
    documentId: 'sha256:legacy-title-paper', title: rawTitle
  }));
  for (const candidate of ['  Ａ  Legacy\nTitle  ', '']) {
    rawTitle = candidate;
    const messages = [];
    const run = new Function(
      'SciLLM', 'confirm', 'sendTabMessage', 'showStatus',
      'captureFigureWorkspaceEditContext', 'MECHANISM_NETWORK_IMPORT_MAX_BYTES',
      'mechanismNetworkImportFailureCode', 'mechanismWorkspaceDraft',
      'mechanismNetworkPaperIdentity', 'isCurrentFigureWorkspaceEditContext',
      'integrateMechanismChainDraft', 'closeMechanismNetworkExportMenu',
      `async ${source}\nreturn importMechanismNetworkFile;`
    )(
      SciLLM,
      () => true,
      async (_tabId, message) => {
        messages.push(message);
        return message.action === 'ensureArticleWorkspace'
          ? { success: true, workspace, restoreAuthorization: { token: 'token' } }
          : { success: true, draft: { revision: 1 } };
      },
      () => undefined,
      () => ({ tabId: 1 }),
      2_000_000,
      error => error?.code || error?.message || 'MECHANISM_NETWORK_IMPORT_FAILED',
      () => ({ revision: 0 }),
      paperIdentity,
      () => true,
      () => true,
      () => undefined
    );
    const result = await run({
      size: legacyText.length, text: async () => legacyText
    });
    assert.equal(result.success, true);
    assert.deepEqual(messages.map(message => message.action), [
      'ensureArticleWorkspace', 'restoreMechanismNetworkDraft'
    ]);
    const restored = JSON.parse(messages[1].jsonText);
    assert.equal(restored.schemaVersion, 2);
    assert.equal(restored.paper.title,
      candidate ? 'A Legacy Title' : undefined);
    assert.doesNotThrow(() => SciLLM.parseMechanismNetworkJson(
      messages[1].jsonText, paperIdentity(workspace)
    ));
  }
  assert.equal(validations, 2);
});

test('cancelling a real legacy graph import sends no workspace messages', async () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(popup, 'importMechanismNetworkFile');
  const SciLLM = {
    ...require('../core/mechanism-network.js'),
    ...require('../core/export-bundle.js')
  };
  const legacyText = SciLLM.serializeMechanismGraphExport(
    SciLLM.createMechanismGraphExportDto({
      nodes: [{ id: 'source', label: 'Source' }], edges: []
    })
  );
  let confirmations = 0;
  let messages = 0;
  let captures = 0;
  const run = new Function(
    'SciLLM', 'confirm', 'sendTabMessage', 'showStatus',
    'captureFigureWorkspaceEditContext', 'MECHANISM_NETWORK_IMPORT_MAX_BYTES',
    'mechanismNetworkImportFailureCode',
    `async ${source}\nreturn importMechanismNetworkFile;`
  )(
    SciLLM,
    () => { confirmations += 1; return false; },
    async () => { messages += 1; return { success: true }; },
    () => undefined,
    () => { captures += 1; return { tabId: 1 }; },
    2_000_000,
    () => 'MECHANISM_NETWORK_IMPORT_FAILED'
  );
  const result = await run({
    size: legacyText.length,
    text: async () => legacyText
  });
  assert.equal(confirmations, 1);
  assert.equal(messages, 0);
  assert.equal(captures, 0,
    'lossy cancellation must finish before acquiring mutable workspace context');
  assert.equal(result.cancelled, true);
});

test('malformed v2 mechanism workspace fails before any ensure message', async () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(popup, 'importMechanismNetworkFile');
  const SciLLM = {
    ...require('../core/mechanism-network.js'),
    ...require('../core/export-bundle.js')
  };
  const malformed = JSON.stringify({
    schema: 'brevess.mechanism-network', schemaVersion: 2,
    exportedAt: '2026-09-04T00:00:00.000Z',
    paper: {
      workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
      contentHash: 'b'.repeat(64)
    },
    mechanismChain: { nodes: [], edges: [] }, mechanismGeneration: null
  });
  let messages = 0;
  let captures = 0;
  const run = new Function(
    'SciLLM', 'confirm', 'sendTabMessage', 'showStatus',
    'captureFigureWorkspaceEditContext', 'MECHANISM_NETWORK_IMPORT_MAX_BYTES',
    'mechanismNetworkImportFailureCode',
    `async ${source}\nreturn importMechanismNetworkFile;`
  )(
    SciLLM,
    () => true,
    async () => { messages += 1; return { success: true }; },
    () => undefined,
    () => { captures += 1; return { tabId: 1 }; },
    2_000_000,
    error => error?.code || error?.message || 'MECHANISM_NETWORK_IMPORT_FAILED'
  );
  const result = await run({
    size: malformed.length, text: async () => malformed
  });
  assert.equal(result.success, false);
  assert.equal(result.code, 'MECHANISM_NETWORK_IMPORT_INVALID');
  assert.equal(messages, 0);
  assert.equal(captures, 0);
});

test('digest-tampered v2 mechanism workspace fails network validation before ensure', async () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(popup, 'importMechanismNetworkFile');
  const SciLLM = {
    ...require('../core/mechanism-network.js'),
    ...require('../core/figure-workspace.js'),
    ...require('../core/export-bundle.js')
  };
  const authoritativeValidate = SciLLM.validateMechanismWorkspaceImport;
  let validations = 0;
  SciLLM.validateMechanismWorkspaceImport = (...args) => {
    validations += 1;
    return authoritativeValidate(...args);
  };
  const paper = {
    workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
    contentHash: 'b'.repeat(64)
  };
  const mechanismGeneration = JSON.stringify({
    schemaVersion: 1, envelopeKind: 'durable', status: 'complete',
    evidenceFirstVersions: {},
    identity: {
      operationId: 'fake', operationEpoch: 1, documentId: 'fake',
      workspaceId: paper.workspaceId, workspaceGeneration: 1,
      workspaceLifecycle: 1, baseWorkspaceRevision: 0,
      mechanismChainFingerprint: 'fake'
    },
    committedWorkspaceRevision: 1,
    preview: {
      status: 'complete', canonicalDigest: 'fake',
      nodes: [], relations: [], claims: []
    },
    updatedAt: 1,
    projectionDigest: `mechanism-envelope-v1-${'1'.repeat(64)}`,
    chainProjectionDigest: `mechanism-envelope-v1-${'2'.repeat(64)}`
  });
  const jsonText = JSON.stringify({
    schema: 'brevess.mechanism-network', schemaVersion: 2,
    exportedAt: '2026-09-04T00:00:00.000Z', paper,
    mechanismChain: {
      initialized: true, nodes: [], edges: [], panelAliases: {},
      reviewTombstones: { nodes: [], edges: [], evidence: [] }
    },
    mechanismGeneration
  });
  let messages = 0;
  let captures = 0;
  const run = new Function(
    'SciLLM', 'confirm', 'sendTabMessage', 'showStatus',
    'captureFigureWorkspaceEditContext', 'MECHANISM_NETWORK_IMPORT_MAX_BYTES',
    'mechanismNetworkImportFailureCode', 'mechanismWorkspaceDraft',
    'mechanismNetworkPaperIdentity',
    `async ${source}\nreturn importMechanismNetworkFile;`
  )(
    SciLLM,
    () => true,
    async () => { messages += 1; return { success: false }; },
    () => undefined,
    () => { captures += 1; return { tabId: 1 }; },
    2_000_000,
    error => error?.code || error?.message || 'MECHANISM_NETWORK_IMPORT_FAILED',
    () => SciLLM.createFigureWorkspaceDraft([]),
    () => paper
  );
  const result = await run({ size: jsonText.length, text: async () => jsonText });
  assert.equal(result.success, false);
  assert.equal(messages, 0);
  assert.equal(captures, 0);
  assert.equal(validations, 0);
});

test('oversized and revision-limited v2 imports fail preflight before ensure', async () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(popup, 'importMechanismNetworkFile');
  const SciLLM = {
    ...require('../core/mechanism-network.js'),
    ...require('../core/figure-workspace.js'),
    ...require('../core/export-bundle.js')
  };
  const paper = {
    workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
    canonicalUrl: 'https://example.test/paper', contentHash: 'b'.repeat(64)
  };
  const longText = 'x'.repeat(4000);
  const oversized = {
    initialized: true,
    nodes: [
      { id: 'source', label: { value: '', humanReviewed: true, editedAt: 1 } },
      { id: 'target', label: { value: '', humanReviewed: true, editedAt: 1 } }
    ],
    edges: Array.from({ length: 7 }, (_, index) => ({
      id: `edge-${index}`, from: 'source', to: 'target', polarity: 'neutral',
      label: { value: `relation-${index}`, humanReviewed: true, editedAt: 1 },
      panelEvidence: Array.from({ length: 32 }, () => ({
        figureId: '', panelId: '', value: longText, unresolved: true,
        humanReviewed: true, editedAt: 1
      })),
      humanReviewed: true, editedAt: 1
    })),
    panelAliases: {},
    reviewTombstones: { nodes: [], edges: [], evidence: [] }
  };
  const changed = {
    initialized: true,
    nodes: [{ id: 'only', label: {
      value: 'Only', humanReviewed: true, editedAt: 1
    } }],
    edges: [], panelAliases: {},
    reviewTombstones: { nodes: [], edges: [], evidence: [] }
  };
  const oversizedText = JSON.stringify(SciLLM.createMechanismNetworkJson({
    chain: oversized, paper
  }));
  assert.ok(oversizedText.length < 2_000_000);
  const revisionLimited = SciLLM.createFigureWorkspaceDraft([]);
  revisionLimited.revision = 2147483647;
  const cases = [
    [oversizedText, SciLLM.createFigureWorkspaceDraft([])],
    [JSON.stringify(SciLLM.createMechanismNetworkJson({ chain: changed, paper })),
      revisionLimited]
  ];
  for (const [jsonText, draft] of cases) {
    let messages = 0;
    let captures = 0;
    let validations = 0;
    const validate = SciLLM.validateMechanismWorkspaceImport;
    const scoped = {
      ...SciLLM,
      validateMechanismWorkspaceImport(...args) {
        validations += 1;
        return validate(...args);
      }
    };
    const run = new Function(
      'SciLLM', 'confirm', 'sendTabMessage', 'showStatus',
      'captureFigureWorkspaceEditContext', 'MECHANISM_NETWORK_IMPORT_MAX_BYTES',
      'mechanismNetworkImportFailureCode', 'mechanismWorkspaceDraft',
      'mechanismNetworkPaperIdentity',
      `async ${source}\nreturn importMechanismNetworkFile;`
    )(
      scoped,
      () => true,
      async () => { messages += 1; return { success: false }; },
      () => undefined,
      () => { captures += 1; return { tabId: 1 }; },
      2_000_000,
      error => error?.code || error?.message || 'MECHANISM_NETWORK_IMPORT_FAILED',
      () => draft,
      () => paper
    );
    const result = await run({ size: jsonText.length, text: async () => jsonText });
    assert.equal(result.success, false);
    assert.equal(validations, 1);
    assert.equal(messages, 0);
    assert.equal(captures, 0);
  }
});

test('mechanism import reports only fixed public failure codes', () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(popup, 'mechanismNetworkImportFailureCode');
  const mechanismNetworkImportFailureCode = new Function(
    `${source}\nreturn mechanismNetworkImportFailureCode;`
  )();
  assert.equal(
    mechanismNetworkImportFailureCode({ message: 'FIGURE_WORKSPACE_REVISION_CONFLICT' }),
    'FIGURE_WORKSPACE_REVISION_CONFLICT'
  );
  assert.equal(
    mechanismNetworkImportFailureCode({ code: 'MECHANISM_NETWORK_IMPORT_PAPER_MISMATCH' }),
    'MECHANISM_NETWORK_IMPORT_PAPER_MISMATCH'
  );
  assert.equal(
    mechanismNetworkImportFailureCode({ message: 'backend-secret' }),
    'MECHANISM_NETWORK_IMPORT_FAILED'
  );
});

test('mechanism rendering shares edit deferral and structural actions use one atomic CAS', () => {
  const popup = read('popup.js');
  const coordinator = popup.slice(
    popup.indexOf('const figureWorkspaceRenderCoordinator'),
    popup.indexOf('const figureWorkspaceInlineEditController')
  );
  assert.match(coordinator,
    /renderMechanismChainWorkspace\(snapshot,\s*\{\s*coordinated:\s*true\s*\}\)/);
  assert.doesNotMatch(functionBody(
    popup, 'integrateMechanismChainDraft', 'persistMechanismChainMutation'
  ), /renderMechanismChainWorkspace/);
  assert.match(functionBody(
    popup, 'renderMechanismChainWorkspace', 'openResearchLogicMapEditor'
  ), /if\s*\(!coordinated\)\s*return figureWorkspaceRenderCoordinator\.request\(snapshot\)/);
  const insert = functionBody(popup, 'addMechanismNodeAfter', 'removeMechanismNode');
  const remove = functionBody(popup, 'removeMechanismNode', 'reorderMechanismNode');
  const reorder = functionBody(popup, 'reorderMechanismNode', 'appendMechanismInlineField');
  const removeCoordinator = popup.slice(
    popup.indexOf('const mechanismNodeRemovalCoordinator'),
    popup.indexOf('const mechanismChainSeedCoordinator')
  );
  assert.equal((insert.match(/safelyPersistMechanismChainMutation\(/g) || []).length, 1);
  assert.match(insert, /type:\s*'insert_mechanism_node'/);
  assert.equal((remove.match(/mechanismNodeRemovalCoordinator\.remove\(/g) || []).length, 1);
  assert.equal((removeCoordinator.match(/safelyPersistMechanismChainMutation\(/g) || []).length, 1);
  assert.match(removeCoordinator, /type:\s*'remove_mechanism_node'/);
  assert.equal((reorder.match(/safelyPersistMechanismChainMutation\(/g) || []).length, 1);
});

test('mechanism evidence provenance and fire-and-forget saves are explicit and safe', () => {
  const popup = read('popup.js');
  const evidence = functionBody(
    popup, 'appendMechanismEdgeEvidence', 'seedMechanismChainFromCrossFigure'
  );
  assert.match(evidence, /evidenceClassSource/);
  assert.match(evidence, /figureLabel/);
  assert.doesNotMatch(popup, /void persistMechanismChainMutation\(/);
  assert.match(popup, /function safelyPersistMechanismChainMutation/);
  assert.match(functionBody(
    popup, 'seedMechanismChainFromCrossFigure', 'openMechanismChainWorkspace'
  ), /initialized\s*===\s*true/);
  assert.match(functionBody(
    popup, 'renderMechanismChainWorkspace', 'openResearchLogicMapEditor'
  ), /mechanismChainValidationIssues\(chain, evidenceFigures\)/);
});

test('mechanism actions flush a dirty inline edit before one queued structural CAS', async () => {
  const createCoordinator = loadMechanismActionCoordinator(read('popup.js'));
  let revision = 0;
  let active = true;
  const writes = [];
  const statuses = [];
  const coordinator = createCoordinator({
    getEditorState: () => ({ active: active ? { dirty: true } : null }),
    async flushEditor() {
      writes.push(['inline', revision]);
      revision += 1;
      active = false;
      return { status: 'saved' };
    },
    async persist(mutation) {
      writes.push([mutation.type, revision]);
      revision += 1;
      return { success: true, draft: { revision } };
    },
    status(message, state) { statuses.push([message, state]); }
  });
  const response = await coordinator.run({ type: 'reorder_mechanism_node' }, { key: 'p' });
  assert.equal(response.success, true);
  assert.equal(revision, 2);
  assert.deepEqual(writes, [
    ['inline', 0], ['reorder_mechanism_node', 1]
  ]);
  assert.deepEqual(statuses, []);
});

test('mechanism action aborts visibly when the active inline edit cannot save', async () => {
  const createCoordinator = loadMechanismActionCoordinator(read('popup.js'));
  let persisted = 0;
  const statuses = [];
  const coordinator = createCoordinator({
    getEditorState: () => ({ active: { dirty: true } }),
    flushEditor: async () => ({ status: 'conflict' }),
    persist: async () => { persisted += 1; },
    status(message, state) { statuses.push([message, state]); }
  });
  const response = await coordinator.run({ type: 'remove_mechanism_node' }, {});
  assert.equal(response.success, false);
  assert.equal(persisted, 0);
  assert.deepEqual(statuses, [['请先完成当前编辑后再修改机制链', 'error']]);
});

test('mechanism network resize rerenders once per changed width without mutating or interrupting edits', () => {
  const createController = loadMechanismNetworkResizeController(read('popup.js'));
  const frames = [];
  const cancelled = [];
  const rendered = [];
  let active = true;
  let editing = false;
  let mutations = 0;
  const controller = createController({
    schedule(callback) { frames.push(callback); return frames.length; },
    cancel(token) { cancelled.push(token); },
    isActive: () => active,
    isEditing: () => editing,
    render(width) { rendered.push(width); },
    mutate() { mutations += 1; }
  });

  assert.equal(controller.resize(700), true);
  assert.equal(controller.resize(700), false);
  assert.equal(controller.resize(520), true);
  assert.deepEqual(cancelled, [1]);
  frames[1]();
  assert.deepEqual(rendered, [520]);
  assert.equal(mutations, 0);

  editing = true;
  assert.equal(controller.resize(480), false);
  editing = false;
  active = false;
  assert.equal(controller.resize(460), false);
  active = true;
  assert.equal(controller.resize(460), true);
  frames[2]();
  assert.deepEqual(rendered, [520, 460]);

  controller.clear();
  assert.deepEqual(controller.getState(), { pending: false, width: 0 });
});

test('mechanism workspace wires one passive viewport resize listener to view-only rendering', () => {
  const popup = read('popup.js');
  const setup = functionBody(
    popup, 'setupMechanismNetworkResizeRendering', 'appendMechanismSvgMarkers'
  );
  assert.match(setup, /window\.addEventListener\('resize'/);
  assert.match(setup, /mechanismNetworkResizeController\.resize/);
  assert.match(setup, /mechanismNetworkViewport/);
  assert.doesNotMatch(setup, /persist|mutation|sendTabMessage|revision\s*\+/i);
});

test('mechanism view mode cache is bounded, paper-scoped, and defaults to fit width', () => {
  const helpers = loadMechanismNetworkViewModeHelpers(read('popup.js'));
  const paperA = helpers.mechanismNetworkViewPaperKey({
    documentId: 'sha256:paper-a', canonicalUrl: 'https://example.test/a',
    contentHash: 'hash-a', revision: 1
  });
  const paperAAfterEdit = helpers.mechanismNetworkViewPaperKey({
    documentId: 'sha256:paper-a', canonicalUrl: 'https://example.test/a',
    contentHash: 'hash-a', revision: 99
  });
  const paperB = helpers.mechanismNetworkViewPaperKey({
    documentId: 'sha256:paper-b', canonicalUrl: 'https://example.test/b'
  });
  assert.equal(paperAAfterEdit, paperA, 'draft revisions are not view-cache identity');
  assert.notEqual(paperA, paperB);

  const cache = helpers.createMechanismNetworkViewModeCache(2);
  assert.equal(cache.get(paperA), 'fit-width');
  assert.equal(cache.set(paperA, 'actual-size'), 'actual-size');
  assert.equal(cache.get(paperA), 'actual-size');
  assert.equal(cache.get(paperB), 'fit-width');
  cache.set(paperB, 'actual-size');
  cache.get(paperA);
  const paperC = helpers.mechanismNetworkViewPaperKey({ documentId: 'sha256:paper-c' });
  cache.set(paperC, 'actual-size');
  assert.equal(cache.size(), 2);
  assert.equal(cache.get(paperB), 'fit-width', 'least-recent paper is evicted safely');
  assert.equal(cache.set(paperA, 'hostile-mode'), 'fit-width');
  assert.equal(cache.get(''), 'fit-width');
});

test('mechanism relation and audit formatters localize chrome without translating science', () => {
  const popup = read('popup.js');
  const formatters = new Function('interfaceLanguage', 't',
    `${executableFunctionSource(popup, 'formatMechanismRelationUiText')}\n` +
    `${executableFunctionSource(popup, 'formatMechanismEvidenceCodeLabel')}\n` +
    `${executableFunctionSource(popup, 'formatMechanismAuditReason')}\n` +
    'return { formatMechanismRelationUiText, formatMechanismEvidenceCodeLabel, ' +
      'formatMechanismAuditReason };'
  )(() => 'zh-CN', value => value);
  const en = value => I18n.translateInterfaceText(value, 'en');
  assert.equal(formatters.formatMechanismRelationUiText({
    label: 'increases', labelSource: 'generated',
    polarity: 'positive', lineStyle: 'solid'
  }, 'zh-CN'), '促进');
  assert.equal(formatters.formatMechanismRelationUiText({
    label: 'associated with', labelSource: 'generated',
    polarity: 'neutral', lineStyle: 'dashed'
  }, 'en'), 'associated with');
  for (const label of ['increases', 'decreases', 'affects', 'associated with']) {
    assert.equal(formatters.formatMechanismRelationUiText({
      label, polarity: 'positive', lineStyle: 'solid', labelSource: 'source'
    }, 'zh-CN'), label, `source label ${label} stays verbatim`);
  }
  assert.equal(formatters.formatMechanismRelationUiText({
    label: { value: 'increases', humanReviewed: true },
    polarity: 'positive', lineStyle: 'solid'
  }, 'zh-CN'), 'increases', 'human-reviewed labels are source text');
  assert.equal(formatters.formatMechanismRelationUiText({
    label: 'STAT3-dependent phase shift', polarity: 'positive', lineStyle: 'solid'
  }, 'zh-CN'), 'STAT3-dependent phase shift');
  assert.equal(formatters.formatMechanismEvidenceCodeLabel('R', en), 'Rescue');
  assert.equal(formatters.formatMechanismEvidenceCodeLabel('C', value => value), '反证');
  assert.equal(formatters.formatMechanismAuditReason(
    'unsupported_composite_relation', en
  ), 'Composite relations are not supported');
  assert.equal(formatters.formatMechanismAuditReason(
    'source_backed_schematic', value => value
  ), '来源支持的示意图，不作为机制证据');
  assert.equal(formatters.formatMechanismAuditReason(
    'unmapped_relation_term', en
  ), 'Relation term could not be mapped');
  assert.equal(formatters.formatMechanismAuditReason(
    'missing_relation_mapping', en
  ), 'Relation mapping is missing');
  assert.equal(formatters.formatMechanismAuditReason(
    'STAT3 signal not separable', en
  ), 'STAT3 signal not separable', 'unknown scientific text stays verbatim');

  const matrix = functionBody(
    popup, 'renderMechanismEvidenceMatrix', 'bindMechanismMermaidInteractions'
  );
  const inspector = functionBody(
    popup, 'renderMechanismSelectionInspector', 'renderMechanismChainWorkspace'
  );
  assert.match(matrix, /formatMechanismEvidenceCodeLabel/u);
  assert.match(matrix, /formatMechanismAuditReason/u);
  assert.match(matrix, /t\('未连通证据审计'\)/u);
  assert.match(matrix, /t\('未解析证据审计'\)/u);
  assert.match(matrix, /t\('排除证据审计'\)/u);
  assert.match(inspector, /t\('节点设置'\)/u);
  assert.match(inspector, /t\('联系设置'\)/u);
  assert.match(inspector, /t\('删除联系'\)/u);
  const workspace = functionBody(
    popup, 'renderMechanismChainWorkspace', 'scheduleMechanismNetworkRender'
  );
  assert.match(workspace, /t\(item\.message\s*\|\|\s*'机制链需要人工检查。'\)/u);
  assert.match(workspace,
    /t\('正在等待机制链生成；也可以先新增节点，手动构建机制链。'\)/u);
  assert.match(workspace,
    /t\('未配置 LLM 也可以使用：点击“新增链条节点”开始结构化记录。'\)/u);
});

test('Mermaid Fit width and 100% controls are view-only, focus-stable, and narrow-safe', async () => {
  const popup = read('popup.js');
  const helperSources = [
    'normalizeMechanismNetworkViewMode', 'mechanismNetworkViewPaperKey',
    'createMechanismNetworkViewModeCache', 'applyMechanismMermaidViewMode',
    'createMechanismMermaidViewControls'
  ].map(name => executableFunctionSource(popup, name)).join('\n');
  const controlsSource = executableFunctionSource(popup, 'createMechanismMermaidViewControls');
  const renderer = functionBody(
    popup, 'renderMechanismNetwork', 'renderMechanismSelectionInspector'
  );
  const exporter = functionBody(popup, 'exportMechanismNetwork', 'mechanismNetworkImportFailureCode');
  assert.match(renderer, /createMechanismMermaidViewControls/u);
  assert.match(renderer, /applyMechanismMermaidViewMode/u);
  assert.doesNotMatch(controlsSource, /persist|mutation|sendTabMessage|revision|replaceChildren/iu);
  assert.doesNotMatch(exporter, /ViewMode|view-mode|fit-width|actual-size/u);

  const { chromium } = require('playwright');
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].find(candidate => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {})
  });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
    await page.setContent(`
      <style>${read('popup.css')}</style>
      <section id="host" class="workspace-mechanism-mermaid-section" style="width:320px">
        <div id="diagram" class="workspace-mechanism-mermaid">
          <svg viewBox="0 0 900 300"><g id="semantic" data-mechanism-node-id="node-a"></g></svg>
        </div>
      </section>`);
    await page.evaluate(({ helpers, i18n }) => {
      window.eval(i18n);
      window.eval(`${helpers}\nwindow.modeHelpers = { createMechanismNetworkViewModeCache, ` +
        'createMechanismMermaidViewControls };');
      window.modeCache = window.modeHelpers.createMechanismNetworkViewModeCache(4);
      window.semanticTarget = document.getElementById('semantic');
      window.workspaceRevision = 7;
      const controls = window.modeHelpers.createMechanismMermaidViewControls(
        document.getElementById('diagram'), 'paper:a', window.modeCache,
        value => window.SciLLM.translateInterfaceText(value, 'en')
      );
      document.getElementById('host').prepend(controls);
    }, { helpers: helperSources, i18n: read('core/i18n.js') });

    const group = page.locator('[role="group"][aria-label="Mechanism graph zoom"]');
    await group.locator('[data-mechanism-view-mode="actual-size"]').click();
    const actual = await page.evaluate(() => ({
      mode: document.getElementById('diagram').dataset.viewMode,
      svgWidth: document.querySelector('#diagram svg').getBoundingClientRect().width,
      diagramWidth: document.getElementById('diagram').clientWidth,
      scrollWidth: document.getElementById('diagram').scrollWidth,
      pressed: [...document.querySelectorAll('[data-mechanism-view-mode]')]
        .map(button => [button.textContent, button.getAttribute('aria-pressed')]),
      focusMode: document.activeElement?.dataset?.mechanismViewMode,
      targetStable: document.getElementById('semantic') === window.semanticTarget,
      revision: window.workspaceRevision,
      cached: window.modeCache.get('paper:a'),
      otherPaper: window.modeCache.get('paper:b')
    }));
    assert.equal(actual.mode, 'actual-size');
    assert.ok(actual.svgWidth >= 899);
    assert.ok(actual.scrollWidth > actual.diagramWidth);
    assert.deepEqual(actual.pressed, [['Fit width', 'false'], ['100%', 'true']]);
    assert.equal(actual.focusMode, 'actual-size');
    assert.equal(actual.targetStable, true);
    assert.equal(actual.revision, 7);
    assert.equal(actual.cached, 'actual-size');
    assert.equal(actual.otherPaper, 'fit-width');

    await group.locator('[data-mechanism-view-mode="fit-width"]').click();
    const fitted = await page.evaluate(() => ({
      mode: document.getElementById('diagram').dataset.viewMode,
      svgWidth: document.querySelector('#diagram svg').getBoundingClientRect().width,
      diagramWidth: document.getElementById('diagram').clientWidth,
      focusMode: document.activeElement?.dataset?.mechanismViewMode
    }));
    assert.equal(fitted.mode, 'fit-width');
    assert.ok(fitted.svgWidth <= fitted.diagramWidth + 1);
    assert.equal(fitted.focusMode, 'fit-width');

    await group.locator('[data-mechanism-view-mode="actual-size"]').click();
    const stateChain = await page.evaluate(() => {
      const host = document.getElementById('host');
      const mount = (paperKey, viewBoxWidth) => {
        const diagram = document.createElement('div');
        diagram.className = 'workspace-mechanism-mermaid';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${viewBoxWidth} 80`);
        diagram.appendChild(svg);
        const controls = window.modeHelpers.createMechanismMermaidViewControls(
          diagram, paperKey, window.modeCache,
          value => window.SciLLM.translateInterfaceText(value, 'en')
        );
        host.replaceChildren(controls, diagram);
        return {
          mode: diagram.dataset.viewMode,
          width: svg.getBoundingClientRect().width,
          cssWidth: diagram.style.getPropertyValue('--mechanism-mermaid-natural-width'),
          pressed: [...controls.querySelectorAll('[data-mechanism-view-mode]')]
            .map(button => [button.dataset.mechanismViewMode,
              button.getAttribute('aria-pressed')])
        };
      };
      const paperB = mount('paper:b', 204.5);
      const paperAAfterSwitch = mount('paper:a', 204.5);
      host.style.width = '240px';
      window.dispatchEvent(new Event('resize'));
      const paperAAfterResizeRerender = mount('paper:a', 204.5);
      const paperBAfterReturn = mount('paper:b', 204.5);
      return {
        paperB, paperAAfterSwitch, paperAAfterResizeRerender, paperBAfterReturn
      };
    });
    assert.equal(stateChain.paperB.mode, 'fit-width',
      'a different paper starts in Fit width');
    assert.equal(stateChain.paperAAfterSwitch.mode, 'actual-size',
      'paper A restores its view-only preference after a paper switch');
    assert.equal(stateChain.paperAAfterSwitch.width, 204.5,
      '100% uses the real positive viewBox width without enlarging a small graph');
    assert.equal(stateChain.paperAAfterSwitch.cssWidth, '204.5px');
    assert.equal(stateChain.paperAAfterResizeRerender.mode, 'actual-size');
    assert.equal(stateChain.paperAAfterResizeRerender.width, 204.5,
      'resize plus rerender does not reset or inflate actual size');
    assert.deepEqual(stateChain.paperAAfterResizeRerender.pressed, [
      ['fit-width', 'false'], ['actual-size', 'true']
    ]);
    assert.equal(stateChain.paperBAfterReturn.mode, 'fit-width',
      'paper B keeps an isolated Fit width preference');
  } finally {
    await browser.close();
  }

  const css = read('popup.css');
  assert.match(css, /\.workspace-mechanism-view-controls[^}]*flex-wrap:\s*wrap/su);
  assert.match(css, /data-view-mode="fit-width"[^}]*min-width:\s*0/su);
  assert.match(css, /data-view-mode="actual-size"[^}]*max-width:\s*none/su);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*workspace-mechanism-mermaid svg/su);
});

test('narrow mechanism synthesis keeps Mermaid and evidence matrix locally scrollable', () => {
  const scale = loadMechanismNetworkCanvasScale(read('popup.js'));
  assert.equal(scale(333, 800), 0.78);
  assert.equal(scale(700, 800), 0.875);
  assert.equal(scale(900, 800), 1);
  assert.equal(scale(0, 800), 0.78);

  const popup = functionBody(
    read('popup.js'), 'renderMechanismNetwork', 'renderMechanismSelectionInspector'
  );
  assert.match(popup, /workspace-mechanism-synthesis/);
  assert.match(popup, /workspace-mechanism-mermaid-section/);
  assert.match(popup, /renderMechanismEvidenceMatrix/);
  const css = read('popup.css');
  assert.match(css, /\.workspace-mechanism-matrix-scroll\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.workspace-mechanism-mermaid svg[^}]*min-width:\s*520px/s);
});

test('one successful mechanism generation finalizes one seed and failures never reuse old results', async () => {
  const finalize = loadMechanismGenerationFinalizer(read('popup.js'));
  let refreshes = 0;
  const seeds = [];
  const context = { workspaceId: 'paper-a' };
  const snapshot = { localWorkspace: { workspaceId: 'paper-a' } };
  const refresh = async () => { refreshes += 1; return snapshot; };
  const seed = async (snapshot, options) => {
    seeds.push([snapshot, options]);
    return { success: true, draft: { revision: 1 } };
  };
  const failed = await finalize({
    response: null, seedMode: 'explicit', refresh, seed,
    generationContext: context,
    isContextCurrent: value => value === context,
    matchesSnapshot: (value, frozen) =>
      value?.localWorkspace?.workspaceId === frozen.workspaceId
  });
  assert.equal(failed.status, 'not_generated');
  assert.equal(refreshes, 1);
  assert.equal(seeds.length, 0);
  const success = await finalize({
    response: {
      success: true,
      status: 'complete',
      result: { mechanismEdges: [{ from: 'A', to: 'B' }] }
    },
    seedMode: 'explicit', refresh, seed,
    generationContext: context,
    isContextCurrent: value => value === context,
    matchesSnapshot: (value, frozen) =>
      value?.localWorkspace?.workspaceId === frozen.workspaceId
  });
  assert.equal(success.status, 'seeded');
  assert.equal(refreshes, 2);
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0][1].explicit, true);
  assert.equal(seeds[0][1].generationContext, context);
  assert.deepEqual(seeds[0][1].crossLogic, {
    mechanismEdges: [{ from: 'A', to: 'B' }]
  });
});

test('late mechanism generation never seeds after context switch or null/mismatched refresh', async () => {
  const finalize = loadMechanismGenerationFinalizer(read('popup.js'));
  const contextA = Object.freeze({ workspaceId: 'paper-a' });
  const response = {
    success: true,
    status: 'complete',
    result: { mechanismEdges: [{ from: 'A', to: 'B' }] }
  };
  const cases = [
    {
      name: 'switched', current: false,
      snapshot: { localWorkspace: { workspaceId: 'paper-a' } }
    },
    { name: 'null', current: true, snapshot: null },
    {
      name: 'mismatch', current: true,
      snapshot: { localWorkspace: { workspaceId: 'paper-b' } }
    }
  ];
  for (const item of cases) {
    let writes = 0;
    const blocked = [];
    const result = await finalize({
      response, seedMode: 'explicit', generationContext: contextA,
      refresh: async () => item.snapshot,
      isContextCurrent: () => item.current,
      matchesSnapshot: (snapshot, context) =>
        snapshot?.localWorkspace?.workspaceId === context.workspaceId,
      seed: async () => { writes += 1; },
      onBlocked: status => blocked.push(status)
    });
    assert.equal(result.status, 'stale_context', item.name);
    assert.equal(writes, 0, item.name);
    assert.deepEqual(blocked, ['机制链生成结果未写入：论文上下文已变化，请重试'], item.name);
  }
});

test('mechanism seed coordinator uses a supplied frozen context without recapture', async () => {
  const createCoordinator = loadMechanismSeedCoordinator(read('popup.js'));
  let captures = 0;
  const supplied = Object.freeze({ key: 'paper-a' });
  const seen = [];
  const coordinator = createCoordinator({
    captureContext: () => { captures += 1; return { key: 'paper-b' }; },
    keyForContext: context => context.key,
    seed: async (_payload, context) => { seen.push(context); return { success: true }; }
  });
  await coordinator.start('A', supplied);
  assert.equal(captures, 0);
  assert.equal(seen[0].key, 'paper-a');
});

test('mechanism seed coordination isolates concurrent papers and cleans bounded tasks', async () => {
  const createCoordinator = loadMechanismSeedCoordinator(read('popup.js'));
  const pending = new Map();
  let current = 'paper-a';
  const started = [];
  const coordinator = createCoordinator({
    captureContext: () => ({ key: current }),
    keyForContext: context => context.key,
    seed(payload, context) {
      started.push([payload, context.key]);
      return new Promise(resolve => pending.set(context.key, resolve));
    },
    maximum: 4
  });
  const a = coordinator.start('A');
  current = 'paper-b';
  const b = coordinator.start('B');
  assert.deepEqual(started, [['A', 'paper-a'], ['B', 'paper-b']]);
  pending.get('paper-b')({ success: true, draft: { revision: 2 } });
  assert.equal((await b).success, true);
  pending.get('paper-a')({ success: true, draft: { revision: 1 } });
  assert.equal((await a).success, true);
  assert.deepEqual(coordinator.getState(), { pendingKeys: [] });
});

test('mechanism entry stays in the current panel and no-LLM empty state remains authorable', () => {
  const popup = read('popup.js');
  const entry = functionBody(
    popup, 'openMechanismChainWorkspace', 'renderMechanismChainWorkspace'
  );
  assert.match(entry, /switchWorkspaceView\('mechanism'/);
  assert.doesNotMatch(entry, /chrome\.tabs\.create|openResearchLogicMapEditor/);
  assert.doesNotMatch(executableFunctionSource(popup, 'openMechanismChainWorkspace'),
    /runCrossFigureLogic|queueMicrotask/);
  const renderer = functionBody(
    popup, 'renderFigureWorkspaceSnapshot', 'reconcileArticleWorkspaceSnapshot'
  );
  assert.doesNotMatch(renderer, /renderCrossFigureLogicSnapshot/);
  assert.match(functionBody(
    popup, 'renderMechanismChainWorkspace', 'openResearchLogicMapEditor'
  ), /SciLLM\.mechanismChainValidationIssues\(chain, evidenceFigures\)/);
  assert.doesNotMatch(functionBody(
    popup, 'persistMechanismChainMutation', 'mechanismWorkspaceId'
  ), /showStatus\([^)]*error\.message/);
});

test('reopening a persisted pending mechanism never queues another generation', () => {
  const source = executableFunctionSource(read('popup.js'), 'openMechanismChainWorkspace');
  const renders = [];
  const queued = [];
  const state = { figures: { crossFigureLogic: { pendingResult: { status: 'needs_review' } } } };
  const open = new Function('currentWorkspaceSnapshot', 'switchWorkspaceView',
    'renderMechanismChainWorkspace', 'mechanismWorkspaceDraft', 'activePanelTabContext',
    'hasUsableLlm', 'queueMicrotask', `${source}; return openMechanismChainWorkspace;`)(
      state, view => renders.push(view), () => renders.push('render'),
      () => ({ mechanismChain: { nodes: [], initialized: false } }),
      { key: 'paper-a', tabId: 1 }, () => true, fn => queued.push(fn));
  open();
  open();
  assert.deepEqual(renders, ['mechanism', 'render', 'mechanism', 'render']);
  assert.equal(queued.length, 0);
});

test('scientific-question cards expose their graph relation and save it atomically', () => {
  const popup = read('popup.js');
  const source = executableFunctionSource(
    popup, 'buildScientificQuestionRelationMutationValue'
  );
  const buildScientificQuestionRelationMutationValue = new Function(
    `${source}\nreturn buildScientificQuestionRelationMutationValue;`
  )();
  const value = buildScientificQuestionRelationMutationValue({
    questionId: 'mechanism',
    text: 'Which mediator explains the phenotype?',
    relationType: 'progressive',
    parentQuestionIds: ['root'],
    supportingFigureIds: ['figure-2', 'figure-ed4']
  }, 'convergent', ['root', 'parallel', 'root', 'mechanism']);
  assert.deepEqual(value, {
    questionId: 'mechanism',
    text: 'Which mediator explains the phenotype?',
    value: 'Which mediator explains the phenotype?',
    relationType: 'convergent',
    parentQuestionIds: ['root', 'parallel'],
    supportingFigureIds: ['figure-2', 'figure-ed4']
  });
  assert.deepEqual(
    buildScientificQuestionRelationMutationValue(value, 'root', ['parallel'])
      .parentQuestionIds,
    []
  );

  const renderer = functionBody(
    popup, 'renderFigureWorkspaceMetaSnapshot', 'syncFigureQuickNavFromScroll'
  );
  assert.match(renderer, /scientificQuestionRelationLabel/);
  assert.match(renderer, /parentQuestionIds/);
  assert.match(renderer, /supportingFigureIds/);
  assert.match(renderer, /update_scientific_question/);
  assert.match(renderer, /buildScientificQuestionRelationMutationValue/);
});
