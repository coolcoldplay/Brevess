const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

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
require('../core/panel-ledger.js');
require('../core/cross-figure-logic.js');
require('../core/review-outline.js');
require('../core/abbreviation-extractor.js');
require('../core/cache-planner.js');
require('../core/privacy-sanitizer.js');
require('../core/article-workspace.js');
require('../core/article-workspace-save.js');
require('../core/pdf-workspace.js');
require('../core/article-workspace-store.js');
require('../core/migration-bundle.js');
require('../core/analysis-pipeline.js');
require('../core/analysis-cache.js');
require('../core/review-outline-pipeline.js');
require('../core/corpus-store.js');
require('../core/pdf-annotations.js');
require('../core/manual-annotations.js');
require('../core/document-store.js');
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

const { createBackgroundRouter } = require('../core/background-router.js');

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
  return Function(
    ...Object.keys(dependencies),
    `return (${contentFunctionSource(name)});`
  )(...Object.values(dependencies));
}

function memoryStorage() {
  const values = {};
  return {
    get(key, callback) { callback({ [key]: values[key] }); },
    set(input, callback) { Object.assign(values, input); callback(); }
  };
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    async text() { return JSON.stringify(body); }
  };
}

function providerInput(body) {
  const raw = Array.isArray(body.input)
    ? body.input[0].content.find(item => item.type === 'input_text').text
    : body.input;
  return JSON.parse(raw);
}

function resolvedPanel(panel, basis) {
  return {
    panel,
    role: 'phenotype',
    phenotype_name_zh: `Outcome ${panel}`,
    method_category: 'wet_lab',
    methods: [`Assay ${panel}`],
    evidence_type_zh: 'controlled experiment',
    experimental_methods: [`Assay ${panel}`],
    statistical_methods: [],
    method_source: basis === 'vision_text' ? 'image' : 'caption',
    purpose_zh: `Purpose ${panel}`,
    design_zh: `Design ${panel}`,
    comparison_zh: `Comparison ${panel}`,
    direct_observation_zh: `Observation ${panel}`,
    observation_source: basis === 'vision_text'
      ? 'image_observation' : 'caption_statement',
    local_inference_zh: `Inference ${panel}`,
    contribution_zh: `Contribution ${panel}`
  };
}

function panelResponse(input, panels) {
  return {
    figure_id: input.figure_id,
    analysis_depth: input.analysis_depth,
    basis: input.analysis_basis,
    panels
  };
}

function synthesisResponse(input) {
  const panels = input.panel_evidence.map(panel => panel.panel);
  return {
    figure_id: input.figure_id,
    analysis_depth: input.analysis_depth,
    basis: input.analysis_basis,
    figure_title_zh: 'Figure 4',
    figure_question_zh: 'What do the identifiable Panels establish?',
    remaining_question_zh: 'Panels E and F remain unidentifiable from supplied text.',
    panel_groups: [{
      panels,
      group_goal_zh: 'Summarize only identifiable Panels.',
      group_conclusion_zh: 'The bounded evidence supports a partial conclusion.'
    }],
    logic_bridges: [],
    argument_chain: [{
      panels,
      established_zh: 'The identifiable Panels support the bounded result.',
      handoff_zh: 'The missing visual evidence remains unresolved.',
      evidence_level: 'intervention_effect'
    }],
    author_assembly_zh: 'The identifiable Panels form the supported evidence chain.',
    core_conclusion_zh: 'Only the identifiable Panel evidence is concluded.',
    claim_boundary_zh: 'Panels E and F are not interpreted without sufficient evidence.'
  };
}

