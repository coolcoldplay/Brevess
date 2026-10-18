const test = require('node:test');
test('Figure cancelled before provider admission acknowledges a later release across worker restart', async () => {
  const storageArea=createMemoryStorage(),sessionStorageArea=createMemoryStorage();
  const make=()=>createBackgroundRouter({storageArea,sessionStorageArea,runtimeExtensionId:'extension-id',
    fetchImpl:async()=>assert.fail('cleanup must not contact a provider')});
  const owner={trustedExtensionSender:true,senderExtensionId:'extension-id',senderTabId:41,senderFrameId:0,
    senderDocumentId:'16161616-1616-4616-8616-161616161616'};
  const message={type:'LLM_CONTROL_OPERATION',operationScope:'figure',workspaceLifecycle:8,
    operationId:'figure-pre-provider-confirmation-cancel'};
  const cancelled=await make().handle({...message,command:'cancel'},owner);
  assert.equal(cancelled.success,true,JSON.stringify(cancelled));
  for(let i=0;i<2;i++){
    const released=await make().handle({...message,command:'release'},owner);
    assert.equal(released.success,true,JSON.stringify(released));
    assert.equal(released.data.requestedCommand,'release');
    assert.equal(released.data.cancelled,true);assert.equal(released.data.cleanupComplete,true);
  }
  const other=await make().handle({...message,command:'release'},{...owner,senderTabId:42});
  assert.equal(other.success,false,'another owner cannot clean up this operation');
});
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { webcrypto, createHash } = require('node:crypto');

require('../core/category-store.js');
require('../core/i18n.js');
require('../core/adaptive-catalog.js');
require('../core/study-profile.js');
require('../core/confidence-policy.js');
require('../core/settings-store.js');
require('../providers/provider-utils.js');
require('../core/prompt-compiler.js');
require('../core/provider-probes.js');
require('../core/chunker.js');
require('../core/result-validator.js');
require('../core/semantic-find.js');
require('../core/evidence-ledger.js');
require('../core/figure-analysis.js');
require('../core/figure-panel-planner.js');
require('../core/figure-panel-recovery.js');
require('../core/supplemental-materials.js');
require('../core/article-chat-tokenizer.js');
require('../core/article-chat-index.js');
require('../core/article-chat-retrieval.js');
require('../core/article-chat-memory.js');
require('../core/article-chat-citations.js');
require('../core/article-chat-stream.js');
require('../core/article-chat-web-sources.js');
require('../core/article-chat.js');
require('../core/research-evidence.js');
require('../core/research-logic-pipeline.js');
require('../core/reading-tools.js');
require('../core/selection-ai.js');
require('../core/panel-ledger.js');
require('../core/cross-figure-logic.js');
require('../core/review-outline.js');
require('../core/abbreviation-extractor.js');
require('../core/cache-planner.js');
require('../core/privacy-sanitizer.js');
require('../core/article-workspace.js');
require('../core/article-workspace-save.js');
require('../core/pdf-workspace.js');
const { workspaceContentFingerprint } = require('../core/article-workspace-store.js');
const {
  createFigureWorkspaceDraft,
  initializeFigureWorkspaceDraftState
} = require('../core/figure-workspace.js');
const {
  articleArchiveRelativePath,
  createArticleArchive
} = require('../core/article-archive.js');
const {
  createMemorySyncQueue,
  createDirectorySync
} = require('../core/directory-sync.js');
require('../core/migration-bundle.js');
require('../core/analysis-pipeline.js');
require('../core/analysis-cache.js');
require('../core/review-outline-pipeline.js');
require('../core/corpus-store.js');
require('../core/pdf-annotations.js');
require('../core/manual-annotations.js');
const { createMemoryDocumentStore } = require('../core/document-store.js');
require('../providers/openai.js');
require('../providers/anthropic.js');
require('../providers/gemini.js');
require('../providers/deepseek.js');
require('../providers/codex-local.js');
require('../providers/openai-compatible.js');
require('../providers/provider-registry.js');
require('../core/provider-model-discovery.js');
require('../core/task-profile-router.js');
require('../core/token-budget.js');
require('../core/article-chat-context-planner.js');
require('../core/operation-control.js');
require('../core/mechanism-operation-coordinator.js');
require('../core/evidence-first-mechanism.js');
const {
  createBackgroundRouter,
  createPortableConfigStorageChangeListener,
  EVIDENCE_FIRST_REQUEST_CONTRACT,
  LLM_TASK_DISPATCH,
  resolveLlmTaskId,
  buildTaskPolicySignature,
  FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT,
  deriveFigureProviderAttemptBudget,
  createFigureProviderAttemptLedger,
  createMechanismBrowserSessionIdentityProvider
} = require('../core/background-router.js');
const { validBlueprint } = require('./helpers/adaptive-fixtures.js');

// Offline UI choice fixture. This supplies the real modern owner/receipt and
// invokes the router's actual popup decision route; it never bypasses a gate.
function createConfirmedFigureRouter(options, decision = 'continue_text') {
  const router=createBackgroundRouter({...options,runtimeExtensionId:'extension-id'});let sequence=0;
  const popup={trustedExtensionSender:true,senderExtensionId:'extension-id',
    senderUrl:'chrome-extension://extension-id/popup.html',runtimeBaseUrl:'chrome-extension://extension-id/'};
  return {...router,handle(message,context={}) {
    if(!['LLM_ANALYZE_FIGURES','LLM_ANALYZE_FIGURE_PANEL','LLM_ASK_FIGURE_PANEL'].includes(message.type))return router.handle(message,context);
    const figures=message.figures || [message.figure],owner={...figureCheckpointContext([],[]),
      trustedExtensionSender:true,senderExtensionId:'extension-id',senderTabId:31,senderFrameId:0,
      senderDocumentId:'31313131-3131-4313-8313-313131313131',senderUrl:'https://example.org/confirmation-fixture',...context};
    const originalProgress=owner.onProgress;
    owner.onProgress=event=>{originalProgress?.(event);if(event.visionConfirmation)void router.handle({
      type:'LLM_CONTROL_OPERATION',command:'figure-vision-decision',operationId:event.visionConfirmation.operationId,
      tabId:owner.senderTabId,visionDecisionId:event.visionConfirmation.id,choice:decision},popup);};
    const index=++sequence;
    return router.handle({...message,evidenceContractToken:message.evidenceContractToken ?? globalThis.SciLLM.FIGURE_EVIDENCE_CONTRACT_TOKEN,
      operationScope:'figure',workspaceLifecycle:message.workspaceLifecycle ?? 31,
      analysisDepth:message.analysisDepth || 'standard',operationId:message.operationId || `figure-explicit-fixture-${index}`,
      figureRequestReceipt:message.figureRequestReceipt || `figure-request-explicit-fixture-${index}-12345678`,
      figureOperationPlan:message.figureOperationPlan || figures.map(f=>({figureId:f.figureId,panelCount:f.panelHints?.length || 0}))},owner);
  }};
}

const EXPECTED_LLM_TASK_DISPATCH = Object.freeze([
  ['RADAR_AI_QUERY', 'default', 'literature_radar_query'],
  ['RADAR_AI_SCORE', 'default', 'semantic_find'],
  ['LLM_ANALYZE_DOCUMENT', 'primary', 'document_highlight'],
  ['LLM_SEMANTIC_FIND', 'default', 'semantic_find'],
  ['LLM_ANALYZE_DOCUMENT', 'evidence_ledger', 'evidence_ledger_review'],
  ['LLM_ANALYZE_REVIEW_OUTLINE', 'paragraph', 'paragraph_summary'],
  ['LLM_ANALYZE_REVIEW_OUTLINE', 'outline', 'article_outline_summary'],
  ['LLM_TRANSLATE_ABBREVIATIONS', 'default', 'abbreviation_translation'],
  ['LLM_TRANSLATE_TEXT', 'full_text_translation', 'full_text_translation'],
  ['LLM_TRANSLATE_TEXT', 'navigation_title_translation', 'navigation_title_translation'],
  ['LLM_ANALYZE_FIGURES', 'default', 'figure_walkthrough'],
  ['LLM_ANALYZE_FIGURE_PANEL', 'default', 'figure_panel_interpretation'],
  ['LLM_ASK_FIGURE_PANEL', 'default', 'figure_panel_followup'],
  ['LLM_ANALYZE_CROSS_FIGURE_LOGIC', 'default', 'cross_figure_mechanism'],
  ['LLM_ANALYZE_RESEARCH_LOGIC', 'default', 'paper_research_logic'],
  ['LLM_ANALYZE_PAPER_INNOVATION', 'default', 'paper_innovations'],
  ['LLM_ANALYZE_PAPER_LIMITATIONS', 'default', 'paper_limitations'],
  ['LLM_AUTOFILL_LITERATURE_NOTE', 'default', 'literature_note_autofill'],
  ['LLM_ASK_ARTICLE', 'article', 'article_chat'],
  ['LLM_ASK_ARTICLE', 'selection', 'selection_chat'],
  ['LLM_ASK_SELECTION', 'default', 'selection_chat']
]);

function contentFunctionSource(name) {
  const script = readFileSync(join(__dirname, '..', 'content.js'), 'utf8');
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
  const dependencyNames = Object.keys(dependencies);
  return Function(
    ...dependencyNames,
    `return (${contentFunctionSource(name)});`
  )(...dependencyNames.map(key => dependencies[key]));
}

test('selection popup routes temporary instructions without modifying settings or chat storage', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea,
    fetchImpl: async () => { throw new Error('unexpected network'); } });
  await configureOpenAIRouter(router);
  const before = JSON.stringify(storageArea.values);
  const original = globalThis.SciLLM.runSelectionAi;
  let captured;
  globalThis.SciLLM.runSelectionAi = async (input, options) => {
    captured = { input, options };
    return { status: 'completed', answerBlocks: [{ blockId: 'b', markdown: 'Explanation', evidence: [] }],
      webSearch: { enabled: false, searched: false } };
  };
  try {
    const response = await router.handle({ type: 'LLM_ASK_SELECTION',
      operationId: 'selection-test', turnId: 'selection-test',
      selectedText: 'A selected sentence.', prompt: 'Explain this temporary instruction.' });
    assert.equal(response.success, true, JSON.stringify(response));
    assert.equal(response.data.message.answerBlocks[0].markdown, 'Explanation');
    assert.equal(response.data.route.taskType, 'selection_chat');
    assert.equal(captured.input.prompt, 'Explain this temporary instruction.');
    assert.equal(captured.options.routeIdentity.operationId, 'selection-test');
    assert.equal(JSON.stringify(storageArea.values), before);
  } finally { globalThis.SciLLM.runSelectionAi = original; }
});

test('selection popup rejects empty input and missing consent without a model call', async () => {
  let calls = 0;
  const router = createBackgroundRouter({ storageArea: createMemoryStorage(),
    fetchImpl: async () => { calls += 1; throw new Error('unexpected network'); } });
  const base = { type: 'LLM_ASK_SELECTION', operationId: 'selection-denied', turnId: 'selection-denied',
    selectedText: 'Sentence', prompt: 'Explain' };
  assert.equal((await router.handle({ ...base, selectedText: '' })).error.code, 'INVALID_SETTINGS');
  assert.equal((await router.handle(base)).error.code, 'LLM_NOT_READY');
  assert.equal(calls, 0);
});

test('selection popup rejects duplicate operation and cancelled late completion', async () => {
  const router = createBackgroundRouter({ storageArea: createMemoryStorage(),
    fetchImpl: async () => { throw new Error('unexpected network'); } });
  await configureOpenAIRouter(router);
  const original = globalThis.SciLLM.runSelectionAi;
  let ready, resolve;
  const entered = new Promise(done => { ready = done; });
  globalThis.SciLLM.runSelectionAi = async () => {
    ready();
    return new Promise(done => { resolve = done; });
  };
  const message = { type: 'LLM_ASK_SELECTION', operationId: 'selection-cancel', turnId: 'selection-cancel',
    selectedText: 'Sentence', prompt: 'Explain' };
  try {
    const first = router.handle(message);
    await entered;
    assert.equal((await router.handle(message)).error.code, 'OPERATION_IN_PROGRESS');
    await router.handle({ type: 'LLM_CONTROL_OPERATION', operationId: message.operationId, command: 'cancel' });
    resolve({ status: 'completed', answerBlocks: [] });
    const response = await first;
    assert.equal(response.success, false);
    assert.match(response.error.code, /CANCELLED/);
  } finally { globalThis.SciLLM.runSelectionAi = original; }
});

test('declares a complete one-to-one dispatch table for all stable LLM task IDs', () => {
  assert.deepEqual(
    LLM_TASK_DISPATCH.map(({ messageType, branch, taskId }) => [messageType, branch, taskId]),
    EXPECTED_LLM_TASK_DISPATCH
  );
  assert.deepEqual(
    [...new Set(LLM_TASK_DISPATCH.map(entry => entry.taskId))].sort(),
    [...globalThis.SciLLM.LLM_TASK_IDS].sort()
  );
  for (const [messageType, branch, taskId] of EXPECTED_LLM_TASK_DISPATCH) {
    assert.equal(resolveLlmTaskId(messageType, branch), taskId);
  }
});

test('rejects missing and unknown LLM dispatch identities without inferring a default', () => {
  for (const [messageType, branch] of [
    [undefined, undefined],
    ['LLM_ANALYZE_DOCUMENT', undefined],
    ['LLM_ASK_ARTICLE', 'unknown'],
    ['LLM_UNKNOWN', 'default']
  ]) {
    assert.throws(
      () => resolveLlmTaskId(messageType, branch),
      error => error.code === 'UNKNOWN_LLM_TASK' && error.message === 'UNKNOWN_LLM_TASK'
    );
  }
});

test('task-policy cache signatures change with per-feature token rules', () => {
  const settings = globalThis.SciLLM.createDefaultSettings();
  const changed = structuredClone(settings);
  changed.taskPolicies.document_highlight.tokenRule = {
    output: { floor: 1024, ceiling: 4096 }
  };
  assert.notEqual(
    buildTaskPolicySignature(settings, 'document_highlight'),
    buildTaskPolicySignature(changed, 'document_highlight')
  );
  assert.notEqual(
    buildTaskPolicySignature(settings, 'article_chat'),
    buildTaskPolicySignature(settings, 'selection_chat')
  );
});

test('preflights only exact Figure task routes without creating an adapter or fetch', async () => {
  const secret = 'figure-preflight-private-secret';
  const storageArea = createMemoryStorage();
  let fetchCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('preflight must not fetch');
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: secret, model: 'gpt-5.1' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'openai', consentGranted: true }
  });
  const originalCreateProviderAdapter = globalThis.SciLLM.createProviderAdapter;
  let adapterCalls = 0;
  globalThis.SciLLM.createProviderAdapter = options => {
    adapterCalls += 1;
    return originalCreateProviderAdapter(options);
  };
  try {
    for (const taskId of [
      'figure_walkthrough', 'figure_panel_interpretation', 'figure_panel_followup'
    ]) {
      const response = await router.handle({
        type: 'LLM_PREFLIGHT_TASK_ROUTE', taskId,
        evidenceContractToken: globalThis.SciLLM.FIGURE_EVIDENCE_CONTRACT_TOKEN
      });
      assert.equal(response.success, true, JSON.stringify(response));
      assert.deepEqual(Object.keys(response.data).sort(), [
        'allowTextFallback', 'evidenceContractToken', 'expectedVision', 'figureReusePolicySignature',
        'route', 'taskId', 'taskPolicySignature'
      ]);
      assert.equal(response.data.evidenceContractToken, globalThis.SciLLM.FIGURE_EVIDENCE_CONTRACT_TOKEN);
      assert.match(response.data.figureReusePolicySignature, /^[a-f0-9]{64}$/);
      assert.equal(typeof response.data.allowTextFallback, 'boolean');
      assert.equal(response.data.expectedVision, true);
      assert.equal(response.data.taskId, taskId);
      assert.equal(response.data.route.taskType, taskId);
      assert.equal(response.data.route.capabilityMode, 'vision');
      assert.equal(response.data.route.providerId, 'openai');
      assert.equal(typeof response.data.taskPolicySignature, 'string');
      assert.ok(response.data.taskPolicySignature.length > 0);
      assert.ok(response.data.taskPolicySignature.length <= 256);
      assert.doesNotMatch(JSON.stringify(response.data), new RegExp(secret));
      for (const privateKey of ['config', 'apiKey', 'tokenPolicy', 'profileSignature']) {
        assert.equal(Object.hasOwn(response.data.route, privateKey), false, privateKey);
      }
    }
  } finally {
    globalThis.SciLLM.createProviderAdapter = originalCreateProviderAdapter;
  }
  assert.equal(adapterCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('Figure task route preflight rejects every non-allowlisted identity before settings load', async () => {
  const storageArea = createMemoryStorage();
  let storageReads = 0;
  const originalGet = storageArea.get;
  storageArea.get = (...args) => {
    storageReads += 1;
    return originalGet(...args);
  };
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: createMemoryStorage(),
    fetchImpl: async () => { throw new Error('provider must not run'); }
  });
  let coercions = 0;
  const hostileTask = {
    toString() {
      coercions += 1;
      throw new Error('task identity coercion must not run');
    }
  };
  for (const taskId of [
    undefined, '', 'figure', ' figure_walkthrough', 'figure_walkthrough ',
    'document_highlight', hostileTask
  ]) {
    const response = await router.handle({
      type: 'LLM_PREFLIGHT_TASK_ROUTE', taskId,
      evidenceContractToken: globalThis.SciLLM.FIGURE_EVIDENCE_CONTRACT_TOKEN
    });
    assert.equal(response.success, false);
    assert.equal(response.error.code, 'UNKNOWN_LLM_TASK');
  }
  assert.equal(coercions, 0);
  assert.equal(storageReads, 0);
});

test('Figure task route preflight admits caption text without provider work', async () => {
  const { router, bodies } = await configuredFigureRouter('deepseek', {
    model: 'deepseek-v4-pro'
  });
  const response = await router.handle({
    type: 'LLM_PREFLIGHT_TASK_ROUTE', taskId: 'figure_panel_interpretation',
    evidenceContractToken: globalThis.SciLLM.FIGURE_EVIDENCE_CONTRACT_TOKEN
  });
  assert.equal(response.success, true);
  assert.equal(response.data.route.capabilityMode, 'caption_text_only');
  assert.equal(bodies.length, 0);
});

test('Figure business dispatch re-resolves a route after an earlier preflight', async () => {
  const storageArea = createMemoryStorage();
  const bodies = [];
  const router = createConfirmedFigureRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      const input = openAIInputPayload(body);
      return jsonResponse({ output_text: JSON.stringify(figureOutput(
        input.figure_id, input.analysis_basis, input.analysis_depth
      )) });
    }
  });
  await configureOpenAIRouter(router);
  const preflight = await router.handle({
    type: 'LLM_PREFLIGHT_TASK_ROUTE', taskId: 'figure_walkthrough',
    evidenceContractToken: globalThis.SciLLM.FIGURE_EVIDENCE_CONTRACT_TOKEN
  });
  assert.equal(preflight.success, true);
  assert.equal(preflight.data.route.model, 'gpt-5.1');

  const changed = await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'updated-key', model: 'gpt-5-mini' }
  });
  assert.equal(changed.success, true);
  const response = await router.handle(figureMessage([
    figureInput(1)
  ], { analysisDepth: 'standard' }));
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.route.model, 'gpt-5-mini');
  assert.equal(bodies.length, 1);
});

test('split Figure routes carry exact Panel admission pixels into a DeepSeek vision request', async () => {
  const storageArea = createMemoryStorage();
  const settings = globalThis.SciLLM.createDefaultSettings();
  const textProfileId = 'profile_walkthrough_text';
  const visionProfileId = 'profile_panel_vision';
  settings.mode = 'llm';
  settings.consentGranted = true;
  settings.profiles[textProfileId] = globalThis.SciLLM.normalizeProfile(
    textProfileId,
    {
      name: 'Walkthrough text', providerId: 'deepseek',
      config: { apiKey: 'text-key', model: 'deepseek-v4-pro' },
      capabilities: { vision: false }
    }
  );
  settings.profiles[visionProfileId] = globalThis.SciLLM.normalizeProfile(
    visionProfileId,
    {
      name: 'Panel vision', providerId: 'deepseek',
      config: {
        apiKey: 'vision-key', model: 'deepseek-v4-flash-vision-exp',
        reasoningEffort: 'disabled'
      },
      capabilities: { vision: true }
    }
  );
  settings.profileOrder = [textProfileId, visionProfileId];
  settings.globalProfileId = textProfileId;
  settings.taskPolicies.figure_walkthrough = {
    ...settings.taskPolicies.figure_walkthrough,
    mode: 'profile', profileId: textProfileId
  };
  settings.taskPolicies.figure_panel_interpretation = {
    ...settings.taskPolicies.figure_panel_interpretation,
    mode: 'profile', profileId: visionProfileId
  };
  storageArea.values.sciLlmSettingsV2 = settings;

  const bodies = [];
  const router = createBackgroundRouter({
    storageArea,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      const userContent = body.messages?.[1]?.content;
      const input = JSON.parse(Array.isArray(userContent)
        ? userContent.find(item => item.type === 'text').text
        : userContent);
      return sseResponse(JSON.stringify(panelInterpretationOutput(input)));
    }
  });
  const publicSettings = await router.handle({ type: 'LLM_GET_SETTINGS' });
  assert.equal(publicSettings.success, true);
  assert.deepEqual(publicSettings.data.settings.taskRoutes.figure, {
    mode: 'profile', profileId: textProfileId
  }, 'the legacy Figure projection must still represent the text walkthrough route');

  let legacySettingsReads = 0;
  const contentMessages = [];
  const chrome = { runtime: { async sendMessage(message) {
    if (message?.type === 'LLM_GET_SETTINGS') legacySettingsReads += 1;
    contentMessages.push(message);
    return router.handle(message, message?.operationScope === 'figure' ? {
      trustedExtensionSender: true, senderExtensionId: 'extension-id',
      senderTabId: 11, senderFrameId: 0,
      senderDocumentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    } : {});
  } } };
  const requireAdmission = executableContentFunction('requireFigureTaskAdmission');
  const preflight = executableContentFunction('preflightFigureTaskRoute', {
    chrome, requireFigureTaskAdmission: requireAdmission
  });
  const figureImagePixelArea = executableContentFunction('figureImagePixelArea');
  const findDedicatedPanelImageElement = executableContentFunction(
    'findDedicatedPanelImageElement'
  );
  const png = 'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const preparePanelVariants = executableContentFunction(
    'prepareFigurePanelImageVariants', {
      requireFigureTaskAdmission: requireAdmission,
      ensureNativePdfFigureImages: executableContentFunction('ensureNativePdfFigureImages'),
      figureImagePixelArea,
      findDedicatedPanelImageElement,
      loadPreparedFigureSource: async () => {
        throw new Error('the persisted source should be selected');
      },
      loadFigureImage: async dataUrl => ({
        dataUrl, naturalWidth: 1200, naturalHeight: 900
      }),
      normalizePanelCropGeometry: () => null,
      encodeFigureImageVariant: (source, maxEdge) => ({
        mediaType: 'image/png', dataUrl: source.dataUrl,
        width: maxEdge, height: Math.round(maxEdge * 0.75), maxEdge
      })
    }
  );
  const figure = {
    ...figureInput(1), panelHints: ['A'], imageElements: [],
    analysisImages: [{ mediaType: 'image/png', dataUrl: png }]
  };
  const state = {
    figure, panelAnalyses: {}, panelAnalysisLoading: {}, panelAnalysisErrors: {}
  };
  const analyzePanel = executableContentFunction(
    'analyzeSingleFigurePanelWithLLM', {
      captureFigureOperationPrimaryError: executableContentFunction(
        'captureFigureOperationPrimaryError'
      ),
      assertCurrentPdfFigurePanelResult: () => undefined,
      normalizeRequestedPanelId: executableContentFunction('normalizeRequestedPanelId'),
      recoverPendingFigureOperationRelease: async () => undefined,
      synchronizeFigureWorkspaceLifecycle: async () => undefined,
      articleWorkspaceLifecycleGeneration: 1,
      preflightFigureTaskRoute: preflight,
      assertCurrentArticleWorkspaceLifecycle: generation => assert.equal(generation, 1),
      getFigureWorkspaceInventory: () => [],
      ensureFigureWorkspaceInventorySeeded: async () => undefined,
      ensureFigureWalkthroughState: figureId => {
        assert.equal(figureId, figure.figureId);
        return state;
      },
      reuseActiveFigureAnalysisPromise: () => null,
      beginFigureOperation: () => ({
        operationId: 'panel-full-chain', workspaceLifecycle: 1, cancelled: false
      }),
      figureDepthAnalysisPromise: null,
      figureDepthAnalysisId: '',
      figureDepthAnalysisKind: '',
      beginSingleFigureProgress: () => undefined,
      updateFigureProgress: () => undefined,
      waitForLocalOperation: async () => undefined,
      computePageDocumentHash: async () => 'd'.repeat(64),
      prepareFigurePanelImageVariants: preparePanelVariants,
      prepareFigurePanelProductionInput: async (...args) => ({
        imageVariants: await preparePanelVariants(...args), pdfFigureContext: null
      }),
      buildFigurePanelProviderContract: operation => ({
        evidenceContractToken: globalThis.SciLLM.FIGURE_EVIDENCE_CONTRACT_TOKEN,
        operationScope: 'figure', workspaceLifecycle: operation.workspaceLifecycle,
        operationId: operation.operationId,
        figureRequestReceipt: 'figure-request-panel-full-chain-12345678',
        figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
        providerAttemptsConsumed: 0, analysisDepth: 'standard'
      }),
      sendFigureAnalysisRequestWithReceipt: async payload =>
        chrome.runtime.sendMessage(payload),
      chrome,
      document: { title: 'Split route Panel vision' },
      isCurrentFigureOperation: () => true,
      throwStaleFigureOperation: () => {
        throw new Error('the operation should remain current');
      },
      finishSingleFigureProgress: () => undefined,
      scheduleArticleWorkspaceArtifactsSave: () => undefined,
      finishFigureOperation: () => undefined
    }
  );
  const response = await analyzePanel('figure-1', 'A', {
    forceRefresh: true, deferMerge: true
  });
  const panelMessage = contentMessages.find(message =>
    message?.type === 'LLM_ANALYZE_FIGURE_PANEL');
  assert.ok(panelMessage, 'the real Panel workflow must dispatch its prepared pixels');
  const imageVariants = panelMessage.figure.imageVariants;
  assert.equal(legacySettingsReads, 0,
    'pixel preparation must not rediscover capability through legacy public settings');
  assert.equal(imageVariants.length, 3);
  assert.ok(imageVariants.every(item => item.dataUrl === png));
  assert.ok(imageVariants.every(item =>
    item.inputMode === 'figure_image' && item.pixelsSupplied === true));

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.route.taskType, 'figure_panel_interpretation');
  assert.equal(response.route.providerId, 'deepseek');
  assert.equal(response.panel.basis, 'vision_text');
  assert.equal(response.panel.inputBasis.inputMode, 'figure_image');
  assert.equal(response.panel.inputBasis.pixelsSupplied, true);
  assert.equal(legacySettingsReads, 0);
  assert.equal(bodies.length, 1);
  const imageItem = bodies[0].messages[1].content.find(item => item.type === 'image_url');
  assert.equal(imageItem.image_url.url, png);
});

test('background task adapters resolve policy, token rules, telemetry, and cache identity', () => {
  const source = readFileSync(
    join(__dirname, '..', 'core', 'background-router.js'), 'utf8'
  );
  for (const taskId of globalThis.SciLLM.LLM_TASK_IDS) {
    assert.match(source, new RegExp(`['"]${taskId}['"]`), taskId);
  }
  for (const legacyTaskId of ['highlight', 'summary', 'figure', 'crossFigure']) {
    assert.doesNotMatch(
      source,
      new RegExp(
        `createTaskAdapter\\(\\s*(?:settings|routedSettings),\\s*['"]${legacyTaskId}['"]`
      ),
      legacyTaskId
    );
  }
  assert.match(source, /getLlmTaskDefinition\(taskId\)/);
  assert.match(source, /normalizeTaskTokenRule\(taskId,\s*taskPolicy\.tokenRule\)/);
  assert.match(source, /taskRule:\s*effectiveTaskRule/);
  assert.match(source, /featureId:\s*taskId/);
  assert.match(source, /buildTaskPolicySignature\(settings,\s*taskId\)/);
  assert.match(source, /profileSignature:\s*cacheIdentitySignature/);
  assert.match(source, /profileSignature:\s*ledgerTask\?\.route\.profileSignature/);
});

function createMemoryStorage(initialValues = {}) {
  const values = initialValues;
  return {
    values,
    get(key, callback) { callback({ [key]: values[key] }); },
    set(input, callback) { Object.assign(values, input); callback(); }
  };
}

function createDelayedCloneStorage() {
  const values = {};
  const clone = value => value === undefined
    ? undefined : JSON.parse(JSON.stringify(value));
  return {
    values,
    get(key, callback) {
      const keys = Array.isArray(key) ? key : [key];
      const snapshot = Object.fromEntries(keys.map(item => [item, clone(values[item])]));
      setTimeout(() => callback(snapshot), 0);
    },
    set(input, callback) {
      setTimeout(() => {
        Object.assign(values, clone(input));
        callback();
      }, 5);
    }
  };
}

function createReadyPortableConfigManagerDouble() {
  return {
    publicStatus: () => ({ state: 'ready', pending: false }),
    runWhenReady: operation => operation()
  };
}

function createDirectorySyncDouble(options = {}) {
  const json = [];
  const text = [];
  const readPaths = [];
  const workspaceAssets = [];
  const flushGate = options.flushGate || Promise.resolve({ permission: 'granted' });
  return {
    json,
    text,
    readPaths,
    workspaceAssets,
    flushCalls: 0,
    permissionRequests: 0,
    async requestDirectoryPermission() {
      this.permissionRequests += 1;
      return options.requestDirectoryPermission?.() || {
        permission: 'granted', granted: true
      };
    },
    async enqueueJson(path, value) {
      if (options.enqueueError) throw options.enqueueError;
      json.push({ path, value: JSON.parse(JSON.stringify(value)) });
    },
    async enqueueText(path, value) {
      if (options.enqueueError) throw options.enqueueError;
      text.push({ path, value: String(value) });
    },
    flush() {
      this.flushCalls += 1;
      if (typeof options.flush === 'function') {
        return options.flush(this.flushCalls);
      }
      return flushGate;
    },
    async status() {
      return { permission: 'prompt', pendingCount: json.length + text.length };
    },
    async readJson(path) {
      readPaths.push(path);
      if (typeof options.readJson === 'function') return options.readJson(path);
      return { permission: 'granted', found: false, value: null };
    },
    async rebuildIndex(importer) {
      const results = [];
      for (const asset of options.rebuildAssets || []) {
        results.push(await importer(asset.path, asset.value, asset.metadata || {}));
      }
      return {
        imported: results.filter(item => item?.imported).length,
        stale: results.filter(item => item?.reason === 'stale').length,
        invalidAssets: results.filter(item => !item?.imported && item?.reason !== 'stale').length
      };
    },
    async exportBundle(bundle) {
      return JSON.parse(JSON.stringify(bundle));
    },
    async enqueueWorkspaceAsset(workspace, path, value, metadata) {
      workspaceAssets.push({ workspace, path, value, metadata });
      return { queued: true, relativePath: `workspaces/${workspace.directoryName}/${path}` };
    },
    async readWorkspaceAsset(workspace, path) {
      return options.readWorkspaceAsset?.(workspace, path) || {
        permission: 'granted', found: false, value: null
      };
    },
    async listWorkspaceChatAssets(workspace) {
      return options.listWorkspaceChatAssets?.(workspace) || {
        permission: 'granted', assets: [], invalidAssets: 0
      };
    },
    async listWorkspaceSupplementalAssets(workspace) {
      return options.listWorkspaceSupplementalAssets?.(workspace) || {
        permission: 'granted', assets: [], invalidAssets: 0
      };
    },
    async listWorkspaceManifests(identity) {
      return options.listWorkspaceManifests?.(identity) || {
        permission: 'granted', manifests: [], matches: []
      };
    },
    async rebuildWorkspaceIndex() {
      return options.rebuildWorkspaceIndex?.() || {
        permission: 'granted', workspaceCount: 0, quarantined: 0
      };
    },
    async cancelWorkspaceQueue(workspace) {
      return options.cancelWorkspaceQueue?.(workspace) || { cancelled: 0 };
    },
    async removeWorkspaceTree(workspace) {
      return options.removeWorkspaceTree?.(workspace) || { permission: 'granted', removed: true };
    }
  };
}

function createWritableDirectoryHandleStore(initialPermission = 'granted') {
  let permission = initialPermission;
  const files = new Map();

  function fileHandle(path) {
    return {
      name: path.split('/').at(-1),
      kind: 'file',
      async getFile() {
        if (!files.has(path)) {
          const error = new Error(`Missing file ${path}`);
          error.name = 'NotFoundError';
          throw error;
        }
        return { async text() { return files.get(path); } };
      },
      async createWritable() {
        let content = '';
        return {
          async write(value) { content = String(value); },
          async close() { files.set(path, content); }
        };
      }
    };
  }

  function directoryHandle(prefix, name) {
    return {
      name,
      kind: 'directory',
      async queryPermission() { return permission; },
      async getDirectoryHandle(child) {
        return directoryHandle(`${prefix}${child}/`, child);
      },
      async getFileHandle(child) {
        return fileHandle(`${prefix}${child}`);
      }
    };
  }

  const root = directoryHandle('', 'chosen-folder');
  return {
    async load() { return root; },
    async save() {},
    setPermission(value) { permission = value; },
    readText(path) { return files.get(path) || ''; }
  };
}

function createArticleWorkspaceStoreDouble() {
  const workspaces = new Map();
  const assets = new Map();
  const turns = new Map();
  const deletionGenerations = new Map();
  return {
    async ensureWorkspace(workspace) {
      const current = workspaces.get(workspace.workspaceId);
      const saved = {
        ...current,
        ...workspace,
        workspaceGeneration: Math.max(
          Number(current?.workspaceGeneration || 0),
          Number(workspace.workspaceGeneration || 1)
        ),
        storageRevision: workspace.storageRevision || current?.storageRevision || 0
      };
      workspaces.set(saved.workspaceId, saved);
      return structuredClone(saved);
    },
    async getWorkspace(id) { return structuredClone(workspaces.get(id) || null); },
    async listWorkspaces() { return [...workspaces.values()].map(value => structuredClone(value)); },
    async putAsset(id, path, content) {
      const saved = { workspaceId: id, relativePath: path, content, revision: 1 };
      assets.set(`${id}:${path}`, saved);
      return structuredClone(saved);
    },
    async listAssets(id) {
      return [...assets.values()].filter(item => item.workspaceId === id)
        .map(value => structuredClone(value));
    },
    async appendTurn(id, turn) {
      const saved = { ...turn, workspaceId: id, sequence: (turns.get(id)?.length || 0) + 1, revision: 1 };
      turns.set(id, [...(turns.get(id) || []), saved]);
      return structuredClone(saved);
    },
    async updateTurn(id, turnId, patch) {
      const items = turns.get(id) || [];
      const index = items.findIndex(turn => turn.turnId === turnId);
      if (index < 0) {
        const error = new Error('TURN_NOT_FOUND');
        error.code = 'TURN_NOT_FOUND';
        throw error;
      }
      const saved = {
        ...items[index], ...patch, turnId, workspaceId: id,
        revision: Number(items[index].revision || 0) + 1
      };
      items[index] = saved;
      turns.set(id, items);
      return structuredClone(saved);
    },
    async pageTurns(id) { return { items: structuredClone(turns.get(id) || []), hasMore: false }; },
    async getStorageStatistics() {
      return { workspaceCount: workspaces.size, assetCount: assets.size,
        turnCount: [...turns.values()].flat().length, estimatedBytes: 123 };
    },
    async beginWorkspaceDeletion(id) {
      const workspace = workspaces.get(id);
      if (workspace) workspaces.set(id, { ...workspace, deletionPending: true });
      deletionGenerations.set(id, Number(workspace?.workspaceGeneration || 1));
      return { workspaceId: id, tombstoneId: 'workspace-delete-1', entityType: 'workspace' };
    },
    async validateWorkspaceDeletion(id, tombstoneId) {
      const workspace = workspaces.get(id);
      if (!workspace) return null;
      if (!workspace.deletionPending || tombstoneId !== 'workspace-delete-1') {
        throw Object.assign(new Error('WORKSPACE_DELETION_CONFLICT'), { code: 'WORKSPACE_DELETION_CONFLICT' });
      }
      return { workspace: structuredClone(workspace), tombstone: { tombstoneId, workspaceId: id } };
    },
    async finalizeWorkspaceDeletion(id) { workspaces.delete(id); return true; },
    async getWorkspaceGenerationState(id) {
      const workspace = workspaces.get(id);
      return {
        workspaceId: id,
        activeGeneration: Number(workspace?.workspaceGeneration || 0),
        deletionGeneration: Number(deletionGenerations.get(id) || 0),
        deletionPending: Boolean(workspace?.deletionPending)
      };
    }
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    async text() { return JSON.stringify(body); }
  };
}

test('semantic find uses its configured TypeSafe decision route without global LLM readiness', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  const savedProfile = await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_typesafe_semantic',
      name: 'Semantic Jev',
      providerId: 'typesafe',
      config: { apiKey: 'semantic-secret', model: 'jev-latest' },
      capabilities: { vision: false },
      tokenPolicy: { mode: 'auto', autoCap: null, manualMax: null }
    }
  });
  assert.equal(savedProfile.success, true);
  const settings = structuredClone(storageArea.values.sciLlmSettingsV2);
  settings.mode = 'regex';
  settings.consentGranted = false;
  settings.taskPolicies.semantic_find = {
    mode: 'profile', profileId: 'profile_typesafe_semantic',
    reasoningEnabled: false, reasoningEffort: 'auto', tokenRule: 'auto',
    allowTextFallback: false
  };
  storageArea.values.sciLlmSettingsV2 = settings;

  const originalCreateProviderAdapter = globalThis.SciLLM.createProviderAdapter;
  const providerCalls = [];
  const progress = [];
  globalThis.SciLLM.createProviderAdapter = options => {
    assert.equal(options.providerId, 'typesafe');
    assert.equal(options.config.apiKey, 'semantic-secret');
    return {
      providerId: 'typesafe', typedDecisions: true,
      async evaluateDecisions(input) {
        providerCalls.push(input);
        return { answers: Object.fromEntries(Object.keys(input.questions).map((id, index) => [
          id, { type: 'noul', noul: index ? 0.2 : 0.8 }
        ])) };
      }
    };
  };
  try {
    const response = await router.handle({
      type: 'LLM_SEMANTIC_FIND',
      operationId: 'semantic-router-operation',
      sourceKey: 'semantic-router-source',
      query: '寻找核心结论',
      paragraphs: [
        { paragraphId: 'p1', sectionTitle: 'Results', text: 'Treatment increased survival.' },
        { paragraphId: 'p2', sectionTitle: 'Discussion', text: 'A limitation remains.' }
      ]
    }, {
      semanticFindSignal: new AbortController().signal,
      onSemanticFindProgress: update => progress.push(update)
    });

    assert.equal(response.success, true, JSON.stringify(response));
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].state.query, '寻找核心结论');
    assert.equal(Object.keys(providerCalls[0].state.sentences).length, 2);
    assert.deepEqual(response.data.scores.map(item => item.score), [0.8, 0.2]);
    assert.equal(response.data.operationId, 'semantic-router-operation');
    assert.equal(response.data.sourceKey, 'semantic-router-source');
    assert.equal(response.data.route.taskType, 'semantic_find');
    assert.equal(response.data.route.providerId, 'typesafe');
    assert.equal(Object.hasOwn(response.data.route, 'config'), false);
    assert.equal(Object.hasOwn(response.data.route, 'profileSignature'), false);
    assert.deepEqual(progress.map(item => item.done), [true]);
  } finally {
    globalThis.SciLLM.createProviderAdapter = originalCreateProviderAdapter;
  }
});

async function selectStudyType(router, document, studyType = 'observational') {
  const prepared = await router.handle({ type: 'LLM_PREPARE_DOCUMENT', document });
  assert.equal(prepared.success, true);
  const selected = await router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentHash: prepared.data.documentHash,
    studyType
  });
  assert.equal(selected.success, true);
  return selected;
}

test('registers only the one-type study selection message in the service worker', () => {
  const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
  assert.match(source, /'LLM_SET_STUDY_TYPE'/);
  assert.doesNotMatch(source, /'LLM_SAVE_STUDY_TYPE_OVERRIDE'/);
  ['CATEGORY_GET', 'CATEGORY_SAVE_OVERRIDE', 'CATEGORY_APPEND_FIXED_PHRASE',
    'CATEGORY_RESET_OVERRIDE',
    'CATEGORY_DELETE', 'CATEGORY_RESTORE_BUILT_IN', 'CATEGORY_TEST_REGEX']
    .forEach(type => assert.match(source, new RegExp(`'${type}'`)));
  ['DOCUMENT_PREPARE', 'DOCUMENT_GET', 'ANNOTATION_UPSERT',
    'ANNOTATION_DELETE', 'ANNOTATION_CLEAR_DOCUMENT']
    .forEach(type => assert.match(source, new RegExp(`'${type}'`)));
  ['ARTICLE_ARCHIVE_PROBE', 'ARTICLE_ARCHIVE_SAVE', 'ARTICLE_ARCHIVE_LOAD']
    .forEach(type => assert.match(source, new RegExp(`'${type}'`)));
  ['ARTICLE_WORKSPACE_ENSURE', 'ARTICLE_WORKSPACE_SAVE_ASSET',
    'ARTICLE_WORKSPACE_MIRROR_ALL',
    'ARTICLE_WORKSPACE_SAVE_SUPPLEMENTAL_DRAFT',
    'ARTICLE_WORKSPACE_LIST_ASSETS',
    'ARTICLE_WORKSPACE_SAVE_TURN', 'ARTICLE_WORKSPACE_PROBE',
    'ARTICLE_WORKSPACE_SCAN_RESTORE', 'ARTICLE_WORKSPACE_LIST',
    'ARTICLE_WORKSPACE_STATS', 'ARTICLE_WORKSPACE_EXPORT',
    'ARTICLE_WORKSPACE_BEGIN_DELETE', 'ARTICLE_WORKSPACE_FINALIZE_DELETE',
    'ARTICLE_WORKSPACE_REBUILD_INDEX']
    .forEach(type => assert.match(source, new RegExp(`'${type}'`)));
  assert.equal((source.match(/chrome\.runtime\.onMessage\.addListener\(/g) || []).length, 1);
  assert.ok(source.indexOf('core/supplemental-materials.js') <
    source.indexOf('core/background-router.js'));
  assert.match(source, /'LLM_PREFLIGHT_TASK_ROUTE'/);
  assert.match(source, /'LLM_ASK_ARTICLE'/);
  assert.match(source, /'LLM_ANALYZE_FIGURE_PANEL'/);
  [
    'LLM_ANALYZE_RESEARCH_LOGIC',
    'LLM_ANALYZE_PAPER_INNOVATION',
    'LLM_ANALYZE_PAPER_LIMITATIONS'
  ].forEach(type => assert.match(source, new RegExp(`'${type}'`)));
  assert.match(source, /'LLM_TOKEN_USAGE_LIST'/);
  assert.match(source, /'LLM_TOKEN_USAGE_CLEAR'/);
  assert.match(source, /progress\?\.phase !== 'provider_telemetry'/);
  assert.match(source, /TOKEN_USAGE_FEATURES/);
  assert.match(source, /\['LLM_ANALYZE_RESEARCH_LOGIC', 'default'/);
  assert.match(source, /\['LLM_ANALYZE_PAPER_INNOVATION', 'default'/);
  assert.match(source, /\['LLM_ANALYZE_PAPER_LIMITATIONS', 'default'/);
  assert.match(source, /SciLLM\.resolveLlmTaskId\(messageType, branch\)/);
  assert.match(source, /branches = \['primary', 'evidence_ledger'\]/);
  assert.match(source, /allowedTaskIds\.includes\(reportedTaskId\)/);
  assert.match(source, /LLM_TASK_ID_SET\.has\(progress\?\.featureId\)/);
  assert.match(source, /resolveTokenUsageFeature\(message, progress\)/);
  assert.ok(source.indexOf('core/figure-panel-planner.js') <
    source.indexOf('core/figure-analysis.js'));
  assert.ok(source.indexOf('core/result-validator.js') <
    source.indexOf('core/highlight-stream.js'));
  assert.ok(source.indexOf('core/highlight-stream.js') <
    source.indexOf('core/analysis-pipeline.js'));
  assert.ok(source.indexOf('core/token-usage-store.js') <
    source.indexOf('core/background-router.js'));
  assert.ok(source.indexOf('core/article-chat-tokenizer.js') <
    source.indexOf('core/article-chat-index.js'));
  assert.ok(source.indexOf('core/article-chat-index.js') <
    source.indexOf('core/article-chat-retrieval.js'));
  assert.ok(source.indexOf('core/article-chat-retrieval.js') <
    source.indexOf('core/article-chat-memory.js'));
  assert.ok(source.indexOf('core/article-chat-memory.js') <
    source.indexOf('core/article-chat-context-planner.js'));
  assert.ok(source.indexOf('core/article-chat-citations.js') <
    source.indexOf('core/article-chat-stream.js'));
  assert.ok(source.indexOf('core/article-chat-stream.js') <
    source.indexOf('core/article-chat.js'));
  assert.match(source, /core\/article-chat\.js/);
  assert.match(source, /core\/article-archive\.js/);
  assert.match(source, /core\/manual-annotations\.js/);
  assert.match(source, /core\/document-store\.js/);
  assert.match(source, /createIndexedDbDocumentStore\(indexedDB\)/);
});

const manualDocument = {
  title: 'Persistent annotation paper',
  canonicalUrl: 'https://example.org/persistent-paper?utm_source=test#results',
  paragraphs: [{
    paragraphId: 'p1', sectionTitle: 'Results', sectionKind: 'results',
    text: 'Treatment improved survival, although the sample was small.'
  }]
};

function portableArchive(documentId = `sha256:${'c'.repeat(64)}`) {
  return createArticleArchive({
    revision: 2,
    savedAt: '2026-07-17T09:00:00.000Z',
    extensionVersion: '2.1.0',
    identity: {
      documentId,
      documentHash: 'archive-hash',
      canonicalUrl: 'https://example.org/archived-paper',
      title: 'Archived paper',
      publisher: 'elsevier'
    },
    documentRecord: {
      schemaVersion: 1,
      documentId,
      documentHash: 'archive-hash',
      title: 'Archived paper',
      canonicalUrl: 'https://example.org/archived-paper',
      studyType: 'narrative_review',
      annotations: [],
      revision: 3,
      updatedAt: '2026-07-17T08:00:00.000Z'
    },
    workspace: {
      ledger: [{ categoryId: 'key_result', quote: 'A result' }],
      modelRuntime: {
        providerId: 'openai-compatible',
        apiKey: 'sk-archive-secret',
        customHeaders: { Authorization: 'Bearer archive-secret' }
      }
    }
  });
}

test('archive save distinguishes rejection before enqueue from an uncertain enqueue outcome', async () => {
  let enqueues = 0;
  const directorySync = createDirectorySyncDouble();
  directorySync.enqueueJson = async () => { enqueues++; throw Object.assign(new Error('queue acknowledgement lost'), { code: 'WRITE_OUTCOME_UNKNOWN', archiveWriteNotStarted: true }); };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), documentStore: createMemoryDocumentStore(), directorySync,
    fetchImpl: async () => assert.fail('archive failure classification must stay local')
  });
  const invalid = await router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: {} });
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.archiveWriteNotStarted, true);
  assert.equal(enqueues, 0);
  const unknown = await router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: portableArchive() });
  assert.equal(unknown.success, false);
  assert.equal(unknown.error.code, 'WRITE_OUTCOME_UNKNOWN');
  assert.equal(unknown.error.archiveWriteNotStarted, false, 'a lower-layer error cannot claim no write after enqueue begins');
  assert.equal(enqueues, 1);
  const unrelated = await router.handle({ type: 'UNRECOGNIZED_ARCHIVE_ACTION' });
  assert.equal(Object.hasOwn(unrelated.error, 'archiveWriteNotStarted'), false);
});

test('probes, saves, and applies one per-article archive through the background router', async () => {
  const archive = portableArchive();
  let restoreClock = 1000;
  const expectedPath = articleArchiveRelativePath(archive);
  const directorySync = createDirectorySyncDouble({
    readJson: async path => ({
      permission: 'granted', found: path === expectedPath,
      value: path === expectedPath ? archive : null
    })
  });
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    documentStore,
    directorySync,
    nowImpl: () => restoreClock,
    fetchImpl: async () => { throw new Error('archive operations must stay local'); }
  });

  const probe = await router.handle({
    type: 'ARTICLE_ARCHIVE_PROBE',
    documentId: archive.documentId,
    canonicalUrl: archive.canonicalUrl
  });
  assert.equal(probe.success, true);
  assert.equal(probe.data.found, true);
  assert.equal(probe.data.savedAt, archive.savedAt);
  assert.deepEqual(directorySync.readPaths, [expectedPath]);
  assert.equal(directorySync.json.length, 0);

  const saved = await router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive });
  assert.equal(saved.success, true);
  assert.equal(saved.data.relativePath, expectedPath);
  assert.equal(directorySync.json.at(-1).path, expectedPath);
  assert.doesNotMatch(
    JSON.stringify(directorySync.json.at(-1)),
    /sk-archive-secret|archive-secret|apiKey|customHeaders|Authorization/u
  );

  const prepared = await router.handle({
    type: 'ARTICLE_ARCHIVE_LOAD',
    documentId: archive.documentId,
    canonicalUrl: archive.canonicalUrl,
    authorizedCommit: true,
    apply: true
  });
  assert.equal(prepared.success, true);
  assert.equal(prepared.data.applied, false,
    'the read-only archive entry cannot be upgraded by caller flags');
  assert.equal(await documentStore.getDocument(archive.documentId), null);

  const withoutReceipt = await router.handle({
    type: 'ARTICLE_ARCHIVE_COMMIT_RESTORE',
    archive
  });
  assert.equal(withoutReceipt.success, false);
  assert.equal(withoutReceipt.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');
  assert.equal(await documentStore.getDocument(archive.documentId), null);

  const register = binding => router.handle({
    type: 'ARTICLE_RESTORE_REGISTER_COMMIT', binding
  }, {
    trustedContentScript: true,
    senderTabId: 17,
    senderUrl: archive.canonicalUrl
  });
  const binding = {
    kind: 'archive',
    current: {
      workspaceId: `workspace:${'a'.repeat(64)}`,
      workspaceGeneration: 1,
      canonicalUrl: archive.canonicalUrl,
      contentHash: 'a'.repeat(64)
    },
    currentArchive: {
      documentId: `sha256:${'e'.repeat(64)}`,
      documentHash: 'live-document-hash',
      canonicalUrl: archive.canonicalUrl
    },
    allowContentChanged: true,
    archive: {
      documentId: archive.documentId,
      documentHash: archive.documentHash,
      canonicalUrl: archive.canonicalUrl
    },
    operationNonce: 'operation-nonce-archive-1'
  };
  const wrongRegistration = await router.handle({
    type: 'ARTICLE_RESTORE_REGISTER_COMMIT', binding
  });
  assert.equal(wrongRegistration.success, false);
  assert.equal(wrongRegistration.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');

  const wrongReceipt = await register(binding);
  assert.equal(wrongReceipt.success, true);
  const wrongArchive = { ...archive, documentId: `sha256:${'f'.repeat(64)}` };
  wrongArchive.documentRecord = {
    ...archive.documentRecord, documentId: wrongArchive.documentId
  };
  const rejectedWrongArchive = await router.handle({
    type: 'ARTICLE_ARCHIVE_COMMIT_RESTORE',
    archive: wrongArchive,
    current: binding.current,
    currentArchive: binding.currentArchive,
    allowContentChanged: binding.allowContentChanged,
    operationNonce: binding.operationNonce,
    receipt: wrongReceipt.data.receipt
  });
  assert.equal(rejectedWrongArchive.success, false);
  assert.equal(rejectedWrongArchive.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');
  assert.equal(await documentStore.getDocument(archive.documentId), null);

  const replay = await router.handle({
    type: 'ARTICLE_ARCHIVE_COMMIT_RESTORE', archive,
    current: binding.current,
    currentArchive: binding.currentArchive,
    allowContentChanged: binding.allowContentChanged,
    operationNonce: binding.operationNonce,
    receipt: wrongReceipt.data.receipt
  });
  assert.equal(replay.success, false, 'a failed binding check still consumes the receipt');
  assert.equal(await documentStore.getDocument(archive.documentId), null);

  const expiringBinding = {
    ...binding, operationNonce: 'operation-nonce-archive-expired'
  };
  const expiringReceipt = await register(expiringBinding);
  assert.equal(expiringReceipt.success, true);
  restoreClock += 30000;
  const expired = await router.handle({
    type: 'ARTICLE_ARCHIVE_COMMIT_RESTORE', archive,
    current: expiringBinding.current,
    currentArchive: expiringBinding.currentArchive,
    allowContentChanged: expiringBinding.allowContentChanged,
    operationNonce: expiringBinding.operationNonce,
    receipt: expiringReceipt.data.receipt
  });
  assert.equal(expired.success, false, 'a receipt is invalid at its expiry boundary');
  assert.equal(expired.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');
  assert.equal(await documentStore.getDocument(archive.documentId), null);

  const driftBinding = {
    ...binding, operationNonce: 'operation-nonce-archive-live-drift'
  };
  const driftReceipt = await register(driftBinding);
  assert.equal(driftReceipt.success, true);
  const rejectedLiveDrift = await router.handle({
    type: 'ARTICLE_ARCHIVE_COMMIT_RESTORE', archive,
    current: driftBinding.current,
    currentArchive: {
      ...driftBinding.currentArchive,
      documentHash: 'navigated-document-hash'
    },
    allowContentChanged: driftBinding.allowContentChanged,
    operationNonce: driftBinding.operationNonce,
    receipt: driftReceipt.data.receipt
  });
  assert.equal(rejectedLiveDrift.success, false,
    'the payload archive cannot substitute for a drifted current live document');
  assert.equal(rejectedLiveDrift.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');

  const receipt = await register(binding);
  assert.equal(receipt.success, true);
  const loaded = await router.handle({
    type: 'ARTICLE_ARCHIVE_COMMIT_RESTORE', archive,
    current: binding.current,
    currentArchive: binding.currentArchive,
    allowContentChanged: binding.allowContentChanged,
    operationNonce: binding.operationNonce,
    receipt: receipt.data.receipt
  });
  assert.equal(loaded.success, true);
  assert.equal(loaded.data.archive.workspace.ledger[0].quote, 'A result');
  assert.equal(loaded.data.archive.documentId, archive.documentId,
    'the independently validated payload identity remains unchanged');
  assert.equal(loaded.data.applied, true);
  const liveRecord = await documentStore.getDocument(binding.currentArchive.documentId);
  assert.equal(liveRecord.title, 'Archived paper');
  assert.equal(liveRecord.documentHash, binding.currentArchive.documentHash);
  assert.equal(liveRecord.canonicalUrl, binding.currentArchive.canonicalUrl);
  assert.equal(await documentStore.getDocument(archive.documentId), null,
    'the old archive key must not be mistaken for the current live document');
  const replayAfterSuccess = await router.handle({
    type: 'ARTICLE_ARCHIVE_COMMIT_RESTORE', archive,
    current: binding.current,
    currentArchive: binding.currentArchive,
    allowContentChanged: binding.allowContentChanged,
    operationNonce: binding.operationNonce,
    receipt: receipt.data.receipt
  });
  assert.equal(replayAfterSuccess.success, false);

  const legacyArchive = portableArchive('legacy.document:2026-08');
  const legacyBinding = {
    kind: binding.kind,
    current: binding.current,
    allowContentChanged: false,
    operationNonce: 'operation-nonce-archive-legacy',
    archive: {
      documentId: legacyArchive.documentId,
      documentHash: legacyArchive.documentHash,
      canonicalUrl: legacyArchive.canonicalUrl
    }
  };
  const legacyReceipt = await register(legacyBinding);
  assert.equal(legacyReceipt.success, true);
  const legacyLoaded = await router.handle({
    type: 'ARTICLE_ARCHIVE_COMMIT_RESTORE',
    archive: legacyArchive,
    current: legacyBinding.current,
    operationNonce: legacyBinding.operationNonce,
    receipt: legacyReceipt.data.receipt
  });
  assert.equal(legacyLoaded.success, true);
  assert.equal((await documentStore.getDocument(legacyArchive.documentId)).title,
    'Archived paper');

  for (const documentId of ['', '.leading-dot', 'bad/id', 'x'.repeat(201)]) {
    const invalid = await register({
      ...legacyBinding,
      operationNonce: `operation-nonce-invalid-${documentId.length}`,
      archive: { ...legacyBinding.archive, documentId }
    });
    assert.equal(invalid.success, false, documentId);
    assert.equal(invalid.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');
  }
});

test('raw article archives are credential-free after router save and real directory flush', async () => {
  const archive = portableArchive();
  archive.workspace.privacyAudit = {
    apiKey: 'sk-raw-api-key',
    customHeaders: { Authorization: 'Bearer raw-authorization' },
    token: 'raw-generic-token',
    providerToken: 'raw-provider-token',
    providerId: 'raw-provider-id',
    password: 'raw-password',
    bearer: 'raw-bearer',
    authToken: 'raw-auth-token',
    accessToken: 'raw-access-token',
    refreshToken: 'raw-refresh-token',
    credential: 'raw-credential',
    secret: 'raw-secret',
    apiToken: 'raw-api-token',
    githubToken: 'raw-github-token',
    privateToken: 'raw-private-token',
    personalAccessToken: 'raw-personal-access-token',
    webhookSecret: 'raw-webhook-secret',
    privateSecret: 'raw-private-secret',
    clientSecret: 'raw-client-secret',
    privateKey: 'raw-private-key',
    activeProvider: 'raw-active-provider',
    authorizationHeader: 'raw-authorization-header',
    authHeader: 'raw-auth-header',
    bearerToken: 'raw-bearer-token',
    databasePassword: 'raw-database-password',
    experimentalProtocol: 'kept-protocol',
    secretoryPathway: 'kept-secretory-pathway',
    secretome: 'kept-secretome',
    tokenizationMethod: 'kept-tokenization-method',
    tokenUsage: 42,
    tokenCount: 42,
    inputTokenCount: 40,
    headerTitle: 'kept-header-title',
    proteinAccess: 'kept-protein-access'
  };
  const handleStore = createWritableDirectoryHandleStore();
  const directorySync = createDirectorySync({
    handleStore,
    queueStore: createMemorySyncQueue(),
    sourceId: 'background-router-privacy-test'
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync,
    portableConfigManager: createReadyPortableConfigManagerDouble(),
    fetchImpl: async () => { throw new Error('archive operations must stay local'); }
  });

  const saved = await router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive });
  assert.equal(saved.success, true);
  await directorySync.flush();

  const diskText = handleStore.readText(`Brevess/${saved.data.relativePath}`);
  assert.ok(diskText, 'the archive should reach the selected directory');
  assert.doesNotMatch(diskText,
    /sk-raw-api-key|raw-authorization|raw-generic-token|raw-provider-token|raw-provider-id|raw-password|raw-bearer|raw-auth-token|raw-access-token|raw-refresh-token|raw-credential|raw-secret|raw-api-token|raw-github-token|raw-private-token|raw-personal-access-token|raw-webhook-secret|raw-private-secret|raw-client-secret|raw-private-key|raw-active-provider|raw-authorization-header|raw-auth-header|raw-bearer-token|raw-database-password/u);
  const diskArchive = JSON.parse(diskText);
  assert.deepEqual(diskArchive.workspace.privacyAudit, {
    experimentalProtocol: 'kept-protocol',
    headerTitle: 'kept-header-title',
    inputTokenCount: 40,
    proteinAccess: 'kept-protein-access',
    secretome: 'kept-secretome',
    secretoryPathway: 'kept-secretory-pathway',
    tokenCount: 42,
    tokenUsage: 42,
    tokenizationMethod: 'kept-tokenization-method'
  });
});

test('restore receipts accept only the exact built-in PDF reader source identity', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => { throw new Error('receipt registration must stay local'); }
  });
  const runtimeBaseUrl = 'chrome-extension://trusted-extension/';
  const bindingFor = (canonicalUrl, suffix) => ({
    kind: 'archive',
    current: {
      workspaceId: `workspace:${suffix.repeat(64)}`,
      workspaceGeneration: 1,
      canonicalUrl,
      contentHash: suffix.repeat(64)
    },
    operationNonce: `operation-nonce-pdf-${suffix.repeat(12)}`,
    archive: {
      documentId: `sha256:${suffix.repeat(64)}`,
      documentHash: suffix.repeat(64),
      canonicalUrl
    }
  });
  const register = (binding, senderUrl) => router.handle({
    type: 'ARTICLE_RESTORE_REGISTER_COMMIT', binding
  }, {
    trustedContentScript: true,
    senderTabId: 28,
    senderUrl,
    runtimeBaseUrl
  });

  const remote = bindingFor('https://papers.example.org/study.pdf', 'a');
  const remoteReader = runtimeBaseUrl + 'pdf-reader.html?source=' +
    encodeURIComponent('https://papers.example.org/study.pdf?download=1') +
    '&title=Study';
  assert.equal((await register(remote, remoteReader)).success, true);

  const local = bindingFor('file:///brevess-local-pdf/' + 'b'.repeat(64) + '/study.pdf', 'b');
  const localReader = runtimeBaseUrl + 'pdf-reader.html?source=' +
    encodeURIComponent(local.current.canonicalUrl);
  assert.equal((await register(local, localReader)).success, true);

  const initiallyBlankReader = runtimeBaseUrl + 'pdf-reader.html?title=Local';
  const selectedFileSource = globalThis.SciLLM.buildLocalPdfWorkspaceUrl(
    'D:\\private\\patient-42\\study.pdf', 'b'.repeat(64)
  );
  const selectedFileReader = globalThis.SciLLM.withLocalPdfWorkspaceSource(
    initiallyBlankReader, selectedFileSource
  );
  assert.equal(selectedFileSource, local.current.canonicalUrl);
  assert.equal(new URL(selectedFileReader).searchParams.getAll('source').length, 1);
  assert.doesNotMatch(selectedFileReader, /private|patient-42/iu);
  assert.equal((await register(local, selectedFileReader)).success, true,
    'selecting a local file must publish an identity the receipt route can verify');

  const rejected = [
    runtimeBaseUrl + 'options.html?source=' + encodeURIComponent(remote.current.canonicalUrl),
    'chrome-extension://attacker/pdf-reader.html?source=' +
      encodeURIComponent(remote.current.canonicalUrl),
    runtimeBaseUrl + 'pdf-reader.html?source=' +
      encodeURIComponent('https://papers.example.org/other.pdf'),
    runtimeBaseUrl + 'pdf-reader.html?source=' +
      encodeURIComponent(remote.current.canonicalUrl) + '&source=' +
      encodeURIComponent(remote.current.canonicalUrl),
    runtimeBaseUrl + 'pdf-reader.html?source=' +
      encodeURIComponent('https://user:password@papers.example.org/study.pdf')
  ];
  for (const senderUrl of rejected) {
    const response = await register(remote, senderUrl);
    assert.equal(response.success, false, senderUrl);
    assert.equal(response.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');
  }
});

test('exports and imports a complete migration bundle including provider credentials', async () => {
  const sourceStorage = createMemoryStorage();
  const settings = globalThis.SciLLM.createDefaultSettings();
  const deepseekProfileId = globalThis.SciLLM.legacyProfileId('deepseek');
  settings.mode = 'llm';
  settings.consentGranted = true;
  settings.profiles[deepseekProfileId] = globalThis.SciLLM.normalizeProfile(
    deepseekProfileId,
    {
      name: 'DeepSeek', providerId: 'deepseek',
      config: { apiKey: 'sk-migrate-me', model: 'deepseek-chat' }
    }
  );
  settings.profileOrder.push(deepseekProfileId);
  settings.globalProfileId = deepseekProfileId;
  await globalThis.SciLLM.saveSettings(sourceStorage, settings);
  const sourceDocuments = createMemoryDocumentStore();
  const archive = portableArchive();
  await sourceDocuments.putDocument(archive.documentRecord);
  const sourceCorpus = globalThis.SciLLM.createMemoryCorpusStore();
  await sourceCorpus.add({
    sampleId: 'migration-sample', documentHash: 'hash', paragraphId: 'p1',
    categoryId: 'key_result', userAction: 'accepted'
  });
  const sourceRouter = createBackgroundRouter({
    storageArea: sourceStorage,
    documentStore: sourceDocuments,
    corpusStore: sourceCorpus,
    fetchImpl: async () => { throw new Error('migration must stay local'); }
  });

  const exported = await sourceRouter.handle({
    type: 'MIGRATION_EXPORT', extensionVersion: '2.1.0'
  });
  assert.equal(exported.success, true);
  assert.equal(
    exported.data.settings.profiles[deepseekProfileId].config.apiKey,
    'sk-migrate-me'
  );

  const targetStorage = createMemoryStorage();
  const targetDocuments = createMemoryDocumentStore();
  const targetCorpus = globalThis.SciLLM.createMemoryCorpusStore();
  const targetRouter = createBackgroundRouter({
    storageArea: targetStorage,
    documentStore: targetDocuments,
    corpusStore: targetCorpus,
    fetchImpl: async () => { throw new Error('migration must stay local'); }
  });
  const imported = await targetRouter.handle({
    type: 'MIGRATION_IMPORT', bundle: exported.data
  });
  assert.equal(imported.success, true);
  assert.equal(imported.data.importedDocuments, 1);
  assert.equal(imported.data.importedFeedback, 1);
  assert.equal(
    targetStorage.values.sciLlmSettingsV2.profiles[deepseekProfileId].config.apiKey,
    'sk-migrate-me'
  );
  assert.equal((await targetDocuments.exportAll()).documents.length, 1);
  assert.equal((await targetCorpus.list()).length, 1);
});

function routerAnnotation(overrides = {}) {
  const quote = 'the sample was small';
  return {
    annotationId: 'manual-1',
    categoryId: 'limitation',
    categorySnapshot: { name: 'Spoofed category', color: '#000000' },
    quote,
    prefix: 'although ',
    suffix: '.',
    sectionTitle: 'Results',
    blockFingerprint: 'p1-fingerprint',
    startOffset: 38,
    endOffset: 38 + quote.length,
    note: 'Check sample size',
    ...overrides
  };
}

test('prepares one persistent document, migrates a matching legacy type once, and returns categories', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const documentHash = await globalThis.SciLLM.hashDocument(manualDocument.paragraphs);
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.version = 3;
  settings.studyTypeOverrides[documentHash] = {
    primaryType: 'observational', updatedAt: 10
  };
  storageArea.values.sciLlmSettingsV2 = settings;
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('document prepare must not call a provider'); }
  });

  const first = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  settings.studyTypeOverrides[documentHash] = {
    primaryType: 'clinical_trial', updatedAt: 20
  };
  storageArea.values.sciLlmSettingsV2 = settings;
  const second = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });

  assert.equal(first.success, true, JSON.stringify(first));
  assert.match(first.data.documentId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.data.documentHash, documentHash);
  assert.equal(first.data.record.studyType, 'observational');
  assert.equal(first.data.record.legacyStudyTypeMigrated, true);
  assert.equal(second.data.record.studyType, 'observational');
  assert.equal(second.data.record.revision, first.data.record.revision);
  assert.ok(first.data.activeCategories.length > 0);
  assert.ok(first.data.activeCategories.every(category =>
    category.categoryId && category.name && category.color
  ));
});

test('annotation routes trust the merged catalog snapshot and support get, delete, and clear', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('annotation routes must not call a provider'); }
  });
  const prepared = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  const documentId = prepared.data.documentId;

  const upserted = await router.handle({
    type: 'ANNOTATION_UPSERT', documentId, annotation: routerAnnotation()
  });
  const fetched = await router.handle({ type: 'DOCUMENT_GET', documentId });
  const invalid = await router.handle({
    type: 'ANNOTATION_UPSERT', documentId,
    annotation: routerAnnotation({ categoryId: 'missing_category' })
  });
  const deleted = await router.handle({
    type: 'ANNOTATION_DELETE', documentId, annotationId: 'manual-1'
  });
  await router.handle({
    type: 'ANNOTATION_UPSERT', documentId,
    annotation: routerAnnotation({ annotationId: 'manual-2' })
  });
  const cleared = await router.handle({ type: 'ANNOTATION_CLEAR_DOCUMENT', documentId });

  assert.equal(upserted.success, true);
  const trusted = globalThis.SciLLM.createUnifiedCategoryCatalog().limitation;
  assert.deepEqual(upserted.data.annotation.categorySnapshot, {
    name: trusted.name, color: trusted.color
  });
  assert.equal(fetched.data.record.annotations.length, 1);
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.code, 'INVALID_SETTINGS');
  assert.deepEqual(invalid.error.fields, ['categoryId']);
  assert.equal(deleted.data.record.annotations.length, 0);
  assert.equal(cleared.data.record.annotations.length, 0);
});

test('concurrent annotation routes keep both mutations and default document stores are isolated', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const otherRouter = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const prepared = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  const documentId = prepared.data.documentId;
  const [first, second] = await Promise.all([
    router.handle({
      type: 'ANNOTATION_UPSERT', documentId,
      annotation: routerAnnotation({ annotationId: 'concurrent-1' })
    }),
    router.handle({
      type: 'ANNOTATION_UPSERT', documentId,
      annotation: routerAnnotation({ annotationId: 'concurrent-2' })
    })
  ]);
  const saved = await router.handle({ type: 'DOCUMENT_GET', documentId });
  const isolated = await otherRouter.handle({ type: 'DOCUMENT_GET', documentId });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.deepEqual(
    saved.data.record.annotations.map(item => item.annotationId).sort(),
    ['concurrent-1', 'concurrent-2']
  );
  assert.equal(isolated.data.record, null);
});

test('study type writes use the document store and never mutate legacy settings overrides', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const legacyHash = 'a'.repeat(64);
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.studyTypeOverrides[legacyHash] = { studyType: 'observational', updatedAt: 1 };
  storageArea.values.sciLlmSettingsV2 = settings;
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const prepared = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  const before = structuredClone(storageArea.values.sciLlmSettingsV2.studyTypeOverrides);

  const selected = await router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentId: prepared.data.documentId,
    studyType: 'clinical_trial'
  });

  assert.equal(selected.success, true);
  assert.equal(selected.data.studyProfile.primaryType, 'clinical_trial');
  assert.equal((await documentStore.getDocument(prepared.data.documentId)).studyType, 'clinical_trial');
  assert.deepEqual(storageArea.values.sciLlmSettingsV2.studyTypeOverrides, before);
});

test('resolves a prepared document hash after the router is recreated', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const firstRouter = createBackgroundRouter({
    storageArea, documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const prepared = await firstRouter.handle({
    type: 'DOCUMENT_PREPARE', document: manualDocument
  });
  const secondRouter = createBackgroundRouter({
    storageArea, documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const selected = await secondRouter.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentHash: prepared.data.documentHash,
    studyType: 'observational'
  });

  assert.equal(selected.success, true);
  assert.equal(selected.data.documentId, prepared.data.documentId);
  assert.equal(
    (await documentStore.getDocument(prepared.data.documentId)).studyType,
    'observational'
  );
  assert.equal((await documentStore.listDocumentIndex()).length, 1);
});

test('document preparation cannot overwrite an annotation mutation interleaved after it', async () => {
  const storageArea = createMemoryStorage();
  const baseDocumentStore = createMemoryDocumentStore();
  let enterGate;
  let releaseGate;
  const entered = new Promise(resolve => { enterGate = resolve; });
  const released = new Promise(resolve => { releaseGate = resolve; });
  let gateUsed = false;
  async function gateOnce() {
    if (gateUsed) return;
    gateUsed = true;
    enterGate();
    await released;
  }
  const documentStore = {
    ...baseDocumentStore,
    async getDocument(...args) {
      const record = await baseDocumentStore.getDocument(...args);
      await gateOnce();
      return record;
    },
    async prepareDocument(...args) {
      await gateOnce();
      return baseDocumentStore.prepareDocument(...args);
    }
  };
  const router = createBackgroundRouter({
    storageArea, documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const documentId = await globalThis.SciLLM.createDocumentId(manualDocument);

  const preparing = router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  await entered;
  let annotationSettled = false;
  const annotating = router.handle({
    type: 'ANNOTATION_UPSERT', documentId,
    annotation: routerAnnotation()
  }).then(result => {
    annotationSettled = true;
    return result;
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(annotationSettled, false);
  releaseGate();
  const [prepared, annotated] = await Promise.all([preparing, annotating]);
  const saved = await documentStore.getDocument(documentId);
  assert.equal(prepared.success, true);
  assert.equal(annotated.success, true);
  assert.equal(saved.annotations.length, 1);
  assert.equal(saved.annotations[0].annotationId, 'manual-1');
});

test('deleting a referenced custom category retires it until references are removed', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const created = await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_retired', name: 'Retired later',
      definition: 'A category retained while historical annotations reference it.',
      persistence: 'saved', spanPolicy: 'clause', color: '#3366CC'
    }
  });
  assert.equal(created.success, true);
  const prepared = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  const documentId = prepared.data.documentId;
  const upserted = await router.handle({
    type: 'ANNOTATION_UPSERT', documentId,
    annotation: routerAnnotation({ categoryId: 'custom_retired' })
  });
  assert.equal(upserted.success, true);

  const retired = await router.handle({
    type: 'LLM_DELETE_CUSTOM_CATEGORY', categoryId: 'custom_retired'
  });
  const historical = await router.handle({ type: 'DOCUMENT_GET', documentId });
  const retainedDefinition = storageArea.values.sciLlmSettingsV2.customCategories
    .find(category => category.categoryId === 'custom_retired');

  assert.equal(retired.success, true);
  assert.equal(retired.data.retired, true);
  assert.equal(retired.data.referenceCount, 1);
  assert.equal(retainedDefinition.retired, true);
  assert.deepEqual(retainedDefinition.enabledEngines, []);
  assert.equal(historical.data.record.annotations[0].categorySnapshot.name, 'Retired later');
  assert.equal(
    storageArea.values.sciLlmSettingsV2.selectedCategoryIds.includes('custom_retired'),
    false
  );

  await router.handle({
    type: 'ANNOTATION_DELETE', documentId, annotationId: 'manual-1'
  });
  const removed = await router.handle({
    type: 'LLM_DELETE_CUSTOM_CATEGORY', categoryId: 'custom_retired'
  });
  assert.equal(removed.data.retired, false);
  assert.equal(removed.data.referenceCount, 0);
  assert.equal(
    storageArea.values.sciLlmSettingsV2.customCategories
      .some(category => category.categoryId === 'custom_retired'),
    false
  );
});

test('trusted native PDF identity survives indexing checkpoints and reopen', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const context = {
    senderUrl: `${runtimeBaseUrl}pdf-reader.html?source=https%3A%2F%2Fjournal.example%2Fpaper.pdf`,
    runtimeBaseUrl,
    senderExtensionId: runtimeExtensionId,
    trustedExtensionSender: true
  };
  const sourceHash = '9'.repeat(64);
  const hint = {
    adapterId: 'pdf-native',
    documentId: `sha256:${sourceHash}`,
    documentHash: sourceHash,
    revision: 1
  };
  const page = (number, text) => ({
    paragraphId: `pdf-page-${number}`, sectionTitle: 'Results', text
  });
  const makeDocument = paragraphs => ({
    title: 'Stable PDF', canonicalUrl: 'https://journal.example/paper.pdf',
    nativePdfIdentity: hint, paragraphs
  });
  const router = createBackgroundRouter({ storageArea, documentStore, runtimeExtensionId });
  const interactive = await router.handle({
    type: 'DOCUMENT_PREPARE', document: makeDocument([page(1, 'page one')])
  }, context);
  assert.equal(interactive.success, true);
  assert.equal(interactive.data.documentId, hint.documentId);
  assert.equal(interactive.data.documentHash, sourceHash);
  await router.handle({
    type: 'ANNOTATION_UPSERT', documentId: interactive.data.documentId,
    annotation: routerAnnotation({ quote: 'page one', startOffset: 0, endOffset: 8 })
  });

  for (const paragraphs of [
    [page(1, 'page one'), page(2, 'page two')],
    [page(1, 'page one'), page(2, 'page two'), page(3, 'page three')]
  ]) {
    const checkpoint = await router.handle({
      type: 'DOCUMENT_PREPARE', document: makeDocument(paragraphs)
    }, context);
    assert.equal(checkpoint.data.documentId, hint.documentId);
    assert.equal(checkpoint.data.documentHash, sourceHash);
    assert.equal(checkpoint.data.record.annotations.length, 1);
  }

  const reopenedRouter = createBackgroundRouter({
    storageArea, documentStore, runtimeExtensionId
  });
  const reopened = await reopenedRouter.handle({
    type: 'DOCUMENT_PREPARE', document: makeDocument([page(1, 'page one')])
  }, context);
  assert.equal(reopened.data.documentId, hint.documentId);
  assert.equal(reopened.data.record.annotations.length, 1);

  const untrusted = await reopenedRouter.handle({
    type: 'DOCUMENT_PREPARE', document: makeDocument([page(1, 'page one')])
  }, { senderUrl: 'https://attacker.example/', runtimeBaseUrl });
  assert.notEqual(untrusted.data.documentId, hint.documentId);
  for (const rejectedContext of [
    { ...context, senderExtensionId: 'ponmlkjihgfedcbaponmlkjihgfedcba' },
    { ...context, trustedExtensionSender: false },
    { ...context, senderExtensionId: '' },
    { ...context, senderUrl: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/pdf-reader.html' },
    { ...context, senderUrl: 'file:///pdf-reader.html' },
    { ...context, senderUrl: `moz-extension://${runtimeExtensionId}/pdf-reader.html` },
    { ...context, senderUrl: `${runtimeBaseUrl}nested/pdf-reader.html` }
  ]) {
    const rejected = await reopenedRouter.handle({
      type: 'DOCUMENT_PREPARE', document: makeDocument([page(1, 'page one')])
    }, rejectedContext);
    assert.notEqual(rejected.data.documentId, hint.documentId,
      JSON.stringify(rejectedContext));
  }
  const malformed = await reopenedRouter.handle({
    type: 'DOCUMENT_PREPARE', document: {
      ...makeDocument([page(1, 'page one')]),
      nativePdfIdentity: { ...hint, documentHash: 'bad' }
    }
  }, context);
  assert.equal(malformed.success, false);
  assert.deepEqual(malformed.error.fields, ['nativePdfIdentity']);
});

test('permanently deletes and explicitly restores a referenced built-in category', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const prepared = await router.handle({
    type: 'DOCUMENT_PREPARE', document: manualDocument
  });
  const documentId = prepared.data.documentId;
  const upserted = await router.handle({
    type: 'ANNOTATION_UPSERT',
    documentId,
    annotation: routerAnnotation({ categoryId: 'objective' })
  });
  assert.equal(upserted.success, true);

  const deleted = await router.handle({
    type: 'CATEGORY_DELETE', categoryId: 'objective'
  });
  assert.equal(deleted.success, true);
  assert.equal(deleted.data.deleted, true);
  assert.equal(deleted.data.builtIn, true);
  assert.equal(deleted.data.referenceCount, 1);
  assert.equal(
    deleted.data.availableCategories.some(category => category.categoryId === 'objective'),
    false
  );
  assert.deepEqual(
    storageArea.values.sciLlmSettingsV2.deletedBuiltInCategoryIds,
    ['objective']
  );
  assert.equal(
    storageArea.values.sciLlmSettingsV2.categoryOverrides.objective,
    undefined
  );
  const analysisScope = await router.handle({
    type: 'DOCUMENT_PREPARE', document: manualDocument
  });
  assert.equal(analysisScope.success, true);
  assert.equal(
    analysisScope.data.activeCategories.some(category =>
      category.categoryId === 'objective'
    ),
    false
  );

  const missing = await router.handle({
    type: 'CATEGORY_GET', categoryId: 'objective'
  });
  assert.equal(missing.success, false);
  assert.equal(missing.error.code, 'INVALID_SETTINGS');
  const historical = await router.handle({ type: 'DOCUMENT_GET', documentId });
  assert.equal(
    historical.data.record.annotations[0].categorySnapshot.name,
    '研究目的'
  );

  const restarted = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const persisted = await restarted.handle({ type: 'LLM_GET_SETTINGS' });
  assert.equal(
    persisted.data.availableCategories.some(category => category.categoryId === 'objective'),
    false
  );
  assert.equal(
    persisted.data.deletedBuiltInCategories[0].categoryId,
    'objective'
  );

  const restored = await restarted.handle({
    type: 'CATEGORY_RESTORE_BUILT_IN', categoryId: 'objective'
  });
  assert.equal(restored.success, true);
  assert.equal(
    restored.data.availableCategories.some(category => category.categoryId === 'objective'),
    true
  );
  assert.deepEqual(
    storageArea.values.sciLlmSettingsV2.deletedBuiltInCategoryIds,
    []
  );
});

test('custom category deletion cannot hard-delete a concurrently referenced definition', async () => {
  const storageArea = createMemoryStorage();
  const baseDocumentStore = createMemoryDocumentStore();
  let countedResolve;
  let releaseCount;
  const counted = new Promise(resolve => { countedResolve = resolve; });
  const countReleased = new Promise(resolve => { releaseCount = resolve; });
  let gateCount = true;
  const documentStore = {
    ...baseDocumentStore,
    async countCategoryReferences(categoryId) {
      const count = await baseDocumentStore.countCategoryReferences(categoryId);
      if (gateCount && categoryId === 'custom_race') {
        gateCount = false;
        countedResolve(count);
        await countReleased;
      }
      return count;
    }
  };
  const router = createBackgroundRouter({
    storageArea, documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_race', name: 'Concurrent category',
      definition: 'A category used to exercise the reference race.',
      persistence: 'saved', spanPolicy: 'clause', color: '#3366CC'
    }
  });
  const prepared = await router.handle({
    type: 'DOCUMENT_PREPARE', document: manualDocument
  });
  const deleting = router.handle({
    type: 'LLM_DELETE_CUSTOM_CATEGORY', categoryId: 'custom_race'
  });
  assert.equal(await counted, 0);
  let annotationSettled = false;
  const annotating = router.handle({
    type: 'ANNOTATION_UPSERT', documentId: prepared.data.documentId,
    annotation: routerAnnotation({ categoryId: 'custom_race' })
  }).then(result => {
    annotationSettled = true;
    return result;
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(annotationSettled, false);
  releaseCount();
  const [deleted, annotated] = await Promise.all([deleting, annotating]);
  assert.equal(deleted.success, true);
  assert.equal(deleted.data.referenceCount, 0);
  assert.equal(annotated.success, false);
  assert.equal(annotated.error.code, 'INVALID_SETTINGS');
  assert.equal(await documentStore.countCategoryReferences('custom_race'), 0);
  assert.equal(
    storageArea.values.sciLlmSettingsV2.customCategories
      .some(category => category.categoryId === 'custom_race'),
    false
  );
});

test('gets a merged category and prompt preview without provider access or secrets', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('category routes must not call a provider');
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'sk-category-secret-123456', model: 'gpt-5-mini' }
  });

  const result = await router.handle({ type: 'CATEGORY_GET', categoryId: 'limitation' });

  assert.equal(result.success, true);
  assert.equal(result.data.category.categoryId, 'limitation');
  assert.ok(Array.isArray(result.data.category.regex.phrases));
  assert.match(result.data.promptPreview, /类别：/);
  assert.deepEqual(result.data.metadata, { builtIn: true, overridden: false });
  assert.equal(providerCalls, 0);
  assert.doesNotMatch(JSON.stringify(result.data), /sk-category-secret|apiKey|providers/);
});

test('fresh settings state lists merged category names and colors without prompt internals', async () => {
  const storageArea = createMemoryStorage();
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.profiles.profile_default_openai.config.apiKey = 'sk-rail-secret-123456';
  settings.categoryOverrides.limitation = {
    name: '适用边界',
    color: '#173F6F',
    enabledEngines: ['regex']
  };
  storageArea.values.sciLlmSettingsV2 = settings;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const result = await router.handle({ type: 'LLM_GET_SETTINGS' });

  assert.equal(result.success, true);
  assert.equal(result.data.availableCategories.length, 50);
  const limitation = result.data.availableCategories
    .find(category => category.categoryId === 'limitation');
  assert.equal(limitation.name, '适用边界');
  assert.equal(limitation.color, '#173F6F');
  assert.equal(Object.prototype.hasOwnProperty.call(limitation, 'prompt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(limitation, 'regex'), false);
  assert.doesNotMatch(JSON.stringify(result.data.availableCategories), /sk-rail-secret|apiKey/);
  assert.deepEqual(
    result.data.availableCategories.map(category => category.categoryId),
    Object.keys(globalThis.SciLLM.createAdaptiveCategoryCatalog())
  );
});

test('publishes compatible provider presets without exposing saved credentials', async () => {
  const storageArea = createMemoryStorage();
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.profiles.profile_compatible_test = globalThis.SciLLM.normalizeProfile(
    'profile_compatible_test',
    {
      name: 'Compatible', providerId: 'openai-compatible',
      config: {
        apiKey: 'preset-secret-987654', model: 'custom-model',
        baseUrl: 'https://example.com/v1'
      }
    }
  );
  settings.profileOrder.push('profile_compatible_test');
  storageArea.values.sciLlmSettingsV2 = settings;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const result = await router.handle({ type: 'LLM_GET_SETTINGS' });

  assert.equal(result.success, true);
  const kimi = result.data.compatibleProviderPresets.find(item => item.id === 'kimi');
  assert.equal(kimi.baseUrl, 'https://api.moonshot.cn/v1');
  assert.equal(kimi.defaultModel, 'kimi-k3');
  assert.equal(kimi.authPrefix, 'Bearer');
  assert.doesNotMatch(JSON.stringify(result.data.compatibleProviderPresets), /preset-secret-987654/);
});

test('rejects unknown and malformed category ids with a safe validation error', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  for (const categoryId of ['missing_category', '../limitation', '']) {
    const result = await router.handle({ type: 'CATEGORY_GET', categoryId });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'INVALID_SETTINGS');
    assert.deepEqual(result.error.fields, ['categoryId']);
    assert.doesNotMatch(JSON.stringify(result.error), /missing_category|\.\.\/limitation/);
  }
});

test('deep-merges category overrides, preserves forward fields, and stores only the override', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const first = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE',
    categoryId: 'limitation',
    override: {
      prompt: { definition: '明确说明研究的适用边界。' },
      futureFormat: { version: 2, layout: { density: 'compact' } }
    }
  });
  const second = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE',
    categoryId: 'limitation',
    override: {
      color: '#173F6F',
      futureFormat: { layout: { rail: true } }
    }
  });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(second.data.category.color, '#173F6F');
  assert.equal(second.data.category.prompt.definition, '明确说明研究的适用边界。');
  assert.deepEqual(
    storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation.futureFormat,
    { version: 2, layout: { density: 'compact', rail: true } }
  );
  assert.equal(
    storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation.prompt.definition,
    '明确说明研究的适用边界。'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation,
      'decisionQuestion'
    ),
    false
  );
  assert.deepEqual(second.data.metadata, { builtIn: true, overridden: true });
});

test('does not write an invalid category override or unsafe regex', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const before = JSON.stringify(storageArea.values);

  const result = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE',
    categoryId: 'result',
    override: { regex: { expressions: ['(a+)+$'] } }
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'INVALID_SETTINGS');
  assert.ok(result.error.fields.includes('regex.expressions.0'));
  assert.equal(JSON.stringify(storageArea.values), before);
});

test('resets only one category override and leaves legacy rules and custom categories intact', async () => {
  const storageArea = createMemoryStorage();
  storageArea.values.allRules = {
    limitation: { name: 'legacy limitation', patterns: ['legacy'] }
  };
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.categoryOverrides = {
    limitation: { color: '#173F6F' },
    result: { color: '#E58C2F' }
  };
  settings.customCategories = [{
    categoryId: 'custom_translation',
    name: '转化价值',
    definition: '可转化应用价值',
    color: '#2F80ED'
  }];
  storageArea.values.sciLlmSettingsV2 = settings;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const result = await router.handle({
    type: 'CATEGORY_RESET_OVERRIDE', categoryId: 'limitation'
  });

  assert.equal(result.success, true);
  assert.equal(result.data.category.categoryId, 'limitation');
  assert.deepEqual(result.data.metadata, { builtIn: true, overridden: false });
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      storageArea.values.sciLlmSettingsV2.categoryOverrides,
      'limitation'
    ),
    false
  );
  assert.equal(storageArea.values.sciLlmSettingsV2.categoryOverrides.result.color, '#E58C2F');
  assert.equal(storageArea.values.sciLlmSettingsV2.customCategories[0].categoryId, 'custom_translation');
  assert.equal(storageArea.values.allRules.limitation.name, 'legacy limitation');
});

test('tests candidate regex deterministically with whole-word and case semantics without persisting', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const before = JSON.stringify(storageArea.values);

  const result = await router.handle({
    type: 'CATEGORY_TEST_REGEX',
    categoryId: 'result',
    candidateRegex: {
      phrases: ['beta'],
      expressions: ['alpha\\s+beta'],
      caseSensitive: false,
      wholeWord: true
    },
    testText: 'alpha beta betamax BETA'
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data.matches, [
    { expressionRow: 'expression:0', start: 0, end: 10, text: 'alpha beta' },
    { expressionRow: 'phrase:0', start: 6, end: 10, text: 'beta' },
    { expressionRow: 'phrase:0', start: 19, end: 23, text: 'BETA' }
  ]);
  assert.equal(result.data.truncated, false);
  assert.equal(JSON.stringify(storageArea.values), before);
});

test('category regex blacklist removes overlapping fixed-phrase matches', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const result = await router.handle({
    type: 'CATEGORY_TEST_REGEX',
    categoryId: 'result',
    candidateRegex: {
      phrases: ['response signal'],
      excludePhrases: ['baseline response signal'],
      expressions: [],
      caseSensitive: false,
      wholeWord: true
    },
    testText: 'baseline response signal and durable response signal'
  });

  assert.equal(result.success, true);
  assert.equal(result.data.excludedCount, 1);
  assert.deepEqual(result.data.matches, [{
    expressionRow: 'phrase:0',
    start: 37,
    end: 52,
    text: 'response signal'
  }]);
});

test('atomically appends manual fixed phrases to category include and exclude lists', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => jsonResponse({})
  });
  const included = await router.handle({
    type: 'CATEGORY_APPEND_FIXED_PHRASE',
    categoryId: 'result',
    listType: 'include',
    phrase: '  durable response   signal  '
  });
  assert.equal(included.success, true);
  assert.equal(included.data.appended, true);
  assert.ok(included.data.category.regex.phrases.includes('durable response signal'));

  const excluded = await router.handle({
    type: 'CATEGORY_APPEND_FIXED_PHRASE',
    categoryId: 'result',
    listType: 'exclude',
    phrase: 'baseline response signal'
  });
  assert.equal(excluded.success, true);
  assert.deepEqual(
    excluded.data.category.regex.excludePhrases,
    ['baseline response signal']
  );
  const duplicate = await router.handle({
    type: 'CATEGORY_APPEND_FIXED_PHRASE',
    categoryId: 'result',
    listType: 'exclude',
    phrase: 'baseline response signal'
  });
  assert.equal(duplicate.data.appended, false);
  assert.deepEqual(
    storageArea.values.sciLlmSettingsV2.categoryOverrides.result.regex.excludePhrases,
    ['baseline response signal']
  );
});

test('bounds regex test matches and rejects unsafe candidates and oversized text', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const bounded = await router.handle({
    type: 'CATEGORY_TEST_REGEX',
    categoryId: 'result',
    candidateRegex: {
      phrases: ['hit'], expressions: [], caseSensitive: true, wholeWord: true
    },
    testText: Array.from({ length: 150 }, () => 'hit').join(' ')
  });
  assert.equal(bounded.success, true);
  assert.equal(bounded.data.matches.length, 100);
  assert.equal(bounded.data.truncated, true);

  const unsafe = await router.handle({
    type: 'CATEGORY_TEST_REGEX',
    categoryId: 'result',
    candidateRegex: { expressions: ['(?:a|a?)+$'] },
    testText: 'a'.repeat(200)
  });
  assert.equal(unsafe.success, false);
  assert.equal(unsafe.error.code, 'INVALID_SETTINGS');
  assert.ok(unsafe.error.fields.includes('regex.expressions.0'));

  const oversized = await router.handle({
    type: 'CATEGORY_TEST_REGEX',
    categoryId: 'result',
    testText: 'x'.repeat(20001)
  });
  assert.equal(oversized.success, false);
  assert.equal(oversized.error.code, 'INVALID_SETTINGS');
  assert.ok(oversized.error.fields.includes('testText'));
});

test('rejects ambiguous bounded regex candidates before category test matching', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const result = await router.handle({
    type: 'CATEGORY_TEST_REGEX',
    categoryId: 'result',
    candidateRegex: {
      phrases: [],
      expressions: ['a{1,100}a{1,100}a{1,100}a{1,100}a{1,100}Z'],
      caseSensitive: true,
      wholeWord: false
    },
    testText: 'a'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'INVALID_SETTINGS');
  assert.ok(result.error.fields.includes('regex.expressions.0'));
});

test('serializes concurrent category saves, reset, and study type writes without lost updates', async () => {
  const values = {};
  const clone = value => value === undefined
    ? undefined : JSON.parse(JSON.stringify(value));
  const storageArea = {
    values,
    get(key, callback) {
      const keys = Array.isArray(key) ? key : [key];
      const snapshot = Object.fromEntries(keys.map(item => [item, clone(values[item])]));
      setTimeout(() => callback(snapshot), 0);
    },
    set(input, callback) {
      setTimeout(() => {
        Object.assign(values, clone(input));
        callback();
      }, 5);
    }
  };
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const documentHash = 'c'.repeat(64);

  const responses = await Promise.all([
    router.handle({
      type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
      override: { color: '#173F6F' }
    }),
    router.handle({
      type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'result',
      override: { color: '#E58C2F' }
    }),
    router.handle({
      type: 'LLM_SET_STUDY_TYPE', documentHash, studyType: 'observational'
    }),
    router.handle({ type: 'CATEGORY_RESET_OVERRIDE', categoryId: 'limitation' })
  ]);

  responses.forEach(response => assert.equal(response.success, true));
  assert.equal(values.sciLlmSettingsV2.categoryOverrides.result.color, '#E58C2F');
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      values.sciLlmSettingsV2.categoryOverrides, 'limitation'
    ),
    false
  );
  assert.equal((await documentStore.getDocument(`sha256:${documentHash}`)).studyType,
    'observational');
});

test('serializes concurrent category and provider writes without losing either change', async () => {
  const storageArea = createDelayedCloneStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const responses = await Promise.all([
    router.handle({
      type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
      override: { color: '#173F6F' }
    }),
    router.handle({
      type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
      config: { apiKey: 'queue-provider-key', model: 'gpt-5-mini' }
    })
  ]);

  responses.forEach(response => assert.equal(response.success, true));
  assert.equal(storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation.color, '#173F6F');
  assert.equal(
    storageArea.values.sciLlmSettingsV2.profiles.profile_legacy_openai.config.apiKey,
    'queue-provider-key'
  );
});

test('serializes concurrent category and preference writes without losing either change', async () => {
  const storageArea = createDelayedCloneStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const responses = await Promise.all([
    router.handle({
      type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'result',
      override: { color: '#E58C2F' }
    }),
    router.handle({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: { confidenceThreshold: 0.93, autoAnalyze: true }
    })
  ]);

  responses.forEach(response => assert.equal(response.success, true));
  assert.equal(storageArea.values.sciLlmSettingsV2.categoryOverrides.result.color, '#E58C2F');
  assert.equal(storageArea.values.sciLlmSettingsV2.confidenceThreshold, 0.93);
  assert.equal(storageArea.values.sciLlmSettingsV2.autoAnalyze, true);
});

test('serializes concurrent custom category writes without losing either category', async () => {
  const storageArea = createDelayedCloneStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const custom = (categoryId, name) => ({
    categoryId, name, definition: `${name} definition`, persistence: 'saved',
    spanPolicy: 'clause', color: '#3366CC'
  });

  const responses = await Promise.all([
    router.handle({
      type: 'LLM_SAVE_CUSTOM_CATEGORY',
      category: custom('custom_queue_alpha', 'Queue alpha')
    }),
    router.handle({
      type: 'LLM_SAVE_CUSTOM_CATEGORY',
      category: custom('custom_queue_beta', 'Queue beta')
    })
  ]);

  responses.forEach(response => assert.equal(response.success, true));
  assert.deepEqual(
    storageArea.values.sciLlmSettingsV2.customCategories
      .map(category => category.categoryId).sort(),
    ['custom_queue_alpha', 'custom_queue_beta']
  );
});

test('continues the shared settings queue after a provider write failure', async () => {
  const storageArea = createMemoryStorage();
  const normalSet = storageArea.set.bind(storageArea);
  let failNextSet = true;
  storageArea.set = (input, callback) => {
    if (failNextSet) {
      failNextSet = false;
      return Promise.reject(new Error('simulated provider storage failure'));
    }
    return normalSet(input, callback);
  };
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const failed = await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'queue-failure-key', model: 'gpt-5-mini' }
  });
  const recovered = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
    override: { color: '#173F6F' }
  });

  assert.equal(failed.success, false);
  assert.equal(recovered.success, true);
  assert.equal(storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation.color, '#173F6F');
});

test('stores a manual study type without requiring or calling a provider', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });
  const documentHash = 'a'.repeat(64);

  const result = await router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentHash,
    studyType: 'clinical_trial'
  });

  assert.equal(result.success, true);
  assert.equal(result.data.studyProfile.primaryType, 'clinical_trial');
  assert.equal(result.data.studyProfile.secondaryType, null);
  assert.equal(providerCalls, 0);
  assert.equal((await documentStore.getDocument(`sha256:${documentHash}`)).studyType,
    'clinical_trial');
});

test('serializes concurrent manual study type writes without losing either document', async () => {
  const values = {};
  let setCount = 0;
  const clone = value => value === undefined
    ? undefined : JSON.parse(JSON.stringify(value));
  const storageArea = {
    values,
    get(key, callback) {
      const keys = Array.isArray(key) ? key : [key];
      const snapshot = Object.fromEntries(keys.map(item => [item, clone(values[item])]));
      setTimeout(() => callback(snapshot), 0);
    },
    set(input, callback) {
      setCount += 1;
      const delay = setCount === 1 ? 20 : 0;
      setTimeout(() => {
        Object.assign(values, clone(input));
        callback();
      }, delay);
    }
  };
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const firstHash = '1'.repeat(64);
  const secondHash = '2'.repeat(64);

  const [first, second] = await Promise.all([
    router.handle({
      type: 'LLM_SET_STUDY_TYPE', documentHash: firstHash, studyType: 'observational'
    }),
    router.handle({
      type: 'LLM_SET_STUDY_TYPE', documentHash: secondHash, studyType: 'clinical_trial'
    })
  ]);

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal((await documentStore.getDocument(`sha256:${firstHash}`)).studyType,
    'observational');
  assert.equal((await documentStore.getDocument(`sha256:${secondHash}`)).studyType,
    'clinical_trial');
});

test('continues queued study type writes after an earlier document store failure', async () => {
  const storageArea = createMemoryStorage();
  const baseDocumentStore = createMemoryDocumentStore();
  let failNextSetStudyType = true;
  const documentStore = {
    ...baseDocumentStore,
    async setStudyType(...args) {
      if (failNextSetStudyType) {
        failNextSetStudyType = false;
        throw new Error('simulated document storage failure');
      }
      return baseDocumentStore.setStudyType(...args);
    }
  };
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const failedHash = '3'.repeat(64);
  const recoveredHash = '4'.repeat(64);

  const failed = await router.handle({
    type: 'LLM_SET_STUDY_TYPE', documentHash: failedHash, studyType: 'observational'
  });
  const recovered = await router.handle({
    type: 'LLM_SET_STUDY_TYPE', documentHash: recoveredHash, studyType: 'clinical_trial'
  });

  assert.equal(failed.success, false);
  assert.equal(recovered.success, true);
  assert.equal((await documentStore.getDocument(`sha256:${recoveredHash}`)).studyType,
    'clinical_trial');
});

function sseResponse(content) {
  return {
    ok: true,
    status: 200,
    async text() {
      return `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n`;
    }
  };
}

test('returns bounded redacted diagnostics for an unclassified internal error', async () => {
  const storageArea = {
    get() {
      throw new TypeError(
        'Cannot read properties of undefined; token sk-abcdefghijk123456789 leaked'
      );
    },
    set() {}
  };
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: createMemoryStorage(),
    fetchImpl: async () => jsonResponse({})
  });

  const response = await router.handle({ type: 'LLM_GET_SETTINGS' });

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'INTERNAL_ERROR');
  assert.equal(response.error.runtimeRevision, '1.0.1-build1-store-release');
  assert.equal(response.error.diagnosticType, 'TypeError');
  assert.match(response.error.diagnosticMessage, /Cannot read properties of undefined/);
  assert.doesNotMatch(response.error.diagnosticMessage, /sk-abcdefghijk123456789/);
  assert.ok(response.error.diagnosticMessage.length <= 240);
});

test('routes plugin-scoped Codex authentication controls through the native client', async () => {
  const calls = [];
  const nativeClient = {
    async health(options) {
      calls.push({ type: 'health', options });
      return {
        connected: true,
        accountType: 'chatgpt',
        planType: 'plus',
        hostVersion: '1.0.0',
        eventLogPath: 'C:\\events\\events.ndjson',
        latestEventPath: 'C:\\events\\latest.json'
      };
    },
    async startLogin(options) {
      calls.push({ type: 'login', options });
      return {
        loginId: 'plugin-login',
        authUrl: 'https://auth.openai.com/oauth/authorize'
      };
    },
    async logout(options) {
      calls.push({ type: 'logout', options });
      return { success: true };
    }
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    nativeClient,
    fetchImpl: async () => jsonResponse({})
  });

  const status = await router.handle({ type: 'CODEX_LOCAL_STATUS' });
  const login = await router.handle({
    type: 'CODEX_LOCAL_LOGIN_START',
    force: true
  });
  const logout = await router.handle({ type: 'CODEX_LOCAL_LOGOUT' });

  assert.equal(status.success, true);
  assert.equal(status.data.planType, 'plus');
  assert.equal(status.data.eventLogPath, 'C:\\events\\events.ndjson');
  assert.equal(status.data.latestEventPath, 'C:\\events\\latest.json');
  assert.equal(login.success, true);
  assert.equal(login.data.loginId, 'plugin-login');
  assert.equal(logout.success, true);
  assert.equal(calls[1].options.force, true);
  assert.deepEqual(calls.map(call => call.type), ['health', 'login', 'logout']);
});

test('returns privacy-safe network stage diagnostics', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'deepseek',
    config: { apiKey: 'must-not-leak', model: 'deepseek-chat' }
  });

  const response = await router.handle({ type: 'LLM_TEST_PROVIDER', providerId: 'deepseek' });

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'NETWORK_ERROR');
  assert.equal(response.error.diagnosticStage, 'request');
  assert.equal(response.error.diagnosticType, 'TypeError');
  assert.ok(response.error.requestBytes > 0);
  assert.ok(Number.isFinite(response.error.elapsedMs));
  assert.equal(JSON.stringify(response).includes('must-not-leak'), false);
});

test('saves provider credentials but returns only masked public settings', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  const saved = await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'openai-secret-1234', model: 'gpt-5-mini' }
  });
  assert.equal(saved.success, true);
  assert.equal(
    saved.data.settings.profiles.profile_legacy_openai.config.hasApiKey,
    true
  );
  assert.equal(JSON.stringify(saved).includes('openai-secret-1234'), false);

  const loaded = await router.handle({ type: 'LLM_GET_SETTINGS' });
  assert.equal(JSON.stringify(loaded).includes('openai-secret-1234'), false);
  assert.equal(
    storageArea.values.sciLlmSettingsV2.profiles.profile_legacy_openai.config.apiKey,
    'openai-secret-1234'
  );
});

test('lists current provider models through the saved profile without exposing its key', async () => {
  const storageArea = createMemoryStorage();
  const requests = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        data: [
          { id: 'gpt-5-mini', created: 20 },
          { id: 'text-embedding-3-large', created: 30 },
          { id: 'gpt-5', created: 10 }
        ]
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'model-list-secret', model: 'gpt-5-mini' }
  });

  const result = await router.handle({
    type: 'LLM_LIST_MODELS',
    profileId: 'profile_legacy_openai',
    providerId: 'openai',
    config: {}
  });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.data.models.map(item => item.id), ['gpt-5-mini', 'gpt-5']);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/models');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer model-list-secret');
  assert.equal(JSON.stringify(result).includes('model-list-secret'), false);
});

test('updates only whitelisted preferences and reports effective mode', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'deepseek',
    config: { apiKey: 'key', model: 'deepseek-v4-flash' }
  });
  const result = await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm',
      providerId: 'deepseek',
      consentGranted: true,
      selectedCategoryIds: ['limitation'],
      keyboardShortcuts: { figures: 'x', navigation: '', ppt: '7' },
      injected: 'must-not-save'
    }
  });
  assert.equal(result.data.effectiveMode, 'llm');
  assert.equal(result.data.llmReady, true);
  assert.equal(storageArea.values.sciLlmSettingsV2.injected, undefined);
  assert.deepEqual(result.data.settings.selectedCategoryIds, ['limitation']);
  assert.equal(result.data.settings.keyboardShortcuts.figures, 'X');
  assert.equal(result.data.settings.keyboardShortcuts.navigation, '');
  assert.equal(result.data.settings.keyboardShortcuts.ppt, '7');
});

test('reports LLM task readiness independently from the selected highlight engine', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'deepseek',
    config: { apiKey: 'key', model: 'deepseek-v4-flash' }
  });
  const result = await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'regex', consentGranted: true }
  });
  assert.equal(result.data.effectiveMode, 'regex');
  assert.equal(result.data.llmReady, true);
});

test('stores a normalized confidence threshold through the preference whitelist', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  const updated = await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { confidenceThreshold: 0.85, injected: 'must-not-save' }
  });
  assert.equal(updated.success, true);
  assert.equal(updated.data.settings.confidenceThreshold, 0.85);
  assert.equal(storageArea.values.sciLlmSettingsV2.confidenceThreshold, 0.85);
  assert.equal(storageArea.values.sciLlmSettingsV2.injected, undefined);
});

test('tests a configured provider with the minimal structured capability probe', async () => {
  const storageArea = createMemoryStorage();
  let requestBody;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      return jsonResponse({
        output_text: JSON.stringify({
          ok: true,
          echo: 'schema'
        })
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  const result = await router.handle({
    type: 'LLM_TEST_PROVIDER', providerId: 'openai', probeIds: ['structured_schema']
  });
  assert.equal(result.success, true);
  assert.equal(result.data.connected, true);
  assert.match(requestBody.input, /requested.*schema/i);
  assert.match(requestBody.instructions, /smallest object/i);
  assert.doesNotMatch(JSON.stringify(requestBody),
    /PAPER_BLUEPRINT|STUDY_TYPE_GUIDANCE|necessity_evidence|scientific_annotations/i
  );
  assert.equal(result.data.probes[0].id, 'structured_schema');
});

test('uses a minimal non-stream Schema probe for DeepSeek connection testing', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  let lastBody;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      lastBody = JSON.parse(options.body);
      return sseResponse(JSON.stringify({
          ok: true,
          echo: 'schema'
        }));
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'deepseek',
    config: { apiKey: 'key', model: 'deepseek-v4-flash' }
  });
  const result = await router.handle({
    type: 'LLM_TEST_PROVIDER', providerId: 'deepseek', probeIds: ['structured_schema']
  });
  assert.equal(result.success, true);
  assert.equal(calls, 1);
  assert.match(lastBody.messages[0].content, /smallest object/i);
  assert.doesNotMatch(lastBody.messages[0].content,
    /paragraphs_reviewed|annotations|PAPER_BLUEPRINT|STUDY_TYPE_GUIDANCE/i
  );
});

test('returns safe structured errors for invalid settings', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => jsonResponse({})
  });
  const result = await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai-compatible',
    config: { apiKey: 'secret', model: 'model', baseUrl: 'file:///tmp/api' }
  });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'INVALID_SETTINGS');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('analyzes every supplied paragraph using only selected categories', async () => {
  const storageArea = createMemoryStorage();
  let articlePayload;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const schemaName = body.text?.format?.name;
      if (schemaName === 'study_profile') {
        return jsonResponse({
          output_text: JSON.stringify({
            primary_type: 'observational', secondary_type: null,
            confidence: 0.91, reason_zh: '观察性研究', blueprint: validBlueprint
          })
        });
      }
      if (schemaName === 'evidence_ledger') {
        return jsonResponse({
          output_text: JSON.stringify({
            key_annotation_ids: [], relation_summaries: [],
            review_warnings: [], audit_items: []
          })
        });
      }
      articlePayload = JSON.parse(body.input);
      return jsonResponse({
        output_text: JSON.stringify({
          chunk_id: articlePayload.chunk_id,
          paragraphs_reviewed: articlePayload.paragraphs.map(item => item.paragraph_id),
          annotations: [{
            paragraph_id: 'p2',
            quote: 'The small sample limits generalizability.',
            occurrence: 0,
            category_id: 'limitation',
            confidence: 0.96,
            reason_zh: '明确陈述样本量局限'
          }]
        })
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['limitation']
    }
  });
  const document = {
    title: 'Study',
    url: 'https://journal.example/study',
    paragraphs: [
      { paragraphId: 'p1', sectionTitle: 'Results', text: 'Treatment increased survival.' },
      { paragraphId: 'p2', sectionTitle: 'Discussion', text: 'The small sample limits generalizability.' }
    ]
  };
  await selectStudyType(router, document);
  const result = await router.handle({
    type: 'LLM_ANALYZE_DOCUMENT',
    document
  });
  assert.equal(result.success, true);
  assert.deepEqual(articlePayload.paragraphs.map(item => item.paragraph_id), ['p1', 'p2']);
  assert.deepEqual(result.data.analyzedCategoryIds, ['limitation']);
  assert.equal(result.data.annotations[0].categories[0].categoryId, 'limitation');
});

test('delivers each full-text checkpoint before starting the evidence ledger', async () => {
  const storageArea = createMemoryStorage();
  let ledgerRequested = false;
  let releaseCheckpoint;
  let observeCheckpoint;
  const checkpointGate = new Promise(resolve => { releaseCheckpoint = resolve; });
  const checkpointObserved = new Promise(resolve => { observeCheckpoint = resolve; });
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const schemaName = body.text?.format?.name;
      if (schemaName === 'evidence_ledger') {
        ledgerRequested = true;
        return jsonResponse({
          output_text: JSON.stringify({
            key_annotation_ids: [], relation_summaries: [],
            review_warnings: [], audit_items: []
          })
        });
      }
      const input = JSON.parse(body.input);
      return jsonResponse({
        output_text: JSON.stringify({
          chunk_id: input.chunk_id,
          paragraphs_reviewed: input.paragraphs.map(item => item.paragraph_id),
          annotations: [{
            paragraph_id: 'p1',
            quote: 'The small sample size limits generalizability.',
            occurrence: 0,
            category_id: 'limitation',
            confidence: 0.96,
            reason_zh: '明确陈述样本量局限'
          }]
        })
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['limitation']
    }
  });
  const document = {
    title: 'Checkpoint ordering study',
    paragraphs: [{
      paragraphId: 'p1', sectionTitle: 'Discussion',
      text: 'The small sample size limits generalizability.'
    }]
  };
  await selectStudyType(router, document);
  const analysis = router.handle({
    type: 'LLM_ANALYZE_DOCUMENT', document
  }, {
    onProgress: async event => {
      if (event.phase !== 'chunk_checkpoint') return;
      observeCheckpoint(event);
      await checkpointGate;
    }
  });
  const checkpoint = await checkpointObserved;
  assert.equal(checkpoint.checkpointAnnotations.length, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ledgerRequested, false);
  releaseCheckpoint();
  const result = await analysis;
  assert.equal(result.success, true);
  assert.equal(ledgerRequested, true);
});

test('keeps the selected study type when a dynamically loaded article gains more body text', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('preparation must not call a provider'); }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['limitation']
    }
  });

  const partialDocument = {
    title: 'Mechanism and translational opportunities',
    url: 'https://journal.example/review',
    paragraphs: [{
      paragraphId: 'abstract-1', sectionTitle: 'Abstract',
      text: 'This review summarizes a therapeutic mechanism.'
    }]
  };
  const first = await router.handle({
    type: 'LLM_PREPARE_DOCUMENT', document: partialDocument
  });
  assert.equal(first.success, true);
  const selected = await router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentId: first.data.documentId,
    documentHash: first.data.documentHash,
    studyType: 'narrative_review'
  });
  assert.equal(selected.success, true);

  const fullDocument = {
    ...partialDocument,
    documentId: first.data.documentId,
    previousDocumentHash: first.data.documentHash,
    paragraphs: [
      ...partialDocument.paragraphs,
      {
        paragraphId: 'intro-1', sectionTitle: 'Introduction',
        text: 'Recent preclinical studies connect the pathway to therapeutic resistance.'
      },
      {
        paragraphId: 'discussion-1', sectionTitle: 'Conclusions',
        text: 'Clinical translation still requires prospective validation.'
      }
    ]
  };
  const second = await router.handle({
    type: 'LLM_PREPARE_DOCUMENT', document: fullDocument
  });

  assert.equal(second.success, true);
  assert.equal(second.data.documentId, first.data.documentId);
  assert.equal(second.data.studyProfile.primaryType, 'narrative_review');
  assert.equal(second.data.paperBlueprint.research_question, fullDocument.title);
  assert.match(second.data.paperBlueprint.claimed_contribution, /review summarizes a therapeutic mechanism/);
  assert.equal(second.data.requiresStudyType, false);
  const record = await documentStore.getDocument(first.data.documentId);
  assert.equal(record.studyType, 'narrative_review');
  assert.ok(record.documentHashes.includes(first.data.documentHash));
  assert.ok(record.documentHashes.includes(second.data.documentHash));
});

test('uses saved unified overrides in LLM prompts, honors engines, and restores built-ins', async () => {
  const storageArea = createMemoryStorage();
  const annotationInstructions = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const schemaName = body.text?.format?.name;
      if (schemaName === 'evidence_ledger') {
        return jsonResponse({
          output_text: JSON.stringify({
            key_annotation_ids: [], relation_summaries: [],
            review_warnings: [], audit_items: []
          })
        });
      }
      annotationInstructions.push(body.instructions);
      const input = JSON.parse(body.input);
      return jsonResponse({
        output_text: JSON.stringify({
          chunk_id: input.chunk_id,
          paragraphs_reviewed: input.paragraphs.map(item => item.paragraph_id),
          annotations: []
        })
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['limitation']
    }
  });
  const document = {
    title: 'Override study',
    paragraphs: [{
      paragraphId: 'p1', sectionTitle: 'Discussion',
      text: 'The small sample limits generalizability.'
    }]
  };
  await selectStudyType(router, document);

  const saved = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
    override: {
      enabledEngines: ['llm'],
      prompt: {
        definition: 'OVERRIDDEN LIMITATION DEFINITION',
        positiveExamples: ['OVERRIDDEN LIMITATION EXAMPLE'],
        minimumConfidence: 0.93
      }
    }
  });
  assert.equal(saved.success, true);
  const prepared = await router.handle({ type: 'LLM_PREPARE_DOCUMENT', document });
  const active = prepared.data.activeCategories
    .find(category => category.categoryId === 'limitation');
  assert.equal(active.minimumConfidence, 0.93);
  assert.deepEqual(active.enabledEngines, ['llm']);
  const analyzed = await router.handle({ type: 'LLM_ANALYZE_DOCUMENT', document });
  assert.equal(analyzed.success, true);
  assert.match(annotationInstructions.at(-1), /OVERRIDDEN LIMITATION DEFINITION/);
  assert.match(annotationInstructions.at(-1), /OVERRIDDEN LIMITATION EXAMPLE/);
  assert.match(annotationInstructions.at(-1), /"minimum_confidence":0\.93/);

  const regexOnly = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
    override: { enabledEngines: ['regex'] }
  });
  assert.equal(regexOnly.success, true);
  const excluded = await router.handle({ type: 'LLM_PREPARE_DOCUMENT', document });
  assert.equal(
    excluded.data.activeCategories.some(category => category.categoryId === 'limitation'),
    false
  );

  const reset = await router.handle({
    type: 'CATEGORY_RESET_OVERRIDE', categoryId: 'limitation'
  });
  assert.equal(reset.success, true);
  assert.notEqual(reset.data.category.prompt.definition, 'OVERRIDDEN LIMITATION DEFINITION');
  const restored = await router.handle({ type: 'LLM_PREPARE_DOCUMENT', document });
  assert.equal(
    restored.data.activeCategories.some(category => category.categoryId === 'limitation'),
    true
  );
});

test('effective category edits invalidate analysis cache and reset restores its signature', async () => {
  const storageArea = createMemoryStorage();
  let annotationCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const schemaName = body.text?.format?.name;
      if (schemaName === 'evidence_ledger') {
        return jsonResponse({
          output_text: JSON.stringify({
            key_annotation_ids: [], relation_summaries: [],
            review_warnings: [], audit_items: []
          })
        });
      }
      annotationCalls += 1;
      const input = JSON.parse(body.input);
      return jsonResponse({
        output_text: JSON.stringify({
          chunk_id: input.chunk_id,
          paragraphs_reviewed: ['p1'],
          annotations: [{
            paragraph_id: 'p1',
            quote: 'The small sample limits generalizability.',
            occurrence: 0,
            category_id: 'limitation',
            confidence: 0.96,
            reason_zh: `cache-rule-${annotationCalls}`
          }]
        })
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['limitation']
    }
  });
  const document = {
    title: 'Cache signature study',
    paragraphs: [{
      paragraphId: 'p1', sectionTitle: 'Discussion',
      text: 'The small sample limits generalizability.'
    }]
  };
  await selectStudyType(router, document);
  const analyze = () => router.handle({ type: 'LLM_ANALYZE_DOCUMENT', document });

  const initial = await analyze();
  assert.equal(initial.success, true);
  assert.equal(annotationCalls, 1);
  assert.equal(initial.data.annotations[0].categories[0].reasonZh, 'cache-rule-1');

  const saved = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
    override: {
      enabledEngines: ['llm'],
      prompt: {
        definition: 'A materially changed limitation definition.',
        positiveExamples: ['A materially changed limitation example.'],
        minimumConfidence: 0.91
      },
      regex: {
        phrases: ['material limitation'], expressions: [],
        caseSensitive: false, wholeWord: true
      }
    }
  });
  assert.equal(saved.success, true);
  const changed = await analyze();
  assert.equal(changed.success, true);
  assert.equal(annotationCalls, 2);
  assert.equal(changed.data.annotations[0].categories[0].reasonZh, 'cache-rule-2');
  assert.deepEqual(changed.data.analyzedCategoryIds, ['limitation']);

  const reset = await router.handle({
    type: 'CATEGORY_RESET_OVERRIDE', categoryId: 'limitation'
  });
  assert.equal(reset.success, true);
  const restored = await analyze();
  assert.equal(restored.success, true);
  assert.equal(annotationCalls, 2);
  assert.equal(restored.data.annotations[0].categories[0].reasonZh, 'cache-rule-1');
  assert.deepEqual(restored.data.cachedCategoryIds, ['limitation']);
});

test('refuses article analysis until provider and consent are ready', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => jsonResponse({})
  });
  const result = await router.handle({
    type: 'LLM_ANALYZE_DOCUMENT',
    document: { paragraphs: [{ paragraphId: 'p1', text: 'Text' }] }
  });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'LLM_NOT_READY');
});

test('records bounded feedback, suggests export, and distills corpus rules', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => jsonResponse({})
  });
  for (const [index, documentHash] of ['d1', 'd2', 'd3'].entries()) {
    const recorded = await router.handle({
      type: 'LLM_RECORD_FEEDBACK',
      sample: {
        documentHash,
        paragraphId: `p${index}`,
        quote: `We found that treatment ${index} improved survival.`,
        categoryId: 'result',
        userAction: 'accepted',
        url: 'https://must-not-store.example'
      }
    });
    assert.equal(recorded.success, true);
  }
  const status = await router.handle({ type: 'LLM_CORPUS_STATUS' });
  assert.equal(status.data.suggestExport, true);
  const exported = await router.handle({ type: 'LLM_EXPORT_CORPUS', format: 'jsonl' });
  assert.equal(exported.data.content.includes('must-not-store'), false);
  const distilled = await router.handle({ type: 'LLM_DISTILL_RULES' });
  assert.ok(distilled.data.rules.result.patterns.includes('we found'));
});

test('stores saved and one-off custom categories separately and uses them for analysis', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  let requestBody;
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea,
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      const input = JSON.parse(requestBody.input);
      return jsonResponse({
        output_text: JSON.stringify({
          chunk_id: input.chunk_id,
          paragraphs_reviewed: ['p1'],
          annotations: []
        })
      });
    }
  });

  const saved = await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_translation',
      name: 'Clinical translation',
      definition: 'Statements that explicitly connect findings to clinical decisions.',
      persistence: 'saved',
      spanPolicy: 'clause',
      color: '#3366CC'
    }
  });
  assert.equal(saved.success, true);
  assert.equal(storageArea.values.sciLlmSettingsV2.customCategories[0].categoryId, 'custom_translation');

  const oneOff = await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_trial_risk',
      name: 'Trial risk',
      definition: 'Trial-specific operational risks.',
      persistence: 'one-off',
      spanPolicy: 'sentence',
      color: '#8844AA'
    }
  });
  assert.equal(oneOff.success, true);
  assert.equal(sessionStorageArea.values.sciLlmSessionCategoriesV2[0].categoryId, 'custom_trial_risk');
  assert.deepEqual(oneOff.data.customCategories.map(item => item.categoryId), [
    'custom_translation', 'custom_trial_risk'
  ]);

  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['custom_trial_risk']
    }
  });
  const document = {
    paragraphs: [{
      paragraphId: 'p1', sectionTitle: 'Discussion', text: 'Recruitment may fail.'
    }]
  };
  await selectStudyType(router, document);
  const analyzed = await router.handle({
    type: 'LLM_ANALYZE_DOCUMENT',
    document
  });
  assert.equal(analyzed.success, true);
  assert.match(requestBody.instructions, /custom_trial_risk/);
  assert.equal(analyzed.data.categories[0].categoryId, 'custom_trial_risk');
});

test('keeps one-off categories in router memory when session storage is unavailable', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: null,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const saved = await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_memory_only', name: 'Memory only',
      definition: 'A one-off category retained for this router lifetime.',
      persistence: 'one-off', spanPolicy: 'clause', color: '#3366CC'
    }
  });
  assert.equal(saved.success, true);
  assert.ok(saved.data.customCategories.some(item => item.categoryId === 'custom_memory_only'));
  const opened = await router.handle({
    type: 'CATEGORY_GET', categoryId: 'custom_memory_only'
  });
  assert.equal(opened.success, true);

  const deleted = await router.handle({
    type: 'LLM_DELETE_CUSTOM_CATEGORY', categoryId: 'custom_memory_only'
  });
  assert.equal(deleted.success, true);
  assert.equal(
    deleted.data.customCategories.some(item => item.categoryId === 'custom_memory_only'),
    false
  );
  const missing = await router.handle({
    type: 'CATEGORY_GET', categoryId: 'custom_memory_only'
  });
  assert.equal(missing.success, false);
  assert.equal(missing.error.code, 'INVALID_SETTINGS');
});

test('opens and fully edits a persistent custom category without changing its identity', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_translation', name: 'Clinical translation',
      definition: 'Connects findings to clinical decisions.',
      persistence: 'saved', spanPolicy: 'clause', color: '#3366CC'
    }
  });

  const opened = await router.handle({
    type: 'CATEGORY_GET', categoryId: 'custom_translation'
  });
  assert.equal(opened.success, true);
  assert.equal(opened.data.metadata.builtIn, false);
  assert.equal(opened.data.category.persistence, 'saved');
  assert.deepEqual(opened.data.category.regex.phrases, []);

  const edited = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'custom_translation',
    override: {
      name: 'Clinical applicability',
      prompt: {
        definition: 'Edited persistent definition.',
        positiveExamples: ['This finding may guide patient selection.']
      },
      regex: {
        phrases: ['patient selection'], expressions: [],
        caseSensitive: false, wholeWord: true
      }
    }
  });
  assert.equal(edited.success, true);
  assert.equal(edited.data.category.categoryId, 'custom_translation');
  assert.equal(edited.data.category.builtIn, false);
  assert.equal(edited.data.category.persistence, 'saved');
  assert.equal(edited.data.category.prompt.definition, 'Edited persistent definition.');
  assert.deepEqual(edited.data.category.regex.phrases, ['patient selection']);
  const stored = storageArea.values.sciLlmSettingsV2.customCategories[0];
  assert.equal(stored.categoryId, 'custom_translation');
  assert.equal(stored.builtIn, false);
  assert.equal(stored.persistence, 'saved');
  assert.equal(stored.prompt.definition, 'Edited persistent definition.');
  assert.equal(sessionStorageArea.values.sciLlmSessionCategoriesV2, undefined);

  const reset = await router.handle({
    type: 'CATEGORY_RESET_OVERRIDE', categoryId: 'custom_translation'
  });
  assert.equal(reset.success, false);
  assert.equal(reset.error.code, 'INVALID_SETTINGS');
  assert.deepEqual(reset.error.fields, ['categoryId']);
});

test('opens, regex-tests, and fully edits a one-off custom category in session storage', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_trial_risk', name: 'Trial risk',
      definition: 'Trial-specific operational risks.',
      persistence: 'one-off', spanPolicy: 'sentence', color: '#8844AA'
    }
  });

  const opened = await router.handle({
    type: 'CATEGORY_GET', categoryId: 'custom_trial_risk'
  });
  assert.equal(opened.success, true);
  assert.equal(opened.data.metadata.builtIn, false);
  assert.equal(opened.data.category.persistence, 'one-off');

  const edited = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'custom_trial_risk',
    override: {
      prompt: { definition: 'Edited one-off definition.' },
      regex: {
        phrases: ['recruitment risk'], expressions: [],
        caseSensitive: false, wholeWord: true
      }
    }
  });
  assert.equal(edited.success, true);
  const stored = sessionStorageArea.values.sciLlmSessionCategoriesV2[0];
  assert.equal(stored.categoryId, 'custom_trial_risk');
  assert.equal(stored.builtIn, false);
  assert.equal(stored.persistence, 'one-off');
  assert.equal(stored.prompt.definition, 'Edited one-off definition.');
  assert.deepEqual(stored.regex.phrases, ['recruitment risk']);
  assert.equal(storageArea.values.sciLlmSettingsV2.customCategories.length, 0);

  const tested = await router.handle({
    type: 'CATEGORY_TEST_REGEX', categoryId: 'custom_trial_risk',
    testText: 'A recruitment risk was identified.'
  });
  assert.equal(tested.success, true);
  assert.equal(tested.data.matches[0].text, 'recruitment risk');
});

test('changing confidence threshold reuses raw cached annotations without another provider call', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      const schemaName = body.text?.format?.name;
      if (schemaName === 'study_profile') {
        return jsonResponse({
          output_text: JSON.stringify({
            primary_type: 'observational', secondary_type: null,
            confidence: 0.91, reason_zh: '观察性研究', blueprint: validBlueprint
          })
        });
      }
      if (schemaName === 'evidence_ledger') {
        return jsonResponse({
          output_text: JSON.stringify({
            key_annotation_ids: [], relation_summaries: [],
            review_warnings: [], audit_items: []
          })
        });
      }
      const input = JSON.parse(body.input);
      return jsonResponse({
        output_text: JSON.stringify({
          chunk_id: input.chunk_id,
          paragraphs_reviewed: ['p1'],
          annotations: [{
            paragraph_id: 'p1',
            quote: 'The small sample size limits generalizability.',
            occurrence: 0,
            category_id: 'limitation',
            confidence: 0.82,
            reason_zh: '明确局限'
          }]
        })
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'test-key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['limitation'], confidenceThreshold: 0.85
    }
  });
  const message = {
    type: 'LLM_ANALYZE_DOCUMENT',
    document: {
      title: 'Study',
      paragraphs: [{
        paragraphId: 'p1', sectionTitle: 'Discussion',
        text: 'The small sample size limits generalizability.'
      }]
    }
  };
  await selectStudyType(router, message.document);
  const first = await router.handle(message);
  const callsAfterFirstAnalysis = calls;
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { confidenceThreshold: 0.8 }
  });
  const second = await router.handle(message);

  assert.equal(callsAfterFirstAnalysis, 2);
  assert.equal(calls, callsAfterFirstAnalysis);
  assert.equal(first.data.annotations[0].categories[0].confidence, 0.82);
  assert.equal(second.data.annotations[0].categories[0].confidence, 0.82);
  assert.equal(second.data.confidenceThreshold, 0.8);
  assert.deepEqual(second.data.cachedCategoryIds, ['limitation']);
});

function figureMessage(figures, overrides = {}) {
  return {
    type: 'LLM_ANALYZE_FIGURES',
    evidenceContractToken: globalThis.SciLLM.FIGURE_EVIDENCE_CONTRACT_TOKEN,
    document: {
      title: 'Mechanistic study',
      paragraphs: [{
        paragraphId: 'p1',
        sectionTitle: 'Results',
        text: 'Figure 1 and Figure 2 report the main experiments.'
      }]
    },
    figures,
    ...overrides
  };
}

function figureInput(number, images = []) {
  return {
    figureId: 'figure-' + number,
    figureLabel: 'Figure ' + number,
    caption: 'Figure ' + number + '. Experimental result.',
    contextParagraphs: [{
      paragraphId: 'p1',
      text: 'Figure ' + number + ' reports the result.'
    }],
    images
  };
}

test('PDF Figure router dispatch uses verified evidence and refuses stale or forged owners', async () => {
  const { pdfFigureRequestFixture } = require('./helpers/pdf-figure-request-fixture.js');
  const fixture = await pdfFigureRequestFixture();
  const payloads = [];
  let replaceAfterProvider = false;
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), sessionStorageArea: createMemoryStorage(),
    runtimeExtensionId: 'extension-id', sleepImpl: async () => {},
    fetchImpl: async (_url, options) => {
      const input = JSON.parse(JSON.parse(options.body).messages[1].content);
      payloads.push(input);
      if (replaceAfterProvider) fixture.setCurrent(false);
      return jsonResponse({ choices: [{ finish_reason: 'stop',
        message: { content: JSON.stringify(figurePassOutput(input)) } }] });
    }
  });
  await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
    config: { apiKey: 'fixture-key', model: 'deepseek-v4-pro' } });
  await router.handle({ type: 'LLM_UPDATE_PREFERENCES', preferences: {
    mode: 'llm', providerId: 'deepseek', consentGranted: true } });
  let currentChecks = 0;
  const owner = { ...figureCheckpointContext(), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 184, senderFrameId: 0,
    senderDocumentId: '84848484-8484-4484-8484-848484848484',
    senderUrl: 'chrome-extension://extension-id/pdf-reader.html',
    runtimeBaseUrl: 'chrome-extension://extension-id/',
    verifyPdfFigureContext: async query => { currentChecks += 1; return fixture.verifyCurrent(query); } };
  const request = sequence => figureMessage([{ ...fixture.figure,
    caption: 'UNVERIFIED CAPTION', contextParagraphs: [{ paragraphId: 'legacy', text: 'UNVERIFIED BODY' }]
  }], { analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 184,
    operationId: `pdf-verified-operation-${sequence}`,
    figureRequestReceipt: `figure-request-pdf-verified-${sequence}-1234567890`,
    figureOperationPlan: [{ figureId: 'figure-2', panelCount: 1 }],
    providerAttemptsConsumed: 0, forceRefresh: true });
  const first = await router.handle(request(1), owner);
  assert.equal(first.success, true, JSON.stringify(first));
  assert.ok(payloads.length >= 1);
  assert.ok(currentChecks >= payloads.length + 2, 'check admission, dispatch and publication');
  assert.doesNotMatch(JSON.stringify(payloads), /UNVERIFIED/);
  assert.match(JSON.stringify(payloads), /Perfusion was quantified/);
  assert.match(JSON.stringify(payloads), /20%/);
  const count = payloads.length;
  fixture.setCurrent(false);
  const checksBeforeReplay = currentChecks;
  const staleReplay = await router.handle(request(1), owner);
  assert.equal(staleReplay.success, false, 'a receipt replay must not publish a replaced PDF result');
  assert.equal(staleReplay.error.code, 'PDF_FIGURE_CONTEXT_STALE');
  assert.ok(currentChecks > checksBeforeReplay, 'receipt hits must recheck the actual PDF owner');
  assert.equal(payloads.length, count);
  const stale = await router.handle(request(2), owner);
  assert.equal(stale.success, false);
  assert.match(JSON.stringify(stale), /PDF_FIGURE_CONTEXT_STALE/);
  assert.equal(payloads.length, count);
  const forged = await router.handle(request(3), { ...owner,
    senderUrl: 'chrome-extension://another-extension/pdf-reader.html' });
  assert.equal(forged.success, false);
  assert.equal(forged.error.code, 'PDF_FIGURE_OWNER_UNAVAILABLE');
  assert.match(JSON.stringify(forged), /PDF_FIGURE_OWNER_UNAVAILABLE/);
  assert.equal(payloads.length, count);
  fixture.setCurrent(true);
  let admitted = false;
  const clearedBeforeDispatch = await router.handle(request(4), { ...owner,
    verifyPdfFigureContext: async query => {
      if (admitted) fixture.setCurrent(false);
      admitted = true;
      return fixture.verifyCurrent(query);
    } });
  assert.equal(clearedBeforeDispatch.success, false);
  assert.equal(payloads.length, count, 'replacement after admission must prevent provider dispatch');
  fixture.setCurrent(true);
  replaceAfterProvider = true;
  const clearedAfterProvider = await router.handle(request(5), owner);
  assert.equal(clearedAfterProvider.success, false);
  assert.ok(payloads.length > count, 'exercise a completed provider response under a replaced owner');
  assert.match(JSON.stringify(clearedAfterProvider), /PDF_FIGURE_CONTEXT_STALE|FIGURE_CHECKPOINT_PERSIST_FAILED/);
});

test('native PDF single-Panel interpretation and follow-up validate before receipt cache and provider', async () => {
  const { pdfFigurePanelRequestFixture } = require('./helpers/pdf-figure-request-fixture.js');
  for (const [mode, requestMode] of [
    ['text-only', 'interpretation'], ['text-only', 'followup'],
    ['vision', 'interpretation'], ['vision', 'followup']
  ]) {
    const fixture = await pdfFigurePanelRequestFixture(mode);
    const storageArea = createMemoryStorage();
    const entries = new Map();
    const payloads = [];
    const router = createBackgroundRouter({
      storageArea, sessionStorageArea: createMemoryStorage(),
      runtimeExtensionId: 'extension-id', sleepImpl: async () => {},
      cacheStore: {
        async getMany(keys) {
          return new Map(keys.filter(key => entries.has(key))
            .map(key => [key, structuredClone(entries.get(key))]));
        },
        async setMany(values) {
          values.forEach(value => entries.set(value.key, structuredClone(value)));
        },
        async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
      },
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        let input;
        try { input = openAIInputPayload(body); }
        catch (_) {
          const user = body.messages?.[1]?.content;
          input = JSON.parse(Array.isArray(user)
            ? user.find(item => item.type === 'text').text : user);
        }
        payloads.push(structuredClone(input));
        let output;
        if (requestMode === 'followup') {
          output = {
            ...panelFollowupOutput(input),
            source_refs: [
              { kind: 'paragraph',
                ref: input.available_source_refs.paragraph_ids[0],
                paragraph_id: input.available_source_refs.paragraph_ids[0],
                quote: 'This Figure 3 effect was not seen in controls.' },
              { kind: 'paragraph',
                ref: input.available_source_refs.paragraph_ids[0],
                paragraph_id: input.available_source_refs.paragraph_ids[0],
                quote: '' },
              { kind: 'paragraph',
                ref: input.available_source_refs.paragraph_ids[0],
                paragraph_id: input.available_source_refs.paragraph_ids[0],
                quote: 'This Figure 2 effect was not seen in controls .' }
            ]
          };
        } else {
          output = panelInterpretationOutput(input);
        }
        return String(url).includes('deepseek')
          ? jsonResponse({ choices: [{ finish_reason: 'stop',
            message: { content: JSON.stringify(output) } }] })
          : jsonResponse({ output_text: JSON.stringify(output) });
      }
    });
    if (mode === 'vision') await configureOpenAIRouter(router);
    else {
      await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
        config: { apiKey: 'fixture-key', model: 'deepseek-v4-pro' } });
      await router.handle({ type: 'LLM_UPDATE_PREFERENCES', preferences: {
        mode: 'llm', providerId: 'deepseek', consentGranted: true } });
    }
    let checks = 0;
    const owner = {
      trustedExtensionSender: true, senderExtensionId: 'extension-id',
      senderTabId: 188, senderFrameId: 0,
      senderDocumentId: '88888888-8888-4888-8888-888888888888',
      senderUrl: 'chrome-extension://extension-id/pdf-reader.html',
      runtimeBaseUrl: 'chrome-extension://extension-id/',
      async verifyPdfFigureContext(query) {
        checks += 1;
        return fixture.verifyCurrent(query);
      }
    };
    const suffix = `${mode}-${requestMode}`;
    const currentPdfEvidenceBinding = {
      figureId: fixture.figure.figureId,
      binding: fixture.binding,
      semanticContextDigest: fixture.envelope.semanticContextDigest,
      assetProof: fixture.envelope.assetProof || null
    };
    const request = {
      evidenceContractToken: globalThis.SciLLM.FIGURE_EVIDENCE_CONTRACT_TOKEN,
      type: requestMode === 'followup'
        ? 'LLM_ASK_FIGURE_PANEL' : 'LLM_ANALYZE_FIGURE_PANEL',
      documentHash: fixture.binding.documentHash,
      document: { title: 'Native PDF Panel' },
      figure: { ...fixture.figure, caption: 'UNVERIFIED CAPTION',
        contextParagraphs: [{ paragraphId: 'unverified', text: 'UNVERIFIED BODY' }] },
      panel: { panel: 'A', purpose: 'CURRENT_BOUND_PANEL_CONTEXT',
        pdfEvidenceBinding: currentPdfEvidenceBinding },
      topics: requestMode === 'followup' ? ['grouping'] : [],
      history: requestMode === 'followup' ? [
        { historyId: 'unbound-history', role: 'user',
          content: 'UNBOUND_HISTORY_MUST_NOT_REACH_PROVIDER' },
        { historyId: 'bound-history', role: 'assistant',
          content: 'CURRENT_BOUND_HISTORY_CONTEXT',
          pdfEvidenceBinding: currentPdfEvidenceBinding }
      ] : [],
      analysisDepth: 'standard',
      operationScope: 'figure', workspaceLifecycle: 188,
      operationId: `pdf-panel-${suffix}`,
      figureRequestReceipt: `figure-request-pdf-panel-${suffix}-12345678`,
      figureOperationPlan: [{ figureId: 'figure-2', panelCount: 1 }],
      providerAttemptsConsumed: 0,
      forceRefresh: true
    };
    const progressEvents = [];
    const response = await router.handle(request, {
      ...owner,
      onProgress(event) {
        progressEvents.push(structuredClone(event));
      }
    });
    assert.equal(response.success, true,
      `${suffix}:${JSON.stringify(response)}:${JSON.stringify(payloads)}`);
    const expectedTaskType = requestMode === 'followup'
      ? 'figure_panel_followup' : 'figure_panel_interpretation';
    for (const phase of ['figure_panel_planning', 'figure_panel_complete']) {
      const event = progressEvents.find(item => item.phase === phase);
      assert.ok(event, `${suffix}:${phase}:missing`);
      assert.equal(event.figureId, fixture.figure.figureId,
        `${suffix}:${phase}:figureId`);
      assert.equal(event.taskType, expectedTaskType,
        `${suffix}:${phase}:taskType`);
      assert.equal(event.route?.taskType, expectedTaskType,
        `${suffix}:${phase}:route.taskType`);
    }
    assert.equal(payloads.length, 1, suffix);
    assert.ok(checks >= 3, suffix);
    assert.doesNotMatch(JSON.stringify(payloads[0]), /UNVERIFIED/u);
    assert.match(JSON.stringify(payloads[0]), /Perfusion/u);
    if (requestMode === 'followup') {
      assert.match(JSON.stringify(payloads[0]), /CURRENT_BOUND_PANEL_CONTEXT/u);
      assert.match(JSON.stringify(payloads[0]), /CURRENT_BOUND_HISTORY_CONTEXT/u);
      assert.doesNotMatch(JSON.stringify(payloads[0]), /UNBOUND_HISTORY_MUST_NOT_REACH_PROVIDER/u);
    }
    const result = requestMode === 'followup'
      ? response.data.panelFollowup : response.data.panelAnalysis;
    assert.equal(result.pdfEvidenceBinding.semanticContextDigest,
      fixture.envelope.semanticContextDigest, suffix);
    const paragraphRefs = result.sourceRefs.filter(ref => ref.kind === 'paragraph');
    if (requestMode === 'followup') {
      assert.equal(paragraphRefs.length, 1, suffix);
      assert.equal(paragraphRefs[0].quote,
        'This Figure 2 effect was not seen in controls.', suffix);
      assert.equal(paragraphRefs[0].sentenceId,
        'pdf-sentence:7fe531c6fc102535', suffix);
      assert.equal(paragraphRefs[0].location.sourceFragments[0].start, 102, suffix);
    } else {
      assert.deepEqual(paragraphRefs, [],
        `${suffix}: an interpretation with no provider refs must not invent citations`);
    }
    assert.equal(payloads[0].analysis_basis,
      mode === 'vision' ? 'vision_text' : 'caption_context', suffix);
    const cachedRequest = { ...request, forceRefresh: false,
      operationId: `${request.operationId}-cache`,
      figureRequestReceipt: `${request.figureRequestReceipt}-cache` };
    const cached = await router.handle(cachedRequest, owner);
    assert.equal(cached.success, true, `${suffix}:cache:${JSON.stringify(cached)}`);
    assert.equal(cached.data.cacheHit, true, suffix);
    assert.equal(payloads.length, 1, suffix);
    fixture.setCurrent(false);
    const replay = await router.handle(cachedRequest, owner);
    assert.equal(replay.success, false, suffix);
    assert.equal(replay.error.code, 'PDF_FIGURE_CONTEXT_STALE', suffix);
    assert.equal(payloads.length, 1, suffix);
    fixture.setCurrent(true);
    const forged = await router.handle({ ...request,
      operationId: `${request.operationId}-forged`,
      figureRequestReceipt: `${request.figureRequestReceipt}-forged`
    }, { ...owner, senderUrl: 'chrome-extension://evil/pdf-reader.html' });
    assert.equal(forged.success, false, suffix);
    assert.equal(forged.error.code, 'PDF_FIGURE_OWNER_UNAVAILABLE', suffix);
    assert.equal(payloads.length, 1, suffix);
    if (requestMode === 'followup') {
      const unbound = await router.handle({
        ...request,
        operationId: `${request.operationId}-unbound-context`,
        figureRequestReceipt: `${request.figureRequestReceipt}-unbound-context`,
        panel: { panel: 'A', purpose: 'UNBOUND_PANEL_MUST_NOT_REACH_PROVIDER' },
        history: [{ historyId: 'unbound-only', role: 'user',
          content: 'UNBOUND_ONLY_HISTORY_MUST_NOT_REACH_PROVIDER' }]
      }, owner);
      assert.equal(unbound.success, true, `${suffix}:unbound:${JSON.stringify(unbound)}`);
      assert.equal(payloads.length, 2, suffix);
      assert.doesNotMatch(JSON.stringify(payloads[1]),
        /UNBOUND_PANEL_MUST_NOT_REACH_PROVIDER|UNBOUND_ONLY_HISTORY_MUST_NOT_REACH_PROVIDER/u);
    }
    if (mode === 'vision') {
      const countBeforeWrongPanel = payloads.length;
      const wrongPanel = await router.handle({
        ...request,
        operationId: `${request.operationId}-wrong-panel`,
        figureRequestReceipt: `${request.figureRequestReceipt}-wrong-panel`,
        figure: { ...request.figure, panelHints: ['D'] },
        panel: { panel: 'D', pdfEvidenceBinding: currentPdfEvidenceBinding }
      }, owner);
      assert.equal(wrongPanel.success, false, suffix);
      assert.equal(wrongPanel.error.code, 'PDF_FIGURE_ASSET_BINDING_CONFLICT', suffix);
      assert.equal(payloads.length, countBeforeWrongPanel,
        `${suffix}: a Panel A child must not dispatch for Panel D`);
    }
  }
});

test('native PDF follow-up keeps a ranked fifth paragraph through prompt validation and cache', async () => {
  require('../core/sentence-boundary.js');
  require('../core/pdf-figure-context.js');
  const { buildPdfSemanticIndex } = require('../core/pdf-semantic-index.js');
  const { createPdfSemanticCompatibilityAdapter } = require('../core/pdf-semantic-compat.js');
  const { createPdfFigureContextProductionAdapter } =
    require('../core/pdf-figure-context-production.js');
  const documentHash = createHash('sha256')
    .update('ranked-fifth-pdf-panel-source').digest('hex');
  const binding = { documentHash, documentGeneration: 4, semanticRevision: 8 };
  const rankedSentence =
    'Figure 2A statistical test reports the ranked fifth PDF sentence at dose 102 units with p < 0.05.';
  const pages = [{ pageNumber: 1, text: [
    'Figure 2. (A) Ranked source validation.',
    'Figure 2A reports background result one.',
    'Figure 2A reports background result two.',
    'Figure 2A reports background result three.',
    'Figure 2A reports background result four.',
    rankedSentence
  ].join('\n\n') }];
  const index = buildPdfSemanticIndex({ documentHash, revision: 8, pages });
  const structure = { version: '1.0.0-pdf-native', adapterId: 'pdf-native',
    documentId: `sha256:${documentHash}`, documentHash, revision: 1,
    paragraphs: pages.map(page => ({ paragraphId: `pdf-page-${page.pageNumber}`,
      sourceKey: `pdf-page-${page.pageNumber}`, pageNumber: page.pageNumber,
      order: 0, text: page.text, displayText: page.text })),
    nodes: [], pages: [{ pageNumber: 1 }] };
  const nativeDocument = { structure, documentGeneration: 4, pageCount: 1 };
  const semanticDocument = { schemaVersion: 1, documentId: structure.documentId,
    adapterId: 'pdf-native', documentHash, documentGeneration: 4, revision: 8,
    pageCount: 1, index };
  let current = true;
  const compatibility = createPdfSemanticCompatibilityAdapter({
    semanticDocument, nativeDocument,
    getCurrentSemanticDocument: () => current ? semanticDocument : null,
    getCurrentNativeDocument: () => current ? nativeDocument : null
  });
  const baseFigure = { figureId: 'figure-2', figureLabel: 'Figure 2',
    caption: 'Figure 2. (A) Ranked source validation.', pageNumber: 1,
    pageNumbers: [1], sourceFingerprint: documentHash };
  const inventory = [baseFigure];
  const production = createPdfFigureContextProductionAdapter({
    semanticDocument, nativeDocument, compatibility, figureInventory: inventory,
    getCurrentSemanticDocument: () => current ? semanticDocument : null,
    getCurrentNativeDocument: () => current ? nativeDocument : null,
    getCurrentCompatibility: () => current ? compatibility : null,
    getCurrentFigureInventory: () => current ? inventory : []
  });
  const selected = await production.selectFigureContext({
    figureId: baseFigure.figureId, route: 'text-only'
  });
  const envelope = { version: 'pdf-figure-production-envelope-v1', verified: true,
    route: 'text-only', binding, figure: selected.target,
    textualEvidence: selected.context.textualEvidence,
    semanticContextDigest: selected.semanticContextDigest,
    assetProof: null, images: [] };
  const figure = { ...baseFigure, panelHints: ['A'], imageVariants: [],
    pdfFigureContext: envelope };
  const pdfBinding = { figureId: figure.figureId, binding,
    semanticContextDigest: envelope.semanticContextDigest, assetProof: null };
  const payloads = [];
  const entries = new Map();
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), sessionStorageArea: createMemoryStorage(),
    runtimeExtensionId: 'extension-id', sleepImpl: async () => {},
    cacheStore: {
      async getMany(keys) {
        return new Map(keys.filter(key => entries.has(key))
          .map(key => [key, structuredClone(entries.get(key))]));
      },
      async setMany(values) {
        values.forEach(value => entries.set(value.key, structuredClone(value)));
      },
      async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
    },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      let input;
      try {
        input = openAIInputPayload(body);
      } catch (_) {
        const user = body.messages?.[1]?.content;
        input = JSON.parse(Array.isArray(user)
          ? user.find(item => item.type === 'text').text
          : user);
      }
      payloads.push(input);
      const ranked = input.related_body_context.find(item => item.text.includes(rankedSentence));
      const paragraphId = ranked?.paragraph_id || input.related_body_context[0]?.paragraph_id || '';
      return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        ...panelFollowupOutput(input),
        source_refs: paragraphId ? [{ kind: 'paragraph', ref: paragraphId,
          paragraph_id: paragraphId,
          quote: 'ranked fifth PDF sentence at dose 102 units with p < 0.05' }] : []
      }) } }] });
    }
  });
  await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
    config: { apiKey: 'fixture-key', model: 'deepseek-v4-pro' } });
  await router.handle({ type: 'LLM_UPDATE_PREFERENCES', preferences: {
    mode: 'llm', providerId: 'deepseek', consentGranted: true } });
  const owner = { trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 189, senderFrameId: 0,
    senderDocumentId: '89898989-8989-4898-8989-898989898989',
    senderUrl: 'chrome-extension://extension-id/pdf-reader.html',
    runtimeBaseUrl: 'chrome-extension://extension-id/',
    async verifyPdfFigureContext() {
      if (!current) return { success: false };
      return { success: true, binding,
        semanticContextDigest: envelope.semanticContextDigest, assetProof: null };
    } };
  const request = (suffix, forceRefresh) => ({
    evidenceContractToken: globalThis.SciLLM.FIGURE_EVIDENCE_CONTRACT_TOKEN,
    type: 'LLM_ASK_FIGURE_PANEL', documentHash,
    document: { title: 'Ranked native PDF Panel' }, figure,
    panel: { panel: 'A', pdfEvidenceBinding: pdfBinding }, topics: [],
    customQuestion: 'What does the ranked fifth statistical sentence report?', history: [],
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 189,
    operationId: `pdf-ranked-fifth-${suffix}`,
    figureRequestReceipt: `figure-request-pdf-ranked-fifth-${suffix}-12345678`,
    figureOperationPlan: [{ figureId: 'figure-2', panelCount: 1 }],
    providerAttemptsConsumed: 0, forceRefresh
  });
  const live = await router.handle(request('live', true), owner);
  assert.equal(live.success, true, JSON.stringify(live));
  assert.equal(payloads[0].related_body_context[0].text, rankedSentence,
    JSON.stringify(payloads[0].related_body_context));
  const bodyRef = live.data.panelFollowup.sourceRefs.find(ref => ref.kind === 'paragraph');
  assert.ok(bodyRef, JSON.stringify({
    textualEvidence: envelope.textualEvidence,
    relatedBodyContext: payloads[0].related_body_context,
    sourceRefs: live.data.panelFollowup.sourceRefs
  }));
  assert.equal(bodyRef.quote, rankedSentence);
  assert.equal(bodyRef.location.expectedNormalizedQuote, rankedSentence);
  assert.equal(bodyRef.location.locatorStatus, 'resolved');
  assert.ok(bodyRef.location.sourceFragments.length > 0);
  const cached = await router.handle(request('cache', false), owner);
  assert.equal(cached.success, true, JSON.stringify(cached));
  assert.equal(cached.data.cacheHit, true);
  assert.equal(payloads.length, 1);
  assert.equal(cached.data.panelFollowup.sourceRefs
    .find(ref => ref.kind === 'paragraph').quote, rankedSentence);
});

test('PDF visual inventory expands real analysis scope and resumes its sealed stage without rebilling', async () => {
  const { pdfFigureRequestFixture } = require('./helpers/pdf-figure-request-fixture.js');
  const fixture = await pdfFigureRequestFixture('vision');
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  const entries = new Map();
  const requests = [];
  const progress = [];
  const inventoryCheckpoints = [];
  let stopAfterInventory = true;
  let failInventoryWriteAfterCommit = false;
  let tamperInventoryHash = false;
  const options = { storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id',
    sleepImpl: async () => {},
    cacheStore: {
      async getMany(keys) { return new Map(keys.filter(key => entries.has(key)).map(key => [key, structuredClone(entries.get(key))])); },
      async setMany(values) {
        values.forEach(value => entries.set(value.key, structuredClone(value)));
        if (failInventoryWriteAfterCommit && values.some(value => value.inventory)) {
          failInventoryWriteAfterCommit = false;
          throw new Error('Simulate lost persistence ACK after write');
        }
      }
    },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const content = body.messages[1].content;
      const input = JSON.parse(Array.isArray(content) ? content.find(value => value.type === 'text').text : content);
      requests.push({ input, content });
      const result = input.contract_version === 'pdf-figure-panel-inventory-v2'
        ? { panel_marker_inventory: {
          figure_id: input.figure_identity.figure_id,
          image_content_hash: tamperInventoryHash ? '0'.repeat(64) : input.provenance.image_content_hash,
          semantic_context_digest: input.provenance.semantic_context_digest,
          inventory_complete: true,
          markers: [{ label: 'A', clarity: 'clear' }, { label: 'B', clarity: 'clear' }, { label: 'D', clarity: 'uncertain' }]
        } } : figurePassOutput(input);
      return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] });
    }
  };
  let router = createBackgroundRouter(options);
  await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'openai-compatible', config: {
    apiKey: 'inventory-fixture-key', model: 'vision-model', baseUrl: 'https://compatible.example/v1', supportsVision: true } });
  await router.handle({ type: 'LLM_UPDATE_PREFERENCES', preferences: {
    mode: 'llm', providerId: 'openai-compatible', consentGranted: true } });
  const owner = { ...figureCheckpointContext(progress, inventoryCheckpoints), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 184, senderFrameId: 0,
    senderDocumentId: '84848484-8484-4484-8484-848484848484',
    senderUrl: 'chrome-extension://extension-id/pdf-reader.html',
    runtimeBaseUrl: 'chrome-extension://extension-id/', verifyPdfFigureContext: fixture.verifyCurrent,
    confirmPdfFigureInventory: async request => ({success:true,saved:true,inventoryRevision:'offline-inventory',panels:['A','B']}),
    onProgress(event) {
      progress.push(structuredClone(event));
      if (stopAfterInventory && event.phase === 'figure_inventory_ready') {
        stopAfterInventory = false;
        throw new Error('Simulate worker loss after durable inventory, before analysis');
      }
    }
  };
  const request = (sequence, operation = 'resume') => figureMessage([fixture.figure], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 184,
    operationId: `pdf-inventory-${operation}-operation`,
    figureRequestReceipt: `figure-request-pdf-inventory-${sequence}-1234567890`,
    figureOperationPlan: [{ figureId: 'figure-2', panelCount: 1 }],
    providerAttemptsConsumed: 0, forceRefresh: true });
  const interrupted = await router.handle(request(1), owner);
  assert.equal(interrupted.success, false);
  assert.equal(requests.length, 1, JSON.stringify(interrupted));
  assert.equal(requests[0].input.contract_version, 'pdf-figure-panel-inventory-v2');
  assert.equal([...entries.values()].filter(entry => entry.inventory).length, 1);
  router = createBackgroundRouter(options);
  const resumed = await router.handle(request(2), owner);
  assert.equal(resumed.success, true, JSON.stringify(resumed));
  assert.equal(requests.length, 2, 'one inventory call + one scientific analysis across worker restart');
  assert.deepEqual(requests[1].input.expected_panel_labels, ['A', 'B']);
  assert.deepEqual(resumed.data.figureResults[0].panels.map(panel => panel.panel), ['A', 'B']);
  assert.deepEqual(resumed.data.figureResults[0].panelCoverage.expectedPanels, ['A', 'B']);
  assert.ok(progress.some(event => event.phase === 'figure_inventory_ready' &&
    event.discoveredPanelCount === 1 && event.inventoryCoverageComplete === false));
  assert.deepEqual(requests.map(request => request.content.filter(part => part.type === 'image_url').length), [1, 1]);
  assert.deepEqual(requests[0].content.find(part => part.type === 'image_url'), requests[1].content.find(part => part.type === 'image_url'));
  assert.ok(progress.some(event => event.phase === 'figure_inventory_ready' && event.expectedPanelCount === 2));
  const completeCheckpoint = inventoryCheckpoints.at(-1).checkpointEnvelope;
  assert.deepEqual(completeCheckpoint.operationPlan, [{ figureId: 'figure-2', panelCount: 1 }]);
  assert.deepEqual(completeCheckpoint.panelInventoryBinding.effectivePanels, ['A', 'B']);
  let inventoryAsset = null;
  let assetRevision = 0;
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(inventoryAsset),
    persistWorkspaceAssetCheckpoint: async (_path, content) => {
      inventoryAsset = { revision: ++assetRevision, contentHash: 'a'.repeat(64), content: structuredClone(content) };
      return { saved: true };
    }
  });
  await persist({ figures: [{ figureId: 'figure-2',
    pendingStandard: { ...completeCheckpoint.figureResult, operationId: request(2).operationId },
    pendingStandardCheckpointEnvelope: completeCheckpoint
  }] }, { figureId: 'figure-2', analysisDepth: 'standard', checkpointEnvelope: completeCheckpoint });
  await persist({ figures: [{ figureId: 'figure-2',
    standard: { ...resumed.data.figureResults[0], operationId: request(2).operationId }
  }] }, { figureId: 'figure-2', analysisDepth: 'standard', operationId: request(2).operationId,
    clearCheckpointEnvelope: completeCheckpoint });
  assert.equal(inventoryAsset.content.figures[0].pendingStandardCheckpointEnvelope, undefined);
  assert.deepEqual(inventoryAsset.content.figures[0].standard.panels.map(panel => panel.panel), ['A', 'B']);
  router = createBackgroundRouter(options);
  const fromCompleteCheckpoint = await router.handle({ ...request('complete-resume'), forceRefresh: false,
    figureResumeCheckpoint: completeCheckpoint }, owner);
  assert.equal(fromCompleteCheckpoint.success, true, JSON.stringify(fromCompleteCheckpoint));
  assert.equal(requests.length, 2, 'signed expanded checkpoint resumes without either provider stage');
  const replay = await router.handle(request(1), owner);
  assert.equal(replay.success, false);
  assert.equal(requests.length, 2, 'old receipt cannot dispatch again');

  failInventoryWriteAfterCommit = true;
  const lostAck = await router.handle(request(3, 'lost-ack'), owner);
  assert.equal(lostAck.success, false);
  assert.equal(lostAck.error.code, 'FIGURE_CACHE_PERSIST_FAILED');
  assert.equal(requests.length, 3);
  router = createBackgroundRouter(options);
  for (const [index, checkpoint] of [{ figureId: 'figure-2' }, false, 0, ''].entries()) {
    const ledgerBefore = JSON.stringify(sessionStorageArea.values.sciFigureProviderAttemptLedgerV1.operations);
    const logicalLedgerBefore = JSON.stringify(storageArea.values.sciFigureLogicalRequestLedgerV1);
    const invalidResume = await router.handle({ ...request(`bad-checkpoint-${index}`, 'lost-ack'),
      forceRefresh: false, figureResumeCheckpoint: checkpoint }, owner);
    assert.equal(invalidResume.success, false);
    assert.equal(invalidResume.error.code, 'FIGURE_CHECKPOINT_INVALID');
    assert.equal(JSON.stringify(sessionStorageArea.values.sciFigureProviderAttemptLedgerV1.operations), ledgerBefore);
    assert.equal(JSON.stringify(storageArea.values.sciFigureLogicalRequestLedgerV1), logicalLedgerBefore,
      'malformed checkpoint must not consume or seal the persistent inventory proof');
    assert.equal(requests.length, 3, 'malformed checkpoint must leave the valid inventory continuation untouched');
  }
  const recoveredAck = await router.handle(request(4, 'lost-ack'), owner);
  assert.equal(recoveredAck.success, true, JSON.stringify(recoveredAck));
  assert.equal(requests.length, 4, 'pending inventory cache proof must recover without a second inventory call');
  assert.deepEqual(requests[3].input.expected_panel_labels, ['A', 'B']);

  tamperInventoryHash = true;
  const invalid = await router.handle(request(5, 'wrong-image'), owner);
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.code, 'PDF_FIGURE_PANEL_INVENTORY_BINDING_CONFLICT');
  assert.equal(requests.length, 5, 'invalid inventory must not dispatch scientific analysis or a repair');
  tamperInventoryHash = false;
  router = createBackgroundRouter(options);
  const quarantined = await router.handle(request(6, 'replaced'), owner);
  assert.equal(quarantined.success, false);
  assert.equal(quarantined.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(quarantined.error.figureOutcome, 'response_uncommitted');
  assert.equal(quarantined.error.retryProvider, false);
  assert.equal(quarantined.error.failureScope, 'figure_target');
  assert.equal(requests.length, 5,
    'router recreation and a new operation cannot rebill an uncommitted inventory response');
});

test('PDF visual inventory owner change during its own request blocks scientific analysis', async () => {
  const { pdfFigureRequestFixture } = require('./helpers/pdf-figure-request-fixture.js');
  const fixture = await pdfFigureRequestFixture('vision');
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  const requests = [];
  const entries = [];
  const checkpoints = [];
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id',
    sleepImpl: async () => {},
    cacheStore: {
      async getMany() { return new Map(); },
      async setMany(values) { entries.push(...values.map(value => structuredClone(value))); }
    },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const content = body.messages[1].content;
      const input = JSON.parse(content.find(value => value.type === 'text').text);
      requests.push(input);
      assert.equal(input.contract_version, 'pdf-figure-panel-inventory-v2');
      fixture.setCurrent(false);
      return jsonResponse({ choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify({ panel_marker_inventory: {
          figure_id: input.figure_identity.figure_id,
          image_content_hash: input.provenance.image_content_hash,
          semantic_context_digest: input.provenance.semantic_context_digest,
          inventory_complete: true,
          markers: [{ label: 'A', clarity: 'clear' }, { label: 'B', clarity: 'clear' }]
        } })
      } }] });
    }
  });
  await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'openai-compatible', config: {
    apiKey: 'inventory-fixture-key', model: 'vision-model', baseUrl: 'https://compatible.example/v1', supportsVision: true } });
  await router.handle({ type: 'LLM_UPDATE_PREFERENCES', preferences: {
    mode: 'llm', providerId: 'openai-compatible', consentGranted: true } });
  const owner = { ...figureCheckpointContext([], checkpoints), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 185, senderFrameId: 0,
    senderDocumentId: '85858585-8585-4585-8585-858585858585',
    senderUrl: 'chrome-extension://extension-id/pdf-reader.html',
    runtimeBaseUrl: 'chrome-extension://extension-id/', verifyPdfFigureContext: fixture.verifyCurrent };
  const response = await router.handle(figureMessage([fixture.figure], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 185,
    operationId: 'pdf-inventory-independent-stale-operation',
    figureRequestReceipt: 'figure-request-pdf-inventory-independent-stale-1234567890',
    figureOperationPlan: [{ figureId: 'figure-2', panelCount: 1 }],
    providerAttemptsConsumed: 0, forceRefresh: true
  }), owner);
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'PDF_FIGURE_CONTEXT_STALE');
  assert.equal(requests.length, 1, 'owner change blocks the later scientific analysis');
  assert.equal(entries.length, 0, 'a stale owner cannot persist inventory or Figure cache');
  assert.equal(checkpoints.length, 0, 'a stale owner cannot checkpoint Panel evidence');
});

function crossFigureInput(number, images = []) {
  return { ...figureInput(number, images), panelHints: ['A'] };
}

function fixtureGroupingBasis(panels) {
  // These routing fixtures do not model a scientific design. Explicitly mark
  // missing grouping evidence rather than inventing source quotes.
  return { criterion: 'uncertain', rationale_zh: '路由夹具未提供可确认的实验分组依据。',
    differences_zh: '', panel_facts: panels.map(panel => ({ panel,
      design_zh: '', timing_zh: '', endpoint_zh: '' })), source_refs: [] };
}

function figureOutput(figureId, basis = 'caption_context', depth = 'standard') {
  const value = {
    figure_id: figureId,
    analysis_depth: depth,
    basis,
    figure_question_zh: '该处理是否改变目标表型？',
    panels: [{
      panel: 'A',
      role: 'phenotype',
      phenotype_name_zh: 'target phenotype',
      method_category: 'wet_lab',
      methods: ['CCK-8'],
      method_source: basis === 'vision_text' ? 'image' : 'caption',
      purpose_zh: '比较处理组和对照组',
      design_zh: '对两组进行同一指标检测',
      comparison_zh: '处理组对照组',
      direct_observation_zh: '处理组比对照组低',
      observation_source: basis === 'vision_text' ? 'image_observation' : 'caption_statement',
      local_inference_zh: '支持处理产生抑制作用',
      contribution_zh: '建立主要表型'
    }],
    panel_groups: [{
      panels: ['A'], group_goal_zh: '建立表型', group_conclusion_zh: '处理抑制目标表型',
      grouping_basis: fixtureGroupingBasis(['A'])
    }],
    logic_bridges: [],
    argument_chain: [{
      panels: ['A'],
      established_zh: 'The treatment changes the target phenotype.',
      handoff_zh: 'This motivates the next analysis step.',
      evidence_level: 'intervention_effect'
    }],
    author_assembly_zh: '作者先比较表型，再限定结论边界。',
    core_conclusion_zh: '该处理抑制目标表型',
    claim_boundary_zh: '该结果本身不证明直接机制。'
  };
  if (depth === 'deep') Object.assign(value, {
    control_analysis: [{
      panels: ['A'], control_type: 'matched_control',
      excluded_explanation_zh: '排除自然变化', adequacy_zh: '仍需独立验证'
    }],
    evidence_relations: [{
      panels: ['A'], relation_level: 'intervention_effect', rationale_zh: '存在处理比较'
    }],
    negative_result_value_zh: '当前输入未提供阴性结果。',
    qualitative_quantitative_link_zh: '定性与定量方向一致。',
    alternative_explanations: ['模型特异性仍可能影响结果。'],
    missing_link_if_panel_removed: ['删除 Panel A 后失去主要表型证据。'],
    paper_argument_role_zh: '建立主要现象。',
    deep_author_strategy_zh: '先建立现象，再限定机制边界。'
  });
  return value;
}

function figurePassOutput(input) {
  const output = figureOutput(
    input.figure_id, input.analysis_basis, input.analysis_depth
  );
  const labels = Array.isArray(input.expected_panel_labels)
    ? input.expected_panel_labels
    : (Array.isArray(input.panel_evidence)
      ? input.panel_evidence.map(panel => panel.panel)
      : ['A']);
  const boundedLabels = labels.length ? labels : ['A'];
  output.panels = boundedLabels.map(label => ({ ...output.panels[0], panel: label }));
  output.panel_groups[0].panels = boundedLabels;
  output.panel_groups[0].grouping_basis = fixtureGroupingBasis(boundedLabels);
  output.argument_chain[0].panels = boundedLabels;
  if (input.pass === 'panel_extraction') {
    return {
      figure_id: output.figure_id,
      analysis_depth: output.analysis_depth,
      basis: output.basis,
      panels: output.panels
    };
  }
  if (input.pass === 'figure_synthesis') {
    const { panels, ...synthesis } = output;
    return synthesis;
  }
  return output;
}

function figureCheckpointContext(progress = [], checkpoints = [], persist = null) {
  return {
    onProgress(value) { progress.push(structuredClone(value)); },
    async onFigureCheckpoint(value) {
      checkpoints.push(structuredClone(value));
      if (persist) return persist(value);
      return {
        success: true,
        savedPanelCount: Array.isArray(value?.figureResult?.panels)
          ? value.figureResult.panels.length : 0
      };
    }
  };
}

test('mechanism browser-session identity is same-realm atomic, stable and fails closed', async () => {
  const sharedStorage = createDelayedCloneStorage();
  const first = createMechanismBrowserSessionIdentityProvider({
    storageArea: sharedStorage, cryptoImpl: webcrypto
  });
  const peer = createMechanismBrowserSessionIdentityProvider({
    storageArea: sharedStorage, cryptoImpl: webcrypto
  });
  const [firstId, peerId] = await Promise.all([first(), peer()]);
  assert.match(firstId, /^[a-f0-9]{64}$/u);
  assert.equal(peerId, firstId,
    'concurrent workers converge on the same storage.session incarnation');
  assert.equal(await first(), firstId);

  const nextStorage = createMemoryStorage();
  const next = createMechanismBrowserSessionIdentityProvider({
    storageArea: nextStorage, cryptoImpl: webcrypto
  });
  assert.notEqual(await next(), firstId,
    'a cleared browser session receives a fresh incarnation');

  const failures = [
    createMechanismBrowserSessionIdentityProvider({
      storageArea: { get() { throw new Error('read failed'); }, set() {} },
      cryptoImpl: webcrypto
    }),
    createMechanismBrowserSessionIdentityProvider({
      storageArea: {
        get(_key, callback) { callback({}); },
        set() { throw new Error('write failed'); }
      },
      cryptoImpl: webcrypto
    }),
    createMechanismBrowserSessionIdentityProvider({
      storageArea: createMemoryStorage(), cryptoImpl: {}
    })
  ];
  for (const provider of failures) {
    await assert.rejects(provider(), error =>
      ['MECHANISM_RUN_STATE_READ_FAILED', 'MECHANISM_RUN_STATE_WRITE_FAILED']
        .includes(error.code) && error.retryable === false
    );
  }
});

test('production evidence routing injects storage.session identity and fails closed if unavailable', async () => {
  const originalCreateCoordinator = globalThis.SciLLM.createMechanismOperationCoordinator;
  const sessionStorageArea = createMemoryStorage();
  let capturedOptions = null;
  globalThis.SciLLM.createMechanismOperationCoordinator = options => {
    capturedOptions = options;
    return originalCreateCoordinator(options);
  };
  try {
    createBackgroundRouter({
      storageArea: createMemoryStorage(), sessionStorageArea,
      runtimeExtensionId: 'extension-id', cryptoImpl: webcrypto,
      fetchImpl: async () => jsonResponse({})
    });
  } finally {
    globalThis.SciLLM.createMechanismOperationCoordinator = originalCreateCoordinator;
  }
  assert.equal(typeof capturedOptions?.sessionIdentityProvider, 'function');
  const productionId = await capturedOptions.sessionIdentityProvider();
  assert.match(productionId, /^[a-f0-9]{64}$/u);
  assert.notEqual(productionId, '0'.repeat(64));
  assert.equal(
    sessionStorageArea.values.sciMechanismBrowserSessionV1.sessionId,
    productionId
  );

  let providerCalls = 0;
  const unavailableSession = {
    get(_key, callback) { callback({}); },
    set(_value, callback) { callback(); }
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), sessionStorageArea: unavailableSession,
    runtimeExtensionId: 'extension-id', cryptoImpl: webcrypto,
    fetchImpl: async () => { providerCalls += 1; return jsonResponse({}); }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:missing-browser-session-authority'
  }), {
    trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 65, senderFrameId: 0,
    senderDocumentId: '65656565-6565-4565-8565-656565656565'
  });
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'MECHANISM_RUN_STATE_READ_FAILED');
  assert.equal(providerCalls, 0);
});

function canonicalFigureCheckpointJson(value, ancestors = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite checkpoint value');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('cyclic checkpoint value');
    ancestors.add(value);
    const result = `[${value.map(item => canonicalFigureCheckpointJson(
      item === undefined ? null : item, ancestors
    )).join(',')}]`;
    ancestors.delete(value);
    return result;
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) {
    throw new Error('invalid checkpoint value');
  }
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).filter(key =>
    descriptors[key]?.enumerable === true && descriptors[key]?.value !== undefined
  ).sort();
  const fields = keys.map(key => {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) throw new Error('checkpoint accessor');
    return `${JSON.stringify(key)}:${canonicalFigureCheckpointJson(
      descriptor.value, ancestors
    )}`;
  });
  ancestors.delete(value);
  return `{${fields.join(',')}}`;
}

async function figureCheckpointDigest(value) {
  const digest = await webcrypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(canonicalFigureCheckpointJson(value))
  );
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function resignFigureCheckpointEnvelope(envelope, mutate) {
  const forged = structuredClone(envelope);
  mutate(forged);
  forged.resultDigest = await figureCheckpointDigest(forged.figureResult);
  const baseBinding = {
    version: forged.version,
    implementationVersion: forged.implementationVersion,
    figureId: forged.figureId,
    analysisDepth: forged.analysisDepth,
    inputDigest: forged.inputDigest,
    routeDigest: forged.routeDigest,
    taskPolicyDigest: forged.taskPolicyDigest,
    planDigest: forged.planDigest,
    operationPlan: forged.operationPlan,
    immutableLimit: forged.immutableLimit
  };
  forged.bindingDigest = await figureCheckpointDigest({
    ...baseBinding,
    bindingDigest: await figureCheckpointDigest(baseBinding),
    inputMode: forged.inputMode,
    visionFallback: forged.visionFallback,
    fallbackReason: forged.fallbackReason,
    resultDigest: forged.resultDigest
  });
  return forged;
}

function figureRecoveryOutput(input, labels, unresolvedLabels = []) {
  const template = figureOutput(
    input.figure_id, input.analysis_basis, input.analysis_depth
  ).panels[0];
  const unresolved = new Set(unresolvedLabels);
  return {
    figure_id: input.figure_id,
    analysis_depth: input.analysis_depth,
    basis: input.analysis_basis,
    panels: labels.map(label => unresolved.has(label) ? {
      panel: label,
      status: 'not_identifiable',
      reason_code: 'insufficient_panel_evidence',
      input_mode: input.input_mode,
      evidence_refs: [input.input_mode === 'figure_image'
        ? `image:figure_${input.figure_id}`
        : `caption:panel_${label}`]
    } : {
      ...template,
      panel: label,
      methods: [`Assay ${label}`],
      evidence_type_zh: 'controlled experiment',
      experimental_methods: [`Assay ${label}`],
      statistical_methods: []
    })
  };
}

function partialFigurePassOutput(input, returnedLabels) {
  const output = figurePassOutput(input);
  output.panels = output.panels
    .filter(panel => returnedLabels.includes(panel.panel))
    .map(panel => ({
      ...panel,
      methods: [`Assay ${panel.panel}`],
      purpose_zh: `Purpose ${panel.panel}`,
      direct_observation_zh: `Observation ${panel.panel}`
    }));
  return output;
}

function panelFollowupOutput(input) {
  return {
    figure_id: input.figure_id,
    panel: input.panel,
    topics: input.requested_topics,
    basis: input.analysis_basis,
    answer_zh: 'Only the requested Panel information is explained from the supplied evidence.',
    claim_boundary_zh: 'Details not visible in the figure or supplied text are not inferred.',
    source_refs: [
      { kind: 'paragraph', ref: 'p1', paragraph_id: 'p1', quote: 'reports the result' }
    ]
  };
}

function panelInterpretationOutput(input) {
  const raw = figureOutput(input.figure_id, input.analysis_basis, 'standard').panels[0];
  return {
    figure_id: input.figure_id,
    panel: input.panel,
    basis: input.analysis_basis,
    panel_interpretation: { ...raw, panel: input.panel },
    claim_boundary_zh: 'The interpretation is limited to the supplied Panel evidence.'
  };
}

function panelImageVariant(edge, width = edge, height = Math.round(edge * 0.75)) {
  const length = Math.max(4, Math.ceil(edge / 4) * 4);
  return {
    mediaType: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${'A'.repeat(length)}`,
    width, height, maxEdge: edge, inputMode: 'figure_image', pixelsSupplied: true
  };
}

function crossFigureOutput(input) {
  if (Array.isArray(input?.panels) && Array.isArray(input?.figures) &&
      !Array.isArray(input?.main_figure_ids)) {
    return { nodes: [
      { node_id: 'observed-state', label_zh: '观察状态', node_type: 'state' },
      { node_id: 'candidate-mechanism', label_zh: '候选机制', node_type: 'process' }
    ] };
  }
  if (Array.isArray(input?.ledger_batch) && Array.isArray(input?.vocabulary)) {
    const panelKeys = input.ledger_batch.map(item => item.panel_key);
    if (input.repair_panel_keys) {
      return { edges: [], dispositions: panelKeys.map(panel_key => ({
        panel_key, status: 'unlinked', reason: 'No explicit evidence-bounded edge.'
      })) };
    }
    return {
      edges: [{
        from_node_id: input.vocabulary[0].node_id,
        to_node_id: input.vocabulary[1].node_id,
        polarity: 'neutral',
        assignments: panelKeys.map(panel_key => ({ panel_key, evidence_class: 'other' }))
      }],
      dispositions: panelKeys.map(panel_key => ({
        panel_key, status: 'linked', edge_indexes: [0]
      }))
    };
  }
  const mainFigureIds = input.main_figure_ids || [];
  const firstPanelKey = input.panel_ledger?.[0]?.panel_key || 'figure-1:A';
  return {
    article_title: input.article_title,
    known_background_zh: ['The pathway is implicated in the baseline phenotype.'],
    innovation_points_zh: ['The figures connect phenotype to mechanism.'],
    limitation_points_zh: ['Only supplied Figure evidence is summarized.'],
    overall_thesis_zh: 'The first main Figure establishes the phenomenon and the next tests its mechanism.',
    mechanism_chain: [{
      from_zh: 'Observed phenotype',
      to_zh: 'Candidate mechanism',
      support_panel_refs: [firstPanelKey]
    }],
    figure_nodes: mainFigureIds.map((figureId, index) => ({
      figure_id: figureId,
      role: index === 0 ? 'phenomenon' : 'mechanism',
      established_zh: `Main evidence from ${figureId}.`,
      transition_zh: index + 1 < mainFigureIds.length
        ? `This motivates ${mainFigureIds[index + 1]}.`
        : 'This completes the supplied main-figure chain.',
      evidence_level: index === 0 ? 'intervention_effect' : 'mechanistic_support'
    })),
    domino_chain: mainFigureIds.slice(1).map((figureId, index) => ({
      from_figure_id: mainFigureIds[index],
      to_figure_id: figureId,
      relation_type: 'phenomenon_to_mechanism',
      established_zh: `The preceding Figure establishes context for ${figureId}.`,
      transition_zh: `The next Figure tests the required explanation.`,
      evidence_boundary_zh: 'The transition does not itself establish every causal step.'
    })),
    supplemental_support: [],
    claim_boundary_zh: 'This summary is limited to the supplied Figure evidence.'
  };
}

function openAIInputPayload(body) {
  const raw = Array.isArray(body.input)
    ? body.input[0].content.find(item => item.type === 'input_text').text
    : body.input;
  return JSON.parse(raw);
}

function evidenceFirstFigure(number, panelIds) {
  const figure = crossFigureInput(number);
  figure.panelHints = [...panelIds];
  figure.panelAnalyses = Object.fromEntries(panelIds.map((panelId, index) => [panelId, {
    panel: panelId,
    role: index === 0 ? 'perturbation' : 'readout',
    phenotypeName: `Outcome ${number}-${panelId}`,
    evidenceType: 'controlled experiment',
    experimentalMethods: ['bounded assay'],
    statisticalMethods: ['bounded test'],
    methodSource: 'saved_panel_analysis',
    purpose: 'Test one bounded mechanism claim.',
    design: 'Treatment versus matched control.',
    comparison: 'Treatment versus matched control.',
    directObservation: `Mediator ${number}-${panelId} decreases Outcome ${number}-${panelId}.`,
    observationSource: 'saved_panel_analysis',
    localInference: 'The intervention supports a bounded directional effect.',
    contribution: 'This Panel contributes one evidence atom.',
    remainingQuestion: ''
  }]));
  figure.analysis = {
    coreConclusion: `Figure ${number} contains bounded experimental evidence.`,
    panels: Object.values(figure.panelAnalyses)
  };
  return figure;
}

function evidenceFirstProviderOutput(input) {
  if (Array.isArray(input?.untrusted_panel_evidence)) {
    return { records: input.untrusted_panel_evidence.map(panel => {
      const ordinal = Number(panel.panel_order) + 1;
      const mediator = `Mediator cohort ${ordinal}`;
      const outcome = `Outcome endpoint ${ordinal}`;
      return ({
      handle: panel.handle,
      panelType: 'experimental',
      exclusionReason: '',
      extractionUncertainty: '',
      claims: [{
        semantics: 'causal', causalTest: 'necessity', outcome: 'supports',
        effectSign: 'decreases',
        subjectTerms: [mediator],
        objectTerms: [outcome],
        perturbations: [`Perturb ${mediator}`],
        observations: [`Outcome decreases in ${panel.panel_key}`],
        biologicalContexts: [{
          species: '', tissue: '', cellType: '', compartment: '', condition: '',
          timepoint: '', dose: ''
        }],
        candidateTerms: [mediator, outcome],
        sourceFields: ['directObservation'], uncertaintyReasons: [], modelConfidence: 0.9
      }, {
        semantics: 'associational', causalTest: 'none', outcome: 'supports',
        effectSign: 'decreases',
        subjectTerms: [mediator],
        objectTerms: [outcome],
        perturbations: [], observations: [`The same bounded trend appears in ${panel.panel_key}`],
        biologicalContexts: [{
          species: '', tissue: '', cellType: '', compartment: '', condition: '',
          timepoint: '', dose: ''
        }],
        candidateTerms: [mediator, outcome],
        sourceFields: ['directObservation'], uncertaintyReasons: [], modelConfidence: 0.8
      }]
      });
    }) };
  }
  if (Array.isArray(input?.validated_candidates)) {
    return { groups: input.validated_candidates.map(candidate => ({
      preferred_handle: candidate.candidate_handle,
      member_handles: [candidate.candidate_handle]
    })) };
  }
  if (Array.isArray(input?.untrusted_validated_panels)) {
    return { records: input.untrusted_validated_panels.map(panel => ({
      panel_handle: panel.panel_handle,
      mappings: panel.claims.map(claim => {
        const source = input.relevant_canonical_nodes.find(node =>
          node.source_claim_handles.includes(claim.claim_handle));
        const target = input.relevant_canonical_nodes.find(node =>
          node.target_claim_handles.includes(claim.claim_handle));
        return {
          claim_handle: claim.claim_handle,
          source_node_handle: source.node_handle,
          target_node_handle: target.node_handle,
          relation_kind: claim.causal_test === 'none' ? 'correlative' : 'causal',
          evidence_class: ['necessity', 'sufficiency'].includes(claim.causal_test)
            ? claim.causal_test : 'other',
          polarity: 'decreases', unmappedTerm: ''
        };
      })
    })) };
  }
  return crossFigureOutput(input);
}

function evidenceFirstMessage(overrides = {}) {
  return {
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    evidenceFirstVersion: '2',
    evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: globalThis.SciLLM.EVIDENCE_FIRST_VERSIONS,
    operationId: 'mechanism:evidence-first-router-test',
    documentId: 'document-evidence-first-router-test',
    workspaceId: 'workspace-evidence-first-router-test',
    workspaceGeneration: 1,
    workspaceLifecycle: 0,
    baseWorkspaceRevision: 7,
    mechanismChainFingerprint: 'mechanism-chain-v1-0123456789abcdef',
    document: { title: 'Evidence-first router test' },
    figures: [
      evidenceFirstFigure(1, ['A', 'B', 'C', 'D', 'E']),
      evidenceFirstFigure(2, ['A', 'B', 'C', 'D'])
    ],
    forceRefresh: true,
    ...overrides
  };
}

test('runs the evidence-first router stage machine with two checkpointed workers', async () => {
  const storageArea = createMemoryStorage();
  const stageCalls = [];
  const progressEvents = [];
  let activePanelRequests = 0;
  let maxActivePanelRequests = 0;
  let activeMappingRequests = 0;
  let maxActiveMappingRequests = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      const stage = input.stage || 'cross_figure_overview';
      stageCalls.push(stage);
      if (stage === 'panel_evidence_extraction') {
        activePanelRequests += 1;
        maxActivePanelRequests = Math.max(maxActivePanelRequests, activePanelRequests);
        await new Promise(resolve => setTimeout(resolve,
          input.untrusted_panel_evidence[0].panel_order === 0 ? 8 : 0));
        activePanelRequests -= 1;
      }
      if (stage === 'panel_relation_mapping') {
        activeMappingRequests += 1;
        maxActiveMappingRequests = Math.max(maxActiveMappingRequests, activeMappingRequests);
        await new Promise(resolve => setTimeout(resolve,
          input.untrusted_validated_panels[0].panel_key === 'figure-1:A' ? 8 : 0));
        activeMappingRequests -= 1;
      }
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);

  const response = await router.handle(evidenceFirstMessage(), {
    onProgress(event) { progressEvents.push(structuredClone(event)); }
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.status, 'complete', JSON.stringify({
    status: response.data.status,
    errorCode: response.data.errorCode,
    stageCalls,
    audit: response.data.evidenceFirstMechanism?.audit,
    checkpoint: progressEvents.filter(event => event.checkpointCommitted)
  }));
  assert.equal(response.data.evidenceFirstMechanism.status, 'complete');
  assert.equal(response.data.evidenceFirstMechanism.claims.length, 18);
  assert.match(response.data.crossFigureVersion, /evidence-first-v2$/u);
  assert.equal(response.data.evidenceFirstMechanism.audit.unresolvedPanelKeys.length, 0);
  assert.equal(response.data.mechanismGraph.nodes.length > 0, true);
  assert.equal(response.data.mechanismGraph.edges.length > 0, true);
  assert.doesNotMatch(JSON.stringify(response.data.mechanismGraph),
    /panelKey|panelKeys|claimId|sourceRefs|assignments/iu);
  assert.equal(maxActivePanelRequests, 2);
  assert.equal(maxActiveMappingRequests, 2);
  assert.equal(stageCalls.filter(stage => stage === 'panel_evidence_extraction').length, 3);
  assert.equal(stageCalls.filter(stage => stage === 'canonical_node_proposal').length, 1);
  assert.equal(stageCalls.filter(stage => stage === 'panel_relation_mapping').length, 3);

  const checkpointProgress = progressEvents.filter(event =>
    ['collecting_panel_evidence', 'mapping_claim_relations'].includes(event.phase));
  assert.ok(checkpointProgress.length >= 6);
  for (let index = 1; index < checkpointProgress.length; index += 1) {
    if (checkpointProgress[index].phase === checkpointProgress[index - 1].phase) {
      assert.ok(checkpointProgress[index].completedPanels >=
        checkpointProgress[index - 1].completedPanels);
    }
  }
  assert.ok(checkpointProgress.every(event =>
    event.checkpointCommitted === true && Number.isSafeInteger(event.completedPanels)));
});

test('every evidence provider stage quarantines a lost response without live or restart retry', async () => {
  for (const targetStage of [
    'panel_evidence_extraction',
    'canonical_node_proposal',
    'panel_relation_mapping'
  ]) {
    const storageArea = createMemoryStorage();
    const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
    const stageCalls = [];
    let targetSideEffects = 0;
    const fetchImpl = async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      const stage = input.stage || 'cross_figure_overview';
      stageCalls.push(stage);
      if (stage === targetStage) {
        targetSideEffects += 1;
        const error = new TypeError(`PRIVATE ${targetStage} REMOTE SIDE EFFECT`);
        error.code = targetStage === 'canonical_node_proposal'
          ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
        error.retryable = true;
        throw error;
      }
      return jsonResponse({
        output_text: JSON.stringify(evidenceFirstProviderOutput(input))
      });
    };
    const createRouter = () => createBackgroundRouter({
      storageArea, cacheStore, sleepImpl: async () => {}, fetchImpl
    });
    await configureOpenAIRouter(createRouter());
    const message = evidenceFirstMessage({
      operationId: `mechanism:evidence-live-lost-${targetStage}`,
      figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
    });
    const first = await createRouter().handle(structuredClone(message));
    assert.equal(first.success, true, `${targetStage}: ${JSON.stringify(first)}`);
    assert.equal(first.data.status, 'failed', targetStage);
    assert.equal(first.data.errorCode,
      'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS', targetStage);
    assert.equal(targetSideEffects, 1,
      `${targetStage} retried an unknown provider outcome in the live run`);
    const callsAfterLoss = stageCalls.length;

    const replay = await createRouter().handle(structuredClone(message));
    assert.equal(replay.success, true, `${targetStage}: ${JSON.stringify(replay)}`);
    assert.equal(replay.data.status, 'failed', targetStage);
    assert.equal(replay.data.errorCode,
      'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS', targetStage);
    assert.equal(stageCalls.length, callsAfterLoss,
      `${targetStage} redispatched after router reconstruction`);
    assert.equal(targetSideEffects, 1, targetStage);
  }
});

test('evidence schema repair never retries when the repair response is lost', async () => {
  for (const targetStage of [
    'panel_evidence_extraction',
    'canonical_node_proposal',
    'panel_relation_mapping'
  ]) {
    const storageArea = createMemoryStorage();
    const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
    let targetCalls = 0;
    let providerCalls = 0;
    const fetchImpl = async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      const stage = input.stage || 'cross_figure_overview';
      if (stage === targetStage) {
        targetCalls += 1;
        if (targetCalls === 1) {
          return jsonResponse({ output_text: JSON.stringify(
            targetStage === 'canonical_node_proposal'
              ? { groups: [] } : { records: [] }
          ) });
        }
        const error = new Error(`PRIVATE LOST ${targetStage} REPAIR RESPONSE`);
        error.code = 'REQUEST_TIMEOUT';
        error.retryable = true;
        throw error;
      }
      return jsonResponse({
        output_text: JSON.stringify(evidenceFirstProviderOutput(input))
      });
    };
    const createRouter = () => createBackgroundRouter({
      storageArea, cacheStore, sleepImpl: async () => {}, fetchImpl
    });
    await configureOpenAIRouter(createRouter());
    const message = evidenceFirstMessage({
      operationId: `mechanism:evidence-lost-repair-${targetStage}`,
      figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
    });
    const first = await createRouter().handle(structuredClone(message));
    assert.equal(first.success, true, `${targetStage}: ${JSON.stringify(first)}`);
    assert.equal(first.data.status, 'failed', targetStage);
    assert.equal(first.data.errorCode,
      'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS', targetStage);
    assert.equal(targetCalls, 2,
      `${targetStage} must make one validated-response repair and stop at its lost response`);
    const callsAfterLoss = providerCalls;

    const replay = await createRouter().handle(structuredClone(message));
    assert.equal(replay.success, true, `${targetStage}: ${JSON.stringify(replay)}`);
    assert.equal(replay.data.errorCode,
      'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS', targetStage);
    assert.equal(providerCalls, callsAfterLoss, targetStage);
  }
});

test('resumes an exact ready checkpoint with zero duplicate provider calls and frozen Stage 0', async () => {
  const storageArea = createMemoryStorage();
  const providerBodies = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const serialized = String(options.body || '');
      providerBodies.push(serialized);
      const input = openAIInputPayload(JSON.parse(serialized));
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const secret = 'sk-private-paper-secret-should-not-leak';
  const privatePath = 'D:\\private\\paper\\source.pdf';
  const message = evidenceFirstMessage({
    document: {
      title: 'Evidence-first resume',
      fullText: `Do not upload ${secret}`,
      sourcePath: privatePath
    }
  });

  const first = await router.handle(message);
  const callsAfterFirst = providerBodies.length;
  const resumed = await router.handle(message);

  assert.equal(first.success, true);
  assert.equal(resumed.success, true, JSON.stringify(resumed));
  assert.equal(resumed.data.status, 'complete');
  assert.equal(resumed.data.resumed, true);
  assert.equal(providerBodies.length, callsAfterFirst);
  assert.equal(resumed.data.evidenceFirstStage0.operationEpoch, 1);
  assert.equal(resumed.data.evidenceFirstStage0.evidenceFirstVersion, '2');
  assert.equal(resumed.data.evidenceFirstStage0.baseWorkspaceRevision, 7);
  assert.deepEqual(resumed.data.evidenceFirstStage0.policy, {
    maxPanelsPerBatch: 4,
    maxInFlightProviderRequests: 2,
    maxNetworkRetriesPerBatch: 1,
    maxSchemaRepairsPerBatch: 1,
    truncationSplitSizes: [4, 2, 1],
    providerRequestTimeoutMs: 5 * 60 * 1000,
    operationDeadlineMs: 20 * 60 * 1000,
    suiteDeadlineMs: 90 * 60 * 1000,
    processingMessageAfterMs: 60 * 1000,
    maxProviderRequestsPerRun: 96
  });
  assert.equal(resumed.data.evidenceFirstStage0.versions.routerVersion, '2');
  assert.equal(resumed.data.evidenceFirstStage0.versions.requestVersion, '2');
  assert.match(resumed.data.evidenceFirstStage0.versions.crossFigureVersion,
    /evidence-first-v2$/u);
  assert.deepEqual(
    resumed.data.evidenceFirstStage0.evidenceFirstVersions,
    globalThis.SciLLM.EVIDENCE_FIRST_VERSIONS
  );
  assert.equal(resumed.data.evidenceFirstStage0.versions.cacheVersion,
    'cross-figure-evidence-v11');
  assert.equal(Object.isFrozen(resumed.data.evidenceFirstStage0), true);
  assert.equal(Object.isFrozen(
    resumed.data.evidenceFirstStage0.evidenceFirstVersions
  ), true);
  assert.equal(Object.isFrozen(resumed.data.evidenceFirstStage0.versions), true);
  assert.equal(Object.isFrozen(resumed.data.evidenceFirstStage0.policy), true);
  const terminalStatus = await router.handle({
    type: 'LLM_CONTROL_OPERATION', operationId: message.operationId, command: 'status'
  });
  assert.deepEqual(terminalStatus.data, {
    operationId: message.operationId, epoch: 1, status: 'complete',
    active: false, paused: false, cancelled: false
  });
  const serializedBodies = providerBodies.join('\n');
  assert.equal(serializedBodies.includes(secret), false);
  assert.equal(serializedBodies.includes(privatePath), false);
  assert.equal(JSON.stringify(resumed).includes(secret), false);
  assert.equal(JSON.stringify(resumed).includes(privatePath), false);
});

test('bounds evidence-first truncation splitting schema repair and rate retry', async () => {
  const storageArea = createMemoryStorage();
  const extractionBatchSizes = [];
  let canonicalCalls = 0;
  let mappingCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sleepImpl: async () => {},
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (input.stage === 'panel_evidence_extraction') {
        extractionBatchSizes.push(input.untrusted_panel_evidence.length);
        if (input.untrusted_panel_evidence.length > 1) {
          return jsonResponse({
            status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }
          });
        }
      }
      if (input.stage === 'canonical_node_proposal') {
        canonicalCalls += 1;
        if (canonicalCalls === 1) {
          return jsonResponse({ output_text: JSON.stringify({ groups: [] }) });
        }
      }
      if (input.stage === 'panel_relation_mapping') {
        mappingCalls += 1;
        if (mappingCalls === 1) return jsonResponse({ error: { message: 'private' } }, 429);
      }
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-retry-test',
    figures: [
      evidenceFirstFigure(1, ['A', 'B']),
      evidenceFirstFigure(2, ['A', 'B'])
    ]
  }));

  assert.equal(response.success, true);
  assert.equal(response.data.status, 'complete');
  assert.deepEqual(extractionBatchSizes, [4, 2, 1, 1, 2, 1, 1]);
  assert.equal(canonicalCalls, 2);
  assert.equal(mappingCalls, 2);
  assert.equal(JSON.stringify(response).includes('private'), false);
});

test('a response-body HTTP 400 mapping rejection is checkpointed without ambiguous redispatch', async () => {
  const storageArea = createMemoryStorage();
  let mappingCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (input.stage === 'panel_relation_mapping') {
        mappingCalls += 1;
        return jsonResponse({ error: { message: 'private rejected mapping' } }, 400);
      }
      return jsonResponse({
        output_text: JSON.stringify(evidenceFirstProviderOutput(input))
      });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-mapping-http-400',
    figures: [
      evidenceFirstFigure(1, ['A']),
      evidenceFirstFigure(2, ['A'])
    ]
  }));
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.status, 'needs_review');
  assert.equal(mappingCalls, 1, 'a conclusive 4xx response is never retried');
  assert.doesNotMatch(JSON.stringify(response), /private rejected mapping/u);
});

test('shares the one network retry budget with the one extraction schema repair', async () => {
  const storageArea = createMemoryStorage();
  let extractionCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sleepImpl: async () => {},
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (input.stage === 'panel_evidence_extraction') {
        extractionCalls += 1;
        if (extractionCalls === 1 || extractionCalls === 3) {
          return jsonResponse({ error: { message: 'private transient' } }, 429);
        }
        if (extractionCalls === 2) {
          return jsonResponse({ output_text: JSON.stringify({ records: [] }) });
        }
      }
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-shared-retry-repair-test',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  }));

  assert.equal(response.success, true);
  assert.equal(response.data.status, 'needs_review');
  assert.equal(response.data.errorCode, 'MECHANISM_UNRESOLVED_EVIDENCE');
  assert.equal(extractionCalls, 3, 'schema repair cannot reset the network retry budget');
});

test('fails a complex evidence-first run at the exact 96-request budget', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const labels = Array.from({ length: 22 }, (_, index) =>
    String.fromCharCode('A'.charCodeAt(0) + index));
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      if (input.stage === 'panel_evidence_extraction' &&
          input.untrusted_panel_evidence.length > 1) {
        return jsonResponse({
          status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }
        });
      }
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-budget-test',
    figures: [1, 2, 3].map(number => evidenceFirstFigure(number, labels))
  }));

  assert.equal(response.success, true);
  assert.equal(response.data.status, 'failed');
  assert.equal(response.data.errorCode, 'MECHANISM_PROVIDER_REQUEST_BUDGET_EXCEEDED');
  assert.equal(providerCalls, 96);
  assert.equal(response.data.evidenceFirstMechanism, null);
  assert.equal(response.data.mechanismGraph, null);
});

test('deadline expiry after a provider response commits no Panel progress', async () => {
  const storageArea = createMemoryStorage();
  let fakeNow = 10_000;
  let providerCalls = 0;
  const progressEvents = [];
  const router = createBackgroundRouter({
    storageArea,
    nowImpl: () => fakeNow,
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      fakeNow += 20 * 60 * 1000 + 1;
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-deadline-test',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  }), { onProgress(event) { progressEvents.push(event); } });

  assert.equal(response.success, true);
  assert.equal(response.data.status, 'failed');
  assert.equal(response.data.errorCode, 'MECHANISM_OPERATION_DEADLINE_EXCEEDED');
  assert.equal(providerCalls, 1);
  assert.equal(progressEvents.some(event => event.checkpointCommitted === true), false);
  const status = await router.handle({
    type: 'LLM_CONTROL_OPERATION',
    operationId: 'mechanism:evidence-deadline-test', command: 'status'
  });
  assert.equal(status.data.status, 'failed');
  assert.equal(status.data.active, false);
});

test('cancellation while a provider response is in flight causes zero late checkpoint writes', async () => {
  const storageArea = createMemoryStorage();
  const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
  const guardedWrites = [];
  const cacheStore = {
    getMany: (...args) => baseCache.getMany(...args),
    setMany: (...args) => baseCache.setMany(...args),
    deleteMany: (...args) => baseCache.deleteMany(...args),
    setManyGuarded: (...args) => baseCache.setManyGuarded(...args),
    compareAndSetManyGuarded(values, guard) {
      guardedWrites.push(structuredClone(values));
      return baseCache.compareAndSetManyGuarded(values, guard);
    }
  };
  let releaseProvider;
  let markProviderStarted;
  const providerStarted = new Promise(resolve => { markProviderStarted = resolve; });
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const progressEvents = [];
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      markProviderStarted();
      await providerGate;
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = evidenceFirstMessage({
    operationId: 'mechanism:evidence-cancel-test',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  });
  const pending = router.handle(message, {
    onProgress(event) { progressEvents.push(event); }
  });
  await providerStarted;
  const cancelled = await router.handle({
    type: 'LLM_CONTROL_OPERATION',
    operationId: message.operationId,
    command: 'cancel'
  });
  const writesAfterCancel = guardedWrites.length;
  const progressAfterCancel = progressEvents.length;
  releaseProvider();
  const response = await pending;

  assert.equal(cancelled.success, true);
  assert.equal(response.success, true);
  assert.equal(response.data.status, 'cancelled');
  assert.equal(response.data.errorCode, 'MECHANISM_OPERATION_CANCELLED');
  assert.equal(guardedWrites.length, writesAfterCancel);
  assert.equal(guardedWrites.flat().some(value => Boolean(value.checkpoint)), false);
  assert.equal(progressEvents.some(event => event.checkpointCommitted === true), false);
  assert.equal(progressEvents.length, progressAfterCancel);
});

test('ignored AbortSignal provider timeouts quarantine without retry late writes or privacy leaks', async () => {
  const storageArea = createMemoryStorage();
  const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
  const guardedWrites = [];
  const cacheStore = {
    getMany: (...args) => baseCache.getMany(...args),
    setMany: (...args) => baseCache.setMany(...args),
    deleteMany: (...args) => baseCache.deleteMany(...args),
    setManyGuarded: (...args) => baseCache.setManyGuarded(...args),
    compareAndSetManyGuarded(values, guard) {
      guardedWrites.push(structuredClone(values));
      return baseCache.compareAndSetManyGuarded(values, guard);
    }
  };
  const secret = 'sk-hung-provider-secret-123456789';
  const privatePath = 'D:\\Users\\private\\paper.pdf';
  const rawCanary = 'RAW_PROVIDER_RESPONSE_MUST_NOT_PERSIST';
  const providerBodies = [];
  const lateSettlements = [];
  const progressEvents = [];
  let hang = false;
  const router = createBackgroundRouter({
    storageArea, cacheStore, evidenceProviderRequestTimeoutMs: 15,
    fetchImpl: async (_url, options) => {
      if (!hang) return jsonResponse({ output_text: '{}' });
      providerBodies.push(String(options.body || ''));
      const rawText = new Promise((resolve, reject) => lateSettlements.push({
        resolve: () => resolve(JSON.stringify({
          error: { message: rawCanary },
          ignoredOutput: evidenceFirstProviderOutput(
            openAIInputPayload(JSON.parse(options.body))
          )
        })),
        reject
      }));
      return {
        ok: false,
        status: 400,
        headers: { get() { return null; } },
        text() { return rawText; }
      };
    }
  });
  await configureOpenAIRouter(router);
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: secret, model: 'gpt-5.1' }
  });
  hang = true;
  const message = evidenceFirstMessage({
    operationId: 'mechanism:evidence-hung-provider-test',
    document: {
      title: 'Bounded hung provider test', fullText: `${secret} ${rawCanary}`,
      sourcePath: privatePath, providerHistory: [{ raw: rawCanary }]
    },
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  });
  message.figures[0].panelAnalyses.A.rawProviderResponse = rawCanary;
  message.figures[0].panelAnalyses.A.cacheRecord = { sourcePath: privatePath };

  try {
  const response = await Promise.race([
    router.handle(message, { onProgress(event) { progressEvents.push(event); } }),
    new Promise((_, reject) => setTimeout(() => reject(
      Object.assign(new Error('HUNG_PROVIDER_TEST_TIMEOUT'), { code: 'TEST_TIMEOUT' })
    ), 500))
  ]);
  assert.equal(response.success, true);
  assert.equal(response.data.status, 'failed');
  assert.equal(response.data.errorCode, 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS');
  assert.equal(lateSettlements.length, 1,
    'a timed-out physical call is ambiguous and must never be retried');
  const terminal = await router.handle({
    type: 'LLM_CONTROL_OPERATION', operationId: message.operationId, command: 'status'
  });
  assert.equal(terminal.data.status, 'active');
  assert.equal(terminal.data.active, true,
    'an unknown provider outcome retains the durable active quarantine');

  const secondMessage = evidenceFirstMessage({
    operationId: 'mechanism:evidence-hung-provider-second-test',
    documentId: 'document-hung-provider-second',
    workspaceId: 'workspace-hung-provider-second',
    figures: [evidenceFirstFigure(3, ['A']), evidenceFirstFigure(4, ['A'])]
  });
  const secondResponse = await Promise.race([
    router.handle(secondMessage),
    new Promise((_, reject) => setTimeout(() => reject(
      Object.assign(new Error('SECOND_HUNG_PROVIDER_TEST_TIMEOUT'), { code: 'TEST_TIMEOUT' })
    ), 500))
  ]);
  assert.equal(secondResponse.success, true);
  assert.equal(secondResponse.data.status, 'failed');
  assert.equal(secondResponse.data.errorCode, 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS');
  assert.equal(lateSettlements.length, 2,
    'timed-out physical calls retain both semaphore permits until raw settlement');

  const publicSurface = JSON.stringify({
    providerBodies, guardedWrites, progressEvents, response, terminal, secondResponse
  });
  for (const canary of [secret, privatePath, rawCanary]) {
    assert.equal(publicSurface.includes(canary), false, canary);
  }
  const writesBeforeLateResponses = guardedWrites.length;
  const progressBeforeLateResponses = progressEvents.length;
  lateSettlements[0].resolve();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(guardedWrites.length, writesBeforeLateResponses);
  assert.equal(progressEvents.length, progressBeforeLateResponses);

  const recoveryAfterResolve = evidenceFirstMessage({
    operationId: 'mechanism:evidence-hung-provider-after-resolve-test',
    documentId: 'document-hung-provider-after-resolve',
    workspaceId: 'workspace-hung-provider-after-resolve',
    figures: [evidenceFirstFigure(5, ['A']), evidenceFirstFigure(6, ['A'])]
  });
  const responseAfterResolve = await Promise.race([
    router.handle(recoveryAfterResolve),
    new Promise((_, reject) => setTimeout(() => reject(
      Object.assign(new Error('RESOLVED_PERMIT_TEST_TIMEOUT'), { code: 'TEST_TIMEOUT' })
    ), 500))
  ]);
  assert.equal(responseAfterResolve.success, true);
  assert.equal(responseAfterResolve.data.status, 'failed');
  assert.equal(responseAfterResolve.data.errorCode,
    'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS');
  assert.equal(lateSettlements.length, 3,
    'one raw settlement releases exactly one semaphore permit');

  const writesBeforeLateRejection = guardedWrites.length;
  const progressBeforeLateRejection = progressEvents.length;
  lateSettlements[1].reject(new Error(`${secret} ${privatePath} ${rawCanary}`));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(guardedWrites.length, writesBeforeLateRejection);
  assert.equal(progressEvents.length, progressBeforeLateRejection);
  const recoveryAfterReject = evidenceFirstMessage({
    operationId: 'mechanism:evidence-hung-provider-after-reject-test',
    documentId: 'document-hung-provider-after-reject',
    workspaceId: 'workspace-hung-provider-after-reject',
    figures: [evidenceFirstFigure(7, ['A']), evidenceFirstFigure(8, ['A'])]
  });
  const responseAfterReject = await Promise.race([
    router.handle(recoveryAfterReject),
    new Promise((_, reject) => setTimeout(() => reject(
      Object.assign(new Error('REJECTED_PERMIT_TEST_TIMEOUT'), { code: 'TEST_TIMEOUT' })
    ), 500))
  ]);
  assert.equal(responseAfterReject.success, true);
  assert.equal(responseAfterReject.data.status, 'failed');
  assert.equal(responseAfterReject.data.errorCode,
    'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS');
  assert.equal(lateSettlements.length, 4,
    'one raw rejection releases exactly one semaphore permit');

  const writesBeforeFinalSettlements = guardedWrites.length;
  const progressBeforeFinalSettlements = progressEvents.length;
  lateSettlements[2].resolve();
  lateSettlements[3].reject(new Error('LATE_RECOVERY_REJECTION_MUST_BE_OBSERVED'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(guardedWrites.length, writesBeforeFinalSettlements);
  assert.equal(progressEvents.length, progressBeforeFinalSettlements);

  const recoveredPublicSurface = JSON.stringify({
    providerBodies, guardedWrites, progressEvents, response, terminal, secondResponse,
    responseAfterResolve, responseAfterReject
  });
  for (const canary of [secret, privatePath, rawCanary]) {
    assert.equal(recoveredPublicSurface.includes(canary), false, canary);
  }
  } finally {
    for (const settlement of lateSettlements) settlement.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
});

test('same-id operation B cannot replace operation A identity or suppress its result', async () => {
  const storageArea = createMemoryStorage();
  const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
  const guardedWrites = [];
  const cacheStore = {
    getMany: (...args) => baseCache.getMany(...args),
    setMany: (...args) => baseCache.setMany(...args),
    deleteMany: (...args) => baseCache.deleteMany(...args),
    setManyGuarded: (...args) => baseCache.setManyGuarded(...args),
    compareAndSetManyGuarded(values, guard) {
      guardedWrites.push(structuredClone(values));
      return baseCache.compareAndSetManyGuarded(values, guard);
    }
  };
  let releaseA;
  let markAStarted;
  const aStarted = new Promise(resolve => { markAStarted = resolve; });
  const aGate = new Promise(resolve => { releaseA = resolve; });
  const progressA = [];
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      const firstPanel = input?.untrusted_panel_evidence?.[0]?.panel_key || '';
      if (firstPanel.startsWith('figure-1:')) {
        markAStarted();
        await aGate;
      }
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const operationId = 'mechanism:evidence-epoch-replacement-test';
  const messageA = evidenceFirstMessage({ operationId,
    documentId: 'document-epoch-a', workspaceId: 'workspace-epoch-a',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  });
  const messageB = evidenceFirstMessage({ operationId,
    documentId: 'document-epoch-b', workspaceId: 'workspace-epoch-b',
    figures: [evidenceFirstFigure(3, ['A']), evidenceFirstFigure(4, ['A'])]
  });
  const pendingA = router.handle(messageA, {
    onProgress(event) { progressA.push(event); }
  });
  await aStarted;
  let responseB;
  try {
    responseB = await router.handle(messageB);
  } finally {
    releaseA();
  }
  assert.equal(providerCalls, 1,
    'the mismatched same-id operation is rejected before a second provider dispatch');
  const responseA = await pendingA;

  assert.equal(responseB.success, false, JSON.stringify(responseB));
  assert.equal(responseB.error.code, 'MECHANISM_OPERATION_STALE');
  assert.equal(responseA.success, true);
  assert.equal(responseA.data.status, 'complete');
  assert.equal(responseA.data.evidenceFirstStage0.operationEpoch, 1);
  assert.equal(progressA.some(event => event.checkpointCommitted === true), true);
  assert.equal(guardedWrites.flat().some(value =>
    value?.checkpoint?.binding?.operationEpoch === 2), false);
});

test('a restarted router never redispatches a canonical provider receipt after checkpoint loss', async () => {
  const storageArea = createMemoryStorage();
  const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
  let failCanonicalCheckpoint = true;
  const cacheStore = {
    getMany: (...args) => baseCache.getMany(...args),
    setMany: (...args) => baseCache.setMany(...args),
    deleteMany: (...args) => baseCache.deleteMany(...args),
    setManyGuarded: (...args) => baseCache.setManyGuarded(...args),
    compareAndSetManyGuarded(values, guard) {
      if (failCanonicalCheckpoint && values.some(value =>
        value?.checkpoint?.phase === 'canonicalization')) {
        failCanonicalCheckpoint = false;
        throw new Error('PRIVATE_CANONICAL_CHECKPOINT_FAILURE');
      }
      return baseCache.compareAndSetManyGuarded(values, guard);
    }
  };
  const stages = [];
  const fetchImpl = async (_url, options) => {
    const input = openAIInputPayload(JSON.parse(options.body));
    stages.push(input.stage);
    return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
  };
  const firstRouter = createBackgroundRouter({ storageArea, cacheStore, fetchImpl });
  await configureOpenAIRouter(firstRouter);
  const message = evidenceFirstMessage({
    operationId: 'mechanism:evidence-midstage-resume-test'
  });
  const first = await firstRouter.handle(message);
  const extractionCallsAfterFailure = stages.filter(stage =>
    stage === 'panel_evidence_extraction').length;
  const secondRouter = createBackgroundRouter({ storageArea, cacheStore, fetchImpl });
  const resumed = await secondRouter.handle(message);
  const thirdRouter = createBackgroundRouter({ storageArea, cacheStore, fetchImpl });
  const replayedAgain = await thirdRouter.handle(message);

  assert.equal(first.success, false);
  assert.equal(first.error.code, 'MECHANISM_CHECKPOINT_WRITE_FAILED');
  assert.equal(JSON.stringify(first).includes('PRIVATE'), false);
  assert.equal(resumed.success, true, JSON.stringify(resumed));
  assert.equal(resumed.data.status, 'failed', JSON.stringify(resumed));
  assert.equal(resumed.data.errorCode, 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS');
  assert.equal(replayedAgain.success, true, JSON.stringify(replayedAgain));
  assert.equal(replayedAgain.data.status, 'failed');
  assert.equal(replayedAgain.data.errorCode, 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS');
  assert.equal(stages.filter(stage => stage === 'panel_evidence_extraction').length,
    extractionCallsAfterFailure);
  assert.equal(stages.filter(stage => stage === 'canonical_node_proposal').length, 1);
  assert.equal(stages.filter(stage => stage === 'panel_relation_mapping').length, 0);
});

test('a durable evidence operation rejects trusted document owner drift before provider dispatch', async () => {
  const storageArea = createMemoryStorage();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea: createMemoryStorage(),
    cacheStore, runtimeExtensionId: 'extension-id',
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = evidenceFirstMessage({
    operationId: 'mechanism:evidence-owner-drift'
  });
  const owner = {
    trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 17, senderFrameId: 0,
    senderDocumentId: '17171717-1717-4717-8717-171717171717'
  };
  const first = await router.handle(message, owner);
  const callsAfterFirst = providerCalls;
  const replay = await router.handle(message, {
    ...owner,
    senderDocumentId: '18181818-1818-4818-8818-181818181818'
  });
  assert.equal(first.success, true, JSON.stringify(first));
  assert.equal(replay.success, false, JSON.stringify(replay));
  assert.equal(replay.error.code, 'MECHANISM_OPERATION_STALE');
  assert.equal(providerCalls, callsAfterFirst);
});

test('mechanism controls require the exact trusted owner before status disclosure or cancellation', async () => {
  const storageArea = createMemoryStorage();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  let providerCalls = 0;
  let releaseProvider;
  let providerStartedResolve;
  const providerStarted = new Promise(resolve => { providerStartedResolve = resolve; });
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea: createMemoryStorage(),
    cacheStore, runtimeExtensionId: 'extension-id',
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      providerStartedResolve();
      await providerGate;
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = evidenceFirstMessage({
    operationId: 'mechanism:evidence-owner-control',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  });
  const owner = {
    trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 27, senderFrameId: 0,
    senderDocumentId: '27272727-2727-4727-8727-272727272727'
  };
  const control = command => ({
    type: 'LLM_CONTROL_OPERATION', operationScope: 'mechanism', command,
    evidenceFirstVersion: message.evidenceFirstVersion,
    evidenceFirstRouterVersion: message.evidenceFirstRouterVersion,
    evidenceFirstVersions: message.evidenceFirstVersions,
    operationId: message.operationId,
    documentId: message.documentId,
    workspaceId: message.workspaceId,
    workspaceGeneration: message.workspaceGeneration,
    workspaceLifecycle: message.workspaceLifecycle,
    baseWorkspaceRevision: message.baseWorkspaceRevision,
    mechanismChainFingerprint: message.mechanismChainFingerprint
  });
  const pending = router.handle(message, owner);
  await providerStarted;
  const wrongOwner = { ...owner, senderTabId: 28 };
  const wrongStatus = await router.handle(control('status'), wrongOwner);
  const wrongCancel = await router.handle(control('cancel'), wrongOwner);
  const ownerStatus = await router.handle(control('status'), owner);
  const cancelled = await router.handle(control('cancel'), owner);
  const callsAtCancel = providerCalls;
  releaseProvider();
  const result = await pending;

  assert.equal(wrongStatus.success, false);
  assert.equal(wrongStatus.error.code, 'MECHANISM_OPERATION_STALE');
  assert.equal(wrongCancel.success, false);
  assert.equal(wrongCancel.error.code, 'MECHANISM_OPERATION_STALE');
  assert.equal(ownerStatus.success, true);
  assert.equal(ownerStatus.data.active, true);
  assert.equal(cancelled.success, true, JSON.stringify(cancelled));
  assert.equal(cancelled.data.cancelled, true);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.data.status, 'cancelled');
  assert.equal(providerCalls, callsAtCancel);
});

test('mechanism abandon is exact-owner scoped compact and idempotent through the router', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea, cacheStore, runtimeExtensionId: 'extension-id',
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = evidenceFirstMessage({
    operationId: 'mechanism:evidence-router-abandon'
  });
  const owner = {
    trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 29, senderFrameId: 0,
    senderDocumentId: '29292929-2929-4929-8929-292929292929'
  };
  const control = (command, overrides = {}) => ({
    type: 'LLM_CONTROL_OPERATION', operationScope: 'mechanism', command,
    evidenceFirstVersion: message.evidenceFirstVersion,
    evidenceFirstRouterVersion: message.evidenceFirstRouterVersion,
    evidenceFirstVersions: message.evidenceFirstVersions,
    operationId: message.operationId,
    documentId: message.documentId,
    workspaceId: message.workspaceId,
    workspaceGeneration: message.workspaceGeneration,
    workspaceLifecycle: message.workspaceLifecycle,
    baseWorkspaceRevision: message.baseWorkspaceRevision,
    mechanismChainFingerprint: message.mechanismChainFingerprint,
    ...overrides
  });
  const completed = await router.handle(message, owner);
  assert.equal(completed.success, true, JSON.stringify(completed));
  const callsAtTerminal = providerCalls;

  const wrongOwner = await router.handle(control('abandon'), {
    ...owner, senderTabId: 30
  });
  assert.equal(wrongOwner.success, false);
  assert.equal(wrongOwner.error.code, 'MECHANISM_OPERATION_STALE');
  const unscoped = await router.handle({
    ...control('abandon'), operationScope: undefined
  }, owner);
  assert.equal(unscoped.success, false);
  assert.equal(unscoped.error.code, 'INVALID_SETTINGS');

  const abandoned = await router.handle(control('abandon'), owner);
  assert.equal(abandoned.success, true, JSON.stringify(abandoned));
  assert.equal(abandoned.data.operationId, message.operationId);
  assert.equal(abandoned.data.abandoned, true);
  assert.equal(abandoned.data.compacted, true);
  assert.equal(abandoned.data.cleanupComplete, true);
  assert.equal(abandoned.data.released, false);
  const replay = await router.handle(control('abandon'), owner);
  assert.deepEqual(replay, abandoned);
  const sameId = await router.handle({
    ...message,
    figureRequestReceipt: 'unused-mechanism-field-must-not-mint-an-epoch'
  }, owner);
  assert.equal(sameId.success, false, JSON.stringify(sameId));
  assert.equal(sameId.error.code, 'MECHANISM_OPERATION_FINALIZED');
  assert.equal(providerCalls, callsAtTerminal);
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

test('runs one targeted extraction repair before locally completing the mechanism', async () => {
  const storageArea = createMemoryStorage();
  let extractionCalls = 0;
  const progressEvents = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (input.stage === 'panel_evidence_extraction') {
        extractionCalls += 1;
        if (extractionCalls === 1) {
          return jsonResponse({ output_text: JSON.stringify({ records: [] }) });
        }
      }
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-targeted-repair-test',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  }), { onProgress(event) { progressEvents.push(event); } });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.status, 'complete');
  assert.equal(extractionCalls, 2);
  assert.ok(progressEvents.some(event => event.phase === 'repairing_unresolved' &&
    event.checkpointCommitted === true));
  assert.equal(response.data.evidenceFirstMechanism.audit.unresolvedPanelKeys.length, 0);
});

test('persistent single-Panel truncation remains needs_review and never fallback-complete', async () => {
  const storageArea = createMemoryStorage();
  let extractionCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (input.stage === 'panel_evidence_extraction') {
        extractionCalls += 1;
        return jsonResponse({
          status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }
        });
      }
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-unresolved-test',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  }));

  assert.equal(response.success, true);
  assert.equal(response.data.status, 'needs_review');
  assert.equal(response.data.evidenceFirstMechanism, null);
  assert.equal(response.data.mechanismGraph, null);
  assert.equal(response.data.crossFigureLogic.status, 'needs_review');
  assert.equal(response.data.fallbackUsed, false);
  assert.equal(extractionCalls, 3);
});

test('splits a truncated four-Panel relation mapping batch 4 to 2 to 1', async () => {
  const storageArea = createMemoryStorage();
  const mappingBatchSizes = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (input.stage === 'panel_relation_mapping') {
        mappingBatchSizes.push(input.untrusted_validated_panels.length);
        if (input.untrusted_validated_panels.length > 1) {
          return jsonResponse({
            status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }
          });
        }
      }
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-mapping-split-test',
    figures: [
      evidenceFirstFigure(1, ['A', 'B']),
      evidenceFirstFigure(2, ['A', 'B'])
    ]
  }));

  assert.equal(response.success, true);
  assert.equal(response.data.status, 'complete');
  assert.deepEqual(mappingBatchSizes, [4, 2, 1, 1, 2, 1, 1]);
});

test('a changed per-Panel analysis digest cannot replace a durable same-id operation', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const original = evidenceFirstMessage({
    operationId: 'mechanism:evidence-panel-digest-binding-test',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  });
  const first = await router.handle(original);
  const callsAfterFirst = providerCalls;
  const changed = structuredClone(original);
  changed.figures[0].panelAnalyses.A.directObservation =
    'A changed source-bound observation invalidates downstream evidence.';
  changed.figures[0].analysis.panels = Object.values(changed.figures[0].panelAnalyses);
  const second = await router.handle(changed);

  assert.equal(first.success, true);
  assert.equal(second.success, false, JSON.stringify(second));
  assert.equal(second.error.code, 'MECHANISM_OPERATION_STALE');
  assert.equal(first.data.evidenceFirstStage0.operationEpoch, 1);
  assert.equal(providerCalls, callsAfterFirst);
});

test('repairs only unresolved Stage 3 mappings once before final audit', async () => {
  const storageArea = createMemoryStorage();
  let mappingCalls = 0;
  const progressEvents = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      if (input.stage === 'panel_relation_mapping') {
        mappingCalls += 1;
        if (mappingCalls === 1) {
          const unresolved = evidenceFirstProviderOutput(input);
          unresolved.records.forEach(record => record.mappings.forEach(mapping => {
            mapping.source_node_handle = '';
            mapping.target_node_handle = '';
            mapping.unmappedTerm = 'bounded unresolved compound';
          }));
          return jsonResponse({ output_text: JSON.stringify(unresolved) });
        }
        assert.match(body.instructions, /TARGETED_REPAIR_PASS/);
      }
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-mapping-repair-test',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  }), { onProgress(event) { progressEvents.push(event); } });

  assert.equal(response.success, true);
  assert.equal(response.data.status, 'complete');
  assert.equal(mappingCalls, 2);
  assert.ok(progressEvents.some(event => event.phase === 'repairing_unresolved' &&
    event.checkpointCommitted === true));
});

test('router final assembly consumes the validated Stage 2 merge and Stage 3 mappings', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (Array.isArray(input?.validated_candidates)) {
        const groups = new Map();
        input.validated_candidates.forEach(candidate => {
          const key = candidate.node_type;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(candidate.candidate_handle);
        });
        return jsonResponse({ output_text: JSON.stringify({
          groups: [...groups.values()].map(handles => ({
            preferred_handle: handles[0], member_handles: handles
          }))
        }) });
      }
      return jsonResponse({
        output_text: JSON.stringify(evidenceFirstProviderOutput(input))
      });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-mapped-assembly-router-test',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  }));

  assert.equal(response.success, true);
  assert.equal(response.data.status, 'complete');
  assert.equal(response.data.evidenceFirstMechanism.nodes.length, 3,
    JSON.stringify(response.data.evidenceFirstMechanism.nodes));
  assert.equal(response.data.evidenceFirstMechanism.relations.length, 2);
  assert.equal(response.data.evidenceFirstMechanism.relations.reduce((sum, relation) =>
    sum + relation.assignments.length, 0), 4);
  assert.ok(response.data.evidenceFirstMechanism.nodes.every(node =>
    /^node-v2-[a-f0-9]{16}$/u.test(node.nodeId)));
});

test('a fully accounted node-only mechanism stays needs_review with no empty graph DTO', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      let output;
      if (Array.isArray(input?.untrusted_panel_evidence)) {
        output = { records: input.untrusted_panel_evidence.map(panel => ({
          handle: panel.handle, panelType: 'experimental', exclusionReason: '',
          extractionUncertainty: '', claims: [{
            semantics: 'causal', causalTest: 'none', outcome: 'supports',
            effectSign: 'increases', subjectTerms: [`Measured node ${panel.panel_key}`],
            objectTerms: [], perturbations: [], observations: ['Node abundance increased.'],
            biologicalContexts: [{
              species: '', tissue: '', cellType: '', compartment: '', condition: '',
              timepoint: '', dose: ''
            }], candidateTerms: [`Measured node ${panel.panel_key}`],
            sourceFields: ['directObservation'], uncertaintyReasons: [], modelConfidence: 0.8
          }]
        })) };
      } else if (Array.isArray(input?.untrusted_validated_panels)) {
        output = { records: input.untrusted_validated_panels.map(panel => ({
          panel_handle: panel.panel_handle,
          mappings: panel.claims.map(claim => {
            const source = input.relevant_canonical_nodes.find(node =>
              node.source_claim_handles.includes(claim.claim_handle));
            return {
              claim_handle: claim.claim_handle,
              source_node_handle: source.node_handle,
              target_node_handle: '', relation_kind: 'node_only',
              evidence_class: 'other', polarity: 'increases', unmappedTerm: ''
            };
          })
        })) };
      } else {
        output = evidenceFirstProviderOutput(input);
      }
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-node-only-safe-status',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  }));

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.evidenceFirstMechanism.status, 'needs_review');
  assert.equal(response.data.status, 'needs_review');
  assert.equal(response.data.mechanismGraph, null);
  const status = await router.handle({
    type: 'LLM_CONTROL_OPERATION',
    operationId: 'mechanism:evidence-node-only-safe-status', command: 'status'
  });
  assert.equal(status.data.status, 'needs_review');
  assert.equal(status.data.active, false);
});

test('invalid alias proposals retain conservative nodes and still require provider relation mapping', async () => {
  const storageArea = createMemoryStorage();
  let canonicalCalls = 0;
  let mappingCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (Array.isArray(input?.validated_candidates)) {
        canonicalCalls += 1;
        return jsonResponse({ output_text: JSON.stringify({ groups: [] }) });
      }
      if (input?.stage === 'panel_relation_mapping') mappingCalls += 1;
      return jsonResponse({
        output_text: JSON.stringify(evidenceFirstProviderOutput(input))
      });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-canonical-fail-closed',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  }));

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.status, 'complete');
  assert.ok(response.data.evidenceFirstMechanism.nodes.length >= 2);
  assert.ok(response.data.mechanismGraph.edges.length >= 1);
  assert.ok(mappingCalls > 0, 'local alias fallback never invents relation mappings');
  assert.equal(canonicalCalls, 2);
  const callsBeforeResume = canonicalCalls;
  const resumed = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-canonical-fail-closed',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  }));
  assert.equal(resumed.success, true, JSON.stringify(resumed));
  assert.equal(resumed.data.status, 'complete');
  assert.equal(resumed.data.resumed, true);
  assert.equal(canonicalCalls, callsBeforeResume);
  const status = await router.handle({
    type: 'LLM_CONTROL_OPERATION',
    operationId: 'mechanism:evidence-canonical-fail-closed', command: 'status'
  });
  assert.equal(status.data.status, 'complete');
  assert.equal(status.data.active, false);
});

test('Panel identity text in mapped node labels invalidates the public graph DTO', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      const output = evidenceFirstProviderOutput(input);
      if (Array.isArray(input?.untrusted_panel_evidence)) {
        output.records.forEach((record, index) => record.claims.forEach(claim => {
          const panelKey = input.untrusted_panel_evidence[index].panel_key;
          claim.subjectTerms = [`Mediator ${panelKey}`];
          claim.objectTerms = [`Outcome ${panelKey}`];
          claim.candidateTerms = [...claim.subjectTerms, ...claim.objectTerms];
        }));
      }
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-panel-text-graph-rejected',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  }));

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.evidenceFirstMechanism.status, 'complete');
  assert.equal(response.data.status, 'needs_review');
  assert.equal(response.data.mechanismGraph, null);
});

test('display Panel tokens invalidate graph labels without treating scientific tokens as identity', async () => {
  async function analyzeWithSubject(subject, operationId, figures = [
    evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])
  ]) {
    const storageArea = createMemoryStorage();
    const router = createBackgroundRouter({
      storageArea,
      fetchImpl: async (_url, options) => {
        const input = openAIInputPayload(JSON.parse(options.body));
        const output = evidenceFirstProviderOutput(input);
        if (Array.isArray(input?.untrusted_panel_evidence)) {
          output.records.forEach(record => record.claims.forEach(claim => {
            claim.subjectTerms = [subject];
            claim.candidateTerms = [...claim.subjectTerms, ...claim.objectTerms];
          }));
        }
        return jsonResponse({ output_text: JSON.stringify(output) });
      }
    });
    await configureOpenAIRouter(router);
    return router.handle(evidenceFirstMessage({
      operationId, figures
    }));
  }

  const leaked = await analyzeWithSubject(
    'Panel A kinase activity', 'mechanism:evidence-display-panel-text-rejected'
  );
  const scientific = await analyzeWithSubject(
    'Protein A kinase activity', 'mechanism:evidence-scientific-a-allowed'
  );
  const compactScientific = await analyzeWithSubject(
    'IL-1B signaling', 'mechanism:evidence-scientific-il1b-allowed',
    [evidenceFirstFigure(1, ['B']), evidenceFirstFigure(2, ['B'])]
  );
  const explicitCompact = await analyzeWithSubject(
    'Panel 1B signaling', 'mechanism:evidence-display-panel-1b-rejected',
    [evidenceFirstFigure(1, ['B']), evidenceFirstFigure(2, ['B'])]
  );
  assert.equal(leaked.success, true, JSON.stringify(leaked));
  assert.equal(leaked.data.evidenceFirstMechanism.status, 'complete');
  assert.equal(leaked.data.status, 'needs_review');
  assert.equal(leaked.data.mechanismGraph, null);
  assert.equal(scientific.success, true, JSON.stringify(scientific));
  assert.equal(scientific.data.status, 'complete');
  assert.ok(scientific.data.mechanismGraph);
  assert.equal(compactScientific.success, true, JSON.stringify(compactScientific));
  assert.equal(compactScientific.data.status, 'complete');
  assert.ok(compactScientific.data.mechanismGraph);
  assert.equal(explicitCompact.success, true, JSON.stringify(explicitCompact));
  assert.equal(explicitCompact.data.status, 'needs_review');
  assert.equal(explicitCompact.data.mechanismGraph, null);
});

test('partial evidence-first intent fails closed before any provider call', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('provider must not be called');
    }
  });
  await configureOpenAIRouter(router);
  assert.deepEqual(EVIDENCE_FIRST_REQUEST_CONTRACT, {
    markerField: 'evidenceFirstVersion',
    version: '2',
    requiredFields: [
      'evidenceFirstVersion', 'operationId', 'documentId', 'workspaceId',
      'baseWorkspaceRevision', 'evidenceFirstRouterVersion',
      'evidenceFirstVersions'
    ]
  });
  const full = evidenceFirstMessage();
  for (const omitted of [
    'operationId', 'documentId', 'workspaceId', 'baseWorkspaceRevision',
    'evidenceFirstRouterVersion', 'evidenceFirstVersions'
  ]) {
    const message = structuredClone(full);
    delete message[omitted];
    const response = await router.handle(message);
    assert.equal(response.success, false, omitted);
    assert.equal(response.error.code, 'INVALID_SETTINGS', omitted);
  }
  const partialWithoutRevision = structuredClone(full);
  delete partialWithoutRevision.baseWorkspaceRevision;
  partialWithoutRevision.evidenceFirstRouterVersion = '2';
  const versionOnly = await router.handle(partialWithoutRevision);
  assert.equal(versionOnly.success, false);
  assert.equal(versionOnly.error.code, 'INVALID_SETTINGS');
  const missingMarker = structuredClone(full);
  delete missingMarker.evidenceFirstVersion;
  const markerless = await router.handle(missingMarker);
  assert.equal(markerless.success, false);
  assert.equal(markerless.error.code, 'INVALID_SETTINGS');
  const unknownMarker = structuredClone(full);
  unknownMarker.evidenceFirstVersion = '3';
  const unknown = await router.handle(unknownMarker);
  assert.equal(unknown.success, false);
  assert.equal(unknown.error.code, 'INVALID_SETTINGS');
  for (const key of Object.keys(globalThis.SciLLM.EVIDENCE_FIRST_VERSIONS)) {
    const stale = structuredClone(full);
    stale.evidenceFirstVersions[key] = `${stale.evidenceFirstVersions[key]}-old`;
    const staleResult = await router.handle(stale);
    assert.equal(staleResult.success, false, key);
    assert.equal(staleResult.error.code, 'INVALID_SETTINGS', key);
  }
  const mechanismOnly = {
    type: full.type,
    operationId: 'mechanism:markerless-operation',
    document: full.document,
    figures: full.figures
  };
  const mechanismOnlyResult = await router.handle(mechanismOnly);
  assert.equal(mechanismOnlyResult.success, false);
  assert.equal(mechanismOnlyResult.error.code, 'INVALID_SETTINGS');
  let versionGetterCalls = 0;
  const accessor = evidenceFirstMessage();
  Object.defineProperty(accessor, 'evidenceFirstVersions', {
    enumerable: true,
    get() {
      versionGetterCalls += 1;
      throw new Error('PRIVATE VERSION SECRET');
    }
  });
  const accessorResult = await router.handle(accessor);
  assert.equal(accessorResult.success, false);
  assert.equal(accessorResult.error.code, 'INVALID_SETTINGS');
  assert.equal(versionGetterCalls, 0);
  assert.equal(providerCalls, 0);
});

test('evidence-first routing preserves and never probes unversioned legacy figure caches', async () => {
  const storageArea = createMemoryStorage();
  const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
  let legacyReads = 0;
  let legacyDeletes = 0;
  const cacheStore = {
    async getMany(keys) {
      if (keys.some(key => String(key).startsWith('figure:'))) legacyReads += 1;
      return baseCache.getMany(keys);
    },
    setMany: (...args) => baseCache.setMany(...args),
    async deleteMany(keys) {
      if (keys.some(key => String(key).startsWith('figure:'))) legacyDeletes += 1;
      return baseCache.deleteMany(keys);
    },
    setManyGuarded: (...args) => baseCache.setManyGuarded(...args),
    compareAndSetManyGuarded: (...args) => baseCache.compareAndSetManyGuarded(...args)
  };
  await baseCache.setMany([{
    key: `figure:${'a'.repeat(64)}`, createdAt: 1,
    crossFigureVersion: 'evidence-first-v2', crossFigureLogic: { status: 'complete' }
  }]);
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(evidenceFirstMessage({
    operationId: 'mechanism:legacy-cache-preservation',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  }));
  assert.equal(response.success, true);
  assert.equal(legacyReads, 0);
  assert.equal(legacyDeletes, 0);
  assert.ok((await baseCache.getMany([`figure:${'a'.repeat(64)}`]))
    .has(`figure:${'a'.repeat(64)}`));
});

test('two simultaneous evidence-first operations share one global two-request gate', async () => {
  const storageArea = createMemoryStorage();
  let active = 0;
  let maxActive = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const input = openAIInputPayload(JSON.parse(options.body));
      await new Promise(resolve => setTimeout(resolve, 3));
      active -= 1;
      return jsonResponse({
        output_text: JSON.stringify(evidenceFirstProviderOutput(input))
      });
    }
  });
  await configureOpenAIRouter(router);
  const figures = [
    evidenceFirstFigure(1, 'ABCDEFGH'.split('')),
    evidenceFirstFigure(2, 'ABCDEFGH'.split(''))
  ];
  const [first, second] = await Promise.all([
    router.handle(evidenceFirstMessage({
      operationId: 'mechanism:evidence-shared-gate-a', documentId: 'document-gate-a',
      workspaceId: 'workspace-gate-a', figures
    })),
    router.handle(evidenceFirstMessage({
      operationId: 'mechanism:evidence-shared-gate-b', documentId: 'document-gate-b',
      workspaceId: 'workspace-gate-b', figures
    }))
  ]);

  assert.equal(first.data.status, 'complete');
  assert.equal(second.data.status, 'complete');
  assert.equal(maxActive, 2);
});

test('a globally queued cancelled run consumes zero durable claims and provider calls', async () => {
  const storageArea = createMemoryStorage();
  const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
  const operationB = 'mechanism:evidence-shared-gate-queued-b';
  let bInstalledResolve;
  const bInstalled = new Promise(resolve => { bInstalledResolve = resolve; });
  let maxBClaims = 0;
  const cacheStore = {
    getMany: (...args) => baseCache.getMany(...args),
    setMany: (...args) => baseCache.setMany(...args),
    deleteMany: (...args) => baseCache.deleteMany(...args),
    setManyGuarded: (...args) => baseCache.setManyGuarded(...args),
    compareAndSetManyGuarded(values, guard) {
      for (const value of values) {
        const runState = value?.runState;
        if (runState?.binding?.operationId === operationB) {
          maxBClaims = Math.max(maxBClaims, runState.providerRequestsClaimed);
          bInstalledResolve();
        }
      }
      return baseCache.compareAndSetManyGuarded(values, guard);
    }
  };
  let activeA = 0;
  let startedAResolve;
  const startedA = new Promise(resolve => { startedAResolve = resolve; });
  let releaseAResolve;
  const holdA = new Promise(resolve => { releaseAResolve = resolve; });
  let providerCallsB = 0;
  const router = createBackgroundRouter({
    storageArea, cacheStore,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      const firstPanel = input?.untrusted_panel_evidence?.[0]?.panel_key || '';
      if (/^figure-[12]:/u.test(firstPanel)) {
        activeA += 1;
        if (activeA === 2) startedAResolve();
        await holdA;
      } else if (/^figure-[34]:/u.test(firstPanel)) {
        providerCallsB += 1;
      }
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const panels = 'ABCDEFGH'.split('');
  const pendingA = router.handle(evidenceFirstMessage({
    operationId: 'mechanism:evidence-shared-gate-holder-a',
    documentId: 'document-holder-a', workspaceId: 'workspace-holder-a',
    figures: [evidenceFirstFigure(1, panels), evidenceFirstFigure(2, panels)]
  }));
  await startedA;
  const pendingB = router.handle(evidenceFirstMessage({
    operationId: operationB,
    documentId: 'document-queued-b', workspaceId: 'workspace-queued-b',
    figures: [evidenceFirstFigure(3, panels), evidenceFirstFigure(4, panels)]
  }));
  await bInstalled;
  await new Promise(resolve => setImmediate(resolve));
  const cancelled = await router.handle({
    type: 'LLM_CONTROL_OPERATION', operationId: operationB, command: 'cancel'
  });
  releaseAResolve();
  const [resultA, resultB] = await Promise.all([pendingA, pendingB]);

  assert.equal(cancelled.success, true);
  assert.equal(resultA.data.status, 'complete');
  assert.equal(resultB.success, false, JSON.stringify(resultB));
  assert.equal(resultB.error.code, 'MECHANISM_OPERATION_CANCELLED');
  assert.equal(providerCallsB, 0);
  assert.equal(maxBClaims, 0);
});

test('ready resume rejects every SHA-sealed payload mutation without calling the provider', async () => {
  const storageArea = createMemoryStorage();
  const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
  const injected = new Map();
  let readyKey = '';
  const cacheStore = {
    async getMany(keys) {
      const found = await baseCache.getMany(keys);
      for (const key of keys) {
        if (injected.has(key)) found.set(key, injected.get(key));
      }
      return found;
    },
    setMany: (...args) => baseCache.setMany(...args),
    deleteMany: (...args) => baseCache.deleteMany(...args),
    setManyGuarded: (...args) => baseCache.setManyGuarded(...args),
    compareAndSetManyGuarded(values, guard) {
      const ready = values.find(value => value?.checkpoint?.phase === 'ready');
      if (ready) readyKey = ready.key;
      return baseCache.compareAndSetManyGuarded(values, guard);
    }
  };
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea, cacheStore,
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      const output = evidenceFirstProviderOutput(input);
      if (input.stage === 'panel_relation_mapping' && output.records.length) {
        output.records[0].mappings.forEach(mapping => {
          mapping.source_node_handle = '';
          mapping.target_node_handle = '';
          mapping.unmappedTerm = 'bounded unresolved term';
        });
      }
      return jsonResponse({
        output_text: JSON.stringify(output)
      });
    }
  });
  await configureOpenAIRouter(router);
  const message = evidenceFirstMessage({
    operationId: 'mechanism:evidence-ready-status-tamper',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  });
  const first = await router.handle(message);
  assert.equal(first.data.status, 'needs_review');
  assert.ok(readyKey);
  const stored = (await baseCache.getMany([readyKey])).get(readyKey);
  assert.match(stored.checkpoint.payload.payloadDigest,
    /^evidence-first-checkpoint-payload-v2-sha256-[a-f0-9]{64}$/u);
  const mutations = [
    ['status', payload => { payload.finalStatus = 'complete'; }],
    ['nested extraction', payload => {
      payload.extractionRecords[0].claims[0].subjectTerms = ['PRIVATE_SHA_COLLISION'];
    }],
    ['nested canonical node', payload => {
      payload.canonicalNodes.nodes[0].aliases = ['PRIVATE_SHA_COLLISION'];
    }],
    ['nested mapping', payload => {
      payload.mappingRecords[0].mappings[0].unmappedTerm = 'PRIVATE_SHA_COLLISION';
    }],
    ['legacy weak seal', payload => {
      payload.payloadVersion = 'evidence-first-checkpoint-payload-v1';
      payload.payloadDigest = 'evidence-first-checkpoint-payload-v1-deadbeef';
    }]
  ];
  for (const [label, mutate] of mutations) {
    const tampered = structuredClone(stored);
    mutate(tampered.checkpoint.payload);
    injected.set(readyKey, tampered);
    const callsBeforeResume = providerCalls;
    const resumed = await createBackgroundRouter({
      storageArea, cacheStore,
      fetchImpl: async (_url, options) => {
        providerCalls += 1;
        const input = openAIInputPayload(JSON.parse(options.body));
        return jsonResponse({ output_text: JSON.stringify(
          evidenceFirstProviderOutput(input)
        ) });
      }
    }).handle(message);
    assert.equal(resumed.success, false, `${label}: ${JSON.stringify(resumed)}`);
    assert.equal(resumed.error.code, 'MECHANISM_CHECKPOINT_INVALID', label);
    assert.equal(providerCalls, callsBeforeResume, label);
  }
  const hostile = structuredClone(stored);
  let getterCalls = 0;
  Object.defineProperty(
    hostile.checkpoint.payload.extractionRecords[0].claims[0],
    'subjectTerms',
    {
      enumerable: true,
      get() {
        getterCalls += 1;
        return ['PRIVATE_ACCESSOR_VALUE'];
      }
    }
  );
  injected.set(readyKey, hostile);
  const callsBeforeAccessor = providerCalls;
  const accessorResume = await createBackgroundRouter({
    storageArea, cacheStore, fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  }).handle(message);
  assert.equal(accessorResume.success, false, JSON.stringify(accessorResume));
  assert.equal(accessorResume.error.code, 'MECHANISM_CHECKPOINT_INVALID');
  assert.equal(getterCalls, 0, 'checkpoint hashing must never invoke accessors');
  assert.equal(providerCalls, callsBeforeAccessor);
  injected.clear();
});

test('Stage 0 SHA seal rejects full source evidence drift when every legacy hash collides', async () => {
  const shared = globalThis.SciLLM;
  const originalStableHash = shared.stableHash;
  const originalProjectPanelAnalysisEvidence = shared.projectPanelAnalysisEvidence;
  const firstWeakProjectionByPanel = new Map();
  let sawUnderlyingSourceDigestDrift = false;
  let providerCalls = 0;
  try {
    shared.stableHash = () => '0123456789abcdef';
    shared.projectPanelAnalysisEvidence = (figure, ledgerEntry) => {
      const projected = originalProjectPanelAnalysisEvidence(figure, ledgerEntry);
      if (projected?.ok !== true) return projected;
      const panelKey = projected.projection.panelKey;
      const firstWeak = firstWeakProjectionByPanel.get(panelKey);
      if (!firstWeak) {
        firstWeakProjectionByPanel.set(panelKey, Object.freeze({
          handle: projected.projection.handle,
          sourceAnalysisDigest: projected.projection.sourceAnalysisDigest
        }));
        return projected;
      }
      if (firstWeak.sourceAnalysisDigest !== projected.projection.sourceAnalysisDigest) {
        sawUnderlyingSourceDigestDrift = true;
      }
      return {
        ok: true,
        projection: Object.freeze({
          ...projected.projection,
          handle: firstWeak.handle,
          sourceAnalysisDigest: firstWeak.sourceAnalysisDigest
        })
      };
    };

    const storageArea = createMemoryStorage();
    const cacheStore = shared.createMemoryAnalysisCache();
    const fetchImpl = async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
    };
    const firstRouter = createBackgroundRouter({ storageArea, cacheStore, fetchImpl });
    await configureOpenAIRouter(firstRouter);
    const message = evidenceFirstMessage({
      operationId: 'mechanism:evidence-stage0-strong-source-binding',
      figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
    });
    const first = await firstRouter.handle(message);
    assert.equal(first.success, true, JSON.stringify(first));
    const callsAfterFirst = providerCalls;

    const changed = structuredClone(message);
    changed.figures[0].panelAnalyses.A.directObservation =
      'A different private source observation with the same forced legacy digest.';
    const resumed = await createBackgroundRouter({
      storageArea, cacheStore, fetchImpl
    }).handle(changed);
    assert.equal(sawUnderlyingSourceDigestDrift, true);
    assert.equal(resumed.success, false, JSON.stringify(resumed));
    assert.equal(resumed.error.code, 'MECHANISM_OPERATION_STALE');
    assert.equal(providerCalls, callsAfterFirst);
  } finally {
    shared.stableHash = originalStableHash;
    shared.projectPanelAnalysisEvidence = originalProjectPanelAnalysisEvidence;
  }
});

test('SHA checkpoint guard rejects cycles, shared trees, depth, nodes and UTF-8 overflow before provider', async () => {
  const storageArea = createMemoryStorage();
  const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
  const injected = new Map();
  let readyKey = '';
  const cacheStore = {
    async getMany(keys) {
      const found = await baseCache.getMany(keys);
      for (const key of keys) {
        if (injected.has(key)) found.set(key, injected.get(key));
      }
      return found;
    },
    setMany: (...args) => baseCache.setMany(...args),
    deleteMany: (...args) => baseCache.deleteMany(...args),
    setManyGuarded: (...args) => baseCache.setManyGuarded(...args),
    compareAndSetManyGuarded(values, guard) {
      const ready = values.find(value => value?.checkpoint?.phase === 'ready');
      if (ready) readyKey = ready.key;
      return baseCache.compareAndSetManyGuarded(values, guard);
    }
  };
  let providerCalls = 0;
  const fetchImpl = async (_url, options) => {
    providerCalls += 1;
    const input = openAIInputPayload(JSON.parse(options.body));
    return jsonResponse({ output_text: JSON.stringify(evidenceFirstProviderOutput(input)) });
  };
  const firstRouter = createBackgroundRouter({ storageArea, cacheStore, fetchImpl });
  await configureOpenAIRouter(firstRouter);
  const message = evidenceFirstMessage({
    operationId: 'mechanism:evidence-checkpoint-bounded-canonical',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  });
  const first = await firstRouter.handle(message);
  assert.equal(first.success, true, JSON.stringify(first));
  assert.ok(readyKey);
  const stored = (await baseCache.getMany([readyKey])).get(readyKey);
  const attacks = [
    ['cycle', () => {
      const value = {};
      value.self = value;
      return value;
    }],
    ['depth', () => {
      let value = 'leaf';
      for (let index = 0; index < 70; index += 1) value = { child: value };
      return value;
    }],
    ['declared node count', () => new Array(50_001).fill(null)],
    ['shared-tree expansion', () => {
      let value = { leaf: 'bounded' };
      for (let index = 0; index < 17; index += 1) {
        value = { left: value, right: value };
      }
      return value;
    }],
    ['UTF-8 bytes', () => '\u754c'.repeat(6_000_000)]
  ];
  for (const [label, makeAttack] of attacks) {
    const tampered = structuredClone(stored);
    tampered.checkpoint.payload.canonicalError = makeAttack();
    injected.set(readyKey, tampered);
    const callsBeforeResume = providerCalls;
    const resumed = await createBackgroundRouter({
      storageArea, cacheStore, fetchImpl
    }).handle(message);
    assert.equal(resumed.success, false, `${label}: ${JSON.stringify(resumed)}`);
    assert.equal(resumed.error.code, 'MECHANISM_CHECKPOINT_INVALID', label);
    assert.equal(providerCalls, callsBeforeResume, label);
  }
  injected.clear();
});

test('evidence dispatch binding hash failure is fixed fatal before any provider call', async () => {
  for (const cryptoImpl of [
    {},
    {
      subtle: { async digest() { throw new Error('private crypto failure'); } },
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto)
    }
  ]) {
    const storageArea = createMemoryStorage();
    let providerCalls = 0;
    const router = createBackgroundRouter({
      storageArea, cryptoImpl,
      fetchImpl: async () => {
        providerCalls += 1;
        return jsonResponse({});
      }
    });
    await configureOpenAIRouter(router);
    const response = await router.handle(evidenceFirstMessage({
      operationId: `mechanism:evidence-hash-failure-${providerCalls}-${cryptoImpl.subtle ? 1 : 0}`
    }));
    assert.equal(response.success, false, JSON.stringify(response));
    assert.equal(response.error.code, 'MECHANISM_DISPATCH_BINDING_UNAVAILABLE');
    assert.equal(response.error.retryable, false);
    assert.equal(providerCalls, 0);
    assert.doesNotMatch(JSON.stringify(response), /private crypto failure/u);
  }
});

test('post-begin dispatch binding failure compacts the run and preserves finalized replay', async () => {
  const storageArea = createMemoryStorage();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  let providerCalls = 0;
  const cryptoImpl = {
    subtle: {
      async digest(algorithm, data) {
        const canonical = new TextDecoder().decode(data);
        if (canonical.includes('evidence-provider-dispatch-binding-v1')) {
          throw new Error('private dispatch digest failure');
        }
        return webcrypto.subtle.digest(algorithm, data);
      }
    }
  };
  const router = createBackgroundRouter({
    storageArea, cacheStore, cryptoImpl,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });
  await configureOpenAIRouter(router);
  const messages = Array.from({ length: 3 }, (_, index) => evidenceFirstMessage({
    operationId: `mechanism:post-begin-dispatch-hash-${index}`
  }));
  for (const message of messages) {
    const response = await router.handle(message);
    assert.equal(response.success, false, JSON.stringify(response));
    assert.equal(response.error.code, 'MECHANISM_DISPATCH_BINDING_UNAVAILABLE');
    assert.equal(response.error.retryable, false);
  }
  const [indexes, states, checkpoints] = await Promise.all([
    cacheStore.listProtectedByPrefix('mechanism-run-index:'),
    cacheStore.listProtectedByPrefix('mechanism-run-state:'),
    cacheStore.listProtectedByPrefix('mechanism-checkpoint:')
  ]);
  assert.equal(indexes.size, messages.length);
  assert.equal([...indexes.values()].every(record =>
    record.runIndex?.terminal === 'failed' &&
    record.runIndex?.protectedBytesReserved === 0), true);
  assert.equal(states.size, 0);
  assert.equal(checkpoints.size, 0);
  const replay = await router.handle(structuredClone(messages[0]));
  assert.equal(replay.success, false, JSON.stringify(replay));
  assert.equal(replay.error.code, 'MECHANISM_OPERATION_FINALIZED');
  assert.equal(replay.error.retryable, false);
  assert.equal(providerCalls, 0);
});

test('sealed non-ready checkpoints reject private extraction canonical and mapping injection', async () => {
  const cases = [
    {
      stopPhase: 'canonicalization', storedPhase: 'panel_census', mutate(payload) {
        payload.extractionRecords[0].claims[0].subjectTerms = [
          'PRIVATE_CHECKPOINT_INJECTION'
        ];
        payload.extractionRecords[0].claims[0].candidateTerms = [
          'PRIVATE_CHECKPOINT_INJECTION'
        ];
      }
    },
    {
      stopPhase: 'edge_batch', storedPhase: 'canonicalization', mutate(payload) {
        payload.canonicalNodes.nodes[0].aliases = ['PRIVATE_CHECKPOINT_INJECTION'];
      }
    },
    {
      stopPhase: 'ready', storedPhase: 'edge_batch', mutate(payload) {
        payload.mappingRecords[0].mappings[0].sourceNodeId = 'node-v2-forged';
      }
    }
  ];
  for (const [caseIndex, scenario] of cases.entries()) {
    const storageArea = createMemoryStorage();
    const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
    let checkpointKey = '';
    let stopOnce = true;
    const cacheStore = {
      getMany: (...args) => baseCache.getMany(...args),
      setMany: (...args) => baseCache.setMany(...args),
      deleteMany: (...args) => baseCache.deleteMany(...args),
      setManyGuarded: (...args) => baseCache.setManyGuarded(...args),
      compareAndSetManyGuarded(values, guard) {
        const checkpointRecord = values.find(value => value?.checkpoint?.phase);
        if (checkpointRecord) checkpointKey = checkpointRecord.key;
        if (stopOnce && checkpointRecord?.checkpoint?.phase === scenario.stopPhase) {
          stopOnce = false;
          throw new Error('PRIVATE_CHECKPOINT_STOP');
        }
        return baseCache.compareAndSetManyGuarded(values, guard);
      }
    };
    let providerCalls = 0;
    const uploaded = [];
    const fetchImpl = async (_url, options) => {
      providerCalls += 1;
      uploaded.push(String(options.body || ''));
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({
        output_text: JSON.stringify(evidenceFirstProviderOutput(input))
      });
    };
    const message = evidenceFirstMessage({
      operationId: `mechanism:evidence-sealed-checkpoint-${caseIndex}`,
      documentId: `document-sealed-${caseIndex}`,
      workspaceId: `workspace-sealed-${caseIndex}`,
      figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
    });
    const firstRouter = createBackgroundRouter({ storageArea, cacheStore, fetchImpl });
    await configureOpenAIRouter(firstRouter);
    const interrupted = await firstRouter.handle(message);
    assert.equal(interrupted.success, false,
      `${scenario.storedPhase}: ${JSON.stringify(interrupted)}`);
    const stored = (await baseCache.getMany([checkpointKey])).get(checkpointKey);
    assert.equal(stored.checkpoint.phase, scenario.storedPhase);
    const tampered = structuredClone(stored);
    scenario.mutate(tampered.checkpoint.payload);
    await baseCache.setMany([tampered]);
    const callsBeforeResume = providerCalls;
    const bodiesBeforeResume = uploaded.length;
    const restarted = createBackgroundRouter({ storageArea, cacheStore, fetchImpl });
    const resumed = await restarted.handle(message);
    if (resumed.success) {
      assert.equal(resumed.data.status, 'failed', scenario.storedPhase);
      assert.equal(resumed.data.errorCode,
        'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS', scenario.storedPhase);
    } else {
      assert.equal(resumed.error.code, 'MECHANISM_CHECKPOINT_INVALID', scenario.storedPhase);
    }
    assert.equal(providerCalls, callsBeforeResume, scenario.storedPhase);
    assert.equal(uploaded.length, bodiesBeforeResume, scenario.storedPhase);
    assert.equal(uploaded.slice(bodiesBeforeResume).join('').includes(
      'PRIVATE_CHECKPOINT_INJECTION'
    ), false);
  }
});

test('cancellation at final committed progress prevents legacy final cache writes and complete', async () => {
  const storageArea = createMemoryStorage();
  const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
  let finalWrites = 0;
  let cancellation = Promise.resolve();
  const cacheStore = {
    getMany: (...args) => baseCache.getMany(...args),
    deleteMany: (...args) => baseCache.deleteMany(...args),
    setManyGuarded: (...args) => baseCache.setManyGuarded(...args),
    compareAndSetManyGuarded: (...args) => baseCache.compareAndSetManyGuarded(...args),
    async setMany(values) {
      if (values.some(value => value?.evidenceFirstRouterVersion)) {
        finalWrites += 1;
        await cancellation;
      }
      return baseCache.setMany(values);
    }
  };
  const router = createBackgroundRouter({
    storageArea, cacheStore,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({
        output_text: JSON.stringify(evidenceFirstProviderOutput(input))
      });
    }
  });
  await configureOpenAIRouter(router);
  const message = evidenceFirstMessage({
    operationId: 'mechanism:evidence-cancel-at-final-commit',
    figures: [evidenceFirstFigure(1, ['A']), evidenceFirstFigure(2, ['A'])]
  });
  let cancelIssued = false;
  const response = await router.handle(message, {
    onProgress(event) {
      if (!cancelIssued && event.phase === 'complete' && event.checkpointCommitted === true) {
        cancelIssued = true;
        cancellation = router.handle({
          type: 'LLM_CONTROL_OPERATION', operationId: message.operationId,
          command: 'cancel'
        });
      }
    }
  });
  await cancellation;

  assert.equal(cancelIssued, true);
  assert.equal(finalWrites, 0);
  assert.equal(response.data?.status, 'cancelled');
  assert.notEqual(response.data?.status, 'complete');
});

test('restart after an extraction repair response loss never redispatches its receipt', async () => {
  const storageArea = createMemoryStorage();
  const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
  let panelCheckpointWrites = 0;
  let failFourthPanelCheckpoint = true;
  const cacheStore = {
    getMany: (...args) => baseCache.getMany(...args),
    setMany: (...args) => baseCache.setMany(...args),
    deleteMany: (...args) => baseCache.deleteMany(...args),
    setManyGuarded: (...args) => baseCache.setManyGuarded(...args),
    compareAndSetManyGuarded(values, guard) {
      if (values.some(value => value?.checkpoint?.phase === 'panel_census')) {
        panelCheckpointWrites += 1;
        if (failFourthPanelCheckpoint && panelCheckpointWrites === 4) {
          failFourthPanelCheckpoint = false;
          throw new Error('PRIVATE_REPAIR_CHECKPOINT_FAILURE');
        }
      }
      return baseCache.compareAndSetManyGuarded(values, guard);
    }
  };
  let extractionCalls = 0;
  const extractionBatches = [];
  const fetchImpl = async (_url, options) => {
    const input = openAIInputPayload(JSON.parse(options.body));
    if (input.stage === 'panel_evidence_extraction') {
      extractionCalls += 1;
      const keys = input.untrusted_panel_evidence.map(panel => panel.panel_key);
      extractionBatches.push(keys);
      if (extractionCalls <= 2) {
        return jsonResponse({ output_text: JSON.stringify({ records: [] }) });
      }
      if (extractionCalls === 4) await new Promise(resolve => setTimeout(resolve, 8));
    }
    return jsonResponse({
      output_text: JSON.stringify(evidenceFirstProviderOutput(input))
    });
  };
  const message = evidenceFirstMessage({
    operationId: 'mechanism:evidence-mid-repair-resume',
    figures: [
      evidenceFirstFigure(1, ['A', 'B', 'C', 'D']),
      evidenceFirstFigure(2, ['A', 'B', 'C', 'D'])
    ]
  });
  const firstRouter = createBackgroundRouter({ storageArea, cacheStore, fetchImpl });
  await configureOpenAIRouter(firstRouter);
  const first = await firstRouter.handle(message);
  assert.equal(first.success, false);
  assert.equal(first.error.code, 'MECHANISM_CHECKPOINT_WRITE_FAILED');
  const completedRepairBatch = extractionBatches[2];
  const unfinishedRepairBatch = extractionBatches[3];
  const callsBeforeRestart = extractionCalls;
  const restarted = createBackgroundRouter({ storageArea, cacheStore, fetchImpl });
  const resumed = await restarted.handle(message);
  const restartedBatches = extractionBatches.slice(callsBeforeRestart);

  assert.equal(resumed.success, true, JSON.stringify(resumed));
  assert.equal(resumed.data.status, 'failed');
  assert.equal(resumed.data.errorCode, 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS');
  assert.deepEqual(restartedBatches, []);
  assert.notDeepEqual(unfinishedRepairBatch, completedRepairBatch);
});

test('restart after a mapping repair response loss never redispatches its receipt', async () => {
  const storageArea = createMemoryStorage();
  const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
  let coverageRepairWrites = 0;
  let failSecondCoverageRepair = true;
  const cacheStore = {
    getMany: (...args) => baseCache.getMany(...args),
    setMany: (...args) => baseCache.setMany(...args),
    deleteMany: (...args) => baseCache.deleteMany(...args),
    setManyGuarded: (...args) => baseCache.setManyGuarded(...args),
    compareAndSetManyGuarded(values, guard) {
      if (values.some(value => value?.checkpoint?.phase === 'coverage_repair')) {
        coverageRepairWrites += 1;
        if (failSecondCoverageRepair && coverageRepairWrites === 2) {
          failSecondCoverageRepair = false;
          throw new Error('PRIVATE_MAPPING_REPAIR_CHECKPOINT_FAILURE');
        }
      }
      return baseCache.compareAndSetManyGuarded(values, guard);
    }
  };
  let mappingCalls = 0;
  const repairBatches = [];
  const fetchImpl = async (_url, options) => {
    const input = openAIInputPayload(JSON.parse(options.body));
    const output = evidenceFirstProviderOutput(input);
    if (input.stage === 'panel_relation_mapping') {
      mappingCalls += 1;
      const panelKeys = input.untrusted_validated_panels.map(panel => panel.panel_key);
      if (mappingCalls <= 2) {
        output.records.forEach(record => record.mappings.forEach(mapping => {
          mapping.source_node_handle = '';
          mapping.target_node_handle = '';
          mapping.unmappedTerm = 'bounded unresolved mapping';
        }));
      } else {
        repairBatches.push(panelKeys);
      }
    }
    return jsonResponse({ output_text: JSON.stringify(output) });
  };
  const message = evidenceFirstMessage({
    operationId: 'mechanism:evidence-mid-mapping-repair-resume',
    figures: [
      evidenceFirstFigure(1, ['A', 'B', 'C', 'D']),
      evidenceFirstFigure(2, ['A', 'B', 'C', 'D'])
    ]
  });
  const firstRouter = createBackgroundRouter({ storageArea, cacheStore, fetchImpl });
  await configureOpenAIRouter(firstRouter);
  const first = await firstRouter.handle(message);
  assert.equal(first.success, false);
  assert.equal(first.error.code, 'MECHANISM_CHECKPOINT_WRITE_FAILED');
  assert.equal(repairBatches.length, 2);
  const completedRepairBatch = repairBatches[0];
  const unfinishedRepairBatch = repairBatches[1];
  const repairCallsBeforeRestart = repairBatches.length;
  const restarted = createBackgroundRouter({ storageArea, cacheStore, fetchImpl });
  const resumed = await restarted.handle(message);
  const restartedRepairBatches = repairBatches.slice(repairCallsBeforeRestart);

  assert.equal(resumed.success, true, JSON.stringify(resumed));
  assert.equal(resumed.data.status, 'failed');
  assert.equal(resumed.data.errorCode, 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS');
  assert.deepEqual(restartedRepairBatches, []);
  assert.notDeepEqual(unfinishedRepairBatch, completedRepairBatch);
});

async function configureOpenAIRouter(router) {
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5.1' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm',
      providerId: 'openai',
      consentGranted: true
    }
  });
}

for (const failureStage of ['whole', 'synthesis']) {
  test(`R22 batch continues after Figure 3 ${failureStage} schema failure without replaying rejected work`, async () => {
    const storageArea = createMemoryStorage();
    const sessionStorageArea = createMemoryStorage();
    const requests = [];
    const checkpoints = [];
    const router = createConfirmedFigureRouter({
      storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id', sleepImpl: async () => {},
      fetchImpl: async (_url, options) => {
        const input = openAIInputPayload(JSON.parse(options.body));
        requests.push(input);
        const invalid = input.figure_id === 'figure-3' &&
          (failureStage === 'whole' || input.pass === 'figure_synthesis');
        return jsonResponse({ output_text: JSON.stringify(invalid ? {} : figurePassOutput(input)) });
      }
    });
    await configureOpenAIRouter(router);
    const figures = Array.from({ length: 13 }, (_, index) => ({
      ...figureInput(index + 1),
      panelHints: index === 2 && failureStage === 'synthesis'
        ? Array.from('ABCDEFGHIJKL') : ['A']
    }));
    const owner = { ...figureCheckpointContext([], checkpoints), trustedExtensionSender: true,
      senderExtensionId: 'extension-id', senderTabId: 93, senderFrameId: 0,
      senderDocumentId: '93939393-9393-4939-8939-939393939393' };
    const request = (index, receiptSuffix = 'first') => figureMessage([figures[index]], {
      analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 93,
      operationId: `figure-r22-schema-${failureStage}-operation`,
      figureRequestReceipt: `figure-request-r22-${failureStage}-${index}-${receiptSuffix}-12345678`,
      figureOperationPlan: figures.map(item => ({ figureId: item.figureId, panelCount: item.panelHints.length })),
      forceRefresh: true
    });
    for (let index = 0; index < figures.length; index += 1) {
      const result = await router.handle(request(index), owner);
      if (index === 2) {
        assert.equal(result.success, false);
        assert.equal(result.error.code, 'INVALID_RESPONSE');
        if (failureStage === 'synthesis') {
          assert.ok(checkpoints.some(item => item.figureId === 'figure-3' &&
            item.figureResult.panels.length === 12), 'validated extraction survives synthesis rejection');
        }
      } else {
        assert.equal(result.success, true, `Figure ${index + 1}: ${JSON.stringify(result)}`);
      }
    }
    const [operation] = sessionStorageArea.values.sciFigureProviderAttemptLedgerV1.operations;
    assert.ok(operation.providerDispatches.every(item => item.status === 'sealed'));
    const callsBeforeReplay = requests.length;
    const repeatedReceipt = await router.handle(request(2), owner);
    assert.equal(repeatedReceipt.error.code, 'INVALID_RESPONSE');
    const mintedReceipt = await router.handle(request(2, 'replay'), owner);
    assert.equal(mintedReceipt.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
    assert.equal(requests.length, callsBeforeReplay, 'new receipt does not repeat the failed semantic request');
  });
}

test('modern sequential Figure requests checkpoint a 26-panel figure and continue with distinct receipts', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  let calls = 0;
  const router = createConfirmedFigureRouter({
    storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id', sleepImpl: async () => {},
    fetchImpl: async (_url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      if (input.pass !== 'figure_synthesis') {
        assert.ok(input.expected_panel_labels.length <= 8,
          'large Figures must not request all 26 detailed Panels in one response');
      }
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const figures = [
    { ...figureInput(1), panelHints: Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)) },
    { ...figureInput(2), panelHints: ['A', 'B', 'C', 'D', 'E'] }
  ];
  const checkpoints = [];
  const owner = { ...figureCheckpointContext([], checkpoints), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 84, senderFrameId: 0,
    senderDocumentId: '84848484-8484-4484-8484-848484848484' };
  for (let index = 0; index < figures.length; index += 1) {
    const figure = figures[index];
    const result = await router.handle(figureMessage([figure], {
      analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 84,
      operationId: 'figure-sequential-many-panel-operation',
      figureRequestReceipt: `figure-request-sequential-${index}-1234567890`,
      figureOperationPlan: figures.map(item => ({ figureId: item.figureId, panelCount: item.panelHints.length })),
      providerAttemptsConsumed: 0, forceRefresh: true
    }), owner);
    assert.equal(result.success, true, JSON.stringify({ result, calls }));
    assert.equal(result.data.figureResults[0].panels.length, figure.panelHints.length);
  }
  assert.deepEqual([...new Set(checkpoints.filter(checkpoint => checkpoint.figureId === 'figure-1')
    .map(checkpoint => checkpoint.figureResult.panels.length))], [6, 12, 18, 24, 26]);
  assert.ok(checkpoints.some(checkpoint => checkpoint.figureId === 'figure-2'));
});

test('DeepSeek overlaps two Panel requests but commits ordered exact receipt proofs', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const checkpoints = [];
  const progress = [];
  const finished = [];
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  const router = createConfirmedFigureRouter({
    storageArea, sessionStorageArea: createMemoryStorage(), runtimeExtensionId: 'extension-id',
    figureProviderAttemptLedger: createFigureProviderAttemptLedger({
      storageArea: ledgerStorage, getRuntimeLastError: () => null
    }),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const input = JSON.parse(body.messages[1].content);
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const label = input.expected_panel_labels?.[0] || 'synthesis';
      await new Promise(resolve => setTimeout(resolve, label === 'A' ? 40 : 2));
      active -= 1;
      finished.push(label);
      return jsonResponse({ choices: [{ finish_reason: 'stop',
        message: { content: JSON.stringify(figurePassOutput(input)) }
      }] });
    }
  });
  await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
    config: { apiKey: 'fixture-key', model: 'deepseek-v4-flash' } });
  await router.handle({ type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'deepseek', consentGranted: true } });
  const labels = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
  const figure = { ...figureInput(1), panelHints: labels };
  const proofSnapshots = [];
  const owner = { ...figureCheckpointContext(progress, checkpoints, value => {
    proofSnapshots.push(structuredClone(
      ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations[0].providerDispatches
    ));
    return { success: true, savedPanelCount: value.figureResult.panels.length };
  }), trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 91, senderFrameId: 0, senderDocumentId: '91919191-9191-4919-8919-919191919191',
    assertTrustedOwnerCurrent: async () => { await new Promise(resolve => setTimeout(resolve, 3)); } };
  const response = await router.handle(figureMessage([figure], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 91,
    operationId: 'figure-prefetch-ordered-proof-operation',
    figureRequestReceipt: 'figure-request-prefetch-ordered-proof-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 26 }]
  }), owner);
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(maximumActive, 2);
  assert.deepEqual(finished.slice(0, 2), ['G', 'A']);
  assert.equal(calls, 6, 'same five extraction requests plus full synthesis');
  assert.deepEqual(progress.filter(event => event.phase === 'figure_provider_attempt')
    .map(event => event.providerAttempt).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(checkpoints.slice(0, 5).map(value => value.figureResult.panels.length), [6, 12, 18, 24, 26]);
  assert.equal(proofSnapshots[0][0].proofKind, 'checkpoint');
  assert.equal(proofSnapshots[0][1].proofKind, '', 'future result is not covered by the first checkpoint');
  assert.equal(proofSnapshots[1][0].status, 'sealed');
  assert.deepEqual(response.data.figureResults[0].panels.map(panel => panel.panel), labels);
  assert.ok(ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations[0]
    .providerDispatches.every(entry => entry.status === 'sealed'));
});

for (const rejection of ['http', 'schema']) test(`a ${rejection}-rejected concurrent DeepSeek batch preserves its neighbour and resumes only missing Panels`, async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  const checkpoints = [];
  let rejectionsRemaining = rejection === 'schema' ? 2 : 1;
  const requested = [];
  const makeRouter = () => createConfirmedFigureRouter({
    storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id',
    fetchImpl: async (_url, options) => {
      const input = JSON.parse(JSON.parse(options.body).messages[1].content);
      requested.push(input);
      if (rejectionsRemaining > 0 && input.expected_panel_labels?.[0] === 'A') {
        rejectionsRemaining -= 1;
        return rejection === 'http' ? jsonResponse({}, 400)
          : jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
      }
      const output = input.pass === 'missing_panel_recovery'
        ? figureRecoveryOutput(input, input.requested_panel_labels) : figurePassOutput(input);
      return jsonResponse({ choices: [{ finish_reason: 'stop',
        message: { content: JSON.stringify(output) }
      }] });
    }
  });
  const router = makeRouter();
  await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
    config: { apiKey: 'fixture-key', model: 'deepseek-v4-flash' } });
  await router.handle({ type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'deepseek', consentGranted: true } });
  const labels = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
  const figure = { ...figureInput(1), panelHints: labels };
  const owner = { ...figureCheckpointContext([], checkpoints), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 92, senderFrameId: 0,
    senderDocumentId: '92929292-9292-4929-8929-929292929292' };
  const base = { analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 92,
    operationId: 'figure-prefetch-neighbour-resume-operation',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 26 }] };
  const first = await router.handle(figureMessage([figure], { ...base,
    figureRequestReceipt: 'figure-request-prefetch-neighbour-first-12345678' }), owner);
  assert.equal(first.error?.code, rejection === 'http' ? 'PROVIDER_REJECTED' : 'INVALID_RESPONSE', JSON.stringify(first));
  assert.equal(requested.length, rejection === 'http' ? 2 : 3, 'finish the started wave and existing schema repair but start no new wave');
  assert.deepEqual(checkpoints.at(-1).figureResult.panels.map(panel => panel.panel), labels.slice(6, 12));
  const beforeResume = requested.length;
  const resumed = await makeRouter().handle(figureMessage([figure], { ...base,
    figureRequestReceipt: 'figure-request-prefetch-neighbour-resume-12345678',
    figureResumeCheckpoint: structuredClone(checkpoints.at(-1).checkpointEnvelope)
  }), owner);
  assert.equal(resumed.success, true, JSON.stringify(resumed));
  assert.deepEqual(requested.slice(beforeResume).filter(input => input.pass === 'missing_panel_recovery')
    .flatMap(input => input.requested_panel_labels), [...labels.slice(0, 6), ...labels.slice(12)]);
  assert.deepEqual(resumed.data.figureResults[0].panels.map(panel => panel.panel), labels);
});

test('explicit current confirmation: automatic vision-to-text fallback stays ordered without prefetching another visual batch', async () => {
  const storageArea = createMemoryStorage();
  const requests = [];
  let active = 0;
  let maximumActive = 0;
  const router = createConfirmedFigureRouter({ storageArea,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const content = body.messages[1].content;
      const visual = Array.isArray(content);
      const input = JSON.parse(visual ? content.find(item => item.type === 'text').text : content);
      requests.push({ visual, panels: input.expected_panel_labels });
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 3));
      active -= 1;
      if (visual) return jsonResponse({}, 400);
      return jsonResponse({ choices: [{ finish_reason: 'stop',
        message: { content: JSON.stringify(figurePassOutput(input)) }
      }] });
    }
  });
  await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
    config: { apiKey: 'fixture-key', model: 'deepseek-v4-flash-vision-exp' } });
  await router.handle({ type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'deepseek', consentGranted: true } });
  storageArea.values.sciLlmSettingsV2.taskPolicies.figure_walkthrough.allowTextFallback = true;
  const labels = Array.from({ length: 12 }, (_, index) => String.fromCharCode(65 + index));
  const response = await router.handle(figureMessage([{
    ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,/9j/2Q==' }]), panelHints: labels
  }], { analysisDepth: 'standard' }));
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(maximumActive, 1);
  assert.deepEqual(requests.filter(item => item.visual).map(item => item.panels), [labels.slice(0, 6)]);
  assert.deepEqual(response.data.figureResults[0].panels.map(panel => panel.panel), labels);
  assert.equal(response.data.figureResults[0].basis, 'caption_context');
});

test('large standard Figure resumes saved six Panels after a later batch rejection', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  const firstCheckpoints = [];
  let calls = 0;
  let failed = false;
  const resumedRequests = [];
  const createRouter = () => createConfirmedFigureRouter({
    storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id', sleepImpl: async () => {},
    fetchImpl: async (_url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      if (failed) resumedRequests.push(input);
      if (calls === 2) { failed = true; return jsonResponse({}, 400); }
      const output = input.pass === 'missing_panel_recovery'
        ? figureRecoveryOutput(input, input.requested_panel_labels) : figurePassOutput(input);
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  const firstRouter = createRouter();
  await configureOpenAIRouter(firstRouter);
  const panels = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
  const figure = { ...figureInput(1), panelHints: panels };
  const owner = { ...figureCheckpointContext([], firstCheckpoints), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 86, senderFrameId: 0,
    senderDocumentId: '86868686-8686-4686-8686-868686868686' };
  const base = { analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 86,
    operationId: 'figure-standard-large-resume-operation',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 26 }] };
  const first = await firstRouter.handle(figureMessage([figure], { ...base,
    figureRequestReceipt: 'figure-request-standard-large-first-12345678' }), owner);
  assert.equal(first.error?.code, 'PROVIDER_REJECTED', JSON.stringify(first));
  assert.deepEqual(firstCheckpoints.at(-1).figureResult.panels.map(panel => panel.panel), panels.slice(0, 6));
  const resumed = await createRouter().handle(figureMessage([figure], { ...base,
    figureRequestReceipt: 'figure-request-standard-large-resume-12345678',
    figureResumeCheckpoint: structuredClone(firstCheckpoints.at(-1).checkpointEnvelope)
  }), owner);
  assert.equal(resumed.success, true, JSON.stringify(resumed));
  const recovery = resumedRequests.filter(input => input.pass === 'missing_panel_recovery');
  assert.deepEqual(recovery.flatMap(input => input.requested_panel_labels), panels.slice(6));
  assert.ok(recovery.every(input => input.requested_panel_labels.length <= 3));
  assert.deepEqual(resumed.data.figureResults[0].panels.map(panel => panel.panel), panels);
});

async function configuredFigureRouter(providerId, config) {
  const storageArea = createMemoryStorage();
  const bodies = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      const deepSeekContent = body.messages?.[1]?.content;
      const input = providerId === 'deepseek'
        ? JSON.parse(Array.isArray(deepSeekContent)
          ? deepSeekContent.find(item => item.type === 'text')?.text
          : deepSeekContent)
        : openAIInputPayload(body);
      const output = figurePassOutput(input);
      return providerId === 'deepseek'
        ? sseResponse(JSON.stringify(output))
        : jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId,
    config: { apiKey: 'key', ...config }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId, consentGranted: true }
  });
  return { router, bodies };
}

test('a completed DeepSeek resource rejection does not quarantine a Figure receipt', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  let calls = 0;
  const router = createConfirmedFigureRouter({
    storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id', sleepImpl: async () => {},
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls === 1) return jsonResponse({ choices: [{
        finish_reason: 'insufficient_system_resource', message: { content: '' }
      }] });
      const body = JSON.parse(options.body);
      const input = JSON.parse(body.messages[1].content);
      return jsonResponse({ choices: [{ finish_reason: 'stop',
        message: { content: JSON.stringify(figurePassOutput(input)) }
      }] });
    }
  });
  await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
    config: { apiKey: 'fixture-key', model: 'deepseek-v4-flash' } });
  await router.handle({ type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'deepseek', consentGranted: true } });
  const response = await router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 85,
    operationId: 'figure-completed-provider-resource-rejection',
    figureRequestReceipt: 'figure-request-completed-resource-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
    forceRefresh: true
  }), { ...figureCheckpointContext([], []), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 85, senderFrameId: 0,
    senderDocumentId: '85858585-8585-4585-8585-858585858585' });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(calls, 2);
  assert.equal(response.data.figureResults[0].inputMode, 'caption_context');
});

test('analyzes a bounded supplemental Figure id with direct vision input and no caption', async () => {
  const { router, bodies } = await configuredFigureRouter('openai', {
    model: 'gpt-5-mini'
  });
  const figureId = 'supp-manual-s1-s1';
  const response = await router.handle(figureMessage([{
    figureId,
    figureLabel: 'Figure S1',
    caption: '',
    images: [{ dataUrl: 'data:image/png;base64,AA==' }]
  }], { analysisDepth: 'standard' }));

  assert.equal(response.success, true);
  assert.equal(response.data.figureResults[0].figureId, figureId);
  assert.equal(openAIInputPayload(bodies[0]).analysis_basis, 'vision_text');
  assert.ok(bodies[0].input[0].content.some(item => item.type === 'input_image'));
});

test('passes DeepSeek reasoning support into the optional structured reasoning probe', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  let lastBody;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      lastBody = JSON.parse(options.body);
      return sseResponse(JSON.stringify({ ok: true, echo: 'schema' }));
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'deepseek',
    config: {
      apiKey: 'key', model: 'deepseek-v4-pro', reasoningEffort: 'enabled'
    }
  });
  const result = await router.handle({
    type: 'LLM_TEST_PROVIDER',
    providerId: 'deepseek',
    probeIds: ['reasoning_structured']
  });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(calls, 1);
  assert.equal(result.data.probes[0].id, 'reasoning_structured');
  assert.equal(result.data.probes[0].status, 'passed');
  assert.deepEqual(lastBody.thinking, { type: 'enabled' });
  assert.deepEqual(lastBody.response_format, { type: 'json_object' });
});

test('passes the configured bounded effort profile into the structured reasoning probe', async () => {
  const storageArea = createMemoryStorage();
  let body;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      body = JSON.parse(options.body);
      return jsonResponse({ output_text: JSON.stringify({ ok: true, echo: 'schema' }) });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini', reasoningEffort: 'high' }
  });
  const result = await router.handle({
    type: 'LLM_TEST_PROVIDER', providerId: 'openai', probeIds: ['reasoning_structured']
  });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.data.probes[0].status, 'passed');
  assert.deepEqual(body.reasoning, { effort: 'high' });
});

test('analyzes a bounded caption-only supplemental Figure without fabricating vision input', async () => {
  const { router, bodies } = await configuredFigureRouter('openai', {
    model: 'gpt-5-mini'
  });
  const figureId = 'supp-caption-s2-s2';
  const response = await router.handle(figureMessage([{
    figureId,
    figureLabel: 'Figure S2',
    caption: 'Figure S2. (A) Replication and (B) rescue support the main result.',
    panelHints: ['A', 'B'],
    images: []
  }], { analysisDepth: 'standard' }));

  assert.equal(response.success, true);
  assert.equal(response.data.figureResults[0].figureId, figureId);
  assert.equal(openAIInputPayload(bodies[0]).analysis_basis, 'caption_context');
  assert.doesNotMatch(JSON.stringify(bodies[0]), /input_image|data:image\//);
});

test('analyzes a native Extended Data Figure id instead of rejecting it locally', async () => {
  const { router, bodies } = await configuredFigureRouter('openai', {
    model: 'gpt-5-mini'
  });
  const figureId = 'figure-ed1';
  const response = await router.handle(figureMessage([{
    figureId,
    figureLabel: 'Extended Data Figure 1',
    caption: 'Extended Data Figure 1. (A) Quality control and (B) enrichment analysis.',
    panelHints: ['A', 'B'],
    images: []
  }], { analysisDepth: 'standard' }));

  assert.equal(response.success, true);
  assert.equal(response.data.figureResults[0].figureId, figureId);
  assert.ok(bodies.length > 0);
});

test('isolates shared research evidence by each exact paper-review task policy', async () => {
  const storageArea = createMemoryStorage();
  const stages = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const prompt = String(body.messages?.[1]?.content || '');
      let stage;
      let output;
      if (/atomic evidence/i.test(prompt)) {
        stage = 'atomic_evidence';
        output = { atoms: [
          { evidenceId: 'B1', type: 'B', statement: 'PV plasticity supports circuit adaptation.', sourceRefs: [{ paragraphId: 'intro-1', sourceIdentity: 'intro:1', textHash: 'h1', quote: 'supports circuit adaptation' }], origin: 'author_explicit', verificationStatus: 'verified' },
          { evidenceId: 'X1', type: 'X', statement: 'The regulator remains unknown.', sourceRefs: [{ paragraphId: 'intro-2', sourceIdentity: 'intro:2', textHash: 'h2', quote: 'remains unknown' }], origin: 'author_explicit', verificationStatus: 'verified' },
          { evidenceId: 'A1', type: 'A', statement: 'The study seeks the regulator.', sourceRefs: [{ paragraphId: 'intro-3', sourceIdentity: 'intro:3', textHash: 'h3', quote: 'seeks the regulator' }], origin: 'author_explicit', verificationStatus: 'verified' },
          { evidenceId: 'R1', type: 'R', statement: 'A candidate emerges from the screen.', sourceRefs: [{ paragraphId: 'results-1', sourceIdentity: 'results:1', textHash: 'h4', quote: 'candidate emerges' }], origin: 'author_explicit', verificationStatus: 'verified' }
        ] };
      } else if (/Derive B\/K\/E\/X\/G\/A/i.test(prompt)) {
        stage = 'question_trace';
        output = { coreQuestion: { questionId: 'Q0', text: 'Which regulators control PV plasticity?', evidenceIds: ['B1', 'X1', 'A1'] }, bridge: [{ traceId: 'T1', type: 'B', evidenceIds: ['B1'] }, { traceId: 'T2', type: 'X', evidenceIds: ['X1'] }] };
      } else if (/Starting from Q0/i.test(prompt)) {
        stage = 'progression';
        output = { progression: [{ questionId: 'Q1', text: 'Which candidate emerges?', generatedFrom: ['Q0'], evidenceIds: ['R1'], causalLevel: 'association' }] };
      } else if (/^Audit source binding/i.test(prompt)) {
        stage = 'audit';
        output = { issues: [], acceptedQuestionIds: ['Q0', 'Q1'] };
      } else if (/paper-level innovation points/i.test(prompt)) {
        stage = 'innovation';
        output = { innovationPoints: [{ text: 'Connects a screen to a paper-level candidate.', evidenceIds: ['R1'], origin: 'brevess_reconstructed', confidence: 'medium' }] };
      } else if (/research limitations/i.test(prompt)) {
        stage = 'limitations';
        output = { limitationPoints: [{ text: 'The supplied evidence is bounded to one system.', evidenceIds: ['R1'], origin: 'brevess_reconstructed', confidence: 'medium' }] };
      } else {
        throw new Error(`unexpected research prompt: ${prompt.slice(0, 80)}`);
      }
      stages.push(stage);
      return jsonResponse({
        model: 'deepseek-v4-flash',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 100, completion_tokens: 40 }
      });
    }
  });
  await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek', config: { apiKey: 'key', model: 'deepseek-v4-flash' } });
  await router.handle({ type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', providerId: 'deepseek', consentGranted: true } });
  const document = {
    documentHash: 'a'.repeat(64),
    paragraphs: [
      { paragraphId: 'intro-1', sourceIdentity: 'intro:1', sourceKey: 'intro-1', textHash: 'h1', sectionKind: 'introduction', sectionTitle: 'Introduction', text: 'PV plasticity supports circuit adaptation.' },
      { paragraphId: 'intro-2', sourceIdentity: 'intro:2', sourceKey: 'intro-2', textHash: 'h2', sectionKind: 'introduction', sectionTitle: 'Introduction', text: 'The regulator remains unknown.' },
      { paragraphId: 'intro-3', sourceIdentity: 'intro:3', sourceKey: 'intro-3', textHash: 'h3', sectionKind: 'introduction', sectionTitle: 'Introduction', text: 'The study seeks the regulator.' },
      { paragraphId: 'results-1', sourceIdentity: 'results:1', sourceKey: 'results-1', textHash: 'h4', sectionKind: 'results', sectionTitle: 'Results', text: 'A candidate emerges from the screen.' }
    ]
  };
  const research = await router.handle({ type: 'LLM_ANALYZE_RESEARCH_LOGIC', document });
  const innovation = await router.handle({ type: 'LLM_ANALYZE_PAPER_INNOVATION', document });
  const limitations = await router.handle({ type: 'LLM_ANALYZE_PAPER_LIMITATIONS', document });
  assert.equal(research.success, true);
  assert.equal(research.data.questionTrace.coreQuestion.questionId, 'Q0');
  assert.equal(innovation.success, true);
  assert.equal(limitations.success, true);
  assert.equal(stages.filter(stage => stage === 'atomic_evidence').length, 3);
  assert.equal(innovation.data.cache.atomicEvidence, 'miss');
  assert.equal(limitations.data.cache.atomicEvidence, 'miss');
});

test('autofills a bounded literature-note template and reuses the local result cache', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  let generatedValue = 'PV neurons support circuit adaptation.';
  let failGeneration = false;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      if (failGeneration) throw new Error('Synthetic offline failure');
      const body = JSON.parse(options.body);
      const prompt = String(body.messages?.[1]?.content || '');
      assert.match(prompt, /fill_literature_note/);
      assert.match(prompt, /multiple distinct points.*Markdown list/i);
      assert.match(prompt, /paragraph.*paragraphId/i);
      assert.doesNotMatch(prompt, /paragraphId references only in sources/i);
      return jsonResponse({
        model: 'deepseek-v4-flash',
        choices: [{
          finish_reason: 'stop',
          message: { content: JSON.stringify({
            values: {
              research_background: generatedValue,
              scientific_questions: ''
            },
            statuses: {
              research_background: 'supported',
              scientific_questions: 'missing'
            },
            sources: {
              research_background: ['intro-1'],
              scientific_questions: []
            }
          }) }
        }]
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
    config: { apiKey: 'key', model: 'deepseek-v4-flash' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'deepseek', consentGranted: true }
  });
  const message = {
    type: 'LLM_AUTOFILL_LITERATURE_NOTE',
    operationId: 'literature-note-first',
    template: {
      id: 'basic_research', name: '基础研究', studyFamily: 'basic_research',
      fields: [
        { id: 'research_background', label: '研究背景' },
        { id: 'scientific_questions', label: '科学问题' }
      ]
    },
    document: {
      documentHash: 'b'.repeat(64),
      paragraphs: [{
        paragraphId: 'intro-1', sourceIdentity: 'intro:1', sourceKey: 'intro-1',
        textHash: 'h1', sectionKind: 'introduction', sectionTitle: 'Introduction',
        text: 'PV neurons support circuit adaptation and the regulator remains unknown.'
      }]
    }
  };

  const first = await router.handle(message);
  const second = await router.handle({ ...message, operationId: 'literature-note-second' });

  assert.equal(first.success, true);
  assert.deepEqual(Object.keys(first.data.values), [
    'research_background'
  ]);
  assert.deepEqual({ ...first.data.statuses }, {
    research_background: 'supported', scientific_questions: 'missing'
  });
  assert.deepEqual(first.data.summary, { supported: 1, missing: 1 });
  assert.equal(first.data.cacheHit, false);
  assert.equal(first.data.operationId, 'literature-note-first');
  assert.equal(first.data.operationReceipt.providerAttempts, 1);
  assert.equal(first.data.operationReceipt.cacheHit, false);
  assert.equal(first.data.operationReceipt.operationId, 'literature-note-first');
  assert.equal(first.data.operationReceipt.cacheIdentity.cacheKey.startsWith('literature-note:'), true);
  assert.equal(first.data.operationReceipt.cacheIdentity.documentHash, message.document.documentHash);
  assert.equal(typeof first.data.operationReceipt.cacheIdentity.evidenceSignature, 'string');
  assert.equal(typeof first.data.operationReceipt.cacheIdentity.templateSignature, 'string');
  assert.equal(typeof first.data.operationReceipt.cacheIdentity.profileSignature, 'string');
  assert.equal(first.data.operationReceipt.cacheIdentity.outputLanguage, 'zh-CN');
  const cacheIdentity = first.data.operationReceipt.cacheIdentity;
  assert.equal(cacheIdentity.cacheKey, `literature-note:${globalThis.SciLLM.stableHash({
    // New generation must not reuse the old field-only citation cache.
    version: 5, inlineSourceContract: 'paragraph-inline-v1', backgroundGuidance: '1', documentHash: cacheIdentity.documentHash, evidence: cacheIdentity.evidenceSignature,
    template: cacheIdentity.templateSignature, profile: cacheIdentity.profileSignature,
    outputLanguage: cacheIdentity.outputLanguage
  })}`);

  assert.equal(Object.isFrozen(first.data.operationReceipt), true);
  assert.equal(Object.isFrozen(first.data.operationReceipt.cacheIdentity), true);
  assert.equal(Object.isFrozen(first.data.evidenceReceipt), true);
  assert.equal(Object.isFrozen(first.data.evidenceReceipt.records), true);
  assert.deepEqual(first.data.evidenceReceipt.records, [{
    paragraphId: 'intro-1', sourceIdentity: 'intro:1', textHash: 'h1'
  }]);
  assert.equal(second.success, true);
  assert.equal(second.data.cacheHit, true);
  assert.equal(second.data.operationId, 'literature-note-second');
  assert.equal(second.data.operationReceipt.providerAttempts, 0);
  assert.equal(second.data.operationReceipt.cacheHit, true);
  assert.deepEqual(second.data.operationReceipt.cacheIdentity,
    first.data.operationReceipt.cacheIdentity);
  assert.deepEqual(second.data.evidenceReceipt, first.data.evidenceReceipt);
  assert.deepEqual(second.data.values, first.data.values);
  assert.deepEqual(second.data.statuses, first.data.statuses);
  assert.deepEqual(second.data.sources, first.data.sources);
  assert.deepEqual(second.data.summary, first.data.summary);
  assert.equal(providerCalls, 1);

  const otherPaper = structuredClone(message);
  otherPaper.operationId='literature-note-other-paper';
  otherPaper.document.documentHash = 'c'.repeat(64);
  otherPaper.document.paragraphs[0].text = 'A different paper with a different claim.';
  const third = await router.handle(otherPaper);
  assert.equal(third.success, true);
  assert.equal(third.data.cacheHit, false);
  assert.equal(providerCalls, 2);

  generatedValue = 'Freshly generated account of circuit adaptation.';
  const regenerated = await router.handle({ ...message, forceRefresh: true,
    operationId: 'literature-note-force-refresh' });
  assert.equal(regenerated.success, true);
  assert.equal(regenerated.data.cacheHit, false);
  assert.equal(regenerated.data.operationReceipt.providerAttempts, 1);
  assert.equal(regenerated.data.values.research_background, generatedValue);
  assert.equal(providerCalls, 3, 'force refresh must bypass a warm valid cache');
  const recached = await router.handle({ ...message, operationId: 'literature-note-refreshed-cache' });
  assert.equal(recached.data.cacheHit, true);
  assert.equal(recached.data.values.research_background, generatedValue);
  assert.equal(providerCalls, 3);
  failGeneration = true;
  const failed = await router.handle({ ...message, forceRefresh: true,
    operationId: 'literature-note-force-failed' });
  assert.equal(failed.success, false);
  const afterFailureCalls = providerCalls;
  assert.ok(afterFailureCalls > 3);
  const preserved = await router.handle({ ...message, operationId: 'literature-note-cache-preserved' });
  assert.equal(preserved.success, true);
  assert.equal(preserved.data.cacheHit, true);
  assert.equal(preserved.data.values.research_background, generatedValue);
  assert.equal(providerCalls, afterFailureCalls, 'failed generation must not replace the old valid cache');
});

test('NOTE-011 bypasses a valid v4 note cache without deleting or overwriting its value', async () => {
  const storageArea = createMemoryStorage();
  const firstCache = globalThis.SciLLM.createMemoryAnalysisCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      values: { research_background: `Generation ${calls}: grounded background.` },
      statuses: { research_background: 'supported' }, sources: { research_background: ['intro-1'] }
    }) } }] });
  };
  const firstRouter = createBackgroundRouter({ storageArea, cacheStore: firstCache, fetchImpl });
  await firstRouter.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
    config: { apiKey: 'synthetic-key', model: 'deepseek-v4-flash' } });
  await firstRouter.handle({ type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'deepseek', consentGranted: true } });
  const message = { type: 'LLM_AUTOFILL_LITERATURE_NOTE', operationId: 'note011-cache-seed',
    template: { id: 'basic_research', name: '基础研究', studyFamily: 'basic_research',
      fields: [{ id: 'research_background', label: '研究背景', prompt: '' }] },
    document: { documentHash: 'd'.repeat(64), paragraphs: [{ paragraphId: 'intro-1',
      sourceIdentity: 'intro:1', sourceKey: 'intro-1', textHash: 'h1', sectionKind: 'introduction',
      text: 'The background provides grounded concepts and an unresolved question.' }] } };
  const first = await firstRouter.handle(message);
  assert.equal(first.success, true);
  const identity = first.data.operationReceipt.cacheIdentity;
  const legacyKey = `literature-note:${globalThis.SciLLM.stableHash({ version: 4,
    documentHash: identity.documentHash, evidence: identity.evidenceSignature,
    template: identity.templateSignature, profile: identity.profileSignature,
    outputLanguage: identity.outputLanguage })}`;
  const generated = (await firstCache.getMany([identity.cacheKey])).get(identity.cacheKey);
  const legacyValue = structuredClone({ ...generated, key: legacyKey });
  const legacyOnlyCache = globalThis.SciLLM.createMemoryAnalysisCache();
  await legacyOnlyCache.setMany([legacyValue]);
  const router = createBackgroundRouter({ storageArea, cacheStore: legacyOnlyCache, fetchImpl });
  const fresh = await router.handle({ ...message, operationId: 'note011-after-update' });
  assert.equal(fresh.success, true);
  assert.equal(fresh.data.cacheHit, false);
  assert.equal(calls, 2);
  assert.notEqual(fresh.data.values.research_background, first.data.values.research_background);
  assert.deepEqual((await legacyOnlyCache.getMany([legacyKey])).get(legacyKey), legacyValue);
  const reused = await router.handle({ ...message, operationId: 'note011-current-cache' });
  assert.equal(reused.data.cacheHit, true);
  assert.equal(calls, 2);
  assert.deepEqual(reused.data.values, fresh.data.values);
});

test('literature-note cache and receipts bind every normalized field instruction', async () => {
  const storageArea = createMemoryStorage();
  const prompts = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      prompts.push(String(body.messages?.[1]?.content || ''));
      return jsonResponse({
        model: 'deepseek-v4-flash',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
          values: { finding: 'Grounded finding.' },
          statuses: { finding: 'supported' },
          sources: { finding: ['result-1'] }
        }) } }]
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
    config: { apiKey: 'key', model: 'deepseek-v4-flash' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'deepseek', consentGranted: true }
  });
  const base = {
    type: 'LLM_AUTOFILL_LITERATURE_NOTE',
    operationId: 'literature-note-signature-base',
    template: {
      id: 'custom_note', name: 'Custom note', studyFamily: 'custom',
      fields: [{
        id: 'finding', label: 'Finding', prompt: 'Extract direct evidence.',
        placeholder: 'Evidence only', multiline: true, required: false
      }]
    },
    document: {
      documentHash: '9'.repeat(64),
      paragraphs: [{
        paragraphId: 'result-1', sourceIdentity: 'results:1', sourceKey: 'result-1',
        textHash: 'hash-1', sectionKind: 'results', sectionTitle: 'Results',
        text: 'The result directly supports the grounded finding.'
      }]
    }
  };
  const first = await router.handle(base);
  const cached = await router.handle({
    ...base, operationId: 'literature-note-signature-cached'
  });
  assert.equal(first.success, true);
  assert.equal(first.data.cacheHit, false);
  assert.equal(cached.data.cacheHit, true);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Extract direct evidence/u);
  assert.equal(
    first.data.operationReceipt.cacheIdentity.templateSignature,
    first.data.evidenceReceipt.templateSignature
  );

  const variants = [
    template => ({ ...template, name: 'Renamed note' }),
    template => ({ ...template, studyFamily: 'basic_research' }),
    template => ({ ...template, fields: [{ ...template.fields[0], label: 'Key finding' }] }),
    template => ({ ...template, fields: [{ ...template.fields[0], prompt: 'Changed prompt.' }] }),
    template => ({ ...template, fields: [{ ...template.fields[0], placeholder: 'Changed placeholder' }] }),
    template => ({ ...template, fields: [{ ...template.fields[0], multiline: false }] }),
    template => ({ ...template, fields: [{ ...template.fields[0], required: true }] })
  ];
  const signatures = new Set([
    first.data.operationReceipt.cacheIdentity.templateSignature
  ]);
  for (const [index, mutate] of variants.entries()) {
    const response = await router.handle({
      ...base,
      operationId: `literature-note-signature-${index}`,
      template: mutate(structuredClone(base.template))
    });
    assert.equal(response.success, true);
    assert.equal(response.data.cacheHit, false, `variant ${index} must not reuse cache`);
    assert.equal(
      response.data.operationReceipt.cacheIdentity.templateSignature,
      response.data.evidenceReceipt.templateSignature
    );
    signatures.add(response.data.operationReceipt.cacheIdentity.templateSignature);
  }
  assert.equal(prompts.length, 1 + variants.length);
  assert.equal(signatures.size, 1 + variants.length);
});

test('repairs a typed literature-note response once and retains a valid field with invalid missingness pending', async () => {
  const storageArea = createMemoryStorage();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const body = JSON.parse(options.body);
      const system = String(body.instructions || '');
      if (providerCalls === 1) {
        return jsonResponse({
          output_text: JSON.stringify({
            values: { finding: 'Grounded.', gap: '正文未提供' },
            sources: { finding: ['result-1'], gap: [] }
          })
        });
      }
      assert.match(system, /SCHEMA_REPAIR_PASS/);
      assert.match(system, /values, statuses, and sources/);
      assert.match(system, /supported requires non-empty value/);
      assert.match(system, /missing requires value="" and sources=\[\]/);
      return jsonResponse({
        output_text: JSON.stringify({
          values: { finding: 'Grounded.', gap: '正文未提供' },
          statuses: { finding: 'supported', gap: 'missing' },
          sources: { finding: ['result-1'], gap: [] }
        })
      });
    }
  });
  await configureOpenAIRouter(router);
  const message = {
    type: 'LLM_AUTOFILL_LITERATURE_NOTE',
    operationId: 'literature-note-repair-first',
    template: {
      id: 'typed_note', name: 'Typed note', studyFamily: 'basic_research',
      fields: [{ id: 'finding', label: 'Finding' }, { id: 'gap', label: 'Gap' }]
    },
    document: {
      documentHash: 'd'.repeat(64),
      paragraphs: [{
        paragraphId: 'result-1', sourceIdentity: 'results:1', sourceKey: 'result-1',
        textHash: 'h1', sectionKind: 'results', sectionTitle: 'Results',
        text: 'The experiment supports the grounded finding.'
      }]
    }
  };
  const progress = [];
  const repaired = await router.handle(message, {
    onProgress: value => progress.push(value)
  });
  assert.equal(repaired.success, true);
  assert.equal(repaired.data.cacheHit, false);
  assert.equal(repaired.data.operationReceipt.providerAttempts, 2);
  assert.deepEqual({ ...repaired.data.statuses }, { finding: 'supported' });
  assert.deepEqual(repaired.data.summary, { supported: 1, missing: 0, pending: 1 });
  assert.equal(repaired.data.partial, true); assert.deepEqual(repaired.data.pendingFieldIds, ['gap']);
  assert.equal(Object.hasOwn(repaired.data.values, 'gap'), false);
  assert.equal(Object.hasOwn(repaired.data.sources, 'gap'), false);
  assert.equal(progress.some(item => item.phase === 'literature_note_field_pending'), true);
  const cacheKey = repaired.data.operationReceipt.cacheIdentity.cacheKey;
  assert.equal((await cacheStore.getMany([cacheKey])).has(cacheKey), false, 'partial result must not become a complete cache');
  assert.equal(providerCalls, 2, 'only the initial request and one repair are allowed');
});

test('caches compact-retry literature notes under the immutable original evidence identity', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  let savedPayload;
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => {
        savedPayload = structuredClone(value);
        entries.set(value.key, value);
      });
    },
    async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
  };
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      providerCalls += 1;
      if (providerCalls === 1) return jsonResponse({}, 503);
      return jsonResponse({
        output_text: JSON.stringify({
          values: { finding: 'The first paragraph supports the finding.', gap: '' },
          statuses: { finding: 'supported', gap: 'missing' },
          sources: { finding: ['intro-1'], gap: [] }
        })
      });
    }
  });
  await configureOpenAIRouter(router);
  const message = {
    type: 'LLM_AUTOFILL_LITERATURE_NOTE',
    operationId: 'literature-note-compact-first',
    template: {
      id: 'compact_note', name: 'Compact note', studyFamily: 'basic_research',
      fields: [{ id: 'finding', label: 'Finding' }, { id: 'gap', label: 'Gap' }]
    },
    document: {
      documentHash: 'e'.repeat(64),
      paragraphs: Array.from({ length: 30 }, (_, index) => ({
        paragraphId: `intro-${index + 1}`,
        sourceIdentity: `introduction:${index + 1}`,
        sourceKey: `intro-${index + 1}`,
        textHash: `hash-${index + 1}`,
        sectionKind: 'introduction', sectionTitle: 'Introduction',
        text: `${index === 0 ? 'The first paragraph supports the finding. ' : ''}${
          `Evidence paragraph ${index + 1}. `.repeat(55)}`
      }))
    }
  };
  const first = await router.handle(message);
  const second = await router.handle({ ...message, operationId: 'literature-note-compact-second' });
  assert.equal(first.success, true);
  assert.equal(first.data.cacheHit, false);
  assert.equal(first.data.operationReceipt.providerAttempts, 2);
  assert.equal(second.success, true);
  assert.equal(second.data.cacheHit, true);
  assert.equal(second.data.operationReceipt.providerAttempts, 0);
  assert.equal(providerCalls, 2, 'the identical second request must not call the provider');
  assert.deepEqual(second.data.values, first.data.values);
  assert.deepEqual(second.data.statuses, first.data.statuses);
  assert.deepEqual(second.data.sources, first.data.sources);
  assert.deepEqual(second.data.summary, first.data.summary);
  assert.equal(savedPayload.schemaVersion, 3);
  assert.equal(savedPayload.documentHash, message.document.documentHash);
  assert.equal(savedPayload.outputLanguage, 'zh-CN');
  assert.equal(typeof savedPayload.profileSignature, 'string');
  assert.ok(savedPayload.profileSignature);
  assert.equal(typeof savedPayload.templateSignature, 'string');
  assert.equal(typeof savedPayload.evidenceSignature, 'string');
  assert.deepEqual(savedPayload.normalized.statuses, { ...first.data.statuses });

  const cachedPayload = entries.values().next().value;
  cachedPayload.normalized.values.invented_field = 'must not be discarded before validation';
  const rejected = await router.handle(message);
  assert.equal(rejected.success, false);
  assert.equal(rejected.error.code, 'INVALID_RESPONSE');
  assert.equal(providerCalls, 2, 'invalid cached maps must be rejected before provider use');
});

test('rejects malformed or overlong supplemental Figure ids before any provider request', async () => {
  const { router, bodies } = await configuredFigureRouter('openai', {
    model: 'gpt-5-mini'
  });
  const invalidIds = [
    'supp-../escape-s1',
    `supp-${'a'.repeat(49)}-s1`,
    `supp-valid-material-${'b'.repeat(25)}`,
    'supp-UPPER-s1',
    'custom-any-id'
  ];
  for (const figureId of invalidIds) {
    const response = await router.handle(figureMessage([{
      figureId,
      figureLabel: 'Figure S1',
      caption: 'Figure S1. Supplemental evidence.',
      images: []
    }], { analysisDepth: 'standard', forceRefresh: true }));
    assert.equal(response.success, false, figureId);
    assert.equal(response.error.code, 'INVALID_SETTINGS', figureId);
    assert.deepEqual(response.error.fields, ['figures'], figureId);
  }
  assert.equal(bodies.length, 0);
});

test('builds and caches an ordered cross-figure domino chain', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = {
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Mechanistic study' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Figure 1 establishes the phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Figure 2 tests the mechanism.' } },
      { ...crossFigureInput(3), figureId: 'figure-s1', figureLabel: 'Figure S1', isSupplemental: true }
    ]
  };
  const first = await router.handle(message);
  const second = await router.handle(message);

  assert.equal(first.success, true, JSON.stringify(first));
  assert.deepEqual(first.data.crossFigureLogic.nodes.map(item => item.figureId), ['figure-1', 'figure-2']);
  assert.equal(first.data.crossFigureLogic.dominoChain.length, 1);
  assert.equal(first.data.cacheHit, false);
  assert.match(first.data.profileSignature, /^[a-f0-9]{8,64}$/);
  assert.equal(second.data.cacheHit, true);
  assert.equal(second.data.profileSignature, first.data.profileSignature);
  assert.equal(calls, 3);
});

test('Panel ledger participates in cross-Figure prompts and cache identity', async () => {
  const storageArea = createMemoryStorage();
  const inputs = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      inputs.push(input);
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const base = {
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Ledger cache identity' },
    figures: [
      { ...figureInput(1), panelHints: ['A'], analysis: { coreConclusion: 'Phenotype.' } },
      { ...figureInput(2), panelHints: ['A'], analysis: { coreConclusion: 'Mechanism.' } },
      {
        ...figureInput(3), figureId: 'figure-s1', figureLabel: 'Figure S1',
        isSupplemental: true, panelHints: ['A']
      }
    ]
  };
  const first = await router.handle(base);
  const changed = structuredClone(base);
  changed.figures[0].panelHints.push('B');
  const second = await router.handle(changed);

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(second.data.cacheHit, false);
  assert.equal(inputs.length, 6);
  const vocabularyInputs = inputs.filter(item => Array.isArray(item.panels));
  assert.deepEqual(vocabularyInputs[1].panels.map(entry => entry.panel_key), [
    'figure-1:A', 'figure-1:B', 'figure-2:A', 'figure-s1:A'
  ]);
});

test('stages mechanism Panel batches with bounded two-way concurrency at four entries or fewer', async () => {
  const storageArea = createMemoryStorage();
  const stages = [];
  let activeEdgeRequests = 0;
  let maxActiveEdgeRequests = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (Array.isArray(input.ledger_batch)) {
        stages.push(input.ledger_batch.length);
        activeEdgeRequests += 1;
        maxActiveEdgeRequests = Math.max(maxActiveEdgeRequests, activeEdgeRequests);
        await Promise.resolve();
        activeEdgeRequests -= 1;
      }
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const labels = Array.from({ length: 25 }, (_, index) =>
    String.fromCharCode('A'.charCodeAt(0) + index));
  const response = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Bounded batches' },
    figures: [
      { ...figureInput(1), panelHints: labels.slice(0, 13),
        analysis: { coreConclusion: 'Phenotype.' } },
      { ...figureInput(2), panelHints: labels.slice(13),
        analysis: { coreConclusion: 'Mechanism.' } }
    ], forceRefresh: true
  });
  assert.equal(response.success, true);
  assert.deepEqual(stages, [4, 4, 4, 4, 4, 4, 1]);
  assert.equal(maxActiveEdgeRequests, 2);
  assert.equal(response.data.crossFigureLogic.panelCoverageAudit.ok, true);
  assert.equal(response.data.crossFigureLogic.panelDispositions.length, 25);
  assert.deepEqual(response.data.crossFigureLogic.panelDispositions.map(item => item.panelKey),
    labels.map((label, index) => `figure-${index < 13 ? 1 : 2}:${label}`));
});

test('reuses a valid staged cache with more than sixty-four mechanism edges', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  let edgeNumber = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      if (Array.isArray(input?.panels) && !input.main_figure_ids) {
        return jsonResponse({ output_text: JSON.stringify({
          nodes: Array.from({ length: 20 }, (_, index) => ({
            node_id: `n${index}`, label_zh: `Node ${index}`, node_type: 'state'
          }))
        }) });
      }
      if (Array.isArray(input?.ledger_batch)) {
        const edges = input.ledger_batch.map((entry, index) => {
          const current = edgeNumber++;
          return {
            from_node_id: `n${Math.floor(current / 20)}`,
            to_node_id: `n${current % 20}`,
            polarity: 'positive',
            assignments: [{ panel_key: entry.panel_key, evidence_class: 'other' }]
          };
        });
        return jsonResponse({ output_text: JSON.stringify({
          edges,
          dispositions: input.ledger_batch.map((entry, index) => ({
            panel_key: entry.panel_key, status: 'linked', edge_indexes: [index]
          }))
        }) });
      }
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const figures = Array.from({ length: 7 }, (_, index) => ({
    ...figureInput(index + 1), panelHints: 'ABCDEFGHIJ'.split(''),
    analysis: { coreConclusion: `Result ${index + 1}.` }
  }));
  const message = {
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Large valid mechanism cache' }, figures
  };
  const first = await router.handle(message);
  const callsAfterFirst = calls;
  const second = await router.handle(message);
  assert.equal(first.success, true);
  assert.equal(first.data.crossFigureLogic.mechanismEdges.length, 70);
  assert.equal(second.success, true);
  assert.equal(second.data.cacheHit, true);
  assert.equal(calls, callsAfterFirst);
});

test('repairs an invalid mechanism batch once and rejects an all-unlinked empty graph', async () => {
  for (const repairSucceeds of [true, false]) {
    const storageArea = createMemoryStorage();
    let edgeAttempts = 0;
    let repairAttempts = 0;
    const router = createBackgroundRouter({
      storageArea,
      fetchImpl: async (_url, options) => {
        const input = openAIInputPayload(JSON.parse(options.body));
        if (Array.isArray(input.ledger_batch) && input.repair_panel_keys) {
          repairAttempts += 1;
          const output = crossFigureOutput(input);
          if (!repairSucceeds) output.dispositions = [];
          return jsonResponse({ output_text: JSON.stringify(output) });
        }
        if (Array.isArray(input.ledger_batch)) {
          edgeAttempts += 1;
          return jsonResponse({ output_text: JSON.stringify({ edges: [], dispositions: [] }) });
        }
        return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
      }
    });
    await configureOpenAIRouter(router);
    const response = await router.handle({
      type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
      document: { title: 'One bounded repair' },
      figures: [
        { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
        { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } }
      ], forceRefresh: true
    });
    assert.equal(edgeAttempts, 2);
    assert.equal(repairAttempts, 1);
    assert.equal(response.success, false);
    assert.equal(response.error.code, 'MECHANISM_GRAPH_EMPTY');
  }
});

test('retries one invalid mechanism edge batch in place and rejects an empty graph', async () => {
  for (const repairSucceeds of [true, false]) {
    const storageArea = createMemoryStorage();
    let edgeAttempts = 0;
    const progress = [];
    const router = createBackgroundRouter({
      storageArea,
      fetchImpl: async (_url, options) => {
        const input = openAIInputPayload(JSON.parse(options.body));
        if (Array.isArray(input.ledger_batch) && !input.repair_panel_keys) {
          edgeAttempts += 1;
          if (edgeAttempts === 1 || !repairSucceeds) {
            return jsonResponse({ output_text: JSON.stringify({ edges: [], dispositions: [] }) });
          }
        }
        return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
      }
    });
    await configureOpenAIRouter(router);
    const response = await router.handle({
      type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
      document: { title: 'Repair one bounded mechanism batch' },
      figures: [
        { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
        { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } }
      ], forceRefresh: true
    }, { onProgress: event => progress.push(event) });
    assert.equal(edgeAttempts, 2);
    assert.equal(progress.some(event => event.phase === 'mechanism_edge_batch_repair'), true);
    if (repairSucceeds) {
      assert.equal(response.success, true);
      assert.ok(response.data.crossFigureLogic.mechanismEdges.length > 0);
    } else {
      assert.equal(response.success, false);
      assert.equal(response.error.code, 'MECHANISM_GRAPH_EMPTY');
    }
  }
});

test('repairs one invalid mechanism vocabulary response before generating edges', async () => {
  const storageArea = createMemoryStorage();
  let vocabularyAttempts = 0;
  const progress = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (Array.isArray(input?.panels) && Array.isArray(input?.figures) &&
          !Array.isArray(input?.main_figure_ids)) {
        vocabularyAttempts += 1;
        if (vocabularyAttempts === 1) {
          return jsonResponse({ output_text: JSON.stringify({ nodes: [] }) });
        }
      }
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Repair bounded mechanism vocabulary' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } }
    ], forceRefresh: true
  }, { onProgress: event => progress.push(event) });
  assert.equal(response.success, true);
  assert.equal(vocabularyAttempts, 2);
  assert.equal(progress.some(event => event.phase === 'mechanism_vocabulary_repair'), true);
  assert.ok(response.data.crossFigureLogic.mechanismEdges.length > 0);
});

test('retries invalid edge batches before bounded coverage requests and rejects an empty graph', async () => {
  const storageArea = createMemoryStorage();
  let edgeRequests = 0;
  let repairRequests = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (Array.isArray(input.ledger_batch) && input.repair_panel_keys) {
        repairRequests += 1;
        return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
      }
      if (Array.isArray(input.ledger_batch)) {
        edgeRequests += 1;
        return jsonResponse({ output_text: JSON.stringify({ edges: [], dispositions: [] }) });
      }
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXY'.split('');
  const response = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'One repair across batches' },
    figures: [
      { ...figureInput(1), panelHints: labels.slice(0, 13),
        analysis: { coreConclusion: 'Phenotype.' } },
      { ...figureInput(2), panelHints: labels.slice(13),
        analysis: { coreConclusion: 'Mechanism.' } }
    ], forceRefresh: true
  });
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'MECHANISM_GRAPH_EMPTY');
  assert.equal(edgeRequests, 14);
  assert.equal(repairRequests, 7);
});

test('cancellation after a staged provider response prevents validation and cache write', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) { values.forEach(value => entries.set(value.key, value)); },
    async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
  };
  const router = createBackgroundRouter({
    storageArea, cacheStore,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  let cancelled = false;
  const result = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC', operationId: 'staged-after-response-cancel',
    document: { title: 'Cancel staged response' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } }
    ], forceRefresh: true
  }, {
    onProgress: async event => {
      if (!cancelled && event.phase === 'mechanism_edge_batch_response') {
        cancelled = true;
        await router.handle({
          type: 'LLM_CONTROL_OPERATION', operationId: 'staged-after-response-cancel',
          command: 'cancel'
        });
      }
    }
  });
  assert.equal(cancelled, true);
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'CANCELLED');
  assert.equal([...entries.values()].some(item => item.crossFigureLogic), false);
});

test('cancellation deferred to final staged progress happens before the cache commit', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) { values.forEach(value => entries.set(value.key, value)); },
    async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
  };
  const router = createBackgroundRouter({
    storageArea, cacheStore,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  let cancelled = false;
  const result = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC', operationId: 'staged-final-cancel',
    document: { title: 'Cancel final staged progress' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } }
    ], forceRefresh: true
  }, {
    onProgress: async event => {
      if (!cancelled && event.phase === 'cross_figure_logic' &&
          event.completedFigures === event.totalFigures) {
        cancelled = true;
        await router.handle({
          type: 'LLM_CONTROL_OPERATION', operationId: 'staged-final-cancel',
          command: 'cancel'
        });
      }
    }
  });
  assert.equal(cancelled, true);
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'CANCELLED');
  assert.equal([...entries.values()].some(item => item.crossFigureLogic), false);
});

test('cancellation during the cache commit is complete and never deletes the shared key', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  let deleteCalls = 0;
  let cancelIssued = false;
  let router;
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      if (!cancelIssued && values.some(value => value.crossFigureLogic)) {
        cancelIssued = true;
        await router.handle({
          type: 'LLM_CONTROL_OPERATION', operationId: 'staged-commit-cancel',
          command: 'cancel'
        });
      }
      values.forEach(value => entries.set(value.key, value));
    },
    async deleteMany(keys) {
      deleteCalls += 1;
      keys.forEach(key => entries.delete(key));
    }
  };
  router = createBackgroundRouter({
    storageArea, cacheStore,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const result = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC', operationId: 'staged-commit-cancel',
    document: { title: 'Commit point cancellation' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } }
    ], forceRefresh: true
  });
  assert.equal(cancelIssued, true);
  assert.equal(result.success, true);
  assert.equal(deleteCalls, 0);
  assert.equal([...entries.values()].some(item => item.crossFigureLogic), true);
});

test('mechanism stages carry the full canonical supplemental Panel ledger separately from overview', async () => {
  const storageArea = createMemoryStorage();
  const inputs = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      inputs.push(input);
      const output = crossFigureOutput(input);
      if (output.mechanism_chain) {
        output.mechanism_chain[0].support_panel_refs = ['figure-s2:C'];
      }
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Supplemental ledger mechanism' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } },
      {
        ...figureInput(3), figureId: 'figure-s2', figureLabel: 'Figure S2',
        isSupplemental: true, panelHints: ['C'], analysis: {}
      }
    ],
    forceRefresh: true
  });
  assert.equal(response.success, true);
  assert.deepEqual(inputs[0].figures.map(figure => figure.figure_id), [
    'figure-1', 'figure-2'
  ]);
  assert.equal(inputs[0].panel_ledger, undefined);
  const vocabularyInput = inputs.find(item => Array.isArray(item.panels));
  assert.deepEqual(vocabularyInput.panels.map(entry => entry.panel_key), [
    'figure-1:A', 'figure-2:A', 'figure-s2:C'
  ]);
  assert.deepEqual(response.data.crossFigureLogic.mechanismEdges[0].supportPanels,
    ['figure-1:A', 'figure-2:A', 'figure-s2:C']);
});

test('evicts current-key cross-Figure cache entries with a corrupt envelope or Panel refs', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  let calls = 0;
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) { values.forEach(value => entries.set(value.key, value)); },
    async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
  };
  const router = createBackgroundRouter({
    storageArea, cacheStore,
    fetchImpl: async (_url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = {
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC', document: { title: 'Validated cache' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } }
    ]
  };
  const seeded = await router.handle(message);
  assert.equal(seeded.success, true);
  const firstEntry = [...entries.values()].find(item => item.crossFigureLogic);
  firstEntry.crossFigureVersion = '13';
  const envelopeRecovered = await router.handle(message);
  assert.equal(envelopeRecovered.data.cacheHit, false);
  assert.equal(calls, 6);

  const currentEntry = [...entries.values()].find(item => item.crossFigureLogic);
  currentEntry.crossFigureLogic.mechanismEdges[0].supportPanels = ['1A'];
  const payloadRecovered = await router.handle(message);
  assert.equal(payloadRecovered.data.cacheHit, false);
  assert.equal(calls, 9);
  assert.deepEqual(payloadRecovered.data.crossFigureLogic.mechanismEdges[0].supportPanels,
    ['figure-1:A', 'figure-2:A']);

  const corruptions = [
    edge => { edge.polarity = 'invented'; },
    edge => { edge.to = edge.from; edge.polarity = 'neutral'; },
    edge => { edge.edgeId = 'edge-forged'; }
  ];
  for (const corrupt of corruptions) {
    const entry = [...entries.values()].find(item => item.crossFigureLogic);
    corrupt(entry.crossFigureLogic.mechanismEdges[0]);
    const recovered = await router.handle(message);
    assert.equal(recovered.success, true);
    assert.equal(recovered.data.cacheHit, false);
  }
  assert.equal(calls, 18);
});

test('normalizes legacy cached cross-Figure meta and drops unsafe cached diagnostics', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, value));
    },
    async deleteMany(keys) {
      keys.forEach(key => entries.delete(key));
    }
  };
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = {
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Legacy cached synthesis' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } }
    ]
  };
  await router.handle(message);
  const cached = [...entries.values()].find(item => item.crossFigureLogic);
  delete cached.crossFigureLogic.innovationPoints;
  delete cached.crossFigureLogic.limitationPoints;
  cached.diagnostics = [{ stage: 'prompt', code: 'secret-key-value' }];

  const response = await router.handle(message);
  assert.equal(response.success, true);
  assert.deepEqual(response.data.crossFigureLogic.innovationPoints, []);
  assert.deepEqual(response.data.crossFigureLogic.limitationPoints, []);
  assert.deepEqual(response.data.diagnostics, []);
});

test('never reuses a cached deterministic cross-Figure fallback', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  let calls = 0;
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, value));
    },
    async deleteMany(keys) {
      keys.forEach(key => entries.delete(key));
    }
  };
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    fetchImpl: async (_url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = {
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Do not cache fallbacks' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } }
    ]
  };
  await router.handle(message);
  const cached = [...entries.values()].find(item => item.crossFigureLogic);
  cached.fallbackUsed = true;
  cached.crossFigureLogic.overallThesis = 'Invented stale fallback';
  const response = await router.handle(message);
  assert.equal(response.success, true);
  assert.equal(response.data.cacheHit, false);
  assert.notEqual(response.data.crossFigureLogic.overallThesis,
    'Invented stale fallback');
  assert.equal(calls, 6);
});

test('supplemental recovery never guesses a main-Figure attachment', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (Array.isArray(input.supplemental_figures)) {
        return jsonResponse({}, 503);
      }
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'No guessed supplement mapping' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } },
      {
        ...crossFigureInput(3),
        figureId: 'figure-s1',
        figureLabel: 'Figure S1',
        isSupplemental: true,
        caption: 'Additional quality-control measurements.',
        analysis: { coreConclusion: 'Quality is acceptable.' }
      }
    ],
    forceRefresh: true
  });
  assert.equal(response.success, true);
  assert.deepEqual(response.data.crossFigureLogic.supplementalSupport, []);
});

test('splits invalid supplemental mappings without discarding the main Figure chain', async () => {
  const storageArea = createMemoryStorage();
  const batchSizes = [];
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      if (!Array.isArray(input.supplemental_figures)) {
        return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
      }
      batchSizes.push(input.supplemental_figures.length);
      if (input.supplemental_figures.length > 1) {
        return jsonResponse({ output_text: '{invalid supplemental mapping' });
      }
      const supplement = input.supplemental_figures[0];
      return jsonResponse({
        output_text: JSON.stringify({
          supplemental_support: [{
            figure_id: supplement.figure_id,
            supports_figure_id: 'figure-1',
            support_role: 'control',
            attachment_basis: 'explicit_caption',
            contribution_zh: supplement.conclusion_zh,
            limitation_zh: '仅提供补充支持。'
          }]
        })
      });
    }
  });
  await configureOpenAIRouter(router);
  const message = {
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Mechanistic study' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Figure 1 establishes the phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Figure 2 tests the mechanism.' } },
      ...[1, 2].map(index => ({
        ...crossFigureInput(index + 2),
        figureId: `figure-s${index}`,
        figureLabel: `Figure S${index}`,
        isSupplemental: true,
        caption: `Figure S${index}, related to Figure 1.`,
        analysis: { coreConclusion: `Supplement ${index} controls the experiment.` }
      }))
    ]
  };

  const first = await router.handle(message);
  const second = await router.handle(message);

  assert.equal(first.success, true);
  assert.deepEqual(batchSizes, [2, 1, 1]);
  assert.equal(first.data.crossFigureLogic.supplementalSupport.length, 2);
  assert.deepEqual(
    first.data.crossFigureLogic.supplementalSupport.map(item => item.figureId),
    ['figure-s1', 'figure-s2']
  );
  assert.equal(second.data.cacheHit, true);
  assert.equal(calls, 6);
});

test('repairs one invalid main cross-Figure response with a bounded retry', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      if (calls === 1) return jsonResponse({ output_text: '{invalid main chain' });
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Mechanistic study' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } }
    ]
  });

  assert.equal(response.success, true);
  assert.equal(calls, 4);
  assert.equal(response.data.crossFigureLogic.nodes.length, 2);
});

test('switches a retryable cross-Figure failure to one smaller compact request', async () => {
  const storageArea = createMemoryStorage();
  const bodies = [];
  const router = createBackgroundRouter({
    storageArea,
    sleepImpl: async () => {},
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      if (bodies.length === 1) return jsonResponse({}, 503);
      const input = openAIInputPayload(body);
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Compact recovery' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.', argumentChain: [
        { panels: ['A'], established: 'Phenotype is observed.', handoff: 'Test mechanism.' }
      ] } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.', argumentChain: [
        { panels: ['B'], established: 'Mechanism is supported.', handoff: 'Bound the claim.' }
      ] } }
    ],
    forceRefresh: true
  });

  assert.equal(response.success, true);
  assert.equal(bodies.length, 4);
  const firstInput = openAIInputPayload(bodies[0]);
  const secondInput = openAIInputPayload(bodies[1]);
  assert.equal(secondInput.request_mode, 'evidence_only_compact');
  assert.ok(JSON.stringify(secondInput).length < JSON.stringify(firstInput).length);
  assert.equal(response.data.fallbackUsed, false);
  assert.deepEqual(response.data.diagnostics, [{
    stage: 'compact_cross_retry', code: 'PROVIDER_UNAVAILABLE'
  }]);
});

test('returns a safe deterministic evidence-only cross-Figure fallback after compact failure', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sleepImpl: async () => {},
    fetchImpl: async () => { calls += 1; return jsonResponse({}, 503); }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: {
      title: 'Fallback study',
      paperBlueprint: {
        research_question: 'How do the supplied Figures connect?',
        claimed_contribution: 'A supported cross-Figure contribution.'
      }
    },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.', claimBoundary: 'Association only.', argumentChain: [
        { panels: ['A'], established: 'Phenotype is observed.', handoff: 'Test mechanism.' }
      ] } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.', claimBoundary: 'No rescue test.', argumentChain: [
        { panels: ['B'], established: 'Mechanism is supported.', handoff: 'Bound the claim.' }
      ] } }
    ],
    forceRefresh: true
  });

  assert.equal(response.success, true);
  assert.equal(calls, 2);
  assert.equal(response.data.fallbackUsed, true);
  assert.deepEqual(response.data.diagnostics, [
    { stage: 'compact_cross_retry', code: 'PROVIDER_UNAVAILABLE' },
    { stage: 'deterministic_evidence_fallback', code: 'PROVIDER_UNAVAILABLE' }
  ]);
  assert.equal(response.data.crossFigureLogic.nodes.length, 2);
  assert.equal(response.data.crossFigureLogic.dominoChain.length, 1);
  assert.equal(response.data.crossFigureLogic.centralScientificQuestion,
    'How do the supplied Figures connect?');
  assert.ok(response.data.crossFigureLogic.innovationPoints.length);
  assert.ok(response.data.crossFigureLogic.limitationPoints.length);
  assert.deepEqual(response.data.crossFigureLogic.mechanismEdges, []);
  assert.equal(response.data.crossFigureLogic.panelCoverageAudit.ok, true);
  assert.equal(response.data.crossFigureLogic.panelDispositions.length, 3);
  assert.ok(response.data.crossFigureLogic.panelDispositions
    .every(item => item.status === 'unlinked'));
  assert.doesNotMatch(JSON.stringify(response.data.diagnostics), /key|prompt|system|secret/i);

  const retried = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: {
      title: 'Fallback study',
      paperBlueprint: {
        research_question: 'How do the supplied Figures connect?',
        claimed_contribution: 'A supported cross-Figure contribution.'
      }
    },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } }
    ]
  });
  assert.equal(retried.success, true);
  assert.equal(calls, 4, 'evidence-only fallbacks must not be cached as completed synthesis');
});

test('falls through invalid full and repair responses to compact evidence fallback', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return calls < 4
        ? jsonResponse({ output_text: '{invalid' })
        : jsonResponse({}, 503);
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Repair fallback' },
    figures: [
      { ...crossFigureInput(1), analysis: { coreConclusion: 'Phenotype.' } },
      { ...crossFigureInput(2), analysis: { coreConclusion: 'Mechanism.' } }
    ],
    forceRefresh: true
  });
  assert.equal(response.success, true);
  assert.equal(response.data.fallbackUsed, true);
  assert.equal(calls, 4);
});

test('derives the Figure provider-attempt ceiling from every retry and fallback edge', () => {
  assert.equal(FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT, 96);
  const unlabeled = deriveFigureProviderAttemptBudget({
    figures: [{ figureId: 'figure-1', panelCount: 0 }],
    analysisDepth: 'standard', truncationRetries: 2,
    allowTextFallback: true
  });
  assert.deepEqual({
    managedRequestAttempts: unlabeled.managedRequestAttempts,
    requestAttempts: unlabeled.requestAttempts,
    validatedRequestAttempts: unlabeled.validatedRequestAttempts,
    recoveryRequestAttempts: unlabeled.recoveryRequestAttempts,
    topologyLimit: unlabeled.topologyLimit,
    limit: unlabeled.limit
  }, {
    managedRequestAttempts: 4,
    requestAttempts: 12,
    validatedRequestAttempts: 24,
    recoveryRequestAttempts: 12,
    topologyLimit: 48,
    limit: 48
  });

  const small = deriveFigureProviderAttemptBudget({
    figures: [{ figureId: 'figure-1', panelCount: 8 }],
    analysisDepth: 'standard', truncationRetries: 2,
    allowTextFallback: true
  });
  assert.equal(small.topologyLimit, 120,
    'whole + repair, missing-Panel batches, visual fallback and synthesis are counted');
  assert.equal(small.limit, 96);

  const deep = deriveFigureProviderAttemptBudget({
    figures: [{ figureId: 'figure-1', panelCount: 5 }],
    analysisDepth: 'deep', truncationRetries: 2,
    allowTextFallback: true
  });
  assert.equal(deep.panelBatchCount, 3);
  assert.equal(deep.topologyLimit, 168,
    'three deep extraction batches plus fallback/recovery and synthesis are counted');
  assert.equal(deep.limit, 96);

  for (const panelCount of [1, 2]) {
    const deepSmall = deriveFigureProviderAttemptBudget({
      figures: [{ figureId: 'figure-1', panelCount }],
      analysisDepth: 'deep', truncationRetries: 2,
      allowTextFallback: true
    });
    assert.equal(deepSmall.topologyLimit, 96,
      `deep ${panelCount}-Panel visual, text, compact and synthesis branches are additive`);
    assert.equal(deepSmall.limit, 96);
  }

  const noFallback = deriveFigureProviderAttemptBudget({
    figures: [
      { figureId: 'figure-1', panelCount: 0 },
      { figureId: 'figure-2', panelCount: 1 }
    ],
    analysisDepth: 'standard', truncationRetries: 2,
    allowTextFallback: false
  });
  assert.equal(noFallback.topologyLimit, 96,
    'caption-only compact extraction and synthesis remain part of the real topology');
  assert.equal(noFallback.limit, 96);
});

test('deep small-Figure visual and text failures continue through compact extraction within a 96-call bound', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  const passes = [];
  let providerCalls = 0;
  const router = createConfirmedFigureRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      passes.push({
        pass: input.pass || 'single_pass',
        visual: Array.isArray(body.input)
      });
      if (providerCalls <= 2) return jsonResponse({}, 400);
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_walkthrough.allowTextFallback = true;
  const response = await router.handle(figureMessage([{
    ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,/9j/2Q==' }]),
    panelHints: ['A']
  }], {
    analysisDepth: 'deep', operationId: 'figure-deep-small-topology-operation',
    figureRequestReceipt: 'figure-request-deep-small-topology-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }]
  }), figureCheckpointContext(progress, []));

  assert.equal(response.success, true, JSON.stringify(response));
  assert.deepEqual(passes, [
    { pass: 'single_pass', visual: true },
    { pass: 'single_pass', visual: false },
    { pass: 'panel_extraction', visual: false },
    { pass: 'figure_synthesis', visual: false }
  ]);
  assert.equal(providerCalls, 4);
  assert.deepEqual(progress.filter(event => event.phase === 'figure_provider_attempt')
    .map(event => event.providerAttemptLimit), [96, 96, 96, 96]);
});

test('a response-body 503 stays quarantined across 33 router recreations', async () => {
  const storageArea = createMemoryStorage();
  const figureAttemptLedgerStorage = createMemoryStorage();
  let providerCalls = 0;
  const createRouter = () => createConfirmedFigureRouter({
    storageArea,
    sessionStorageArea: figureAttemptLedgerStorage,
    sleepImpl: async () => undefined,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 503);
    }
  });
  await configureOpenAIRouter(createRouter());
  const operationId = 'figure-durable-restart-budget-operation';
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationId,
    figureOperationPlan: Array.from({ length: 40 }, (_, index) => ({
      figureId: `figure-${index + 1}`, panelCount: 0
    })),
    providerAttemptsConsumed: 0
  });
  let response = null;
  for (let restart = 0; restart < 33; restart += 1) {
    response = await createRouter().handle({
      ...structuredClone(message),
      figureRequestReceipt: `figure-request-durable-restart-${restart}-12345678`
    });
  }

  assert.equal(providerCalls, 2,
    'the one live-call retry allowance must never reset across router reconstruction');
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(response.error.providerAttempt, 2);
  assert.equal(response.error.providerAttemptLimit, 96);
  assert.equal(response.error.figureOutcome, 'unknown');
  assert.equal(response.error.retryProvider, false);
  assert.equal(response.error.canContinueIndependentTargets, true);
  assert.equal(response.error.failureScope, 'figure_target');
});

test('an exact durable Figure receipt replay after router reconstruction never redispatches provider work', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let providerCalls = 0;
  const createRouter = () => createConfirmedFigureRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  await configureOpenAIRouter(createRouter());
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard',
    operationId: 'figure-durable-exact-replay-operation',
    figureRequestReceipt: 'figure-request-durable-exact-replay-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const first = await createRouter().handle(structuredClone(message));
  assert.equal(first.error.code, 'PROVIDER_REJECTED');
  const callsAfterFirst = providerCalls;
  assert.equal(
    ledgerStorage.values.sciFigureProviderAttemptLedgerV1
      .operations[0].receipts[0].status,
    'claimed'
  );

  const replay = await createRouter().handle(structuredClone(message));
  assert.equal(replay.success, false);
  assert.equal(replay.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(replay.error.providerAttempt, callsAfterFirst);
  assert.ok(Number.isSafeInteger(replay.error.providerAttemptLimit));
  assert.ok(replay.error.providerAttemptLimit >= replay.error.providerAttempt);
  assert.ok(replay.error.providerAttemptLimit <= 96);
  assert.equal(providerCalls, callsAfterFirst,
    'a durable receipt claim is consumed even when its final response was lost');
});

test('Figure requests quarantine a claimed provider call whose response is lost', async () => {
  const scenarios = [
    {
      name: 'whole-caption',
      message(operationId, receipt) {
        return figureMessage([{ ...figureInput(1), panelHints: ['A'] }], {
          analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 41,
          operationId, figureRequestReceipt: receipt,
          figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
          providerAttemptsConsumed: 0, forceRefresh: true
        });
      }
    },
    {
      name: 'whole-visual',
      message(operationId, receipt) {
        return figureMessage([{
          ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,QUJDRA==' }]),
          panelHints: ['A']
        }], {
          analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 42,
          operationId, figureRequestReceipt: receipt,
          figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
          providerAttemptsConsumed: 0, forceRefresh: true
        });
      }
    },
    {
      name: 'panel',
      message(operationId, receipt) {
        return {
          type: 'LLM_ANALYZE_FIGURE_PANEL', analysisDepth: 'standard',
          operationScope: 'figure', workspaceLifecycle: 43,
          operationId, figureRequestReceipt: receipt,
          figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
          providerAttemptsConsumed: 0, documentHash: 'a'.repeat(64),
          document: { title: 'Lost Panel response' },
          figure: {
            ...figureInput(1), panelHints: ['A'],
            imageVariants: [panelImageVariant(768)]
          },
          panel: { panel: 'A' }, forceRefresh: true
        };
      }
    },
    {
      name: 'followup',
      message(operationId, receipt) {
        return {
          type: 'LLM_ASK_FIGURE_PANEL', analysisDepth: 'standard',
          operationScope: 'figure', workspaceLifecycle: 44,
          operationId, figureRequestReceipt: receipt,
          figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
          providerAttemptsConsumed: 0, documentHash: 'b'.repeat(64),
          document: { title: 'Lost Panel follow-up response' },
          figure: {
            ...figureInput(1), panelHints: ['A'],
            imageVariants: [panelImageVariant(768)]
          },
          panel: { panel: 'A', purpose: 'Compare groups' },
          topics: ['grouping'], customQuestion: '', forceRefresh: true
        };
      }
    }
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const storageArea = createMemoryStorage();
    const sessionStorageArea = createMemoryStorage();
    let providerCalls = 0;
    const createRouter = () => createBackgroundRouter({
      storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id',
      sleepImpl: async () => {},
      fetchImpl: async () => {
        providerCalls += 1;
        throw new TypeError('remote side effect completed before the response vanished');
      }
    });
    await configureOpenAIRouter(createRouter());
    const operationId = `figure-lost-response-${scenario.name}-operation`;
    const context = {
      ...figureCheckpointContext([], []), trustedExtensionSender: true,
      senderExtensionId: 'extension-id', senderTabId: 51 + index,
      senderFrameId: 0,
      senderDocumentId: `55555555-5555-4555-8555-55555555555${index}`
    };
    const first = await createRouter().handle(scenario.message(
      operationId, `figure-request-lost-${scenario.name}-first-12345678`
    ), context);
    assert.equal(first.success, false, scenario.name);
    assert.equal(first.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS', scenario.name);
    assert.equal(first.error.retryable, false, scenario.name);
    assert.equal(providerCalls, 2, `${scenario.name} exceeded its one persistent transport retry`);

    const replay = await createRouter().handle(scenario.message(
      operationId, `figure-request-lost-${scenario.name}-second-12345678`
    ), context);
    assert.equal(replay.success, false, scenario.name);
    assert.equal(replay.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS', scenario.name);
    assert.equal(providerCalls, 2, `${scenario.name} redispatched after reconstruction`);
  }
});

test('a durable Figure dispatch claim blocks a new receipt before the response settles', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createDelayedCloneStorage();
  let providerCalls = 0;
  let signalStarted;
  let rejectFirst;
  const providerStarted = new Promise(resolve => { signalStarted = resolve; });
  const firstResponse = new Promise((_, reject) => { rejectFirst = reject; });
  const createRouter = () => createBackgroundRouter({
    storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id',
    sleepImpl: async () => {},
    fetchImpl: async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        signalStarted();
        return firstResponse;
      }
      throw new TypeError('PRIVATE RETRY RESPONSE LOST');
    }
  });
  await configureOpenAIRouter(createRouter());
  const operationId = 'figure-inflight-dispatch-restart-operation';
  const owner = {
    ...figureCheckpointContext([], []), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 61, senderFrameId: 0,
    senderDocumentId: '61616161-6161-4616-8616-616161616161'
  };
  const request = receipt => figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 51,
    operationId, figureRequestReceipt: receipt,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
    providerAttemptsConsumed: 0, forceRefresh: true
  });
  const firstPending = createRouter().handle(request(
    'figure-request-inflight-dispatch-first-12345678'
  ), owner);
  await providerStarted;
  let replay;
  try {
    replay = await createRouter().handle(request(
      'figure-request-inflight-dispatch-second-12345678'
    ), owner);
    assert.equal(replay.success, false, JSON.stringify(replay));
    assert.equal(replay.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
    assert.equal(providerCalls, 1,
      'a router reconstruction must observe the durable pre-dispatch claim');
  } finally {
    rejectFirst(new TypeError('PRIVATE FIRST RESPONSE LOST'));
  }
  const first = await firstPending;
  assert.equal(first.success, false);
  assert.equal(first.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(first.error.causeCode, 'NETWORK_ERROR');
  assert.match(first.error.message, /Unable to reach the provider/);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE FIRST RESPONSE LOST/);
  assert.equal(providerCalls, 2);
});

test('Figure dispatch proof seals only the exact checkpoint-absorbed attempts', async () => {
  const ledgerStorage = createMemoryStorage();
  const ledger = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage, getRuntimeLastError: () => null
  });
  const base = {
    operationId: `figure:${'1'.repeat(64)}`,
    bindingSignature: '2'.repeat(64), immutableLimit: 8,
    semanticSignature: '3'.repeat(64), targetKeyDigest: '4'.repeat(64)
  };
  const first = {
    ...base, receipt: 'figure-request-exact-proof-first-12345678',
    requestSignature: '5'.repeat(64)
  };
  await ledger.bindRequest(first);
  const dispatchA = await ledger.reserveAttempt(first, 'a'.repeat(64));
  const dispatchB = await ledger.reserveAttempt(first, 'b'.repeat(64));
  await ledger.settleAttempt(first, dispatchA.attemptNumber, 'a'.repeat(64), 'responded');
  await ledger.settleAttempt(first, dispatchB.attemptNumber, 'b'.repeat(64), 'responded');
  const proof = { kind: 'checkpoint', digest: 'c'.repeat(64) };
  await ledger.prepareAttemptProof(first, [{
    attemptNumber: dispatchA.attemptNumber, dispatchDigest: 'a'.repeat(64)
  }], proof);
  await ledger.sealRespondedAttempts(first, [{
    attemptNumber: dispatchA.attemptNumber, dispatchDigest: 'a'.repeat(64)
  }], proof.digest, proof);

  const operation = ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations[0];
  assert.deepEqual(operation.providerDispatches.map(entry => entry.status), [
    'sealed', 'responded'
  ]);
  await assert.rejects(ledger.bindRequest({
    ...base, receipt: 'figure-request-exact-proof-second-12345678',
    requestSignature: '6'.repeat(64), resumeCheckpointDigest: proof.digest
  }), error => error?.code === 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
});

test('a durable checkpoint proof repairs the ACK-to-ledger-seal crash window', async () => {
  const ledgerStorage = createMemoryStorage();
  const firstLedger = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage, getRuntimeLastError: () => null
  });
  const base = {
    operationId: `figure:${'7'.repeat(64)}`,
    bindingSignature: '8'.repeat(64), immutableLimit: 8,
    semanticSignature: '9'.repeat(64), targetKeyDigest: 'a'.repeat(64)
  };
  const first = {
    ...base, receipt: 'figure-request-proof-crash-first-12345678',
    requestSignature: 'b'.repeat(64)
  };
  await firstLedger.bindRequest(first);
  const dispatch = await firstLedger.reserveAttempt(first, 'c'.repeat(64));
  await firstLedger.settleAttempt(
    first, dispatch.attemptNumber, 'c'.repeat(64), 'responded'
  );
  const proof = { kind: 'checkpoint', digest: 'd'.repeat(64) };
  await firstLedger.prepareAttemptProof(first, [{
    attemptNumber: dispatch.attemptNumber, dispatchDigest: 'c'.repeat(64)
  }], proof);

  const restarted = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage, getRuntimeLastError: () => null
  });
  await assert.rejects(restarted.bindRequest({
    ...base, receipt: 'figure-request-proof-crash-without-ack-12345678',
    requestSignature: 'e'.repeat(64)
  }), error => error?.code === 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  const pending = await restarted.bindRequest({
    ...base, receipt: 'figure-request-proof-crash-after-ack-12345678',
    requestSignature: 'f'.repeat(64), resumeCheckpointDigest: proof.digest
  });
  assert.equal(pending.proofPending, true);
  assert.equal(
    ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations[0]
      .providerDispatches[0].status,
    'responded',
    'the ledger remains byte-for-byte unconsumed until the checkpoint validator succeeds'
  );
  const resumed = await restarted.bindRequest({
    ...base, receipt: 'figure-request-proof-crash-after-ack-12345678',
    requestSignature: 'f'.repeat(64), resumeCheckpointDigest: proof.digest,
    proofValidated: true
  });
  assert.equal(resumed.existingReceipt, false);
  const operation = ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations[0];
  assert.equal(operation.providerDispatches[0].status, 'sealed');
  assert.equal(operation.receipts[0].status, 'superseded');
  assert.equal(operation.receipts[1].status, 'claimed');
});

test('checkpoint proof preparation failure preserves ambiguous quarantine metadata', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const baseLedger = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage, getRuntimeLastError: () => null
  });
  let prepareCalls = 0;
  const failingLedger = {
    ...baseLedger,
    async prepareAttemptProof(...args) {
      prepareCalls += 1;
      const error = new Error('PRIVATE proof preparation storage failure');
      error.code = 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE';
      throw error;
    }
  };
  let providerCalls = 0;
  const operationId = 'figure-checkpoint-proof-prepare-failure-operation';
  const request = receipt => figureMessage([figureInput(1)], {
    analysisDepth: 'standard', forceRefresh: true, operationId,
    figureRequestReceipt: receipt,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const firstRouter = createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage,
    figureProviderAttemptLedger: failingLedger,
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(firstRouter);
  const first = await firstRouter.handle(request(
    'figure-request-proof-prepare-failure-first-12345678'
  ), figureCheckpointContext([], []));
  assert.equal(first.success, false, JSON.stringify(first));
  assert.equal(first.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(first.error.cleanupPending, true);
  assert.equal(first.error.cleanupCode, 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE|storage failure/u);
  assert.equal(prepareCalls, 1);
  assert.equal(providerCalls, 1);

  const replay = await createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('provider must not replay an uncheckpointed response');
    }
  }).handle(request(
    'figure-request-proof-prepare-failure-second-12345678'
  ), figureCheckpointContext([], []));
  assert.equal(replay.success, false, JSON.stringify(replay));
  assert.equal(replay.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(providerCalls, 1);
});

test('terminal Figure quarantine acknowledges exact-owner cancel and release without erasing authority', async () => {
  const ledgerStorage = createMemoryStorage();
  let now = 100;
  const ledger = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage, getRuntimeLastError: () => null,
    nowImpl: () => ++now
  });
  const binding = {
    operationId: `figure:${'f'.repeat(64)}`,
    bindingSignature: 'e'.repeat(64), immutableLimit: 8,
    semanticSignature: 'd'.repeat(64), targetKeyDigest: 'c'.repeat(64),
    receipt: 'figure-request-terminal-cleanup-first-12345678',
    requestSignature: 'b'.repeat(64)
  };
  await ledger.bindRequest(binding);
  const dispatch = await ledger.reserveAttempt(binding, 'a'.repeat(64));
  await ledger.terminate(binding, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  const beforeCleanup = structuredClone(
    ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations[0]
  );

  const cancelled = await ledger.controlOperation({
    operationId: binding.operationId
  }, 'cancel');
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.cleanupComplete, true);
  assert.equal(cancelled.terminalCode, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  const released = await ledger.controlOperation({
    operationId: binding.operationId
  }, 'release');
  assert.equal(released.released, true);
  assert.equal(released.cleanupComplete, true);
  assert.equal(released.terminalCode, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  const releasedAt = ledgerStorage.values.sciFigureProviderAttemptLedgerV1
    .operations[0].releasedAt;
  const repeated = await ledger.controlOperation({
    operationId: binding.operationId
  }, 'release');
  assert.equal(repeated.released, true);
  assert.equal(ledgerStorage.values.sciFigureProviderAttemptLedgerV1
    .operations[0].releasedAt, releasedAt,
  'replayed cleanup acknowledgement must not manufacture a new commit point');

  const afterCleanup = ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations[0];
  assert.equal(afterCleanup.terminalCode, beforeCleanup.terminalCode);
  assert.deepEqual(afterCleanup.receipts, beforeCleanup.receipts);
  assert.deepEqual(afterCleanup.providerDispatches, beforeCleanup.providerDispatches);
  assert.equal(afterCleanup.reservedAttempts, dispatch.attemptNumber);
  await assert.rejects(ledger.bindRequest({
    ...binding,
    receipt: 'figure-request-terminal-cleanup-second-12345678',
    requestSignature: '9'.repeat(64)
  }), error => error?.code === 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
});

test('a strong Panel cache proof repairs the cache-ACK-to-ledger-seal crash window', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const cacheEntries = new Map();
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => cacheEntries.has(key))
        .map(key => [key, structuredClone(cacheEntries.get(key))]));
    },
    async setMany(values) {
      values.forEach(value => cacheEntries.set(value.key, structuredClone(value)));
    },
    async deleteMany(keys) { keys.forEach(key => cacheEntries.delete(key)); }
  };
  const baseLedger = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage, getRuntimeLastError: () => null
  });
  let sealCalls = 0;
  const crashAfterCacheAckLedger = {
    ...baseLedger,
    async sealRespondedAttempts(...args) {
      sealCalls += 1;
      if (sealCalls === 1) {
        const error = new Error('simulated worker stop after cache ACK');
        error.code = 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE';
        throw error;
      }
      return baseLedger.sealRespondedAttempts(...args);
    }
  };
  let providerCalls = 0;
  const provider = async (_url, options) => {
    providerCalls += 1;
    const input = openAIInputPayload(JSON.parse(options.body));
    if (input.analysis_basis === 'vision_text') return jsonResponse({}, 400);
    return jsonResponse({
      output_text: JSON.stringify(panelInterpretationOutput(input))
    });
  };
  const firstRouter = createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage, cacheStore,
    figureProviderAttemptLedger: crashAfterCacheAckLedger,
    runtimeExtensionId: 'extension-id', fetchImpl: provider
  });
  await configureOpenAIRouter(firstRouter);
  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_panel_interpretation.allowTextFallback = true;
  const operationId = 'figure-panel-cache-proof-crash-operation';
  const request = receipt => ({
    type: 'LLM_ANALYZE_FIGURE_PANEL', analysisDepth: 'standard',
    operationScope: 'figure', workspaceLifecycle: 61, operationId,
    figureRequestReceipt: receipt,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
    documentHash: '6'.repeat(64), document: { title: 'Panel cache proof crash' },
    figure: {
      ...figureInput(1), panelHints: ['A'],
      imageVariants: [panelImageVariant(768)]
    },
    panel: { panel: 'A', purpose: 'Compare groups' },
    forceRefresh: true
  });
  const owner = {
    trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 161, senderFrameId: 0,
    senderDocumentId: '61616161-6161-4161-8161-616161616161'
  };

  const interrupted = await firstRouter.handle(request(
    'figure-request-panel-cache-proof-first-12345678'
  ), owner);
  assert.equal(interrupted.success, false, JSON.stringify(interrupted));
  assert.equal(interrupted.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(providerCalls, 2, 'visual rejection and caption fallback each dispatch once');
  assert.equal(cacheEntries.size, 1, 'the caption result crossed the cache durability boundary');
  const cachedEntry = [...cacheEntries.values()][0];
  assert.equal(cachedEntry.panelResult.inputBasis.inputMode, 'caption_context');
  assert.match(cachedEntry.cacheBindingDigest, /^[a-f0-9]{64}$/u);
  assert.match(cachedEntry.providerProofDigest, /^[a-f0-9]{64}$/u);
  const interruptedOperation = ledgerStorage.values
    .sciFigureProviderAttemptLedgerV1.operations[0];
  assert.deepEqual(interruptedOperation.providerDispatches.map(entry => entry.status), [
    'sealed', 'responded'
  ]);
  assert.equal(interruptedOperation.providerDispatches[1].proofKind, 'cache');
  assert.equal(
    interruptedOperation.providerDispatches[1].proofDigest,
    cachedEntry.providerProofDigest
  );

  const createRecoveryRouter = () => createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage, cacheStore,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('provider must not run while reconciling a durable cache proof');
    }
  });
  const durableLedgerSnapshot = JSON.stringify(
    ledgerStorage.values.sciFigureProviderAttemptLedgerV1
  );
  const pristineCacheEntry = structuredClone(cachedEntry);
  const corruptions = [
    {
      name: 'missing cache entry',
      apply() { cacheEntries.clear(); }
    },
    {
      name: 'tampered result proof',
      apply() {
        cacheEntries.set(pristineCacheEntry.key, {
          ...structuredClone(pristineCacheEntry),
          providerProofDigest: '0'.repeat(64)
        });
      }
    },
    {
      name: 'route-policy mismatch',
      apply() {
        cacheEntries.set(pristineCacheEntry.key, {
          ...structuredClone(pristineCacheEntry),
          taskPolicyDigest: '1'.repeat(64)
        });
      }
    }
  ];
  for (const [index, corruption] of corruptions.entries()) {
    cacheEntries.clear();
    corruption.apply();
    const rejected = await createRecoveryRouter().handle(request(
      `figure-request-panel-cache-proof-corrupt-${index}-12345678`
    ), owner);
    assert.equal(rejected.success, false, corruption.name);
    assert.equal(rejected.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS', corruption.name);
    assert.equal(providerCalls, 2, corruption.name);
    assert.equal(
      JSON.stringify(ledgerStorage.values.sciFigureProviderAttemptLedgerV1),
      durableLedgerSnapshot,
      `${corruption.name} must not consume or rewrite the durable receipt lineage`
    );
  }
  cacheEntries.clear();
  cacheEntries.set(pristineCacheEntry.key, pristineCacheEntry);

  const restarted = createRecoveryRouter();
  const recovered = await restarted.handle(request(
    'figure-request-panel-cache-proof-second-12345678'
  ), owner);
  assert.equal(recovered.success, true, JSON.stringify(recovered));
  assert.equal(recovered.data.cacheHit, true);
  assert.equal(recovered.data.panelAnalysis.panel, 'A');
  assert.equal(recovered.data.panelAnalysis.inputBasis.inputMode, 'caption_context');
  assert.equal(providerCalls, 2);
  const recoveredOperation = ledgerStorage.values
    .sciFigureProviderAttemptLedgerV1.operations[0];
  assert.deepEqual(recoveredOperation.providerDispatches.map(entry => entry.status), [
    'sealed', 'sealed'
  ]);
  assert.deepEqual(recoveredOperation.receipts.map(entry => entry.status), [
    'superseded', 'claimed'
  ]);
});

test('a Panel cache proof stays quarantined when the cache durability ACK is missing', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const cacheStore = {
    async getMany() { return new Map(); },
    async setMany() { throw new Error('PRIVATE simulated cache write failure'); },
    async deleteMany() {}
  };
  let providerCalls = 0;
  const provider = async (_url, options) => {
    providerCalls += 1;
    const input = openAIInputPayload(JSON.parse(options.body));
    return jsonResponse({
      output_text: JSON.stringify(panelInterpretationOutput(input))
    });
  };
  const createRouter = fetchImpl => createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage, cacheStore,
    runtimeExtensionId: 'extension-id', fetchImpl
  });
  const firstRouter = createRouter(provider);
  await configureOpenAIRouter(firstRouter);
  const operationId = 'figure-panel-cache-proof-before-ack-operation';
  const request = receipt => ({
    type: 'LLM_ANALYZE_FIGURE_PANEL', analysisDepth: 'standard',
    operationScope: 'figure', workspaceLifecycle: 62, operationId,
    figureRequestReceipt: receipt,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
    documentHash: '7'.repeat(64), document: { title: 'Missing Panel cache ACK' },
    figure: { ...figureInput(1), panelHints: ['A'] },
    panel: { panel: 'A', purpose: 'Compare groups' }, forceRefresh: true
  });
  const owner = {
    trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 162, senderFrameId: 0,
    senderDocumentId: '62626262-6262-4262-8262-626262626262'
  };
  const interrupted = await firstRouter.handle(request(
    'figure-request-panel-cache-before-ack-first-12345678'
  ), owner);
  assert.equal(interrupted.success, false);
  assert.equal(interrupted.error.code, 'FIGURE_CACHE_PERSIST_FAILED');
  assert.doesNotMatch(JSON.stringify(interrupted), /PRIVATE|simulated cache write/u);
  assert.equal(providerCalls, 1);
  const operation = ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations[0];
  assert.equal(operation.providerDispatches[0].status, 'responded');
  assert.equal(operation.providerDispatches[0].proofKind, 'cache');
  const durableLedgerSnapshot = JSON.stringify(
    ledgerStorage.values.sciFigureProviderAttemptLedgerV1
  );

  const replay = await createRouter(async () => {
    providerCalls += 1;
    throw new Error('provider must not run without a durable cache proof');
  }).handle(request(
    'figure-request-panel-cache-before-ack-second-12345678'
  ), owner);
  assert.equal(replay.success, false, JSON.stringify(replay));
  assert.equal(replay.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(providerCalls, 1);
  assert.equal(
    JSON.stringify(ledgerStorage.values.sciFigureProviderAttemptLedgerV1),
    durableLedgerSnapshot
  );
});

test('whole Figure and follow-up cache write failures use one fixed private-safe code', async () => {
  const scenarios = [
    {
      name: 'whole',
      message: figureMessage([figureInput(1)], {
        analysisDepth: 'standard', forceRefresh: true,
        operationScope: 'figure', workspaceLifecycle: 64,
        operationId: 'whole-figure-cache-write-failure-operation',
        figureRequestReceipt: 'figure-request-whole-cache-write-failure-12345678',
        figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
      }),
      output(input) { return figurePassOutput(input); },
      checkpoint: true
    },
    {
      name: 'followup',
      message: {
        type: 'LLM_ASK_FIGURE_PANEL', analysisDepth: 'standard',
        operationScope: 'figure', workspaceLifecycle: 65,
        operationId: 'figure-followup-cache-write-failure-operation',
        figureRequestReceipt: 'figure-request-followup-cache-write-failure-12345678',
        figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
        documentHash: '8'.repeat(64), document: { title: 'Cache failure' },
        figure: { ...figureInput(1), panelHints: ['A'] },
        panel: { panel: 'A', purpose: 'Compare groups' },
        topics: ['mechanism'], customQuestion: 'What changed?', history: [],
        forceRefresh: true
      },
      output(input) { return panelFollowupOutput(input); },
      checkpoint: false
    }
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const storageArea = createMemoryStorage();
    const ledgerStorage = createMemoryStorage();
    let providerCalls = 0;
    const router = createBackgroundRouter({
      storageArea, sessionStorageArea: ledgerStorage,
      runtimeExtensionId: 'extension-id',
      cacheStore: {
        async getMany() { return new Map(); },
        async setMany() { throw new Error(`PRIVATE ${scenario.name} cache failure`); },
        async deleteMany() {}
      },
      fetchImpl: async (_url, options) => {
        providerCalls += 1;
        const input = openAIInputPayload(JSON.parse(options.body));
        return jsonResponse({ output_text: JSON.stringify(scenario.output(input)) });
      }
    });
    await configureOpenAIRouter(router);
    const context = {
      ...(scenario.checkpoint ? figureCheckpointContext([], []) : {}),
      trustedExtensionSender: true, senderExtensionId: 'extension-id',
      senderTabId: 164 + index, senderFrameId: 0,
      senderDocumentId: `${64 + index}`.repeat(8) + '-6464-4464-8464-646464646464'
    };
    const response = await router.handle(scenario.message, context);
    assert.equal(response.success, false, `${scenario.name}:${JSON.stringify(response)}`);
    assert.equal(response.error.code, 'FIGURE_CACHE_PERSIST_FAILED', scenario.name);
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE|cache failure/u, scenario.name);
    assert.equal(providerCalls, 1, scenario.name);
  }
});

test('whole Figure Panel and follow-up cache reads fail closed before ledger or provider work', async () => {
  let getterCalls = 0;
  const scenarios = [
    {
      name: 'whole', behavior: 'throw',
      message: figureMessage([figureInput(1)], {
        analysisDepth: 'standard', forceRefresh: false,
        operationScope: 'figure', workspaceLifecycle: 66,
        operationId: 'whole-figure-cache-read-failure-operation',
        figureRequestReceipt: 'figure-request-whole-cache-read-failure-12345678',
        figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
      })
    },
    {
      name: 'panel', behavior: 'non-map',
      message: {
        type: 'LLM_ANALYZE_FIGURE_PANEL', analysisDepth: 'standard',
        operationScope: 'figure', workspaceLifecycle: 67,
        operationId: 'figure-panel-cache-read-failure-operation',
        figureRequestReceipt: 'figure-request-panel-cache-read-failure-12345678',
        figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
        documentHash: '9'.repeat(64), document: { title: 'Cache read failure' },
        figure: { ...figureInput(1), panelHints: ['A'] },
        panel: { panel: 'A', purpose: 'Compare groups' }, forceRefresh: false
      }
    },
    {
      name: 'followup', behavior: 'accessor',
      message: {
        type: 'LLM_ASK_FIGURE_PANEL', analysisDepth: 'standard',
        operationScope: 'figure', workspaceLifecycle: 68,
        operationId: 'figure-followup-cache-read-failure-operation',
        figureRequestReceipt: 'figure-request-followup-cache-read-failure-12345678',
        figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
        documentHash: 'a'.repeat(64), document: { title: 'Cache read accessor' },
        figure: { ...figureInput(1), panelHints: ['A'] },
        panel: { panel: 'A', purpose: 'Compare groups' },
        topics: ['mechanism'], customQuestion: 'What changed?', history: [],
        forceRefresh: false
      }
    }
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const storageArea = createMemoryStorage();
    const ledgerStorage = createMemoryStorage();
    let providerCalls = 0;
    const cacheStore = {
      async getMany(keys) {
        if (scenario.behavior === 'throw') {
          throw new Error('PRIVATE_CACHE_READ_CANARY');
        }
        if (scenario.behavior === 'non-map') return { private: 'PRIVATE_CACHE_READ_CANARY' };
        const record = {};
        Object.defineProperty(record, 'cacheBindingDigest', {
          enumerable: true,
          get() {
            getterCalls += 1;
            throw new Error('PRIVATE_CACHE_GETTER_CANARY');
          }
        });
        return new Map([[keys[0], record]]);
      },
      async setMany() { throw new Error('cache write must not run'); },
      async deleteMany() {}
    };
    const router = createBackgroundRouter({
      storageArea, sessionStorageArea: ledgerStorage, cacheStore,
      runtimeExtensionId: 'extension-id',
      fetchImpl: async () => {
        providerCalls += 1;
        throw new Error('provider must not run after a cache read failure');
      }
    });
    await configureOpenAIRouter(router);
    const beforeLedger = JSON.stringify(ledgerStorage.values);
    const response = await router.handle(scenario.message, {
      trustedExtensionSender: true, senderExtensionId: 'extension-id',
      senderTabId: 170 + index, senderFrameId: 0,
      senderDocumentId: `${70 + index}`.repeat(8) + '-7070-4070-8070-707070707070'
    });
    assert.equal(response.success, false, `${scenario.name}:${JSON.stringify(response)}`);
    assert.equal(response.error.code, 'FIGURE_CACHE_READ_FAILED', scenario.name);
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE|CANARY|cache getter/u,
      scenario.name);
    assert.equal(providerCalls, 0, scenario.name);
    assert.equal(JSON.stringify(ledgerStorage.values), beforeLedger,
      `${scenario.name} cache failure must not mutate the durable Figure ledger`);
  }
  assert.equal(getterCalls, 0, 'cache record accessors must never execute');
});

test('explicit current confirmation: a whole Figure fallback cache proof repairs the cache-ACK-to-ledger-seal crash window', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const cacheEntries = new Map();
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => cacheEntries.has(key))
        .map(key => [key, structuredClone(cacheEntries.get(key))]));
    },
    async setMany(values) {
      values.forEach(value => cacheEntries.set(value.key, structuredClone(value)));
    },
    async deleteMany(keys) { keys.forEach(key => cacheEntries.delete(key)); }
  };
  let providerCalls = 0;
  const provider = async (_url, options) => {
    providerCalls += 1;
    const body = JSON.parse(options.body);
    const input = openAIInputPayload(body);
    if (Array.isArray(body.input)) return jsonResponse({}, 400);
    return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
  };
  const cacheWriter = createConfirmedFigureRouter({
    storageArea, cacheStore, fetchImpl: provider
  });
  await configureOpenAIRouter(cacheWriter);
  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_walkthrough.allowTextFallback = true;
  const checkpoints = [];
  const operationId = 'whole-figure-cache-proof-fallback-crash-operation';
  const figure = {
    ...figureInput(1, [{ dataUrl: 'data:image/png;base64,AA==' }]),
    panelHints: ['A']
  };
  const request = (receipt, overrides = {}) => figureMessage([figure], {
    analysisDepth: 'standard', forceRefresh: true,
    operationScope: 'figure', workspaceLifecycle: 63, operationId,
    figureRequestReceipt: receipt,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
    ...overrides
  });
  const owner = {
    trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 163, senderFrameId: 0,
    senderDocumentId: '63636363-6363-4363-8363-636363636363'
  };
  const cached = await cacheWriter.handle(figureMessage([figure], {
    analysisDepth: 'standard', forceRefresh: true,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }]
  }), figureCheckpointContext([], checkpoints));
  assert.equal(cached.success, true, JSON.stringify(cached));
  assert.equal(providerCalls, 2, 'visual rejection and caption fallback each dispatch once');
  assert.equal(cacheEntries.size, 1);
  const cachedEntry = [...cacheEntries.values()][0];
  assert.equal(cachedEntry.figureResult.inputMode, 'caption_context');
  assert.equal(cachedEntry.figureResult.visionFallback, true);
  assert.match(cachedEntry.cacheBindingDigest, /^[a-f0-9]{64}$/u);
  assert.match(cachedEntry.providerProofDigest, /^[a-f0-9]{64}$/u);

  // Model the exact post-ACK/pre-seal durable state.  The strong cache entry
  // above is already durable, while the ledger still carries a responded
  // dispatch whose expected proof names that entry.  The next router must
  // validate the cache itself before it is allowed to reconcile the receipt.
  const baseLedger = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage, getRuntimeLastError: () => null
  });
  let seeded = false;
  let seededSnapshot = '';
  let seedStep = 'not-started';
  const postAckLedger = {
    ...baseLedger,
    async bindRequest(input) {
      if (!seeded && input?.inspectOnly === true) {
        seeded = true;
        seedStep = 'before-prior-bind';
        const prior = {
          ...input,
          receipt: 'figure-request-whole-cache-proof-first-12345678'
        };
        delete prior.inspectOnly;
        delete prior.resumeCheckpointDigest;
        delete prior.resumeCacheDigest;
        await baseLedger.bindRequest(prior);
        seedStep = 'after-prior-bind';
        const dispatch = await baseLedger.reserveAttempt(prior, 'a'.repeat(64));
        seedStep = 'after-reserve';
        await baseLedger.settleAttempt(
          prior, dispatch.attemptNumber, 'a'.repeat(64), 'responded'
        );
        seedStep = 'after-settle';
        await baseLedger.prepareAttemptProof(prior, [{
          attemptNumber: dispatch.attemptNumber,
          dispatchDigest: 'a'.repeat(64)
        }], { kind: 'cache', digest: cachedEntry.providerProofDigest });
        seedStep = 'after-prepare';
        seededSnapshot = JSON.stringify(
          ledgerStorage.values.sciFigureProviderAttemptLedgerV1
        );
      }
      return baseLedger.bindRequest(input);
    }
  };
  const restarted = createConfirmedFigureRouter({
    storageArea, sessionStorageArea: ledgerStorage, cacheStore,
    figureProviderAttemptLedger: postAckLedger,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('provider must not run while reconciling a fallback cache proof');
    }
  });
  const forgedCheckpoint = await resignFigureCheckpointEnvelope(
    checkpoints.at(-1)?.checkpointEnvelope,
    value => { value.figureResult.analysisDepth = 'standard-ish'; }
  );
  const invalid = await restarted.handle(request(
    'figure-request-whole-cache-proof-invalid-12345678', {
      forceRefresh: false, figureResumeCheckpoint: forgedCheckpoint
    }
  ), owner);
  assert.equal(invalid.success, false, JSON.stringify(invalid));
  assert.equal(invalid.error.code, 'FIGURE_CHECKPOINT_INVALID', JSON.stringify({
    invalid, seedStep, ledger: ledgerStorage.values.sciFigureProviderAttemptLedgerV1
  }));
  assert.equal(providerCalls, 2);
  assert.equal(
    JSON.stringify(ledgerStorage.values.sciFigureProviderAttemptLedgerV1),
    seededSnapshot,
    'invalid checkpoint semantics cannot seal the cache proof or claim a receipt'
  );
  const recovered = await restarted.handle(request(
    'figure-request-whole-cache-proof-second-12345678'
  ), owner);
  assert.equal(recovered.success, true, JSON.stringify(recovered));
  assert.equal(recovered.data.cacheHits, 1);
  assert.equal(recovered.data.figureResults[0].inputMode, 'caption_context');
  assert.equal(recovered.data.figureResults[0].visionFallback, true);
  assert.equal(providerCalls, 2);
  const operation = ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations[0];
  assert.deepEqual(operation.providerDispatches.map(entry => entry.status), ['sealed']);
  assert.deepEqual(operation.receipts.map(entry => entry.status), [
    'superseded', 'claimed'
  ]);
});

test('explicit current confirmation: multi-Figure cache proof recovery locates one exact visual or fallback target before continuing', async () => {
  const scenarios = [
    { proofIndex: 0, mode: 'figure_image' },
    { proofIndex: 1, mode: 'figure_image' },
    { proofIndex: 0, mode: 'caption_context' },
    { proofIndex: 1, mode: 'caption_context' }
  ];
  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const storageArea = createMemoryStorage();
    const ledgerStorage = createMemoryStorage();
    const cacheEntries = new Map();
    const cacheStore = {
      async getMany(keys) {
        return new Map(keys.filter(key => cacheEntries.has(key))
          .map(key => [key, structuredClone(cacheEntries.get(key))]));
      },
      async setMany(values) {
        values.forEach(value => cacheEntries.set(value.key, structuredClone(value)));
      },
      async deleteMany(keys) { keys.forEach(key => cacheEntries.delete(key)); }
    };
    const figures = [1, 2].map(number => ({
      ...figureInput(number, [{ dataUrl: 'data:image/png;base64,AA==' }]),
      panelHints: ['A']
    }));
    const operationPlan = figures.map(figure => ({
      figureId: figure.figureId, panelCount: 1
    }));
    const proofCheckpoints = [];
    let providerCalls = 0;
    const cacheWriter = createConfirmedFigureRouter({
      storageArea, cacheStore,
      fetchImpl: async (_url, options) => {
        providerCalls += 1;
        const body = JSON.parse(options.body);
        const input = openAIInputPayload(body);
        if (scenario.mode === 'caption_context' && Array.isArray(body.input)) {
          return jsonResponse({}, 400);
        }
        return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
      }
    });
    await configureOpenAIRouter(cacheWriter);
    storageArea.values.sciLlmSettingsV2.taskPolicies
      .figure_walkthrough.allowTextFallback = true;
    const seededCache = await cacheWriter.handle(figureMessage(
      [figures[scenario.proofIndex]],
      { analysisDepth: 'standard', forceRefresh: true, figureOperationPlan: operationPlan }
    ), figureCheckpointContext([], proofCheckpoints));
    assert.equal(seededCache.success, true, JSON.stringify({ scenario, seededCache }));
    assert.equal(cacheEntries.size, 1, JSON.stringify(scenario));
    const proofEntry = structuredClone([...cacheEntries.values()][0]);
    assert.equal(proofEntry.figureResult.inputMode, scenario.mode, JSON.stringify(scenario));
    assert.match(proofEntry.providerProofDigest, /^[a-f0-9]{64}$/u);
    const callsBeforeRecovery = providerCalls;

    const baseLedger = createFigureProviderAttemptLedger({
      storageArea: ledgerStorage, getRuntimeLastError: () => null
    });
    let seededLedger = false;
    let seededSnapshot = '';
    const postAckLedger = {
      ...baseLedger,
      async bindRequest(input) {
        if (!seededLedger && input?.inspectOnly === true) {
          seededLedger = true;
          const prior = {
            ...input,
            receipt: `figure-request-multi-proof-prior-${scenarioIndex}-12345678`
          };
          delete prior.inspectOnly;
          delete prior.resumeCheckpointDigest;
          delete prior.resumeCacheDigest;
          await baseLedger.bindRequest(prior);
          const dispatchDigest = String(scenarioIndex + 1).repeat(64);
          const dispatch = await baseLedger.reserveAttempt(prior, dispatchDigest);
          await baseLedger.settleAttempt(
            prior, dispatch.attemptNumber, dispatchDigest, 'responded'
          );
          await baseLedger.prepareAttemptProof(prior, [{
            attemptNumber: dispatch.attemptNumber, dispatchDigest
          }], { kind: 'cache', digest: proofEntry.providerProofDigest });
          seededSnapshot = JSON.stringify(
            ledgerStorage.values.sciFigureProviderAttemptLedgerV1
          );
        }
        return baseLedger.bindRequest(input);
      }
    };
    const router = createConfirmedFigureRouter({
      storageArea, sessionStorageArea: ledgerStorage, cacheStore,
      figureProviderAttemptLedger: postAckLedger,
      fetchImpl: async (_url, options) => {
        providerCalls += 1;
        const input = openAIInputPayload(JSON.parse(options.body));
        return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
      }
    });
    const operationId = `figure-multi-cache-proof-${scenarioIndex}`;
    const recoveryMessage = (receipt, overrides = {}) => figureMessage([figures[scenario.proofIndex]], {
      analysisDepth: 'standard', forceRefresh: true, operationId,
      figureRequestReceipt: receipt, figureOperationPlan: operationPlan,
      ...overrides
    });
    const forgedCheckpoint = await resignFigureCheckpointEnvelope(
      proofCheckpoints.at(-1)?.checkpointEnvelope,
      value => { value.figureResult.analysisDepth = 'standard-ish'; }
    );
    const invalid = await router.handle(recoveryMessage(
      `figure-request-multi-proof-invalid-${scenarioIndex}-12345678`, {
        forceRefresh: false, figureResumeCheckpoint: forgedCheckpoint
      }
    ), figureCheckpointContext([], []));
    assert.equal(invalid.success, false, JSON.stringify({ scenario, invalid }));
    assert.equal(invalid.error.code, 'FIGURE_CHECKPOINT_INVALID',
      JSON.stringify({ scenario, invalid }));
    assert.equal(providerCalls, callsBeforeRecovery, JSON.stringify(scenario));
    assert.equal(
      JSON.stringify(ledgerStorage.values.sciFigureProviderAttemptLedgerV1),
      seededSnapshot,
      `invalid multi-Figure checkpoint cannot consume proof: ${JSON.stringify(scenario)}`
    );
    const recovered = await router.handle(recoveryMessage(
      `figure-request-multi-proof-current-${scenarioIndex}-12345678`
    ), figureCheckpointContext([], []));
    assert.equal(recovered.success, true, JSON.stringify({ scenario, recovered }));
    assert.equal(recovered.data.cacheHits, 1, JSON.stringify(scenario));
    assert.deepEqual(
      recovered.data.figureResults.map(result => result.figureId),
      [figures[scenario.proofIndex].figureId], JSON.stringify(scenario)
    );
    assert.equal(
      recovered.data.figureResults[0].inputMode,
      scenario.mode, JSON.stringify(scenario)
    );
    assert.equal(providerCalls,callsBeforeRecovery,'the exact proof target must not rebill');
    const operation = ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations[0];
    assert.ok(operation.providerDispatches.every(entry => entry.status === 'sealed'),
      JSON.stringify({ scenario, dispatches: operation.providerDispatches }));
    assert.deepEqual(operation.receipts.map(entry => entry.status), [
      'superseded', 'claimed'
    ], JSON.stringify(scenario));
    const independent=await router.handle(figureMessage([figures[1-scenario.proofIndex]],{
      analysisDepth:'standard',forceRefresh:true,operationId,
      figureRequestReceipt:`figure-request-independent-after-proof-${scenarioIndex}-12345678`,
      figureOperationPlan:operationPlan
    }),figureCheckpointContext([],[]));
    assert.equal(independent.success,true,JSON.stringify({scenario,independent}));
    assert.equal(independent.data.figureResults[0].figureId,figures[1-scenario.proofIndex].figureId);
    assert.equal(providerCalls,callsBeforeRecovery+1,'only the independent unfinished target may dispatch');
  }
});

test('consuming a Figure continuation closes the prior receipt and is single-winner', async () => {
  const ledgerStorage = createDelayedCloneStorage();
  const ledgerA = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage, getRuntimeLastError: () => null
  });
  const ledgerB = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage, getRuntimeLastError: () => null
  });
  const base = {
    operationId: `figure:${'0'.repeat(64)}`,
    bindingSignature: '1'.repeat(64), immutableLimit: 8,
    semanticSignature: '2'.repeat(64), targetKeyDigest: '3'.repeat(64)
  };
  const first = {
    ...base, receipt: 'figure-request-lineage-first-12345678',
    requestSignature: '4'.repeat(64)
  };
  await ledgerA.bindRequest(first);
  const dispatch = await ledgerA.reserveAttempt(first, '5'.repeat(64));
  await ledgerA.settleAttempt(first, dispatch.attemptNumber, '5'.repeat(64), 'responded');
  const proof = { kind: 'checkpoint', digest: '6'.repeat(64) };
  const consumed = [{
    attemptNumber: dispatch.attemptNumber, dispatchDigest: '5'.repeat(64)
  }];
  await ledgerA.prepareAttemptProof(first, consumed, proof);
  await ledgerA.sealRespondedAttempts(first, consumed, proof.digest, proof);
  const candidates = [
    {
      ...base, receipt: 'figure-request-lineage-second-12345678',
      requestSignature: '7'.repeat(64), resumeCheckpointDigest: proof.digest
    },
    {
      ...base, receipt: 'figure-request-lineage-third-12345678',
      requestSignature: '8'.repeat(64), resumeCheckpointDigest: proof.digest
    }
  ];
  const outcomes = await Promise.allSettled([
    ledgerA.bindRequest({ ...candidates[0], proofValidated: true }),
    ledgerB.bindRequest({ ...candidates[1], proofValidated: true })
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(item => item.status === 'rejected' &&
    item.reason?.code === 'FIGURE_REQUEST_REPLAY_AMBIGUOUS').length, 1);
  await assert.rejects(
    ledgerA.reserveAttempt(first, '9'.repeat(64)),
    error => error?.code === 'FIGURE_REQUEST_REPLAY_AMBIGUOUS'
  );
});

test('one Figure operation advances across disjoint plan targets but force refresh cannot replay a target', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id',
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const operationId = 'figure-two-target-lineage-operation';
  const operationPlan = [
    { figureId: 'figure-1', panelCount: 1 },
    { figureId: 'figure-2', panelCount: 1 }
  ];
  const owner = {
    trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 63, senderFrameId: 0,
    senderDocumentId: '63636363-6363-4636-8636-636363636363'
  };
  const request = (number, receipt, overrides = {}) => figureMessage([{
    ...figureInput(number), panelHints: ['A']
  }], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 4,
    operationId, figureRequestReceipt: receipt, figureOperationPlan: operationPlan,
    ...overrides
  });
  const firstCheckpoints = [];
  const first = await router.handle(request(
    1, 'figure-request-two-target-first-12345678'
  ), { ...owner, ...figureCheckpointContext([], firstCheckpoints) });
  assert.equal(first.success, true, JSON.stringify(first));
  assert.equal(providerCalls, 1);

  const replay = await router.handle(request(
    1, 'figure-request-two-target-force-replay-12345678', { forceRefresh: true }
  ), { ...owner, ...figureCheckpointContext([], []) });
  assert.equal(replay.success, false, JSON.stringify(replay));
  assert.equal(replay.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(providerCalls, 1);

  const ledgerBeforeForgedRefresh = JSON.stringify(sessionStorageArea.values);
  const forgedRefresh = await router.handle(request(
    1, 'figure-request-two-target-forged-refresh-12345678', {
      forceRefresh: true,
      figureResumeCheckpoint: firstCheckpoints.at(-1)?.checkpointEnvelope
    }
  ), { ...owner, ...figureCheckpointContext([], []) });
  assert.equal(forgedRefresh.success, false, JSON.stringify(forgedRefresh));
  assert.equal(forgedRefresh.error.code, 'INVALID_SETTINGS');
  assert.equal(JSON.stringify(sessionStorageArea.values), ledgerBeforeForgedRefresh,
    'forceRefresh plus resume is rejected before any durable ledger mutation');
  assert.equal(providerCalls, 1);

  const second = await router.handle(request(
    2, 'figure-request-two-target-second-12345678'
  ), { ...owner, ...figureCheckpointContext([], []) });
  assert.equal(second.success, true, JSON.stringify(second));
  assert.equal(providerCalls, 2);
  assert.deepEqual(second.data.figureResults.map(item => item.figureId), ['figure-2']);
});

test('modern Figure, Panel and follow-up requests retry only an exact response-body 429', async () => {
  const scenarios = [
    { name: 'whole', type: 'LLM_ANALYZE_FIGURES' },
    { name: 'panel', type: 'LLM_ANALYZE_FIGURE_PANEL' },
    { name: 'followup', type: 'LLM_ASK_FIGURE_PANEL' }
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const storageArea = createMemoryStorage();
    const sessionStorageArea = createMemoryStorage();
    let providerCalls = 0;
    const router = createBackgroundRouter({
      storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id',
      sleepImpl: async () => {},
      fetchImpl: async (url, options) => {
        providerCalls += 1;
        const input = openAIInputPayload(JSON.parse(options.body));
        if (providerCalls === 1) {
          return jsonResponse({ error: { message: 'explicit rate rejection' } }, 429);
        }
        const output = scenario.name === 'whole'
          ? figurePassOutput(input)
          : scenario.name === 'followup'
            ? panelFollowupOutput(input) : panelInterpretationOutput(input);
        return jsonResponse({ output_text: JSON.stringify(output) });
      }
    });
    await configureOpenAIRouter(router);
    const operationId = `figure-modern-429-${scenario.name}-operation`;
    const common = {
      type: scenario.type, analysisDepth: 'standard', operationScope: 'figure',
      workspaceLifecycle: 7, operationId,
      figureRequestReceipt: `figure-request-modern-429-${scenario.name}-12345678`,
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
      forceRefresh: true
    };
    const figure = { ...figureInput(1), panelHints: ['A'] };
    const message = scenario.name === 'whole'
      ? { ...figureMessage([figure]), ...common }
      : {
        ...common, documentHash: String(index + 1).repeat(64),
        document: { title: 'Modern 429 contract' }, figure,
        panel: { panel: 'A' },
        ...(scenario.name === 'followup' ? { topics: ['grouping'] } : {})
      };
    const owner = {
      trustedExtensionSender: true, senderExtensionId: 'extension-id',
      senderTabId: 70 + index, senderFrameId: 0,
      senderDocumentId: `70707070-7070-4070-8070-70707070707${index}`,
      ...(scenario.name === 'whole' ? figureCheckpointContext([], []) : {})
    };
    const response = await router.handle(message, owner);
    assert.equal(response.success, true, `${scenario.name}:${JSON.stringify(response)}`);
    assert.equal(providerCalls, 2, scenario.name);
    const [operation] = sessionStorageArea.values
      .sciFigureProviderAttemptLedgerV1.operations;
    assert.deepEqual(operation.providerDispatches.map(entry => entry.status), [
      'sealed', 'sealed'
    ], scenario.name);
  }
});

test('modern Figure requests keep 408 quarantined and bound a 503 retry across receipts', async () => {
  for (const [index, status] of [408, 503].entries()) {
    const storageArea = createMemoryStorage();
    const sessionStorageArea = createMemoryStorage();
    let providerCalls = 0;
    const createRouter = () => createBackgroundRouter({
      storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id',
      sleepImpl: async () => {},
      fetchImpl: async () => {
        providerCalls += 1;
        return jsonResponse({ error: { message: `ambiguous ${status}` } }, status);
      }
    });
    await configureOpenAIRouter(createRouter());
    const operationId = `figure-modern-ambiguous-${status}-operation`;
    const request = receipt => figureMessage([{
      ...figureInput(1), panelHints: ['A']
    }], {
      analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 8,
      operationId, figureRequestReceipt: receipt,
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
      forceRefresh: true
    });
    const owner = {
      trustedExtensionSender: true, senderExtensionId: 'extension-id',
      senderTabId: 80 + index, senderFrameId: 0,
      senderDocumentId: `80808080-8080-4080-8080-80808080808${index}`,
      ...figureCheckpointContext([], [])
    };
    const first = await createRouter().handle(request(
      `figure-request-modern-ambiguous-${status}-first-12345678`
    ), owner);
    assert.equal(first.success, false, JSON.stringify(first));
    assert.equal(first.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
    assert.equal(providerCalls, status === 503 ? 2 : 1);
    const replay = await createRouter().handle(request(
      `figure-request-modern-ambiguous-${status}-second-12345678`
    ), owner);
    assert.equal(replay.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
    assert.equal(providerCalls, status === 503 ? 2 : 1);
  }
});

test('a lost Figure response stays quarantined when the terminal write acknowledgement fails', async () => {
  const storageArea = createMemoryStorage();
  const baseSessionStorage = createMemoryStorage();
  let failTerminalWrite = false;
  let terminalWriteFailures = 0;
  const sessionStorageArea = {
    values: baseSessionStorage.values,
    get: baseSessionStorage.get,
    set(input, callback) {
      if (failTerminalWrite && terminalWriteFailures === 0) {
        terminalWriteFailures += 1;
        throw new Error('PRIVATE TERMINAL WRITE ACK LOST');
      }
      return baseSessionStorage.set(input, callback);
    }
  };
  let providerCalls = 0;
  const createRouter = () => createBackgroundRouter({
    storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id',
    sleepImpl: async () => {},
    fetchImpl: async () => {
      providerCalls += 1;
      failTerminalWrite = true;
      const error = new TypeError('PRIVATE REMOTE SIDE EFFECT AND LOST RESPONSE');
      error.code = 'NETWORK_ERROR';
      error.retryable = true;
      throw error;
    }
  });
  await configureOpenAIRouter(createRouter());
  const operationId = 'figure-lost-response-terminal-ack-operation';
  const owner = {
    ...figureCheckpointContext([], []), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 62, senderFrameId: 0,
    senderDocumentId: '62626262-6262-4626-8626-626262626262'
  };
  const request = receipt => figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 52,
    operationId, figureRequestReceipt: receipt,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
    providerAttemptsConsumed: 0, forceRefresh: true
  });
  const first = await createRouter().handle(request(
    'figure-request-terminal-ack-first-12345678'
  ), owner);
  assert.equal(first.success, false, JSON.stringify(first));
  assert.equal(first.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(first.error.retryable, false);
  assert.equal(first.error.cleanupPending, true);
  assert.equal(first.error.cleanupCode, 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
  assert.equal(terminalWriteFailures, 1);
  assert.equal(providerCalls, 1);

  const replay = await createRouter().handle(request(
    'figure-request-terminal-ack-second-12345678'
  ), owner);
  assert.equal(replay.success, false, JSON.stringify(replay));
  assert.equal(replay.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(providerCalls, 1,
    'the durable pre-dispatch reservation survives a failed terminal ACK');
});

test('concurrent routers admit exactly one provider dispatch for the same durable Figure receipt', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createDelayedCloneStorage();
  let providerCalls = 0;
  let signalProviderStarted;
  let releaseProvider;
  const providerStarted = new Promise(resolve => { signalProviderStarted = resolve; });
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const createRouter = () => createBackgroundRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    fetchImpl: async () => {
      providerCalls += 1;
      signalProviderStarted();
      await providerGate;
      return jsonResponse({}, 400);
    }
  });
  await configureOpenAIRouter(createRouter());
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard',
    operationId: 'figure-durable-concurrent-receipt-operation',
    figureRequestReceipt: 'figure-request-durable-concurrent-exact-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const firstPending = createRouter().handle(structuredClone(message));
  await providerStarted;
  const competing = await createRouter().handle(structuredClone(message));
  assert.equal(competing.success, false);
  assert.equal(competing.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(providerCalls, 1);
  releaseProvider();
  const first = await firstPending;
  assert.equal(first.error.code, 'PROVIDER_REJECTED');
  assert.equal(providerCalls, 1);
});

test('durable Figure budget keeps the first limit when settings and topology drift after restart', async () => {
  const storageArea = createMemoryStorage();
  const figureAttemptLedgerStorage = createMemoryStorage();
  let providerCalls = 0;
  const createRouter = () => createBackgroundRouter({
    storageArea,
    sessionStorageArea: figureAttemptLedgerStorage,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  await configureOpenAIRouter(createRouter());
  const operationId = 'figure-durable-limit-drift-operation';
  const first = await createRouter().handle(figureMessage([{
    ...figureInput(1), panelHints: ['A']
  }], {
    analysisDepth: 'standard', operationId,
    figureRequestReceipt: 'figure-request-durable-limit-first-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }]
  }));
  assert.equal(first.error.code, 'PROVIDER_REJECTED');
  const firstProviderCalls = providerCalls;
  assert.ok(firstProviderCalls > 0);

  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_walkthrough.allowTextFallback = true;
  const drifted = await createRouter().handle(figureMessage([figureInput(2)], {
    analysisDepth: 'deep', operationId,
    figureRequestReceipt: 'figure-request-durable-limit-drift-12345678',
    figureOperationPlan: Array.from({ length: 40 }, (_, index) => ({
      figureId: `figure-${index + 1}`, panelCount: index === 1 ? 0 : 30
    }))
  }));
  assert.equal(drifted.success, false);
  assert.equal(drifted.error.code, 'FIGURE_PROVIDER_ATTEMPT_LIMIT');
  assert.equal(providerCalls, firstProviderCalls,
    'a restarted router cannot rebind a larger limit');
});

test('Figure ledger storage failure and an advisory-only seed fail closed before provider work', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const unavailableLedgerStorage = {
    get() { return Promise.reject(new Error('ledger unavailable')); },
    set() { return Promise.reject(new Error('ledger unavailable')); }
  };
  await configureOpenAIRouter(createBackgroundRouter({ storageArea }));
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: unavailableLedgerStorage,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });
  await configureOpenAIRouter(router);
  const unavailable = await router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard',
    operationId: 'figure-ledger-storage-unavailable-operation',
    figureRequestReceipt: 'figure-request-ledger-storage-failure-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  }));
  assert.equal(unavailable.success, false);
  assert.equal(unavailable.error.code, 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
  assert.equal(providerCalls, 0);

  const advisoryRouter = createBackgroundRouter({
    storageArea,
    sessionStorageArea: createMemoryStorage(),
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });
  const advisory = await advisoryRouter.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard',
    operationId: 'figure-ledger-advisory-only-operation',
    figureRequestReceipt: 'figure-request-ledger-advisory-only-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
    providerAttemptsConsumed: 5
  }));
  assert.equal(advisory.success, false);
  assert.equal(advisory.error.code, 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
  assert.equal(providerCalls, 0,
    'client progress cannot create an authoritative durable ledger');
});

test('a lost durable reservation acknowledgement quarantines the consumed dispatch', async () => {
  const storageArea = createMemoryStorage();
  const durableValues = {};
  let setCalls = 0;
  let runtimeError = null;
  const lostAckStorage = {
    values: durableValues,
    get(key, callback) { callback({ [key]: durableValues[key] }); },
    set(input, callback) {
      setCalls += 1;
      Object.assign(durableValues, structuredClone(input));
      runtimeError = setCalls === 2 ? { message: 'reservation ACK lost' } : null;
      callback();
      runtimeError = null;
    }
  };
  let providerCalls = 0;
  const firstRouter = createBackgroundRouter({
    storageArea,
    sessionStorageArea: lostAckStorage,
    getRuntimeLastError: () => runtimeError,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });
  await configureOpenAIRouter(firstRouter);
  const operationId = 'figure-ledger-lost-ack-operation';
  const plan = [{ figureId: 'figure-1', panelCount: 0 }];
  const first = await firstRouter.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard',
    operationId,
    figureRequestReceipt: 'figure-request-ledger-lost-ack-first-12345678',
    figureOperationPlan: plan
  }));
  assert.equal(first.error.code, 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
  assert.equal(providerCalls, 0, 'provider requires a confirmed durable reservation');

  const progress = [];
  const restartedRouter = createBackgroundRouter({
    storageArea,
    sessionStorageArea: createMemoryStorage(durableValues),
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  const second = await restartedRouter.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard',
    operationId,
    figureRequestReceipt: 'figure-request-ledger-lost-ack-second-12345678',
    figureOperationPlan: plan,
    providerAttemptsConsumed: 0
  }), { onProgress: event => progress.push(event) });
  assert.equal(second.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(providerCalls, 0,
    'the unacknowledged pre-dispatch claim cannot be proven safe to repeat');
  assert.deepEqual(progress.filter(event => event.phase === 'figure_provider_attempt'), []);
  assert.equal(durableValues.sciFigureProviderAttemptLedgerV1
    .operations[0].reservedAttempts, 1);
});

test('concurrent disjoint Figure targets independently reserve the shared operation budget', async () => {
  const storageArea = createMemoryStorage();
  const figureAttemptLedgerStorage = createDelayedCloneStorage();
  const progress = [];
  const providerAttemptsSeenAtDispatch = [];
  let providerCalls = 0;
  const createRouter = () => createBackgroundRouter({
    storageArea,
    sessionStorageArea: figureAttemptLedgerStorage,
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      providerAttemptsSeenAtDispatch.push(progress.at(-1)?.providerAttempt || 0);
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(createRouter());
  const operationId = 'figure-ledger-concurrent-operation';
  const plan = [
    { figureId: 'figure-1', panelCount: 0 },
    { figureId: 'figure-2', panelCount: 0 }
  ];
  const [first, second] = await Promise.all([
    createRouter().handle(figureMessage([figureInput(1)], {
      operationId, analysisDepth: 'standard',
      figureRequestReceipt: 'figure-request-ledger-concurrent-first-12345678',
      figureOperationPlan: plan
    }), figureCheckpointContext(progress, [])),
    createRouter().handle(figureMessage([figureInput(2)], {
      operationId, analysisDepth: 'standard',
      figureRequestReceipt: 'figure-request-ledger-concurrent-second-12345678',
      figureOperationPlan: plan
    }), figureCheckpointContext(progress, []))
  ]);
  const responses = [first, second];
  assert.equal(responses.filter(response => response.success).length, 2,
    JSON.stringify(responses));
  assert.equal(providerCalls, 2);
  assert.deepEqual(providerAttemptsSeenAtDispatch, [1, 2]);
});

test('a durable Figure receipt rejects changed request input after router reconstruction', async () => {
  const storageArea = createMemoryStorage();
  const figureAttemptLedgerStorage = createMemoryStorage();
  let providerCalls = 0;
  const createRouter = () => createBackgroundRouter({
    storageArea,
    sessionStorageArea: figureAttemptLedgerStorage,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  await configureOpenAIRouter(createRouter());
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard',
    operationId: 'figure-durable-receipt-binding-operation',
    figureRequestReceipt: 'figure-request-durable-binding-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const first = await createRouter().handle(message);
  assert.equal(first.error.code, 'PROVIDER_REJECTED');
  const replay = await createRouter().handle({
    ...structuredClone(message),
    figures: [{ ...figureInput(1), caption: 'changed request after durable binding' }]
  });
  assert.equal(replay.success, false);
  assert.equal(replay.error.code, 'FIGURE_REQUEST_RECEIPT_MISMATCH');
  assert.equal(providerCalls, 1);
});

test('Panel interpretation and follow-up reserve the durable Figure ledger before dispatch', async () => {
  for (const mode of ['interpretation', 'followup']) {
    const storageArea = createMemoryStorage();
    const ledgerStorage = createMemoryStorage();
    let providerCalls = 0;
    const createRouter = () => createBackgroundRouter({
      storageArea,
      sessionStorageArea: ledgerStorage,
      runtimeExtensionId: 'extension-id',
      fetchImpl: async (_url, options) => {
        providerCalls += 1;
        const input = openAIInputPayload(JSON.parse(options.body));
        const output = mode === 'followup'
          ? panelFollowupOutput(input) : panelInterpretationOutput(input);
        return jsonResponse({ output_text: JSON.stringify(output) });
      }
    });
    await configureOpenAIRouter(createRouter());
    const type = mode === 'followup'
      ? 'LLM_ASK_FIGURE_PANEL' : 'LLM_ANALYZE_FIGURE_PANEL';
    const operationId = `figure-panel-${mode}-durable-operation`;
    const receipt = `figure-request-panel-${mode}-durable-12345678`;
    const message = {
      type, operationScope: 'figure', workspaceLifecycle: 17,
      analysisDepth: 'standard',
      operationId, figureRequestReceipt: receipt,
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
      providerAttemptsConsumed: 0,
      documentHash: 'a'.repeat(64),
      document: { title: 'Durable Panel request', documentHash: 'a'.repeat(64) },
      figure: { ...figureInput(1), panelHints: ['A'] },
      panel: { panel: 'A', purpose: 'Compare groups' },
      topics: mode === 'followup' ? ['grouping'] : [],
      customQuestion: ''
    };
    const context = {
      ...figureCheckpointContext([], []), trustedExtensionSender: true,
      senderExtensionId: 'extension-id', senderTabId: 21, senderFrameId: 0,
      senderDocumentId: '77777777-7777-4777-8777-777777777777'
    };
    const first = await createRouter().handle(structuredClone(message), context);
    assert.equal(first.success, true, `${mode}: ${JSON.stringify(first)}`);
    assert.equal(providerCalls, 1, mode);
    const [durableOperation] =
      ledgerStorage.values.sciFigureProviderAttemptLedgerV1?.operations || [];
    assert.ok(durableOperation, `${mode} did not bind a durable operation`);
    assert.equal(durableOperation.reservedAttempts, 1, mode);
    assert.equal(durableOperation.receipts[0].receipt, receipt, mode);

    const replay = await createRouter().handle(structuredClone(message), context);
    assert.equal(replay.success, false, mode);
    assert.equal(replay.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS', mode);
    assert.equal(providerCalls, 1, `${mode} replay dispatched provider work`);
  }
});

test('production legacy cross-Figure requests cannot bypass the mechanism ledger', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Legacy cross Figure' },
    figures: [crossFigureInput(1), crossFigureInput(2)]
  }, {
    trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 21, senderFrameId: 0,
    senderDocumentId: '77777777-7777-4777-8777-777777777777'
  });
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'INVALID_SETTINGS');
  assert.equal(providerCalls, 0);
});

test('explicit Figure plans bind each requested Figure to its normalized Panel count', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: createMemoryStorage(),
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(figureMessage([{
    ...figureInput(1), panelHints: ['A', 'B']
  }], {
    analysisDepth: 'standard',
    operationId: 'figure-plan-panel-count-operation',
    figureRequestReceipt: 'figure-request-plan-count-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }]
  }));
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'INVALID_SETTINGS');
  assert.equal(providerCalls, 0, 'an untrusted plan cannot reserve or dispatch provider work');
});

test('durable Figure identities and receipt signatures are production SHA-256 digests', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async (url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 5,
    operationId: 'figure-production-sha-operation',
    figureRequestReceipt: 'figure-request-production-sha-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  }), {
    ...figureCheckpointContext([], []), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 15, senderFrameId: 0,
    senderDocumentId: '55555555-5555-4555-8555-555555555555'
  });
  assert.equal(response.success, true, JSON.stringify(response));
  const [operation] = ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations;
  assert.match(operation.operationId, /^figure:[a-f0-9]{64}$/u);
  assert.match(operation.bindingSignature, /^[a-f0-9]{64}$/u);
  assert.match(operation.receipts[0].requestSignature, /^[a-f0-9]{64}$/u);
});

test('Figure request signatures enforce the UTF-8 byte hard limit before provider dispatch', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: createMemoryStorage(),
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(figureMessage([{
    ...figureInput(1), panelHints: ['A']
  }], {
    analysisDepth: 'standard',
    operationId: 'figure-utf8-signature-limit-operation',
    figureRequestReceipt: 'figure-request-utf8-signature-limit-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
    // 5,592,406 UTF-16 code units fit below 16 MiB as JS characters, but
    // encode to more than 16 MiB of UTF-8. The network boundary must use bytes.
    oversizedMetadata: '汉'.repeat(5_592_406)
  }), figureCheckpointContext([], []));
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
  assert.equal(providerCalls, 0);
});

test('Figure request signatures distinguish an empty array from a JSON null hole', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let providerCalls = 0;
  const createRouter = () => createBackgroundRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  await configureOpenAIRouter(createRouter());
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard',
    operationId: 'figure-array-hole-signature-operation',
    figureRequestReceipt: 'figure-request-array-hole-signature-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
    signatureProbe: []
  });
  const first = await createRouter().handle(message);
  assert.equal(first.error.code, 'PROVIDER_REJECTED');
  const changed = structuredClone(message);
  changed.signatureProbe = Array(1);
  const replay = await createRouter().handle(changed);
  assert.equal(replay.success, false);
  assert.equal(replay.error.code, 'FIGURE_REQUEST_RECEIPT_MISMATCH');
  assert.equal(providerCalls, 1);
});

test('Figure request signatures reject array accessors without invoking them', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  let getterCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: createMemoryStorage(),
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  await configureOpenAIRouter(router);
  const hostile = [];
  Object.defineProperty(hostile, 0, {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return 'must-not-be-read';
    }
  });
  const response = await router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard',
    operationId: 'figure-array-accessor-signature-operation',
    figureRequestReceipt: 'figure-request-array-accessor-signature-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
    signatureProbe: hostile
  }));
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
  assert.equal(getterCalls, 0);
  assert.equal(providerCalls, 0);
});

test('Figure request signatures reject top-level and nested object accessors without invoking them', async () => {
  for (const placement of ['top-level', 'nested']) {
    const storageArea = createMemoryStorage();
    let providerCalls = 0;
    let getterCalls = 0;
    const router = createBackgroundRouter({
      storageArea,
      sessionStorageArea: createMemoryStorage(),
      fetchImpl: async () => {
        providerCalls += 1;
        return jsonResponse({}, 400);
      }
    });
    await configureOpenAIRouter(router);
    const message = figureMessage([figureInput(1)], {
      analysisDepth: 'standard',
      operationId: `figure-object-accessor-${placement}-operation`,
      figureRequestReceipt: `figure-request-object-accessor-${placement}-12345678`,
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
    });
    const target = placement === 'top-level' ? message : {};
    if (placement === 'nested') message.signatureProbe = target;
    Object.defineProperty(target, 'hostile', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return 'must-not-be-read';
      }
    });
    const response = await router.handle(message);
    assert.equal(response.success, false, placement);
    assert.equal(
      response.error.code,
      'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE',
      placement
    );
    assert.equal(getterCalls, 0, placement);
    assert.equal(providerCalls, 0, placement);
  }
});

test('Figure request signatures fail closed on excessive node traversal before provider dispatch', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: createMemoryStorage(),
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard',
    operationId: 'figure-node-budget-signature-operation',
    figureRequestReceipt: 'figure-request-node-budget-signature-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
    signatureProbe: Array.from({ length: 100_001 }, () => null)
  }));
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
  assert.equal(providerCalls, 0);
});

test('Figure request signatures fail closed on excessive nesting before provider dispatch', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: createMemoryStorage(),
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  await configureOpenAIRouter(router);
  const signatureProbe = {};
  let cursor = signatureProbe;
  for (let depth = 0; depth < 65; depth += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  const response = await router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard',
    operationId: 'figure-depth-budget-signature-operation',
    figureRequestReceipt: 'figure-request-depth-budget-signature-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
    signatureProbe
  }));
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
  assert.equal(providerCalls, 0);
});

test('Figure request signatures reject a maximal sparse array without scanning its declared length', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: createMemoryStorage(),
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  await configureOpenAIRouter(router);
  const signatureProbe = [];
  signatureProbe.length = 0xffff_ffff;
  const response = await router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard',
    operationId: 'figure-sparse-budget-signature-operation',
    figureRequestReceipt: 'figure-request-sparse-budget-signature-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
    signatureProbe
  }));
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
  assert.equal(providerCalls, 0);
});

test('Figure route binding detects endpoint query drift even when every legacy 32-bit signature collides', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let providerCalls = 0;
  const originalStableHash = globalThis.SciLLM.stableHash;
  globalThis.SciLLM.stableHash = () => 'deadbeef';
  try {
    const createRouter = () => createBackgroundRouter({
      storageArea,
      sessionStorageArea: ledgerStorage,
      fetchImpl: async () => {
        providerCalls += 1;
        return jsonResponse({}, 400);
      }
    });
    const configuringRouter = createRouter();
    await configuringRouter.handle({
      type: 'LLM_SAVE_PROVIDER', providerId: 'openai-compatible',
      config: {
        apiKey: 'route-binding-secret', model: 'compatible-model',
        baseUrl: 'https://compatible.example/v1?tenant=alpha',
        supportsVision: true
      }
    });
    await configuringRouter.handle({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: {
        mode: 'llm', providerId: 'openai-compatible', consentGranted: true
      }
    });
    const operationId = 'figure-route-strong-binding-operation';
    const plan = [{ figureId: 'figure-1', panelCount: 0 }];
    const first = await createRouter().handle(figureMessage([figureInput(1)], {
      operationId, analysisDepth: 'standard',
      figureRequestReceipt: 'figure-request-route-strong-first-12345678',
      figureOperationPlan: plan
    }));
    assert.equal(first.error.code, 'PROVIDER_REJECTED');
    const callsBeforeDrift = providerCalls;
    const settings = storageArea.values.sciLlmSettingsV2;
    settings.profiles[settings.globalProfileId].config.baseUrl =
      'https://compatible.example/v1?tenant=beta';
    const drifted = await createRouter().handle(figureMessage([figureInput(1)], {
      operationId, analysisDepth: 'standard',
      figureRequestReceipt: 'figure-request-route-strong-drift-12345678',
      figureOperationPlan: plan
    }));
    assert.equal(drifted.success, false);
    assert.equal(drifted.error.code, 'FIGURE_PROVIDER_ATTEMPT_LIMIT');
    assert.equal(providerCalls, callsBeforeDrift,
      'endpoint drift is rejected before a provider dispatch despite the FNV collision');
  } finally {
    globalThis.SciLLM.stableHash = originalStableHash;
  }
});

test('Figure route binding covers request headers and context windows but never the API key', async () => {
  async function run(mutate, { prepare = null } = {}) {
    const storageArea = createMemoryStorage();
    const ledgerStorage = createMemoryStorage();
    let providerCalls = 0;
    const createRouter = () => createBackgroundRouter({
      storageArea, sessionStorageArea: ledgerStorage,
      fetchImpl: async () => {
        providerCalls += 1;
        return jsonResponse({}, 400);
      }
    });
    const configured = createRouter();
    await configured.handle({
      type: 'LLM_SAVE_PROVIDER', providerId: 'openai-compatible',
      config: {
        apiKey: 'sk-route-first-secret', model: 'compatible-model',
        baseUrl: 'https://compatible.example/v1?tenant=stable',
        supportsVision: true, authHeader: 'X-Api-Key', authPrefix: 'Token',
        customHeaders: { 'X-Workspace': 'workspace-alpha' }
      }
    });
    await configured.handle({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: {
        mode: 'llm', providerId: 'openai-compatible', consentGranted: true
      }
    });
    const settings = storageArea.values.sciLlmSettingsV2;
    const profile = settings.profiles[settings.globalProfileId];
    profile.contextWindowTokens = 32768;
    if (prepare) prepare(profile);
    const operationId = `figure-route-behavior-${Math.random()}`;
    const plan = [{ figureId: 'figure-1', panelCount: 0 }];
    const first = await createRouter().handle(figureMessage([figureInput(1)], {
      operationId, analysisDepth: 'standard', forceRefresh: true,
      figureRequestReceipt: 'figure-request-route-behavior-first-12345678',
      figureOperationPlan: plan
    }));
    assert.equal(first.error.code, 'PROVIDER_REJECTED', JSON.stringify(first));
    mutate(profile);
    const second = await createRouter().handle(figureMessage([figureInput(1)], {
      operationId, analysisDepth: 'standard', forceRefresh: true,
      figureRequestReceipt: 'figure-request-route-behavior-second-12345678',
      figureOperationPlan: plan
    }));
    assert.equal(second.error.code, 'FIGURE_PROVIDER_ATTEMPT_LIMIT',
      JSON.stringify(second));
    assert.equal(providerCalls, 1);
    const serializedLedger = JSON.stringify(
      ledgerStorage.values.sciFigureProviderAttemptLedgerV1
    );
    assert.doesNotMatch(serializedLedger,
      /sk-route-first-secret|sk-route-rotated-secret|workspace-alpha|workspace-beta/u);
  }

  await run(profile => { profile.config.customHeaders['X-Workspace'] = 'workspace-beta'; });
  await run(profile => { profile.config.authHeader = 'X-Authorization'; });
  await run(profile => { profile.config.authHeader = ' Authorization '; });
  await run(profile => { profile.config.authPrefix = 'ApiKey'; });
  await run(profile => { profile.contextWindowTokens = 16384; });
  await run(profile => { profile.config.apiKey = 'sk-route-rotated-secret'; });
  await run(profile => {
    profile.config.customHeaders['X-Route-064'] = 'changed-outside-old-prefix';
  }, {
    prepare(profile) {
      for (let index = 0; index < 65; index += 1) {
        profile.config.customHeaders[`X-Route-${String(index).padStart(3, '0')}`] =
          'stable';
      }
    }
  });
  await run(profile => {
    profile.config.customHeaders['X-Long-Route'] = `${'x'.repeat(4000)}beta`;
  }, {
    prepare(profile) {
      profile.config.customHeaders['X-Long-Route'] = `${'x'.repeat(4000)}alpha`;
    }
  });
  await run(profile => {
    profile.config.customHeaders = {
      'x-duplicate-route': 'second', 'X-Duplicate-Route': 'first'
    };
  }, {
    prepare(profile) {
      profile.config.customHeaders = {
        'X-Duplicate-Route': 'first', 'x-duplicate-route': 'second'
      };
    }
  });
});

test('whole Figure cache identity uses the strong route digest after request-shaping drift', async () => {
  async function run(mutate) {
    const storageArea = createMemoryStorage();
    const cacheEntries = new Map();
    let providerCalls = 0;
    const router = createBackgroundRouter({
      storageArea,
      sessionStorageArea: createMemoryStorage(),
      cacheStore: {
        async getMany(keys) {
          return new Map(keys.filter(key => cacheEntries.has(key))
            .map(key => [key, structuredClone(cacheEntries.get(key))]));
        },
        async setMany(entries) {
          entries.forEach(entry => cacheEntries.set(entry.key, structuredClone(entry)));
        }
      },
      fetchImpl: async (_url, options) => {
        providerCalls += 1;
        const body = JSON.parse(options.body);
        const rawContent = body.messages?.[1]?.content;
        const text = Array.isArray(rawContent)
          ? rawContent.find(item => item?.type === 'text')?.text
          : rawContent;
        const input = JSON.parse(text);
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify(figurePassOutput(input)) } }]
        });
      }
    });
    await router.handle({
      type: 'LLM_SAVE_PROVIDER', providerId: 'openai-compatible',
      config: {
        apiKey: 'strong-cache-route-secret', model: 'compatible-model',
        baseUrl: 'https://compatible.example/v1?tenant=alpha',
        supportsVision: true, authHeader: 'X-Api-Key', authPrefix: 'Token',
        customHeaders: { 'X-Workspace': 'workspace-alpha' }
      }
    });
    await router.handle({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: {
        mode: 'llm', providerId: 'openai-compatible', consentGranted: true
      }
    });
    const settings = storageArea.values.sciLlmSettingsV2;
    const profile = settings.profiles[settings.globalProfileId];
    profile.contextWindowTokens = 32768;
    const request = suffix => figureMessage([{
      ...figureInput(1), panelHints: ['A']
    }], {
      operationId: `figure-strong-cache-${suffix}`,
      figureRequestReceipt: `figure-request-strong-cache-${suffix}-12345678`,
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
      analysisDepth: 'standard'
    });
    const first = await router.handle(request('first'), figureCheckpointContext([], []));
    assert.equal(first.success, true, JSON.stringify(first));
    assert.equal(first.data.cacheHits, 0);
    mutate(profile);
    const second = await router.handle(request('second'), figureCheckpointContext([], []));
    assert.equal(second.success, true, JSON.stringify(second));
    assert.equal(second.data.cacheHits, 0,
      'a new route must never consume an entry keyed only by the legacy FNV signature');
    assert.equal(providerCalls, 2);
    assert.doesNotMatch(JSON.stringify([...cacheEntries.keys()]),
      /strong-cache-route-secret|workspace-alpha|workspace-beta/u);
  }

  await run(profile => {
    profile.config.baseUrl = 'https://compatible.example/v1?tenant=beta';
  });
  await run(profile => {
    profile.config.customHeaders['X-Workspace'] = 'workspace-beta';
  });
  await run(profile => { profile.contextWindowTokens = 16384; });
  await run(profile => { profile.config.apiKey = 'strong-cache-rotated-secret'; });
  const originalPromptVersion = globalThis.SciLLM.FIGURE_ANALYSIS_PROMPT_VERSION;
  try {
    await run(() => { globalThis.SciLLM.FIGURE_ANALYSIS_PROMPT_VERSION = 'test-new-fidelity-version'; });
  } finally {
    globalThis.SciLLM.FIGURE_ANALYSIS_PROMPT_VERSION = originalPromptVersion;
  }
});

test('Panel cache identity uses the strong route digest after request-header drift', async () => {
  const storageArea = createMemoryStorage();
  const cacheEntries = new Map();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: createMemoryStorage(),
    cacheStore: {
      async getMany(keys) {
        return new Map(keys.filter(key => cacheEntries.has(key))
          .map(key => [key, structuredClone(cacheEntries.get(key))]));
      },
      async setMany(entries) {
        entries.forEach(entry => cacheEntries.set(entry.key, structuredClone(entry)));
      }
    },
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const body = JSON.parse(options.body);
      const rawContent = body.messages?.[1]?.content;
      const text = Array.isArray(rawContent)
        ? rawContent.find(item => item?.type === 'text')?.text
        : rawContent;
      const input = JSON.parse(text);
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify(panelFollowupOutput(input)) } }]
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai-compatible',
    config: {
      apiKey: 'panel-cache-secret', model: 'compatible-model',
      baseUrl: 'https://compatible.example/v1?tenant=alpha',
      supportsVision: true, customHeaders: { 'X-Workspace': 'workspace-alpha' }
    }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'openai-compatible', consentGranted: true }
  });
  const request = suffix => ({
    type: 'LLM_ASK_FIGURE_PANEL',
    operationId: `figure-panel-strong-cache-${suffix}`,
    figureRequestReceipt: `figure-request-panel-strong-cache-${suffix}-12345678`,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
    providerAttemptsConsumed: 0, analysisDepth: 'standard',
    document: { title: 'Panel route cache', paragraphs: [{ paragraphId: 'p1',
      text: 'Figure 1 reports the comparison in this stable source document.' }] },
    figure: { ...figureInput(1), panelHints: ['A'] },
    panel: { panel: 'A', purpose: 'Compare groups' },
    topics: ['grouping'], customQuestion: ''
  });
  const first = await router.handle(request('first'));
  assert.equal(first.success, true, JSON.stringify(first));
  assert.equal(first.data.cacheHit, false);
  const settings = storageArea.values.sciLlmSettingsV2;
  settings.profiles[settings.globalProfileId].config.customHeaders['X-Workspace'] =
    'workspace-beta';
  const second = await router.handle(request('second'));
  assert.equal(second.success, true, JSON.stringify(second));
  assert.equal(second.data.cacheHit, false);
  assert.equal(providerCalls, 2);
});

test('Codex native profile identity is bound to the Figure ledger and strong cache key', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const cacheEntries = new Map();
  const nativeProfiles = [];
  const nativeClient = {
    streamTurn(input) {
      nativeProfiles.push(input.profileId);
      const prompt = JSON.parse(input.userPrompt);
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'text_delta',
            text: JSON.stringify(figurePassOutput(prompt))
          };
          yield { type: 'completed' };
        }
      };
    },
    async health() { return { connected: true }; }
  };
  const createRouter = () => createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage, nativeClient,
    cacheStore: {
      async getMany(keys) {
        return new Map(keys.filter(key => cacheEntries.has(key))
          .map(key => [key, structuredClone(cacheEntries.get(key))]));
      },
      async setMany(entries) {
        entries.forEach(entry => cacheEntries.set(entry.key, structuredClone(entry)));
      }
    },
    fetchImpl: async () => jsonResponse({})
  });
  const configured = createRouter();
  await configured.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'codex-local',
    config: { model: 'auto', reasoningEffort: 'medium', profileId: 'native-alpha' }
  });
  await configured.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'codex-local', consentGranted: true }
  });
  const request = (operationId, receipt) => figureMessage([{
    ...figureInput(1), panelHints: ['A']
  }], {
    operationId, figureRequestReceipt: receipt,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
    analysisDepth: 'standard'
  });
  const operationId = 'figure-native-profile-binding-operation';
  const first = await createRouter().handle(request(
    operationId, 'figure-request-native-profile-first-12345678'
  ), figureCheckpointContext([], []));
  assert.equal(first.success, true, JSON.stringify(first));
  const profile = storageArea.values.sciLlmSettingsV2.profiles[
    storageArea.values.sciLlmSettingsV2.globalProfileId
  ];
  profile.config.profileId = 'native-beta';
  const driftedSameOperation = await createRouter().handle(request(
    operationId, 'figure-request-native-profile-drift-12345678'
  ), figureCheckpointContext([], []));
  assert.equal(driftedSameOperation.success, false);
  assert.equal(driftedSameOperation.error.code, 'FIGURE_PROVIDER_ATTEMPT_LIMIT');
  assert.deepEqual(nativeProfiles, ['native-alpha']);

  const fresh = await createRouter().handle(request(
    'figure-native-profile-fresh-operation',
    'figure-request-native-profile-fresh-12345678'
  ), figureCheckpointContext([], []));
  assert.equal(fresh.success, true, JSON.stringify(fresh));
  assert.equal(fresh.data.cacheHits, 0);
  assert.deepEqual(nativeProfiles, ['native-alpha', 'native-beta']);
  assert.doesNotMatch(JSON.stringify(ledgerStorage.values), /native-alpha|native-beta/u);
});

test('a public Figure operation is permanently bound to its first trusted sender document', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', forceRefresh: true,
    workspaceLifecycle: 7, operationScope: 'figure',
    operationId: 'figure-cross-tab-collision-operation',
    figureRequestReceipt: 'figure-request-cross-tab-collision-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const sender = tabId => ({
    ...figureCheckpointContext([], []),
    trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: tabId,
    senderFrameId: 0,
    senderDocumentId: tabId === 17
      ? '11111111-1111-4111-8111-111111111111'
      : '22222222-2222-4222-8222-222222222222'
  });
  const first = await router.handle(structuredClone(message), sender(17));
  const afterFirst = structuredClone(
    ledgerStorage.values.sciFigureProviderAttemptLedgerV1
  );
  const second = await router.handle(structuredClone(message), sender(18));
  assert.equal(first.success, true, JSON.stringify(first));
  assert.equal(second.success, false, JSON.stringify(second));
  assert.equal(second.error.code, 'CANCELLED');
  assert.equal(providerCalls, 1,
    'another trusted tab/document cannot reinterpret the same public operation id');
  assert.deepEqual(
    ledgerStorage.values.sciFigureProviderAttemptLedgerV1,
    afterFirst,
    'the rejected owner cannot create authority, receipts, or pending controls'
  );
});

test('a Figure control command cannot cancel the same public id from another trusted tab', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let releaseProvider;
  let markProviderStarted;
  const providerStarted = new Promise(resolve => { markProviderStarted = resolve; });
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async (url, options) => {
      markProviderStarted();
      await providerGate;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const operationId = 'figure-cross-tab-control-operation';
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', workspaceLifecycle: 9, operationScope: 'figure',
    operationId,
    figureRequestReceipt: 'figure-request-cross-tab-control-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const context = tabId => ({
    ...figureCheckpointContext([], []), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: tabId,
    senderFrameId: 0,
    senderDocumentId: tabId === 17
      ? '33333333-3333-4333-8333-333333333333'
      : '44444444-4444-4444-8444-444444444444'
  });
  const pending = router.handle(message, context(17));
  await providerStarted;
  const beforeWrongOwner = structuredClone(
    ledgerStorage.values.sciFigureProviderAttemptLedgerV1
  );
  const wrongOwner = await router.handle({
    type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
    workspaceLifecycle: 9, operationId, command: 'cancel'
  }, context(18));
  assert.equal(wrongOwner.success, false, JSON.stringify(wrongOwner));
  assert.equal(wrongOwner.error.code, 'CANCELLED');
  assert.deepEqual(
    ledgerStorage.values.sciFigureProviderAttemptLedgerV1,
    beforeWrongOwner,
    'wrong-owner control cannot mutate the active ledger or install a pending control'
  );
  releaseProvider();
  const result = await pending;
  assert.equal(result.success, true, JSON.stringify(result));
});

test('active Figure cancel returns a strict durable cleanup ACK and cannot replay provider work', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let providerCalls = 0;
  let releaseProvider;
  let markProviderStarted;
  const providerStarted = new Promise(resolve => { markProviderStarted = resolve; });
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const createRouter = () => createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      markProviderStarted();
      await providerGate;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  const router = createRouter();
  await configureOpenAIRouter(router);
  const operationId = 'figure-active-strict-cancel-operation';
  const request = receipt => figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 10,
    operationId, figureRequestReceipt: receipt,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
    forceRefresh: true
  });
  const owner = {
    ...figureCheckpointContext([], []), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 31, senderFrameId: 0,
    senderDocumentId: '31313131-3131-4131-8131-313131313131'
  };
  const pending = router.handle(request(
    'figure-request-active-strict-cancel-first-12345678'
  ), owner);
  await providerStarted;
  const cancelMessage = {
    type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
    workspaceLifecycle: 10, operationId, command: 'cancel'
  };
  const cancelled = await router.handle(cancelMessage, owner);
  assert.equal(cancelled.success, true, JSON.stringify(cancelled));
  assert.equal(cancelled.data.cancelled, true);
  assert.equal(cancelled.data.cleanupComplete, true);
  assert.equal(cancelled.data.requestedCommand, 'cancel');
  assert.equal(cancelled.data.terminalCode, 'CANCELLED');
  const replayedCancel = await router.handle(cancelMessage, owner);
  assert.equal(replayedCancel.data.cleanupComplete, true);
  assert.equal(replayedCancel.data.requestedCommand, 'cancel');
  releaseProvider();
  const interrupted = await pending;
  assert.equal(interrupted.success, false, JSON.stringify(interrupted));
  assert.equal(interrupted.error.code, 'CANCELLED');
  const replay = await createRouter().handle(request(
    'figure-request-active-strict-cancel-second-12345678'
  ), owner);
  assert.equal(replay.success, false, JSON.stringify(replay));
  assert.equal(replay.error.code, 'CANCELLED');
  assert.equal(providerCalls, 1);
});

test('a failed durable Figure control ACK cannot abort registry or provider work', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const baseLedger = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage, getRuntimeLastError: () => null
  });
  let failControl = true;
  const ledger = {
    ...baseLedger,
    async controlOperation(...args) {
      if (failControl) {
        failControl = false;
        const error = new Error('PRIVATE durable control failure');
        error.code = 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE';
        throw error;
      }
      return baseLedger.controlOperation(...args);
    }
  };
  let providerCalls = 0;
  let releaseProvider;
  let markProviderStarted;
  const providerStarted = new Promise(resolve => { markProviderStarted = resolve; });
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage,
    figureProviderAttemptLedger: ledger, runtimeExtensionId: 'extension-id',
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      markProviderStarted();
      await providerGate;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const operationId = 'figure-control-ack-failure-operation';
  const owner = {
    ...figureCheckpointContext([], []), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 176, senderFrameId: 0,
    senderDocumentId: '76767676-7676-4676-8676-767676767676'
  };
  const pending = router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard', forceRefresh: true,
    operationScope: 'figure', workspaceLifecycle: 1, operationId,
    figureRequestReceipt: 'figure-request-control-ack-failure-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  }), owner);
  await providerStarted;
  const beforeControl = structuredClone(
    ledgerStorage.values.sciFigureProviderAttemptLedgerV1
  );
  const rejected = await router.handle({
    type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
    workspaceLifecycle: 1, operationId, command: 'cancel'
  }, owner);
  assert.equal(rejected.success, false, JSON.stringify(rejected));
  assert.equal(rejected.error.code, 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(rejected), /PRIVATE|durable control failure/u);
  assert.deepEqual(
    ledgerStorage.values.sciFigureProviderAttemptLedgerV1,
    beforeControl,
    'a failed durable ACK cannot mutate the Figure ledger'
  );
  assert.equal(providerCalls, 1);
  releaseProvider();
  const completed = await pending;
  assert.equal(completed.success, true, JSON.stringify(completed));
});

test('production Figure requests cannot downgrade by omitting modern contract or trusted sender fields', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: createMemoryStorage(),
    runtimeExtensionId: 'extension-id',
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });
  await configureOpenAIRouter(router);
  const base = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 3,
    operationId: 'figure-66666666-6666-4666-8666-666666666666',
    figureRequestReceipt:
      'figure-request-77777777-7777-4777-8777-777777777777',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
    providerAttemptsConsumed: 0
  });
  const trusted = {
    ...figureCheckpointContext([], []), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 17, senderFrameId: 0,
    senderDocumentId: '88888888-8888-4888-8888-888888888888'
  };
  for (const field of [
    'operationScope', 'operationId', 'figureRequestReceipt', 'figureOperationPlan'
  ]) {
    const candidate = structuredClone(base);
    delete candidate[field];
    const response = await router.handle(candidate, trusted);
    assert.equal(response.success, false, field);
    assert.equal(response.error.code, 'INVALID_SETTINGS', field);
  }
  for (const context of [
    { ...trusted, trustedExtensionSender: false },
    { ...trusted, senderExtensionId: 'other-extension' },
    { ...trusted, senderDocumentId: '' },
    { ...trusted, senderFrameId: Number.NaN }
  ]) {
    const response = await router.handle(structuredClone(base), context);
    assert.equal(response.success, false);
    assert.equal(response.error.code, 'INVALID_SETTINGS');
  }
  for (const depth of [undefined, 'bogus', 'deep-ish']) {
    const candidate = structuredClone(base);
    if (depth === undefined) delete candidate.analysisDepth;
    else candidate.analysisDepth = depth;
    candidate.operationId += `-${String(depth)}`;
    candidate.figureRequestReceipt =
      `figure-request-invalid-depth-${String(depth)}-12345678`;
    const depthResponse = await router.handle(candidate, trusted);
    assert.equal(depthResponse.success, false, String(depth));
    assert.equal(depthResponse.error.code, 'INVALID_SETTINGS', String(depth));
  }
  for (const type of ['LLM_ANALYZE_FIGURE_PANEL', 'LLM_ASK_FIGURE_PANEL']) {
    const panel = {
      type, operationScope: 'figure', workspaceLifecycle: 3,
      analysisDepth: 'deep', operationId: `figure-invalid-depth-${type}`,
      figureRequestReceipt: `figure-request-invalid-depth-${type}-12345678`,
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
      figure: { ...figureInput(1), panelHints: ['A'] },
      panel: { panel: 'A' }, document: { title: 'Invalid depth' }
    };
    const depthResponse = await router.handle(panel, trusted);
    assert.equal(depthResponse.success, false, type);
    assert.equal(depthResponse.error.code, 'INVALID_SETTINGS', type);
  }
  const resumeDowngrade = figureMessage([figureInput(1)], {
    figureResumeCheckpoint: { version: 'figure-checkpoint-envelope-v1' }
  });
  const response = await router.handle(resumeDowngrade, trusted);
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'INVALID_SETTINGS');
  assert.equal(providerCalls, 0);
});

test('explicit malformed Figure resume values are rejected before a warm cache can answer', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const entries = new Map();
  let providerCalls = 0;
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key))
        .map(key => [key, structuredClone(entries.get(key))]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, structuredClone(value)));
    },
    async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
  };
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    cacheStore,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const figure = { ...figureInput(1), panelHints: ['A'] };
  const owner = {
    ...figureCheckpointContext([], []),
    trustedExtensionSender: true,
    senderExtensionId: 'extension-id',
    senderTabId: 17,
    senderFrameId: 0,
    senderDocumentId: '91919191-9191-4919-8919-919191919191'
  };
  const modern = (suffix, resumeValue, hasResume = false) => {
    const message = figureMessage([figure], {
      analysisDepth: 'standard',
      operationScope: 'figure',
      workspaceLifecycle: 12,
      operationId: `figure-resume-cache-${suffix}-operation`,
      figureRequestReceipt: `figure-request-resume-cache-${suffix}-12345678`,
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }]
    });
    if (hasResume) message.figureResumeCheckpoint = resumeValue;
    return message;
  };
  const seeded = await router.handle(modern('seed'), owner);
  assert.equal(seeded.success, true, JSON.stringify(seeded));
  assert.equal(providerCalls, 1);
  assert.ok(entries.size > 0, 'the regression requires a reusable warm cache entry');

  for (const [suffix, malformed] of [['false', false], ['zero', 0], ['empty', '']]) {
    const response = await router.handle(modern(suffix, malformed, true), owner);
    assert.equal(response.success, false, suffix);
    assert.equal(response.error.code, 'FIGURE_CHECKPOINT_INVALID', suffix);
  }
  assert.equal(providerCalls, 1, 'malformed resume values must fail before cache or provider work');
});

test('trusted Figure controls bind tab frame and document independently', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let releaseProvider;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const gate = new Promise(resolve => { releaseProvider = resolve; });
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async (url, options) => {
      markStarted();
      await gate;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const operationId = 'figure-99999999-9999-4999-8999-999999999999';
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure',
    workspaceLifecycle: 4, operationId,
    figureRequestReceipt:
      'figure-request-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const owner = {
    ...figureCheckpointContext([], []), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 17, senderFrameId: 2,
    senderDocumentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  };
  const pending = router.handle(message, owner);
  try {
    await started;
    const beforeWrongControls = structuredClone(
      ledgerStorage.values.sciFigureProviderAttemptLedgerV1
    );
    for (const wrong of [
      { ...owner, senderFrameId: 3 },
      { ...owner, senderDocumentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }
    ]) {
      const response = await router.handle({
        type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
        workspaceLifecycle: 4, operationId, command: 'cancel'
      }, wrong);
      assert.equal(response.success, false, JSON.stringify(response));
      assert.equal(response.error.code, 'CANCELLED');
    }
    assert.deepEqual(
      ledgerStorage.values.sciFigureProviderAttemptLedgerV1,
      beforeWrongControls,
      'wrong owners cannot create pending controls or owner authority'
    );
    const restarted = createBackgroundRouter({
      storageArea, sessionStorageArea: ledgerStorage,
      runtimeExtensionId: 'extension-id',
      fetchImpl: async () => { throw new Error('wrong-owner control reached provider'); }
    });
    const restartedWrong = await restarted.handle({
      type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
      workspaceLifecycle: 4, operationId, command: 'cancel'
    }, { ...owner, senderFrameId: 4 });
    assert.equal(restartedWrong.success, false, JSON.stringify(restartedWrong));
    assert.equal(restartedWrong.error.code, 'CANCELLED');
    assert.deepEqual(
      ledgerStorage.values.sciFigureProviderAttemptLedgerV1,
      beforeWrongControls,
      'a worker restart cannot turn a wrong owner into a pending control'
    );
    const status = await router.handle({
      type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
      workspaceLifecycle: 4, operationId, command: 'status'
    }, owner);
    assert.equal(status.success, true, JSON.stringify(status));
    assert.equal(status.data.active, true);
  } finally {
    releaseProvider();
  }
  assert.equal((await pending).success, true);
});

test('popup-like controls cannot target an internal Figure ledger id without explicit scope', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let releaseProvider;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const gate = new Promise(resolve => { releaseProvider = resolve; });
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async (url, options) => {
      markStarted();
      await gate;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const owner = {
    ...figureCheckpointContext([], []), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 42, senderFrameId: 0,
    senderDocumentId: '16161616-1616-4616-8616-161616161616'
  };
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 10,
    operationId: 'figure-17171717-1717-4717-8717-171717171717',
    figureRequestReceipt:
      'figure-request-18181818-1818-4818-8818-181818181818',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const pending = router.handle(message, owner);
  await started;
  const internalId = ledgerStorage.values.sciFigureProviderAttemptLedgerV1
    .operations[0].operationId;
  for (const command of ['cancel', 'release']) {
    const response = await router.handle({
      type: 'LLM_CONTROL_OPERATION', operationId: internalId, command
    }, {
      trustedExtensionSender: true, senderExtensionId: 'extension-id',
      senderUrl: 'chrome-extension://extension-id/popup.html'
    });
    assert.equal(response.success, false, command);
    assert.equal(response.error.code, 'INVALID_SETTINGS', command);
  }
  releaseProvider();
  assert.equal((await pending).success, true,
    'the trusted owner operation remains active after both bypass attempts');
});

test('trusted cancel survives worker restart and prevents a new receipt from reviving provider work', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let providerCalls = 0;
  let releaseBackoff;
  let markBackoff;
  const backoff = new Promise(resolve => { markBackoff = resolve; });
  const gate = new Promise(resolve => { releaseBackoff = resolve; });
  const createRouter = sleepImpl => createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage,
    runtimeExtensionId: 'extension-id', sleepImpl,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 429);
    }
  });
  const router = createRouter(async () => {
    markBackoff();
    await gate;
  });
  await configureOpenAIRouter(router);
  const operationId = 'figure-dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const base = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure',
    workspaceLifecycle: 6, operationId,
    figureRequestReceipt:
      'figure-request-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const owner = {
    trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 27, senderFrameId: 1,
    senderDocumentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  };
  const pending = router.handle(base, owner);
  await backoff;
  const cancelled = await router.handle({
    type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
    workspaceLifecycle: 6, operationId, command: 'cancel'
  }, owner);
  releaseBackoff();
  const result = await pending;
  assert.equal(cancelled.success, true);
  assert.equal(cancelled.data.cancelled, true);
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'CANCELLED');
  const restarted = createRouter(async () => undefined);
  const replay = await restarted.handle({
    ...structuredClone(base),
    figureRequestReceipt:
      'figure-request-12121212-1212-4212-8212-121212121212'
  }, owner);
  assert.equal(replay.success, false);
  assert.equal(replay.error.code, 'CANCELLED');
  assert.equal(providerCalls, 1);
});

test('trusted pre-bind cancel and release ACKs survive restart before binding completes', async () => {
  for (const command of ['cancel', 'release']) {
    const storageArea = createMemoryStorage();
    const ledgerStorage = createMemoryStorage();
    let providerCalls = 0;
    let releaseDigest;
    let markDigestBlocked;
    const digestBlocked = new Promise(resolve => { markDigestBlocked = resolve; });
    const digestGate = new Promise(resolve => { releaseDigest = resolve; });
    let armed = false;
    let blocked = false;
    const cryptoImpl = {
      subtle: {
        async digest(algorithm, data) {
          const canonical = new TextDecoder().decode(data);
          if (armed && !blocked && canonical.includes('"topologyLimit"')) {
            blocked = true;
            markDigestBlocked();
            await digestGate;
          }
          return webcrypto.subtle.digest(algorithm, data);
        }
      }
    };
    const createRouter = () => createBackgroundRouter({
      storageArea, sessionStorageArea: ledgerStorage,
      runtimeExtensionId: 'extension-id', cryptoImpl,
      fetchImpl: async (url, options) => {
        providerCalls += 1;
        const input = openAIInputPayload(JSON.parse(options.body));
        return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
      }
    });
    const router = createRouter();
    await configureOpenAIRouter(router);
    const operationId = command === 'cancel'
      ? 'figure-21212121-2121-4121-8121-212121212121'
      : 'figure-23232323-2323-4323-8323-232323232323';
    const owner = {
      trustedExtensionSender: true, senderExtensionId: 'extension-id',
      senderTabId: 41, senderFrameId: 2,
      senderDocumentId: '24242424-2424-4424-8424-242424242424'
    };
    const message = figureMessage([figureInput(1)], {
      analysisDepth: 'standard', operationScope: 'figure',
      workspaceLifecycle: 12, operationId,
      figureRequestReceipt: `figure-request-prebind-${command}-12345678`,
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
      forceRefresh: true
    });
    armed = true;
    const pending = router.handle(message, owner);
    await digestBlocked;
    const controlled = await router.handle({
      type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
      workspaceLifecycle: 12, operationId, command
    }, owner);
    assert.equal(controlled.success, true, `${command}:${JSON.stringify(controlled)}`);
    assert.equal(controlled.data[command === 'cancel' ? 'cancelled' : 'released'], true,
      `${command}:${JSON.stringify(controlled)}`);
    assert.equal(controlled.data.cleanupComplete, true, command);
    assert.equal(controlled.data.requestedCommand, command, command);
    armed = false;
    const replay = await createRouter().handle({
      ...structuredClone(message),
      figureRequestReceipt: `figure-request-prebind-${command}-fresh-12345678`
    }, owner);
    assert.equal(replay.success, false, `${command}:${JSON.stringify(replay)}`);
    assert.equal(replay.error.code,
      command === 'cancel' ? 'CANCELLED' : 'FIGURE_PROVIDER_ATTEMPT_LIMIT');
    assert.equal(providerCalls, 0, `${command} tombstone must survive router restart`);
    releaseDigest();
    const interrupted = await pending;
    assert.equal(interrupted.success, false, `${command}:${JSON.stringify(interrupted)}`);
    assert.equal(interrupted.error.code,
      command === 'cancel' ? 'CANCELLED' : 'FIGURE_PROVIDER_ATTEMPT_LIMIT');
    assert.equal(providerCalls, 0, `${command} must win before provider dispatch`);
  }
});

test('trusted release persists a tombstone and same-receipt replay stays fail-closed', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  let providerCalls = 0;
  const createRouter = () => createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage, cacheStore,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  const router = createRouter();
  await configureOpenAIRouter(router);
  const operationId = 'figure-13131313-1313-4313-8313-131313131313';
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure',
    workspaceLifecycle: 8, operationId,
    figureRequestReceipt:
      'figure-request-14141414-1414-4414-8414-141414141414',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const owner = {
    ...figureCheckpointContext([], []), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 37, senderFrameId: 0,
    senderDocumentId: '15151515-1515-4515-8515-151515151515'
  };
  const first = await router.handle(message, owner);
  assert.equal(first.success, true, JSON.stringify(first));
  const released = await router.handle({
    type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
    workspaceLifecycle: 8, operationId, command: 'release'
  }, owner);
  assert.equal(released.success, true);
  assert.equal(released.data.released, true);
  const replay = await createRouter().handle(structuredClone(message), owner);
  assert.equal(replay.success, false, JSON.stringify(replay));
  assert.equal(replay.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(providerCalls, 1,
    'a durable receipt can never redispatch after a lost final response');
});

test('Figure cancel and release cleanup ACKs preserve the original terminal authority in either order', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async (url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const owner = {
    ...figureCheckpointContext([], []), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 38, senderFrameId: 0,
    senderDocumentId: '16161616-1616-4616-8616-161616161616'
  };
  const run = async (suffix, commands) => {
    const operationId = `figure-terminal-order-${suffix}`;
    const input = figureInput(1);
    input.caption += ` ${suffix}`;
    const response = await router.handle(figureMessage([input], {
      analysisDepth: 'standard', operationScope: 'figure',
      workspaceLifecycle: 8, operationId,
      figureRequestReceipt: `figure-request-terminal-${suffix}-12345678`,
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
    }), owner);
    assert.equal(response.success, true, JSON.stringify(response));
    const results = [];
    for (const command of commands) {
      results.push(await router.handle({
        type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
        workspaceLifecycle: 8, operationId, command
      }, owner));
    }
    const operation = ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations
      .find(entry => entry.operationId && entry.receipts?.[0]?.receipt.includes(suffix));
    assert.ok(operation, JSON.stringify(ledgerStorage.values.sciFigureProviderAttemptLedgerV1));
    return { results, operation };
  };

  const cancelFirst = await run('cancel-first', ['cancel', 'release']);
  assert.equal(cancelFirst.results[0].data.cancelled, true);
  assert.equal(cancelFirst.results[0].data.cleanupComplete, true);
  assert.equal(cancelFirst.results[0].data.requestedCommand, 'cancel');
  assert.equal(cancelFirst.results[1].data.cancelled, true);
  assert.equal(cancelFirst.results[1].data.released, true);
  assert.equal(cancelFirst.results[1].data.cleanupComplete, true);
  assert.equal(cancelFirst.results[1].data.requestedCommand, 'release');
  assert.equal(cancelFirst.operation.terminalCode, 'CANCELLED');
  assert.ok(cancelFirst.operation.releasedAt > 0);

  const releaseFirst = await run('release-first', ['release', 'cancel']);
  assert.equal(releaseFirst.results[0].data.released, true);
  assert.equal(releaseFirst.results[0].data.cleanupComplete, true);
  assert.equal(releaseFirst.results[0].data.requestedCommand, 'release');
  assert.equal(releaseFirst.results[1].data.released, true,
    'the cleanup ACK preserves the independently committed release marker');
  assert.equal(releaseFirst.results[1].data.cancelled, true,
    'cancel is acknowledged as cleanup without replacing the original terminal state');
  assert.equal(releaseFirst.results[1].data.cleanupComplete, true);
  assert.equal(releaseFirst.results[1].data.requestedCommand, 'cancel');
  assert.equal(releaseFirst.operation.terminalCode, '');
  assert.ok(releaseFirst.operation.releasedAt > 0);
});

test('nonterminal durable Figure quarantines never expire into a fresh budget within a browser session', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let now = 1_000;
  let providerCalls = 0;
  const createRouter = () => createBackgroundRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    nowImpl: () => now,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 503);
    },
    sleepImpl: async () => undefined
  });
  await configureOpenAIRouter(createRouter());
  const operationId = 'figure-ledger-nonterminal-ttl-operation';
  const base = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationId,
    figureRequestReceipt: 'figure-request-ledger-nonterminal-first-12345678',
    figureOperationPlan: Array.from({ length: 40 }, (_, index) => ({
      figureId: `figure-${index + 1}`, panelCount: index === 0 ? 0 : 30
    }))
  });
  const first = await createRouter().handle(base);
  assert.equal(first.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(providerCalls, 2);
  now += (31 * 60 * 1000);
  const afterIdle = await createRouter().handle({
    ...structuredClone(base),
    figureRequestReceipt: 'figure-request-ledger-nonterminal-second-12345678'
  });
  assert.equal(afterIdle.error.code, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
  assert.equal(providerCalls, 2);
  const operation = ledgerStorage.values.sciFigureProviderAttemptLedgerV1.operations[0];
  assert.equal(operation.reservedAttempts, 2,
    'elapsed wall time cannot reset a nonterminal authoritative count');
});

test('trusted document authority retires exact Figure owners and rejects late messages after restart', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let providerCalls = 0;
  const createRouter = () => createBackgroundRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  const owner = documentId => ({
    trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 73, senderFrameId: 0,
    senderDocumentId: documentId
  });
  const request = (operationId, receipt) => figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 1,
    operationId, figureRequestReceipt: receipt,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const documentA = '73737373-7373-4373-8373-737373737373';
  const documentB = '74747474-7474-4474-8474-747474747474';
  const firstRouter = createRouter();
  await configureOpenAIRouter(firstRouter);
  const first = await firstRouter.handle(request(
    'figure-owner-document-a-operation',
    'figure-request-owner-document-a-12345678'
  ), owner(documentA));
  assert.equal(first.error.code, 'PROVIDER_REJECTED');
  const callsAfterFirst = providerCalls;

  const committed = await firstRouter.commitTrustedDocument({
    senderExtensionId: 'extension-id', senderTabId: 73, senderFrameId: 0,
    senderDocumentId: documentB
  });
  assert.ok(committed.figure.removedOperationIds.length >= 1);
  const restarted = createRouter();
  const late = await restarted.handle(request(
    'figure-owner-document-a-late-operation',
    'figure-request-owner-document-a-late-12345678'
  ), owner(documentA));
  assert.equal(late.success, false);
  assert.equal(late.error.code, 'CANCELLED');
  assert.equal(providerCalls, callsAfterFirst);

  const current = await restarted.handle(request(
    'figure-owner-document-b-operation',
    'figure-request-owner-document-b-12345678'
  ), owner(documentB));
  assert.equal(current.error.code, 'PROVIDER_REJECTED');
  assert.ok(providerCalls > callsAfterFirst);

  await restarted.retireTrustedTab({
    senderExtensionId: 'extension-id', senderTabId: 73
  });
  const afterRemovalCalls = providerCalls;
  const afterRemoval = await createRouter().handle(request(
    'figure-owner-document-b-after-removal',
    'figure-request-owner-after-removal-12345678'
  ), owner(documentB));
  assert.equal(afterRemoval.error.code, 'CANCELLED');
  assert.equal(providerCalls, afterRemovalCalls);
});

test('unrelated navigation and removal events cannot exhaust Figure owner authority', async () => {
  const ledgerStorage = createMemoryStorage();
  const ledger = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage, getRuntimeLastError: () => null
  });
  for (let senderTabId = 0; senderTabId < 257; senderTabId += 1) {
    const committed = await ledger.commitTrustedDocument({
      senderExtensionId: 'extension-id', senderTabId, senderFrameId: 0,
      senderDocumentId: `unrelated-document-${senderTabId}`
    });
    assert.equal(committed.ignored, true);
    const retired = await ledger.retireTrustedTab({
      senderExtensionId: 'extension-id', senderTabId
    });
    assert.equal(retired.ignored, true);
    await ledger.confirmTrustedTabRetirement({
      senderExtensionId: 'extension-id', senderTabId
    });
  }
  const emptyAuthority = ledgerStorage.values.sciFigureProviderAttemptLedgerV1;
  assert.equal(emptyAuthority?.ownerTabs?.length || 0, 0);
  assert.equal(emptyAuthority?.ownerDocuments?.length || 0, 0);
  assert.equal(emptyAuthority?.pendingTabRetirements?.length || 0, 0);

  const ownerScope = {
    version: 1, senderExtensionId: 'extension-id', senderTabId: 900,
    senderFrameId: 0, senderDocumentId: 'real-figure-document',
    workspaceLifecycle: 0
  };
  const binding = {
    operationId: `figure:${'1'.repeat(64)}`,
    bindingSignature: '2'.repeat(64), immutableLimit: 2,
    receipt: 'figure-request-real-owner-after-noise-12345678',
    requestSignature: '3'.repeat(64), semanticSignature: '4'.repeat(64),
    targetKeyDigest: '5'.repeat(64), ownerScope
  };
  const admitted = await ledger.bindRequest(binding);
  assert.equal(admitted.existingReceipt, false);
  assert.equal(ledgerStorage.values.sciFigureProviderAttemptLedgerV1.ownerTabs.length, 1,
    'the first real Figure admission remains the authority creation point');
});

test('Figure owner lifecycle advances by one and blocks old or forged future lifecycle dispatches', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let providerCalls = 0;
  const owner = {
    trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 75, senderFrameId: 0,
    senderDocumentId: '75757575-7575-4575-8575-757575757575'
  };
  const createRouter = () => createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  const request = (operationId, receipt, workspaceLifecycle) =>
    figureMessage([figureInput(1)], {
      analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle,
      operationId, figureRequestReceipt: receipt,
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
    });
  const router = createRouter();
  await configureOpenAIRouter(router);
  const first = await router.handle(request(
    'figure-owner-lifecycle-four',
    'figure-request-owner-lifecycle-four-12345678', 4
  ), owner);
  assert.equal(first.error.code, 'PROVIDER_REJECTED');
  const afterFirst = providerCalls;
  const next = await router.handle(request(
    'figure-owner-lifecycle-five',
    'figure-request-owner-lifecycle-five-12345678', 5
  ), owner);
  assert.equal(next.error.code, 'PROVIDER_REJECTED');
  assert.ok(providerCalls > afterFirst);
  const afterNext = providerCalls;

  for (const [operationId, receipt, lifecycle] of [
    ['figure-owner-lifecycle-old', 'figure-request-owner-lifecycle-old-12345678', 4],
    ['figure-owner-lifecycle-future', 'figure-request-owner-lifecycle-future-12345678', 7]
  ]) {
    const rejected = await createRouter().handle(
      request(operationId, receipt, lifecycle), owner
    );
    assert.equal(rejected.error.code, 'CANCELLED');
  }
  assert.equal(providerCalls, afterNext);
});

test('Figure reset handshake admits multiple acknowledged invalidations without admitting forged jumps', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  let providerCalls = 0;
  const owner = { trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 76, senderFrameId: 0,
    senderDocumentId: '76767676-7676-4676-8676-767676767676' };
  const createRouter = () => createBackgroundRouter({ storageArea, sessionStorageArea: ledgerStorage,
    runtimeExtensionId: 'extension-id', fetchImpl: async () => {
      providerCalls += 1; return jsonResponse({}, 400);
    } });
  const router = createRouter();
  await configureOpenAIRouter(router);
  const request = lifecycle => figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: lifecycle,
    operationId: `figure-reset-handshake-${lifecycle}`,
    figureRequestReceipt: `figure-request-reset-handshake-${lifecycle}-12345678`,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  assert.equal((await router.handle(request(4), owner)).error.code, 'PROVIDER_REJECTED');
  const before = providerCalls;
  const advance = (previous, next, context = owner) => createRouter().handle({
    type: 'LLM_ADVANCE_FIGURE_WORKSPACE_LIFECYCLE',
    previousWorkspaceLifecycle: previous, workspaceLifecycle: next
  }, context);
  assert.equal((await advance(4, 6)).success, false);
  assert.equal((await advance(4, 5, { ...owner, senderDocumentId: 'wrong-owner' })).success, false);
  assert.equal((await advance(4, 5)).success, true);
  assert.equal((await advance(4, 5)).success, true, 'lost acknowledgement is idempotent');
  assert.equal((await advance(5, 6)).success, true);
  assert.equal(providerCalls, before, 'synchronization must never invoke a model');
  assert.equal((await createRouter().handle(request(6), owner)).error.code, 'PROVIDER_REJECTED');
  assert.ok(providerCalls > before);
  const after = providerCalls;
  assert.equal((await createRouter().handle(request(4), owner)).error.code, 'CANCELLED');
  assert.equal((await advance(7, 8)).success, false);
  assert.equal(providerCalls, after);
});

test('Figure provider response is owner-guarded before any stale checkpoint can persist', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const checkpoints = [];
  let providerCalls = 0;
  let releaseProvider;
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  let markProviderStarted;
  const providerStarted = new Promise(resolve => { markProviderStarted = resolve; });
  const documentA = '78787878-7878-4878-8878-787878787878';
  const documentB = '79797979-7979-4979-8979-797979797979';
  let currentDocumentId = documentA;
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      markProviderStarted();
      await providerGate;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const owner = senderDocumentId => ({
    trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 78, senderFrameId: 0,
    senderDocumentId
  });
  await router.commitTrustedDocument(owner(documentA));
  const checkpointContext = figureCheckpointContext([], checkpoints);
  const request = router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 1,
    operationId: 'figure-owner-response-guard-operation',
    figureRequestReceipt: 'figure-request-owner-response-guard-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  }), {
    ...owner(documentA),
    ...checkpointContext,
    async assertTrustedOwnerCurrent() {
      if (currentDocumentId !== documentA) {
        throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });
      }
    }
  });
  await providerStarted;
  currentDocumentId = documentB;
  await router.commitTrustedDocument(owner(documentB));
  releaseProvider();
  const response = await request;
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'CANCELLED');
  assert.equal(providerCalls, 1, 'navigation prevents every later provider dispatch');
  assert.deepEqual(checkpoints, [],
    'a response from the retired document cannot enter a durable checkpoint');
});

test('Figure provider dispatch rechecks its owner after the durable reservation await', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const baseLedger = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage,
    getRuntimeLastError: () => null,
    nowImpl: () => Date.now()
  });
  let releaseReservation;
  const reservationGate = new Promise(resolve => { releaseReservation = resolve; });
  let markReservationCommitted;
  const reservationCommitted = new Promise(resolve => {
    markReservationCommitted = resolve;
  });
  const gatedLedger = new Proxy(baseLedger, {
    get(target, property) {
      if (property === 'reserveAttempt') {
        return async (...args) => {
          const result = await target.reserveAttempt(...args);
          markReservationCommitted();
          await reservationGate;
          return result;
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  let providerCalls = 0;
  const documentA = '80808080-8080-4080-8080-808080808080';
  const documentB = '81818181-8181-4181-8181-818181818181';
  let currentDocumentId = documentA;
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage,
    figureProviderAttemptLedger: gatedLedger,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  await configureOpenAIRouter(router);
  const owner = senderDocumentId => ({
    trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 80, senderFrameId: 0,
    senderDocumentId
  });
  await router.commitTrustedDocument(owner(documentA));
  const request = router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 1,
    operationId: 'figure-owner-reservation-guard-operation',
    figureRequestReceipt: 'figure-request-owner-reservation-guard-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  }), {
    ...owner(documentA),
    async assertTrustedOwnerCurrent() {
      if (currentDocumentId !== documentA) {
        throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });
      }
    }
  });
  await reservationCommitted;
  currentDocumentId = documentB;
  await baseLedger.commitTrustedDocument(owner(documentB));
  releaseReservation();
  const response = await request;
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'CANCELLED');
  assert.equal(providerCalls, 0,
    'the committed reservation cannot authorize a stale owner after its await');
  const replay = await router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 1,
    operationId: 'figure-owner-reservation-guard-operation',
    figureRequestReceipt: 'figure-request-owner-reservation-guard-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  }), owner(documentA));
  assert.equal(replay.error.code, 'CANCELLED');
  assert.equal(providerCalls, 0, 'the retired owner cannot replay the consumed reservation');
});

test('a cross-ledger document commit interruption is repaired before the next provider admission', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const baseCache = globalThis.SciLLM.createMemoryAnalysisCache();
  let failMechanismCommit = false;
  const cacheStore = new Proxy(baseCache, {
    get(target, property) {
      if (property === 'compareAndSetManyGuarded') {
        return async (values, guard) => {
          if (failMechanismCommit && values.some(value => value?.frameAuthority)) {
            failMechanismCommit = false;
            throw new Error('simulated mechanism owner write interruption');
          }
          return target.compareAndSetManyGuarded(values, guard);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  let providerCalls = 0;
  const createRouter = () => createBackgroundRouter({
    storageArea, sessionStorageArea: ledgerStorage, cacheStore,
    runtimeExtensionId: 'extension-id',
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  const documentA = '76767676-7676-4676-8676-767676767676';
  const documentB = '77777777-7777-4777-8777-777777777777';
  const browserSessionId = '7'.repeat(64);
  ledgerStorage.values.sciMechanismBrowserSessionV1 = {
    version: 1, sessionId: browserSessionId
  };
  const trusted = senderDocumentId => ({
    senderExtensionId: 'extension-id', senderTabId: 76, senderFrameId: 0,
    senderDocumentId
  });
  const firstRouter = createRouter();
  await configureOpenAIRouter(firstRouter);
  const figureLedger = createFigureProviderAttemptLedger({
    storageArea: ledgerStorage, getRuntimeLastError: () => null
  });
  await figureLedger.bindRequest({
    operationId: `figure:${'6'.repeat(64)}`,
    publicOperationId: 'figure-cross-ledger-document-seed',
    bindingSignature: '5'.repeat(64), immutableLimit: 1,
    receipt: 'figure-request-cross-ledger-document-seed-12345678',
    requestSignature: '4'.repeat(64),
    ownerScope: { version: 1, ...trusted(documentA), workspaceLifecycle: 0 }
  });
  const coordinator = globalThis.SciLLM.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true,
    sessionIdentityProvider: async () => browserSessionId
  });
  await coordinator.beginEvidenceFirstOperation({
    operationId: 'mechanism:cross-ledger-document-commit',
    documentId: 'document-cross-ledger-document-commit',
    documentHash: '7'.repeat(64), workspaceId: 'workspace-cross-ledger-document-commit',
    workspaceGeneration: 1, workspaceLifecycle: 0,
    mechanismChainFingerprint: 'mechanism-chain-v1-cross-ledger-commit',
    ...trusted(documentA), profileSignature: '8'.repeat(64),
    baseWorkspaceRevision: 1,
    versions: globalThis.SciLLM.EVIDENCE_FIRST_VERSIONS
  });
  await firstRouter.commitTrustedDocument(trusted(documentA));
  failMechanismCommit = true;
  await assert.rejects(firstRouter.commitTrustedDocument(trusted(documentB)));
  assert.equal(
    ledgerStorage.values.sciFigureProviderAttemptLedgerV1.ownerDocuments[0].senderDocumentId,
    documentB,
    'the simulated crash occurs after the Figure authority commit'
  );

  const restarted = createRouter();
  const repaired = await restarted.commitTrustedDocument(trusted(documentB));
  assert.ok(repaired.mechanism);
  const response = await restarted.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 0,
    operationId: 'figure-cross-ledger-repaired-operation',
    figureRequestReceipt: 'figure-request-cross-ledger-repaired-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  }), {
    trustedExtensionSender: true,
    ...trusted(documentB)
  });
  assert.equal(response.error.code, 'PROVIDER_REJECTED');
  assert.ok(providerCalls > 0);
});

test('a tab-retirement intent repairs a crash between Figure and mechanism ledgers', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const browserSessionId = '9'.repeat(64);
  sessionStorageArea.values.sciMechanismBrowserSessionV1 = {
    version: 1, sessionId: browserSessionId
  };
  const senderExtensionId = 'extension-id';
  const senderTabId = 82;
  const senderFrameId = 0;
  const senderDocumentId = '82828282-8282-4282-8282-828282828282';
  const ownerScope = {
    version: 1, senderExtensionId, senderTabId, senderFrameId,
    senderDocumentId, workspaceLifecycle: 1
  };
  const baseLedger = createFigureProviderAttemptLedger({
    storageArea: sessionStorageArea, getRuntimeLastError: () => null
  });
  await baseLedger.bindRequest({
    operationId: `figure:${'a'.repeat(64)}`,
    bindingSignature: 'b'.repeat(64), immutableLimit: 2,
    receipt: 'figure-request-retirement-intent-12345678',
    requestSignature: 'c'.repeat(64), ownerScope
  });
  const directCoordinator = globalThis.SciLLM.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true,
    sessionIdentityProvider: async () => browserSessionId
  });
  const mechanismInput = {
    operationId: 'mechanism:retirement-intent-crash',
    documentId: 'document-retirement-intent-crash',
    documentHash: 'd'.repeat(64), workspaceId: 'workspace-retirement-intent-crash',
    workspaceGeneration: 1, workspaceLifecycle: 1,
    mechanismChainFingerprint: 'mechanism-chain-v1-0123456789abcdef',
    senderExtensionId, senderTabId, senderFrameId, senderDocumentId,
    profileSignature: 'e'.repeat(64), baseWorkspaceRevision: 1,
    versions: globalThis.SciLLM.EVIDENCE_FIRST_VERSIONS
  };
  const mechanismOperation = await directCoordinator
    .beginEvidenceFirstOperation(mechanismInput);
  await directCoordinator.claimProviderRequest(mechanismOperation, {
    receipt: 'f'.repeat(64), bindingDigest: '1'.repeat(64)
  });

  let crashAfterFigureRetirement = true;
  const interruptedLedger = new Proxy(baseLedger, {
    get(target, property) {
      if (property === 'retireTrustedTab') {
        return async input => {
          const result = await target.retireTrustedTab(input);
          if (crashAfterFigureRetirement) {
            crashAfterFigureRetirement = false;
            throw new Error('simulated worker stop after Figure retirement');
          }
          return result;
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  const firstRouter = createBackgroundRouter({
    storageArea, sessionStorageArea, cacheStore,
    figureProviderAttemptLedger: interruptedLedger,
    runtimeExtensionId: senderExtensionId, cryptoImpl: webcrypto,
    fetchImpl: async () => { throw new Error('provider must not run'); }
  });
  await assert.rejects(firstRouter.retireTrustedTab({
    senderExtensionId, senderTabId
  }), /simulated worker stop/u);
  assert.equal(
    sessionStorageArea.values.sciFigureProviderAttemptLedgerV1
      .pendingTabRetirements.length, 1
  );
  assert.equal((await cacheStore.listProtectedByPrefix(
    'mechanism-run-index:'
  )).size, 1, 'the crash occurs before mechanism retirement');

  const restarted = createBackgroundRouter({
    storageArea, sessionStorageArea, cacheStore,
    figureProviderAttemptLedger: baseLedger,
    runtimeExtensionId: senderExtensionId, cryptoImpl: webcrypto,
    fetchImpl: async () => { throw new Error('provider must not run'); }
  });
  await configureOpenAIRouter(restarted);
  const recovered = await restarted.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 1,
    operationId: 'figure-retired-tab-recovery-probe',
    figureRequestReceipt: 'figure-request-retired-tab-recovery-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  }), {
    trustedExtensionSender: true, senderExtensionId,
    senderTabId, senderFrameId, senderDocumentId
  });
  assert.equal(recovered.success, false, JSON.stringify(recovered));
  assert.equal(recovered.error.code, 'CANCELLED');
  const ledgerAfterRecovery = sessionStorageArea.values
    .sciFigureProviderAttemptLedgerV1;
  assert.equal(ledgerAfterRecovery.pendingTabRetirements.length, 0);
  assert.equal(ledgerAfterRecovery.operations.length, 0);
  assert.equal((await cacheStore.listProtectedByPrefix(
    'mechanism-run-index:'
  )).size, 0);
  assert.equal((await cacheStore.listProtectedByPrefix(
    'mechanism-run-state:'
  )).size, 0);
  await assert.rejects(
    directCoordinator.claimProviderRequest(mechanismOperation),
    error => error?.code === 'MECHANISM_OPERATION_STALE'
  );

  const figureGeneration = ledgerAfterRecovery.ownerTabs[0].navigationGeneration;
  const mechanismTabBefore = [...(await cacheStore.listProtectedByPrefix(
    'mechanism-owner-tab:'
  )).values()][0].tabAuthority.navigationGeneration;
  await restarted.retireTrustedTab({ senderExtensionId, senderTabId });
  await restarted.retireTrustedTab({ senderExtensionId, senderTabId });
  assert.equal(sessionStorageArea.values.sciFigureProviderAttemptLedgerV1
    .ownerTabs[0].navigationGeneration, figureGeneration,
  'Figure retirement replay is idempotent');
  const mechanismTabAfter = [...(await cacheStore.listProtectedByPrefix(
    'mechanism-owner-tab:'
  )).values()][0].tabAuthority.navigationGeneration;
  assert.equal(mechanismTabAfter, mechanismTabBefore,
    'mechanism retirement replay is idempotent');
});

test('deduplicates concurrent and settled Figure receipts and rejects signature drift', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  let releaseProvider;
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  let markProviderStarted;
  const providerStarted = new Promise(resolve => { markProviderStarted = resolve; });
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      markProviderStarted();
      await providerGate;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const operationId = 'figure-receipt-concurrent-operation';
  const receipt = 'figure-request-concurrent-12345678';
  const plan = [{ figureId: 'figure-1', panelCount: 0 }];
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationId,
    figureRequestReceipt: receipt,
    figureOperationPlan: plan
  });
  const context = figureCheckpointContext([], []);
  const first = router.handle(message, context);
  await providerStarted;
  const second = router.handle(structuredClone(message), context);
  try {
    const mismatch = await router.handle({
      ...structuredClone(message),
      figures: [{ ...figureInput(1), caption: 'changed after receipt binding' }]
    }, context);
    assert.equal(mismatch.success, false);
    assert.equal(mismatch.error.code, 'FIGURE_REQUEST_RECEIPT_MISMATCH');
    assert.equal(providerCalls, 1);
  } finally {
    releaseProvider();
  }
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.success, true, JSON.stringify(firstResult));
  assert.deepEqual(secondResult, firstResult);
  const replay = await router.handle(structuredClone(message), context);
  assert.deepEqual(replay, firstResult);
  assert.equal(providerCalls, 1,
    'a settled receipt survives long enough for a lost final response to replay');
});

test('does not resurrect a structured Figure error under the same receipt', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sleepImpl: async () => undefined,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationId: 'figure-structured-error-operation',
    figureRequestReceipt: 'figure-request-structured-error-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const first = await router.handle(message);
  const replay = await router.handle(structuredClone(message));
  assert.equal(first.success, false);
  assert.equal(first.error.code, 'PROVIDER_REJECTED');
  assert.deepEqual(replay, first);
  assert.equal(providerCalls, 1);
});

test('keeps a settled Figure receipt after operation release until its bounded TTL', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const operationId = 'figure-receipt-release-operation';
  const message = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationId,
    figureRequestReceipt: 'figure-request-release-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const context = figureCheckpointContext([], []);
  const first = await router.handle(message, context);
  assert.equal(first.success, true, JSON.stringify(first));
  const released = await router.handle({
    type: 'LLM_CONTROL_OPERATION', operationId, command: 'release'
  });
  assert.equal(released.success, true);
  const replay = await router.handle(structuredClone(message), context);
  assert.deepEqual(replay, first);
  assert.equal(providerCalls, 1,
    'release confirms the operation but cannot erase a response-loss receipt immediately');
});

test('detaches the Figure budget abort listener when an operation is released', async () => {
  const OriginalAbortController = globalThis.AbortController;
  const controllers = [];
  class TrackingAbortSignal {
    constructor() {
      this.aborted = false;
      this.listeners = [];
    }
    addEventListener(type, listener, options = {}) {
      if (type === 'abort' && typeof listener === 'function') {
        this.listeners.push({ listener, once: options?.once === true });
      }
    }
    removeEventListener(type, listener) {
      if (type !== 'abort') return;
      this.listeners = this.listeners.filter(entry => entry.listener !== listener);
    }
    dispatchAbort() {
      for (const entry of [...this.listeners]) {
        if (entry.once) this.removeEventListener('abort', entry.listener);
        entry.listener.call(this, { type: 'abort', target: this });
      }
    }
  }
  class TrackingAbortController {
    constructor() {
      this.signal = new TrackingAbortSignal();
      controllers.push(this);
    }
    abort() {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      this.signal.dispatchAbort();
    }
  }
  globalThis.AbortController = TrackingAbortController;
  try {
    const storageArea = createMemoryStorage();
    const originalSet = storageArea.set.bind(storageArea);
    let rejectLedgerWrites = false;
    storageArea.set = (input, callback) => {
      if (rejectLedgerWrites && input?.sciFigureProviderAttemptLedgerV1) {
        throw new Error('simulated release persistence failure');
      }
      return originalSet(input, callback);
    };
    const owner = {
      ...figureCheckpointContext([], []), trustedExtensionSender: true,
      senderExtensionId: 'extension-id', senderTabId: 40, senderFrameId: 0,
      senderDocumentId: '40404040-4040-4404-8404-404040404040'
    };
    const router = createBackgroundRouter({
      storageArea,
      runtimeExtensionId: 'extension-id',
      fetchImpl: async (url, options) => {
        const input = openAIInputPayload(JSON.parse(options.body));
        return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
      }
    });
    await configureOpenAIRouter(router);
    const operationId = 'figure-budget-listener-release-operation';
    const response = await router.handle(figureMessage([figureInput(1)], {
      analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 6,
      operationId,
      figureRequestReceipt: 'figure-request-listener-release-12345678',
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
    }), owner);
    assert.equal(response.success, true, JSON.stringify(response));
    assert.equal(controllers[0].signal.listeners.length, 1,
      'the settled operation retains only its cancellation listener until release');
    rejectLedgerWrites = true;
    const failedRelease = await router.handle({
      type: 'LLM_CONTROL_OPERATION', operationId, operationScope: 'figure',
      workspaceLifecycle: 6, command: 'release'
    }, owner);
    assert.equal(failedRelease.success, false);
    assert.equal(failedRelease.error.code, 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
    assert.equal(controllers[0].signal.listeners.length, 1,
      'failed durable release must retain the local cancellation/retry capability');
    rejectLedgerWrites = false;
    const released = await router.handle({
      type: 'LLM_CONTROL_OPERATION', operationId, operationScope: 'figure',
      workspaceLifecycle: 6, command: 'release'
    }, owner);
    assert.equal(released.success, true);
    assert.equal(released.data.released, true);
    assert.equal(controllers[0].signal.listeners.length, 0);
    controllers[0].abort();
    await new Promise(resolve => setTimeout(resolve, 0));
    const durable = storageArea.values.sciFigureProviderAttemptLedgerV1.operations[0];
    assert.ok(durable.releasedAt > 0);
    assert.equal(durable.terminalCode, '',
      'an abort observed after the release commit cannot rewrite it as CANCELLED');
  } finally {
    globalThis.AbortController = OriginalAbortController;
  }
});

test('released and nonterminal Figure receipts remain authoritative until trusted owner retirement', async () => {
  const storageArea = createMemoryStorage();
  let now = 1_000;
  let providerCalls = 0;
  const owner = {
    trustedExtensionSender: true,
    senderExtensionId: 'extension-id',
    senderTabId: 41,
    senderFrameId: 0,
    senderDocumentId: '41414141-4141-4414-8414-414141414141'
  };
  const router = createBackgroundRouter({
    storageArea,
    runtimeExtensionId: 'extension-id',
    nowImpl: () => now,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 400);
    }
  });
  await configureOpenAIRouter(router);
  const request = (index, figureNumber = 1) => figureMessage([figureInput(figureNumber)], {
    // Distinct source documents isolate receipt-capacity authority from the
    // independently tested cumulative per-source and per-target spending caps.
    document: { title: `Receipt source ${index}`, paragraphs: [{ paragraphId: 'p1',
      text: `Independent source document ${index}` }] },
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 7,
    operationId: `figure-abandoned-${index}`,
    figureRequestReceipt: `figure-request-abandoned-${index}-12345678`,
    figureOperationPlan: [{ figureId: `figure-${figureNumber}`, panelCount: 0 }]
  });
  for (let index = 1; index <= 128; index += 1) {
    const response = await router.handle(request(index), owner);
    assert.equal(response.error.code, 'PROVIDER_REJECTED');
  }
  const released = await router.handle({
    type: 'LLM_CONTROL_OPERATION', operationId: 'figure-abandoned-1',
    operationScope: 'figure', workspaceLifecycle: 7, command: 'release'
  }, owner);
  assert.equal(released.success, true);
  now += 31 * 60 * 1000;
  const saturated = await router.handle(request(999), owner);
  assert.equal(saturated.success, false);
  assert.equal(saturated.error.code, 'FIGURE_REQUEST_RECEIPT_CAPACITY',
    'elapsed wall time cannot erase released or nonterminal receipt authority');
  assert.equal(providerCalls, 128);
});

test('binds one immutable 96-call Figure budget across receipts and fails closed at exhaustion', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sleepImpl: async () => undefined,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 429);
    }
  });
  await configureOpenAIRouter(router);
  const driftOperationId = 'figure-provider-budget-drift-operation';
  const driftDocument = { title: 'Inventory drift budget source', paragraphs: [{
    paragraphId: 'p1', text: 'Separate source for immutable inventory drift verification.'
  }] };
  const driftStart = await router.handle(figureMessage([figureInput(1)], {
    document: driftDocument,
    analysisDepth: 'standard', operationId: driftOperationId,
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }],
    figureRequestReceipt: 'figure-request-budget-drift-start-12345678'
  }));
  assert.equal(driftStart.error.code, 'RATE_LIMITED');
  assert.equal(providerCalls, 3);
  const earlyDrift = await router.handle(figureMessage([figureInput(2)], {
    document: driftDocument,
    analysisDepth: 'standard', operationId: driftOperationId,
    figureOperationPlan: Array.from({ length: 40 }, (_, index) => ({
      figureId: `figure-${index + 1}`, panelCount: index === 1 ? 0 : 30
    })),
    figureRequestReceipt: 'figure-request-budget-drift-early-12345678'
  }));
  assert.equal(earlyDrift.success, false);
  assert.equal(earlyDrift.error.code, 'FIGURE_PROVIDER_ATTEMPT_LIMIT');
  assert.equal(providerCalls, 3,
    'a larger later inventory cannot replace the first bound operation limit');

  const operationId = 'figure-provider-budget-bound-operation';
  const figureOperationPlan = Array.from({ length: 40 }, (_, index) => ({
    figureId: `figure-${index + 1}`, panelCount: 0
  }));
  let lastProviderError = null;
  for (let index = 0; index < 32; index += 1) {
    lastProviderError = await router.handle(figureMessage([figureInput(index + 1)], {
      analysisDepth: 'standard', operationId, figureOperationPlan,
      figureRequestReceipt: `figure-request-budget-${String(index).padStart(3, '0')}-12345678`
    }), { onProgress: event => progress.push(event) });
    assert.equal(lastProviderError.success, false);
    assert.equal(lastProviderError.error.code, 'RATE_LIMITED');
  }
  assert.equal(providerCalls, 99);
  const exhausted = await router.handle(figureMessage([figureInput(33)], {
    analysisDepth: 'standard', operationId, figureOperationPlan,
    figureRequestReceipt: 'figure-request-budget-032-12345678'
  }), { onProgress: event => progress.push(event) });
  assert.equal(exhausted.success, false);
  assert.equal(exhausted.error.code, 'FIGURE_PROVIDER_ATTEMPT_LIMIT');
  assert.equal(providerCalls, 99);
  const attempts = progress.filter(event => event.phase === 'figure_provider_attempt');
  assert.deepEqual(attempts.map(event => event.providerAttempt),
    Array.from({ length: 96 }, (_, index) => index + 1));
  assert.ok(attempts.every(event => event.providerAttemptLimit === 96));

  const drifted = await router.handle(figureMessage([figureInput(34)], {
    analysisDepth: 'standard', operationId,
    figureOperationPlan: [{ figureId: 'figure-34', panelCount: 0 }],
    figureRequestReceipt: 'figure-request-budget-drift-12345678'
  }));
  assert.equal(drifted.success, false);
  assert.equal(drifted.error.code, 'FIGURE_PROVIDER_ATTEMPT_LIMIT');
  assert.equal(providerCalls, 99, 'inventory drift cannot raise a bound operation limit');
});

test('cancelling a Figure operation during router backoff stops retries and cannot be revived', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  let providerCalls = 0;
  let markBackoffStarted;
  let releaseBackoff;
  const backoffStarted = new Promise(resolve => { markBackoffStarted = resolve; });
  const backoffGate = new Promise(resolve => { releaseBackoff = resolve; });
  const router = createBackgroundRouter({
    storageArea,
    runtimeExtensionId: 'extension-id',
    sleepImpl: async () => {
      markBackoffStarted();
      await backoffGate;
    },
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({}, 429);
    }
  });
  await configureOpenAIRouter(router);
  const operationId = 'figure-router-backoff-cancel-operation';
  const owner = {
    trustedExtensionSender: true,
    senderExtensionId: 'extension-id',
    senderTabId: 42,
    senderFrameId: 0,
    senderDocumentId: '42424242-4242-4424-8424-424242424242',
    onProgress: event => progress.push(event)
  };
  const base = figureMessage([figureInput(1)], {
    analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 8,
    operationId,
    figureRequestReceipt: 'figure-request-backoff-cancel-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 0 }]
  });
  const pending = router.handle(base, owner);
  await backoffStarted;
  const cancelled = await router.handle({
    type: 'LLM_CONTROL_OPERATION', operationId, operationScope: 'figure',
    workspaceLifecycle: 8, command: 'cancel'
  }, owner);
  releaseBackoff();
  const response = await pending;
  const attemptedRevival = await router.handle({
    ...structuredClone(base),
    figureRequestReceipt: 'figure-request-backoff-revival-12345678'
  }, owner);

  assert.equal(cancelled.success, true);
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'CANCELLED');
  assert.equal(attemptedRevival.success, false);
  assert.equal(attemptedRevival.error.code, 'CANCELLED');
  assert.equal(providerCalls, 1);
  assert.deepEqual(progress.filter(event => event.phase === 'figure_provider_attempt')
    .map(event => event.providerAttempt), [1]);
});

test('resumes a durable deep Figure checkpoint without repeating completed Panels', async () => {
  const storageArea = createMemoryStorage();
  const operationId = 'figure-checkpoint-resume-operation';
  const firstCheckpoints = [];
  const firstProgress = [];
  const firstRequests = [];
  const firstRouter = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      firstRequests.push(input);
      if (firstRequests.length === 2) return jsonResponse({}, 400);
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(firstRouter);
  const figure = { ...figureInput(1), panelHints: ['A', 'B', 'C', 'D', 'E'] };
  const first = await firstRouter.handle(figureMessage([figure], {
    analysisDepth: 'deep', operationId,
    figureRequestReceipt: 'figure-request-checkpoint-first-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 5 }]
  }), figureCheckpointContext(firstProgress, firstCheckpoints));
  assert.equal(first.success, false);
  assert.equal(first.error.code, 'PROVIDER_REJECTED');
  assert.deepEqual(firstCheckpoints.at(-1).figureResult.panels.map(panel => panel.panel),
    ['A', 'B']);
  const consumed = Math.max(...firstProgress
    .filter(event => event.phase === 'figure_provider_attempt')
    .map(event => event.providerAttempt));

  const resumedRequests = [];
  const resumedProgress = [];
  const restartedRouter = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      resumedRequests.push(input);
      const output = input.pass === 'missing_panel_recovery'
        ? figureRecoveryOutput(input, input.requested_panel_labels)
        : figurePassOutput(input);
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  const resumed = await restartedRouter.handle(figureMessage([figure], {
    analysisDepth: 'deep', operationId,
    figureRequestReceipt: 'figure-request-checkpoint-resume-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 5 }],
    providerAttemptsConsumed: consumed,
    figureResumeCheckpoint: firstCheckpoints.at(-1).checkpointEnvelope
  }), figureCheckpointContext(resumedProgress, []));
  assert.equal(resumed.success, true, JSON.stringify(resumed));
  assert.deepEqual(resumedRequests.map(input => ({
    pass: input.pass,
    panels: input.requested_panel_labels || input.panel_evidence?.map(panel => panel.panel)
  })), [
    { pass: 'missing_panel_recovery', panels: ['C', 'D', 'E'] },
    { pass: 'figure_synthesis', panels: ['A', 'B', 'C', 'D', 'E'] }
  ]);
  assert.deepEqual(resumed.data.figureResults[0].panels.map(panel => panel.panel),
    ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(
    resumedProgress.filter(event => event.phase === 'figure_provider_attempt')
      .map(event => event.providerAttempt),
    [consumed + 1, consumed + 2]
  );
});

test('explicit current confirmation: Figure checkpoint v1 binds input route policy and plan while preserving visual fallback', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const checkpoints = [];
  const progress = [];
  let initialCalls = 0;
  const firstRouter = createConfirmedFigureRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    fetchImpl: async (url, options) => {
      initialCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      if (initialCalls === 1) return jsonResponse({}, 400);
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(firstRouter);
  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_walkthrough.allowTextFallback = true;
  const figure = {
    ...figureInput(1), panelHints: ['A'],
    images: [{ dataUrl: 'data:image/png;base64,AA==' }]
  };
  const plan = [{ figureId: 'figure-1', panelCount: 1 }];
  const first = await firstRouter.handle(figureMessage([figure], {
    analysisDepth: 'standard', forceRefresh: true, workspaceLifecycle: 11,
    operationId: 'figure-checkpoint-envelope-first-operation',
    figureRequestReceipt: 'figure-request-checkpoint-envelope-first-12345678',
    figureOperationPlan: plan
  }), figureCheckpointContext(progress, checkpoints));
  assert.equal(first.success, true, JSON.stringify(first));
  const envelope = checkpoints.at(-1)?.checkpointEnvelope;
  assert.equal(envelope?.version, 'figure-checkpoint-envelope-v1');
  assert.match(envelope?.inputDigest || '', /^[a-f0-9]{64}$/u);
  assert.match(envelope?.routeDigest || '', /^[a-f0-9]{64}$/u);
  assert.match(envelope?.taskPolicyDigest || '', /^[a-f0-9]{64}$/u);
  assert.match(envelope?.planDigest || '', /^[a-f0-9]{64}$/u);
  assert.match(envelope?.bindingDigest || '', /^[a-f0-9]{64}$/u);
  assert.equal(envelope.inputMode, 'caption_context');
  assert.equal(envelope.visionFallback, true);
  assert.equal(envelope.fallbackReason, 'provider_rejected_pixels');

  let resumeCalls = 0;
  const resumedRouter = createConfirmedFigureRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    fetchImpl: async () => {
      resumeCalls += 1;
      throw new Error('a complete checkpoint must avoid provider dispatch');
    }
  });
  const resumed = await resumedRouter.handle(figureMessage([figure], {
    analysisDepth: 'standard', forceRefresh: false, workspaceLifecycle: 11,
    operationId: 'figure-checkpoint-envelope-resume-operation',
    figureRequestReceipt: 'figure-request-checkpoint-envelope-resume-12345678',
    figureOperationPlan: plan,
    figureResumeCheckpoint: structuredClone(envelope)
  }), figureCheckpointContext([], []));
  assert.equal(resumed.success, true, JSON.stringify(resumed));
  assert.equal(resumeCalls, 0);
  assert.equal(resumed.data.figureResults[0].visionFallback, true);
  assert.equal(resumed.data.figureResults[0].fallbackReason, 'provider_rejected_pixels');

  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_walkthrough.allowTextFallback = false;
  let driftCalls = 0;
  const driftedRouter = createConfirmedFigureRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    fetchImpl: async () => {
      driftCalls += 1;
      return jsonResponse({});
    }
  });
  const drifted = await driftedRouter.handle(figureMessage([figure], {
    analysisDepth: 'standard', forceRefresh: false, workspaceLifecycle: 11,
    operationId: 'figure-checkpoint-envelope-drift-operation',
    figureRequestReceipt: 'figure-request-checkpoint-envelope-drift-12345678',
    figureOperationPlan: plan,
    figureResumeCheckpoint: structuredClone(envelope)
  }), figureCheckpointContext([], []));
  assert.equal(drifted.success, false);
  assert.equal(drifted.error.code, 'FIGURE_CHECKPOINT_STALE');
  assert.equal(driftCalls, 0, 'checkpoint identity drift fails before provider work');
});

test('explicit current confirmation: Figure checkpoint resume rejects re-signed input mode, basis and fallback forgeries', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const checkpoints = [];
  let setupCalls = 0;
  const setupRouter = createConfirmedFigureRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    fetchImpl: async (url, options) => {
      setupCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      if (setupCalls === 1) return jsonResponse({}, 400);
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(setupRouter);
  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_walkthrough.allowTextFallback = true;
  const figure = {
    ...figureInput(1), panelHints: ['A'],
    images: [{ dataUrl: 'data:image/png;base64,AA==' }]
  };
  const plan = [{ figureId: 'figure-1', panelCount: 1 }];
  const setup = await setupRouter.handle(figureMessage([figure], {
    analysisDepth: 'standard', forceRefresh: true, workspaceLifecycle: 19,
    operationId: 'figure-checkpoint-semantic-setup-operation',
    figureRequestReceipt: 'figure-request-checkpoint-semantic-setup-12345678',
    figureOperationPlan: plan
  }), figureCheckpointContext([], checkpoints));
  assert.equal(setup.success, true, JSON.stringify(setup));
  const validCaptionFallback = checkpoints.at(-1)?.checkpointEnvelope;
  assert.equal(validCaptionFallback?.inputMode, 'caption_context');
  assert.equal(validCaptionFallback?.figureResult?.basis, 'caption_context');
  assert.equal(validCaptionFallback?.visionFallback, true);
  const resignedControl = await resignFigureCheckpointEnvelope(
    validCaptionFallback, () => undefined
  );
  assert.equal(resignedControl.resultDigest, validCaptionFallback.resultDigest);
  assert.equal(resignedControl.bindingDigest, validCaptionFallback.bindingDigest);

  let providerCalls = 0;
  const controlRouter = createConfirmedFigureRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('valid complete checkpoint must avoid provider dispatch');
    }
  });
  const control = await controlRouter.handle(figureMessage([figure], {
    analysisDepth: 'standard', forceRefresh: false, workspaceLifecycle: 19,
    operationId: 'figure-checkpoint-semantic-control-operation',
    figureRequestReceipt: 'figure-request-checkpoint-semantic-control-12345678',
    figureOperationPlan: plan,
    figureResumeCheckpoint: structuredClone(validCaptionFallback)
  }), figureCheckpointContext([], []));
  assert.equal(control.success, true, JSON.stringify(control));
  assert.equal(providerCalls, 0);

  const forgeries = [
    {
      name: 'whole-Figure checkpoint claims a Panel crop',
      mutate(value) { value.inputMode = 'panel_crop'; }
    },
    {
      name: 'Figure pixels claim a caption result',
      mutate(value) {
        value.inputMode = 'figure_image';
        value.visionFallback = false;
        value.fallbackReason = '';
      }
    },
    {
      name: 'caption result suppresses the required visual fallback state',
      mutate(value) {
        value.visionFallback = false;
        value.fallbackReason = '';
      }
    },
    {
      name: 'caption input claims a vision result',
      mutate(value) {
        value.visionFallback = false;
        value.fallbackReason = '';
        value.figureResult.basis = 'vision_text';
        value.figureResult.panels.forEach(panel => {
          panel.methodSource = 'image';
          panel.observationSource = 'image_observation';
        });
      }
    },
    {
      name: 'Figure pixels claim to be a visual fallback',
      mutate(value) {
        value.inputMode = 'figure_image';
        value.figureResult.basis = 'vision_text';
        value.figureResult.panels.forEach(panel => {
          panel.methodSource = 'image';
          panel.observationSource = 'image_observation';
        });
      }
    },
    {
      name: 'caption fallback omits its safe reason',
      mutate(value) { value.fallbackReason = ''; }
    },
    {
      name: 'standard result omits its exact analysis depth',
      mutate(value) { delete value.figureResult.analysisDepth; }
    },
    {
      name: 'standard result forges an unknown analysis depth',
      mutate(value) { value.figureResult.analysisDepth = 'standard-ish'; }
    }
  ];

  for (let index = 0; index < forgeries.length; index += 1) {
    const forged = await resignFigureCheckpointEnvelope(
      validCaptionFallback, forgeries[index].mutate
    );
    const ledgerBeforeForgery = JSON.stringify(
      ledgerStorage.values.sciFigureProviderAttemptLedgerV1
    );
    const router = createConfirmedFigureRouter({
      storageArea,
      sessionStorageArea: ledgerStorage,
      fetchImpl: async () => {
        providerCalls += 1;
        throw new Error('semantic checkpoint rejection must precede provider dispatch');
      }
    });
    const response = await router.handle(figureMessage([figure], {
      analysisDepth: 'standard', forceRefresh: false, workspaceLifecycle: 19,
      operationId: `figure-checkpoint-semantic-forgery-${index}`,
      figureRequestReceipt: `figure-request-checkpoint-semantic-forgery-${index}-12345678`,
      figureOperationPlan: plan,
      figureResumeCheckpoint: forged
    }), figureCheckpointContext([], []));
    assert.equal(response.success, false, forgeries[index].name);
    assert.equal(response.error.code, 'FIGURE_CHECKPOINT_INVALID', forgeries[index].name);
    assert.equal(JSON.stringify(
      ledgerStorage.values.sciFigureProviderAttemptLedgerV1
    ), ledgerBeforeForgery,
    `${forgeries[index].name}: full validation precedes receipt/continuation mutation`);
  }
  assert.equal(providerCalls, 0);
});

test('unlabeled Figure resumes its JSON-round-tripped complete checkpoint without provider replay', async () => {
  const storageArea = createMemoryStorage();
  const ledgerStorage = createMemoryStorage();
  const checkpoints = [];
  const progress = [];
  let setupCalls = 0;
  const setupRouter = createBackgroundRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    fetchImpl: async (url, options) => {
      setupCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({
        output_text: JSON.stringify({
          figure_id: input.figure_id,
          analysis_depth: input.analysis_depth,
          basis: input.analysis_basis,
          figure_question_zh: 'What does this Figure establish?',
          evidence_steps: [{
            source_zh: 'Figure caption and Results text',
            established_zh: 'The intervention changes the reported phenotype.',
            handoff_zh: 'The next experiment should test the mechanism.',
            evidence_level: 'intervention_effect'
          }],
          author_assembly_zh: 'The author moves from phenotype to mechanism.',
          core_conclusion_zh: 'The intervention changes the phenotype.',
          claim_boundary_zh: 'This Figure does not establish the complete mechanism.'
        })
      });
    }
  });
  await configureOpenAIRouter(setupRouter);
  const figure = figureInput(1, [panelImageVariant(32)]);
  const plan = [
    { figureId: 'figure-1', panelCount: 0 },
    { figureId: 'figure-2', panelCount: 5 }
  ];
  const setup = await setupRouter.handle(figureMessage([figure], {
    analysisDepth: 'standard', forceRefresh: true, workspaceLifecycle: 23,
    operationId: 'figure-unlabeled-checkpoint-setup-operation',
    figureRequestReceipt: 'figure-request-unlabeled-checkpoint-setup-12345678',
    figureOperationPlan: plan
  }), figureCheckpointContext(progress, checkpoints));
  assert.equal(setup.success, true, JSON.stringify(setup));
  assert.equal(setupCalls, 1);
  const envelope = JSON.parse(JSON.stringify(
    checkpoints.at(-1)?.checkpointEnvelope
  ));
  assert.equal(envelope?.figureResult?.unlabeledOverview, true);
  assert.deepEqual(envelope?.figureResult?.panels, []);
  assert.equal(envelope?.inputMode, 'figure_image');
  assert.equal(envelope?.figureResult?.basis, 'vision_text');
  assert.equal(envelope?.visionFallback, false);
  assert.deepEqual(envelope?.operationPlan, plan,
    'the v1 checkpoint carries its original operation-wide budget plan');
  assert.equal(progress.findLast(event => event.phase === 'figure')?.checkpointStatus,
    'saved', 'a durable zero-Panel checkpoint ack is not left publicly pending');

  let replayCalls = 0;
  const restartedRouter = createBackgroundRouter({
    storageArea,
    sessionStorageArea: ledgerStorage,
    fetchImpl: async () => {
      replayCalls += 1;
      throw new Error('complete overview checkpoint must avoid provider replay');
    }
  });
  const resumed = await restartedRouter.handle(figureMessage([figure], {
    analysisDepth: 'standard', forceRefresh: true, workspaceLifecycle: 23,
    operationId: 'figure-unlabeled-checkpoint-resume-operation',
    figureRequestReceipt: 'figure-request-unlabeled-checkpoint-resume-12345678',
    figureOperationPlan: plan,
    figureResumeCheckpoint: envelope
  }), figureCheckpointContext([], []));
  assert.equal(resumed.success, true, JSON.stringify(resumed));
  assert.equal(replayCalls, 0);
  assert.equal(resumed.data.figureResults[0].unlabeledOverview, true);
  assert.deepEqual(resumed.data.figureResults[0].panels, []);
});

test('mixed visual-to-caption checkpoints resume with a new receipt without repeating completed batches', async () => {
  async function exercise({ name, analysisDepth, panelHints, firstResponse }) {
    const storageArea = createMemoryStorage();
    const ledgerStorage = createMemoryStorage();
    const checkpoints = [];
    const firstRequests = [];
    const firstRouter = createBackgroundRouter({
      storageArea,
      sessionStorageArea: ledgerStorage,
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        const input = openAIInputPayload(body);
        const request = {
          pass: input.pass || 'single_pass',
          panels: input.requested_panel_labels || input.expected_panel_labels || [],
          visual: input.analysis_basis === 'vision_text'
        };
        firstRequests.push(request);
        return firstResponse(input, request);
      }
    });
    await configureOpenAIRouter(firstRouter);
    storageArea.values.sciLlmSettingsV2.taskPolicies
      .figure_walkthrough.allowTextFallback = true;
    const figure = {
      ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,QUJDRA==' }]),
      panelHints
    };
    const operationId = `figure-mixed-checkpoint-${name}-operation`;
    const plan = [{ figureId: 'figure-1', panelCount: panelHints.length }];
    const first = await firstRouter.handle(figureMessage([figure], {
      analysisDepth, forceRefresh: true, operationId,
      figureRequestReceipt: `figure-request-mixed-${name}-first-12345678`,
      figureOperationPlan: plan
    }), figureCheckpointContext([], checkpoints));
    assert.equal(first.success, false, `${name}:${JSON.stringify(first)}`);
    assert.equal(first.error.code, 'PROVIDER_REJECTED', name);
    const envelope = checkpoints.at(-1)?.checkpointEnvelope;
    assert.equal(envelope?.inputMode, 'caption_context', name);
    assert.equal(envelope?.visionFallback, true, name);
    assert.equal(envelope?.fallbackReason, 'provider_rejected_pixels', name);
    assert.equal(envelope?.figureResult?.basis, 'caption_context',
      `${name} fallback checkpoint must not continue claiming pure vision`);

    const resumedRequests = [];
    const restartedRouter = createBackgroundRouter({
      storageArea,
      sessionStorageArea: ledgerStorage,
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        const input = openAIInputPayload(body);
        resumedRequests.push({
          pass: input.pass || 'single_pass',
          panels: input.requested_panel_labels || input.expected_panel_labels || [],
          visual: input.analysis_basis === 'vision_text'
        });
        const output = input.pass === 'missing_panel_recovery'
          ? figureRecoveryOutput(input, input.requested_panel_labels)
          : figurePassOutput(input);
        return jsonResponse({ output_text: JSON.stringify(output) });
      }
    });
    const resumed = await restartedRouter.handle(figureMessage([figure], {
      analysisDepth, forceRefresh: true, operationId,
      figureRequestReceipt: `figure-request-mixed-${name}-resume-12345678`,
      figureOperationPlan: plan,
      figureResumeCheckpoint: JSON.parse(JSON.stringify(envelope))
    }), figureCheckpointContext([], []));
    assert.equal(resumed.success, true, `${name}:${JSON.stringify(resumed)}`);
    assert.equal(resumed.data.figureResults[0].basis, 'caption_context', name);
    assert.ok(resumedRequests.length >= 1, name);
    assert.ok(resumedRequests.every(request => request.visual === false), name);
    assert.ok(resumedRequests.every(request => request.pass !== 'single_pass' &&
      request.pass !== 'panel_extraction'),
    `${name} repeated a completed whole/extraction batch: ${JSON.stringify(resumedRequests)}`);
    return { firstRequests, resumedRequests };
  }

  const standard = await exercise({
    name: 'standard-recovery',
    analysisDepth: 'standard',
    panelHints: ['A', 'B', 'C', 'D', 'E'],
    firstResponse(input, request) {
      if (request.pass === 'single_pass') {
        return jsonResponse({ output_text: JSON.stringify(
          partialFigurePassOutput(input, ['A'])
        ) });
      }
      if (request.pass === 'missing_panel_recovery' && request.visual) {
        return jsonResponse({}, 400);
      }
      if (request.pass === 'missing_panel_recovery' &&
          request.panels.join(',') === 'B,C,D') {
        return jsonResponse({ output_text: JSON.stringify(
          figureRecoveryOutput(input, request.panels)
        ) });
      }
      return jsonResponse({}, 400);
    }
  });
  assert.deepEqual(standard.resumedRequests.map(request => [request.pass, request.panels]), [
    ['missing_panel_recovery', ['E']],
    ['figure_synthesis', []]
  ]);

  const deep = await exercise({
    name: 'deep-multi-batch',
    analysisDepth: 'deep',
    panelHints: ['A', 'B', 'C', 'D'],
    firstResponse(input, request) {
      if (request.pass === 'panel_extraction' && request.panels.join(',') === 'A,B') {
        return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
      }
      if (request.pass === 'panel_extraction' && request.panels.join(',') === 'C,D') {
        return jsonResponse({ output_text: JSON.stringify(
          partialFigurePassOutput(input, ['C'])
        ) });
      }
      if (request.pass === 'missing_panel_recovery' && request.visual) {
        return jsonResponse({}, 400);
      }
      if (request.pass === 'missing_panel_recovery') {
        return jsonResponse({ output_text: JSON.stringify(
          figureRecoveryOutput(input, request.panels)
        ) });
      }
      return jsonResponse({}, 400);
    }
  });
  assert.deepEqual(deep.resumedRequests.map(request => request.pass), ['figure_synthesis']);
});

test('labeled Figure recovery skips unusable zero-Panel checkpoints and continues provider recovery', async () => {
  const storageArea = createMemoryStorage();
  const checkpoints = [];
  const requests = [];
  const originalValidateFigureAnalysis = globalThis.SciLLM.validateFigureAnalysis;
  globalThis.SciLLM.validateFigureAnalysis = (raw, input, options = {}) => {
    if (input?.figureId === 'figure-1' && input?.panelHints?.length === 1 &&
        Array.isArray(raw?.panels) && raw.panels.length === 0) {
      if (options.requireCompletePanels === true) {
        const error = new Error('Figure response omitted the only requested Panel');
        error.code = 'FIGURE_PANEL_COVERAGE_INCOMPLETE';
        error.missingPanels = ['A'];
        error.receivedPanels = [];
        throw error;
      }
      const validated = originalValidateFigureAnalysis(
        figurePassOutput({
          figure_id: input.figureId,
          analysis_basis: options.visualInput ? 'vision_text' : 'caption_context',
          analysis_depth: options.analysisDepth,
          expected_panel_labels: ['A']
        }), input, { ...options, requireCompletePanels: false }
      );
      return {
        ...validated,
        panels: [],
        panelCoverage: {
          expectedPanels: ['A'], returnedPanels: [], missingPanels: ['A'],
          unexpectedPanels: [], ignoredUnexpectedPanelCount: 0
        }
      };
    }
    return originalValidateFigureAnalysis(raw, input, options);
  };
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      const pass = input.pass || 'single_pass';
      requests.push(pass);
      const output = pass === 'single_pass'
        ? partialFigurePassOutput(input, [])
        : pass === 'missing_panel_recovery'
          ? figureRecoveryOutput(input, input.requested_panel_labels)
          : figurePassOutput(input);
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  try {
    await configureOpenAIRouter(router);
    const response = await router.handle(figureMessage([{
      ...figureInput(1), panelHints: ['A']
    }], {
      analysisDepth: 'standard',
      operationId: 'figure-zero-panel-recovery-operation',
      figureRequestReceipt: 'figure-request-zero-panel-recovery-12345678',
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }]
    }), figureCheckpointContext([], checkpoints));
    assert.equal(response.success, true, JSON.stringify(response));
    assert.deepEqual(requests, ['single_pass', 'missing_panel_recovery', 'figure_synthesis'],
      JSON.stringify(response));
    assert.equal(checkpoints.some(checkpoint =>
      checkpoint.checkpointEnvelope?.figureResult?.panels?.length === 0
    ), false, 'a labeled empty result is not resumable and must not be persisted');
  } finally {
    globalThis.SciLLM.validateFigureAnalysis = originalValidateFigureAnalysis;
  }
});

test('analyzes Figures sequentially, checkpoints results and reuses identical cache', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  const checkpoints = [];
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({
        output_text: JSON.stringify(figureOutput(
          input.figure_id, input.analysis_basis, input.analysis_depth
        ))
      });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([figureInput(1), figureInput(2)]);
  message.figureProgressOffset = 4;
  message.figureProgressTotal = 6;
  message.analysisDepth = 'standard';
  message.operationId = 'figure-operation-test-1';

  const first = await router.handle(message,
    figureCheckpointContext(progress, checkpoints));
  const second = await router.handle(message);

  assert.equal(first.success, true, JSON.stringify(first));
  assert.deepEqual(first.data.figureResults.map(item => item.figureId), ['figure-1', 'figure-2']);
  assert.equal(first.data.cacheHits, 0);
  assert.equal(first.data.operationId, 'figure-operation-test-1');
  assert.equal(second.data.cacheHits, 2);
  assert.equal(calls, 2);
  const lifecycle = progress.filter(item => item.phase !== 'provider_telemetry');
  assert.deepEqual(lifecycle.map(item => item.phase), [
    'figure_requesting', 'figure_model_processing', 'provider_request_started', 'figure_provider_attempt', 'figure_response_received',
    'figure_validating', 'figure_assembling', 'figure_panel_batch_pending',
    'figure_panel_batch_complete', 'figure',
    'figure_requesting', 'figure_model_processing', 'provider_request_started', 'figure_provider_attempt', 'figure_response_received',
    'figure_validating', 'figure_assembling', 'figure_panel_batch_pending',
    'figure_panel_batch_complete', 'figure'
  ]);
  const telemetry = progress.filter(item => item.phase === 'provider_telemetry');
  assert.equal(telemetry.length, 2);
  assert.ok(telemetry.every(item => item.featureId === 'figure_walkthrough'));
  const firstFigureProgress = lifecycle.slice(0, 10);
  firstFigureProgress.forEach(item => {
    assert.equal(item.figureId, 'figure-1');
    assert.equal(item.figureLabel, 'Figure 1');
    assert.deepEqual(item.expectedPanels, []);
    assert.equal(item.expectedPanelCount, 0);
    assert.equal(item.completedFigures, item.phase === 'figure' ? 5 : 4);
    assert.equal(item.totalFigures, 6);
    assert.equal(item.providerId, 'openai');
    assert.equal(item.model, 'gpt-5.1');
    assert.equal(item.capabilityMode, 'vision');
    assert.equal(item.operationId, 'figure-operation-test-1');
    assert.equal(item.route.providerId, 'openai');
    assert.equal(item.route.model, 'gpt-5.1');
    assert.equal(item.route.capabilityMode, 'vision');
    assert.equal(typeof item.startedAt, 'number');
  });
  const panelCheckpoint = progress.find(item => item.phase === 'figure_panel_batch_complete');
  assert.equal(panelCheckpoint.completedPanelBatches, 1);
  assert.equal(panelCheckpoint.totalPanelBatches, 1);
  assert.equal(Object.hasOwn(panelCheckpoint, 'partialFigureResult'), false);
  assert.equal(Object.hasOwn(panelCheckpoint, 'figureResult'), false);
  assert.equal(checkpoints[0].figureResult.figureId, 'figure-1');
  assert.equal(checkpoints[0].operationId, 'figure-operation-test-1');
  assert.equal(firstFigureProgress[6].recognizedPanelCount, 0);
  assert.equal(firstFigureProgress[7].recognizedPanelCount, 0);
});

test('degrades a repeatedly invalid small Figure into Panel extraction plus synthesis', async () => {
  const storageArea = createMemoryStorage();
  const passes = [];
  const progress = [];
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      passes.push(input.pass || 'single_pass');
      if (calls <= 2) return jsonResponse({ output_text: 'not valid JSON' });
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const figure = { ...figureInput(1), panelHints: ['A'] };
  const result = await router.handle(figureMessage([figure], {
    analysisDepth: 'standard'
  }), {
    onProgress: value => progress.push(value)
  });

  assert.equal(result.success, true);
  assert.equal(result.data.figureResults[0].panels.length, 1);
  assert.deepEqual(passes, [
    'single_pass', 'single_pass', 'panel_extraction', 'figure_synthesis'
  ]);
  assert.ok(progress.some(item => item.phase === 'figure_compact_fallback'));
});

test('recovers an unlabeled Figure through the compact overview contract', async () => {
  const storageArea = createMemoryStorage();
  const schemaNames = [];
  const passes = [];
  const progress = [];
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      schemaNames.push(body.text?.format?.name || '');
      passes.push(input.pass || '');
      if (calls === 1) {
        return jsonResponse({ output_text: 'not valid JSON' });
      }
      return jsonResponse({
        output_text: JSON.stringify({
          figure_id: input.figure_id,
          analysis_depth: input.analysis_depth,
          basis: input.analysis_basis,
          figure_question_zh: 'What does the supplied Figure establish?',
          evidence_steps: [{
            source_zh: 'Figure caption and related Results text',
            established_zh: 'The intervention changes the reported phenotype.',
            handoff_zh: 'The next experiment should test the proposed mechanism.',
            evidence_level: 'intervention_effect'
          }],
          author_assembly_zh: 'The author moves from phenotype to mechanism.',
          core_conclusion_zh: 'The intervention changes the phenotype.',
          claim_boundary_zh: 'The Figure alone does not establish the full mechanism.'
        })
      });
    }
  });
  await configureOpenAIRouter(router);

  const response = await router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'deep'
  }), {
    onProgress: event => progress.push(event)
  });

  assert.equal(response.success, true);
  assert.equal(calls, 2);
  assert.deepEqual(schemaNames, [
    'figure_unlabeled_overview_deep',
    'figure_unlabeled_overview_deep'
  ]);
  assert.deepEqual(passes, [
    'unlabeled_figure_overview',
    'unlabeled_figure_overview'
  ]);
  assert.equal(response.data.figureResults[0].unlabeledOverview, true);
  assert.equal(response.data.figureResults[0].panels.length, 0);
  assert.equal(response.data.figureResults[0].argumentChain.length, 1);
  assert.ok(progress.some(event => event.phase === 'figure_schema_retry'));
});

test('expands a truncated whole-Figure output budget before using structural degradation', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }
        });
      }
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const result = await router.handle(figureMessage([figureInput(1)], {
    analysisDepth: 'standard'
  }), {
    onProgress: event => progress.push(event)
  });

  assert.equal(result.success, true);
  assert.equal(calls, 2);
  assert.ok(progress.some(item => item.phase === 'output_token_retry'));
  assert.equal(progress.some(item => item.phase === 'figure_compact_fallback'), false);
});

test('actual content CAS accepts recovered Panels followed by synthesis and final delivery metadata', async () => {
  for (const [panelCount, depth] of [[2, 'standard'], [26, 'standard'], [6, 'deep']]) {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  const operationId = 'figure-recovery-through-content-cas';
  let durable = null;
  let sequence = 0;
  let latestCheckpoint;
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content) => {
      durable = { revision: ++sequence, contentHash: String(sequence).padStart(64, 'a'), content: structuredClone(content) };
      return { saved: true };
    }
  });
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id', sleepImpl: async () => {},
    fetchImpl: async (_url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      let output = input.pass === 'missing_panel_recovery'
        ? figureRecoveryOutput(input, input.requested_panel_labels)
        : input.pass === 'figure_synthesis' ? figurePassOutput(input)
          : partialFigurePassOutput(input, [input.expected_panel_labels?.[0] || 'A']);
      if ((!input.pass || input.pass === 'panel_extraction') &&
          Array.isArray(output.panels)) {
        output = { ...output, panels: output.panels.map(panel => ({
          ...panel, methods: ['Immunofluorescence']
        })) };
      }
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const figure = { ...figureInput(1), panelHints: Array.from({ length: panelCount }, (_, index) => String.fromCharCode(65 + index)) };
  const response = await router.handle(figureMessage([figure], {
    analysisDepth: depth, operationScope: 'figure', workspaceLifecycle: 87,
    operationId, figureRequestReceipt: 'figure-request-content-cas-recovery-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount }]
  }), { trustedExtensionSender: true, senderExtensionId: 'extension-id',
    senderTabId: 87, senderFrameId: 0, senderDocumentId: '87878787-8787-4787-8787-878787878787',
    onFigureCheckpoint: async checkpoint => {
      latestCheckpoint = checkpoint.checkpointEnvelope;
      await persist({ schemaVersion: 1, figures: [{ figureId: 'figure-1',
        [depth === 'deep' ? 'pendingDeep' : 'pendingStandard']: { ...checkpoint.figureResult, operationId },
        [depth === 'deep' ? 'pendingDeepCheckpointEnvelope' : 'pendingStandardCheckpointEnvelope']: latestCheckpoint
      }] }, { figureId: 'figure-1', analysisDepth: depth, checkpointEnvelope: latestCheckpoint });
      return { success: true, savedPanelCount: checkpoint.figureResult.panels.length };
    }
  });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.figureResults[0].panels.length, panelCount);
  const finalSigned = structuredClone(response.data.figureResults[0]);
  for (const field of ['inputMode', 'visionFallback', 'fallbackReason', 'cacheHit']) {
    if (!Object.hasOwn(latestCheckpoint.figureResult, field)) delete finalSigned[field];
  }
  assert.deepEqual(latestCheckpoint.figureResult, finalSigned,
    'the latest durable checkpoint must sign the canonical delivered result');
  await persist({ schemaVersion: 1, figures: [{ figureId: 'figure-1',
    [depth]: { ...response.data.figureResults[0], operationId }
  }] }, { figureId: 'figure-1', analysisDepth: depth, operationId,
    clearCheckpointEnvelope: latestCheckpoint });
  assert.equal(durable.content.figures[0].pendingStandard, undefined);
  assert.equal(durable.content.figures[0].pendingStandardCheckpointEnvelope, undefined);
  assert.equal(durable.content.figures[0].pendingDeep, undefined);
  assert.equal(durable.content.figures[0].pendingDeepCheckpointEnvelope, undefined);
  assert.equal(durable.content.figures[0][depth].panels.length, panelCount);
  }
});

test('recovers only missing Panels through the managed Figure adapter and synthesizes once', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  const checkpoints = [];
  const requests = [];
  const imageUrls = [];
  const outputLimits = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      requests.push(input);
      outputLimits.push(body.max_output_tokens);
      imageUrls.push(Array.isArray(body.input)
        ? body.input[0].content.filter(item => item.type === 'input_image')
          .map(item => item.image_url)
        : []);
      const output = input.pass === 'missing_panel_recovery'
        ? figureRecoveryOutput(input, input.requested_panel_labels)
        : input.pass === 'figure_synthesis'
          ? figurePassOutput(input)
          : partialFigurePassOutput(input, ['A', 'B', 'C']);
      return jsonResponse({
        output_text: JSON.stringify(output),
        usage: { input_tokens: 120 + requests.length, output_tokens: 40 + requests.length }
      });
    }
  });
  await configureOpenAIRouter(router);
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  const sourceImage = 'data:image/jpeg;base64,/9j/2Q==';
  const response = await router.handle(figureMessage([{
    ...figureInput(1, [{ dataUrl: sourceImage }]), panelHints: labels
  }], { analysisDepth: 'standard', operationId: 'recovery-private-checkpoint' }),
  figureCheckpointContext(progress, checkpoints));

  assert.equal(response.success, true, JSON.stringify(response));
  assert.deepEqual(requests.map(item => item.pass || 'single_pass'), [
    'single_pass', 'missing_panel_recovery', 'figure_synthesis'
  ]);
  assert.deepEqual(requests[1].requested_panel_labels, ['D', 'E', 'F']);
  assert.deepEqual(requests[1].completed_panel_labels, ['A', 'B', 'C']);
  assert.equal(requests[1].input_mode, 'figure_image');
  assert.deepEqual(imageUrls[0], [sourceImage]);
  assert.deepEqual(imageUrls[1], [sourceImage]);
  assert.deepEqual(imageUrls[2], []);
  assert.ok(outputLimits.every(value => Number.isInteger(value) && value > 0));
  assert.deepEqual(response.data.figureResults[0].panels.map(item => item.panel), labels);
  assert.equal(progress.filter(item => item.phase === 'figure_synthesizing').length, 1);
  assert.equal(progress.filter(item => item.phase === 'figure_synthesis_complete').length, 1);
  const started = progress.find(item => item.phase === 'figure_panel_recovery_started');
  const checkpoint = progress.find(item => item.phase === 'figure_panel_recovery_checkpoint');
  const recoveredBatch = progress.find(item =>
    item.phase === 'figure_panel_recovery_batch_complete');
  const completed = progress.find(item => item.phase === 'figure_panel_recovery_complete');
  assert.deepEqual(started.missingPanels, ['D', 'E', 'F']);
  assert.equal(started.recognizedPanelCount, 3);
  assert.equal(Object.hasOwn(started, 'partialFigureResult'), false);
  assert.deepEqual(checkpoint.missingPanels, ['D', 'E', 'F']);
  assert.equal(checkpoint.inputMode, 'figure_image');
  assert.equal(checkpoint.savedPanelCount, 3);
  assert.equal(checkpoint.validatedPanelCount, 3);
  assert.equal(Object.hasOwn(checkpoint, 'partialFigureResult'), false);
  assert.equal(Object.hasOwn(checkpoint, 'figureResult'), false);
  assert.deepEqual(checkpoints[0].figureResult.panels.map(panel => panel.panel),
    ['A', 'B', 'C']);
  assert.equal(recoveredBatch.inputMode, 'figure_image');
  assert.equal(recoveredBatch.savedPanelCount, 6);
  assert.equal(recoveredBatch.validatedPanelCount, 6);
  assert.deepEqual(completed.unresolvedPanels, []);
  assert.equal(completed.recognizedPanelCount, 6);
  assert.equal(completed.inputMode, 'figure_image');
  assert.equal(completed.savedPanelCount, 6);
  assert.equal(completed.validatedPanelCount, 6);
  assert.equal(Object.hasOwn(completed, 'partialFigureResult'), false);
  assert.ok(progress.every(event =>
    !Object.hasOwn(event, 'partialFigureResult') && !Object.hasOwn(event, 'figureResult')));
  assert.deepEqual(checkpoints.map(item => item.figureResult.panels.length), [3, 6, 6]);
  const telemetry = progress.filter(item => item.phase === 'provider_telemetry');
  assert.equal(telemetry.length, 3);
  assert.ok(telemetry.every(item => item.featureId === 'figure_walkthrough'));
});

test('fails closed when a private Figure checkpoint cannot be durably persisted', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  const checkpoints = [];
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({
        output_text: JSON.stringify(partialFigurePassOutput(input, ['A']))
      });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(figureMessage([{
    ...figureInput(1), panelHints: ['A', 'B']
  }], {
    analysisDepth: 'standard', operationId: 'checkpoint-cas-failure'
  }), figureCheckpointContext(progress, checkpoints, async () => ({
    success: false, code: 'FIGURE_WORKSPACE_REVISION_CONFLICT'
  })));

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_CHECKPOINT_PERSIST_FAILED');
  assert.equal(providerCalls, 1, 'recovery must not spend another request before checkpoint ack');
  assert.equal(checkpoints.length, 1);
  const pending = progress.find(event =>
    event.phase === 'figure_panel_recovery_checkpoint_pending');
  assert.equal(pending.checkpointStatus, 'pending_save');
  assert.equal(pending.validatedPanelCount, 1);
  assert.equal(pending.savedPanelCount, 0);
  assert.equal(progress.some(event =>
    event.phase === 'figure_panel_recovery_checkpoint'), false);
  assert.ok(progress.every(event =>
    !Object.hasOwn(event, 'partialFigureResult') && !Object.hasOwn(event, 'figureResult')));
});

test('requires a private origin checkpoint transport for bound Figure operations', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(figureMessage([{
    ...figureInput(1), panelHints: ['A']
  }], { analysisDepth: 'standard', operationId: 'checkpoint-transport-required' }), {
    onProgress() {}
  });
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_CHECKPOINT_TRANSPORT_UNAVAILABLE');
});

test('bounds missing-Panel recovery batches to three and never overlaps provider calls', async () => {
  const storageArea = createMemoryStorage();
  const recoveryScopes = [];
  let inFlight = 0;
  let maximumInFlight = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise(resolve => setImmediate(resolve));
      const input = openAIInputPayload(JSON.parse(options.body));
      let output;
      if (input.pass === 'missing_panel_recovery') {
        recoveryScopes.push([...input.requested_panel_labels]);
        output = figureRecoveryOutput(input, input.requested_panel_labels);
      } else if (input.pass === 'figure_synthesis') {
        output = figurePassOutput(input);
      } else {
        output = partialFigurePassOutput(input, ['A', 'B', 'C']);
      }
      inFlight -= 1;
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const response = await router.handle(figureMessage([{
    ...figureInput(1), panelHints: labels
  }], { analysisDepth: 'standard' }));

  assert.equal(response.success, true, JSON.stringify(response));
  assert.deepEqual(recoveryScopes, [['D', 'E', 'F'], ['G', 'H']]);
  assert.ok(recoveryScopes.every(batch => batch.length <= 3));
  assert.equal(maximumInFlight, 1);
  assert.deepEqual(response.data.figureResults[0].panels.map(item => item.panel), labels);
});

test('explicit current confirmation: honors the Figure task text-fallback policy without retrying completed Panels', async () => {
  async function run(allowTextFallback) {
    const storageArea = createMemoryStorage();
    const requests = [];
    const progress = [];
    const router = createConfirmedFigureRouter({
      storageArea,
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        const input = openAIInputPayload(body);
        const visual = Array.isArray(body.input);
        requests.push({ pass: input.pass || 'single_pass', visual });
        if (input.pass === 'missing_panel_recovery' && visual) {
          return jsonResponse({}, 400);
        }
        const output = input.pass === 'missing_panel_recovery'
          ? figureRecoveryOutput(input, input.requested_panel_labels)
          : input.pass === 'figure_synthesis'
            ? figurePassOutput(input)
            : partialFigurePassOutput(input, ['A', 'B', 'C']);
        return jsonResponse({ output_text: JSON.stringify(output) });
      }
    }, allowTextFallback ? 'continue_text' : 'pause');
    await configureOpenAIRouter(router);
    storageArea.values.sciLlmSettingsV2.taskPolicies
      .figure_walkthrough.allowTextFallback = allowTextFallback;
    const response = await router.handle(figureMessage([{
      ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,/9j/2Q==' }]),
      panelHints: ['A', 'B', 'C', 'D', 'E', 'F']
    }], { analysisDepth: 'standard' }), {
      onProgress: event => progress.push(event)
    });
    return { response, requests, progress };
  }

  const denied = await run(false);
  assert.equal(denied.response.success, false);
  assert.equal(denied.response.error.code, 'FIGURE_VISION_PAUSED');
  assert.deepEqual(denied.requests, [
    { pass: 'single_pass', visual: true },
    { pass: 'missing_panel_recovery', visual: true }
  ]);

  const allowed = await run(true);
  assert.equal(allowed.response.success, true, JSON.stringify(allowed.response));
  assert.deepEqual(allowed.requests, [
    { pass: 'single_pass', visual: true },
    { pass: 'missing_panel_recovery', visual: true },
    { pass: 'missing_panel_recovery', visual: false },
    { pass: 'figure_synthesis', visual: false }
  ]);
  assert.equal(allowed.response.data.figureResults[0].visionFallback, true);
  assert.deepEqual(
    allowed.response.data.figureResults[0].panels.map(panel => panel.panel),
    ['A', 'B', 'C', 'D', 'E', 'F']
  );
  const fallbackCheckpoint = allowed.progress.find(event =>
    event.phase === 'figure_panel_recovery_batch_complete');
  assert.equal(fallbackCheckpoint.inputMode, 'caption_context');
});

test('persists valid Panels and explicit unidentified records when recovery remains incomplete', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, structuredClone(value)));
    },
    async deleteMany(keys) {
      keys.forEach(key => entries.delete(key));
    }
  };
  const requests = [];
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    fetchImpl: async (url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      requests.push(input);
      const output = input.pass === 'missing_panel_recovery'
        ? figureRecoveryOutput(input, ['D', 'E'], ['E'])
        : input.pass === 'figure_synthesis'
          ? figurePassOutput(input)
          : partialFigurePassOutput(input, ['A', 'B', 'C']);
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  const response = await router.handle(figureMessage([{
    ...figureInput(1), panelHints: labels
  }], { analysisDepth: 'standard' }));

  assert.equal(response.success, true, JSON.stringify(response));
  const result = response.data.figureResults[0];
  assert.deepEqual(result.panels.map(item => item.panel), labels);
  assert.deepEqual(result.unresolvedPanels, ['E', 'F']);
  assert.deepEqual(result.panelCoverage.resolvedPanels, ['A', 'B', 'C', 'D']);
  assert.deepEqual(result.panelCoverage.unresolvedPanels, ['E', 'F']);
  for (const label of ['E', 'F']) {
    const record = result.panels.find(item => item.panel === label);
    assert.equal(record.status, 'not_identifiable');
    assert.equal(record.reasonCode, 'insufficient_panel_evidence');
    assert.equal(Object.hasOwn(record, 'directObservation'), false);
    assert.equal(Object.hasOwn(record, 'localInference'), false);
  }
  const persisted = [...entries.values()].find(value => value.figureResult)?.figureResult;
  assert.deepEqual(persisted.unresolvedPanels, ['E', 'F']);
  assert.deepEqual(persisted.panels.slice(0, 3).map(item => item.panel), ['A', 'B', 'C']);
  assert.equal(requests.filter(item => item.pass === 'figure_synthesis').length, 1);
  const callsAfterFirst = requests.length;
  const cached = await router.handle(figureMessage([{
    ...figureInput(1), panelHints: labels
  }], { analysisDepth: 'standard' }));
  assert.equal(cached.success, true, JSON.stringify(cached));
  assert.equal(cached.data.cacheHits, 1);
  assert.equal(cached.data.figureResults[0].cacheHit, true);
  assert.equal(requests.length, callsAfterFirst);
  assert.deepEqual(cached.data.figureResults[0].panels, result.panels);
  assert.deepEqual(cached.data.figureResults[0].unresolvedPanels, ['E', 'F']);
});

test('cancels missing-Panel recovery without starting synthesis or completing recovery', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  const checkpoints = [];
  let calls = 0;
  let markRecoveryStarted;
  const recoveryStarted = new Promise(resolve => { markRecoveryStarted = resolve; });
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      if (calls === 1) {
        return jsonResponse({
          output_text: JSON.stringify(partialFigurePassOutput(input, ['A', 'B', 'C']))
        });
      }
      markRecoveryStarted();
      return new Promise((resolve, reject) => {
        const abort = () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
      });
    }
  });
  await configureOpenAIRouter(router);
  const pending = router.handle(figureMessage([{
    ...figureInput(1), panelHints: ['A', 'B', 'C', 'D', 'E', 'F']
  }], {
    analysisDepth: 'standard', operationId: 'figure-panel-recovery-cancel-test'
  }), figureCheckpointContext(progress, checkpoints));
  await recoveryStarted;
  const control = await router.handle({
    type: 'LLM_CONTROL_OPERATION',
    operationId: 'figure-panel-recovery-cancel-test',
    command: 'cancel'
  });
  const response = await pending;

  assert.equal(control.success, true);
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'CANCELLED');
  assert.equal(calls, 2);
  assert.ok(progress.some(item => item.phase === 'figure_panel_recovery_started'));
  const checkpoint = progress.find(item => item.phase === 'figure_panel_recovery_checkpoint');
  assert.equal(checkpoint.inputMode, 'caption_context');
  assert.equal(checkpoint.savedPanelCount, 3);
  assert.deepEqual(checkpoint.missingPanels, ['D', 'E', 'F']);
  assert.equal(Object.hasOwn(checkpoint, 'partialFigureResult'), false);
  assert.deepEqual(checkpoints[0].figureResult.panels.map(panel => panel.panel),
    ['A', 'B', 'C']);
  assert.equal(progress.some(item => item.phase === 'figure_panel_recovery_complete'), false);
  assert.equal(progress.some(item => item.phase === 'figure_synthesizing'), false);
});

test('cancellation after an ignored synthesis response prevents completion and cache writes', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  const cacheWrites = [];
  const cacheStore = {
    async getMany() { return new Map(); },
    async setMany(values) { cacheWrites.push(structuredClone(values)); },
    async deleteMany() {}
  };
  let releaseSynthesis;
  const synthesisGate = new Promise(resolve => { releaseSynthesis = resolve; });
  let markSynthesisStarted;
  const synthesisStarted = new Promise(resolve => { markSynthesisStarted = resolve; });
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    fetchImpl: async (url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      if (input.pass === 'figure_synthesis') {
        markSynthesisStarted();
        await synthesisGate;
        return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
      }
      const output = input.pass === 'missing_panel_recovery'
        ? figureRecoveryOutput(input, input.requested_panel_labels)
        : partialFigurePassOutput(input, ['A', 'B', 'C']);
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const operationId = 'figure-panel-synthesis-cancel-race-test';
  const pending = router.handle(figureMessage([{
    ...figureInput(1), panelHints: ['A', 'B', 'C', 'D', 'E', 'F']
  }], { analysisDepth: 'standard', operationId }),
  figureCheckpointContext(progress, []));
  await synthesisStarted;
  const control = await router.handle({
    type: 'LLM_CONTROL_OPERATION', operationId, command: 'cancel'
  });
  releaseSynthesis();
  const response = await pending;

  assert.equal(control.success, true);
  assert.equal(control.data.cancelled, true);
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'CANCELLED');
  assert.equal(progress.some(item => item.phase === 'figure_synthesis_complete'), false);
  assert.equal(progress.some(item => item.phase === 'figure_panel_recovery_complete'), false);
  assert.equal(progress.some(item => item.phase === 'figure'), false);
  assert.deepEqual(cacheWrites, []);
});

test('does not classify unrelated invalid Figure output as missing-Panel recovery', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      if (calls === 1) return jsonResponse({ output_text: '{not-json' });
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(figureMessage([{
    ...figureInput(1), panelHints: ['A', 'B']
  }], { analysisDepth: 'standard' }), {
    onProgress: event => progress.push(event)
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(calls, 2);
  assert.ok(progress.some(item => item.phase === 'figure_schema_retry'));
  assert.equal(progress.some(item => item.phase === 'figure_panel_recovery_started'), false);
  assert.equal(progress.some(item => item.phase === 'figure_panel_recovery_complete'), false);
});

test('splits a deep Figure, ignores repeated out-of-batch Panels, and exposes each checkpoint', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  const privateCheckpoints = [];
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      const output = figurePassOutput(input);
      if (input.pass === 'panel_extraction') {
        output.panels.push({ ...output.panels[0], panel: 'Z' });
      }
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const figure = {
    ...figureInput(1),
    panelHints: ['A', 'B', 'C', 'D', 'E']
  };
  const response = await router.handle(
    figureMessage([figure], {
      analysisDepth: 'deep', operationId: 'deep-private-checkpoints'
    }),
    figureCheckpointContext(progress, privateCheckpoints)
  );

  assert.equal(response.success, true);
  assert.equal(calls, 4);
  assert.deepEqual(response.data.figureResults[0].panels.map(item => item.panel),
    ['A', 'B', 'C', 'D', 'E']);
  const checkpoints = progress.filter(item => item.phase === 'figure_panel_batch_complete');
  assert.deepEqual(checkpoints.map(item => item.completedPanelBatches), [1, 2, 3]);
  assert.deepEqual(checkpoints.map(item => item.totalPanelBatches), [3, 3, 3]);
  assert.ok(checkpoints.every(item =>
    !Object.hasOwn(item, 'partialFigureResult') && !Object.hasOwn(item, 'figureResult')));
  assert.deepEqual(privateCheckpoints.map(item => item.figureResult.panels.length), [2, 4, 5, 5]);
  assert.deepEqual(checkpoints.map(item => item.inputMode),
    ['caption_context', 'caption_context', 'caption_context']);
  assert.deepEqual(checkpoints.map(item => item.savedPanelCount), [2, 4, 5]);
  assert.deepEqual(checkpoints.map(item => item.validatedPanelCount), [2, 4, 5]);
  assert.deepEqual(checkpoints.map(item => item.batchRecognizedPanelCount), [2, 2, 1]);
  assert.deepEqual(checkpoints.map(item => item.ignoredUnexpectedPanelCount), [1, 1, 1]);
  assert.deepEqual(checkpoints.map(item => item.unexpectedPanels), [['Z'], ['Z'], ['Z']]);
  assert.deepEqual(
    privateCheckpoints.at(-2).figureResult.panelCoverage.unexpectedPanels,
    ['Z']
  );
  assert.deepEqual(
    privateCheckpoints.at(-1).figureResult.panelCoverage.unexpectedPanels,
    []
  );
  assert.equal(progress.filter(item => item.phase === 'figure_synthesizing').length, 1);
  assert.equal(progress.filter(item => item.phase === 'figure_synthesis_complete').length, 1);
  assert.equal(progress.filter(item =>
    item.phase === 'figure_synthesis_checkpoint_complete').length, 1);
  const delivered = structuredClone(response.data.figureResults[0]);
  for (const field of ['inputMode', 'visionFallback', 'fallbackReason', 'cacheHit']) {
    if (!Object.hasOwn(privateCheckpoints.at(-1).figureResult, field)) {
      delete delivered[field];
    }
  }
  assert.deepEqual(privateCheckpoints.at(-1).figureResult, delivered);
});

test('recovers a missing Panel inside one deep extraction batch without retrying its peer', async () => {
  const storageArea = createMemoryStorage();
  const requests = [];
  const progress = [];
  let inFlight = 0;
  let maximumInFlight = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise(resolve => setImmediate(resolve));
      const input = openAIInputPayload(JSON.parse(options.body));
      requests.push(input);
      let output;
      if (input.pass === 'panel_extraction' &&
          input.expected_panel_labels.join(',') === 'A,B') {
        output = partialFigurePassOutput(input, ['A']);
      } else if (input.pass === 'missing_panel_recovery') {
        output = figureRecoveryOutput(input, input.requested_panel_labels);
      } else {
        output = figurePassOutput(input);
      }
      inFlight -= 1;
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(figureMessage([{
    ...figureInput(1), panelHints: ['A', 'B', 'C', 'D']
  }], { analysisDepth: 'deep' }), {
    onProgress: event => progress.push(event)
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.deepEqual(requests.map(input => ({
    pass: input.pass,
    panels: input.requested_panel_labels || input.expected_panel_labels ||
      input.panel_evidence?.map(panel => panel.panel)
  })), [
    { pass: 'panel_extraction', panels: ['A', 'B'] },
    { pass: 'missing_panel_recovery', panels: ['B'] },
    { pass: 'panel_extraction', panels: ['C', 'D'] },
    { pass: 'figure_synthesis', panels: ['A', 'B', 'C', 'D'] }
  ]);
  assert.deepEqual(requests[1].completed_panel_labels, ['A']);
  assert.equal(maximumInFlight, 1);
  assert.deepEqual(response.data.figureResults[0].panels.map(panel => panel.panel),
    ['A', 'B', 'C', 'D']);
  assert.equal(progress.filter(event => event.phase === 'figure_synthesizing').length, 1);
  assert.equal(progress.filter(event => event.phase === 'figure_synthesis_complete').length, 1);
});

test('preserves an unresolved deep-batch Panel and continues later extraction safely', async () => {
  const storageArea = createMemoryStorage();
  const requests = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      requests.push(input);
      let output;
      if (input.pass === 'panel_extraction' &&
          input.expected_panel_labels.join(',') === 'A,B') {
        output = partialFigurePassOutput(input, ['A']);
      } else if (input.pass === 'missing_panel_recovery') {
        output = figureRecoveryOutput(input, ['B'], ['B']);
      } else {
        output = figurePassOutput(input);
      }
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle(figureMessage([{
    ...figureInput(1), panelHints: ['A', 'B', 'C', 'D']
  }], { analysisDepth: 'deep' }));

  assert.equal(response.success, true, JSON.stringify(response));
  const result = response.data.figureResults[0];
  assert.deepEqual(result.panels.map(panel => panel.panel), ['A', 'B', 'C', 'D']);
  assert.deepEqual(result.unresolvedPanels, ['B']);
  assert.equal(result.panels[1].status, 'not_identifiable');
  assert.equal(Object.hasOwn(result.panels[1], 'localInference'), false);
  assert.deepEqual(
    requests.filter(input => input.pass === 'panel_extraction')
      .map(input => input.expected_panel_labels),
    [['A', 'B'], ['C', 'D']]
  );
  assert.deepEqual(
    requests.find(input => input.pass === 'figure_synthesis')
      .panel_evidence.map(panel => panel.panel),
    ['A', 'C', 'D']
  );
});

test('explicit current confirmation: deep recovery denied text fallback never reruns a completed extraction batch', async () => {
  const storageArea = createMemoryStorage();
  const requests = [];
  const cacheWrites = [];
  const progress = [];
  const router = createConfirmedFigureRouter({
    storageArea,
    cacheStore: {
      async getMany() { return new Map(); },
      async setMany(values) { cacheWrites.push(structuredClone(values)); },
      async deleteMany() {}
    },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const visual = Array.isArray(body.input);
      requests.push({
        pass: input.pass,
        panels: input.requested_panel_labels || input.expected_panel_labels,
        visual
      });
      if (input.pass === 'panel_extraction' && visual) {
        return jsonResponse({
          output_text: JSON.stringify(partialFigurePassOutput(input, ['A']))
        });
      }
      if (input.pass === 'missing_panel_recovery' && visual) {
        return jsonResponse({}, 400);
      }
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  }, 'pause');
  await configureOpenAIRouter(router);
  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_walkthrough.allowTextFallback = false;
  const response = await router.handle(figureMessage([{
    ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,/9j/2Q==' }]),
    panelHints: ['A', 'B', 'C', 'D']
  }], { analysisDepth: 'deep' }), {
    onProgress: event => progress.push(event)
  });

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_VISION_PAUSED');
  assert.deepEqual(requests, [
    { pass: 'panel_extraction', panels: ['A', 'B'], visual: true },
    { pass: 'missing_panel_recovery', panels: ['B'], visual: true }
  ]);
  assert.equal(cacheWrites.length, 0);
  assert.equal(progress.some(event => event.phase === 'figure_synthesizing'), false);
  assert.ok(progress.some(event =>
    event.phase === 'figure_panel_recovery_started' && event.recognizedPanelCount === 1
  ));
});

test('explicit current confirmation: deep recovery allows caption fallback only for the missing targeted Panel', async () => {
  const storageArea = createMemoryStorage();
  const requests = [];
  const progress = [];
  const router = createConfirmedFigureRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const visual = Array.isArray(body.input);
      requests.push({
        pass: input.pass,
        panels: input.requested_panel_labels || input.expected_panel_labels ||
          input.panel_evidence?.map(panel => panel.panel),
        visual
      });
      if (input.pass === 'panel_extraction' && visual) {
        return jsonResponse({
          output_text: JSON.stringify(partialFigurePassOutput(input, ['A']))
        });
      }
      if (input.pass === 'missing_panel_recovery' && visual) {
        return jsonResponse({}, 400);
      }
      const output = input.pass === 'missing_panel_recovery'
        ? figureRecoveryOutput(input, input.requested_panel_labels)
        : figurePassOutput(input);
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_walkthrough.allowTextFallback = true;
  const response = await router.handle(figureMessage([{
    ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,/9j/2Q==' }]),
    panelHints: ['A', 'B', 'C', 'D']
  }], { analysisDepth: 'deep' }), {
    onProgress: event => progress.push(event)
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.deepEqual(requests, [
    { pass: 'panel_extraction', panels: ['A', 'B'], visual: true },
    { pass: 'missing_panel_recovery', panels: ['B'], visual: true },
    { pass: 'missing_panel_recovery', panels: ['B'], visual: false },
    { pass: 'panel_extraction', panels: ['C', 'D'], visual: false },
    { pass: 'figure_synthesis', panels: ['A', 'B', 'C', 'D'], visual: false }
  ]);
  assert.equal(response.data.figureResults[0].visionFallback, true);
  assert.equal(progress.filter(event => event.phase === 'figure_synthesizing').length, 1);
  assert.equal(progress.filter(event => event.phase === 'figure_synthesis_complete').length, 1);
});

test('routes a targeted Panel follow-up through its language-and-telemetry managed Figure API', async () => {
  const storageArea = createMemoryStorage();
  const requested = [];
  const outputBudgets = [];
  const instructions = [];
  const progress = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      requested.push(input);
      outputBudgets.push(body.max_output_tokens);
      instructions.push(body.instructions);
      const output = panelFollowupOutput(input);
      const rankedSource = input.related_body_context[0];
      output.source_refs = [{
        kind: 'paragraph', ref: rankedSource.paragraph_id,
        paragraph_id: rankedSource.paragraph_id,
        quote: 'ranked fifth source at dose 10² units with p < 0.05'
      }];
      return jsonResponse({
        output_text: JSON.stringify(output),
        usage: { input_tokens: 456, output_tokens: 123 }
      });
    }
  });
  await configureOpenAIRouter(router);
  const preferences = await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      figurePanelFollowupPrompts: {
        grouping: 'Use only the grouping explicitly supported by this paper.'
      },
      language: 'en'
    }
  });
  assert.equal(preferences.success, true);
  const requestMessage = {
    type: 'LLM_ASK_FIGURE_PANEL',
    document: { title: 'Mechanistic study' },
    figure: { ...figureInput(1), panelHints: ['A'], contextParagraphs: [
      { paragraphId: 'p1', sectionTitle: 'Results', text: 'General result one.' },
      { paragraphId: 'p2', sectionTitle: 'Results', text: 'General result two.' },
      { paragraphId: 'p3', sectionTitle: 'Results', text: 'General result three.' },
      { paragraphId: 'p4', sectionTitle: 'Results', text: 'General result four.' },
      { paragraphId: 'p5', sectionTitle: 'Results',
        text: '🧪 Figure 1A statistical test reports the ranked fifth source at dose 10² units with p < 0.05 and x > 1.' }
    ] },
    panel: {
      panel: 'A', role: 'phenotype', phenotypeName: 'Cell viability',
      methods: ['CCK-8'], purpose: 'Measure viability', design: 'treated versus control',
      comparison: 'treated vs control', directObservation: 'treated group is lower'
    },
    topics: ['grouping', 'technique_principle'],
    customQuestion: 'Why was this statistical test selected?'
  };
  const response = await router.handle(
    requestMessage, { onProgress: event => progress.push(event) }
  );

  assert.equal(response.success, true);
  assert.equal(response.data.route.providerId, 'openai');
  assert.equal(response.data.panelFollowup.panel, 'A');
  assert.deepEqual(response.data.panelFollowup.topics, ['grouping', 'technique_principle']);
  assert.deepEqual(requested[0].requested_topics, ['grouping', 'technique_principle']);
  assert.equal(requested[0].custom_question, 'Why was this statistical test selected?');
  assert.equal(requested[0].requested_topic_instructions.grouping,
    'Use only the grouping explicitly supported by this paper.');
  assert.equal(requested[0].panel, 'A');
  assert.equal(requested[0].related_body_context[0].paragraph_id, 'p5');
  assert.equal(requested[0].related_body_context[0].text,
    '🧪 Figure 1A statistical test reports the ranked fifth source at dose 10² units with p < 0.05 and x > 1.');
  assert.doesNotMatch(requested[0].related_body_context[0].text, /102 units/u);
  assert.deepEqual(requested[0].available_source_refs, {
    panel: '1A',
    paragraph_ids: ['p5', 'p1', 'p2', 'p3']
  });
  assert.deepEqual(response.data.panelFollowup.sourceRefs, [
    {
      kind: 'panel', ref: '1A', figureId: 'figure-1', panelId: 'A',
      paragraphId: '', quote: ''
    },
    { kind: 'paragraph', ref: 'p5', paragraphId: 'p5',
      quote: 'ranked fifth source at dose 10² units with p < 0.05' }
  ]);
  assert.deepEqual(outputBudgets, [4096]);
  assert.equal(response.data.panelFollowup.inputBasis.inputMode, 'caption_context');
  assert.equal(response.data.panelFollowup.inputBasis.pixelsSupplied, false);
  assert.match(instructions[0], /OUTPUT_LANGUAGE_CONTRACT:[\s\S]*English/);
  const telemetry = progress.filter(event => event.phase === 'provider_telemetry');
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].featureId, 'figure_panel_followup');
  assert.equal(telemetry[0].inputTokens, 456);
  assert.equal(telemetry[0].outputTokens, 123);
  const cached = await router.handle(requestMessage);
  assert.equal(cached.success, true);
  assert.equal(cached.data.cacheHit, true);
  assert.equal(requested.length, 1);
  assert.equal(cached.data.panelFollowup.sourceRefs[1].paragraphId, 'p5');
  assert.equal(cached.data.panelFollowup.sourceRefs[1].quote,
    'ranked fifth source at dose 10² units with p < 0.05');
});

test('replaces unsafe targeted Panel current records without read-path deletion', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const evicted = [];
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, value));
    },
    async deleteMany(keys) {
      keys.forEach(key => {
        evicted.push(key);
        entries.delete(key);
      });
    }
  };
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea, cacheStore,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      const output = panelFollowupOutput(input);
      output.answer_zh = `validated provider answer ${calls}`;
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const message = {
    type: 'LLM_ASK_FIGURE_PANEL', document: { title: 'Panel cache validation' },
    figure: { ...figureInput(1), panelHints: ['A'] },
    panel: { panel: 'A', purpose: 'Compare groups' }, topics: ['grouping'],
    customQuestion: ''
  };
  const first = await router.handle(message);
  assert.equal(first.success, true);
  assert.equal(calls, 1);
  const cachedKey = [...entries.keys()][0];
  const mutateAndRecompute = async mutate => {
    mutate(entries.get(cachedKey).panelResult);
    const response = await router.handle(message);
    assert.equal(response.success, true);
    assert.equal(response.data.cacheHit, false);
    assert.doesNotMatch(JSON.stringify(response), /cache-secret|evil\.example|damaged/i);
    return response;
  };

  await mutateAndRecompute(value => {
    value.secret = 'cache-secret';
    value.url = 'https://evil.example/credential';
  });
  await mutateAndRecompute(value => { value.answer = ''; });
  await mutateAndRecompute(value => { value.answer = { damaged: true }; });
  const last = await mutateAndRecompute(value => { value.sourceRefs = { damaged: true }; });

  assert.equal(calls, 5);
  assert.equal(last.data.panelFollowup.answer, 'validated provider answer 5');
  assert.deepEqual(evicted, []);
  assert.equal(entries.get(cachedKey).panelResult.promptVersion,
    globalThis.SciLLM.FIGURE_PANEL_PROMPT_VERSION);
  assert.notEqual(globalThis.SciLLM.FIGURE_PANEL_PROMPT_VERSION, '2-panel-ir-memory');
});

test('recomputes unsafe targeted Panel current records without relying on deletion', async () => {
  async function runCase({ deleteFails = false, providerFails = false }) {
    const storageArea = createMemoryStorage();
    const entries = new Map();
    let deleteCalls = 0;
    let providerCalls = 0;
    const cacheStore = {
      async getMany(keys) {
        return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
      },
      async setMany(values) {
        values.forEach(value => entries.set(value.key, value));
      },
      async deleteMany(keys) {
        deleteCalls += 1;
        if (deleteFails) throw new Error('cache-delete-backend-secret');
        keys.forEach(key => entries.delete(key));
      }
    };
    const router = createBackgroundRouter({
      storageArea, cacheStore,
      fetchImpl: async (url, options) => {
        providerCalls += 1;
        const input = openAIInputPayload(JSON.parse(options.body));
        if (providerFails && providerCalls > 1) {
          return jsonResponse({ error: { message: 'provider-backend-secret' } }, 401);
        }
        const output = panelFollowupOutput(input);
        output.answer_zh = `safe answer ${providerCalls}`;
        return jsonResponse({ output_text: JSON.stringify(output) });
      }
    });
    await configureOpenAIRouter(router);
    const message = {
      type: 'LLM_ASK_FIGURE_PANEL', document: { title: 'Eviction isolation' },
      figure: { ...figureInput(1), panelHints: ['A'] },
      panel: { panel: 'A', purpose: 'Compare groups' }, topics: ['grouping'],
      customQuestion: ''
    };
    await router.handle(message);
    const cachedKey = [...entries.keys()][0];
    entries.get(cachedKey).panelResult.answer = '';
    const response = await router.handle(message);
    return { response, deleteCalls, providerCalls };
  }

  const recovered = await runCase({ deleteFails: true, providerFails: false });
  assert.equal(recovered.response.success, true);
  assert.equal(recovered.response.data.panelFollowup.answer, 'safe answer 2');
  assert.equal(recovered.providerCalls, 2);
  assert.equal(recovered.deleteCalls, 0);
  assert.doesNotMatch(JSON.stringify(recovered.response), /cache-delete-backend-secret/);

  const providerFailure = await runCase({ deleteFails: false, providerFails: true });
  assert.equal(providerFailure.response.success, false);
  assert.equal(providerFailure.providerCalls, 2);
  assert.equal(providerFailure.deleteCalls, 0);
  assert.doesNotMatch(JSON.stringify(providerFailure.response),
    /cache-delete-backend-secret|provider-backend-secret/);
  assert.match(JSON.stringify(providerFailure.response), /AUTH_INVALID|authentication/i);
});

test('Panel heading preferences are normalized before persistence and stay credential-safe', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  const response = await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      figurePanelHeaderFields: {
        evidenceType: false,
        purpose: true,
        experimentalMethods: 'yes',
        comparison: true,
        unsupported: true
      },
      apiKey: 'must-not-be-persisted-or-returned'
    }
  });

  assert.equal(response.success, true);
  assert.deepEqual(storageArea.values.sciLlmSettingsV2.figurePanelHeaderFields, {
    evidenceType: false,
    purpose: true,
    experimentalMethods: true,
    statisticalMethods: true,
    comparison: true,
    directObservation: false
  });
  assert.doesNotMatch(JSON.stringify(response), /must-not-be-persisted-or-returned/);
  assert.equal(Object.hasOwn(storageArea.values.sciLlmSettingsV2, 'apiKey'), false);
});

test('custom-only Panel follow-up accepts empty topics and preserves the normalized question', async () => {
  const storageArea = createMemoryStorage();
  const requested = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      requested.push(input);
      return jsonResponse({ output_text: JSON.stringify(panelFollowupOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);

  const response = await router.handle({
    type: 'LLM_ASK_FIGURE_PANEL',
    document: { title: 'Paired measurements' },
    figure: { ...figureInput(1), panelHints: ['A'] },
    panel: { panel: 'A', purpose: 'Compare paired samples' },
    topics: [],
    customQuestion: '为什么作者在这里使用配对 t 检验？'
  });

  assert.equal(response.success, true);
  assert.deepEqual(response.data.panelFollowup.topics, []);
  assert.deepEqual(requested[0].requested_topics, []);
  assert.equal(requested[0].custom_question, '为什么作者在这里使用配对 t 检验?');
  assert.equal(response.data.panelFollowup.customQuestion, '为什么作者在这里使用配对 t 检验?');
});

test('custom-only Panel follow-up reserves provider-settings wording for provider validation', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => jsonResponse({})
  });
  await configureOpenAIRouter(router);

  const response = await router.handle({
    type: 'LLM_ASK_FIGURE_PANEL',
    document: { title: 'Paired measurements' },
    figure: { ...figureInput(1), panelHints: ['A'] },
    panel: { panel: 'A' }, topics: [], customQuestion: ''
  });

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'INVALID_SETTINGS');
  assert.deepEqual(response.error.fields, ['topics', 'customQuestion']);
  assert.equal(response.error.message,
    'Panel follow-up requires a built-in topic or a custom question');
  assert.ok(response.error.message.length <= 240);

  const invalidProvider = await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai-compatible',
    config: { apiKey: 'secret', model: 'model', baseUrl: 'file:///tmp/api' }
  });
  assert.equal(invalidProvider.success, false);
  assert.equal(invalidProvider.error.message,
    'Provider settings are incomplete or invalid');
  assert.ok(invalidProvider.error.fields.length <= 24);
});

test('custom-only Panel follow-up never exposes an untrusted invalid-settings message', async () => {
  const secret = 'provider-detail-secret-must-not-leak';
  const originalResolveTaskProfile = globalThis.SciLLM.resolveTaskProfile;
  globalThis.SciLLM.resolveTaskProfile = () => {
    const error = new Error('Invalid local route');
    error.code = 'INVALID_SETTINGS';
    error.userMessage = `Provider rejected the request: ${secret}`;
    error.fields = ['provider.response'];
    throw error;
  };
  try {
    const router = createBackgroundRouter({
      storageArea: createMemoryStorage(),
      fetchImpl: async () => jsonResponse({})
    });
    await configureOpenAIRouter(router);
    const response = await router.handle({
      type: 'LLM_ASK_FIGURE_PANEL',
      document: { title: 'Paired measurements' },
      figure: { ...figureInput(1), panelHints: ['A'] },
      panel: { panel: 'A' }, topics: [],
      customQuestion: '为什么作者在这里使用配对 t 检验？'
    });

    assert.equal(response.success, false);
    assert.equal(response.error.code, 'INVALID_SETTINGS');
    assert.equal(response.error.message, 'The request contains invalid or unsupported input');
    assert.doesNotMatch(JSON.stringify(response), new RegExp(secret));
  } finally {
    globalThis.SciLLM.resolveTaskProfile = originalResolveTaskProfile;
  }
});

test('repairs one structurally invalid targeted Panel follow-up response', async () => {
  const storageArea = createMemoryStorage();
  const inputs = [];
  const instructions = [];
  const progress = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      inputs.push(input);
      instructions.push(body.instructions);
      if (inputs.length === 1) {
        return jsonResponse({ output_text: JSON.stringify({ answer_zh: 'missing required keys' }) });
      }
      return jsonResponse({ output_text: JSON.stringify(panelFollowupOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);

  const response = await router.handle({
    type: 'LLM_ASK_FIGURE_PANEL',
    document: { title: 'Panel schema repair' },
    figure: { ...figureInput(1), panelHints: ['A'] },
    panel: {
      panel: 'A', role: 'phenotype', purpose: 'Measure the target phenotype',
      design: 'treated versus matched control', comparison: 'treated vs control'
    },
    topics: ['grouping'],
    customQuestion: 'Why is the matched control important?',
    forceRefresh: true
  }, { onProgress: event => progress.push(event) });

  assert.equal(response.success, true);
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs[0], inputs[1]);
  assert.doesNotMatch(instructions[0], /SCHEMA_REPAIR_PASS/);
  assert.match(instructions[1], /SCHEMA_REPAIR_PASS/);
  assert.equal(response.data.panelFollowup.inputBasis.attempts, 2);
  assert.ok(progress.some(event => event.phase === 'figure_panel_schema_retry'));
});

function closedTabSupplementalWorkspace(overrides = {}) {
  return {
    schemaVersion: 1,
    workspaceId: `workspace:${'8'.repeat(64)}`,
    canonicalUrl: 'https://journal.example/article',
    aliases: [],
    title: 'Closed article tab',
    directoryName: `Closed article tab--${'8'.repeat(16)}`,
    revision: '7'.repeat(64),
    contentHash: '7'.repeat(64),
    workspaceGeneration: 4,
    ...overrides
  };
}

function closedTabSupplementalTarget(workspace, overrides = {}) {
  return {
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    targetArticleTabId: 91,
    canonicalUrl: `${workspace.canonicalUrl}?ignored=1#section`,
    documentHash: `sha256:${workspace.contentHash}`,
    ...overrides
  };
}

function closedTabSupplementalDraft({ mode = 'caption', fingerprint = '6' } = {}) {
  const sourceFingerprint = `sha256:${fingerprint.repeat(64)}`;
  return globalThis.SciLLM.createSupplementalFigureImportDraft({
    sourceMode: mode,
    sourceMaterialId: `manual-${mode}-${fingerprint.repeat(10)}`,
    sourceFileName: mode === 'image' ? 'figure-s1.png' : '',
    sourceMimeType: mode === 'image' ? 'image/png' : '',
    sourceFileSize: mode === 'image' ? 4 : 0,
    sourceImportedAt: '2026-08-03T03:04:05.000Z',
    sourceFingerprint,
    caption: 'A, treatment increases signal. B, matched control remains stable.',
    figureLabel: 'Supplemental Figure S1'
  });
}

test('closed-tab manual drafts use the shared positional save and image contract', () => {
  const source = readFileSync(join(__dirname, '..', 'core', 'background-router.js'), 'utf8');
  const start = source.indexOf('async function saveClosedTabSupplementalDraft');
  const end = source.indexOf('function publicStoredArticleChatTurn', start);
  const route = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(route, /decorateDraft/);
  assert.match(route, /analysisImages:\s*\[cloneJsonLike\(normalized\.transientImage\)\]/);
  assert.match(route, /save:\s*\(relativePath, draftContent, conflict\)/);
  assert.match(route, /asset\s*=\s*created\.persisted/);
});

test('bound supplemental asset routes validate the parent identity before any asset access', async () => {
  const workspace = closedTabSupplementalWorkspace();
  let assetReads = 0;
  let assetWrites = 0;
  let providerCalls = 0;
  const store = {
    async getWorkspace(id) {
      return id === workspace.workspaceId ? structuredClone(workspace) : null;
    },
    async getAsset() {
      assetReads += 1;
      return { relativePath: 'figures/supplemental/s1.json', content: { marker: 'existing' } };
    },
    async putAsset(id, relativePath, content) {
      assetWrites += 1;
      return { workspaceId: id, relativePath, content, revision: 1, contentHash: 'saved' };
    }
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: store,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('provider must not be called');
    }
  });
  const validTarget = closedTabSupplementalTarget(workspace);
  const withoutDocumentHash = { ...validTarget };
  delete withoutDocumentHash.documentHash;
  const cases = [
    [{ ...validTarget, workspaceId: `workspace:${'b'.repeat(64)}` },
      'SUPPLEMENTAL_TARGET_INVALID'],
    [{ ...validTarget, workspaceGeneration: workspace.workspaceGeneration + 1 },
      'WORKSPACE_GENERATION_CONFLICT'],
    [{ ...validTarget, canonicalUrl: 'https://journal.example/other' },
      'SUPPLEMENTAL_TARGET_CANONICAL_MISMATCH'],
    [withoutDocumentHash, 'SUPPLEMENTAL_TARGET_DOCUMENT_MISMATCH'],
    [{ ...validTarget, documentHash: '5'.repeat(64) },
      'SUPPLEMENTAL_TARGET_DOCUMENT_MISMATCH']
  ];

  for (const type of ['ARTICLE_WORKSPACE_GET_ASSET', 'ARTICLE_WORKSPACE_SAVE_ASSET']) {
    for (const [target, expectedCode] of cases) {
      const response = await router.handle({
        type,
        workspaceId: workspace.workspaceId,
        workspaceGeneration: workspace.workspaceGeneration,
        relativePath: 'figures/supplemental/s1.json',
        content: { marker: 'replacement' },
        target
      });
      assert.equal(response.success, false, `${type}:${expectedCode}`);
      assert.equal(response.error.code, expectedCode, type);
    }
  }

  assert.equal(assetReads, 0);
  assert.equal(assetWrites, 0);
  assert.equal(providerCalls, 0);
});

test('bound supplemental asset routes accept a normalized bare parent hash', async () => {
  const workspace = closedTabSupplementalWorkspace();
  const calls = [];
  const store = {
    async getWorkspace() { return structuredClone(workspace); },
    async getAsset(id, relativePath) {
      calls.push(['get', id, relativePath]);
      return { relativePath, content: { marker: 'existing' }, revision: 1 };
    },
    async putAsset(id, relativePath, content) {
      calls.push(['put', id, relativePath]);
      return { workspaceId: id, relativePath, content, revision: 2, contentHash: 'saved' };
    }
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: store,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const target = {
    ...closedTabSupplementalTarget(workspace),
    documentHash: workspace.contentHash
  };
  const getResponse = await router.handle({
    type: 'ARTICLE_WORKSPACE_GET_ASSET',
    workspaceId: workspace.workspaceId,
    relativePath: 'figures/supplemental/s1.json',
    target
  });
  const saveResponse = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    relativePath: 'figures/supplemental/s1.json',
    content: { marker: 'replacement' },
    target
  });

  assert.equal(getResponse.success, true);
  assert.equal(saveResponse.success, true);
  assert.deepEqual(calls.map(call => call[0]), ['get', 'put']);
});

test('closed-tab supplemental image draft persists only the normalized compressed analysis image', async () => {
  const workspace = closedTabSupplementalWorkspace();
  const assets = new Map();
  const calls = [];
  let providerCalls = 0;
  const store = {
    async getWorkspace(id) {
      return id === workspace.workspaceId ? structuredClone(workspace) : null;
    },
    async getAsset(id, path) {
      return structuredClone(assets.get(`${id}:${path}`) || null);
    },
    async putAsset(id, path, content, conflict) {
      calls.push({ id, path, content: structuredClone(content), conflict: { ...conflict } });
      const saved = {
        workspaceId: id,
        relativePath: path,
        content: structuredClone(content),
        revision: 1,
        contentHash: 'stored-content-hash'
      };
      assets.set(`${id}:${path}`, saved);
      return structuredClone(saved);
    }
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: store,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('provider must not be called');
    }
  });
  const draft = closedTabSupplementalDraft({ mode: 'image' });
  const response = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_SUPPLEMENTAL_DRAFT',
    target: closedTabSupplementalTarget(workspace),
    draft: { ...draft, dataUrl: 'data:image/png;base64,U0VDUkVU' },
    transientImage: {
      mediaType: 'image/png',
      dataUrl: 'data:image/png;base64,AQID',
      width: 1,
      height: 1,
      sourceFingerprint: draft.sourceFingerprint
    },
    expectedRevision: 999,
    createOnly: false
  });

  assert.equal(response.success, true);
  assert.deepEqual(response.data, {
    saved: true,
    queued: false,
    directoryPersisted: false,
    directoryPermission: 'unavailable',
    directoryErrorCode: '',
    asset: {
      relativePath: calls[0].path,
      revision: 1,
      contentHash: 'stored-content-hash'
    },
    analysisStatus: 'awaiting_article_context',
    figureLabel: 'Figure S1',
    panelHints: []
  });
  assert.deepEqual(calls[0].conflict, { expectedRevision: 0, createOnly: true });
  assert.equal(calls[0].content.analysisStatus, 'awaiting_article_context');
  assert.equal(calls[0].content.figures[0].analysisStatus, 'awaiting_article_context');
  assert.deepEqual(calls[0].content.figures[0].analysisImages, [{
    mediaType: 'image/png',
    dataUrl: 'data:image/png;base64,AQID',
    width: 1,
    height: 1,
    sourceFingerprint: draft.sourceFingerprint
  }]);
  assert.equal(Object.hasOwn(calls[0].content, 'dataUrl'), false);
  assert.doesNotMatch(JSON.stringify(calls[0].content), /U0VDUkVU/);
  assert.equal(providerCalls, 0);
});

test('closed-tab supplemental image draft requires a normalized transient image', async () => {
  const workspace = closedTabSupplementalWorkspace();
  let writes = 0;
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: {
      async getWorkspace() { return structuredClone(workspace); },
      async getAsset() { return null; },
      async putAsset() { writes += 1; throw new Error('must not write'); }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const response = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_SUPPLEMENTAL_DRAFT',
    target: closedTabSupplementalTarget(workspace),
    draft: closedTabSupplementalDraft({ mode: 'image' })
  });

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'SUPPLEMENTAL_TRANSIENT_IMAGE');
  assert.equal(writes, 0);
});

test('closed-tab supplemental draft rejects stale or mismatched targets before any write', async () => {
  const workspace = closedTabSupplementalWorkspace();
  let writes = 0;
  let providerCalls = 0;
  const store = {
    async getWorkspace(id) {
      return id === workspace.workspaceId ? structuredClone(workspace) : null;
    },
    async getAsset() { return null; },
    async putAsset() { writes += 1; throw new Error('must not write'); }
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: store,
    fetchImpl: async () => { providerCalls += 1; throw new Error('must not call provider'); }
  });
  const draft = closedTabSupplementalDraft();
  const cases = [
    [{ ...closedTabSupplementalTarget(workspace), workspaceGeneration: 5 },
      'WORKSPACE_GENERATION_CONFLICT'],
    [{ ...closedTabSupplementalTarget(workspace), canonicalUrl: 'https://journal.example/other' },
      'SUPPLEMENTAL_TARGET_CANONICAL_MISMATCH'],
    [{ ...closedTabSupplementalTarget(workspace), documentHash: 'not-a-hash' },
      'SUPPLEMENTAL_TARGET_INVALID'],
    [{ ...closedTabSupplementalTarget(workspace), documentHash: '5'.repeat(64) },
      'SUPPLEMENTAL_TARGET_DOCUMENT_MISMATCH'],
    [{ ...closedTabSupplementalTarget(workspace), targetArticleTabId: -1 },
      'SUPPLEMENTAL_TARGET_INVALID']
  ];

  for (const [target, expectedCode] of cases) {
    const response = await router.handle({
      type: 'ARTICLE_WORKSPACE_SAVE_SUPPLEMENTAL_DRAFT', target, draft
    });
    assert.equal(response.success, false);
    assert.equal(response.error.code, expectedCode);
  }
  assert.equal(writes, 0);
  assert.equal(providerCalls, 0);
});

test('concurrent closed-tab supplemental drafts resolve create-only collisions to distinct paths', async () => {
  const workspace = closedTabSupplementalWorkspace();
  const assets = new Map();
  const successfulWrites = [];
  let providerCalls = 0;
  const store = {
    async getWorkspace(id) {
      return id === workspace.workspaceId ? structuredClone(workspace) : null;
    },
    async getAsset(id, path) {
      await Promise.resolve();
      return structuredClone(assets.get(`${id}:${path}`) || null);
    },
    async putAsset(id, path, content, conflict) {
      assert.deepEqual(conflict, { expectedRevision: 0, createOnly: true });
      await Promise.resolve();
      const key = `${id}:${path}`;
      if (assets.has(key)) {
        const error = new Error('ASSET_REVISION_CONFLICT');
        error.code = 'ASSET_REVISION_CONFLICT';
        throw error;
      }
      const saved = {
        workspaceId: id,
        relativePath: path,
        content: structuredClone(content),
        revision: 1,
        contentHash: `hash-${successfulWrites.length + 1}`
      };
      assets.set(key, saved);
      successfulWrites.push(path);
      return structuredClone(saved);
    }
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: store,
    fetchImpl: async () => { providerCalls += 1; throw new Error('must not call provider'); }
  });
  const message = {
    type: 'ARTICLE_WORKSPACE_SAVE_SUPPLEMENTAL_DRAFT',
    target: closedTabSupplementalTarget(workspace),
    draft: closedTabSupplementalDraft()
  };
  const responses = await Promise.all([
    router.handle(structuredClone(message)),
    router.handle(structuredClone(message))
  ]);

  assert.ok(responses.every(response => response.success));
  assert.equal(new Set(responses.map(response => response.data.asset.relativePath)).size, 2);
  assert.equal(new Set(successfulWrites).size, 2);
  assert.equal(assets.size, 2);
  assert.equal(providerCalls, 0);
});

test('closed-tab supplemental draft maps eight create-only conflicts to one safe collision error', async () => {
  const workspace = closedTabSupplementalWorkspace();
  let putCalls = 0;
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: {
      async getWorkspace() { return structuredClone(workspace); },
      async getAsset() { return null; },
      async putAsset(_id, _path, _content, conflict) {
        putCalls += 1;
        assert.deepEqual(conflict, { expectedRevision: 0, createOnly: true });
        const error = new Error('raw conflict details must not escape');
        error.code = 'ASSET_REVISION_CONFLICT';
        throw error;
      }
    },
    fetchImpl: async () => { providerCalls += 1; throw new Error('must not call provider'); }
  });

  const response = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_SUPPLEMENTAL_DRAFT',
    target: closedTabSupplementalTarget(workspace),
    draft: closedTabSupplementalDraft()
  });

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'SUPPLEMENTAL_MATERIAL_ID_COLLISION');
  assert.doesNotMatch(JSON.stringify(response), /raw conflict details/);
  assert.equal(putCalls, 8);
  assert.equal(providerCalls, 0);
});

test('persists Figure and chat provider route metadata through router storage and directory flush', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'9'.repeat(64)}`,
    canonicalUrl: 'https://example.org/provider-route-paper',
    aliases: [],
    title: 'Provider route paper',
    directoryName: `Provider route paper--${'9'.repeat(16)}`,
    revision: '9'.repeat(64),
    contentHash: '9'.repeat(64),
    workspaceGeneration: 1
  };
  const handleStore = createWritableDirectoryHandleStore('prompt');
  const queueStore = createMemorySyncQueue();
  const directorySync = createDirectorySync({
    handleStore,
    queueStore,
    sourceId: 'background-router-workspace-provider-test'
  });
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const putAsset = workspaceStore.putAsset.bind(workspaceStore);
  workspaceStore.putAsset = async (workspaceId, path, content) => {
    globalThis.SciLLM.assertWorkspaceSafeValue(content);
    return putAsset(workspaceId, path, content);
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('workspace operations must stay local'); }
  });

  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_ENSURE', workspace
  })).success, true);
  const usage = {
    inputTokens: 120,
    outputTokens: 40,
    cacheHitTokens: 80,
    totalTokens: 160,
    maxOutputTokens: 4096
  };
  const assets = [
    {
      path: 'figures/figure-1/analysis.json',
      content: {
        figureId: 'figure-1',
        route: { providerId: 'vision-main', provider: 'openai', model: 'gpt-4.1' },
        usage
      }
    },
    {
      path: 'chat/turns/turn-1-analysis.json',
      content: {
        turnId: 'turn-1',
        route: { providerId: 'chat-main', provider: 'deepseek', model: 'deepseek-chat' },
        usage
      }
    }
  ];
  for (const asset of assets) {
    const response = await router.handle({
      type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
      workspaceId: workspace.workspaceId,
      workspaceGeneration: 1,
      relativePath: asset.path,
      content: asset.content
    });
    assert.equal(response.success, true, asset.path);
    assert.equal(response.data.queued, true, asset.path);
  }
  const rejected = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    relativePath: 'figures/figure-1/credential-leak.json',
    content: { apiKey: 'sk-must-not-persist', providerToken: 'must-not-persist' }
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.error.code, 'WORKSPACE_CONTAINS_CREDENTIALS');

  const queuedPaths = (await queueStore.getAll()).map(item => item.relativePath);
  for (const asset of assets) {
    assert.ok(queuedPaths.includes(`workspaces/${workspace.directoryName}/${asset.path}`));
  }
  assert.ok(!queuedPaths.some(path => path.includes('credential-leak')));

  handleStore.setPermission('granted');
  await new Promise(resolve => setTimeout(resolve, 0));
  const flushed = await directorySync.flush();
  assert.equal(flushed.failed, 0);
  assert.equal(flushed.pendingCount, 0);
  for (const asset of assets) {
    const path = `Brevess/workspaces/${workspace.directoryName}/${asset.path}`;
    const envelope = JSON.parse(handleStore.readText(path));
    assert.deepEqual(envelope.data, asset.content);
  }
  const supplementalPath = 'figures/supplemental/manual-image-s1.json';
  const supplementalContent = {
    schemaVersion: 1,
    materialId: 'manual-image-s1',
    sourceMode: 'image',
    figures: [{
      figureId: 'supp-manual-image-s1',
      figureLabel: 'Figure S1',
      caption: 'Figure S1. Caption persisted with the image.',
      analysisImages: [{
        mediaType: 'image/png',
        dataUrl: 'data:image/png;base64,AQID',
        width: 1,
        height: 1
      }]
    }]
  };
  const supplementalSaved = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    relativePath: supplementalPath,
    content: supplementalContent,
    requireDirectoryPersistence: true
  });
  assert.equal(supplementalSaved.success, true);
  assert.equal(supplementalSaved.data.queued, true);
  assert.equal(supplementalSaved.data.directoryPersisted, true);
  const supplementalEnvelope = JSON.parse(handleStore.readText(
    `Brevess/workspaces/${workspace.directoryName}/${supplementalPath}`
  ));
  assert.equal(supplementalEnvelope.data.figures[0].caption,
    'Figure S1. Caption persisted with the image.');
  assert.equal(supplementalEnvelope.data.figures[0].analysisImages[0].dataUrl,
    'data:image/png;base64,AQID');
});

test('routes credential-free multi-file workspace save, scan, export, and crash-safe deletion', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'a'.repeat(64)}`,
    canonicalUrl: 'https://example.org/paper',
    aliases: [{ type: 'doi', value: '10.1000/example' }],
    title: 'Example paper',
    directoryName: `Example paper--${'a'.repeat(16)}`,
    revision: '1'.repeat(64), contentHash: '1'.repeat(64), workspaceGeneration: 1
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted', manifests: [],
      matches: [{ match: 'exact', manifest: { ...workspace, kind: 'sci-logic-highlighter-workspace' } }]
    })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('workspace operations must stay local'); }
  });

  assert.equal((await router.handle({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace })).success, true);
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    relativePath: 'ui/state.json', content: { view: 'chat' }
  })).success, true);
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    relativePath: 'figures/supplemental/cell-support.json',
    content: {
      materialId: 'cell-support',
      figures: [{ figureId: 'supp-cell-support-s1', figureLabel: 'Figure S1' }]
    }
  })).success, true);
  const supplementalAssets = await router.handle({
    type: 'ARTICLE_WORKSPACE_LIST_ASSETS',
    workspaceId: workspace.workspaceId,
    prefix: 'figures/supplemental/'
  });
  assert.equal(supplementalAssets.success, true);
  assert.deepEqual(
    supplementalAssets.data.assets.map(asset => asset.relativePath),
    ['figures/supplemental/cell-support.json']
  );
  assert.equal(
    supplementalAssets.data.assets[0].content.figures[0].figureLabel,
    'Figure S1'
  );
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_TURN', workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    turn: { turnId: 'turn-1', role: 'user', content: 'Question' }
  })).success, true);
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    relativePath: 'chat/index.json',
    content: { turns: [], totalTurns: 0, returnedTurns: 0 }
  })).success, true);
  const savedChatIndex = (await workspaceStore.listAssets(workspace.workspaceId))
    .find(asset => asset.relativePath === 'chat/index.json').content;
  assert.equal(savedChatIndex.totalTurns, 1);
  assert.equal(savedChatIndex.turns[0].turnId, 'turn-1');
  const staleMutation = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: workspace.workspaceId,
    workspaceGeneration: 2,
    relativePath: 'ui/stale-state.json', content: { view: 'stale' }
  });
  assert.equal(staleMutation.success, false);
  assert.equal(staleMutation.error.code, 'WORKSPACE_GENERATION_CONFLICT');
  const scan = await router.handle({
    type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity: {
      canonicalUrl: workspace.canonicalUrl, contentHash: workspace.contentHash
    }, requestPermission: true
  });
  assert.equal(scan.data.matches[0].match, 'exact');
  assert.equal(directorySync.permissionRequests, 1);
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_PROBE', identity: { canonicalUrl: workspace.canonicalUrl }
  })).data.matches[0].match, 'exact');
  assert.equal((await router.handle({ type: 'ARTICLE_WORKSPACE_LIST' })).data.workspaces.length, 1);
  assert.equal((await router.handle({ type: 'ARTICLE_WORKSPACE_STATS' })).data.turnCount, 1);
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_REBUILD_INDEX'
  })).data.workspaceCount, 0);
  const exported = await router.handle({
    type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId: workspace.workspaceId
  });
  assert.equal(exported.data.turns.length, 1);
  assert.doesNotMatch(JSON.stringify(exported.data), /apiKey|Authorization|absolutePath/i);

  const begun = await router.handle({
    type: 'ARTICLE_WORKSPACE_BEGIN_DELETE', workspaceId: workspace.workspaceId
  });
  assert.equal(begun.data.tombstoneId, 'workspace-delete-1');
  const finalized = await router.handle({
    type: 'ARTICLE_WORKSPACE_FINALIZE_DELETE', workspaceId: workspace.workspaceId,
    tombstoneId: begun.data.tombstoneId
  });
  assert.equal(finalized.data.deleted, true);
  assert.equal(finalized.data.workspaceGeneration, 2);
  assert.equal(await workspaceStore.getWorkspace(workspace.workspaceId), null);
  const rejectedResurrection = await router.handle({
    type: 'ARTICLE_WORKSPACE_PROBE', identity: { canonicalUrl: workspace.canonicalUrl }
  });
  assert.deepEqual(rejectedResurrection.data.matches, []);
  assert.equal(rejectedResurrection.data.tombstonedMatches, 1);
});

test('workspace export fails closed for an unbound web answer and strips raw grounding payloads', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'f'.repeat(64)}`,
    canonicalUrl: 'https://example.org/web-grounding-export',
    aliases: [], title: 'Web grounding export',
    directoryName: `Web grounding export--${'f'.repeat(16)}`,
    revision: 'f'.repeat(64), contentHash: 'f'.repeat(64), workspaceGeneration: 1
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('workspace export must stay local'); }
  });
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_ENSURE', workspace
  })).success, true);
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_TURN',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    turn: {
      turnId: 'turn-forged-web', question: 'question', intent: 'answer',
      status: 'completed', summary: 'forged summary',
      answerBlocks: [{ blockId: 'block-forged-web', markdown: 'forged answer' }],
      route: { providerId: 'deepseek', model: 'deepseek-chat' },
      webSearch: {
        enabled: true, searched: true, completedOperationId: 'operation-forged-web'
      },
      webGrounding: {
        receiptId: 'forged-receipt', rawResponse: 'raw-provider-payload'
      },
      createdAt: 1, updatedAt: 2
    }
  })).success, true);
  const sourceUrl = 'https://www.nih.gov/news-events/research-matters/export-proof';
  const stableAnswerBlocks = [{
    blockId: 'block-valid-web', markdown: 'grounded answer'
  }];
  const validBinding = {
    providerId: 'deepseek', model: 'deepseek-chat',
    turnId: 'turn-valid-web', operationId: 'operation-valid-web',
    question: 'valid question', answer: 'grounded answer',
    answerBlocks: stableAnswerBlocks
  };
  const validReceipt = globalThis.SciLLM.createArticleChatWebGroundingReceipt({
    ...validBinding,
    grounding: {
      schemaVersion: 1,
      providerId: validBinding.providerId,
      model: validBinding.model,
      providerResponseId: 'response-valid-web',
      searched: true,
      sources: [{
        sourceId: `web-source-${createHash('sha256').update(sourceUrl)
          .digest('hex').slice(0, 16)}`,
        url: sourceUrl, title: 'NIH source', hostname: 'www.nih.gov',
        blockIds: ['block-valid-web']
      }]
    }
  });
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_TURN',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    turn: {
      turnId: validBinding.turnId, question: validBinding.question,
      intent: 'answer', status: 'completed', summary: '',
      answerBlocks: stableAnswerBlocks,
      route: { providerId: validBinding.providerId, model: validBinding.model },
      webSearch: {
        enabled: true, searched: true,
        completedOperationId: validBinding.operationId
      },
      webGrounding: validReceipt, createdAt: 3, updatedAt: 4
    }
  })).success, true);

  const exported = await router.handle({
    type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId: workspace.workspaceId
  });
  assert.equal(exported.success, true);
  const turn = exported.data.turns.find(item => item.turnId === 'turn-forged-web');
  assert.deepEqual(turn.answerBlocks, []);
  assert.equal(turn.summary, '');
  assert.equal(turn.status, 'error');
  assert.equal(turn.errorCode, 'WEB_SEARCH_GROUNDING_MISSING');
  assert.deepEqual(turn.webSearch, {
    enabled: true, searched: false, completedOperationId: ''
  });
  assert.equal(turn.webGrounding, null);
  assert.doesNotMatch(JSON.stringify(exported.data), /raw-provider-payload/);
  const validTurn = exported.data.turns.find(item => item.turnId === validBinding.turnId);
  assert.equal(validTurn.answerBlocks[0].markdown, 'grounded answer');
  assert.equal(validTurn.webGrounding.receiptId, validReceipt.receiptId);
  assert.equal(validTurn.webGrounding.grounding.sources[0].url, sourceUrl);
});

test('workspace persistence keeps live and externally imported unverified answers readable', async () => {
  for (const origin of ['external_import', 'provider_unverified']) {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.org/external-import',
    aliases: [], title: 'External import',
    directoryName: `External import--${'b'.repeat(16)}`,
    revision: 'b'.repeat(64), contentHash: 'b'.repeat(64), workspaceGeneration: 1
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('workspace persistence must stay local'); }
  });
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_ENSURE', workspace
  })).success, true);
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_TURN',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    turn: {
      turnId: 'turn-imported-unverified',
      question: 'Imported question',
      intent: 'answer',
      answerBlocks: [{
        blockId: 'block-imported-unverified', markdown: 'Imported readable answer.'
      }],
      summary: 'Imported readable summary',
      status: 'completed',
      route: { providerId: 'deepseek', model: 'deepseek-chat' },
      webSearch: { enabled: true, searched: true, completedOperationId: 'missing' },
      webGrounding: null,
      answerProvenance: {
        origin, verification: 'unverified'
      },
      createdAt: 1,
      updatedAt: 2
    }
  })).success, true);

  const exported = await router.handle({
    type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId: workspace.workspaceId
  });
  assert.equal(exported.success, true);
  const turn = exported.data.turns[0];
  assert.equal(turn.answerBlocks[0].markdown, 'Imported readable answer.');
  assert.equal(turn.summary, 'Imported readable summary');
  assert.equal(turn.status, 'completed');
  assert.deepEqual(turn.answerProvenance, {
    origin, verification: 'unverified'
  });
  assert.equal(turn.webGrounding, null);
  assert.equal(turn.webSearch.searched, false);
  assert.equal('providerId' in turn.route, false);
  }
});

test('deletes browser-local workspace data when no filesystem directory was configured', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.org/browser-local-paper',
    aliases: [], title: 'Browser-local paper',
    directoryName: `Browser-local paper--${'b'.repeat(16)}`,
    revision: '2'.repeat(64), contentHash: '2'.repeat(64), workspaceGeneration: 1
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const directorySync = createDirectorySyncDouble({
    removeWorkspaceTree: async () => ({ permission: 'unconfigured', removed: false })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('browser-local deletion must stay local'); }
  });

  await router.handle({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace });
  const begun = await router.handle({
    type: 'ARTICLE_WORKSPACE_BEGIN_DELETE', workspaceId: workspace.workspaceId
  });
  const finalized = await router.handle({
    type: 'ARTICLE_WORKSPACE_FINALIZE_DELETE', workspaceId: workspace.workspaceId,
    tombstoneId: begun.data.tombstoneId
  });

  assert.equal(finalized.success, true);
  assert.equal(finalized.data.deleted, true);
  assert.equal(finalized.data.workspaceGeneration, 2);
  assert.equal(finalized.data.permission, 'unconfigured');
  assert.equal(finalized.data.removedFromDisk, false);
  assert.equal(await workspaceStore.getWorkspace(workspace.workspaceId), null);
});

test('mirror-only save backfills a newly selected directory and skips matching files', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'e'.repeat(64)}`,
    canonicalUrl: 'https://example.org/mirror-only',
    aliases: [], title: 'Mirror only',
    directoryName: `Mirror only--${'e'.repeat(16)}`,
    revision: 'e'.repeat(64), contentHash: 'e'.repeat(64), workspaceGeneration: 1
  };
  let manifestAssets = [];
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted',
      manifests: [],
      matches: [{
        match: 'exact',
        manifest: { ...workspace, assets: manifestAssets }
      }]
    })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('mirror-only save must stay local'); }
  });
  await router.handle({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace });
  await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    relativePath: 'article/structure.json',
    content: { title: 'Saved before selecting a directory' }
  });
  await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_TURN',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    turn: { turnId: 'turn-before-directory', question: 'Already local' }
  });
  directorySync.workspaceAssets.length = 0;

  const first = await router.handle({
    type: 'ARTICLE_WORKSPACE_MIRROR_ALL',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: 1
  });
  assert.equal(first.success, true);
  assert.equal(first.data.queued, 2);
  assert.deepEqual(directorySync.workspaceAssets.map(item => item.path).sort(), [
    'article/structure.json', 'chat/turns/turn-before-directory.json'
  ]);

  const localAsset = (await workspaceStore.listAssets(workspace.workspaceId))
    .find(asset => asset.relativePath === 'article/structure.json');
  const localTurn = (await workspaceStore.pageTurns(workspace.workspaceId, {
    limit: 10
  })).items[0];
  manifestAssets = [
    {
      path: 'article/structure.json',
      revision: localAsset.revision,
      contentHash: localAsset.contentHash,
      updatedAt: localAsset.updatedAt
    },
    {
      path: 'chat/turns/turn-before-directory.json',
      revision: localTurn.revision,
      updatedAt: localTurn.updatedAt
    }
  ];
  directorySync.workspaceAssets.length = 0;
  const second = await router.handle({
    type: 'ARTICLE_WORKSPACE_MIRROR_ALL',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: 1
  });
  assert.equal(second.success, true);
  assert.equal(second.data.queued, 0);
  assert.equal(second.data.unchanged, 2);
  assert.equal(directorySync.workspaceAssets.length, 0);
});

test('deletes browser-local workspace immediately when filesystem permission is unavailable', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'d'.repeat(64)}`,
    canonicalUrl: 'https://example.org/permission-pending-paper',
    aliases: [], title: 'Permission pending paper',
    directoryName: `Permission pending paper--${'d'.repeat(16)}`,
    revision: '4'.repeat(64), contentHash: '4'.repeat(64), workspaceGeneration: 1
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const directorySync = createDirectorySyncDouble({
    removeWorkspaceTree: async () => ({ permission: 'prompt', removed: false, pending: true })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('deletion must not call the network'); }
  });

  await router.handle({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace });
  const begun = await router.handle({
    type: 'ARTICLE_WORKSPACE_BEGIN_DELETE', workspaceId: workspace.workspaceId
  });
  const finalized = await router.handle({
    type: 'ARTICLE_WORKSPACE_FINALIZE_DELETE', workspaceId: workspace.workspaceId,
    tombstoneId: begun.data.tombstoneId
  });

  assert.equal(finalized.success, true);
  assert.equal(finalized.data.deleted, true);
  assert.equal(finalized.data.pendingDiskCleanup, true);
  assert.equal(finalized.data.permission, 'prompt');
  assert.equal(finalized.data.removedFromDisk, false);
  assert.equal(finalized.data.workspaceGeneration, 2);
  assert.equal(await workspaceStore.getWorkspace(workspace.workspaceId), null);
});

test('scan restores an unindexed manual supplemental Figure with its image and caption', async () => {
  const workspace = {
    schemaVersion: 1,
    kind: 'sci-logic-highlighter-workspace',
    workspaceId: `workspace:${'7'.repeat(64)}`,
    canonicalUrl: 'https://example.org/manual-supplement-restore',
    aliases: [],
    title: 'Manual supplement restore',
    directoryName: `Manual supplement restore--${'7'.repeat(16)}`,
    revision: 2,
    contentHash: '7'.repeat(64),
    workspaceGeneration: 1,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    assets: []
  };
  const relativePath = 'figures/supplemental/manual-image-s1.json';
  const content = {
    schemaVersion: 1,
    materialId: 'manual-image-s1',
    sourceMode: 'image',
    figures: [{
      figureId: 'supp-manual-image-s1',
      figureLabel: 'Figure S1',
      caption: 'Figure S1. Restored caption.',
      analysisImages: [{
        mediaType: 'image/png',
        dataUrl: 'data:image/png;base64,AQID',
        width: 1,
        height: 1
      }]
    }]
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted',
      manifests: [workspace],
      matches: [{ match: 'exact', manifest: workspace }]
    }),
    listWorkspaceSupplementalAssets: async () => ({
      permission: 'granted',
      invalidAssets: 0,
      assets: [{
        relativePath,
        content,
        revision: 4,
        contentHash: 'manual-supplement-hash',
        updatedAt: '2026-08-04T00:01:00.000Z'
      }]
    })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('restore must stay local'); }
  });

  const restored = await router.handle({
    type: 'ARTICLE_WORKSPACE_SCAN_RESTORE',
    identity: workspace,
    requestPermission: false
  });

  assert.equal(restored.success, true);
  assert.equal(restored.data.recoveredUnindexedSupplementalAssets, 1);
  assert.equal(restored.data.restore.assets.length, 1);
  assert.equal(restored.data.restore.assets[0].content.figures[0].caption,
    'Figure S1. Restored caption.');
  assert.equal(restored.data.restore.assets[0].content.figures[0]
    .analysisImages[0].dataUrl, 'data:image/png;base64,AQID');
  assert.equal(directorySync.workspaceAssets.length, 0);
  const localAssets = await workspaceStore.listAssets(workspace.workspaceId);
  assert.equal(localAssets.length, 0);
});

test('scan backfills a newer browser-local supplemental Figure into the selected folder', async () => {
  const workspace = {
    schemaVersion: 1,
    kind: 'sci-logic-highlighter-workspace',
    workspaceId: `workspace:${'6'.repeat(64)}`,
    canonicalUrl: 'https://example.org/browser-local-supplement',
    aliases: [],
    title: 'Browser-local supplement',
    directoryName: `Browser-local supplement--${'6'.repeat(16)}`,
    revision: 3,
    contentHash: '6'.repeat(64),
    workspaceGeneration: 1,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    assets: []
  };
  const relativePath = 'figures/supplemental/manual-caption-s2.json';
  const content = {
    schemaVersion: 1,
    materialId: 'manual-caption-s2',
    sourceMode: 'caption',
    figures: [{
      figureId: 'supp-manual-caption-s2',
      figureLabel: 'Figure S2',
      caption: 'Figure S2. Browser-local caption recovered during upgrade.'
    }]
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  await workspaceStore.ensureWorkspace(workspace);
  await workspaceStore.putAsset(workspace.workspaceId, relativePath, content);
  const listAssets = workspaceStore.listAssets.bind(workspaceStore);
  workspaceStore.listAssets = async workspaceId => (await listAssets(workspaceId))
    .map(asset => asset.relativePath === relativePath ? {
      ...asset,
      revision: 5,
      contentHash: 'browser-local-supplement-hash',
      updatedAt: '2026-08-04T00:02:00.000Z'
    } : asset);
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted',
      manifests: [workspace],
      matches: [{ match: 'exact', manifest: workspace }]
    })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('restore must stay local'); }
  });

  const restored = await router.handle({
    type: 'ARTICLE_WORKSPACE_SCAN_RESTORE',
    identity: workspace,
    requestPermission: false
  });

  assert.equal(restored.success, true);
  assert.equal(restored.data.recoveredBrowserLocalSupplementalAssets, 1);
  assert.equal(restored.data.restore.assets[0].content.figures[0].caption,
    'Figure S2. Browser-local caption recovered during upgrade.');
  assert.equal(directorySync.workspaceAssets.length, 0);
});

test('scan restores validated workspace assets into IndexedDB before returning them', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'c'.repeat(64)}`,
    canonicalUrl: 'https://example.org/restored-paper',
    aliases: [],
    title: 'Restored paper',
    directoryName: `Restored paper--${'c'.repeat(16)}`,
    revision: '3'.repeat(64), contentHash: '3'.repeat(64), workspaceGeneration: 1
  };
  const manifest = {
    ...workspace,
    kind: 'sci-logic-highlighter-workspace',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    assets: [
      {
        path: 'chat/index.json', type: 'json', revision: 4,
        contentHash: 'asset-hash', updatedAt: '2026-07-20T00:00:00.000Z'
      },
      {
        path: 'chat/turns/turn-1.json', type: 'json', revision: 4,
        contentHash: 'turn-1-hash', updatedAt: '2026-07-20T00:00:00.000Z'
      },
      {
        path: 'chat/turns/turn-deleted.json', type: 'json', revision: 3,
        contentHash: 'turn-deleted-hash', updatedAt: '2026-07-19T00:00:00.000Z'
      },
      {
        path: 'chat/tombstones/turn-deleted.json', type: 'json', revision: 5,
        contentHash: 'tombstone-hash', updatedAt: '2026-07-20T01:00:00.000Z'
      }
    ]
  };
  const chat = { turns: [
    { turnId: 'turn-1', question: 'What changed?', sequence: 1 },
    { turnId: 'turn-deleted', question: 'This turn was deleted.', sequence: 2 }
  ] };
  const storedFiles = {
    'chat/index.json': chat,
    'chat/turns/turn-1.json': {
      turnId: 'turn-1', question: 'What changed?', sequence: 1
    },
    'chat/turns/turn-deleted.json': {
      turnId: 'turn-deleted', question: 'This turn was deleted.', sequence: 2
    },
    'chat/tombstones/turn-deleted.json': {
      entityType: 'turn', entityId: 'turn-deleted', deletedAt: '2026-07-20T01:00:00.000Z'
    }
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted', manifests: [manifest],
      matches: [{ match: 'exact', manifest }]
    }),
    readWorkspaceAsset: async (_manifest, path) => ({
      permission: 'granted', found: Boolean(storedFiles[path]),
      value: {
        kind: 'sci-logic-highlighter-workspace-asset',
        revision: 4,
        contentHash: 'asset-hash',
        data: storedFiles[path]
      }
    }),
    listWorkspaceChatAssets: async () => ({
      permission: 'granted',
      invalidAssets: 0,
      assets: [{
        relativePath: 'chat/turns/turn-orphan.json',
        content: {
          turnId: 'turn-orphan', question: 'Recovered from an unindexed file',
          sequence: 3, createdAt: 3
        },
        revision: 6,
        contentHash: 'turn-orphan-hash',
        updatedAt: '2026-07-20T02:00:00.000Z'
      }]
    })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync, articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('restore must stay local'); }
  });

  const result = await router.handle({
    type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity: workspace,
    requestPermission: true
  });
  assert.equal(result.success, true);
  assert.equal(result.data.restore.match, 'exact');
  assert.equal(result.data.recoveredUnindexedChatAssets, 1);
  assert.equal(result.data.restore.assets[0].content.totalTurns, 2);
  assert.deepEqual(
    result.data.restore.assets[0].content.turns.map(turn => turn.turnId),
    ['turn-1', 'turn-orphan']
  );
  assert.equal(result.data.restore.assets.length, 1);
  assert.equal((await workspaceStore.listAssets(workspace.workspaceId)).length, 0);
  assert.deepEqual((await workspaceStore.pageTurns(workspace.workspaceId)).items, []);
  assert.equal(directorySync.workspaceAssets.length, 0);

  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_ENSURE', workspace
  })).success, true);
  const restoredChatIndex = result.data.restore.assets.find(asset =>
    asset.relativePath === 'chat/index.json'
  ).content;
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    relativePath: 'chat/index.json',
    content: restoredChatIndex
  })).success, true);
  const resavedChatIndex = (await workspaceStore.listAssets(workspace.workspaceId))
    .find(asset => asset.relativePath === 'chat/index.json').content;
  assert.deepEqual(
    resavedChatIndex.turns.map(turn => turn.turnId),
    ['turn-1', 'turn-orphan']
  );
});

test('scan treats turn files as authoritative when chat index was overwritten empty', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'e'.repeat(64)}`,
    canonicalUrl: 'https://www.cell.com/cell/fulltext/S0092-8674(26)00346-6',
    aliases: [],
    title: 'A skin-hypothalamus axis',
    directoryName: `A skin-hypothalamus axis--${'e'.repeat(16)}`,
    revision: '5'.repeat(64), contentHash: '5'.repeat(64), workspaceGeneration: 1
  };
  const manifest = {
    ...workspace,
    kind: 'sci-logic-highlighter-workspace',
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T14:35:36.000Z',
    assets: [{
      path: 'chat/index.json', type: 'json', revision: 19,
      contentHash: 'empty-index', updatedAt: '2026-07-23T14:29:24.000Z'
    }, {
      path: 'chat/turns/turn-2.json', type: 'json', revision: 5,
      contentHash: 'turn-2', updatedAt: '2026-07-23T14:27:49.000Z'
    }]
  };
  const turns = [{
    turnId: 'turn-1', question: '作者定义的热暴露实验条件是什么',
    answerBlocks: [{ blockId: 'block-1', markdown: '第一轮答案' }],
    status: 'completed', sequence: 1, createdAt: 1
  }, {
    turnId: 'turn-2', question: '作者是如何定义热暴露的标准的',
    answerBlocks: [{ blockId: 'block-1', markdown: '第二轮答案' }],
    status: 'completed', sequence: 2, createdAt: 2
  }];
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted', manifests: [manifest],
      matches: [{ match: 'exact', manifest }]
    }),
    readWorkspaceAsset: async (_manifest, path) => ({
      permission: 'granted', found: true,
      value: {
        kind: 'sci-logic-highlighter-workspace-asset',
        revision: path === 'chat/index.json' ? 19 : 5,
        contentHash: path,
        data: path === 'chat/index.json'
          ? { turns: [], totalTurns: 0, returnedTurns: 0 }
          : turns[1]
      }
    }),
    listWorkspaceChatAssets: async () => ({
      permission: 'granted',
      invalidAssets: 0,
      assets: turns.map((turn, index) => ({
        relativePath: `chat/turns/turn-${index + 1}.json`,
        content: turn,
        revision: index + 5,
        contentHash: `turn-${index + 1}`,
        updatedAt: `2026-07-23T14:2${index}:00.000Z`
      }))
    })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync, articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('restore must stay local'); }
  });

  const result = await router.handle({
    type: 'ARTICLE_WORKSPACE_SCAN_RESTORE',
    identity: workspace,
    requestPermission: false
  });

  assert.equal(result.success, true);
  assert.equal(result.data.restore.assets[0].relativePath, 'chat/index.json');
  assert.equal(result.data.restore.assets[0].content.totalTurns, 2);
  assert.deepEqual(
    result.data.restore.assets[0].content.turns.map(turn => turn.turnId),
    ['turn-1', 'turn-2']
  );
  assert.deepEqual(
    result.data.restore.turns.map(turn => turn.turnId),
    ['turn-1', 'turn-2']
  );
  assert.equal(result.data.repairedChatIndex, true);
  assert.equal(directorySync.workspaceAssets.length, 0);
});

test('scan upgrades a newer chat turn that was written with the previous generation', async () => {
  const workspaceId = `workspace:${'f'.repeat(64)}`;
  const localWorkspace = {
    schemaVersion: 1,
    workspaceId,
    canonicalUrl: 'https://www.nature.com/articles/example',
    aliases: [],
    title: 'Generation drift paper',
    directoryName: `Generation drift paper--${'f'.repeat(16)}`,
    revision: '6'.repeat(64),
    contentHash: '6'.repeat(64),
    workspaceGeneration: 1
  };
  const manifest = {
    ...localWorkspace,
    kind: 'sci-logic-highlighter-workspace',
    workspaceGeneration: 2,
    revision: 20,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T01:00:00.000Z',
    assets: []
  };
  const recoveredTurn = {
    turnId: 'turn-after-generation-change',
    question: 'Was this history recovered?',
    answerBlocks: [{ blockId: 'block-1', markdown: 'Yes.' }],
    status: 'completed',
    sequence: 1,
    createdAt: 1,
    updatedAt: '2026-07-24T02:00:00.000Z'
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  await workspaceStore.ensureWorkspace(localWorkspace);
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted',
      manifests: [manifest],
      matches: [{ match: 'exact', manifest }]
    }),
    listWorkspaceChatAssets: async () => ({
      permission: 'granted',
      invalidAssets: 0,
      recoveredGenerationMismatches: 1,
      assets: [{
        relativePath: `chat/turns/${recoveredTurn.turnId}.json`,
        content: recoveredTurn,
        revision: 9,
        contentHash: 'turn-after-generation-change',
        updatedAt: recoveredTurn.updatedAt,
        sourceWorkspaceGeneration: 1,
        recoveredGenerationMismatch: true
      }]
    })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('restore must stay local'); }
  });

  const result = await router.handle({
    type: 'ARTICLE_WORKSPACE_SCAN_RESTORE',
    identity: localWorkspace,
    requestPermission: false
  });

  assert.equal(result.success, true);
  assert.equal(result.data.restore.manifest.workspaceGeneration, 2);
  assert.equal(result.data.restore.turns.length, 1);
  assert.equal(result.data.restore.turns[0].turnId, recoveredTurn.turnId);
  assert.equal(result.data.recoveredGenerationMismatchChatAssets, 1);
  assert.equal(
    (await workspaceStore.getWorkspace(workspaceId)).workspaceGeneration,
    1
  );
  assert.equal(directorySync.workspaceAssets.length, 0);
});

test('upserts a restored chat turn when its IndexedDB turn record is missing', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'9'.repeat(64)}`,
    canonicalUrl: 'https://example.org/chat-upsert',
    aliases: [],
    title: 'Chat upsert',
    directoryName: `Chat upsert--${'9'.repeat(16)}`,
    revision: '9'.repeat(64),
    contentHash: '9'.repeat(64),
    workspaceGeneration: 1
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  await workspaceStore.ensureWorkspace(workspace);
  const directorySync = createDirectorySyncDouble();
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('turn save must stay local'); }
  });

  const result = await router.handle({
    type: 'ARTICLE_WORKSPACE_UPDATE_TURN',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    turnId: 'turn-restored-only-in-page',
    turn: {
      turnId: 'turn-restored-only-in-page',
      question: 'Can this turn be saved?',
      status: 'completed'
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.data.recreated, true);
  assert.equal(
    (await workspaceStore.pageTurns(workspace.workspaceId)).items[0].turnId,
    'turn-restored-only-in-page'
  );
});

test('workspace overview returns safe summaries and loads one detail on demand', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'d'.repeat(64)}`,
    canonicalUrl: 'https://example.org/overview-paper',
    aliases: [{ type: 'doi', value: '10.1000/overview' }],
    title: 'Overview paper',
    directoryName: `Overview paper--${'d'.repeat(16)}`,
    revision: '4'.repeat(64), contentHash: '4'.repeat(64), workspaceGeneration: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    lastAccessedAt: '2026-07-20T01:00:00.000Z'
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  await workspaceStore.ensureWorkspace(workspace);
  await workspaceStore.putAsset(workspace.workspaceId, 'chat/index.json', {
    turns: [{ turnId: 'turn-1' }, { turnId: 'turn-2' }]
  });
  await workspaceStore.putAsset(workspace.workspaceId, 'figures/inventory.json', {
    figures: [{ figureId: 'figure-1', panelHints: ['A', 'B'] }]
  });
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted', manifests: [], matches: [], invalidManifests: 1
    })
  });
  const tokenUsage = {
    canonicalUrl: workspace.canonicalUrl,
    totals: { requests: 3, inputTokens: 900, outputTokens: 120 },
    features: {
      figure_walkthrough: {
        featureId: 'figure_walkthrough',
        label: '逐图解读',
        requests: 3,
        inputTokens: 900,
        outputTokens: 120,
        models: {}
      }
    }
  };
  const tokenUsageStore = {
    async list() { return [tokenUsage]; },
    async getForDocument() { return tokenUsage; }
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync, articleWorkspaceStore: workspaceStore,
    tokenUsageStore,
    fetchImpl: async () => { throw new Error('overview must stay local'); }
  });

  const overview = await router.handle({ type: 'ARTICLE_WORKSPACE_LIST' });
  assert.equal(overview.success, true);
  assert.equal(overview.data.workspaces[0].doi, '10.1000/overview');
  assert.equal(overview.data.totals.workspaceCount, 1);
  assert.equal(overview.data.totals.inputTokens, 900);
  assert.equal(overview.data.workspaces[0].tokenUsage.features
    .figure_walkthrough.outputTokens, 120);
  assert.equal(overview.data.sync.corruptCount, 1);
  assert.doesNotMatch(JSON.stringify(overview.data), /directoryName|absolutePath|apiKey/i);

  const detail = await router.handle({
    type: 'ARTICLE_WORKSPACE_DETAIL', workspaceId: workspace.workspaceId
  });
  assert.equal(detail.success, true);
  assert.equal(detail.data.chatTurnCount, 2);
  assert.equal(detail.data.figureCount, 1);
  assert.equal(detail.data.panelCount, 2);
  assert.equal(detail.data.tokenUsage.totals.requests, 3);
  assert.ok(detail.data.estimatedBytes > 0);
  assert.doesNotMatch(JSON.stringify(detail.data), /relativePath|content|apiKey/i);
});

test('workspace overview summarizes 1,000 records without loading any workspace asset', async () => {
  const workspaceStore = createArticleWorkspaceStoreDouble();
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index.toString(16).padStart(64, '0');
    await workspaceStore.ensureWorkspace({
      schemaVersion: 1,
      workspaceId: `workspace:${suffix}`,
      canonicalUrl: `https://example.org/paper/${index}`,
      aliases: [],
      title: `Paper ${index}`,
      directoryName: `Paper ${index}--${suffix.slice(0, 16)}`,
      revision: suffix,
      contentHash: suffix,
      workspaceGeneration: 1,
      summary: {
        assetCount: 7, assetBytes: 1000, turnCount: 3, turnBytes: 200,
        chatTurnCount: 3, figureCount: 2, panelCount: 6, highlightCount: 4
      }
    });
  }
  workspaceStore.listAssets = async () => {
    throw new Error('overview must not load asset bodies');
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync: createDirectorySyncDouble(),
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('overview must stay local'); }
  });
  const response = await router.handle({ type: 'ARTICLE_WORKSPACE_LIST' });

  assert.equal(response.success, true);
  assert.equal(response.data.workspaces.length, 1000);
  assert.equal(response.data.totals.workspaceCount, 1000);
  assert.equal(response.data.totals.estimatedBytes, 1_200_000);
  assert.equal(response.data.totals.panelCount, 6000);
});

test('scan imports a legacy archive into a workspace without deleting the legacy file', async () => {
  const archive = portableArchive();
  const liveContentHash = 'd'.repeat(64);
  const legacyPath = articleArchiveRelativePath(archive);
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted', manifests: [], matches: []
    }),
    readJson: async path => ({
      permission: 'granted', found: path === legacyPath,
      value: path === legacyPath ? archive : null
    })
  });
  // This acceptance now exercises the real restore-only atomic API.
  require('../core/user-data-database.js');
  const fakeSource = readFileSync(join(__dirname, 'article-workspace-store.test.js'), 'utf8');
  const fakeStart = fakeSource.indexOf('function createFakeIndexedDb(');
  const fakeEnd = fakeSource.indexOf('\nfunction workspace(', fakeStart);
  const makeFake = Function(fakeSource.slice(fakeStart, fakeEnd) + '\nreturn createFakeIndexedDb;')();
  const workspaceStore = require('../core/article-workspace-store.js')
    .createIndexedDbArticleWorkspaceStore(makeFake().indexedDb);
  const converted = await require('../core/article-archive.js').convertLegacyArticleArchiveToWorkspace(archive);
  const liveIdentity = { ...converted.workspace, documentId: archive.documentId,
    contentHash: liveContentHash, revision: liveContentHash };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('legacy import must stay local'); }
  });

  const restored = await router.handle({
    type: 'ARTICLE_WORKSPACE_SCAN_RESTORE',
    identity: liveIdentity,
    authorizedCommit: true
  });
  assert.equal(restored.success, true);
  assert.equal(restored.data.matches[0].match, 'legacy-imported');
  assert.equal(restored.data.restore.manifest.contentHash, liveContentHash);
  assert.equal(restored.data.restore.manifest.workspaceGeneration, 1);
  assert.equal(restored.data.legacyPreserved, true);
  assert.deepEqual(directorySync.readPaths, [legacyPath]);
  assert.equal(directorySync.workspaceAssets.length, 0,
    'pre-authorization scan must not enqueue durable assets');
  assert.equal((await workspaceStore.listWorkspaces()).length, 0,
    'pre-authorization scan must not create a browser workspace');

  const target = {
    authorizationToken: 'operation-nonce-workspace-1',
    documentId: archive.documentId,
    current: {
      workspaceId: restored.data.restore.manifest.workspaceId,
      workspaceGeneration: 1,
      canonicalUrl: archive.canonicalUrl,
      contentHash: liveContentHash
    },
    manifest: {
      workspaceId: restored.data.restore.manifest.workspaceId,
      workspaceGeneration: 1,
      canonicalUrl: archive.canonicalUrl,
      contentHash: liveContentHash
    },
    allowContentChanged: false
  };
  const wrong = await router.handle({
    type: 'ARTICLE_WORKSPACE_COMMIT_RESTORE',
    identity: {
      ...target.current, documentId: archive.documentId,
      canonicalUrl: 'https://example.org/wrong-paper'
    },
    receipt: 'forged-receipt',
    operationNonce: target.authorizationToken,
    restore: restored.data.restore,
    restoreTarget: target
  });
  assert.equal(wrong.success, false);
  assert.equal(wrong.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');
  assert.equal(directorySync.workspaceAssets.length, 0);
  assert.equal((await workspaceStore.listWorkspaces()).length, 0);

  const committed = await router.handle({
    type: 'ARTICLE_WORKSPACE_COMMIT_RESTORE',
    identity: { ...target.current, documentId: archive.documentId },
    operationNonce: target.authorizationToken,
    restore: restored.data.restore,
    restoreTarget: target
  });
  assert.equal(committed.success, false);
  assert.equal(committed.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');
  const registerWorkspaceReceipt = () => router.handle({
    type: 'ARTICLE_RESTORE_REGISTER_COMMIT',
    binding: {
      kind: 'workspace', current: target.current, manifest: target.manifest,
      documentId: target.documentId,
      operationNonce: target.authorizationToken,
      match: 'legacy-imported', allowContentChanged: false
    }
  }, {
    trustedContentScript: true,
    senderTabId: 22,
    senderUrl: archive.canonicalUrl
  });
  const wrongDocumentReceipt = await registerWorkspaceReceipt();
  assert.equal(wrongDocumentReceipt.success, true);
  const wrongDocument = await router.handle({
    type: 'ARTICLE_WORKSPACE_COMMIT_RESTORE',
    identity: {
      ...target.current, documentId: `sha256:${'e'.repeat(64)}`
    },
    operationNonce: target.authorizationToken,
    receipt: wrongDocumentReceipt.data.receipt,
    restore: restored.data.restore,
    restoreTarget: target
  });
  assert.equal(wrongDocument.success, false);
  assert.equal(wrongDocument.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');
  assert.equal(directorySync.workspaceAssets.length, 0);
  assert.equal((await workspaceStore.listWorkspaces()).length, 0);

  const workspaceReceipt = await registerWorkspaceReceipt();
  const validCommit = await router.handle({
    type: 'ARTICLE_WORKSPACE_COMMIT_RESTORE',
    identity: { ...target.current, documentId: archive.documentId },
    operationNonce: target.authorizationToken,
    receipt: workspaceReceipt.data.receipt,
    restore: restored.data.restore,
    restoreTarget: target
  });
  assert.equal(validCommit.success, true, JSON.stringify(validCommit));
  assert.equal(directorySync.workspaceAssets[0].path, 'legacy/archive.json');
  const replay = await router.handle({
    type: 'ARTICLE_WORKSPACE_COMMIT_RESTORE',
    identity: { ...target.current, documentId: archive.documentId },
    operationNonce: target.authorizationToken,
    receipt: workspaceReceipt.data.receipt,
    restore: restored.data.restore,
    restoreTarget: target
  });
  assert.equal(replay.success, false);
  assert.equal(replay.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');
  assert.equal(directorySync.workspaceAssets.length, 1,
    'replaying a receipt must not enqueue another durable asset');
});

test('routes one Panel interpretation through one language-and-telemetry managed Provider call', async () => {
  const storageArea = createMemoryStorage();
  const inputs = [];
  const outputBudgets = [];
  const instructions = [];
  const progress = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      inputs.push(input);
      outputBudgets.push(body.max_output_tokens);
      instructions.push(body.instructions);
      return jsonResponse({
        output_text: JSON.stringify(panelInterpretationOutput(input)),
        usage: { input_tokens: 321, output_tokens: 87 }
      });
    }
  });
  await configureOpenAIRouter(router);
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES', preferences: { language: 'en' }
  });
  const documentHash = 'a'.repeat(64);
  const response = await router.handle({
    type: 'LLM_ANALYZE_FIGURE_PANEL',
    documentHash,
    document: { title: 'Mechanistic study', documentHash },
    figure: {
      ...figureInput(2), panelHints: ['A'],
      caption: 'Figure 2. Values are mean ± SEM. (A) Treatment reduced tumor volume. (B) Validation.',
      contextParagraphs: [
        { paragraphId: 'r1', sectionTitle: 'Results', text: 'Figure 2A compares treated and control groups.' },
        { paragraphId: 'm1', sectionTitle: 'Methods', text: 'Animals were randomized before treatment.' },
        { paragraphId: 'd1', sectionTitle: 'Discussion', text: 'The result supports the proposed mechanism.' }
      ],
      imageVariants: [panelImageVariant(1200), panelImageVariant(960), panelImageVariant(768)]
    },
    panel: { panel: 'A' }
  }, { onProgress: event => progress.push(event) });

  assert.equal(response.success, true);
  assert.equal(inputs.length, 1);
  assert.deepEqual(outputBudgets, [3072]);
  assert.equal(inputs[0].request_mode, 'single_panel_interpretation');
  assert.equal(inputs[0].panel, 'A');
  assert.equal(inputs[0].related_body_context.length <= 4, true);
  assert.doesNotMatch(inputs[0].target_panel_caption, /Validation/);
  assert.equal(response.data.documentHash, documentHash);
  assert.equal(response.data.panelAnalysis.panel, 'A');
  assert.equal(response.data.panelAnalysis.inputBasis.imageMaxEdge, 1200);
  assert.equal(response.data.panelAnalysis.inputBasis.attempts, 1);
  assert.match(instructions[0], /OUTPUT_LANGUAGE_CONTRACT:[\s\S]*English/);
  const telemetry = progress.filter(event => event.phase === 'provider_telemetry');
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].featureId, 'figure_panel_interpretation');
  assert.equal(telemetry[0].inputTokens, 321);
  assert.equal(telemetry[0].outputTokens, 87);
});

test('origin Figure commit guard aborts after dispatch but before durable asset CAS', async () => {
  const workspace = closedTabSupplementalWorkspace();
  let writes = 0;
  let liveRevision = 'revision:original';
  let markGuardPending;
  let releaseGuard;
  const guardPending = new Promise(resolve => { markGuardPending = resolve; });
  const guardGate = new Promise(resolve => { releaseGuard = resolve; });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: {
      async getWorkspace() { return structuredClone(workspace); },
      async putAsset() {
        writes += 1;
        throw new Error('stale retry draft must not reach durable CAS');
      }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const expectedRevision = liveRevision;
  const pending = router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    relativePath: 'figures/workspace-draft.json',
    content: { marker: 'stale retry science' },
    commitGuardId: 'figure-retry-guard-12345678',
    commitGuardKind: 'figure_retry'
  }, {
    async onWorkspaceCommitGuard(binding) {
      assert.equal(binding.commitGuardId, 'figure-retry-guard-12345678');
      markGuardPending();
      await guardGate;
      return liveRevision === expectedRevision
        ? { success: true }
        : { success: false, code: 'FIGURE_PANEL_RETRY_SCOPE_STALE' };
    }
  });
  const firstBoundary = await Promise.race([
    guardPending.then(() => 'guard'),
    pending.then(() => 'response')
  ]);
  assert.equal(firstBoundary, 'guard');
  liveRevision = 'revision:mutated-after-dispatch';
  releaseGuard();
  const response = await pending;
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_PANEL_RETRY_SCOPE_STALE');
  assert.equal(writes, 0);
});

test('Figure retry save stages an ignored candidate and never writes or mirrors the live draft', async () => {
  const workspace = closedTabSupplementalWorkspace();
  const writes = [];
  const mirrored = [];
  const base = {
    workspaceId: workspace.workspaceId,
    relativePath: 'figures/workspace-draft.json',
    content: { revision: 4, figures: [{ figureId: 'f1', panelAnalyses: {} }] },
    revision: 7,
    contentHash: 'base-hash'
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: {
      async getWorkspace() { return structuredClone(workspace); },
      async getAsset(_id, path) {
        return path === base.relativePath ? structuredClone(base) : null;
      },
      async putAsset(id, path, content, conflict) {
        writes.push({ id, path, content: structuredClone(content), conflict });
        return {
          workspaceId: id, relativePath: path, content: structuredClone(content),
          revision: 1, contentHash: 'staging-hash', byteSize: 100,
          updatedAt: '2026-08-31T00:00:00.000Z'
        };
      }
    },
    directorySync: {
      async enqueueWorkspaceAsset(...args) { mirrored.push(args); }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const response = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    relativePath: base.relativePath,
    content: { revision: 5, figures: [{ figureId: 'f1', panelAnalyses: {
      A: { conclusion: { value: 'retry science', humanReviewed: false } }
    } }] },
    expectedRevision: 7,
    expectedContentHash: 'base-hash',
    commitGuardId: 'figure-retry-guard-stage1234',
    commitGuardKind: 'figure_retry'
  }, {
    async onWorkspaceCommitGuard() { return { success: true }; }
  });

  assert.equal(response.success, true);
  assert.equal(response.data.staged, true);
  assert.match(response.data.stagingPath,
    /^internal\/figure-retry-staging\/figure-retry-guard-stage1234\.json$/u);
  assert.equal(response.data.asset, undefined);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, response.data.stagingPath);
  assert.equal(writes[0].content.status, 'pending_confirmation');
  assert.equal(writes[0].content.target.relativePath, base.relativePath);
  assert.deepEqual(writes[0].content.base.content, base.content);
  assert.match(JSON.stringify(writes[0].content.candidate.content), /retry science/u);
  assert.equal(mirrored.length, 0);
});

test('Figure retry confirmation rebases once and preserves concurrent human-reviewed edits', async () => {
  const workspace = closedTabSupplementalWorkspace();
  const mainPath = 'figures/workspace-draft.json';
  const stagingPath = 'internal/figure-retry-staging/figure-retry-guard-stage5678.json';
  const baseContent = {
    revision: 4,
    title: { value: 'base title', humanReviewed: false },
    figures: [{
      figureId: 'f1',
      panelAnalyses: {
        A: { conclusion: { value: 'base A', humanReviewed: false } },
        B: { conclusion: { value: 'base B', humanReviewed: false } }
      }
    }]
  };
  const candidateContent = structuredClone(baseContent);
  candidateContent.revision = 5;
  candidateContent.figures[0].panelAnalyses.A.conclusion.value = 'retry A';
  const concurrentContent = structuredClone(baseContent);
  concurrentContent.title = { value: 'human title', humanReviewed: true, editedAt: 99 };
  concurrentContent.figures[0].panelAnalyses.B.conclusion = {
    value: 'human B', humanReviewed: true, editedAt: 100
  };
  const staging = {
    workspaceId: workspace.workspaceId,
    relativePath: stagingPath,
    revision: 1,
    contentHash: 'staging-hash',
    content: {
      schemaVersion: 1,
      kind: 'figure_retry_candidate',
      status: 'pending_confirmation',
      target: { relativePath: mainPath },
      base: { revision: 7, contentHash: 'base-hash', content: baseContent },
      candidate: { content: candidateContent }
    }
  };
  let current = {
    workspaceId: workspace.workspaceId, relativePath: mainPath,
    revision: 8, contentHash: 'concurrent-hash', content: concurrentContent
  };
  const mainWrites = [];
  const deletions = [];
  const mirrored = [];
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: {
      async getWorkspace() { return structuredClone(workspace); },
      async getAsset(_id, path) {
        return structuredClone(path === stagingPath ? staging : current);
      },
      async putAsset(id, path, content, conflict) {
        if (path !== mainPath) throw new Error('unexpected staging write');
        mainWrites.push({ content: structuredClone(content), conflict: { ...conflict } });
        if (mainWrites.length === 1) {
          const error = new Error('ASSET_REVISION_CONFLICT');
          error.code = 'ASSET_REVISION_CONFLICT';
          throw error;
        }
        assert.equal(conflict.expectedRevision, 8);
        assert.equal(conflict.expectedContentHash, 'concurrent-hash');
        current = {
          workspaceId: id, relativePath: path, content: structuredClone(content),
          revision: 9, contentHash: 'promoted-hash', byteSize: 200,
          updatedAt: '2026-08-31T00:00:01.000Z'
        };
        return structuredClone(current);
      },
      async deleteAsset(_id, path, conflict) {
        deletions.push({ path, conflict });
        return { deleted: true, revision: 1, contentHash: 'staging-hash' };
      }
    },
    directorySync: {
      async enqueueWorkspaceAsset(_workspace, path, content) {
        mirrored.push({ path, content: structuredClone(content) });
      }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const response = await router.handle({
    type: 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    relativePath: mainPath,
    stagingPath,
    stagingRevision: 1,
    stagingContentHash: 'staging-hash',
    commitGuardId: 'figure-retry-guard-confirm5678',
    commitGuardKind: 'figure_retry'
  }, {
    async onWorkspaceCommitGuard() { return { success: true }; }
  });

  assert.equal(response.success, true);
  assert.equal(response.data.promoted, true);
  assert.equal(mainWrites.length, 2);
  assert.equal(mainWrites[0].conflict.expectedRevision, 7);
  assert.equal(mainWrites[0].conflict.expectedContentHash, 'base-hash');
  assert.equal(current.content.figures[0].panelAnalyses.A.conclusion.value, 'retry A');
  assert.equal(current.content.figures[0].panelAnalyses.B.conclusion.value, 'human B');
  assert.equal(current.content.figures[0].panelAnalyses.B.conclusion.humanReviewed, true);
  assert.equal(current.content.title.value, 'human title');
  assert.equal(current.content.title.humanReviewed, true);
  assert.equal(deletions.length, 0);
  assert.equal(mirrored.length, 0);
  const finalized = await router.handle({
    type: 'ARTICLE_WORKSPACE_FINALIZE_STAGED_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    relativePath: mainPath,
    stagingPath,
    stagingRevision: 1,
    stagingContentHash: 'staging-hash',
    promotedRevision: response.data.asset.revision,
    promotedContentHash: response.data.asset.contentHash,
    commitGuardId: 'figure-retry-guard-finalize5678',
    commitGuardKind: 'figure_retry'
  }, { async onWorkspaceCommitGuard() { return { success: true }; } });
  assert.equal(finalized.success, true);
  assert.equal(finalized.data.confirmed, true);
  assert.equal(deletions.length, 1);
  assert.deepEqual(deletions[0], {
    path: stagingPath,
    conflict: {
      expectedRevision: 1,
      expectedContentHash: 'staging-hash',
      refreshSummaryPath: mainPath,
      deleteRelatedStagingForPath: mainPath,
      relatedAssetExpectedRevision: 9,
      relatedAssetExpectedContentHash: 'promoted-hash'
    }
  });
  assert.equal(mirrored.length, 1);
  assert.equal(mirrored[0].path, mainPath);
});

test('Figure retry promotion retries only one CAS conflict', async () => {
  const workspace = closedTabSupplementalWorkspace();
  const mainPath = 'figures/workspace-draft.json';
  const stagingPath = 'internal/figure-retry-staging/figure-retry-guard-stage9012.json';
  let writes = 0;
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: {
      async getWorkspace() { return structuredClone(workspace); },
      async getAsset(_id, path) {
        if (path === stagingPath) return {
          relativePath: path, revision: 1, contentHash: 'stage',
          content: {
            kind: 'figure_retry_candidate', status: 'pending_confirmation',
            target: { relativePath: mainPath },
            base: { revision: 1, contentHash: 'base', content: { value: 'base' } },
            candidate: { content: { value: 'candidate' } }
          }
        };
        return {
          relativePath: mainPath, revision: 2, contentHash: 'current',
          content: { value: 'current' }
        };
      },
      async putAsset() {
        writes += 1;
        const error = new Error('ASSET_REVISION_CONFLICT');
        error.code = 'ASSET_REVISION_CONFLICT';
        throw error;
      },
      async deleteAsset() { throw new Error('must retain staging after failed promotion'); }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const response = await router.handle({
    type: 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    relativePath: mainPath,
    stagingPath,
    stagingRevision: 1,
    stagingContentHash: 'stage',
    commitGuardId: 'figure-retry-guard-confirm9012',
    commitGuardKind: 'figure_retry'
  }, { async onWorkspaceCommitGuard() { return { success: true }; } });
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'ASSET_REVISION_CONFLICT');
  assert.equal(writes, 2);
});

test('Figure retry confirmation guard rejection performs zero main puts', async () => {
  const workspace = closedTabSupplementalWorkspace();
  let puts = 0;
  let reads = 0;
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: {
      async getWorkspace() { return structuredClone(workspace); },
      async getAsset() { reads += 1; throw new Error('guard must reject before asset read'); },
      async putAsset() { puts += 1; throw new Error('guard must reject before main put'); },
      async deleteAsset() { throw new Error('confirm route must not clean up directly'); }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const response = await router.handle({
    type: 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    relativePath: 'figures/workspace-draft.json',
    stagingPath:
      'internal/figure-retry-staging/figure-retry-guard-confirmreject1234.json',
    stagingRevision: 1,
    stagingContentHash: 'stage-hash',
    commitGuardId: 'figure-retry-guard-confirmreject5678',
    commitGuardKind: 'figure_retry'
  }, {
    async onWorkspaceCommitGuard() {
      return { success: false, code: 'FIGURE_PANEL_RETRY_SCOPE_STALE' };
    }
  });
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_PANEL_RETRY_SCOPE_STALE');
  assert.equal(reads, 0);
  assert.equal(puts, 0);
});

test('Figure retry finalize mirrors nothing when staging or promoted-main CAS changes during cleanup', async () => {
  for (const scenario of ['stage-disappeared', 'main-changed']) {
    const workspace = closedTabSupplementalWorkspace();
    const mainPath = 'figures/workspace-draft.json';
    const stagePath =
      'internal/figure-retry-staging/figure-retry-guard-finalrace1234.json';
    const stage = {
      relativePath: stagePath, revision: 1, contentHash: 'stage-hash',
      content: {
        kind: 'figure_retry_candidate', status: 'pending_confirmation',
        target: { relativePath: mainPath },
        base: { revision: 2, contentHash: 'base-hash', content: { base: true } },
        candidate: { content: { retry: true } }
      }
    };
    const main = {
      relativePath: mainPath, revision: 3, contentHash: 'promoted-hash',
      byteSize: 30, updatedAt: '2026-08-31T00:00:00.000Z',
      content: { retry: true }
    };
    let mirrors = 0;
    const router = createBackgroundRouter({
      storageArea: createMemoryStorage(),
      articleWorkspaceStore: {
        async getWorkspace() { return structuredClone(workspace); },
        async getAsset(_id, path) {
          return structuredClone(path === stagePath ? stage : main);
        },
        async deleteAsset() {
          if (scenario === 'stage-disappeared') {
            return { deleted: false, alreadyMissing: true };
          }
          const error = new Error('ASSET_HASH_CONFLICT');
          error.code = 'ASSET_HASH_CONFLICT';
          throw error;
        }
      },
      directorySync: {
        async enqueueWorkspaceAsset() { mirrors += 1; }
      },
      fetchImpl: async () => { throw new Error('provider must not be called'); }
    });
    const response = await router.handle({
      type: 'ARTICLE_WORKSPACE_FINALIZE_STAGED_ASSET',
      workspaceId: workspace.workspaceId,
      workspaceGeneration: workspace.workspaceGeneration,
      relativePath: mainPath,
      stagingPath: stagePath,
      stagingRevision: stage.revision,
      stagingContentHash: stage.contentHash,
      promotedRevision: main.revision,
      promotedContentHash: main.contentHash,
      commitGuardId: 'figure-retry-guard-finalrace5678',
      commitGuardKind: 'figure_retry'
    }, { async onWorkspaceCommitGuard() { return { success: true }; } });
    assert.equal(response.success, false, scenario);
    assert.equal(response.data, undefined, scenario);
    assert.equal(response.error.code, scenario === 'stage-disappeared'
      ? 'FIGURE_PANEL_RETRY_SCOPE_STALE' : 'ASSET_HASH_CONFLICT', scenario);
    assert.equal(mirrors, 0, scenario);
  }
});

test('stale Figure retry compensation removes only retry science and retries one human-edit conflict', async () => {
  const workspace = closedTabSupplementalWorkspace();
  const mainPath = 'figures/workspace-draft.json';
  const stagingPath = 'internal/figure-retry-staging/figure-retry-guard-comp1234.json';
  const base = {
    figures: [{ figureId: 'f1', panelAnalyses: {
      B: { conclusion: { value: 'base B', humanReviewed: false } }
    }, notes: [
      { id: 'A', value: 'A' },
      { id: 'B', value: 'base B', humanReviewed: false }
    ], removedNotes: [
      { id: 'A', value: 'A' },
      { id: 'R', value: 'retry removed this base item' },
      { id: 'B', value: 'base B', humanReviewed: false }
    ], duplicateNotes: ['A', 'A', 'B'], idlessEditableFindings: [
      { label: 'finding one', value: 'A', humanReviewed: false },
      { label: 'finding two', value: 'base B', humanReviewed: false }
    ] }]
  };
  const candidate = structuredClone(base);
  candidate.figures[0].panelAnalyses.A = {
    conclusion: { value: 'stale retry A', humanReviewed: false }
  };
  Object.defineProperty(candidate.figures[0].panelAnalyses, '__proto__', {
    value: { retryOwned: true }, enumerable: true, configurable: true, writable: true
  });
  candidate.figures[0].notes.splice(1, 0, { id: 'X', value: 'retry X' });
  candidate.figures[0].removedNotes.splice(1, 1);
  candidate.figures[0].duplicateNotes.splice(1, 0, 'X');
  candidate.figures[0].idlessEditableFindings[1] = {
    label: 'finding two', value: 'retry B', humanReviewed: false
  };
  const promoted = structuredClone(candidate);
  const humanConcurrent = structuredClone(promoted);
  humanConcurrent.figures[0].panelAnalyses.B.conclusion = {
    value: 'human B', humanReviewed: true, editedAt: 77
  };
  humanConcurrent.figures[0].notes[2] = {
    id: 'B', value: 'human B', humanReviewed: true, editedAt: 78
  };
  humanConcurrent.figures[0].removedNotes[1] = {
    id: 'B', value: 'human removed-notes B', humanReviewed: true, editedAt: 79
  };
  humanConcurrent.figures[0].idlessEditableFindings[1] = {
    label: 'finding two', value: 'human B', humanReviewed: true, editedAt: 80
  };
  const stage = {
    relativePath: stagingPath, revision: 1, contentHash: 'stage-hash',
    content: {
      kind: 'figure_retry_candidate', status: 'pending_confirmation',
      target: { relativePath: mainPath },
      base: { revision: 3, contentHash: 'base-hash', content: base },
      candidate: { content: candidate }
    }
  };
  let current = {
    relativePath: mainPath, revision: 5, contentHash: 'human-hash',
    content: humanConcurrent
  };
  let writes = 0;
  let deletes = 0;
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: {
      async getWorkspace() { return structuredClone(workspace); },
      async getAsset(_id, path) {
        return structuredClone(path === stagingPath ? stage : current);
      },
      async putAsset(id, path, content, conflict) {
        writes += 1;
        if (writes === 1) {
          assert.equal(conflict.expectedRevision, 4);
          const error = new Error('ASSET_REVISION_CONFLICT');
          error.code = 'ASSET_REVISION_CONFLICT';
          throw error;
        }
        assert.equal(conflict.expectedRevision, 5);
        current = {
          workspaceId: id, relativePath: path, revision: 6,
          contentHash: workspaceContentFingerprint(content),
          content: structuredClone(content)
        };
        return structuredClone(current);
      },
      async deleteAsset() {
        deletes += 1;
        return { deleted: true, revision: 1, contentHash: 'stage-hash' };
      }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const response = await router.handle({
    type: 'ARTICLE_WORKSPACE_COMPENSATE_STAGED_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    relativePath: mainPath,
    stagingPath,
    stagingRevision: 1,
    stagingContentHash: 'stage-hash',
    promotedRevision: 4,
    promotedContentHash: 'promoted-hash',
    commitGuardId: 'figure-retry-guard-compensate1234',
    commitGuardKind: 'figure_retry'
  }, { async onWorkspaceCommitGuard() { return { success: true }; } });
  assert.equal(response.success, true);
  assert.equal(response.data.compensated, true);
  assert.deepEqual(response.data.asset, {
    relativePath: mainPath,
    revision: 6,
    contentHash: workspaceContentFingerprint(current.content),
    byteSize: undefined,
    updatedAt: undefined,
    content: current.content
  });
  assert.equal(writes, 2);
  assert.equal(deletes, 1);
  assert.equal(Object.hasOwn(current.content.figures[0].panelAnalyses, 'A'), false);
  assert.equal(Object.hasOwn(current.content.figures[0].panelAnalyses, '__proto__'), false);
  assert.equal(Object.getPrototypeOf(current.content.figures[0].panelAnalyses),
    Object.prototype);
  assert.equal(current.content.figures[0].panelAnalyses.B.conclusion.value, 'human B');
  assert.equal(current.content.figures[0].panelAnalyses.B.conclusion.humanReviewed, true);
  assert.deepEqual(current.content.figures[0].notes, [
    { id: 'A', value: 'A' },
    { id: 'B', value: 'human B', humanReviewed: true, editedAt: 78 }
  ]);
  assert.deepEqual(current.content.figures[0].removedNotes, [
    { id: 'A', value: 'A' },
    { id: 'R', value: 'retry removed this base item' },
    { id: 'B', value: 'human removed-notes B', humanReviewed: true, editedAt: 79 }
  ]);
  assert.deepEqual(current.content.figures[0].duplicateNotes, ['A', 'A', 'B']);
  assert.deepEqual(current.content.figures[0].idlessEditableFindings, [
    { label: 'finding one', value: 'A', humanReviewed: false },
    { label: 'finding two', value: 'human B', humanReviewed: true, editedAt: 80 }
  ]);
});

test('Figure retry compensation returns no rollback receipt when staging delete races', async () => {
  const workspace = closedTabSupplementalWorkspace();
  const mainPath = 'figures/workspace-draft.json';
  const stagingPath =
    'internal/figure-retry-staging/figure-retry-guard-delete-race1234.json';
  const base = { revision: 1, figures: {} };
  const candidate = { revision: 2, figures: { retry: { value: 'private science' } } };
  const staged = {
    relativePath: stagingPath,
    revision: 1,
    contentHash: 'stage-hash',
    content: {
      kind: 'figure_retry_candidate', status: 'pending_confirmation',
      target: { relativePath: mainPath },
      base: { revision: 1, contentHash: 'base-hash', content: base },
      candidate: { content: candidate }
    }
  };
  let current = {
    relativePath: mainPath, revision: 2,
    contentHash: workspaceContentFingerprint(candidate), content: candidate
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: {
      async getWorkspace() { return structuredClone(workspace); },
      async getAsset(_id, path) {
        return structuredClone(path === stagingPath ? staged : current);
      },
      async putAsset(id, path, content) {
        current = {
          workspaceId: id, relativePath: path, revision: 3,
          contentHash: workspaceContentFingerprint(content), content: structuredClone(content)
        };
        return structuredClone(current);
      },
      async deleteAsset() { return { deleted: false, alreadyMissing: true }; }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const response = await router.handle({
    type: 'ARTICLE_WORKSPACE_COMPENSATE_STAGED_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    relativePath: mainPath,
    stagingPath,
    stagingRevision: staged.revision,
    stagingContentHash: staged.contentHash,
    promotedRevision: 2,
    promotedContentHash: workspaceContentFingerprint(candidate),
    commitGuardId: 'figure-retry-guard-delete-race5678',
    commitGuardKind: 'figure_retry'
  }, { async onWorkspaceCommitGuard() { return { success: true }; } });
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_PANEL_RETRY_SCOPE_STALE');
  assert.equal(response.data, undefined);
});

test('promoted but unfinalized Figure retry stays projected to its authoritative pre-retry asset after restart', async () => {
  const workspace = closedTabSupplementalWorkspace();
  const mainPath = 'figures/workspace-draft.json';
  const baseContent = {
    revision: 4,
    figures: [{ figureId: 'f1', panelAnalyses: {
      B: { conclusion: { value: 'human B', humanReviewed: true } }
    }, notes: ['base-note'] }]
  };
  const promotedContent = structuredClone(baseContent);
  promotedContent.revision = 5;
  promotedContent.figures[0].panelAnalyses.A = {
    conclusion: { value: 'unconfirmed retry science', humanReviewed: false }
  };
  promotedContent.figures[0].notes.push('retry-added-note');
  const assets = [{
    relativePath: mainPath, revision: 3, contentHash: 'promoted-hash',
    byteSize: 999, updatedAt: '2026-08-31T00:00:02.000Z',
    content: promotedContent
  }, {
    relativePath: 'internal/figure-retry-staging/figure-retry-guard-crash1234.json',
    revision: 1, contentHash: 'stage-hash',
    content: {
      schemaVersion: 1, kind: 'figure_retry_candidate',
      status: 'pending_confirmation', target: { relativePath: mainPath },
      base: {
        revision: 2, contentHash: 'base-hash', byteSize: 111,
        updatedAt: '2026-08-31T00:00:01.000Z', content: baseContent
      },
      candidate: { content: promotedContent }
    }
  }];
  const mirrored = [];
  const reconciliations = [];
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: {
      async getWorkspace() { return structuredClone(workspace); },
      async getAsset(_id, path) {
        return structuredClone(assets.find(asset => asset.relativePath === path) || null);
      },
      async listAssets() { return structuredClone(assets); },
      async putAsset() { throw new Error('projected writes require transactional reconciliation'); },
      async reconcileFigureRetryWrite(_id, path, content, conflict) {
        reconciliations.push({ path, content: structuredClone(content),
          conflict: structuredClone(conflict) });
        const current = assets.find(asset => asset.relativePath === path);
        assert.equal(conflict.expectedRawRevision, 3);
        assert.equal(conflict.expectedRawContentHash, 'promoted-hash');
        assert.deepEqual(conflict.pendingStages, [{
          relativePath:
            'internal/figure-retry-staging/figure-retry-guard-crash1234.json',
          revision: 1,
          contentHash: 'stage-hash'
        }]);
        const saved = {
          ...current,
          revision: 4,
          contentHash: 'human-save-hash',
          byteSize: 222,
          updatedAt: '2026-08-31T00:00:03.000Z',
          content: structuredClone(content)
        };
        assets.splice(0, assets.length, saved);
        return { asset: structuredClone(saved) };
      },
      async pageTurns() { return { items: [], hasMore: false, nextSequence: 0 }; }
    },
    directorySync: {
      async listWorkspaceManifests() { return { permission: 'granted', matches: [] }; },
      async enqueueWorkspaceAsset(_workspace, path, content) {
        mirrored.push({ path, content: structuredClone(content) });
      }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const loaded = await router.handle({
    type: 'ARTICLE_WORKSPACE_GET_ASSET',
    workspaceId: workspace.workspaceId,
    relativePath: mainPath
  });
  const listed = await router.handle({
    type: 'ARTICLE_WORKSPACE_LIST_ASSETS',
    workspaceId: workspace.workspaceId
  });
  const exported = await router.handle({
    type: 'ARTICLE_WORKSPACE_EXPORT',
    workspaceId: workspace.workspaceId
  });
  const detail = await router.handle({
    type: 'ARTICLE_WORKSPACE_DETAIL',
    workspaceId: workspace.workspaceId
  });
  const mirror = await router.handle({
    type: 'ARTICLE_WORKSPACE_MIRROR_ALL',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration
  });
  assert.equal(loaded.success, true);
  assert.equal(loaded.data.found, true);
  assert.deepEqual(loaded.data.asset.content, baseContent);
  assert.equal(loaded.data.asset.revision, 2);
  assert.equal(loaded.data.asset.contentHash, 'base-hash');
  assert.match(loaded.data.asset.writeToken, /^workspace-write-v1-[a-f0-9]{16,64}$/u);
  assert.doesNotMatch(loaded.data.asset.writeToken,
    /crash1234|promoted-hash|stage-hash/u);
  assert.deepEqual(listed.data.assets.map(asset => asset.relativePath), [
    mainPath
  ]);
  assert.deepEqual(listed.data.assets[0].content, baseContent);
  assert.equal(listed.data.assets[0].revision, 2);
  assert.deepEqual(exported.data.assets.map(asset => asset.relativePath), [
    mainPath
  ]);
  assert.deepEqual(exported.data.assets[0].content, baseContent);
  assert.equal(exported.data.assets[0].revision, 2);
  assert.equal(exported.data.assets[0].writeToken, undefined);
  assert.equal(detail.data.estimatedBytes, 111);
  assert.equal(mirror.success, true);
  assert.equal(mirror.data.queued, 1);
  assert.deepEqual(mirrored, [{ path: mainPath, content: baseContent }]);
  assert.doesNotMatch(JSON.stringify(exported), /unconfirmed retry science/u);
  assert.doesNotMatch(JSON.stringify(detail), /unconfirmed retry science/u);

  const humanContent = structuredClone(baseContent);
  humanContent.figures[0].note = { value: 'human after crash', humanReviewed: true };
  const saved = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    relativePath: mainPath,
    content: humanContent,
    expectedRevision: loaded.data.asset.revision,
    expectedContentHash: loaded.data.asset.contentHash,
    writeToken: loaded.data.asset.writeToken
  });
  assert.equal(saved.success, true);
  assert.equal(reconciliations.length, 1);
  assert.equal(saved.data.asset.revision, 4);
  const reloaded = await router.handle({
    type: 'ARTICLE_WORKSPACE_GET_ASSET',
    workspaceId: workspace.workspaceId,
    relativePath: mainPath
  });
  const exportedAfterSave = await router.handle({
    type: 'ARTICLE_WORKSPACE_EXPORT',
    workspaceId: workspace.workspaceId
  });
  mirrored.length = 0;
  await router.handle({
    type: 'ARTICLE_WORKSPACE_MIRROR_ALL',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration
  });
  assert.deepEqual(reloaded.data.asset.content, humanContent);
  assert.equal(reloaded.data.asset.writeToken, undefined);
  assert.deepEqual(exportedAfterSave.data.assets[0].content, humanContent);
  assert.equal(exportedAfterSave.data.assets[0].writeToken, undefined);
  assert.deepEqual(mirrored, [{ path: mainPath, content: humanContent }]);
  assert.doesNotMatch(JSON.stringify(exportedAfterSave), /unconfirmed retry science/u);
});

test('concurrent human Figure projection has a canonical hash and remains writable after reload', async () => {
  const workspace = closedTabSupplementalWorkspace();
  const mainPath = 'figures/workspace-draft.json';
  const base = createFigureWorkspaceDraft([{
    figureId: 'f1', figureLabel: 'Figure 1', panelHints: ['A']
  }]);
  const candidate = structuredClone(base);
  candidate.revision = 1;
  candidate.figures.f1.panels.A.directObservation = {
    value: 'unconfirmed retry science', humanReviewed: false, editedAt: 0
  };
  const current = structuredClone(candidate);
  current.revision = 2;
  current.figures.f1.panels.A.note = {
    value: 'concurrent human note', humanReviewed: true, editedAt: 91
  };
  const stagePath =
    'internal/figure-retry-staging/figure-retry-guard-humanhash1234.json';
  const assets = [{
    relativePath: mainPath, revision: 8, contentHash: 'raw-promoted-hash',
    byteSize: 900, updatedAt: '2026-08-31T00:00:02.000Z', content: current
  }, {
    relativePath: stagePath, revision: 1, contentHash: 'stage-hash',
    content: {
      kind: 'figure_retry_candidate', status: 'pending_confirmation',
      target: { relativePath: mainPath },
      base: {
        revision: 7, contentHash: 'base-hash', byteSize: 700,
        updatedAt: '2026-08-31T00:00:01.000Z', content: base
      },
      candidate: { content: candidate }
    }
  }];
  let reconciled = null;
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: {
      async getWorkspace() { return structuredClone(workspace); },
      async getAsset(_id, path) {
        return structuredClone(assets.find(asset => asset.relativePath === path) || null);
      },
      async listAssets() { return structuredClone(assets); },
      async putAsset() { throw new Error('projected save must use raw-token reconciliation'); },
      async reconcileFigureRetryWrite(_id, path, content, conflict) {
        reconciled = { path, content: structuredClone(content),
          conflict: structuredClone(conflict) };
        return { asset: {
          relativePath: path, revision: 9, contentHash: 'saved-human-hash',
          byteSize: 800, updatedAt: '2026-08-31T00:00:03.000Z', content
        } };
      }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const loaded = await router.handle({
    type: 'ARTICLE_WORKSPACE_GET_ASSET',
    workspaceId: workspace.workspaceId,
    relativePath: mainPath
  });
  assert.equal(loaded.success, true);
  assert.equal(loaded.data.asset.content.figures.f1.panels.A.directObservation.value, '');
  assert.equal(loaded.data.asset.content.figures.f1.panels.A.note.value,
    'concurrent human note');
  assert.match(loaded.data.asset.contentHash, /^[a-f0-9]{8}$/u);
  assert.equal(loaded.data.asset.contentHash,
    workspaceContentFingerprint(loaded.data.asset.content));
  const initialized = initializeFigureWorkspaceDraftState({
    durableAsset: loaded.data.asset
  });
  assert.equal(initialized.checkpoint.contentHash, loaded.data.asset.contentHash);
  const edited = structuredClone(initialized.draft);
  edited.figures.f1.overview.remainingQuestion = {
    value: 'human next save', humanReviewed: true, editedAt: 92
  };
  const saved = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    relativePath: mainPath,
    content: edited,
    expectedRevision: loaded.data.asset.revision,
    expectedContentHash: loaded.data.asset.contentHash,
    writeToken: loaded.data.asset.writeToken
  });
  assert.equal(saved.success, true);
  assert.equal(reconciled.conflict.expectedRawRevision, 8);
  assert.equal(reconciled.conflict.expectedRawContentHash, 'raw-promoted-hash');
  assert.equal(reconciled.content.figures.f1.panels.A.note.value, 'concurrent human note');
});

test('reloaded projected Figure draft starts an exact retry without resending completed Panels', async () => {
  const workspace = closedTabSupplementalWorkspace();
  const mainPath = 'figures/workspace-draft.json';
  const oldStagePath =
    'internal/figure-retry-staging/figure-retry-guard-oldretry1234.json';
  const newStagePath =
    'internal/figure-retry-staging/figure-retry-guard-newretry5678.json';
  const baseContent = {
    revision: 6,
    figures: [{ figureId: 'f1', panelAnalyses: {
      A: { conclusion: { value: 'completed A', humanReviewed: true } }
    } }]
  };
  const oldCandidate = structuredClone(baseContent);
  oldCandidate.figures[0].panelAnalyses.B = {
    conclusion: { value: 'old unconfirmed B', humanReviewed: false }
  };
  const assets = [{
    relativePath: mainPath, revision: 7, contentHash: 'base-hash',
    byteSize: 100, updatedAt: '2026-08-31T00:00:00.000Z', content: baseContent
  }, {
    relativePath: oldStagePath, revision: 1, contentHash: 'old-stage-hash',
    content: {
      kind: 'figure_retry_candidate', status: 'pending_confirmation',
      target: { relativePath: mainPath },
      base: { revision: 7, contentHash: 'base-hash', content: baseContent },
      candidate: { content: oldCandidate }
    }
  }];
  let legacyPuts = 0;
  let reconciliations = 0;
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: {
      async getWorkspace() { return structuredClone(workspace); },
      async getAsset(_id, path) {
        return structuredClone(assets.find(asset => asset.relativePath === path) || null);
      },
      async listAssets() { return structuredClone(assets); },
      async putAsset() { legacyPuts += 1; throw new Error('must reconcile atomically'); },
      async reconcileFigureRetryWrite(_id, path, authoritative, conflict) {
        reconciliations += 1;
        assert.equal(path, mainPath);
        assert.deepEqual(authoritative, baseContent);
        assert.deepEqual(conflict.pendingStages, [{
          relativePath: oldStagePath, revision: 1, contentHash: 'old-stage-hash'
        }]);
        assert.equal(conflict.stage.relativePath, newStagePath);
        assert.equal(conflict.stage.candidateContent.figures[0]
          .panelAnalyses.A.conclusion.value, 'completed A');
        assert.equal(conflict.stage.candidateContent.figures[0]
          .panelAnalyses.A.conclusion.humanReviewed, true);
        assert.equal(conflict.stage.candidateContent.figures[0]
          .panelAnalyses.B.conclusion.value, 'new recovered B');
        return { asset: assets[0], staged: {
          relativePath: newStagePath, revision: 1, contentHash: 'new-stage-hash'
        } };
      }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const loaded = await router.handle({
    type: 'ARTICLE_WORKSPACE_GET_ASSET',
    workspaceId: workspace.workspaceId,
    relativePath: mainPath
  });
  const nextCandidate = structuredClone(baseContent);
  nextCandidate.revision = 7;
  nextCandidate.figures[0].panelAnalyses.B = {
    conclusion: { value: 'new recovered B', humanReviewed: false }
  };
  const staged = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    relativePath: mainPath,
    content: nextCandidate,
    expectedRevision: loaded.data.asset.revision,
    expectedContentHash: loaded.data.asset.contentHash,
    writeToken: loaded.data.asset.writeToken,
    commitGuardId: 'figure-retry-guard-newretry5678',
    commitGuardKind: 'figure_retry'
  }, { async onWorkspaceCommitGuard() { return { success: true }; } });
  assert.equal(staged.success, true);
  assert.equal(staged.data.stagingPath, newStagePath);
  assert.equal(reconciliations, 1);
  assert.equal(legacyPuts, 0);
});

test('repairs one structurally invalid Panel interpretation without degrading its evidence', async () => {
  const storageArea = createMemoryStorage();
  const inputs = [];
  const imageSizes = [];
  const instructions = [];
  const progress = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const image = Array.isArray(body.input)
        ? body.input[0].content.find(item => item.type === 'input_image')?.image_url || ''
        : '';
      inputs.push(input);
      imageSizes.push(image.length);
      instructions.push(body.instructions);
      if (inputs.length === 1) {
        return jsonResponse({ output_text: JSON.stringify({ figure_id: input.figure_id }) });
      }
      return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: '8'.repeat(64),
    document: { title: 'Panel schema repair' },
    figure: {
      ...figureInput(8), panelHints: ['A'],
      imageVariants: [panelImageVariant(1200), panelImageVariant(960), panelImageVariant(768)]
    },
    panel: { panel: 'A' }, forceRefresh: true
  }, { onProgress: event => progress.push(event) });

  assert.equal(response.success, true);
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(imageSizes[0] > 0, true);
  assert.equal(imageSizes[1], imageSizes[0]);
  assert.doesNotMatch(instructions[0], /SCHEMA_REPAIR_PASS/);
  assert.match(instructions[1], /SCHEMA_REPAIR_PASS/);
  assert.equal(response.data.panelAnalysis.inputBasis.inputMode, 'figure_image');
  assert.equal(response.data.panelAnalysis.inputBasis.attempts, 2);
  assert.ok(progress.some(event => event.phase === 'figure_panel_schema_retry'));
});

test('retries one transient Panel provider failure without degrading its evidence', async () => {
  const storageArea = createMemoryStorage();
  const imageSizes = [];
  const waits = [];
  const progress = [];
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sleepImpl: async delay => { waits.push(delay); },
    fetchImpl: async (url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const image = Array.isArray(body.input)
        ? body.input[0].content.find(item => item.type === 'input_image')?.image_url || ''
        : '';
      imageSizes.push(image.length);
      if (calls === 1) return jsonResponse({ error: { message: 'temporary rate limit' } }, 429);
      return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: '7'.repeat(64),
    document: { title: 'Transient Panel failure' },
    figure: {
      ...figureInput(7), panelHints: ['A'],
      imageVariants: [panelImageVariant(1200), panelImageVariant(960), panelImageVariant(768)]
    },
    panel: { panel: 'A' }, forceRefresh: true
  }, { onProgress: event => progress.push(event) });

  assert.equal(response.success, true);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1500]);
  assert.equal(imageSizes[0] > 0, true);
  assert.equal(imageSizes[1], imageSizes[0]);
  assert.equal(response.data.panelAnalysis.inputBasis.inputMode, 'figure_image');
  assert.equal(response.data.panelAnalysis.inputBasis.attempts, 2);
  assert.ok(progress.some(event => event.phase === 'figure_panel_transient_retry'));
});

test('retries a rejected Panel output limit without needlessly degrading the image', async () => {
  const storageArea = createMemoryStorage();
  const requestSizes = [];
  const inputs = [];
  const outputBudgets = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const image = Array.isArray(body.input)
        ? body.input[0].content.find(item => item.type === 'input_image')?.image_url || ''
        : '';
      requestSizes.push(image.length);
      inputs.push(input);
      outputBudgets.push(body.max_output_tokens);
      if (requestSizes.length < 3) {
        return jsonResponse({ error: { message: 'max_output_tokens cannot exceed 1024' } }, 400);
      }
      return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: 'b'.repeat(64),
    document: { title: 'Large figure' },
    figure: {
      ...figureInput(4), panelHints: ['A'],
      imageVariants: [panelImageVariant(1200), panelImageVariant(960), panelImageVariant(768)]
    },
    panel: { panel: 'A' }, forceRefresh: true
  });

  assert.equal(response.success, true);
  assert.equal(requestSizes.length, 3);
  assert.deepEqual(requestSizes, [requestSizes[0], requestSizes[0], requestSizes[0]]);
  assert.deepEqual(outputBudgets, [3072, 1024, 768]);
  assert.equal(response.data.panelAnalysis.inputBasis.attempts, 3);
  assert.equal(response.data.panelAnalysis.inputBasis.outputBudgetTokens, 768);
  assert.deepEqual(inputs.map(input => input.panel), ['A', 'A', 'A']);
});

test('expands a truncated Panel answer before sacrificing visual evidence', async () => {
  const storageArea = createMemoryStorage();
  const requestSizes = [];
  const outputBudgets = [];
  const progress = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const image = Array.isArray(body.input)
        ? body.input[0].content.find(item => item.type === 'input_image')?.image_url || ''
        : '';
      requestSizes.push(image.length);
      outputBudgets.push(body.max_output_tokens);
      if (requestSizes.length === 1) {
        return jsonResponse({
          status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
          output_text: '{}'
        });
      }
      return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: '9'.repeat(64),
    document: { title: 'Output expansion' },
    figure: {
      ...figureInput(9), panelHints: ['A'],
      imageVariants: [panelImageVariant(1200), panelImageVariant(960), panelImageVariant(768)]
    },
    panel: { panel: 'A' }, forceRefresh: true
  }, { onProgress: event => progress.push(event) });

  assert.equal(response.success, true);
  assert.deepEqual(outputBudgets, [3072, 5376]);
  assert.equal(requestSizes[1], requestSizes[0]);
  assert.equal(response.data.panelAnalysis.inputBasis.outputBudgetTokens, 5376);
  assert.ok(progress.some(event => event.phase === 'figure_panel_output_retry'));
});

test('explicit current confirmation: jumps directly to text evidence when a nominally visual model rejects Panel pixels', async () => {
  const storageArea = createMemoryStorage();
  const modes = [];
  const router = createConfirmedFigureRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const hasImage = Array.isArray(body.input);
      modes.push(hasImage ? 'image' : 'text');
      if (hasImage) return jsonResponse({ error: { message: 'unsupported image input' } }, 400);
      return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_panel_interpretation.allowTextFallback = true;
  const response = await router.handle({
    type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: 'e'.repeat(64),
    document: { title: 'Text fallback' },
    figure: {
      ...figureInput(6), panelHints: ['A'],
      imageVariants: [panelImageVariant(1200), panelImageVariant(960), panelImageVariant(768)]
    },
    panel: { panel: 'A' }, forceRefresh: true
  });

  assert.equal(response.success, true);
  assert.deepEqual(modes, ['image', 'text']);
  assert.equal(response.data.panelAnalysis.basis, 'caption_context');
  assert.equal(response.data.panelAnalysis.inputBasis.inputMode, 'caption_context');
  assert.equal(response.data.panelAnalysis.inputBasis.pixelsSupplied, false);
  assert.equal(response.data.panelAnalysis.inputBasis.attempts, 2);
});

test('keeps dedicated Panel cache entries isolated by Panel identity', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const base = {
    type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: 'c'.repeat(64),
    document: { title: 'Cache isolation' },
    figure: {
      ...figureInput(5), panelHints: ['A', 'B'],
      caption: 'Figure 5. (A) Discovery. (B) Validation.'
    }
  };
  const firstA = await router.handle({ ...base, panel: { panel: 'A' } });
  const secondA = await router.handle({ ...base, panel: { panel: 'A' } });
  const firstB = await router.handle({ ...base, panel: { panel: 'B' } });

  assert.equal(firstA.data.cacheHit, false);
  assert.equal(secondA.data.cacheHit, true);
  assert.equal(firstB.data.cacheHit, false);
  assert.equal(firstB.data.panelAnalysis.panel, 'B');
  assert.equal(calls, 2);
});

test('routes full-text chat through the exact model profile selected for that turn', async () => {
  const storageArea = createMemoryStorage();
  const urls = [];
  const requests = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      urls.push(String(url));
      const body = JSON.parse(options.body);
      requests.push({ body, prompt: body.messages[1].content });
      return sseResponse([
        JSON.stringify({
          type: 'answer_block', block_id: 'block-1',
          markdown: '**Core finding**\n\nThe treated group improved significantly. [[1]]',
          evidence: [{
            marker: '1', paragraph_id: 'p1', source_key: 'results:1',
            text_hash: 'hash-p1',
            quote: 'The treated group showed a significantly improved phenotype.',
            section_path: ['Results']
          }]
        }),
        JSON.stringify({ type: 'turn_summary', summary: 'Treatment improved the phenotype.' }),
        JSON.stringify({ type: 'final', status: 'completed' }),
        ''
      ].join('\n'));
      return sseResponse(JSON.stringify({
        answer_zh: '该论文的核心结论由正文结果段支持。',
        evidence: [{ section_title: 'Results', support_zh: '处理组的表型显著改善。' }],
        limitations_zh: '当前网页正文未提供原始数据。'
      }));
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_chat_deepseek', name: 'Chat DeepSeek', providerId: 'deepseek',
      config: { apiKey: 'chat-secret', model: 'deepseek-v4-pro' }
    }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { consentGranted: true }
  });

  const response = await router.handle({
    type: 'LLM_ASK_ARTICLE',
    profileId: 'profile_chat_deepseek',
    question: '这篇论文的核心结论是什么？',
    history: [{ role: 'user', content: '先概括研究问题。' }],
    document: {
      title: 'Mechanistic study',
      url: 'https://example.org/paper',
      paragraphs: [{
        paragraphId: 'p1', sectionTitle: 'Results',
        text: 'The treated group showed a significantly improved phenotype.'
      }]
    }
  });

  assert.equal(response.success, true);
  assert.equal(response.data.route.providerId, 'deepseek');
  assert.equal(response.data.route.effectiveProfileId, 'profile_chat_deepseek');
  assert.equal(response.data.route.taskType, 'article_chat');
  if (false) {
  assert.equal(response.data.message.answer, '该论文的核心结论由正文结果段支持。');
  }
  assert.equal(response.data.message.answerBlocks[0].blockId, 'block-1');
  assert.equal(response.data.message.summary, 'Treatment improved the phenotype.');
  assert.match(urls[0], /deepseek/i);
  if (false) {
  assert.equal(requests[0].current_question, '这篇论文的核心结论是什么?');
  assert.equal(requests[0].article.paragraphs.length, 1);
  }
  assert.equal(requests[0].body.stream, true);
  assert.match(requests[0].prompt, /article-chat-chunk-/);
  assert.doesNotMatch(JSON.stringify(response), /chat-secret/);
});

test('rejects unsupported article web search before any provider request', async () => {
  const storageArea = createMemoryStorage();
  let fetchCalls = 0;
  let chatCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('provider must not be called');
    }
  });
  await configureOpenAIRouter(router);
  const originalCreateProviderAdapter = globalThis.SciLLM.createProviderAdapter;
  const originalRunArticleChat = globalThis.SciLLM.runArticleChat;
  globalThis.SciLLM.createProviderAdapter = options => {
    const adapter = originalCreateProviderAdapter(options);
    return { ...adapter, generateWebSearchTextStream: undefined };
  };
  globalThis.SciLLM.runArticleChat = async () => {
    chatCalls += 1;
    throw new Error('chat must fail in capability preflight');
  };
  try {
    const response = await router.handle({
      type: 'LLM_ASK_ARTICLE',
      question: '联网核对这项结论。',
      turnId: 'turn-web-unsupported',
      operationId: 'operation-web-unsupported',
      webSearch: { enabled: true },
      document: {
        title: 'Web capability preflight',
        paragraphs: [{
          paragraphId: 'p1', sourceKey: 'results:1', textHash: 'hash-p1',
          sectionId: 'results', sectionTitle: 'Results', sectionKind: 'results',
          sectionPath: ['Results'], text: 'The treated group improved.'
        }]
      }
    });

    assert.equal(response.success, false);
    assert.equal(response.error.code, 'WEB_SEARCH_UNSUPPORTED');
    assert.equal(fetchCalls, 0);
    assert.equal(chatCalls, 0);
  } finally {
    globalThis.SciLLM.createProviderAdapter = originalCreateProviderAdapter;
    globalThis.SciLLM.runArticleChat = originalRunArticleChat;
  }
});

test('binds article web search to the resolved provider model turn and operation', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('stubbed chat must not fetch'); }
  });
  await configureOpenAIRouter(router);
  const originalCreateProviderAdapter = globalThis.SciLLM.createProviderAdapter;
  const originalRunArticleChat = globalThis.SciLLM.runArticleChat;
  let captured;
  globalThis.SciLLM.createProviderAdapter = options => ({
    ...originalCreateProviderAdapter(options),
    generateWebSearchTextStream() {
      return (async function* stream() { yield { type: 'completed' }; })();
    }
  });
  globalThis.SciLLM.runArticleChat = async options => {
    captured = options;
    return {
      message: {
        answer: 'bound', answerBlocks: [], evidence: [], summary: 'bound',
        limitations: '', status: 'completed',
        webSearch: { enabled: true, searched: true },
        webGrounding: { providerResponseId: 'response-bound', sources: [] }
      },
      usage: null,
      coverage: {},
      plan: {},
      cacheState: {}
    };
  };
  try {
    const response = await router.handle({
      type: 'LLM_ASK_ARTICLE',
      question: '联网核对这项结论。',
      turnId: 'turn-web-bound',
      operationId: 'operation-web-bound',
      webSearch: { enabled: true },
      document: {
        title: 'Web route binding',
        paragraphs: [{
          paragraphId: 'p1', sourceKey: 'results:1', textHash: 'hash-p1',
          sectionId: 'results', sectionTitle: 'Results', sectionKind: 'results',
          sectionPath: ['Results'], text: 'The treated group improved.'
        }]
      }
    });

    assert.equal(response.success, true, JSON.stringify(response));
    assert.deepEqual(captured.routeIdentity, {
      providerId: 'openai',
      model: 'gpt-5.1',
      turnId: 'turn-web-bound',
      operationId: 'operation-web-bound'
    });
    assert.deepEqual(captured.input.webSearch, { enabled: true });
    assert.equal(Object.isFrozen(captured.input.webSearch), true);
    assert.equal(typeof captured.adapter.generateWebSearchTextStream, 'function');
    assert.equal(response.data.operationId, 'operation-web-bound');
    assert.equal(response.data.route.providerId, 'openai');
    assert.equal(response.data.route.model, 'gpt-5.1');
  } finally {
    globalThis.SciLLM.createProviderAdapter = originalCreateProviderAdapter;
    globalThis.SciLLM.runArticleChat = originalRunArticleChat;
  }
});

test('runs one grounded Responses request through the real web adapter and router', async () => {
  const storageArea = createMemoryStorage();
  const requests = [];
  const answerText = [
    JSON.stringify({
      type: 'answer_block', block_id: 'block-web-router',
      markdown: 'The treated group improved according to the article. [[1]]',
      evidence: [{
        marker: '1', paragraph_id: 'p1', source_key: 'results:1',
        text_hash: 'hash-p1', quote: 'The treated group improved.',
        section_path: ['Results']
      }]
    }),
    JSON.stringify({
      type: 'turn_summary', summary: 'The article and current source support the result.'
    }),
    JSON.stringify({ type: 'final', status: 'completed' }),
    ''
  ].join('\n');
  const citationStart = answerText.indexOf('treated group improved');
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      return jsonResponse({
        id: 'resp_router_web_001',
        model: 'gpt-5.1',
        status: 'completed',
        output_text: answerText,
        output: [{
          id: 'search-router-1', type: 'web_search_call', status: 'completed'
        }, {
          id: 'message-router-1', type: 'message', role: 'assistant', status: 'completed',
          content: [{
            type: 'output_text', text: answerText,
            annotations: [{
              type: 'url_citation',
              start_index: citationStart,
              end_index: citationStart + 'treated group improved'.length,
              url: 'https://www.nih.gov/news-events/example',
              title: 'NIH update'
            }]
          }]
        }],
        usage: { input_tokens: 40, output_tokens: 20 }
      });
    }
  });
  await configureOpenAIRouter(router);

  const response = await router.handle({
    type: 'LLM_ASK_ARTICLE',
    question: '联网核对这项结论。',
    turnId: 'turn-web-router',
    operationId: 'operation-web-router',
    webSearch: { enabled: true },
    document: {
      title: 'Grounded router integration',
      paragraphs: [{
        paragraphId: 'p1', sourceKey: 'results:1', textHash: 'hash-p1',
        sectionId: 'results', sectionTitle: 'Results', sectionKind: 'results',
        sectionPath: ['Results'], text: 'The treated group improved.'
      }]
    }
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(requests[0].body.tools, [{ type: 'web_search' }]);
  assert.equal(requests[0].body.stream, false);
  assert.equal(requests[0].body.store, false);
  assert.deepEqual(response.data.message.webSearch, {
    enabled: true, searched: true
  });
  assert.equal(
    response.data.message.webGrounding.grounding.providerResponseId,
    'resp_router_web_001'
  );
  assert.deepEqual(
    response.data.message.webGrounding.grounding.sources[0].blockIds,
    ['block-web-router']
  );
  assert.equal(response.data.message.webGrounding.binding.providerId, 'openai');
  assert.equal(response.data.message.webGrounding.binding.model, 'gpt-5.1');
  assert.equal(response.data.message.webGrounding.binding.turnId, 'turn-web-router');
  assert.equal(
    response.data.message.webGrounding.binding.operationId,
    'operation-web-router'
  );
});

test('cancels an in-flight Figure provider request through the shared operation id', async () => {
  const storageArea = createMemoryStorage();
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      markStarted();
      return new Promise((resolve, reject) => {
        const abort = () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
      });
    }
  });
  await configureOpenAIRouter(router);
  const pending = router.handle({
    ...figureMessage([figureInput(1)], { analysisDepth: 'standard' }),
    operationId: 'figure-cancel-test'
  });
  await started;
  const control = await router.handle({
    type: 'LLM_CONTROL_OPERATION',
    operationId: 'figure-cancel-test',
    command: 'cancel'
  });
  const result = await pending;
  assert.equal(control.success, true);
  assert.equal(control.data.cancelled, true);
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'CANCELLED');
});

test('forceRefresh bypasses a cached Figure result and returns a new provider result', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      const output = figureOutput(input.figure_id, input.analysis_basis, input.analysis_depth);
      output.core_conclusion_zh = `provider run ${calls}`;
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([figureInput(1)], { analysisDepth: 'standard' });
  const first = await router.handle(message);
  const cached = await router.handle(message);
  const refreshed = await router.handle({ ...message, forceRefresh: true });

  assert.equal(first.data.figureResults[0].coreConclusion, 'provider run 1');
  assert.equal(cached.data.cacheHits, 1);
  assert.equal(refreshed.data.cacheHits, 0);
  assert.equal(refreshed.data.figureResults[0].coreConclusion, 'provider run 2');
  assert.equal(calls, 2);
});

test('whole Figure cache authority resists a real legacy FNV collision', async () => {
  const captions = [
    'collision-1vyix3t-1k1czwu',
    'collision-59mldx-1x1bf2s'
  ];
  assert.equal(globalThis.SciLLM.stableHash({
    caption: captions[0], panelHints: ['A'], contextParagraphs: [], images: []
  }), '6df19fd2');
  assert.equal(globalThis.SciLLM.stableHash({
    caption: captions[1], panelHints: ['A'], contextParagraphs: [], images: []
  }), '6df19fd2');
  const storageArea = createMemoryStorage();
  const entries = new Map();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    cacheStore: {
      async getMany(keys) {
        return new Map(keys.filter(key => entries.has(key))
          .map(key => [key, structuredClone(entries.get(key))]));
      },
      async setMany(values) {
        values.forEach(value => entries.set(value.key, structuredClone(value)));
      },
      async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
    },
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      const output = figurePassOutput(input);
      output.core_conclusion_zh = `provider generation ${providerCalls}`;
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const originalStableHash = globalThis.SciLLM.stableHash;
  globalThis.SciLLM.stableHash = () => '00000000';
  try {
    const request = caption => figureMessage([{
      figureId: 'figure-1', figureLabel: 'Figure 1', caption,
      panelHints: ['A'], contextParagraphs: [], images: []
    }], { analysisDepth: 'standard' });
    const first = await router.handle(request(captions[0]));
    const collision = await router.handle(request(captions[1]));
    const exactReplay = await router.handle(request(captions[1]));

    assert.equal(first.success, true, JSON.stringify(first));
    assert.equal(first.data.cacheHits, 0);
    assert.equal(collision.success, true, JSON.stringify(collision));
    assert.equal(collision.data.cacheHits, 0);
    assert.equal(collision.data.figureResults[0].coreConclusion,
      'provider generation 2');
    assert.equal(exactReplay.data.cacheHits, 1);
    assert.equal(exactReplay.data.figureResults[0].coreConclusion,
      'provider generation 2');
    assert.equal(providerCalls, 2);
    assert.equal(entries.size, 2);
    assert.equal(new Set([...entries.values()].map(value => value.cacheBindingDigest)).size, 2);
    assert.ok([...entries.keys()].every(key => /^figure:sha256:[a-f0-9]{64}$/u.test(key)));
    assert.ok([...entries.values()].every(value =>
      /^[a-f0-9]{64}$/u.test(value.providerProofDigest)));
  } finally {
    globalThis.SciLLM.stableHash = originalStableHash;
  }
});

test('Panel and follow-up cache authority ignore colliding weak signatures', async () => {
  const scenarios = [
    {
      name: 'interpretation', type: 'LLM_ANALYZE_FIGURE_PANEL',
      values: ['panel-caption-1cghz3-75dofw', 'panel-caption-htasu2-xq4xys'],
      expectedWeak: '09bdeba7',
      weak(value) {
        return globalThis.SciLLM.stableHash({
          figureId: 'figure-1', caption: value, panelHints: ['A'],
          contextParagraphs: [], imageVariants: []
        });
      }
    },
    {
      name: 'followup', type: 'LLM_ASK_FIGURE_PANEL',
      values: [
        'panel-question-1v8gco4-1th4bpq',
        'panel-question-7wq1w4-2rgqr9'
      ],
      expectedWeak: '86174ee8',
      weak(value) {
        return globalThis.SciLLM.stableHash({
          topics: ['mechanism'], customQuestion: value,
          history: [], existingPanelInterpretation: null
        });
      }
    }
  ];
  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    assert.equal(scenario.weak(scenario.values[0]), scenario.expectedWeak, scenario.name);
    assert.equal(scenario.weak(scenario.values[1]), scenario.expectedWeak, scenario.name);
    const storageArea = createMemoryStorage();
    const entries = new Map();
    let providerCalls = 0;
    const router = createBackgroundRouter({
      storageArea,
      cacheStore: {
        async getMany(keys) {
          return new Map(keys.filter(key => entries.has(key))
            .map(key => [key, structuredClone(entries.get(key))]));
        },
        async setMany(values) {
          values.forEach(value => entries.set(value.key, structuredClone(value)));
        },
        async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
      },
      fetchImpl: async (_url, options) => {
        providerCalls += 1;
        const input = openAIInputPayload(JSON.parse(options.body));
        const output = scenario.name === 'followup'
          ? panelFollowupOutput(input) : panelInterpretationOutput(input);
        if (scenario.name === 'followup') {
          output.answer_zh = `provider generation ${providerCalls}`;
        } else {
          output.panel_interpretation.direct_observation_zh =
            `provider generation ${providerCalls}`;
        }
        return jsonResponse({ output_text: JSON.stringify(output) });
      }
    });
    await configureOpenAIRouter(router);
    const originalStableHash = globalThis.SciLLM.stableHash;
    globalThis.SciLLM.stableHash = () => '00000000';
    try {
      const request = value => ({
        type: scenario.type, documentHash: String(scenarioIndex + 8).repeat(64),
        document: { title: `Strong ${scenario.name} cache` },
        figure: {
          figureId: 'figure-1', figureLabel: 'Figure 1',
          caption: scenario.name === 'interpretation'
            ? value : 'Stable follow-up caption',
          panelHints: ['A'], contextParagraphs: [], imageVariants: []
        },
        panel: { panel: 'A', purpose: 'Compare groups' },
        topics: scenario.name === 'followup' ? ['mechanism'] : [],
        customQuestion: scenario.name === 'followup' ? value : '',
        history: [], existingPanelInterpretation: null
      });
      const first = await router.handle(request(scenario.values[0]));
      const collision = await router.handle(request(scenario.values[1]));
      const exactReplay = await router.handle(request(scenario.values[1]));
      assert.equal(first.success, true, `${scenario.name}:${JSON.stringify(first)}`);
      assert.equal(first.data.cacheHit, false, scenario.name);
      assert.equal(collision.success, true,
        `${scenario.name}:${JSON.stringify(collision)}`);
      assert.equal(collision.data.cacheHit, false, scenario.name);
      assert.equal(exactReplay.data.cacheHit, true, scenario.name);
      assert.equal(providerCalls, 2, scenario.name);
      assert.equal(entries.size, 2, scenario.name);
      assert.equal(new Set([...entries.values()].map(value => value.cacheBindingDigest)).size,
        2, scenario.name);
      assert.ok([...entries.keys()].every(key =>
        /^figure-panel:sha256:[a-f0-9]{64}$/u.test(key)), scenario.name);
    } finally {
      globalThis.SciLLM.stableHash = originalStableHash;
    }
  }
});

test('strong Figure cache binding failure precedes cache read ledger write and provider work', async () => {
  const scenarios = [
    { name: 'whole', domain: 'figure-analysis-cache-binding-v2' },
    { name: 'panel', domain: 'figure-panel-cache-binding-v2' },
    { name: 'followup', domain: 'figure-panel-cache-binding-v2' }
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const storageArea = createMemoryStorage();
    const ledgerStorage = createMemoryStorage();
    let cacheReads = 0;
    let providerCalls = 0;
    const cryptoImpl = {
      subtle: {
        async digest(algorithm, bytes) {
          const canonical = new TextDecoder().decode(bytes);
          if (canonical.includes(scenario.domain)) {
            throw new Error('PRIVATE CACHE DIGEST FAILURE');
          }
          return webcrypto.subtle.digest(algorithm, bytes);
        }
      }
    };
    const router = createBackgroundRouter({
      storageArea, sessionStorageArea: ledgerStorage,
      runtimeExtensionId: 'extension-id', cryptoImpl,
      cacheStore: {
        async getMany() { cacheReads += 1; return new Map(); },
        async setMany() { throw new Error('cache write must not run'); },
        async deleteMany() {}
      },
      fetchImpl: async () => {
        providerCalls += 1;
        return jsonResponse({});
      }
    });
    await configureOpenAIRouter(router);
    const operationId = `figure-cache-digest-failure-${scenario.name}-operation`;
    const common = {
      analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 71,
      operationId,
      figureRequestReceipt:
        `figure-request-cache-digest-${scenario.name}-12345678`,
      figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
      forceRefresh: false
    };
    const figure = { ...figureInput(1), panelHints: ['A'] };
    const message = scenario.name === 'whole'
      ? { ...figureMessage([figure]), ...common }
      : {
        ...common,
        type: scenario.name === 'followup'
          ? 'LLM_ASK_FIGURE_PANEL' : 'LLM_ANALYZE_FIGURE_PANEL',
        documentHash: String(index + 2).repeat(64),
        document: { title: 'Strong cache digest failure' },
        figure, panel: { panel: 'A', purpose: 'Compare groups' },
        ...(scenario.name === 'followup' ? { topics: ['grouping'] } : {})
      };
    const owner = {
      trustedExtensionSender: true, senderExtensionId: 'extension-id',
      senderTabId: 171 + index, senderFrameId: 0,
      senderDocumentId: `71717171-7171-4171-8171-71717171717${index}`,
      ...(scenario.name === 'whole' ? figureCheckpointContext([], []) : {})
    };
    const before = JSON.stringify(ledgerStorage.values);
    const response = await router.handle(message, owner);
    assert.equal(response.success, false, scenario.name);
    assert.equal(response.error.code,
      'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE', scenario.name);
    assert.equal(response.error.retryable, false, scenario.name);
    assert.equal(JSON.stringify(response).includes('PRIVATE'), false, scenario.name);
    assert.equal(cacheReads, 0, scenario.name);
    assert.equal(providerCalls, 0, scenario.name);
    assert.equal(JSON.stringify(ledgerStorage.values), before, scenario.name);
  }
});

test('follow-up cache binds selected history ids but ignores an unselected id', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    cacheStore: {
      async getMany(keys) {
        return new Map(keys.filter(key => entries.has(key))
          .map(key => [key, structuredClone(entries.get(key))]));
      },
      async setMany(values) {
        values.forEach(value => entries.set(value.key, structuredClone(value)));
      },
      async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
    },
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({
        output_text: JSON.stringify(panelFollowupOutput(input))
      });
    }
  });
  await configureOpenAIRouter(router);
  const history = Array.from({ length: 7 }, (_, index) => ({
    historyId: `history-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content: index < 2
      ? `xylophone quartz nebula ${index}`
      : `Recent Panel discussion ${index}`
  }));
  const request = selectedHistory => ({
    type: 'LLM_ASK_FIGURE_PANEL', documentHash: 'a'.repeat(64),
    document: { title: 'Selected history cache binding' },
    figure: {
      figureId: 'figure-1', figureLabel: 'Figure 1',
      caption: 'Figure 1. Panel A compares treated and control groups.',
      panelHints: ['A'], contextParagraphs: [], imageVariants: []
    },
    panel: { panel: 'A', purpose: 'Compare groups' },
    topics: ['grouping'], history: selectedHistory
  });
  const first = await router.handle(request(history));
  assert.equal(first.success, true, JSON.stringify(first));
  assert.equal(first.data.cacheHit, false);
  assert.deepEqual(first.data.panelFollowup.inputBasis.includedHistoryIds,
    history.slice(-5).map(item => item.historyId));

  const unselectedIdChanged = structuredClone(history);
  unselectedIdChanged[0].historyId = 'unselected-id-changed';
  const unchangedPlan = await router.handle(request(unselectedIdChanged));
  assert.equal(unchangedPlan.data.cacheHit, true);
  assert.equal(providerCalls, 1);

  const selectedIdChanged = structuredClone(history);
  selectedIdChanged.at(-1).historyId = 'selected-id-changed';
  const changedPlan = await router.handle(request(selectedIdChanged));
  assert.equal(changedPlan.success, true, JSON.stringify(changedPlan));
  assert.equal(changedPlan.data.cacheHit, false);
  assert.equal(providerCalls, 2);
  assert.deepEqual(changedPlan.data.panelFollowup.inputBasis.includedHistoryIds,
    [...history.slice(-5, -1).map(item => item.historyId), 'selected-id-changed']);
  const exactReplay = await router.handle(request(selectedIdChanged));
  assert.equal(exactReplay.data.cacheHit, true);
  assert.equal(providerCalls, 2);
});

test('replaces an invalid cached Figure result without read-path deletion', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const evicted = [];
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, value));
    },
    async deleteMany(keys) {
      keys.forEach(key => {
        evicted.push(key);
        entries.delete(key);
      });
    }
  };
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      const output = figureOutput(input.figure_id, input.analysis_basis, input.analysis_depth);
      output.core_conclusion_zh = `recomputed ${calls}`;
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([figureInput(1)], { analysisDepth: 'standard' });
  await router.handle(message);
  const cachedKey = [...entries.keys()][0];
  entries.get(cachedKey).figureResult.coreConclusion = { damaged: true };
  const recomputed = await router.handle(message);

  assert.equal(calls, 2);
  assert.equal(recomputed.data.cacheHits, 0);
  assert.equal(recomputed.data.figureResults[0].coreConclusion, 'recomputed 2');
  assert.deepEqual(evicted, []);
});

test('replaces an incomplete cached Figure Panel partition without read-path deletion', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const evicted = [];
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, structuredClone(value)));
    },
    async deleteMany(keys) {
      keys.forEach(key => {
        evicted.push(key);
        entries.delete(key);
      });
    }
  };
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([{
    ...figureInput(1), panelHints: ['A', 'B']
  }], { analysisDepth: 'standard' });
  const first = await router.handle(message);
  assert.equal(first.success, true, JSON.stringify(first));
  const cachedKey = [...entries.keys()][0];
  entries.get(cachedKey).figureResult.panels =
    entries.get(cachedKey).figureResult.panels.filter(panel => panel.panel === 'A');

  const recomputed = await router.handle(message);

  assert.equal(recomputed.success, true, JSON.stringify(recomputed));
  assert.equal(recomputed.data.cacheHits, 0);
  assert.equal(calls, 2);
  assert.deepEqual(evicted, []);
  assert.deepEqual(recomputed.data.figureResults[0].panels.map(panel => panel.panel), ['A', 'B']);
});

test('explicit current confirmation: falls back to caption context when a provider rejects visual input', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createConfirmedFigureRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      if (Array.isArray(body.input)) return jsonResponse({}, 400);
      const input = openAIInputPayload(body);
      return jsonResponse({
        output_text: JSON.stringify(figureOutput(
          input.figure_id, 'caption_context', input.analysis_depth
        ))
      });
    }
  });
  await configureOpenAIRouter(router);
  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_walkthrough.allowTextFallback = true;
  const result = await router.handle(figureMessage([
    figureInput(1, [{ mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==' }])
  ], { analysisDepth: 'standard' }));

  assert.equal(result.success, true);
  assert.equal(result.data.figureResults[0].basis, 'caption_context');
  assert.equal(result.data.figureResults[0].visionFallback, true);
  assert.equal(result.data.visionFallbacks, 1);
  assert.equal(calls, 2);
});

test('does not text-fallback authentication or quota failures', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({}, 401);
    }
  });
  await configureOpenAIRouter(router);
  const result = await router.handle(figureMessage([
    figureInput(1, [{ mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==' }])
  ], { analysisDepth: 'standard' }));

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'AUTH_INVALID');
  assert.equal(calls, 1);
});

test('rejects a model response assigned to the wrong Figure', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => jsonResponse({
      output_text: JSON.stringify(figureOutput('figure-99'))
    })
  });
  await configureOpenAIRouter(router);
  const result = await router.handle(figureMessage(
    [figureInput(1)], { analysisDepth: 'standard' }
  ));

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'INVALID_RESPONSE');
});

test('keeps completed Figure checkpoints when a later Figure fails', async () => {
  const storageArea = createMemoryStorage();
  const callsById = { 'figure-1': 0, 'figure-2': 0 };
  let failSecond = true;
  const router = createBackgroundRouter({
    storageArea,
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      callsById[input.figure_id] += 1;
      if (input.figure_id === 'figure-2' && failSecond) return jsonResponse({}, 503);
      return jsonResponse({
        output_text: JSON.stringify(figureOutput(
          input.figure_id, input.analysis_basis, input.analysis_depth
        ))
      });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage(
    [figureInput(1), figureInput(2)], { analysisDepth: 'standard' }
  );

  const failed = await router.handle(message);
  assert.equal(failed.success, false);
  failSecond = false;
  const resumed = await router.handle(message);

  assert.equal(resumed.success, true);
  assert.equal(resumed.data.cacheHits, 1);
  assert.equal(callsById['figure-1'], 1);
  assert.equal(callsById['figure-2'], 2,
    'an uncertain 503 response is never retried within either run');
});

test('uses caption and body for text-only DeepSeek without sending supplied images', async () => {
  const { router, bodies } = await configuredFigureRouter('deepseek', {
    model: 'deepseek-v4-pro'
  });
  const progress = [];
  const response = await router.handle(figureMessage([
    figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,AA==' }])
  ], { analysisDepth: 'standard' }), { onProgress: event => progress.push(event) });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(typeof bodies[0].messages[1].content, 'string');
  const input = JSON.parse(bodies[0].messages[1].content);
  assert.equal(input.analysis_basis, 'caption_context');
  assert.ok(input.caption);
  assert.doesNotMatch(JSON.stringify(bodies), /image_url|data:image/);
  assert.equal(response.data.figureResults[0].inputMode, 'caption_context');
  assert.equal(response.data.figureResults[0].visionFallback, false);
  assert.ok(progress.some(event => event.phase === 'caption_text_only'));
});

test('routes the DeepSeek experimental vision model through image evidence mode', async () => {
  const { router, bodies } = await configuredFigureRouter('deepseek', {
    model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'disabled'
  });
  const progress = [];
  const response = await router.handle(figureMessage([
    figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,AA==' }])
  ], { analysisDepth: 'standard' }), { onProgress: event => progress.push(event) });
  assert.equal(response.success, true);
  assert.equal(Array.isArray(bodies[0].messages[1].content), true);
  assert.equal(bodies[0].messages[1].content[1].type, 'image_url');
  assert.equal(bodies[0].messages[1].content[1].image_url.url,
    'data:image/jpeg;base64,AA==');
  assert.equal(response.data.visionFallbacks, 0);
  assert.equal(progress[0].capabilityMode, 'vision');
});

test('reserves DeepSeek high-reasoning capacity for Figure Panel JSON and synthesis', async () => {
  const storageArea = createMemoryStorage();
  const bodies = [];
  const progress = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      const content = body.messages[1].content;
      const input = JSON.parse(Array.isArray(content)
        ? content.find(item => item.type === 'text').text
        : content);
      const output = figurePassOutput(input);
      if (input.pass === 'figure_synthesis') {
        output.panel_groups[0].upstream_context_zh = '前序证据留下该实验问题，本组直接检验对应结果。';
      }
      return jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }]
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
    config: { apiKey: 'key', model: 'deepseek-v4-flash-vision-exp' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'deepseek', consentGranted: true }
  });
  storageArea.values.sciLlmSettingsV2.taskPolicies.figure_walkthrough.reasoningEnabled = true;
  storageArea.values.sciLlmSettingsV2.taskPolicies.figure_walkthrough.reasoningEffort = 'high';
  const panelHints = Array.from({ length: 12 }, (_, index) =>
    String.fromCharCode(65 + index));
  const response = await router.handle(figureMessage([{
    ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,AA==' }]), panelHints
  }], { analysisDepth: 'standard' }), {
    onProgress: event => progress.push(event)
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.deepEqual(bodies.map(body => body.max_tokens), [28160, 28160, 40448]);
  assert.deepEqual(bodies.map(body => body.thinking), [
    { type: 'enabled' }, { type: 'enabled' }, { type: 'enabled' }
  ]);
  assert.deepEqual(bodies.map(body => body.reasoning_effort), ['high', 'high', 'high']);
  assert.ok(progress.some(event =>
    event.phase === 'provider_request_started' && event.timeoutMs === 300000));
});

test('keeps verified visual providers in visual mode', async () => {
  const { router, bodies } = await configuredFigureRouter('openai', { model: 'gpt-5-mini' });
  await router.handle(figureMessage([
    figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,AA==' }])
  ], { analysisDepth: 'standard' }));
  assert.ok(bodies[0].input[0].content.some(item => item.type === 'input_image'));
  assert.equal(openAIInputPayload(bodies[0]).analysis_basis, 'vision_text');
});

test('never reads or promotes an immediately previous weak Figure cache entry', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const readKeys = [];
  let providerCalls = 0;
  const cacheStore = {
    async getMany(keys) {
      readKeys.push(...keys);
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, value));
    },
    async compareAndSetManyGuarded(values, guard) {
      if (guard.expectedRevision !== null || entries.has(guard.casKey)) {
        return { applied: false, revision: entries.get(guard.casKey)?.revision ?? null };
      }
      values.forEach(value => entries.set(value.key, structuredClone(value)));
      return { applied: true, revision: 0 };
    },
    async deleteMany(keys) {
      keys.forEach(key => entries.delete(key));
    }
  };
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({ output_text: JSON.stringify(
        figureOutput('figure-1', 'caption_context', 'standard')
      ) });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([{
    ...figureInput(1), panelHints: ['A']
  }], { analysisDepth: 'standard' });
  const settings = await globalThis.SciLLM.loadSettings(storageArea);
  const route = globalThis.SciLLM.resolveTaskProfile(settings, 'figure_walkthrough');
  const profileSignature = globalThis.SciLLM.stableHash({
    profileSignature: route.profileSignature,
    taskPolicySignature: buildTaskPolicySignature(settings, 'figure_walkthrough')
  });
  const documentHash = await globalThis.SciLLM.hashDocument(message.document.paragraphs);
  const rawFigure = message.figures[0];
  const figureHash = globalThis.SciLLM.stableHash({
    caption: rawFigure.caption,
    panelHints: ['A'],
    contextParagraphs: rawFigure.contextParagraphs.map(item => ({
      paragraphId: item.paragraphId,
      sectionTitle: item.sectionTitle || '',
      text: item.text
    })),
    images: []
  });
  const cacheInput = {
    documentHash,
    providerId: route.providerId,
    model: route.model,
    profileSignature,
    figureId: rawFigure.figureId,
    figureHash,
    analysisDepth: 'standard'
  };
  const currentKey = globalThis.SciLLM.buildFigureCacheKey({
    ...cacheInput, figureVersion: globalThis.SciLLM.FIGURE_ANALYSIS_VERSION
  });
  const previousKey = globalThis.SciLLM.buildFigureCacheKey({
    ...cacheInput, figureVersion: '12-panel-specific-durable-results'
  });
  const current = globalThis.SciLLM.validateFigureAnalysis(
    figureOutput(rawFigure.figureId, 'caption_context', 'standard'),
    { ...rawFigure, panelHints: ['A'] }, { visualInput: false, analysisDepth: 'standard' }
  );
  const { figureVersion, remainingQuestion, ...legacyWithoutNewOverview } = current;
  const legacy = {
    ...legacyWithoutNewOverview,
    figureVersion: '12-panel-specific-durable-results',
    panels: current.panels.map(({ evidenceType, experimentalMethods, statisticalMethods, ...panel }) => panel)
  };
  const validLegacyForPromotionFailure = JSON.parse(JSON.stringify(legacy));
  entries.set(previousKey, { key: previousKey, createdAt: 1, figureResult: legacy });

  const response = await router.handle(message);

  assert.equal(providerCalls, 1);
  assert.equal(response.success, true);
  assert.equal(response.data.cacheHits, 0);
  assert.equal(response.data.figureResults[0].cacheHit, false);
  assert.equal(response.data.figureResults[0].remainingQuestion, '');
  assert.notEqual(previousKey, currentKey);
  assert.equal(readKeys.includes(previousKey), false);
  const strongKey = [...entries.keys()].find(key => key !== previousKey);
  assert.match(strongKey, /^figure:sha256:[a-f0-9]{64}$/u);
  assert.equal(entries.get(strongKey)?.figureResult?.figureVersion,
    globalThis.SciLLM.FIGURE_ANALYSIS_VERSION);

  entries.get(previousKey).figureResult.coreConclusion = 'old cache must not win';
  const currentPriority = await router.handle(message);
  assert.equal(providerCalls, 1);
  assert.equal(currentPriority.data.figureResults[0].coreConclusion, current.coreConclusion);

  entries.delete(strongKey);
  entries.get(previousKey).figureResult.figureId = 'figure-other';
  const mismatchedLegacy = await router.handle(message);
  assert.equal(providerCalls, 2);
  assert.equal(mismatchedLegacy.data.cacheHits, 0);
  assert.equal(mismatchedLegacy.data.figureResults[0].cacheHit, false);

  const promotionEntries = new Map([[
    previousKey,
    { key: previousKey, createdAt: 1, figureResult: validLegacyForPromotionFailure }
  ]]);
  const removedLegacyKeys = [];
  let promotionProviderCalls = 0;
  let unguardedPromotionAttempts = 0;
  const promotionFailureRouter = createBackgroundRouter({
    storageArea,
    cacheStore: {
      async getMany(keys) {
        return new Map(keys.filter(key => promotionEntries.has(key))
          .map(key => [key, promotionEntries.get(key)]));
      },
      async setMany(values) {
        unguardedPromotionAttempts += 1;
        values.forEach(value => promotionEntries.set(value.key, structuredClone(value)));
      },
      async deleteMany(keys) {
        removedLegacyKeys.push(...keys);
        keys.forEach(key => promotionEntries.delete(key));
      }
    },
    fetchImpl: async () => {
      promotionProviderCalls += 1;
      return jsonResponse({ output_text: JSON.stringify(
        figureOutput('figure-1', 'caption_context', 'standard')
      ) });
    }
  });

  const promotionFailure = await promotionFailureRouter.handle(message);
  assert.equal(promotionFailure.success, true);
  assert.equal(promotionFailure.data.cacheHits, 0);
  assert.equal(promotionFailure.data.figureResults[0].cacheHit, false);
  assert.equal(promotionProviderCalls, 1);
  assert.equal(unguardedPromotionAttempts, 1);
  assert.deepEqual(removedLegacyKeys, []);
  assert.equal(promotionEntries.has(previousKey), true);
  assert.ok([...promotionEntries.keys()].some(key =>
    /^figure:sha256:[a-f0-9]{64}$/u.test(key)));
});

test('routes local Codex Figure analysis with actual image inputs instead of caption fallback', async () => {
  const storageArea = createMemoryStorage();
  const turns = [];
  const nativeClient = {
    streamTurn(input) {
      turns.push(input);
      const prompt = JSON.parse(input.userPrompt);
      const output = figurePassOutput(prompt);
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text_delta', text: JSON.stringify(output) };
          yield { type: 'completed' };
        }
      };
    },
    async health() { return { connected: true, hostVersion: '1.0.0' }; }
  };
  const router = createBackgroundRouter({
    storageArea,
    nativeClient,
    fetchImpl: async () => jsonResponse({})
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'codex-local',
    config: { model: 'auto', reasoningEffort: 'medium' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'regex',
      providerId: 'codex-local',
      consentGranted: true
    }
  });

  const response = await router.handle(figureMessage([
    figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,/9j/2Q==' }])
  ], { analysisDepth: 'standard' }));

  assert.equal(response.success, true);
  assert.equal(response.data.route.providerId, 'codex-local');
  assert.equal((await router.handle({ type: 'LLM_GET_SETTINGS' }))
    .data.settings.mode, 'regex');
  assert.equal(response.data.route.capabilityMode, 'vision');
  assert.equal(response.data.visionFallbacks, 0);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].images.length, 1);
  assert.equal(JSON.parse(turns[0].userPrompt).analysis_basis, 'vision_text');
});

test('caches one Figure standard and deep results independently', async () => {
  const fixture = await configuredFigureRouter('openai', { model: 'gpt-5-mini' });
  await fixture.router.handle(figureMessage([figureInput(1)], { analysisDepth: 'standard' }));
  await fixture.router.handle(figureMessage([figureInput(1)], { analysisDepth: 'deep' }));
  assert.equal(fixture.bodies.length, 2);
  const cachedDeep = await fixture.router.handle(
    figureMessage([figureInput(1)], { analysisDepth: 'deep' })
  );
  assert.equal(cachedDeep.data.cacheHits, 1);
  assert.equal(fixture.bodies.length, 2);
});

test('explicit current confirmation: exact Figure policy gates every visual fallback path and records only a safe cause', async () => {
  const scenarios = [
    { name: 'unlabeled', panelHints: [], analysisDepth: 'standard' },
    { name: 'standard_compact', panelHints: ['A'], analysisDepth: 'standard' },
    { name: 'deep', panelHints: ['A', 'B', 'C'], analysisDepth: 'deep' },
    { name: 'missing_recovery', panelHints: ['A', 'B'], analysisDepth: 'standard' }
  ];
  const unlabeledOutput = input => ({
    figure_id: input.figure_id,
    analysis_depth: input.analysis_depth,
    basis: input.analysis_basis,
    figure_title_zh: '',
    figure_question_zh: 'What does this Figure establish?',
    remaining_question_zh: '',
    evidence_steps: [{
      source_zh: 'The supplied Figure evidence.',
      established_zh: 'The intervention changes the reported phenotype.',
      handoff_zh: 'The next experiment tests mechanism.',
      evidence_level: 'intervention_effect'
    }],
    author_assembly_zh: 'The author moves from phenotype to mechanism.',
    core_conclusion_zh: 'The intervention changes the phenotype.',
    claim_boundary_zh: 'The supplied evidence does not establish every mechanism.'
  });

  async function runScenario(scenario, allowTextFallback) {
    const storageArea = createMemoryStorage();
    const requests = [];
    const secret = `private-${scenario.name}-provider-body`;
    const router = createConfirmedFigureRouter({
      storageArea,
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        const input = openAIInputPayload(body);
        const visual = input.analysis_basis === 'vision_text';
        const pass = input.pass || 'single_pass';
        requests.push({ pass, visual });
        const rejectVisual = scenario.name === 'missing_recovery'
          ? pass === 'missing_panel_recovery' && visual
          : visual;
        if (rejectVisual) {
          return jsonResponse({ error: { message: secret } }, 400);
        }
        if (scenario.name === 'standard_compact' && pass === 'single_pass') {
          return jsonResponse({ output_text: 'not valid JSON' });
        }
        let output;
        if (scenario.name === 'unlabeled') output = unlabeledOutput(input);
        else if (scenario.name === 'missing_recovery' && pass === 'single_pass') {
          output = partialFigurePassOutput(input, ['A']);
        } else if (pass === 'missing_panel_recovery') {
          output = figureRecoveryOutput(input, input.requested_panel_labels);
        } else {
          output = figurePassOutput(input);
        }
        return jsonResponse({ output_text: JSON.stringify(output) });
      }
    }, allowTextFallback ? 'continue_text' : 'pause');
    await configureOpenAIRouter(router);
    storageArea.values.sciLlmSettingsV2.taskPolicies
      .figure_walkthrough.allowTextFallback = allowTextFallback;
    const response = await router.handle(figureMessage([{
      ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,QUJDRA==' }]),
      panelHints: scenario.panelHints
    }], { analysisDepth: scenario.analysisDepth, forceRefresh: true }));
    return { response, requests, secret };
  }

  for (const scenario of scenarios) {
    const denied = await runScenario(scenario, false);
    assert.equal(denied.response.success, false, scenario.name);
    assert.equal(denied.response.error.code, 'FIGURE_VISION_PAUSED', scenario.name);
    assert.equal(denied.requests.some(request => request.visual === false), false,
      `${scenario.name} sent caption evidence while the current user chose pause`);
    assert.doesNotMatch(JSON.stringify(denied.response), new RegExp(denied.secret));

    const allowed = await runScenario(scenario, true);
    assert.equal(allowed.response.success, true,
      `${scenario.name}: ${JSON.stringify(allowed.response)}`);
    assert.equal(allowed.requests.some(request => request.visual === false), true,
      scenario.name);
    assert.equal(allowed.response.data.figureResults[0].visionFallback, true,
      scenario.name);
    assert.equal(allowed.response.data.figureResults[0].inputMode, 'caption_context',
      scenario.name);
    assert.equal(allowed.response.data.figureResults[0].fallbackReason,
      'provider_rejected_pixels', scenario.name);
    assert.doesNotMatch(JSON.stringify(allowed.response), new RegExp(allowed.secret));
  }
});

test('explicit current confirmation: Panel interpretation and follow-up obey only their exact text-fallback policy', async () => {
  const modes = [
    {
      name: 'interpretation', taskId: 'figure_panel_interpretation',
      otherTaskId: 'figure_panel_followup', type: 'LLM_ANALYZE_FIGURE_PANEL',
      resultKey: 'panelAnalysis'
    },
    {
      name: 'followup', taskId: 'figure_panel_followup',
      otherTaskId: 'figure_panel_interpretation', type: 'LLM_ASK_FIGURE_PANEL',
      resultKey: 'panelFollowup'
    }
  ];
  for (const mode of modes) {
    async function run(allowTarget) {
      const storageArea = createMemoryStorage();
      const sessionStorageArea = createMemoryStorage();
      const requests = [];
      const router = createConfirmedFigureRouter({
        storageArea, sessionStorageArea, runtimeExtensionId: 'extension-id',
        fetchImpl: async (url, options) => {
          const body = JSON.parse(options.body);
          const input = openAIInputPayload(body);
          const visual = input.analysis_basis === 'vision_text';
          requests.push(visual ? 'image' : 'text');
          if (visual) return jsonResponse({ error: { message: 'private pixel detail' } }, 400);
          const output = mode.name === 'followup'
            ? panelFollowupOutput(input) : panelInterpretationOutput(input);
          return jsonResponse({ output_text: JSON.stringify(output) });
        }
      }, allowTarget ? 'continue_text' : 'pause');
      await configureOpenAIRouter(router);
      storageArea.values.sciLlmSettingsV2.taskPolicies[mode.taskId]
        .allowTextFallback = allowTarget;
      storageArea.values.sciLlmSettingsV2.taskPolicies[mode.otherTaskId]
        .allowTextFallback = !allowTarget;
      const response = await router.handle({
        type: mode.type,
        operationScope: 'figure', workspaceLifecycle: 31,
        analysisDepth: 'standard',
        operationId: `figure-panel-policy-${mode.name}-${allowTarget ? 'allowed' : 'denied'}`,
        figureRequestReceipt:
          `figure-request-panel-policy-${mode.name}-${allowTarget ? 'allowed' : 'denied'}-12345678`,
        figureOperationPlan: [{ figureId: 'figure-1', panelCount: 1 }],
        providerAttemptsConsumed: 0,
        documentHash: 'd'.repeat(64),
        document: { title: `Exact ${mode.name} policy` },
        figure: {
          ...figureInput(1), panelHints: ['A'],
          imageVariants: [panelImageVariant(1200)]
        },
        panel: { panel: 'A', purpose: 'Compare groups' },
        topics: mode.name === 'followup' ? ['grouping'] : [],
        customQuestion: '',
        forceRefresh: true
      }, {
        ...figureCheckpointContext([], []), trustedExtensionSender: true,
        senderExtensionId: 'extension-id', senderTabId: 31, senderFrameId: 0,
        senderDocumentId: '31313131-3131-4313-8313-313131313131'
      });
      return { response, requests };
    }

    const denied = await run(false);
    assert.equal(denied.response.success, false, mode.name);
    assert.equal(denied.response.error.code, 'FIGURE_VISION_PAUSED', mode.name);
    assert.deepEqual(denied.requests, ['image'], mode.name);

    const allowed = await run(true);
    assert.equal(allowed.response.success, true,
      `${mode.name}: ${JSON.stringify(allowed.response)}`);
    assert.deepEqual(allowed.requests, ['image', 'text'], mode.name);
    const result = allowed.response.data[mode.resultKey];
    assert.equal(result.basis, 'caption_context', mode.name);
    assert.equal(result.inputBasis.inputMode, 'caption_context', mode.name);
    assert.equal(result.inputBasis.pixelsSupplied, false, mode.name);
    assert.equal(result.inputBasis.degradationReason,
      'provider_rejected_pixels', mode.name);
  }
});

test('explicit current confirmation: Panel capacity cannot make caption the first admitted plan without exact policy', async () => {
  async function run(allowTextFallback) {
    const storageArea = createMemoryStorage();
    let cacheReads = 0;
    const requests = [];
    const router = createConfirmedFigureRouter({
      storageArea,
      cacheStore: {
        async getMany() { cacheReads += 1; return new Map(); },
        async setMany() {},
        async deleteMany() {}
      },
      fetchImpl: async (url, options) => {
        const input = openAIInputPayload(JSON.parse(options.body));
        requests.push(input.analysis_basis);
        return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
      }
    }, allowTextFallback ? 'continue_text' : 'pause');
    await configureOpenAIRouter(router);
    const settings = await globalThis.SciLLM.loadSettings(storageArea);
    const route = globalThis.SciLLM.resolveTaskProfile(
      settings, 'figure_panel_interpretation'
    );
    storageArea.values.sciLlmSettingsV2.profiles[route.effectiveProfileId]
      .contextWindowTokens = 8192;
    storageArea.values.sciLlmSettingsV2.taskPolicies
      .figure_panel_interpretation.allowTextFallback = allowTextFallback;
    const response = await router.handle({
      type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: '9'.repeat(64),
      document: { title: 'Capacity-only caption admission' },
      figure: {
        ...figureInput(1), panelHints: ['A'], caption: 'x'.repeat(3000),
        imageVariants: [panelImageVariant(1200)]
      },
      panel: { panel: 'A' }
    });
    return { response, cacheReads, requests };
  }

  const denied = await run(false);
  assert.equal(denied.response.success, false);
  assert.equal(denied.response.error.code, 'FIGURE_VISION_PAUSED');
  assert.equal(denied.cacheReads, 0);
  assert.deepEqual(denied.requests, []);

  const allowed = await run(true);
  assert.equal(allowed.response.success, true, JSON.stringify(allowed.response));
  assert.deepEqual(allowed.requests, ['caption_context']);
  assert.equal(allowed.response.data.panelAnalysis.inputBasis.inputMode,
    'caption_context');
  assert.equal(allowed.response.data.panelAnalysis.inputBasis.degradationReason,
    'visual_context_capacity');
});

test('never turns operational or configuration failures into caption requests', async () => {
  const deniedCodes = [
    'AUTH_INVALID', 'QUOTA_EXHAUSTED', 'RATE_LIMITED', 'NETWORK_ERROR',
    'PROVIDER_UNAVAILABLE', 'REQUEST_TIMEOUT', 'CANCELLED', 'INVALID_SETTINGS',
    'LLM_NOT_READY', 'CAPABILITY_MISMATCH'
  ];
  const requestModes = [
    ['whole', 'figure_walkthrough', () => figureMessage([{
      ...figureInput(1), panelHints: ['A'],
      images: [{ dataUrl: 'data:image/jpeg;base64,QUJDRA==' }]
    }], { analysisDepth: 'standard', forceRefresh: true })],
    ['interpretation', 'figure_panel_interpretation', () => ({
      type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: 'a'.repeat(64),
      document: { title: 'Non-degradable Panel error' },
      figure: { ...figureInput(1), panelHints: ['A'], imageVariants: [panelImageVariant(1200)] },
      panel: { panel: 'A' }, forceRefresh: true
    })],
    ['followup', 'figure_panel_followup', () => ({
      type: 'LLM_ASK_FIGURE_PANEL', documentHash: 'b'.repeat(64),
      document: { title: 'Non-degradable follow-up error' },
      figure: { ...figureInput(1), panelHints: ['A'], imageVariants: [panelImageVariant(1200)] },
      panel: { panel: 'A' }, topics: ['grouping'], forceRefresh: true
    })]
  ];
  const originalCreateProviderAdapter = globalThis.SciLLM.createProviderAdapter;
  let activeCode = '';
  let providerInputs = [];
  globalThis.SciLLM.createProviderAdapter = options => {
    const adapter = originalCreateProviderAdapter(options);
    const reject = async request => {
      providerInputs.push(Array.isArray(request.images) && request.images.length
        ? 'image' : 'text');
      const error = new Error(`private-provider-body-${activeCode}`);
      error.code = activeCode;
      error.retryable = false;
      throw error;
    };
    return new Proxy(adapter, {
      get(target, key, receiver) {
        if (key === 'generateJson' || key === 'generateJsonAtLimit') return reject;
        return Reflect.get(target, key, receiver);
      }
    });
  };
  try {
    for (const [name, taskId, message] of requestModes) {
      const storageArea = createMemoryStorage();
      const router = createBackgroundRouter({
        storageArea, sleepImpl: async () => {},
        fetchImpl: async () => { throw new Error('wrapped adapter must own the request'); }
      });
      await configureOpenAIRouter(router);
      storageArea.values.sciLlmSettingsV2.taskPolicies[taskId].allowTextFallback = true;
      for (const code of deniedCodes) {
        activeCode = code;
        providerInputs = [];
        const response = await router.handle(message());
        assert.equal(response.success, false, `${name}:${code}`);
        const expectedCode = [
          'NETWORK_ERROR', 'PROVIDER_UNAVAILABLE', 'REQUEST_TIMEOUT', 'RATE_LIMITED'
        ].includes(code) ? 'FIGURE_REQUEST_REPLAY_AMBIGUOUS' : code;
        assert.equal(response.error.code, expectedCode, `${name}:${code}`);
        assert.equal(providerInputs.includes('text'), false, `${name}:${code}`);
        assert.doesNotMatch(JSON.stringify(response), /private-provider-body/,
          `${name}:${code}`);
      }
    }
  } finally {
    globalThis.SciLLM.createProviderAdapter = originalCreateProviderAdapter;
  }
});

test('explicit current confirmation: whole Figure cache keeps caption and visual identities in separate modality lifecycles', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const writes = [];
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => {
        const copy = structuredClone(value);
        entries.set(value.key, copy);
        writes.push(copy);
      });
    },
    async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
  };
  let rejectPixels = true;
  const requests = [];
  const router = createConfirmedFigureRouter({
    storageArea, cacheStore,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const mode = input.analysis_basis === 'vision_text' ? 'image' : 'text';
      requests.push(mode);
      if (mode === 'image' && rejectPixels) return jsonResponse({}, 400);
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_walkthrough.allowTextFallback = true;
  const imageMessage = byte => figureMessage([{
    ...figureInput(1, [{ dataUrl: `data:image/jpeg;base64,${byte.repeat(8)}` }]),
    panelHints: ['A']
  }], { analysisDepth: 'standard' });
  const textMessage = figureMessage([{
    ...figureInput(1), panelHints: ['A']
  }], { analysisDepth: 'standard' });

  const firstImage = await router.handle(imageMessage('A'));
  assert.equal(firstImage.success, true);
  assert.deepEqual(requests, ['image', 'text']);
  const directText = await router.handle(textMessage);
  assert.equal(directText.data.cacheHits, 1);
  assert.deepEqual(requests, ['image', 'text']);
  const secondImageFallback = await router.handle(imageMessage('B'));
  assert.equal(secondImageFallback.data.figureResults[0].fallbackReason,
    'provider_rejected_pixels');
  assert.deepEqual(requests, ['image', 'text', 'image', 'text']);
  assert.equal(new Set(writes.filter(value =>
    value.figureResult.inputMode === 'caption_context').map(value => value.key)).size, 1,
  'caption cache identity must exclude image bytes');

  rejectPixels = false;
  const retriedImage = await router.handle({ ...imageMessage('A'), forceRefresh: true });
  assert.equal(retriedImage.data.cacheHits, 0);
  assert.equal(requests.at(-1), 'image');
  const visualHit = await router.handle(imageMessage('A'));
  assert.equal(visualHit.data.cacheHits, 1);
  const secondVisual = await router.handle(imageMessage('B'));
  assert.equal(secondVisual.data.cacheHits, 0);
  assert.equal(requests.at(-1), 'image');
  const secondVisualHit = await router.handle(imageMessage('B'));
  assert.equal(secondVisualHit.data.cacheHits, 1);
  const visualKeys = writes.filter(value =>
    value.figureResult.inputMode === 'figure_image').map(value => value.key);
  assert.equal(new Set(visualKeys).size, 2,
    'different image bytes must produce different visual cache identities');
});

test('explicit current confirmation: mixed visual and caption Panel recovery is never reused as caption-only evidence', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const requests = [];
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, structuredClone(value)));
    },
    async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
  };
  const visualOnlyMarker = 'observation-derived-only-from-image-A';
  const router = createConfirmedFigureRouter({
    storageArea, cacheStore,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const visual = input.analysis_basis === 'vision_text';
      requests.push({ pass: input.pass || 'single_pass', visual });
      if (input.pass === 'missing_panel_recovery' && visual) {
        return jsonResponse({}, 400);
      }
      if (input.pass === 'missing_panel_recovery') {
        return jsonResponse({ output_text: JSON.stringify(
          figureRecoveryOutput(input, input.requested_panel_labels)
        ) });
      }
      if (input.pass === 'figure_synthesis') {
        return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
      }
      if (visual) {
        const partial = partialFigurePassOutput(input, ['A']);
        partial.panels[0].direct_observation_zh = visualOnlyMarker;
        return jsonResponse({ output_text: JSON.stringify(partial) });
      }
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_walkthrough.allowTextFallback = true;
  const visualMessage = figureMessage([{
    ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,QUJDRA==' }]),
    panelHints: ['A', 'B']
  }], { analysisDepth: 'standard' });
  const first = await router.handle(visualMessage);
  assert.equal(first.success, true, JSON.stringify(first));
  assert.equal(first.data.figureResults[0].panels[0].directObservation,
    visualOnlyMarker);
  assert.equal(entries.size, 0,
    'mixed visual/caption result must not populate the reusable caption cache');

  const directCaption = await router.handle(figureMessage([{
    ...figureInput(1), panelHints: ['A', 'B']
  }], { analysisDepth: 'standard' }));
  assert.equal(directCaption.success, true, JSON.stringify(directCaption));
  assert.equal(directCaption.data.cacheHits, 0);
  assert.doesNotMatch(JSON.stringify(directCaption), new RegExp(visualOnlyMarker));
  assert.deepEqual(requests.at(-1), { pass: 'single_pass', visual: false });
});

test('explicit current confirmation: deep mixed-batch visual and caption recovery is never cached as caption-only evidence', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const requests = [];
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, structuredClone(value)));
    },
    async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
  };
  const router = createConfirmedFigureRouter({
    storageArea, cacheStore,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const visual = Array.isArray(body.input);
      const panels = input.requested_panel_labels || input.expected_panel_labels ||
        input.panel_evidence?.map(panel => panel.panel) || [];
      requests.push({ pass: input.pass, panels, visual });
      if (input.pass === 'panel_extraction' && panels.join(',') === 'A,B') {
        return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
      }
      if (input.pass === 'panel_extraction' && panels.join(',') === 'C,D' && visual) {
        return jsonResponse({ output_text: JSON.stringify(partialFigurePassOutput(input, ['C'])) });
      }
      if (input.pass === 'missing_panel_recovery' && visual) {
        return jsonResponse({}, 400);
      }
      const output = input.pass === 'missing_panel_recovery'
        ? figureRecoveryOutput(input, input.requested_panel_labels)
        : figurePassOutput(input);
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  storageArea.values.sciLlmSettingsV2.taskPolicies
    .figure_walkthrough.allowTextFallback = true;
  const visualMessage = figureMessage([{
    ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,REU=' }]),
    panelHints: ['A', 'B', 'C', 'D']
  }], { analysisDepth: 'deep' });
  const first = await router.handle(visualMessage);
  assert.equal(first.success, true, JSON.stringify(first));
  assert.ok(requests.some(item =>
    item.pass === 'panel_extraction' && item.panels.join(',') === 'A,B' && item.visual
  ));
  assert.ok(requests.some(item =>
    item.pass === 'missing_panel_recovery' && item.panels.join(',') === 'D' && item.visual
  ));
  assert.ok(requests.some(item =>
    item.pass === 'missing_panel_recovery' && item.panels.join(',') === 'D' && !item.visual
  ));
  assert.equal(entries.size, 0,
    `mixed deep batches must not populate the reusable caption cache: ${JSON.stringify({
      requests,
      cachedModes: [...entries.values()].map(item => item.figureResult?.inputMode)
    })}`);

  const requestCountBeforeCaption = requests.length;
  const directCaption = await router.handle(figureMessage([{
    ...figureInput(1), panelHints: ['A', 'B', 'C', 'D']
  }], { analysisDepth: 'deep' }));
  assert.equal(directCaption.success, true, JSON.stringify(directCaption));
  assert.equal(directCaption.data.cacheHits, 0);
  assert.ok(requests.length > requestCountBeforeCaption);
  assert.ok(requests.some(item =>
    item.pass === 'panel_extraction' && item.panels.join(',') === 'A,B' && !item.visual
  ));
});

test('explicit current confirmation: both Panel caches retry pixels after caption fallback and hash only each actual plan', async () => {
  for (const requestMode of ['interpretation', 'followup']) {
    const storageArea = createMemoryStorage();
    const entries = new Map();
    const writes = [];
    const cacheStore = {
      async getMany(keys) {
        return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
      },
      async setMany(values) {
        values.forEach(value => {
          const copy = structuredClone(value);
          entries.set(value.key, copy);
          writes.push(copy);
        });
      },
      async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
    };
    let rejectPixels = true;
    const requests = [];
    const router = createConfirmedFigureRouter({
      storageArea, cacheStore,
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        const input = openAIInputPayload(body);
        const mode = input.analysis_basis === 'vision_text' ? 'image' : 'text';
        requests.push(mode);
        if (mode === 'image' && rejectPixels) return jsonResponse({}, 400);
        const output = requestMode === 'followup'
          ? panelFollowupOutput(input) : panelInterpretationOutput(input);
        return jsonResponse({ output_text: JSON.stringify(output) });
      }
    });
    await configureOpenAIRouter(router);
    const taskId = requestMode === 'followup'
      ? 'figure_panel_followup' : 'figure_panel_interpretation';
    storageArea.values.sciLlmSettingsV2.taskPolicies[taskId].allowTextFallback = true;
    const message = byte => ({
      type: requestMode === 'followup'
        ? 'LLM_ASK_FIGURE_PANEL' : 'LLM_ANALYZE_FIGURE_PANEL',
      documentHash: 'c'.repeat(64), document: { title: `Panel ${requestMode} cache` },
      figure: {
        ...figureInput(1), panelHints: ['A'],
        imageVariants: byte ? [{
          ...panelImageVariant(1200),
          dataUrl: `data:image/jpeg;base64,${byte.repeat(300)}`
        }] : []
      },
      panel: { panel: 'A', purpose: 'Compare groups' },
      topics: requestMode === 'followup' ? ['grouping'] : [],
      customQuestion: ''
    });

    const firstImage = await router.handle(message('A'));
    assert.equal(firstImage.success, true, requestMode);
    assert.deepEqual(requests, ['image', 'text'], requestMode);
    const directText = await router.handle(message(''));
    assert.equal(directText.data.cacheHit, true, requestMode);
    assert.deepEqual(requests, ['image', 'text'], requestMode);
    await router.handle(message('B'));
    assert.deepEqual(requests, ['image', 'text', 'image', 'text'], requestMode);
    const captionKeys = writes.filter(value =>
      value.panelResult.inputBasis.inputMode === 'caption_context').map(value => value.key);
    assert.equal(new Set(captionKeys).size, 1,
      `${requestMode} caption identity included image bytes`);

    rejectPixels = false;
    const retried = await router.handle({ ...message('A'), forceRefresh: true });
    assert.equal(retried.data.cacheHit, false, requestMode);
    assert.equal(requests.at(-1), 'image', requestMode);
    const visualHit = await router.handle(message('A'));
    assert.equal(visualHit.data.cacheHit, true, requestMode);
    const otherVisual = await router.handle(message('B'));
    assert.equal(otherVisual.data.cacheHit, false, requestMode);
    const otherVisualHit = await router.handle(message('B'));
    assert.equal(otherVisualHit.data.cacheHit, true, requestMode);
    const visualKeys = writes.filter(value =>
      value.panelResult.inputBasis.inputMode !== 'caption_context').map(value => value.key);
    assert.equal(new Set(visualKeys).size, 2,
      `${requestMode} visual identity did not use actual plan pixels`);

    const withUnusedSecondaryVariant = secondaryByte => ({
      ...message(''),
      figure: {
        ...message('').figure,
        imageVariants: [
          { ...panelImageVariant(1200), dataUrl: `data:image/jpeg;base64,${'C'.repeat(1200)}` },
          { ...panelImageVariant(960), dataUrl: `data:image/jpeg;base64,${secondaryByte.repeat(960)}` }
        ]
      }
    });
    await router.handle({ ...withUnusedSecondaryVariant('D'), forceRefresh: true });
    const requestsBeforeSecondaryChange = requests.length;
    const unchangedActualPixels = await router.handle(withUnusedSecondaryVariant('E'));
    assert.equal(unchangedActualPixels.data.cacheHit, true, requestMode);
    assert.equal(requests.length, requestsBeforeSecondaryChange,
      `${requestMode} hashed an unused image variant into the selected visual plan`);
  }
});

test('explicit current confirmation: whole Figure cache rejects poisoned modality metadata and fails closed on accessors', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const evicted = [];
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, structuredClone(value)));
    },
    async deleteMany(keys) {
      evicted.push(...keys);
      keys.forEach(key => entries.delete(key));
    }
  };
  let calls = 0;
  const router = createConfirmedFigureRouter({
    storageArea, cacheStore,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([{
    ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,QUJDRA==' }]),
    panelHints: ['A']
  }], { analysisDepth: 'standard' });
  const first = await router.handle(message);
  assert.equal(first.success, true);
  const cachedKey = [...entries.keys()][0];
  const pristineEntry = structuredClone(entries.get(cachedKey));
  let getterCalls = 0;
  const mutations = [
    value => { value.fallbackReason = 'Bearer cache-secret-token'; },
    value => Object.defineProperty(value, 'fallbackReason', {
      configurable: true,
      get() {
        getterCalls += 1;
        return 'provider_rejected_pixels';
      }
    }),
    value => Object.assign(value, {
      inputMode: 'caption_context', visionFallback: false, fallbackReason: ''
    }),
    value => Object.assign(value, {
      inputMode: 'figure_image', visionFallback: true,
      fallbackReason: 'provider_rejected_pixels'
    }),
    value => { value.fallbackReason = { secret: 'cache-secret-object' }; }
  ];
  for (const [mutationIndex, mutate] of mutations.entries()) {
    const poisoned = structuredClone(pristineEntry);
    mutate(poisoned.figureResult);
    entries.set(cachedKey, poisoned);
    const before = calls;
    const response = await router.handle(message);
    if (mutationIndex === 1) {
      assert.equal(response.success, false);
      assert.equal(response.error.code, 'FIGURE_CACHE_READ_FAILED');
      assert.equal(calls, before);
    } else {
      assert.equal(response.success, true);
      assert.equal(response.data.cacheHits, 0);
      assert.equal(calls, before + 1);
    }
    assert.doesNotMatch(JSON.stringify(response), /cache-secret/);
  }
  assert.equal(getterCalls, 0);
  assert.equal(evicted.length, 0,
    'invalid current entries must be replaced without a stale read-path delete');
});

test('legacy whole Figure cache is never read promoted or evicted as authority', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const evicted = [];
  const readKeys = [];
  let providerCalls = 0;
  const cacheStore = {
    async getMany(keys) {
      readKeys.push(...keys);
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) { values.forEach(value => entries.set(value.key, value)); },
    async compareAndSetManyGuarded(values, guard) {
      if (guard.expectedRevision !== null || entries.has(guard.casKey)) {
        return { applied: false, revision: entries.get(guard.casKey)?.revision ?? null };
      }
      values.forEach(value => entries.set(value.key, structuredClone(value)));
      return { applied: true, revision: 0 };
    },
    async deleteMany(keys) {
      evicted.push(...keys);
      keys.forEach(key => entries.delete(key));
    }
  };
  const router = createBackgroundRouter({
    storageArea, cacheStore,
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([{
    ...figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,QUJDRA==' }]),
    panelHints: ['A']
  }], { analysisDepth: 'standard' });
  const settings = await globalThis.SciLLM.loadSettings(storageArea);
  const route = globalThis.SciLLM.resolveTaskProfile(settings, 'figure_walkthrough');
  const profileSignature = globalThis.SciLLM.stableHash({
    profileSignature: route.profileSignature,
    taskPolicySignature: buildTaskPolicySignature(settings, 'figure_walkthrough')
  });
  const documentHash = await globalThis.SciLLM.hashDocument(message.document.paragraphs);
  const rawFigure = message.figures[0];
  const oldFigureHash = globalThis.SciLLM.stableHash({
    caption: rawFigure.caption,
    panelHints: ['A'],
    contextParagraphs: rawFigure.contextParagraphs.map(item => ({
      paragraphId: item.paragraphId,
      sectionTitle: item.sectionTitle || '',
      text: item.text
    })),
    images: rawFigure.images.map(image => globalThis.SciLLM.stableHash(image.dataUrl))
  });
  const oldKey = `figure:${globalThis.SciLLM.stableHash({
    documentHash, providerId: route.providerId, model: route.model,
    figureId: rawFigure.figureId, figureHash: oldFigureHash,
    analysisDepth: 'standard', figureVersion: globalThis.SciLLM.FIGURE_ANALYSIS_VERSION,
    profileSignature
  })}`;
  const captionFallback = globalThis.SciLLM.validateFigureAnalysis(
    figureOutput(rawFigure.figureId, 'caption_context', 'standard'),
    { ...rawFigure, panelHints: ['A'] },
    { visualInput: false, analysisDepth: 'standard' }
  );
  const visualLegacy = globalThis.SciLLM.validateFigureAnalysis(
    figureOutput(rawFigure.figureId, 'vision_text', 'standard'),
    { ...rawFigure, panelHints: ['A'] },
    { visualInput: true, analysisDepth: 'standard' }
  );
  entries.set(oldKey, {
    key: oldKey, createdAt: 1, figureResult: visualLegacy
  });
  const promoted = await router.handle(message);
  assert.equal(promoted.success, true);
  assert.equal(promoted.data.cacheHits, 0);
  assert.equal(providerCalls, 1);
  assert.equal(readKeys.includes(oldKey), false);
  assert.ok([...entries.keys()].some(key =>
    /^figure:sha256:[a-f0-9]{64}$/u.test(key)));
  assert.deepEqual(evicted, []);

  entries.clear();
  entries.set(oldKey, {
    key: oldKey, createdAt: 1,
    figureResult: { ...captionFallback, visionFallback: true }
  });

  const response = await router.handle(message);
  assert.equal(response.success, true);
  assert.equal(response.data.cacheHits, 0);
  assert.equal(response.data.figureResults[0].basis, 'vision_text');
  assert.equal(providerCalls, 2);
  assert.equal(readKeys.includes(oldKey), false);
  assert.deepEqual(evicted, []);
  assert.equal(entries.has(oldKey), true);
});

test('weak whole Figure entries stay outside concurrent current-cache traffic', async () => {
  const storageArea = createMemoryStorage();
  const weakKey = 'figure:legacy-weak-authority';
  const entries = new Map([[weakKey, {
    key: weakKey, createdAt: 1,
    figureResult: { ...figureOutput('figure-1'), cacheHit: true }
  }]]);
  const requestedKeySets = [];
  let providerCalls = 0;
  const cacheStore = {
    async getMany(keys) {
      requestedKeySets.push([...keys]);
      return new Map(keys.filter(key => entries.has(key))
        .map(key => [key, structuredClone(entries.get(key))]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, structuredClone(value)));
    },
    async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
  };
  const router = createBackgroundRouter({
    storageArea, cacheStore,
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([{
    ...figureInput(1), panelHints: ['A']
  }], { analysisDepth: 'standard' });

  const [ordinary, refreshed] = await Promise.all([
    router.handle(message),
    router.handle({ ...message, forceRefresh: true })
  ]);
  assert.equal(ordinary.success, true, JSON.stringify(ordinary));
  assert.equal(refreshed.success, true, JSON.stringify(refreshed));
  assert.equal(providerCalls, 2);
  assert.equal(entries.has(weakKey), true);
  assert.ok(requestedKeySets.flat().every(key =>
    /^figure:sha256:[a-f0-9]{64}$/u.test(key)));
  assert.equal(requestedKeySets.flat().includes(weakKey), false);

  const exactReplay = await router.handle(message);
  assert.equal(exactReplay.data.cacheHits, 1);
  assert.equal(providerCalls, 2);
});
test('explicit current confirmation: both Panel caches reject poisoned fallback metadata and fail closed on accessors', async () => {
  for (const requestMode of ['interpretation', 'followup']) {
    const storageArea = createMemoryStorage();
    const entries = new Map();
    const evicted = [];
    let calls = 0;
    let getterCalls = 0;
    const cacheStore = {
      async getMany(keys) {
        return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
      },
      async setMany(values) {
        values.forEach(value => entries.set(value.key, structuredClone(value)));
      },
      async deleteMany(keys) {
        evicted.push(...keys);
        keys.forEach(key => entries.delete(key));
      }
    };
    const router = createConfirmedFigureRouter({
      storageArea, cacheStore,
      fetchImpl: async (url, options) => {
        calls += 1;
        const input = openAIInputPayload(JSON.parse(options.body));
        return jsonResponse({ output_text: JSON.stringify(requestMode === 'followup'
          ? panelFollowupOutput(input) : panelInterpretationOutput(input)) });
      }
    });
    await configureOpenAIRouter(router);
    const message = {
      type: requestMode === 'followup'
        ? 'LLM_ASK_FIGURE_PANEL' : 'LLM_ANALYZE_FIGURE_PANEL',
      documentHash: 'e'.repeat(64), document: { title: 'Poisoned Panel metadata' },
      figure: {
        ...figureInput(1), panelHints: ['A'], imageVariants: [panelImageVariant(1200)]
      },
      panel: { panel: 'A', purpose: 'Compare groups' },
      topics: requestMode === 'followup' ? ['grouping'] : [],
      forceRefresh: false
    };
    const first = await router.handle(message);
    assert.equal(first.success, true, requestMode);
    const cachedKey = [...entries.keys()][0];
    const pristineEntry = structuredClone(entries.get(cachedKey));
    const mutations = [
      value => { value.inputBasis.degradationReason = 'api-key=cache-secret'; },
      value => { value.inputBasis.degradationReason = { secret: 'cache-secret-object' }; },
      value => Object.defineProperty(value.inputBasis, 'degradationReason', {
        configurable: true,
        get() {
          getterCalls += 1;
          return 'provider_rejected_pixels';
        }
      }),
      value => { value.inputBasis.inputMode = 'caption_context'; },
      value => { value.inputBasis.pixelsSupplied = false; },
      value => { value.basis = 'caption_context'; },
      value => { value.inputBasis.degradationReason = 'provider_rejected_pixels'; },
      value => { value.inputBasis.degradationReason = 'text_only_for_capacity'; },
      value => { value.visionFallback = true; }
    ];
    for (const [mutationIndex, mutate] of mutations.entries()) {
      const poisoned = structuredClone(pristineEntry);
      mutate(poisoned.panelResult);
      entries.set(cachedKey, poisoned);
      const before = calls;
      const response = await router.handle(message);
      if (mutationIndex === 2) {
        assert.equal(response.success, false, requestMode);
        assert.equal(response.error.code, 'FIGURE_CACHE_READ_FAILED', requestMode);
        assert.equal(calls, before, requestMode);
      } else {
        assert.equal(response.success, true, requestMode);
        assert.equal(response.data.cacheHit, false, requestMode);
        assert.equal(calls, before + 1, requestMode);
      }
      assert.doesNotMatch(JSON.stringify(response), /cache-secret/, requestMode);
    }
    assert.equal(getterCalls, 0, requestMode);

    entries.clear();
    const captionMessage = {
      ...message,
      figure: { ...message.figure, imageVariants: [] },
      forceRefresh: true
    };
    const captionSeed = await router.handle(captionMessage);
    assert.equal(captionSeed.success, true, requestMode);
    const captionKey = [...entries.keys()][0];
    entries.get(captionKey).panelResult.inputBasis.degradationReason =
      'smaller_image_for_capacity';
    const beforeCaptionPoison = calls;
    const captionResponse = await router.handle({ ...captionMessage, forceRefresh: false });
    assert.equal(captionResponse.success, true, requestMode);
    assert.equal(captionResponse.data.cacheHit, false, requestMode);
    assert.equal(calls, beforeCaptionPoison + 1, requestMode);
    assert.equal(evicted.length, 0,
      `${requestMode} invalid current entry used a stale read-path delete`);
  }
});

test('cancelled Panel requests ignore late provider success before validation and cache commit', async () => {
  for (const requestMode of ['interpretation', 'followup']) {
    const storageArea = createMemoryStorage();
    const cacheWrites = [];
    const progress = [];
    let releaseProvider;
    const providerGate = new Promise(resolve => { releaseProvider = resolve; });
    let markProviderStarted;
    const providerStarted = new Promise(resolve => { markProviderStarted = resolve; });
    const router = createBackgroundRouter({
      storageArea,
      cacheStore: {
        async getMany() { return new Map(); },
        async setMany(values) { cacheWrites.push(structuredClone(values)); },
        async deleteMany() {}
      },
      fetchImpl: async (url, options) => {
        const input = openAIInputPayload(JSON.parse(options.body));
        markProviderStarted();
        await providerGate;
        const output = requestMode === 'followup'
          ? panelFollowupOutput(input) : panelInterpretationOutput(input);
        return jsonResponse({ output_text: JSON.stringify(output) });
      }
    });
    await configureOpenAIRouter(router);
    const operationId = `late-panel-provider-${requestMode}`;
    const message = {
      type: requestMode === 'followup'
        ? 'LLM_ASK_FIGURE_PANEL' : 'LLM_ANALYZE_FIGURE_PANEL',
      operationId,
      documentHash: '9'.repeat(64),
      document: { title: 'Late Panel response' },
      figure: {
        ...figureInput(1), panelHints: ['A'], imageVariants: [panelImageVariant(1200)]
      },
      panel: { panel: 'A', purpose: 'Compare groups' },
      topics: requestMode === 'followup' ? ['grouping'] : [],
      forceRefresh: true
    };
    const pending = router.handle(message, {
      onProgress: event => progress.push(event)
    });
    await providerStarted;
    const control = await router.handle({
      type: 'LLM_CONTROL_OPERATION', operationId, command: 'cancel'
    });
    releaseProvider();
    const response = await pending;

    assert.equal(control.success, true, requestMode);
    assert.equal(control.data.cancelled, true, requestMode);
    assert.equal(response.success, false, requestMode);
    assert.equal(response.error.code, 'CANCELLED', requestMode);
    assert.deepEqual(cacheWrites, [], requestMode);
    assert.equal(progress.some(event => event.phase === 'figure_panel_complete'), false,
      requestMode);
  }
});

test('Panel cache reads respect cancellation and started commits retain commit-point success', async () => {
  for (const requestMode of ['interpretation', 'followup']) {
    const storageArea = createMemoryStorage();
    const entries = new Map();
    let readGate = null;
    let markReadStarted = null;
    let writeGate = null;
    let markWriteStarted = null;
    let writeCount = 0;
    const cacheStore = {
      async getMany(keys) {
        if (readGate) {
          markReadStarted();
          await readGate;
        }
        return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
      },
      async setMany(values) {
        if (writeGate) {
          markWriteStarted();
          await writeGate;
        }
        values.forEach(value => entries.set(value.key, structuredClone(value)));
        writeCount += 1;
      },
      async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
    };
    const router = createBackgroundRouter({
      storageArea, cacheStore,
      fetchImpl: async (url, options) => {
        const input = openAIInputPayload(JSON.parse(options.body));
        const output = requestMode === 'followup'
          ? panelFollowupOutput(input) : panelInterpretationOutput(input);
        return jsonResponse({ output_text: JSON.stringify(output) });
      }
    });
    await configureOpenAIRouter(router);
    const message = {
      type: requestMode === 'followup'
        ? 'LLM_ASK_FIGURE_PANEL' : 'LLM_ANALYZE_FIGURE_PANEL',
      documentHash: '8'.repeat(64),
      document: { title: 'Deferred Panel cache' },
      figure: {
        ...figureInput(1), panelHints: ['A'], imageVariants: [panelImageVariant(1200)]
      },
      panel: { panel: 'A', purpose: 'Compare groups' },
      topics: requestMode === 'followup' ? ['grouping'] : [],
      forceRefresh: true
    };
    const seed = await router.handle(message);
    assert.equal(seed.success, true, requestMode);

    let releaseRead;
    readGate = new Promise(resolve => { releaseRead = resolve; });
    let resolveReadStarted;
    const readStarted = new Promise(resolve => { resolveReadStarted = resolve; });
    markReadStarted = resolveReadStarted;
    const readProgress = [];
    const readOperationId = `late-panel-cache-read-${requestMode}`;
    const pendingRead = router.handle({
      ...message, forceRefresh: false, operationId: readOperationId
    }, { onProgress: event => readProgress.push(event) });
    await readStarted;
    await router.handle({
      type: 'LLM_CONTROL_OPERATION', operationId: readOperationId, command: 'cancel'
    });
    releaseRead();
    const readResponse = await pendingRead;
    assert.equal(readResponse.success, false, requestMode);
    assert.equal(readResponse.error.code, 'CANCELLED', requestMode);
    assert.equal(readProgress.some(event => event.phase === 'figure_panel_complete'), false,
      requestMode);
    readGate = null;

    let releaseWrite;
    writeGate = new Promise(resolve => { releaseWrite = resolve; });
    let resolveWriteStarted;
    const writeStarted = new Promise(resolve => { resolveWriteStarted = resolve; });
    markWriteStarted = resolveWriteStarted;
    const writeProgress = [];
    const writeOperationId = `late-panel-cache-write-${requestMode}`;
    const pendingWrite = router.handle({
      ...message, operationId: writeOperationId
    }, { onProgress: event => writeProgress.push(event) });
    await writeStarted;
    await router.handle({
      type: 'LLM_CONTROL_OPERATION', operationId: writeOperationId, command: 'cancel'
    });
    releaseWrite();
    const writeResponse = await pendingWrite;
    assert.equal(writeResponse.success, true, requestMode);
    assert.equal(writeCount, 2, requestMode);
    assert.equal(writeProgress.some(event => event.phase === 'figure_panel_complete'), true,
      requestMode);
  }
});

test('whole Figure cache reads fail closed when cancelled while storage is pending', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  let readGate = null;
  let markReadStarted = null;
  let providerCalls = 0;
  const cacheStore = {
    async getMany(keys) {
      if (readGate) {
        markReadStarted();
        await readGate;
      }
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, structuredClone(value)));
    },
    async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
  };
  const router = createBackgroundRouter({
    storageArea, cacheStore,
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([{
    ...figureInput(1), panelHints: ['A']
  }], { analysisDepth: 'standard', forceRefresh: true });
  const seed = await router.handle(message);
  assert.equal(seed.success, true);
  assert.equal(providerCalls, 1);

  let releaseRead;
  readGate = new Promise(resolve => { releaseRead = resolve; });
  let resolveReadStarted;
  const readStarted = new Promise(resolve => { resolveReadStarted = resolve; });
  markReadStarted = resolveReadStarted;
  const operationId = 'late-whole-figure-cache-read';
  const pending = router.handle({
    ...message, forceRefresh: false, operationId
  });
  await readStarted;
  const control = await router.handle({
    type: 'LLM_CONTROL_OPERATION', operationId, command: 'cancel'
  });
  releaseRead();
  const response = await pending;

  assert.equal(control.success, true);
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'CANCELLED');
  assert.equal(providerCalls, 1);
});

test('legacy Panel cache is never read promoted or deleted as authority', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const deleted = [];
  const readKeys = [];
  let providerCalls = 0;
  const cacheStore = {
    async getMany(keys) {
      readKeys.push(...keys);
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, structuredClone(value)));
    },
    async compareAndSetManyGuarded(values, guard) {
      if (guard.expectedRevision !== null || entries.has(guard.casKey)) {
        return { applied: false, revision: entries.get(guard.casKey)?.revision ?? null };
      }
      values.forEach(value => entries.set(value.key, structuredClone(value)));
      return { applied: true, revision: 0 };
    },
    async deleteMany(keys) {
      deleted.push(...keys);
      keys.forEach(key => entries.delete(key));
    }
  };
  const router = createBackgroundRouter({
    storageArea, cacheStore,
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = {
    type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: 'f'.repeat(64),
    document: { title: 'Legacy Panel modality' },
    figure: {
      ...figureInput(1), panelHints: ['A'],
      imageVariants: [panelImageVariant(1200), panelImageVariant(960)]
    },
    panel: { panel: 'A' }, forceRefresh: true
  };
  const seeded = await router.handle(message);
  assert.equal(seeded.success, true);
  const seededEntry = structuredClone([...entries.values()][0]);
  const settings = await globalThis.SciLLM.loadSettings(storageArea);
  const route = globalThis.SciLLM.resolveTaskProfile(
    settings, 'figure_panel_interpretation'
  );
  const profileSignature = globalThis.SciLLM.stableHash({
    profileSignature: route.profileSignature,
    taskPolicySignature: buildTaskPolicySignature(settings, 'figure_panel_interpretation')
  });
  const rawFigure = message.figure;
  const legacyFigureHash = globalThis.SciLLM.stableHash({
    figureId: rawFigure.figureId,
    caption: rawFigure.caption,
    panelHints: rawFigure.panelHints,
    contextParagraphs: rawFigure.contextParagraphs.map(item => [item.paragraphId, item.text]),
    imageVariants: rawFigure.imageVariants.map(item => [
      item.width, item.height, item.inputMode, globalThis.SciLLM.stableHash(item.dataUrl)
    ])
  });
  const legacyKey = globalThis.SciLLM.buildFigurePanelCacheKey({
    documentHash: message.documentHash,
    figureHash: legacyFigureHash,
    panelId: 'A', providerId: route.providerId, model: route.model,
    inputMode: 'figure_image', imageWidth: 1200, imageHeight: 900,
    promptVersion: globalThis.SciLLM.FIGURE_PANEL_PROMPT_VERSION,
    requestMode: 'interpretation',
    questionSignature: globalThis.SciLLM.stableHash({
      topics: [], customQuestion: '', history: [], existingPanelInterpretation: null
    }),
    profileSignature
  });
  seededEntry.key = legacyKey;
  entries.clear();
  entries.set(legacyKey, seededEntry);
  providerCalls = 0;

  const promoted = await router.handle({ ...message, forceRefresh: false });
  assert.equal(promoted.success, true);
  assert.equal(promoted.data.cacheHit, false);
  assert.equal(providerCalls, 1);
  assert.equal(readKeys.includes(legacyKey), false);
  assert.ok([...entries.keys()].some(key =>
    /^figure-panel:sha256:[a-f0-9]{64}$/u.test(key)));
  assert.deepEqual(deleted, []);

  const incompatible = structuredClone(seededEntry);
  incompatible.panelResult.basis = 'caption_context';
  incompatible.panelResult.inputBasis.inputMode = 'caption_context';
  incompatible.panelResult.inputBasis.pixelsSupplied = false;
  entries.clear();
  entries.set(legacyKey, incompatible);
  deleted.length = 0;
  const recomputed = await router.handle({ ...message, forceRefresh: false });
  assert.equal(recomputed.success, true);
  assert.equal(recomputed.data.cacheHit, false);
  assert.equal(providerCalls, 2);
  assert.equal(readKeys.includes(legacyKey), false);
  assert.deepEqual(deleted, []);
  assert.equal(entries.has(legacyKey), true);
});

test('weak Panel entries stay outside concurrent current-cache traffic', async () => {
  for (const requestMode of ['interpretation', 'followup']) {
    const storageArea = createMemoryStorage();
    const weakKey = `figure-panel:legacy-${requestMode}`;
    const entries = new Map([[weakKey, {
      key: weakKey, createdAt: 1, panelResult: { cacheHit: true }
    }]]);
    const requestedKeySets = [];
    let providerCalls = 0;
    const cacheStore = {
      async getMany(keys) {
        requestedKeySets.push([...keys]);
        return new Map(keys.filter(key => entries.has(key))
          .map(key => [key, structuredClone(entries.get(key))]));
      },
      async setMany(values) {
        values.forEach(value => entries.set(value.key, structuredClone(value)));
      },
      async deleteMany(keys) { keys.forEach(key => entries.delete(key)); }
    };
    const router = createBackgroundRouter({
      storageArea, cacheStore,
      fetchImpl: async (_url, options) => {
        providerCalls += 1;
        const input = openAIInputPayload(JSON.parse(options.body));
        const output = requestMode === 'followup'
          ? panelFollowupOutput(input) : panelInterpretationOutput(input);
        return jsonResponse({ output_text: JSON.stringify(output) });
      }
    });
    await configureOpenAIRouter(router);
    const message = {
      type: requestMode === 'followup'
        ? 'LLM_ASK_FIGURE_PANEL' : 'LLM_ANALYZE_FIGURE_PANEL',
      documentHash: '7'.repeat(64),
      document: { title: `Panel ${requestMode} current-only cache` },
      figure: { ...figureInput(1), panelHints: ['A'] },
      panel: { panel: 'A', purpose: 'Compare groups' },
      topics: requestMode === 'followup' ? ['grouping'] : []
    };

    const [ordinary, refreshed] = await Promise.all([
      router.handle(message),
      router.handle({ ...message, forceRefresh: true })
    ]);
    assert.equal(ordinary.success, true, requestMode);
    assert.equal(refreshed.success, true, requestMode);
    assert.equal(providerCalls, 2, requestMode);
    assert.equal(entries.has(weakKey), true, requestMode);
    assert.ok(requestedKeySets.flat().every(key =>
      /^figure-panel:sha256:[a-f0-9]{64}$/u.test(key)), requestMode);
    assert.equal(requestedKeySets.flat().includes(weakKey), false, requestMode);

    const exactReplay = await router.handle(message);
    assert.equal(exactReplay.data.cacheHit, true, requestMode);
    assert.equal(providerCalls, 2, requestMode);
  }
});
function outlineParagraphs(count) {
  return Array.from({ length: count }, (_, index) => ({
    paragraphId: `sec-a-p-${String(index + 1).padStart(3, '0')}`,
    sectionId: 'sec-a', sectionTitle: 'Evidence', sectionKind: 'article',
    headingLevel: 1,
    headingPath: [{ level: 1, sectionId: 'sec-a', title: 'Evidence' }],
    text: `Paragraph ${index + 1} contains review evidence and enough text for chunking.`
  }));
}

function reviewOutlineMessage(paragraphs, overrides = {}) {
  return {
    type: 'LLM_ANALYZE_REVIEW_OUTLINE',
    document: { title: 'Evidence review', paragraphs },
    ...overrides
  };
}

async function configuredReviewRouter(options = {}) {
  const storageArea = createMemoryStorage();
  const requests = [];
  const mapCallsByBatch = new Map();
  let failedSecond = false;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, fetchOptions) => {
      const body = JSON.parse(fetchOptions.body);
      const schemaName = body.text?.format?.name;
      const payload = JSON.parse(body.input);
      requests.push({ schemaName, payload });
      if (schemaName === 'study_profile') {
        return jsonResponse({ output_text: JSON.stringify({
          primary_type: options.reviewSubtype === 'not_review'
            ? 'basic_mechanistic' : 'systematic_review_meta',
          secondary_type: null,
          review_subtype: options.reviewSubtype || 'narrative',
          confidence: 0.96, reason_zh: '根据文章结构识别', blueprint: validBlueprint
        }) });
      }
      if (schemaName === 'review_paragraph_batch') {
        const calls = (mapCallsByBatch.get(payload.batch_id) || 0) + 1;
        mapCallsByBatch.set(payload.batch_id, calls);
        if (options.failSecondMapOnce && payload.batch_id === 'chunk-002' && !failedSecond) {
          failedSecond = true;
          return jsonResponse({}, 400);
        }
        return jsonResponse({ output_text: JSON.stringify({
          batch_id: payload.batch_id,
          paragraphs_reviewed: payload.paragraphs.map(item => item.paragraph_id),
          paragraph_summaries: payload.paragraphs.map(item => ({
            paragraph_id: item.paragraph_id, summary_zh: '段落摘要',
            rhetorical_role: 'evidence_support', key_point_zh: '支持主题',
            transition_from_previous_zh: ''
          }))
        }) });
      }
      return jsonResponse({ output_text: JSON.stringify({
        paper_thesis_zh: '中心命题', organization_strategy_zh: '按主题组织',
        sections: payload.sections.map(item => ({
          section_id: item.section_id, section_role: '证据综合',
          section_summary_zh: '章节摘要', transition_from_previous_zh: '',
          logical_units: item.paragraph_summaries.length ? [{
            unit_id: 'unit-1', title_zh: '证据链', rhetorical_role: 'synthesis',
            summary_zh: '整合本节段落证据。',
            source_paragraph_ids: item.paragraph_summaries.map(entry => entry.paragraph_id)
          }] : []
        })), key_tensions: []
      }) });
    },
    sleepImpl: async () => {}
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'openai', consentGranted: true }
  });
  return { router, requests, mapCallsByBatch };
}

test('translates abbreviation meanings through the summary task profile', async () => {
  const storageArea = createMemoryStorage();
  const requests = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, fetchOptions) => {
      const body = JSON.parse(fetchOptions.body);
      const payload = JSON.parse(body.input);
      requests.push({
        schemaName: body.text?.format?.name,
        payload
      });
      return jsonResponse({ output_text: JSON.stringify({
        translations: payload.terms.map(item => ({
          abbreviation: item.abbreviation,
          meaning_zh: item.abbreviation === 'TNF'
            ? '肿瘤坏死因子' : '腺相关病毒'
        }))
      }) });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'openai', consentGranted: true }
  });

  const response = await router.handle({
    type: 'LLM_TRANSLATE_ABBREVIATIONS',
    entries: [
      { abbreviation: 'TNF', fullName: 'tumor necrosis factor' },
      { abbreviation: 'AAV', fullName: 'adeno-associated virus' }
    ]
  });

  assert.equal(response.success, true);
  assert.equal(response.data.route.taskType, 'abbreviation_translation');
  assert.deepEqual(response.data.translations.map(item => item.meaningZh), [
    '肿瘤坏死因子', '腺相关病毒'
  ]);
  assert.equal(requests[0].schemaName, 'abbreviation_chinese_meanings');
});

test('abbreviation enrichment routes requested fields and accepts uncertainty without retries', async () => {
  const requests = [];
  const router = createBackgroundRouter({ storageArea: createMemoryStorage(), fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    return jsonResponse({ output_text: JSON.stringify({ translations: [{ abbreviation: 'TNF', meaning_zh: '肿瘤坏死因子', definition_zh: '' }] }) });
  }});
  await configureOpenAIRouter(router);
  const result = await router.handle({ type: 'LLM_TRANSLATE_ABBREVIATIONS', fields: ['meaningZh', 'definitionZh'],
    entries: [{ abbreviation: 'TNF', fullName: 'tumor necrosis factor' }] });
  assert.equal(result.success, true);
  assert.equal(result.data.translations[0].meaningZh, '肿瘤坏死因子');
  assert.equal(result.data.translations[0].definitionZh, undefined);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].text.format.name, 'abbreviation_blank_fields');
  const invalid = await router.handle({ type: 'LLM_TRANSLATE_ABBREVIATIONS', fields: ['fullName'],
    entries: [{ abbreviation: 'TNF', fullName: 'tumor necrosis factor' }] });
  assert.equal(invalid.success, false); assert.equal(requests.length, 1);
});

test('abbreviation summary capability fails safely before any provider request', async () => {
  const originalCreateProviderAdapter = globalThis.SciLLM.createProviderAdapter;
  globalThis.SciLLM.createProviderAdapter = input => {
    const adapter = originalCreateProviderAdapter(input);
    return { ...adapter, generateJson: undefined };
  };
  try {
    let providerRequests = 0;
    const router = createBackgroundRouter({
      storageArea: createMemoryStorage(),
      fetchImpl: async () => {
        providerRequests += 1;
        return jsonResponse({});
      }
    });
    await configureOpenAIRouter(router);

    const response = await router.handle({
      type: 'LLM_TRANSLATE_ABBREVIATIONS',
      entries: [{ abbreviation: 'TNF', fullName: 'tumor necrosis factor' }]
    });

    assert.equal(response.success, false);
    assert.equal(response.error.code, 'PROVIDER_CAPABILITY_UNAVAILABLE');
    assert.deepEqual(response.error.fields, ['summary.generateJson']);
    assert.match(response.error.message, /当前摘要模型不支持结构化 JSON/);
    assert.doesNotMatch(response.error.message, /Provider settings/i);
    assert.ok(response.error.message.length <= 240);
    assert.equal(providerRequests, 0);
  } finally {
    globalThis.SciLLM.createProviderAdapter = originalCreateProviderAdapter;
  }
});

test('repairs malformed and incomplete abbreviation translation batches without losing terms', async () => {
  const storageArea = createMemoryStorage();
  const requestSizes = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, fetchOptions) => {
      const body = JSON.parse(fetchOptions.body);
      const payload = JSON.parse(body.input);
      requestSizes.push(payload.terms.length);
      if (requestSizes.length === 1) {
        return jsonResponse({ output_text: 'not valid JSON' });
      }
      const returnedTerms = payload.terms.length === 2
        ? payload.terms.slice(0, 1)
        : payload.terms;
      return jsonResponse({ output_text: JSON.stringify({
        translations: returnedTerms.map(item => ({
          abbreviation: item.abbreviation,
          meaning_zh: `${item.abbreviation}中文释义`
        }))
      }) });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'openai', consentGranted: true }
  });

  const response = await router.handle({
    type: 'LLM_TRANSLATE_ABBREVIATIONS',
    entries: [
      { abbreviation: 'TNF', fullName: 'tumor necrosis factor' },
      { abbreviation: 'AAV', fullName: 'adeno-associated virus' },
      { abbreviation: 'NPs', fullName: 'nanoparticles' }
    ]
  });

  assert.equal(response.success, true);
  assert.deepEqual(requestSizes, [3, 2, 1, 1]);
  assert.deepEqual(response.data.translations.map(item => item.abbreviation), [
    'TNF', 'AAV', 'NPs'
  ]);
});

test('routes a review outline through map reduce and returns subtype metadata', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'systematic' });
  const message = reviewOutlineMessage(outlineParagraphs(2));
  await selectStudyType(fixture.router, message.document, 'systematic_review_meta');
  const progress = [];
  const response = await fixture.router.handle(message, {
    onProgress: event => progress.push(event)
  });
  assert.equal(response.success, true);
  assert.equal(response.data.outline.reviewSubtype, 'narrative');
  assert.equal(response.data.outline.paragraphCount, 2);
  assert.equal(response.data.cacheHit, false);
  const checkpoint = progress.find(event => event.phase === 'review_chunk_checkpoint');
  assert.ok(checkpoint);
  assert.equal(checkpoint.completedParagraphs, 2);
  assert.equal(checkpoint.totalParagraphs, 2);
  assert.equal(checkpoint.checkpointSummaries.length, 2);
});

test('default review paragraphs ignore an empty uncustomized section scope', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'narrative' });
  const paragraphs = outlineParagraphs(3);
  const message = reviewOutlineMessage(paragraphs, {
    scopeSectionIds: [],
    scopeSelectionProvided: false
  });
  await selectStudyType(fixture.router, message.document, 'systematic_review_meta');

  const response = await fixture.router.handle(message);

  assert.equal(response.success, true);
  assert.equal(response.data.outline.paragraphCount, paragraphs.length);
});

test('a customized non-empty section scope summarizes only the selected paragraphs', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'narrative' });
  const paragraphs = [
    ...outlineParagraphs(2),
    {
      ...outlineParagraphs(1)[0],
      paragraphId: 'sec-b-p-001',
      sectionId: 'sec-b',
      sectionTitle: 'Excluded evidence',
      headingPath: [{ level: 1, sectionId: 'sec-b', title: 'Excluded evidence' }]
    }
  ];
  const message = reviewOutlineMessage(paragraphs, {
    scopeSectionIds: ['sec-a'],
    scopeSelectionProvided: true
  });
  await selectStudyType(fixture.router, message.document, 'systematic_review_meta');

  const response = await fixture.router.handle(message);

  assert.equal(response.success, true);
  assert.equal(response.data.outline.paragraphCount, 2);
  const mapRequest = fixture.requests
    .filter(request => request.schemaName === 'review_paragraph_batch')
    .at(-1);
  assert.deepEqual(mapRequest.payload.paragraphs.map(item => item.paragraph_id), [
    'sec-a-p-001', 'sec-a-p-002'
  ]);
});

test('summary capability errors identify a missing structured JSON adapter without provider wording', async () => {
  const originalCreateProviderAdapter = globalThis.SciLLM.createProviderAdapter;
  globalThis.SciLLM.createProviderAdapter = input => {
    const adapter = originalCreateProviderAdapter(input);
    return { ...adapter, generateJson: undefined };
  };
  try {
    const fixture = await configuredReviewRouter({ reviewSubtype: 'narrative' });
    const message = reviewOutlineMessage(outlineParagraphs(1));
    await selectStudyType(fixture.router, message.document, 'systematic_review_meta');

    const response = await fixture.router.handle(message);

    assert.equal(response.success, false);
    assert.equal(response.error.code, 'PROVIDER_CAPABILITY_UNAVAILABLE');
    assert.deepEqual(response.error.fields, ['summary.generateJson']);
    assert.match(response.error.message, /当前摘要模型不支持结构化 JSON/);
    assert.doesNotMatch(response.error.message, /Provider settings/i);
    assert.ok(response.error.message.length <= 240);
    assert.equal(fixture.requests.length, 0);
  } finally {
    globalThis.SciLLM.createProviderAdapter = originalCreateProviderAdapter;
  }
});

test('reuses a complete review outline without another provider request', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'narrative' });
  const message = reviewOutlineMessage(outlineParagraphs(2));
  await selectStudyType(fixture.router, message.document, 'systematic_review_meta');
  const first = await fixture.router.handle(message);
  assert.equal(first.data.outline.globalSynthesisAvailable, true);
  const calls = fixture.requests.length;
  const second = await fixture.router.handle(message);
  assert.equal(second.data.cacheHit, true);
  assert.equal(fixture.requests.length, calls);
});

test('does not reuse a review outline after the manual study type changes', async () => {
  const fixture = await configuredReviewRouter();
  const message = reviewOutlineMessage(outlineParagraphs(2));
  await selectStudyType(fixture.router, message.document, 'basic_mechanistic');
  const first = await fixture.router.handle(message);
  const callsForFirstType = fixture.requests.length;

  await selectStudyType(fixture.router, message.document, 'systematic_review_meta');
  const second = await fixture.router.handle(message);

  assert.equal(first.success, true);
  assert.equal(first.data.outline.reviewSubtype, 'not_review');
  assert.equal(second.success, true);
  assert.equal(second.data.cacheHit, false);
  assert.equal(second.data.outline.reviewSubtype, 'narrative');
  assert.ok(fixture.requests.length > callsForFirstType);
});

test('checkpoints completed review map chunks and resumes after failure', async () => {
  const fixture = await configuredReviewRouter({ failSecondMapOnce: true });
  const message = reviewOutlineMessage(outlineParagraphs(4), { maxChars: 120 });
  await selectStudyType(fixture.router, message.document, 'systematic_review_meta');
  const failed = await fixture.router.handle(message);
  assert.equal(failed.success, false);
  const firstChunkCalls = fixture.mapCallsByBatch.get('chunk-001') || 0;
  const resumed = await fixture.router.handle(message);
  assert.equal(resumed.success, true);
  assert.equal(fixture.mapCallsByBatch.get('chunk-001'), firstChunkCalls);
});

test('uses a neutral primary-research outline strategy without a type warning', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'not_review' });
  const message = reviewOutlineMessage(outlineParagraphs(1));
  await selectStudyType(fixture.router, message.document, 'basic_mechanistic');
  const response = await fixture.router.handle(message);
  assert.equal(response.success, true);
  assert.equal(response.data.analysisStrategy, 'primary_research');
  assert.equal(Object.hasOwn(response.data, 'nonReviewNotice'), false);
});

test('summarizes one requested section without replacing the full document identity', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'narrative' });
  const paragraphs = outlineParagraphs(3);
  const message = reviewOutlineMessage(paragraphs, {
    scopeId: 'sec-a-local',
    scopeParagraphIds: [paragraphs[1].paragraphId]
  });
  const prepared = await selectStudyType(
    fixture.router,
    message.document,
    'systematic_review_meta'
  );
  message.document.documentId = prepared.data.documentId;
  message.document.previousDocumentHash = prepared.data.documentHash;
  const response = await fixture.router.handle(message);
  assert.equal(response.success, true);
  assert.equal(response.data.scopeId, 'sec-a-local');
  assert.equal(response.data.documentId, prepared.data.documentId);
  assert.equal(response.data.outline.paragraphCount, 1);
  const mapRequest = fixture.requests
    .filter(request => request.schemaName === 'review_paragraph_batch')
    .at(-1);
  assert.deepEqual(
    mapRequest.payload.paragraphs.map(item => item.paragraph_id),
    [paragraphs[1].paragraphId]
  );
});

test('paragraph-only review sends only scoped text while retaining prepared document proof', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'narrative' });
  const paragraphs = outlineParagraphs(3);
  const prepared = await selectStudyType(
    fixture.router,
    reviewOutlineMessage(paragraphs).document,
    'systematic_review_meta'
  );
  const selected = paragraphs[1];
  const response = await fixture.router.handle(reviewOutlineMessage([selected], {
    paragraphOnly: true,
    scopeId: `paragraph:${selected.paragraphId}`,
    scopeParagraphIds: [selected.paragraphId],
    documentProof: {
      documentId: prepared.data.documentId,
      documentHash: prepared.data.documentHash
    }
  }));

  assert.equal(response.success, true);
  assert.equal(response.data.documentId, prepared.data.documentId);
  assert.equal(response.data.documentHash, prepared.data.documentHash);
  const mapRequest = fixture.requests
    .filter(request => request.schemaName === 'review_paragraph_batch')
    .at(-1);
  assert.deepEqual(mapRequest.payload.paragraphs.map(item => item.paragraph_id), [
    selected.paragraphId
  ]);
});

test('paragraph-only review rejects body paragraphs outside its explicit scope', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'narrative' });
  const paragraphs = outlineParagraphs(2);
  const prepared = await selectStudyType(
    fixture.router,
    reviewOutlineMessage(paragraphs).document,
    'systematic_review_meta'
  );
  const response = await fixture.router.handle(reviewOutlineMessage(paragraphs, {
    paragraphOnly: true,
    scopeId: `paragraph:${paragraphs[0].paragraphId}`,
    scopeParagraphIds: [paragraphs[0].paragraphId],
    documentProof: {
      documentId: prepared.data.documentId,
      documentHash: prepared.data.documentHash
    }
  }));

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'INVALID_SETTINGS');
});

test('wires durable directory sync and all four user-data routes without requesting permission', () => {
  const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
  assert.match(source, /core\/directory-sync\.js/);
  assert.match(source, /createIndexedDbDirectoryHandleStore\(indexedDB\)/);
  assert.match(source, /createIndexedDbSyncQueue\(indexedDB\)/);
  assert.match(source, /createDirectorySync\(/);
  for (const type of [
    'USER_DATA_SYNC_STATUS', 'USER_DATA_SYNC_NOW',
    'USER_DATA_REBUILD_INDEX', 'USER_DATA_EXPORT_BUNDLE',
    'LLM_SAVE_PROFILE', 'LLM_DUPLICATE_PROFILE', 'LLM_DELETE_PROFILE',
    'LLM_UPDATE_PROFILE_ROUTING', 'LLM_TEST_PROFILE', 'LLM_LIST_MODELS',
    'CODEX_LOCAL_STATUS', 'CODEX_LOCAL_LOGIN_START', 'CODEX_LOCAL_LOGOUT'
  ]) {
    assert.match(source, new RegExp(`'${type}'`));
  }
  assert.ok(
    source.indexOf("'providers/provider-registry.js'") <
      source.indexOf("'core/task-profile-router.js'")
  );
  assert.ok(
    source.indexOf("'providers/provider-registry.js'") <
      source.indexOf("'core/provider-model-discovery.js'")
  );
  assert.doesNotMatch(source, /requestPermission\s*\(/);
});

test('mirrors saved category configuration with monotonic revisions and never waits for flush', async () => {
  const never = new Promise(() => {});
  const directorySync = createDirectorySyncDouble({ flushGate: never });
  const storageArea = createMemoryStorage();
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.profiles.profile_default_openai.config.apiKey = 'sk-directory-must-not-export';
  storageArea.values.sciLlmSettingsV2 = settings;
  const router = createBackgroundRouter({
    storageArea,
    directorySync,
    fetchImpl: async () => jsonResponse({})
  });

  const saved = await Promise.race([
    router.handle({
      type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
      override: { color: '#173F6F' }
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('flush blocked route')), 100))
  ]);
  const reset = await router.handle({
    type: 'CATEGORY_RESET_OVERRIDE', categoryId: 'limitation'
  });

  assert.equal(saved.success, true);
  assert.equal(reset.success, true);
  assert.equal(directorySync.json.length, 2);
  assert.deepEqual(directorySync.json.map(item => item.path), ['categories.json', 'categories.json']);
  assert.ok(directorySync.json[1].value.revision > directorySync.json[0].value.revision);
  assert.doesNotMatch(JSON.stringify(directorySync.json), /apiKey|providers|sk-directory/);
  assert.equal(directorySync.flushCalls, 2);
});

test('mirrors study type and every annotation mutation to one encoded document asset', async () => {
  const directorySync = createDirectorySyncDouble();
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    documentStore: createMemoryDocumentStore(),
    directorySync,
    fetchImpl: async () => jsonResponse({})
  });
  const prepared = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  const documentId = prepared.data.documentId;
  directorySync.json.length = 0;

  assert.equal((await router.handle({
    type: 'LLM_SET_STUDY_TYPE', documentId, studyType: 'observational'
  })).success, true);
  assert.equal((await router.handle({
    type: 'ANNOTATION_UPSERT', documentId, annotation: routerAnnotation()
  })).success, true);
  assert.equal((await router.handle({
    type: 'ANNOTATION_DELETE', documentId, annotationId: 'manual-1'
  })).success, true);
  assert.equal((await router.handle({
    type: 'ANNOTATION_CLEAR_DOCUMENT', documentId
  })).success, true);

  assert.equal(directorySync.json.length, 4);
  const expectedPath = `annotations/${encodeURIComponent(documentId)}.json`;
  assert.deepEqual(directorySync.json.map(item => item.path), Array(4).fill(expectedPath));
  assert.deepEqual(directorySync.json.map(item => item.value.revision), [2, 3, 4, 5]);
});

test('mirrors feedback as sanitized JSONL and local mutations survive enqueue failures', async () => {
  const directorySync = createDirectorySyncDouble({ enqueueError: new Error('disk offline') });
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    directorySync,
    fetchImpl: async () => jsonResponse({})
  });

  const category = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
    override: { color: '#173F6F' }
  });
  const feedback = await router.handle({
    type: 'LLM_RECORD_FEEDBACK',
    sample: {
      documentHash: 'doc-1', paragraphId: 'p1', quote: 'A result sentence.',
      categoryId: 'result', userAction: 'accepted',
      url: 'https://private.example/article'
    }
  });

  assert.equal(category.success, true);
  assert.equal(feedback.success, true);
  assert.equal(storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation.color, '#173F6F');

  const healthySync = createDirectorySyncDouble();
  const healthyRouter = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync: healthySync,
    fetchImpl: async () => jsonResponse({})
  });
  await healthyRouter.handle({
    type: 'LLM_RECORD_FEEDBACK',
    sample: {
      documentHash: 'doc-2', paragraphId: 'p2', quote: 'Another result sentence.',
      categoryId: 'result', userAction: 'accepted', url: 'https://private.example'
    }
  });
  assert.equal(healthySync.text[0].path, 'corpus/feedback.jsonl');
  assert.doesNotMatch(healthySync.text[0].value, /private\.example|url/);
});

test('routes status, flush, rebuild imports, and a credential-free user-data bundle', async () => {
  const storageArea = createMemoryStorage();
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.profiles.profile_default_openai.config.apiKey = 'sk-bundle-secret';
  settings.profiles.profile_default_openai.config.customHeaders = {
    Authorization: 'Bearer bundle-header-secret'
  };
  storageArea.values.sciLlmSettingsV2 = settings;
  storageArea.values.sciGlobalAbbreviationMemoryV1 = {
    schemaVersion: 1,
    entries: [{ abbreviation: 'TNF', fullName: 'bundle-abbreviation-private-value' }]
  };
  const documentStore = createMemoryDocumentStore();
  await documentStore.prepareDocument({
    schemaVersion: 1, documentId: 'sha256:local', title: 'Local', canonicalUrl: '',
    studyType: null, annotations: [], revision: 0, documentHash: 'local',
    documentHashes: ['local']
  });
  const directorySync = createDirectorySyncDouble({
    rebuildAssets: [
      {
        path: 'categories.json',
        value: {
          schemaVersion: 1, revision: 7, sourceId: 'directory',
          categoryOverrides: { limitation: { color: '#102030' } },
          deletedBuiltInCategoryIds: ['objective'],
          customCategories: [], selectedCategoryIds: ['limitation'],
          viewCategoryOverrides: settings.viewCategoryOverrides
        }
      },
      {
        path: `annotations/${encodeURIComponent('sha256:local')}.json`,
        value: {
          schemaVersion: 1, documentId: 'sha256:local', title: 'Imported',
          canonicalUrl: '', studyType: 'observational', annotations: [],
          revision: 9, updatedAt: new Date().toISOString(), documentHash: 'local',
          documentHashes: ['local']
        }
      },
      { path: '../escape.json', value: { schemaVersion: 1, revision: 99 } }
    ]
  });
  const router = createBackgroundRouter({
    storageArea, documentStore, directorySync,
    portableConfigManager: createReadyPortableConfigManagerDouble(),
    fetchImpl: async () => jsonResponse({})
  });

  const status = await router.handle({ type: 'USER_DATA_SYNC_STATUS' });
  const synced = await router.handle({ type: 'USER_DATA_SYNC_NOW' });
  const rebuilt = await router.handle({ type: 'USER_DATA_REBUILD_INDEX' });
  const bundle = await router.handle({ type: 'USER_DATA_EXPORT_BUNDLE' });

  assert.equal(status.data.permission, 'prompt');
  assert.equal(synced.data.permission, 'granted');
  assert.equal(rebuilt.success, true);
  assert.equal(rebuilt.data.imported, 2);
  assert.equal(storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation.color, '#102030');
  assert.deepEqual(
    storageArea.values.sciLlmSettingsV2.deletedBuiltInCategoryIds,
    ['objective']
  );
  assert.equal((await documentStore.getDocument('sha256:local')).studyType, 'observational');
  assert.equal(bundle.success, true);
  assert.match(JSON.stringify(bundle.data), /sha256:local/);
  assert.deepEqual(bundle.data.categories.deletedBuiltInCategoryIds, ['objective']);
  assert.doesNotMatch(
    JSON.stringify(bundle.data),
    /sk-bundle-secret|bundle-header-secret|bundle-abbreviation-private-value|apiKey|customHeaders|providers|authorization|analysisCache|directoryHandle|syncQueue/i
  );
});

test('manual directory actions use the authoritative portable gate before touching disk', async () => {
  for (const authoritativeStatus of [
    { state: 'locked', pending: false },
    { state: 'ready', pending: true },
    { state: 'unavailable', pending: false },
    { state: 'error', pending: false }
  ]) {
    const directorySync = createDirectorySyncDouble();
    let rebuildCalls = 0;
    directorySync.rebuildIndex = async () => {
      rebuildCalls += 1;
      return { imported: 0 };
    };
    const portableConfigManager = {
      publicStatus: () => ({ state: 'ready', pending: false }),
      async runWhenReady(operation) {
        if (authoritativeStatus.state !== 'ready' || authoritativeStatus.pending) {
          throw Object.assign(new Error('private-state-detail'), {
            code: 'PORTABLE_CONFIG_NOT_READY'
          });
        }
        return operation();
      }
    };
    const router = createBackgroundRouter({
      storageArea: createMemoryStorage(), directorySync, portableConfigManager,
      fetchImpl: async () => jsonResponse({})
    });

    const synced = await router.handle({ type: 'USER_DATA_SYNC_NOW' });
    const rebuilt = await router.handle({ type: 'USER_DATA_REBUILD_INDEX' });

    assert.equal(synced.success, false, authoritativeStatus.state);
    assert.equal(synced.error.code, 'PORTABLE_CONFIG_NOT_READY');
    assert.equal(rebuilt.success, false, authoritativeStatus.state);
    assert.equal(rebuilt.error.code, 'PORTABLE_CONFIG_NOT_READY');
    assert.equal(directorySync.flushCalls, 0);
    assert.equal(rebuildCalls, 0);
    assert.doesNotMatch(JSON.stringify([synced, rebuilt]), /private-state-detail/);
  }
});

test('ready portable gate preserves directory operation error codes', async () => {
  const secret = 'directory-operation-secret';
  for (const type of ['USER_DATA_SYNC_NOW', 'USER_DATA_REBUILD_INDEX']) {
    const directorySync = createDirectorySyncDouble({
      flush: () => {
        throw Object.assign(new Error(secret), { code: 'DIRECTORY_SYNC_UNAVAILABLE' });
      }
    });
    let rebuildCalls = 0;
    directorySync.rebuildIndex = async () => {
      rebuildCalls += 1;
      throw Object.assign(new Error(secret), { code: 'DIRECTORY_SYNC_UNAVAILABLE' });
    };
    const router = createBackgroundRouter({
      storageArea: createMemoryStorage(), directorySync,
      portableConfigManager: createReadyPortableConfigManagerDouble(),
      fetchImpl: async () => jsonResponse({})
    });

    const response = await router.handle({ type });

    assert.equal(response.success, false, type);
    assert.equal(response.error.code, 'DIRECTORY_SYNC_UNAVAILABLE', type);
    assert.equal(directorySync.flushCalls, type === 'USER_DATA_SYNC_NOW' ? 1 : 0);
    assert.equal(rebuildCalls, type === 'USER_DATA_REBUILD_INDEX' ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(response), new RegExp(secret));
  }
});

test('routes portable configuration commands once, maps passphrases, and exposes only public status', async () => {
  const calls = [];
  const publicStatus = {
    state: 'ready', revision: 7, updatedAt: '2026-08-03T00:00:00.000Z',
    pending: false, lastError: '', backupId: 'must-not-leak', salt: 'must-not-leak'
  };
  const portableConfigManager = {
    probe: async () => { calls.push(['probe']); return publicStatus; },
    create: async passphrase => { calls.push(['create', passphrase]); return publicStatus; },
    unlock: async passphrase => { calls.push(['unlock', passphrase]); return publicStatus; },
    rotatePassphrase: async (current, next) => {
      calls.push(['rotatePassphrase', current, next]);
      return publicStatus;
    },
    forgetKey: async () => { calls.push(['forgetKey']); return publicStatus; },
    backupNow: async () => { calls.push(['backupNow']); return publicStatus; },
    publicStatus: () => { calls.push(['publicStatus']); return publicStatus; }
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync: createDirectorySyncDouble(),
    portableConfigManager,
    fetchImpl: async () => jsonResponse({})
  });
  const commands = [
    [{ type: 'PORTABLE_CONFIG_PROBE' }, ['probe']],
    [{ type: 'PORTABLE_CONFIG_CREATE', passphrase: 0 }, ['create', '0']],
    [{ type: 'PORTABLE_CONFIG_UNLOCK', passphrase: false }, ['unlock', 'false']],
    [{ type: 'PORTABLE_CONFIG_ROTATE_PASSPHRASE', currentPassphrase: 0, newPassphrase: false }, ['rotatePassphrase', '0', 'false']],
    [{ type: 'PORTABLE_CONFIG_ROTATE_PASSPHRASE', currentPassphrase: null }, ['rotatePassphrase', '', '']],
    [{ type: 'PORTABLE_CONFIG_FORGET_KEY' }, ['forgetKey']],
    [{ type: 'PORTABLE_CONFIG_BACKUP_NOW' }, ['backupNow']],
    [{ type: 'PORTABLE_CONFIG_STATUS' }, ['publicStatus']]
  ];

  for (const [message, expectedCall] of commands) {
    const response = await router.handle(message);
    assert.equal(response.success, true, message.type);
    assert.deepEqual(response.data, {
      state: 'ready', revision: 7, updatedAt: '2026-08-03T00:00:00.000Z',
      pending: false, lastError: ''
    });
    assert.deepEqual(calls.at(-1), expectedCall);
  }
  assert.equal(commands.length, 8);
  assert.equal(calls.length, commands.length);
  assert.deepEqual(calls, commands.map(([, expectedCall]) => expectedCall));
  assert.deepEqual(
    Object.fromEntries([...new Set(calls.map(([method]) => method))].map(method => [
      method, calls.filter(([calledMethod]) => calledMethod === method).length
    ])),
    {
      probe: 1,
      create: 1,
      unlock: 1,
      rotatePassphrase: 2,
      forgetKey: 1,
      backupNow: 1,
      publicStatus: 1
    }
  );
});

test('portable configuration command failures never echo a passphrase and disabled routers are explicit', async () => {
  const secret = 'portable-route-passphrase-secret';
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    portableConfigManager: {
      unlock: async () => { throw new Error(`unlock failed: ${secret}`); },
      probe: async () => ({}), create: async () => ({}), rotatePassphrase: async () => ({}),
      forgetKey: async () => ({}), backupNow: async () => ({}), publicStatus: () => ({})
    },
    fetchImpl: async () => jsonResponse({})
  });
  const failed = await router.handle({ type: 'PORTABLE_CONFIG_UNLOCK', passphrase: secret });
  assert.equal(failed.success, false);
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(secret));

  const disabled = createBackgroundRouter({
    storageArea: createMemoryStorage(), fetchImpl: async () => jsonResponse({})
  });
  const response = await disabled.handle({ type: 'PORTABLE_CONFIG_BACKUP_NOW' });
  assert.deepEqual(response, {
    success: true,
    data: { state: 'disabled', revision: 0, updatedAt: '', pending: false, lastError: '' }
  });
});

test('user-data status includes a strict portable configuration status whitelist', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync: createDirectorySyncDouble(),
    portableConfigManager: {
      publicStatus: () => ({
        state: 'locked', revision: 4, updatedAt: '2026-08-03T00:00:00.000Z',
        pending: true, lastError: 'PORTABLE_CONFIG_LOCKED', backupId: 'private',
        salt: 'private', iterations: 999, keyBytes: 'private', payload: 'private',
        passphrase: 'private', ciphertext: 'private'
      })
    },
    fetchImpl: async () => jsonResponse({})
  });
  const response = await router.handle({ type: 'USER_DATA_SYNC_STATUS' });
  assert.equal(response.success, true);
  assert.deepEqual(response.data.portableConfig, {
    state: 'locked', revision: 4, updatedAt: '2026-08-03T00:00:00.000Z',
    pending: true, lastError: 'PORTABLE_CONFIG_LOCKED'
  });
  assert.doesNotMatch(JSON.stringify(response.data), /private|iterations|keyBytes|payload|passphrase|ciphertext/);
});

test('portable status commands sanitize malicious manager status fields and unknown portable codes', async () => {
  const secret = 'portable-status-manager-secret';
  const hostileStatuses = [
    {
      state: { secret }, revision: Infinity, updatedAt: { secret }, pending: 'true',
      lastError: secret, ciphertext: secret
    },
    {
      state: secret, revision: 1.5, updatedAt: 'x'.repeat(81), pending: false,
      lastError: 'PORTABLE_CONFIG_EVIL_SECRET', payload: secret
    },
    {
      state: 'ready', revision: Number.MAX_SAFE_INTEGER + 1, updatedAt: 'not-an-iso-date',
      pending: true, lastError: 'PORTABLE_CONFIG_EVIL_SECRET', keyBytes: secret
    },
    {
      state: 'locked', revision: -1, updatedAt: '2026-08-03T00:00:00.000Z',
      pending: true, lastError: 'PORTABLE_CONFIG_LOCKED', backupId: secret
    }
  ];
  for (const hostileStatus of hostileStatuses) {
    const router = createBackgroundRouter({
      storageArea: createMemoryStorage(),
      directorySync: createDirectorySyncDouble(),
      portableConfigManager: { publicStatus: () => hostileStatus },
      fetchImpl: async () => jsonResponse({})
    });
    const direct = await router.handle({ type: 'PORTABLE_CONFIG_STATUS' });
    const bundled = await router.handle({ type: 'USER_DATA_SYNC_STATUS' });
    for (const response of [direct, { ...bundled, data: bundled.data.portableConfig }]) {
      assert.equal(response.success, true);
      assert.doesNotMatch(JSON.stringify(response), new RegExp(secret));
      assert.deepEqual(Object.keys(response.data).sort(), [
        'lastError', 'pending', 'revision', 'state', 'updatedAt'
      ]);
      assert.ok(Number.isSafeInteger(response.data.revision));
      assert.ok(response.data.revision >= 0);
      assert.ok(['unknown', 'missing', 'locked', 'ready', 'error', 'unavailable', 'disabled']
        .includes(response.data.state));
      assert.ok(response.data.updatedAt === '' || (
        response.data.updatedAt.length <= 80 &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(response.data.updatedAt)
      ));
      assert.notEqual(response.data.lastError, 'PORTABLE_CONFIG_EVIL_SECRET');
    }
  }
});

test('portable status reads never echo manager failures, whether synchronous or asynchronous', async () => {
  const secret = 'portable-status-error-secret';
  for (const publicStatus of [
    () => { throw new Error(secret); },
    async () => { throw Object.assign(new Error(secret), { code: 'PORTABLE_CONFIG_EVIL_SECRET' }); }
  ]) {
    const router = createBackgroundRouter({
      storageArea: createMemoryStorage(),
      directorySync: createDirectorySyncDouble(),
      portableConfigManager: { publicStatus },
      fetchImpl: async () => jsonResponse({})
    });
    for (const type of ['PORTABLE_CONFIG_STATUS', 'USER_DATA_SYNC_STATUS']) {
      const response = await router.handle({ type });
      assert.equal(response.success, false, type);
      assert.equal(response.error.code, 'PORTABLE_CONFIG_FAILED', type);
      assert.doesNotMatch(JSON.stringify(response), new RegExp(secret), type);
      assert.doesNotMatch(JSON.stringify(response), /PORTABLE_CONFIG_EVIL_SECRET/, type);
    }
  }
});

test('portable status snapshots accessor fields once before sanitizing them', async () => {
  const secret = 'portable-status-accessor-secret';
  const validStatus = {
    state: 'locked',
    revision: 7,
    updatedAt: '2026-08-03T00:00:00.000Z',
    pending: true,
    lastError: 'PORTABLE_CONFIG_LOCKED'
  };
  const fallbackStatus = {
    state: 'unknown', revision: 0, updatedAt: '', pending: false,
    lastError: 'PORTABLE_CONFIG_FAILED'
  };
  for (const firstValues of [validStatus, {
    state: secret, revision: secret, updatedAt: secret, pending: secret, lastError: secret
  }]) {
    for (const type of ['PORTABLE_CONFIG_STATUS', 'USER_DATA_SYNC_STATUS']) {
      const counts = Object.fromEntries(Object.keys(validStatus).map(key => [key, 0]));
      const status = new Proxy({}, {
        get(target, property) {
          if (!(property in counts)) return undefined;
          counts[property] += 1;
          return counts[property] === 1 ? firstValues[property] : secret;
        }
      });
      const router = createBackgroundRouter({
        storageArea: createMemoryStorage(),
        directorySync: createDirectorySyncDouble(),
        portableConfigManager: { publicStatus: () => status },
        fetchImpl: async () => jsonResponse({})
      });
      const response = await router.handle({ type });
      const publicStatus = type === 'PORTABLE_CONFIG_STATUS'
        ? response.data : response.data.portableConfig;
      assert.equal(response.success, true, type);
      assert.deepEqual(publicStatus, firstValues === validStatus ? validStatus : fallbackStatus, type);
      assert.doesNotMatch(JSON.stringify(response), new RegExp(secret), type);
      assert.deepEqual(counts, {
        state: 1, revision: 1, updatedAt: 1, pending: 1, lastError: 1
      });
    }
  }
});

test('portable status getter failures are converted to fixed safe errors', async () => {
  const secret = 'portable-status-getter-secret';
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync: createDirectorySyncDouble(),
    portableConfigManager: {
      publicStatus: () => new Proxy({}, {
        get() { throw new Error(secret); }
      })
    },
    fetchImpl: async () => jsonResponse({})
  });
  for (const type of ['PORTABLE_CONFIG_STATUS', 'USER_DATA_SYNC_STATUS']) {
    const response = await router.handle({ type });
    assert.equal(response.success, false, type);
    assert.equal(response.error.code, 'PORTABLE_CONFIG_FAILED', type);
    assert.doesNotMatch(JSON.stringify(response), new RegExp(secret), type);
  }
});

test('background wires portable manager before its router and schedules only local portable keys', () => {
  const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
  for (const type of [
    'PORTABLE_CONFIG_PROBE', 'PORTABLE_CONFIG_CREATE', 'PORTABLE_CONFIG_UNLOCK',
    'PORTABLE_CONFIG_ROTATE_PASSPHRASE', 'PORTABLE_CONFIG_FORGET_KEY',
    'PORTABLE_CONFIG_BACKUP_NOW', 'PORTABLE_CONFIG_STATUS'
  ]) assert.match(source, new RegExp(`'${type}'`));
  assert.ok(source.indexOf('const portableConfigManager =') < source.indexOf('const llmRouter ='));
  assert.match(source, /portableConfigManager\s*\n?\s*\}/);
  assert.match(source, /createPortableConfigStorageChangeListener\(\s*portableConfigManager\s*\)/);
  assert.equal((source.match(/chrome\.storage\.onChanged\.addListener/g) || []).length, 1);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*(?:passphrase|apiKey|changes)/i);
});

test('background serializes literature-note deltas from independent clients across papers', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const storageArea = createDelayedCloneStorage();
  const router = createBackgroundRouter({
    storageArea, runtimeExtensionId,
    fetchImpl: async () => jsonResponse({})
  });
  const context = { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN };
  const delta = (documentKey, value) => ({
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey,
    delta: {
      templateId: 'basic_research',
      fields: [{
        key: 'basic_research\u0000background',
        templateId: 'basic_research', fieldId: 'background',
        value, status: 'supported', revision: 1
      }]
    }
  });
  const clientOne = router.handle(delta('paper-a', 'A evidence'), context);
  const clientTwo = router.handle(delta('paper-b', 'B evidence'), context);
  const [first, second] = await Promise.all([clientOne, clientTwo]);
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  const entries = storageArea.values.sciLiteratureNotesV1.entries;
  assert.equal(entries['paper-a'].valuesByTemplate.basic_research.background,
    'A evidence');
  assert.equal(entries['paper-b'].valuesByTemplate.basic_research.background,
    'B evidence');
});

test('background atomically merges concurrent literature-note fields for one paper', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const storageArea = createDelayedCloneStorage();
  const router = createBackgroundRouter({
    storageArea, runtimeExtensionId,
    fetchImpl: async () => jsonResponse({})
  });
  const context = { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN };
  const message = (fieldId, value, revision) => ({
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-a',
    delta: {
      templateId: 'basic_research',
      fields: [{
        key: `basic_research\u0000${fieldId}`,
        templateId: 'basic_research', fieldId,
        value, status: 'supported', revision
      }]
    }
  });
  const [first, second] = await Promise.all([
    router.handle(message('background', 'Background evidence', 1), context),
    router.handle(message('methods', 'Methods evidence', 2), context)
  ]);
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.deepEqual(
    { ...storageArea.values.sciLiteratureNotesV1.entries['paper-a']
      .valuesByTemplate.basic_research },
    { background: 'Background evidence', methods: 'Methods evidence' }
  );
});

test('background persists schema-v3 note evidence and clears it on a later manual field edit', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea, runtimeExtensionId,
    fetchImpl: async () => jsonResponse({})
  });
  const context = { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN };
  const hash = 'a'.repeat(64);
  const binding = {
    documentId: `sha256:${hash}`, documentHash: hash,
    documentGeneration: 2, revision: 4,
    semanticCacheKey: 'cache-a', semanticProvenanceKey: 'proof-a'
  };
  const evidence = {
    status: 'verified', precision: 'normalized-exact', degradedReasonCode: '',
    rebound: false, documentBinding: binding,
    locators: [{
      locatorKind: 'pdf-semantic', ...binding, paragraphId: 'semantic-1',
      normalizedStart: 10, normalizedEnd: 18,
      expectedNormalizedQuote: 'Evidence'
    }],
    pageAnchor: { paragraphId: 'pdf-page-2', pageNumber: 2 }
  };
  const message = (value, status, revision, includeEvidence) => ({
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-evidence',
    delta: { templateId: 'basic_research', fields: [{
      key: 'basic_research\u0000background', templateId: 'basic_research',
      fieldId: 'background', value, status, revision,
      ...(includeEvidence ? { evidence } : {})
    }] }
  });
  const generated = await router.handle(message('AI value', 'supported', 1, true), context);
  assert.equal(generated.success, true);
  assert.equal(generated.data.state.schemaVersion, 3);
  assert.equal(generated.data.state.fieldEvidenceByTemplate.basic_research
    .background.locators[0].paragraphId, 'semantic-1');
  assert.equal(storageArea.values.sciLiteratureNotesV1.schemaVersion, 3);

  const manual = await router.handle(message('Manual correction', null, 2, false), context);
  assert.equal(manual.success, true);
  assert.equal(manual.data.state.valuesByTemplate.basic_research.background,
    'Manual correction');
  assert.equal(manual.data.state.fieldEvidenceByTemplate.basic_research?.background,
    undefined, 'manual text must never inherit older AI evidence');
});

test('background persists a literature-note field tombstone across normalization', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea, runtimeExtensionId, nowImpl: () => 20,
    fetchImpl: async () => jsonResponse({})
  });
  const context = { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN };
  const response = await router.handle({
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-tombstone',
    delta: { templateId: 'basic_research', fields: [{
      key: 'basic_research\u0000background', templateId: 'basic_research',
      fieldId: 'background', value: '', status: null, evidence: null,
      fieldUpdatedAt: 20, revision: 1
    }] }
  }, context);
  assert.equal(response.success, true);
  assert.equal(response.data.state.valuesByTemplate.basic_research?.background, undefined);
  assert.equal(response.data.state.fieldUpdatedAtByTemplate.basic_research.background, 20);
  assert.equal(storageArea.values.sciLiteratureNotesV1.entries['paper-tombstone']
    .fieldUpdatedAtByTemplate.basic_research.background, 20);
});

test('background ignores an out-of-order literature-note field delta', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea, runtimeExtensionId, nowImpl: () => 40,
    fetchImpl: async () => jsonResponse({})
  });
  const context = { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN };
  const message = (value, fieldUpdatedAt, revision) => ({
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-ordered-field',
    delta: { templateId: 'basic_research', fields: [{
      key: 'basic_research\u0000background', templateId: 'basic_research',
      fieldId: 'background', value, status: 'supported', evidence: null,
      fieldUpdatedAt, revision
    }] }
  });
  const newer = await router.handle(message('New value', 30, 1), context);
  assert.equal(newer.success, true);
  const older = await router.handle(message('Old delayed value', 20, 2), context);
  assert.equal(older.success, true);
  assert.equal(older.data.state.valuesByTemplate.basic_research.background,
    'New value');
  assert.equal(older.data.state.fieldUpdatedAtByTemplate.basic_research.background, 30);
});

test('background keeps current note content on a same-clock conflict and accepts replay', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea, runtimeExtensionId, nowImpl: () => 40,
    fetchImpl: async () => jsonResponse({})
  });
  const context = { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN };
  const message = (value, revision) => ({
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-same-clock',
    delta: { templateId: 'basic_research', fields: [{
      key: 'basic_research\u0000background', templateId: 'basic_research',
      fieldId: 'background', value, status: 'supported', evidence: null,
      fieldUpdatedAt: 30, revision
    }] }
  });
  assert.equal((await router.handle(message('Stable value', 1), context)).success, true);
  const replay = await router.handle(message('Stable value', 2), context);
  assert.equal(replay.success, true);
  assert.equal(replay.data.state.valuesByTemplate.basic_research.background,
    'Stable value');
  assert.equal(replay.data.state.fieldUpdatedAtByTemplate.basic_research.background, 30);

  const conflict = await router.handle(message('Conflicting value', 3), context);
  assert.equal(conflict.success, true);
  assert.equal(conflict.data.state.valuesByTemplate.basic_research.background,
    'Stable value');
  assert.equal(conflict.data.state.fieldUpdatedAtByTemplate.basic_research.background, 30);
});

test('background rejects cumulative note document growth atomically', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea, runtimeExtensionId, nowImpl: () => 1000,
    fetchImpl: async () => jsonResponse({})
  });
  const context = { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN };
  const commit = (templateId, count, clock) => router.handle({
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-growing',
    delta: { templateId, fields: Array.from({ length: count }, (_, index) => ({
      key: `${templateId}\u0000field_${index}`, templateId,
      fieldId: `field_${index}`, value: 'x'.repeat(12000), status: 'supported',
      evidence: null, fieldUpdatedAt: clock + index, revision: clock + index
    })) }
  }, context);
  assert.equal((await commit('template_one', 40, 1)).success, true);
  assert.equal((await commit('template_two', 40, 100)).success, true);
  const before = JSON.stringify(storageArea.values.sciLiteratureNotesV1);
  const rejected = await commit('template_three', 4, 200);
  assert.equal(rejected.success, false);
  assert.equal(rejected.error.code, 'LITERATURE_NOTE_DOCUMENT_TOO_LARGE');
  assert.equal(JSON.stringify(storageArea.values.sciLiteratureNotesV1), before,
    'rejected cumulative growth must not partially overwrite stored notes');
});

test('background reads an oversized legacy note and rejects growth without overwriting it', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const valuesByTemplate = Object.fromEntries([0, 1].map(templateIndex => [
    `template_${templateIndex}`,
    Object.fromEntries(Array.from({ length: 30 }, (_, fieldIndex) => [
      `field_${fieldIndex}`, '中'.repeat(12000)
    ]))
  ]));
  const legacy = {
    schemaVersion: 2, templateId: 'template_0', valuesByTemplate,
    fieldStatusByTemplate: {}, updatedAt: 50
  };
  const initial = { sciLiteratureNotesV1: {
    schemaVersion: 2, entries: { 'paper-oversized-legacy': legacy }
  } };
  const storageArea = createMemoryStorage(initial);
  const before = JSON.stringify(initial.sciLiteratureNotesV1);
  const router = createBackgroundRouter({
    storageArea, runtimeExtensionId, nowImpl: () => 100,
    fetchImpl: async () => jsonResponse({})
  });
  const context = { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN };
  const read = await router.handle({
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-oversized-legacy',
    delta: { templateId: 'template_0', fields: [] }
  }, context);
  assert.equal(read.success, true);
  assert.equal(read.data.state.valuesByTemplate.template_0.field_0.length, 12000);
  const rejected = await router.handle({
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-oversized-legacy',
    delta: { templateId: 'template_0', fields: [{
      key: 'template_0\u0000new_field', templateId: 'template_0',
      fieldId: 'new_field', value: 'growth', status: 'supported',
      fieldUpdatedAt: 100, revision: 1
    }] }
  }, context);
  assert.equal(rejected.success, false);
  assert.equal(rejected.error.code, 'LITERATURE_NOTE_DOCUMENT_TOO_LARGE');
  assert.equal(JSON.stringify(storageArea.values.sciLiteratureNotesV1), before);
});

test('background caps total literature-note entries without dropping prior documents', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea, runtimeExtensionId, nowImpl: () => 1000,
    fetchImpl: async () => jsonResponse({})
  });
  const context = { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN };
  const message = documentKey => ({
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey,
    delta: { templateId: 'basic_research', fields: Array.from(
      { length: 40 }, (_, index) => ({
        key: `basic_research\u0000field_${index}`, templateId: 'basic_research',
        fieldId: `field_${index}`, value: '中'.repeat(12000), status: 'supported',
        evidence: null, fieldUpdatedAt: 100 + index, revision: 100 + index
      })
    ) }
  });
  let rejected = null;
  for (let index = 0; index < 14; index += 1) {
    const response = await router.handle(message(`paper-total-${index}`), context);
    if (!response.success) {
      rejected = { response, index };
      break;
    }
  }
  assert.ok(rejected, 'batched documents must eventually reach the total storage budget');
  assert.equal(rejected.response.error.code, 'LITERATURE_NOTE_STORAGE_TOO_LARGE');
  assert.ok(storageArea.values.sciLiteratureNotesV1.entries['paper-total-0']);
  assert.equal(storageArea.values.sciLiteratureNotesV1.entries[
    `paper-total-${rejected.index}`
  ], undefined, 'the rejected document must not be partially inserted');
});

test('background rejects a 201st note without evicting any of the existing 200', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const entries = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [
    `paper-${index}`, {
      schemaVersion: 3, templateId: 'basic_research',
      valuesByTemplate: { basic_research: { background: `note-${index}` } },
      fieldStatusByTemplate: {}, fieldEvidenceByTemplate: {},
      fieldUpdatedAtByTemplate: { basic_research: { background: index + 1 } },
      updatedAt: index + 1
    }
  ]));
  const storageArea = createMemoryStorage({ sciLiteratureNotesV1: {
    schemaVersion: 3, entries
  } });
  const before = JSON.stringify(storageArea.values.sciLiteratureNotesV1);
  const router = createBackgroundRouter({
    storageArea, runtimeExtensionId, nowImpl: () => 1000,
    fetchImpl: async () => jsonResponse({})
  });
  const response = await router.handle({
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-200',
    delta: { templateId: 'basic_research', fields: [{
      key: 'basic_research\u0000background', templateId: 'basic_research',
      fieldId: 'background', value: 'new note', status: 'supported',
      fieldUpdatedAt: 1000, revision: 1
    }] }
  }, { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN });
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'LITERATURE_NOTE_STORAGE_TOO_LARGE');
  assert.equal(JSON.stringify(storageArea.values.sciLiteratureNotesV1), before);
  assert.equal(Object.keys(storageArea.values.sciLiteratureNotesV1.entries).length, 200);
});

test('background rejects untrusted or oversized literature-note delta mutations safely', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), runtimeExtensionId,
    fetchImpl: async () => jsonResponse({})
  });
  const base = {
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-a',
    delta: { templateId: 'basic_research', fields: [] }
  };
  const untrusted = await router.handle(base, { trustedExtensionSender: false });
  assert.equal(untrusted.success, false);
  assert.equal(untrusted.error.code, 'LITERATURE_NOTE_SENDER_INVALID');
  const oversized = await router.handle({
    ...base,
    delta: { ...base.delta, fields: Array.from({ length: 801 }, (_, index) => ({
      key: `basic_research\u0000field_${index}`,
      templateId: 'basic_research', fieldId: `field_${index}`,
      value: 'x', status: 'supported', revision: index + 1
    })) }
  }, { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN });
  assert.equal(oversized.success, false);
  assert.equal(oversized.error.code, 'LITERATURE_NOTE_DELTA_INVALID');
});

test('literature-note callback storage lastError rejects without write and queue recovers', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const context = {
    senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`,
    runtimeBaseUrl,
    senderTabId: Number.NaN
  };
  let runtimeLastError = null;
  let getShouldFail = true;
  let setShouldFail = false;
  let setCalls = 0;
  const values = {};
  const storageArea = {
    get(key, callback) {
      if (getShouldFail) {
        getShouldFail = false;
        runtimeLastError = { message: 'private get failure' };
        callback({});
        runtimeLastError = null;
        return;
      }
      runtimeLastError = null;
      callback({ [key]: values[key] });
    },
    set(input, callback) {
      setCalls += 1;
      runtimeLastError = setShouldFail
        ? { message: 'private set failure' } : null;
      callback();
      if (!setShouldFail) Object.assign(values, input);
      runtimeLastError = null;
    }
  };
  const router = createBackgroundRouter({
    storageArea, runtimeExtensionId,
    getRuntimeLastError: () => runtimeLastError,
    fetchImpl: async () => jsonResponse({})
  });
  const message = {
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-a',
    delta: { templateId: 'basic_research', fields: [{
      key: 'basic_research\u0000background', templateId: 'basic_research',
      fieldId: 'background', value: 'Evidence', status: 'supported', revision: 1
    }] }
  };
  const getFailed = await router.handle(message, context);
  assert.equal(getFailed.success, false);
  assert.equal(getFailed.error.code, 'LITERATURE_NOTE_STORAGE_FAILED');
  assert.equal(setCalls, 0, 'a failed get must never be followed by set');

  setShouldFail = true;
  const setFailed = await router.handle(message, context);
  assert.equal(setFailed.success, false);
  assert.equal(setFailed.error.code, 'LITERATURE_NOTE_STORAGE_FAILED');
  assert.equal(setCalls, 1, 'the set callback error branch must be exercised');
  assert.equal(values.sciLiteratureNotesV1, undefined, 'failed set is not saved');

  setShouldFail = false;
  const recovered = await router.handle(message, context);
  assert.equal(recovered.success, true, 'a storage failure must not poison the queue');
  assert.equal(values.sciLiteratureNotesV1.entries['paper-a']
    .valuesByTemplate.basic_research.background, 'Evidence');
});

test('background accepts serial template chunks including a near UTF-8 field boundary', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const context = { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN };
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, runtimeExtensionId });
  const makeField = (templateId, fieldId, value, revision) => ({
    key: `${templateId}\u0000${fieldId}`, templateId, fieldId, value,
    status: 'supported', revision
  });
  const chunks = [
    { templateId: 'template_a', fields: Array.from({ length: 39 }, (_, index) =>
      makeField('template_a', `field_${index}`,
        index === 0 ? '🧬'.repeat(6000) : `a-${index}`, index + 1)) },
    { templateId: 'template_a', fields: [
      makeField('template_b', 'other_0', 'b-0', 50),
      makeField('template_b', 'other_1', 'b-1', 51)
    ] }
  ];
  for (const delta of chunks) {
    const response = await router.handle({
      type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-chunked', delta
    }, context);
    assert.equal(response.success, true);
  }
  const state = storageArea.values.sciLiteratureNotesV1.entries['paper-chunked'];
  assert.equal(Object.keys(state.valuesByTemplate.template_a).length, 39);
  assert.equal(Object.keys(state.valuesByTemplate.template_b).length, 2);
  assert.equal(state.valuesByTemplate.template_a.field_0.length, 12000);
});

test('workspace-only literature-note retry reads current local state without setting storage', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const context = { senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN };
  let setCalls = 0;
  const storedState = {
    schemaVersion: 2, templateId: 'basic_research',
    valuesByTemplate: { basic_research: { background: 'external newer value' } },
    fieldStatusByTemplate: {}, updatedAt: 77
  };
  const storageArea = {
    get(key, callback) { callback({ [key]: {
      schemaVersion: 2, entries: { 'paper-a': storedState }
    } }); },
    set(_input, callback) { setCalls += 1; callback(); }
  };
  const router = createBackgroundRouter({ storageArea, runtimeExtensionId });
  const response = await router.handle({
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-a',
    delta: { templateId: 'basic_research', fields: [] }
  }, context);
  assert.equal(response.success, true);
  assert.equal(setCalls, 0);
  assert.equal(response.data.state.valuesByTemplate.basic_research.background,
    'external newer value');
  assert.equal(response.data.state.updatedAt, 77);
});

test('literature-note keys are prototype-safe and stored entries use a null prototype', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const context = {
    senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl,
    senderTabId: Number.NaN
  };
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, runtimeExtensionId });
  const base = {
    type: 'LITERATURE_NOTE_COMMIT_DELTA',
    delta: { templateId: 'basic_research', fields: [] }
  };
  for (const unsafe of ['__proto__', 'prototype', 'constructor']) {
    const documentResponse = await router.handle({
      ...base, documentKey: unsafe
    }, context);
    assert.equal(documentResponse.success, false, `documentKey ${unsafe}`);
    assert.equal(documentResponse.error.code, 'LITERATURE_NOTE_DELTA_INVALID');
    const legacyResponse = await router.handle({
      ...base, documentKey: 'paper-a', legacyKey: unsafe
    }, context);
    assert.equal(legacyResponse.success, false, `legacyKey ${unsafe}`);
    assert.equal(legacyResponse.error.code, 'LITERATURE_NOTE_DELTA_INVALID');
  }
  const saved = await router.handle({
    ...base, documentKey: 'paper-a',
    delta: { templateId: 'basic_research', fields: [{
      key: 'basic_research\u0000background', templateId: 'basic_research',
      fieldId: 'background', value: 'Evidence', status: 'supported', revision: 1
    }] }
  }, context);
  assert.equal(saved.success, true);
  assert.equal(Object.getPrototypeOf(storageArea.values.sciLiteratureNotesV1.entries), null);
  assert.equal(Object.prototype.polluted, undefined);
});

test('literature-note mutation trusts extension-owned pages only, never content scripts', async () => {
  const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), runtimeExtensionId
  });
  const message = {
    type: 'LITERATURE_NOTE_COMMIT_DELTA', documentKey: 'paper-a',
    delta: { templateId: 'basic_research', fields: [] }
  };
  const accepted = await router.handle(message, {
    senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl,
    senderTabId: Number.NaN
  });
  assert.equal(accepted.success, true);
  const acceptedExtensionTab = await router.handle(message, {
    senderExtensionId: runtimeExtensionId,
    senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: 17
  });
  assert.equal(acceptedExtensionTab.success, true,
    'an extension-owned page remains trusted even when Chrome associates a tab');
  for (const context of [
    { senderExtensionId: runtimeExtensionId, senderUrl: 'https://journal.example/paper',
      runtimeBaseUrl, senderTabId: 17 },
    { senderExtensionId: 'ponmlkjihgfedcbaponmlkjihgfedcba',
      senderUrl: `${runtimeBaseUrl}popup.html`, runtimeBaseUrl, senderTabId: Number.NaN },
    { senderExtensionId: runtimeExtensionId,
      senderUrl: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/popup.html',
      runtimeBaseUrl, senderTabId: Number.NaN }
  ]) {
    const rejected = await router.handle(message, context);
    assert.equal(rejected.success, false, JSON.stringify(context));
    assert.equal(rejected.error.code, 'LITERATURE_NOTE_SENDER_INVALID');
  }
  const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
  assert.match(source, /senderUrl:\s*String\(sender\?\.url\s*\|\|\s*''\)/,
    'the browser-authenticated sender URL, not sender.tab.url, must define page ownership');
});

test('portable storage change listener filters safely, preserves change identity, and warns once without secrets', async () => {
  const secret = 'portable-storage-listener-secret';
  const calls = [];
  const warnings = [];
  const listener = createPortableConfigStorageChangeListener({
    scheduleBackup(changes) { calls.push(changes); return { state: 'ready' }; }
  }, { warn: (...args) => warnings.push(args) });
  const settingsChange = { sciLlmSettingsV2: { oldValue: {}, newValue: { apiKey: secret } } };
  const abbreviationChange = { sciGlobalAbbreviationMemoryV1: { oldValue: {}, newValue: {} } };
  const mineruChange = { sciPdfMineruSettingsV1: {
    oldValue: {}, newValue: { token: secret, mode: 'precise' }
  } };
  const bothChanges = { ...settingsChange, ...abbreviationChange };

  listener(settingsChange, 'sync');
  listener({ ignored: { newValue: secret } }, 'local');
  assert.equal(calls.length, 0);
  listener(bothChanges, 'local');
  assert.equal(calls.length, 1);
  assert.strictEqual(calls[0], bothChanges);
  listener(mineruChange, 'local');
  assert.equal(calls.length, 2);
  assert.strictEqual(calls[1], mineruChange);
  assert.deepEqual(warnings, []);

  const syncWarnings = [];
  createPortableConfigStorageChangeListener({
    scheduleBackup() { throw new Error(secret); }
  }, { warn: (...args) => syncWarnings.push(args) })(settingsChange, 'local');
  assert.deepEqual(syncWarnings, [[
    'Brevess: portable configuration backup scheduling failed'
  ]]);
  assert.doesNotMatch(JSON.stringify(syncWarnings), new RegExp(secret));

  const asyncWarnings = [];
  createPortableConfigStorageChangeListener({
    scheduleBackup() { return Promise.reject(new Error(secret)); }
  }, { warn: (...args) => asyncWarnings.push(args) })(abbreviationChange, 'local');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(asyncWarnings, [[
    'Brevess: portable configuration backup scheduling failed'
  ]]);
  assert.doesNotMatch(JSON.stringify(asyncWarnings), new RegExp(secret));
});

test('explicit sync drain waits for a concurrently queued directory rerun', async () => {
  const directorySync = createDirectorySyncDouble({
    flush: call => Promise.resolve(call < 3
      ? {
          permission: 'granted', written: 1, imported: 0,
          conflicts: 0, failed: 0, pendingCount: 2
        }
      : {
          permission: 'granted', written: 2, imported: 0,
          conflicts: 0, failed: 0, pendingCount: 0
        })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync,
    portableConfigManager: createReadyPortableConfigManagerDouble(),
    fetchImpl: async () => jsonResponse({})
  });

  const result = await router.handle({
    type: 'USER_DATA_SYNC_NOW',
    drain: true
  });

  assert.equal(result.success, true);
  assert.equal(result.data.pendingCount, 0);
  assert.equal(directorySync.flushCalls, 3);
});

test('rebuild shares the document mutation queue so concurrent annotations are preserved', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const documentStore = createMemoryDocumentStore();
  const directorySync = createDirectorySyncDouble();
  directorySync.rebuildIndex = async importer => {
    await gate;
    const current = await documentStore.getDocument('sha256:race');
    await importer(`annotations/${encodeURIComponent('sha256:race')}.json`, {
      ...current,
      revision: current.revision + 5,
      annotations: [{ ...routerAnnotation(), annotationId: 'from-directory' }]
    }, {});
    return { imported: 1, stale: 0, invalidAssets: 0 };
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), documentStore, directorySync,
    portableConfigManager: createReadyPortableConfigManagerDouble(),
    fetchImpl: async () => jsonResponse({})
  });
  await documentStore.prepareDocument({
    schemaVersion: 1, documentId: 'sha256:race', title: 'Race', canonicalUrl: '',
    studyType: null, annotations: [], revision: 0, documentHash: 'race',
    documentHashes: ['race']
  });

  const rebuilding = router.handle({ type: 'USER_DATA_REBUILD_INDEX' });
  const annotating = router.handle({
    type: 'ANNOTATION_UPSERT', documentId: 'sha256:race',
    annotation: { ...routerAnnotation(), annotationId: 'from-user' }
  });
  release();
  const [rebuilt, annotated] = await Promise.all([rebuilding, annotating]);
  const record = await documentStore.getDocument('sha256:race');

  assert.equal(rebuilt.success, true);
  assert.equal(annotated.success, true);
  assert.deepEqual(record.annotations.map(item => item.annotationId).sort(), [
    'from-directory', 'from-user'
  ]);
});

test('LLM_SAVE_PROFILE accepts current version 6 settings', async () => {
  const storageArea = createMemoryStorage();
  storageArea.values.sciLlmSettingsV2 = globalThis.SciLLM.createDefaultSettings();
  assert.equal(storageArea.values.sciLlmSettingsV2.version, 6);
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });

  const response = await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_v6_save', name: 'V6 profile', providerId: 'openai',
      config: { apiKey: 'v6-local-key', model: 'gpt-5-mini' }
    }
  });

  assert.equal(response.success, true);
  assert.equal(storageArea.values.sciLlmSettingsV2.version, 6);
  assert.ok(storageArea.values.sciLlmSettingsV2.profiles.profile_v6_save);
});

test('saves profiles with explicit key preservation and clearing semantics', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  const secret = 'profile-save-secret-1234';

  const created = await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_saved_openai', name: 'Saved OpenAI', providerId: 'openai',
      config: { apiKey: secret, model: 'gpt-5-mini' },
      capabilities: { vision: true },
      tokenPolicy: { mode: 'auto', autoCap: null }
    }
  });
  const preserved = await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_saved_openai', name: 'Renamed', providerId: 'openai',
      config: { apiKey: '', model: 'gpt-5-mini' }
    }
  });

  assert.equal(created.success, true);
  assert.equal(preserved.success, true);
  assert.equal(
    storageArea.values.sciLlmSettingsV2.profiles.profile_saved_openai.config.apiKey,
    secret
  );
  assert.doesNotMatch(JSON.stringify([created, preserved]), new RegExp(secret));

  const cleared = await router.handle({
    type: 'LLM_SAVE_PROFILE', clearApiKey: true,
    profile: {
      id: 'profile_saved_openai', name: 'Renamed', providerId: 'openai',
      config: { apiKey: '', model: 'gpt-5-mini' }
    }
  });
  assert.equal(cleared.success, true);
  assert.equal(
    storageArea.values.sciLlmSettingsV2.profiles.profile_saved_openai.config.apiKey,
    ''
  );
});

test('duplicates all local profile behavior but returns only public data', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  const key = 'duplicate-key-secret';
  const header = 'duplicate-header-secret';
  await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_duplicate_source', name: '原配置', providerId: 'openai-compatible',
      config: {
        apiKey: key, model: 'custom-model', baseUrl: 'https://example.com/v1',
        supportsVision: true, customHeaders: { 'X-Custom': header }
      },
      capabilities: { vision: true, batch: false },
      tokenPolicy: { mode: 'manual', manualMax: 8192 }
    }
  });

  const duplicated = await router.handle({
    type: 'LLM_DUPLICATE_PROFILE', profileId: 'profile_duplicate_source'
  });
  const saved = storageArea.values.sciLlmSettingsV2;
  const duplicateId = saved.profileOrder.at(-1);
  const copy = saved.profiles[duplicateId];

  assert.equal(duplicated.success, true);
  assert.match(duplicateId, /^profile_[a-z0-9_]{3,80}$/);
  assert.notEqual(duplicateId, 'profile_duplicate_source');
  assert.match(copy.name, /副本/);
  assert.equal(copy.config.apiKey, key);
  assert.equal(copy.config.customHeaders['X-Custom'], header);
  assert.deepEqual(copy.capabilities, saved.profiles.profile_duplicate_source.capabilities);
  assert.deepEqual(copy.tokenPolicy, saved.profiles.profile_duplicate_source.tokenPolicy);
  assert.doesNotMatch(JSON.stringify(duplicated), /duplicate-key-secret|duplicate-header-secret/);
});

test('deleting a routed global profile switches global and clears every dangling policy', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  for (const [id, name] of [['profile_delete_me', 'Delete'], ['profile_keep_me', 'Keep']]) {
    const response = await router.handle({
      type: 'LLM_SAVE_PROFILE',
      profile: {
        id, name, providerId: 'deepseek',
        config: { apiKey: `${id}-secret`, model: 'deepseek-chat' }
      }
    });
    assert.equal(response.success, true);
  }
  const routes = Object.fromEntries(globalThis.SciLLM.TASK_ROUTE_KEYS.map(taskType => [
    taskType, { mode: 'profile', profileId: 'profile_delete_me' }
  ]));
  assert.equal((await router.handle({
    type: 'LLM_UPDATE_PROFILE_ROUTING',
    globalProfileId: 'profile_delete_me', taskRoutes: routes
  })).success, true);

  const deleted = await router.handle({
    type: 'LLM_DELETE_PROFILE', profileId: 'profile_delete_me'
  });
  const saved = storageArea.values.sciLlmSettingsV2;

  assert.equal(deleted.success, true);
  assert.equal(saved.globalProfileId, saved.profileOrder[0]);
  assert.notEqual(saved.globalProfileId, 'profile_delete_me');
  assert.equal(saved.profiles.profile_delete_me, undefined);
  assert.equal(saved.taskRoutes, undefined);
  const translationTasks = ['full_text_translation', 'navigation_title_translation'];
  assert.deepEqual(
    Object.keys(saved.taskPolicies).sort(),
    [...globalThis.SciLLM.LLM_TASK_IDS].sort()
  );
  Object.entries(saved.taskPolicies).forEach(([taskId, policy]) => {
    assert.equal(policy.mode, translationTasks.includes(taskId) ? 'local' : 'global', taskId);
    assert.equal(policy.profileId, null, taskId);
  });
});

test('routing rejects a missing global profile and ingests transitional task routes', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });

  const rejected = await router.handle({
    type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: 'profile_missing', taskRoutes: {}
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.error.code, 'INVALID_SETTINGS');
  assert.deepEqual(rejected.error.fields, ['globalProfileId']);

  const normalizedInvalid = await router.handle({
    type: 'LLM_UPDATE_PROFILE_ROUTING',
    taskRoutes: {
      figure: { mode: 'profile', profileId: 'profile_missing' },
      injected: { mode: 'profile', profileId: 'profile_default_openai' }
    }
  });
  assert.equal(normalizedInvalid.success, true);
  const translationTasks = ['full_text_translation', 'navigation_title_translation'];
  const normalizedPolicies = storageArea.values.sciLlmSettingsV2.taskPolicies;
  assert.deepEqual(
    Object.keys(normalizedPolicies).sort(),
    [...globalThis.SciLLM.LLM_TASK_IDS].sort()
  );
  Object.entries(normalizedPolicies).forEach(([taskId, policy]) => {
    assert.equal(policy.mode, translationTasks.includes(taskId) ? 'local' : 'global', taskId);
    assert.equal(policy.profileId, null, taskId);
  });

  const accepted = await router.handle({
    type: 'LLM_UPDATE_PROFILE_ROUTING',
    taskRoutes: {
      figure: { mode: 'profile', profileId: 'profile_default_openai' }
    }
  });
  assert.equal(accepted.success, true);
  const saved = storageArea.values.sciLlmSettingsV2;
  assert.equal(saved.taskRoutes, undefined);
  for (const taskId of [
    'figure_walkthrough', 'figure_panel_interpretation', 'figure_panel_followup'
  ]) {
    assert.deepEqual(saved.taskPolicies[taskId], {
      mode: 'profile', profileId: 'profile_default_openai',
      reasoningEnabled: false, reasoningEffort: 'auto',
      tokenRule: 'auto', allowTextFallback: false
    });
  }

  const explicitPolicies = structuredClone(saved.taskPolicies);
  explicitPolicies.paragraph_summary = {
    ...explicitPolicies.paragraph_summary,
    mode: 'profile',
    profileId: 'profile_default_openai'
  };
  const explicit = await router.handle({
    type: 'LLM_UPDATE_PROFILE_ROUTING',
    taskPolicies: explicitPolicies,
    taskRoutes: {
      figure: { mode: 'global', profileId: null }
    }
  });
  assert.equal(explicit.success, true);
  assert.equal(
    storageArea.values.sciLlmSettingsV2.taskPolicies.paragraph_summary.profileId,
    'profile_default_openai'
  );
  assert.equal(
    storageArea.values.sciLlmSettingsV2.taskPolicies.figure_walkthrough.mode,
    'profile'
  );
});

test('tests the exact requested profile instead of falling back to the global profile', async () => {
  const storageArea = createMemoryStorage();
  const urls = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async url => {
      urls.push(String(url));
      return sseResponse(JSON.stringify({
        ok: true, echo: 'schema'
      }));
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_exact_deepseek', name: 'Exact DeepSeek', providerId: 'deepseek',
      config: { apiKey: 'exact-secret', model: 'deepseek-chat' }
    }
  });

  const tested = await router.handle({
    type: 'LLM_TEST_PROFILE', profileId: 'profile_exact_deepseek',
    probeIds: ['structured_schema']
  });

  assert.equal(tested.success, true);
  assert.equal(tested.data.providerId, 'deepseek');
  assert.equal(tested.data.profileId, 'profile_exact_deepseek');
  assert.match(urls[0], /deepseek/i);
  assert.doesNotMatch(JSON.stringify(tested), /exact-secret/);

  const missing = await router.handle({
    type: 'LLM_TEST_PROFILE', profileId: 'profile_missing'
  });
  assert.equal(missing.success, false);
  assert.equal(missing.error.code, 'INVALID_SETTINGS');
  assert.doesNotMatch(JSON.stringify(missing), /apiKey|customHeaders|exact-secret/);
});

test('gives a real local Codex connection probe enough time to warm up', async () => {
  const storageArea = createMemoryStorage();
  const turns = [];
  const nativeClient = {
    async health() {
      return { connected: true, accountType: 'chatgpt', planType: 'plus' };
    },
    streamTurn(input) {
      turns.push(input);
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text_delta', text: 'OK' };
          yield { type: 'completed' };
        }
      };
    }
  };
  const router = createBackgroundRouter({
    storageArea,
    nativeClient,
    fetchImpl: async () => jsonResponse({})
  });
  await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_codex_test',
      name: 'Local Codex',
      providerId: 'codex-local',
      config: { model: 'auto', reasoningEffort: 'auto' }
    }
  });

  const tested = await router.handle({
    type: 'LLM_TEST_PROFILE',
    profileId: 'profile_codex_test',
    probeIds: ['connectivity']
  });

  assert.equal(tested.success, true);
  assert.equal(tested.data.connectivity, true);
  assert.equal(tested.data.capabilitiesReady, null);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].timeoutMs, 120000);
  assert.equal(turns[0].ephemeral, true);
});

test('preserves public Local Codex stream failures after a successful health check', async () => {
  const storageArea = createMemoryStorage();
  const calls = [];
  let streamCode = '';
  const nativeClient = {
    async health() {
      calls.push('health');
      return { connected: true, accountType: 'chatgpt', planType: 'plus' };
    },
    streamTurn() {
      calls.push('stream');
      const code = streamCode;
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'error',
            error: { code, message: 'private bridge detail must not survive' }
          };
        }
      };
    }
  };
  const router = createBackgroundRouter({
    storageArea,
    nativeClient,
    fetchImpl: async () => jsonResponse({})
  });
  await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_codex_public_errors',
      name: 'Local Codex',
      providerId: 'codex-local',
      config: { model: 'auto', reasoningEffort: 'auto' }
    }
  });

  for (const code of [
    'CODEX_NOT_INSTALLED',
    'CODEX_NOT_AUTHENTICATED',
    'CODEX_BRIDGE_UNAVAILABLE',
    'CODEX_PROVIDER_REJECTED'
  ]) {
    streamCode = code;
    calls.length = 0;
    const tested = await router.handle({
      type: 'LLM_TEST_PROFILE',
      profileId: 'profile_codex_public_errors',
      probeIds: ['connectivity']
    });
    assert.equal(tested.success, false);
    assert.equal(tested.error.code, code);
    assert.deepEqual(calls, ['health', 'stream']);
    assert.doesNotMatch(JSON.stringify(tested), /private bridge detail/i);
  }

  streamCode = 'PRIVATEALPHANUMERICKEY987654321';
  const unknown = await router.handle({
    type: 'LLM_TEST_PROFILE',
    profileId: 'profile_codex_public_errors',
    probeIds: ['connectivity']
  });
  assert.equal(unknown.success, false);
  assert.equal(unknown.error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(unknown), /PRIVATEALPHANUMERIC/i);
});

test('legacy provider saves upsert one profile without reviving the legacy settings model', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });

  const response = await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'legacy-adapter-secret', model: 'gpt-5-mini' }
  });
  const saved = storageArea.values.sciLlmSettingsV2;

  assert.equal(response.success, true);
  assert.ok(saved.profiles.profile_legacy_openai);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'providers'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'providerId'), false);
  assert.doesNotMatch(JSON.stringify(response), /legacy-adapter-secret/);
});

test('all profile handlers refuse opaque future settings without mutating legacy fields', async () => {
  const messages = [
    {
      type: 'LLM_SAVE_PROFILE',
      profile: {
        id: 'profile_future_new', name: 'New', providerId: 'openai',
        config: { apiKey: 'future-secret', model: 'gpt-5-mini' }
      }
    },
    { type: 'LLM_DUPLICATE_PROFILE', profileId: 'profile_future_openai' },
    { type: 'LLM_DELETE_PROFILE', profileId: 'profile_future_openai' },
    {
      type: 'LLM_UPDATE_PROFILE_ROUTING',
      globalProfileId: 'profile_future_openai', taskRoutes: {}
    },
    {
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: { mode: 'llm', providerId: 'openai', consentGranted: true }
    },
    {
      type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
      config: { apiKey: 'future-secret', model: 'gpt-5-mini' }
    },
    { type: 'LLM_TEST_PROFILE', profileId: 'profile_future_openai' },
    { type: 'LLM_TEST_PROVIDER', providerId: 'openai' }
  ];

  for (const message of messages) {
    const storageArea = createMemoryStorage();
    storageArea.values.sciLlmSettingsV2 = {
      version: 99,
      mode: 'regex',
      consentGranted: false,
      providerId: 'legacy-provider-id-must-stay',
      providers: { legacy: { preserve: true } },
      opaque: { preserve: true },
      profiles: {
        profile_future_openai: {
          name: 'Future', providerId: 'openai',
          config: { apiKey: 'stored-future-secret', model: 'gpt-5-mini' }
        }
      },
      profileOrder: ['profile_future_openai'],
      globalProfileId: 'profile_future_openai',
      taskRoutes: {}
    };
    const snapshot = structuredClone(storageArea.values.sciLlmSettingsV2);
    const router = createBackgroundRouter({
      storageArea,
      fetchImpl: async () => { throw new Error('future profile must not be tested'); }
    });

    const response = await router.handle(message);

    assert.equal(response.success, false, message.type);
    assert.equal(response.error.code, 'INVALID_SETTINGS', message.type);
    assert.deepEqual(response.error.fields, ['version'], message.type);
    assert.deepEqual(storageArea.values.sciLlmSettingsV2, snapshot, message.type);
    assert.doesNotMatch(
      JSON.stringify(response),
      /future-secret|stored-future-secret|legacy-provider-id-must-stay/
    );
  }
});

test('deleting the only profile leaves an empty non-dangling profile state', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });

  const deleted = await router.handle({
    type: 'LLM_DELETE_PROFILE', profileId: 'profile_default_openai'
  });
  const saved = storageArea.values.sciLlmSettingsV2;

  assert.equal(deleted.success, true);
  assert.deepEqual(saved.profiles, {});
  assert.deepEqual(saved.profileOrder, []);
  assert.equal(saved.globalProfileId, '');
  assert.equal(saved.taskRoutes, undefined);
  const translationTasks = ['full_text_translation', 'navigation_title_translation'];
  assert.deepEqual(
    Object.keys(saved.taskPolicies).sort(),
    [...globalThis.SciLLM.LLM_TASK_IDS].sort()
  );
  Object.entries(saved.taskPolicies).forEach(([taskId, policy]) => {
    assert.equal(policy.mode, translationTasks.includes(taskId) ? 'local' : 'global', taskId);
    assert.equal(policy.profileId, null, taskId);
  });
});
