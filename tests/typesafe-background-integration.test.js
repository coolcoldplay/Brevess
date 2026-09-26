const test = require('node:test');
const assert = require('node:assert/strict');

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
require('../core/jev-highlight.js');
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
require('../core/figure-workspace.js');
require('../core/article-archive.js');
require('../core/directory-sync.js');
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
require('../providers/typesafe.js');
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

function createMemoryStorage(initialValues = {}) {
  const values = structuredClone(initialValues);
  return {
    values,
    get(keys, callback) {
      const requested = Array.isArray(keys) ? keys : [keys];
      callback(Object.fromEntries(requested.map(key => [key, values[key]])));
    },
    set(input, callback) {
      Object.assign(values, structuredClone(input));
      callback();
    }
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

async function selectStudyType(router, document, studyType = 'observational') {
  const prepared = await router.handle({ type: 'LLM_PREPARE_DOCUMENT', document });
  assert.equal(prepared.success, true, JSON.stringify(prepared));
  const selected = await router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentHash: prepared.data.documentHash,
    studyType
  });
  assert.equal(selected.success, true, JSON.stringify(selected));
}

function choiceAnswer(question, selectedProbability = 0.94) {
  const choices = Object.keys(question.criteria || {});
  const selected = choices.find(choice => choice !== 'none') || choices[0];
  const remainder = choices.length > 1
    ? (1 - selectedProbability) / (choices.length - 1) : 0;
  return {
    type: 'choice',
    choice: selected,
    confidence: 0.94,
    probabilities: Object.fromEntries(choices.map(choice => [
      choice,
      choice === selected ? selectedProbability : remainder
    ]))
  };
}

function jevAnswers(questions) {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => [
    id,
    question.type === 'noul'
      ? { type: 'noul', noul: 0.95 }
      : choiceAnswer(question)
  ]));
}

function documentFixture(title = 'Jev integration study') {
  return {
    title,
    url: `https://journal.example/${encodeURIComponent(title)}`,
    paragraphs: [{
      paragraphId: 'p1',
      sectionTitle: 'Discussion',
      text: 'The small sample size limits generalizability.'
    }]
  };
}

test('background message path keeps Jev highlights when the generative ledger route is unavailable', async () => {
  const storageArea = createMemoryStorage();
  const fetches = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      fetches.push({ url, body, authorization: options.headers.Authorization });
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      return jsonResponse({
        model: 'jev-mock',
        answers: jevAnswers(body.questions),
        usage: { input_tokens: 20, output_tokens: 4 }
      });
    }
  });

  const saved = await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_typesafe_mock',
      name: 'Jev mock',
      providerId: 'typesafe',
      config: { apiKey: 'mock-only-key', model: 'jev-custom-mock' }
    }
  });
  assert.equal(saved.success, true, JSON.stringify(saved));
  const routed = await router.handle({
    type: 'LLM_UPDATE_PROFILE_ROUTING',
    globalProfileId: 'profile_default_openai',
    taskPolicies: {
      document_highlight: {
        mode: 'profile', profileId: 'profile_typesafe_mock'
      }
    }
  });
  assert.equal(routed.success, true, JSON.stringify(routed));
  const preferences = await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', consentGranted: true,
      selectedCategoryIds: ['limitation']
    }
  });
  assert.equal(preferences.success, true, JSON.stringify(preferences));

  const document = documentFixture();
  await selectStudyType(router, document);
  const result = await router.handle({ type: 'LLM_ANALYZE_DOCUMENT', document });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.data.route.providerId, 'typesafe');
  assert.equal(result.data.annotations.length, 1);
  assert.equal(result.data.annotations[0].categories[0].categoryId, 'limitation');
  assert.equal(result.data.ledger.available, false);
  assert.equal(result.data.ledger.errorCode, 'NO_USABLE_PROFILE');
  assert.ok(fetches.length >= 1);
  assert.ok(fetches.every(call => call.url === 'https://api.typesafe.ai/v1/systemone'));
  assert.ok(fetches.every(call => call.authorization === 'Bearer mock-only-key'));

  const publicState = await router.handle({ type: 'LLM_GET_SETTINGS' });
  assert.equal(publicState.success, true);
  assert.equal(publicState.data.settings.globalProfileId, 'profile_default_openai');
  assert.equal(
    publicState.data.settings.taskPolicies.document_highlight.profileId,
    'profile_typesafe_mock'
  );
  assert.equal(
    publicState.data.settings.profiles.profile_typesafe_mock.config.apiKeyMask,
    '••••-key'
  );
  assert.equal(
    'apiKey' in publicState.data.settings.profiles.profile_typesafe_mock.config,
    false
  );
});

test('the same background document path still completes with a standard OpenAI profile', async () => {
  const storageArea = createMemoryStorage();
  const schemaNames = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      const schemaName = body.text?.format?.name;
      schemaNames.push(schemaName);
      if (schemaName === 'evidence_ledger') {
        return jsonResponse({ output_text: JSON.stringify({
          key_annotation_ids: [], relation_summaries: [],
          review_warnings: [], audit_items: []
        }) });
      }
      const input = JSON.parse(body.input);
      return jsonResponse({ output_text: JSON.stringify({
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
      }) });
    }
  });

  assert.equal((await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'mock-openai-key', model: 'gpt-5-mini' }
  })).success, true);
  assert.equal((await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['limitation']
    }
  })).success, true);

  const document = documentFixture('OpenAI regression study');
  await selectStudyType(router, document);
  const result = await router.handle({ type: 'LLM_ANALYZE_DOCUMENT', document });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.data.route.providerId, 'openai');
  assert.equal(result.data.annotations.length, 1);
  assert.equal(result.data.ledger.available, true);
  assert.deepEqual(schemaNames, ['scientific_annotations_v3', 'evidence_ledger']);
});