async function runUnidentifiedRecoveryScenario({ badRecoveryResponses = 0,
  tamperFinalCheckpoint = false } = {}) {
  const storageArea = memoryStorage();
  const sessionStorageArea = memoryStorage();
  let durable = null;
  let revision = 0;
  let providerCalls = 0;
  let remainingBadRecoveryResponses = badRecoveryResponses;
  const providerRequests = [];
  const attemptedCheckpoints = [];
  const persist = executableContentFunction('persistFigureInventoryWithCas', {
    getWorkspaceAssetCheckpoint: async () => structuredClone(durable),
    persistWorkspaceAssetCheckpoint: async (_path, content) => {
      revision += 1;
      durable = {
        revision,
        contentHash: String(revision).padStart(64, 'a'),
        content: structuredClone(content)
      };
      return { saved: true };
    }
  });
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea,
    runtimeExtensionId: 'extension-id',
    sleepImpl: async () => {},
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const body = JSON.parse(options.body);
      const input = body.messages
        ? JSON.parse(body.messages.at(-1).content)
        : providerInput(body);
      providerRequests.push({
        pass: input.pass,
        requestedPanels: [...(input.requested_panel_labels || [])],
        completedPanels: [...(input.completed_panel_labels || [])],
        checkpointCount: attemptedCheckpoints.length
      });
      if (input.pass === 'missing_panel_recovery' &&
          input.requested_panel_labels.join('') === 'BCD' &&
          remainingBadRecoveryResponses > 0) {
        remainingBadRecoveryResponses -= 1;
        return jsonResponse({
          choices: [{ message: { content: '{"figure_id":"figure-4","panels":[{"panel":"B","direct_observation_zh":"an unescaped "quote""}]}' } }]
        });
      }
      let output;
      if (input.pass === 'panel_extraction') {
        const first = input.expected_panel_labels[0];
        output = panelResponse(input, [resolvedPanel(first, input.analysis_basis)]);
      } else if (input.pass === 'missing_panel_recovery') {
        output = panelResponse(input, input.requested_panel_labels.map(panel =>
          ['E', 'F'].includes(panel) ? {
            panel,
            status: 'not_identifiable',
            reason_code: 'insufficient_panel_evidence',
            input_mode: input.input_mode,
            evidence_refs: input.available_evidence_refs_by_panel[panel]
          } : resolvedPanel(panel, input.analysis_basis)
        ));
      } else if (input.pass === 'figure_synthesis') {
        output = synthesisResponse(input);
      } else {
        throw new Error(`unexpected provider pass ${input.pass}`);
      }
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify(output) } }]
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
    config: { apiKey: 'test-only-key', model: 'deepseek-chat' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'deepseek', consentGranted: true }
  });
  const labels = 'ABCDEFGHIJKL'.split('');
  const operationId = 'unidentified-recovery-checkpoint-operation';
  const response = await router.handle({
    type: 'LLM_ANALYZE_FIGURES',
    operationScope: 'figure',
    workspaceLifecycle: 19,
    operationId,
    figureRequestReceipt: 'figure-request-unidentified-recovery-receipt-12345678',
    figureOperationPlan: [{ figureId: 'figure-4', panelCount: labels.length }],
    analysisDepth: 'standard',
    document: {
      title: 'Public test article',
      paragraphs: [{
        paragraphId: 'pdf-page-8', sectionTitle: 'Results',
        text: 'A public fixture sentence describing Figure 4.'
      }]
    },
    figures: [{
      figureId: 'figure-4', figureLabel: 'Figure 4',
      caption: 'Figure 4. Public fixture caption for panels A through L.',
      panelHints: labels,
      contextParagraphs: [{
        paragraphId: 'pdf-page-8', sectionTitle: 'Results',
        text: 'A public fixture sentence describing Figure 4.'
      }],
      images: []
    }]
  }, {
    trustedExtensionSender: true,
    senderExtensionId: 'extension-id',
    senderTabId: 19,
    senderFrameId: 0,
    senderDocumentId: '19191919-1919-4919-8919-191919191919',
    async onFigureCheckpoint(checkpoint) {
      if (tamperFinalCheckpoint && checkpoint.figureResult.figureQuestion) {
        checkpoint = structuredClone(checkpoint);
        checkpoint.figureResult.panels[0].directObservation = 'Forged saved observation';
        checkpoint.checkpointEnvelope.figureResult.panels[0].directObservation =
          'Forged saved observation';
      }
      attemptedCheckpoints.push(structuredClone(checkpoint));
      const envelope = checkpoint.checkpointEnvelope;
      await persist({
        schemaVersion: 1,
        figures: [{
          figureId: 'figure-4',
          pendingStandard: { ...checkpoint.figureResult, operationId },
          pendingStandardCheckpointEnvelope: envelope
        }]
      }, {
        figureId: 'figure-4', analysisDepth: 'standard',
        checkpointEnvelope: envelope
      });
      return {
        success: true,
        savedPanelCount: checkpoint.figureResult.panels.length
      };
    }
  });

  return {
    response,
    providerCalls,
    providerRequests,
    attemptedCheckpoints,
    durable,
    persist,
    getDurable: () => durable,
    operationId,
    labels
  };
}

test('a malformed recovery completion retries only the missing scope and then completes', async () => {
  const {
    response, providerCalls, providerRequests, attemptedCheckpoints, durable, labels,
    persist, getDurable, operationId
  } = await runUnidentifiedRecoveryScenario({ badRecoveryResponses: 1 });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(providerCalls, 8,
    'one bounded schema repair is added to the seven successful calls');
  const retried = providerRequests.filter(request =>
    request.pass === 'missing_panel_recovery' &&
    request.requestedPanels.join('') === 'BCD'
  );
  assert.equal(retried.length, 2);
  assert.deepEqual(retried.map(request => request.requestedPanels), [
    ['B', 'C', 'D'], ['B', 'C', 'D']
  ]);
  assert.deepEqual(retried.map(request => request.completedPanels), [['A'], ['A']]);
  assert.deepEqual(retried.map(request => request.checkpointCount), [1, 1],
    'the invalid completion cannot rewrite the already durable Panel A');
  assert.ok(attemptedCheckpoints.length >= 8);
  const firstFullBatch = attemptedCheckpoints.filter(checkpoint =>
    checkpoint.figureResult.panels.map(panel => panel.panel).join('') === 'ABCDEF'
  );
  assert.equal(firstFullBatch.length, 2,
    'the recovered first batch is checkpointed once and then replayed by assembly');
  assert.deepEqual(firstFullBatch[0].figureResult, firstFullBatch[1].figureResult,
    'the same-size replay must be exact so strict CAS can acknowledge it');
  assert.deepEqual(firstFullBatch[0].figureResult.unresolvedPanels, ['E', 'F']);
  const result = response.data.figureResults[0];
  assert.deepEqual(result.unresolvedPanels, ['E', 'F']);
  assert.deepEqual(result.panelCoverage.unresolvedPanels, ['E', 'F']);
  assert.deepEqual(result.panels.filter(panel => panel.status === 'not_identifiable')
    .map(panel => panel.panel), ['E', 'F']);
  assert.equal(durable.content.figures[0]
    .pendingStandardCheckpointEnvelope.figureResult.panels.length, labels.length);
  const envelope = durable.content.figures[0].pendingStandardCheckpointEnvelope;
  const completion = () => ({ schemaVersion: 1, figures: [{ figureId: 'figure-4',
    standard: { ...structuredClone(result), operationId } }] });
  const clearOptions = { figureId: 'figure-4', analysisDepth: 'standard',
    clearCheckpointEnvelope: envelope, operationId };
  for (const mutate of [
    value => { value.unresolvedPanels = []; },
    value => { value.panelCoverage.unresolvedPanels = ['E']; },
    value => { value.panels.find(panel => panel.panel === 'E').status = 'resolved'; },
    value => { value.coreConclusion = 'An unsupported replacement conclusion'; }
  ]) {
    const forged = completion();
    mutate(forged.figures[0].standard);
    await assert.rejects(persist(forged, clearOptions),
      error => error?.code === 'FIGURE_CHECKPOINT_CONFLICT');
  }
  await persist(completion(), clearOptions);
  const saved = getDurable().content.figures[0];
  assert.equal(saved.pendingStandardCheckpointEnvelope, undefined,
    'an honestly unresolved final result must finish its pending save');
  assert.deepEqual(saved.standard.unresolvedPanels, ['E', 'F']);
  assert.deepEqual(saved.standard.panelCoverage.unresolvedPanels, ['E', 'F']);
  assert.deepEqual(saved.standard.panels.filter(panel => panel.status === 'not_identifiable')
    .map(panel => panel.panel), ['E', 'F']);
});

test('terminal unresolved synthesis cannot replace an already durable Panel record', async () => {
  const { response, providerCalls, durable } = await runUnidentifiedRecoveryScenario({
    tamperFinalCheckpoint: true
  });
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'FIGURE_CHECKPOINT_PERSIST_FAILED');
  assert.equal(providerCalls, 7);
  assert.equal(durable.content.figures[0].pendingStandardCheckpointEnvelope
    .figureResult.panels.find(panel => panel.panel === 'A').directObservation, 'Observation A');
});

test('two malformed recovery completions stop after one schema repair', async () => {
  const {
    response, providerCalls, providerRequests, attemptedCheckpoints, durable
  } = await runUnidentifiedRecoveryScenario({ badRecoveryResponses: 2 });

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'INVALID_RESPONSE');
  assert.equal(providerCalls, 4,
    'the bounded extraction wave plus exactly two attempts for the failed recovery scope');
  const retried = providerRequests.filter(request =>
    request.pass === 'missing_panel_recovery'
  );
  assert.deepEqual(retried.map(request => request.requestedPanels), [
    ['B', 'C', 'D'], ['B', 'C', 'D']
  ]);
  assert.deepEqual(retried.map(request => request.completedPanels), [['A'], ['A']]);
  assert.deepEqual(attemptedCheckpoints.map(checkpoint =>
    checkpoint.figureResult.panels.map(panel => panel.panel)), [['A'], ['G']],
  'the already completed neighbour may attempt its own checkpoint after the failed repair');
  assert.deepEqual(durable.content.figures[0]
    .pendingStandardCheckpointEnvelope.figureResult.panels.map(panel => panel.panel), ['A']);
});
