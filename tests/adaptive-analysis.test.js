const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/category-store.js');
require('../core/adaptive-catalog.js');
require('../core/study-profile.js');
require('../core/confidence-policy.js');
require('../core/settings-store.js');
require('../providers/provider-utils.js');
require('../core/prompt-compiler.js');
require('../core/chunker.js');
require('../core/result-validator.js');
require('../core/evidence-ledger.js');
require('../core/cache-planner.js');
require('../core/analysis-pipeline.js');
require('../core/analysis-cache.js');
require('../core/corpus-store.js');
require('../core/manual-annotations.js');
const { createMemoryDocumentStore } = require('../core/document-store.js');
require('../providers/openai.js');
require('../providers/anthropic.js');
require('../providers/gemini.js');
require('../providers/deepseek.js');
require('../providers/openai-compatible.js');
require('../providers/provider-registry.js');
require('../core/task-profile-router.js');
require('../core/token-budget.js');
const { createBackgroundRouter } = require('../core/background-router.js');
const {
  fixtureDocument,
  validBlueprint,
  validRescueResponse
} = require('./helpers/adaptive-fixtures.js');

function createMemoryStorage() {
  const values = {};
  return {
    values,
    get(key, callback) { callback({ [key]: values[key] }); },
    set(input, callback) { Object.assign(values, input); callback(); }
  };
}

function jsonResponse(body) {
  return { ok: true, status: 200, async text() { return JSON.stringify(body); } };
}

async function createHarness({
  failLedger = false,
  invalidProfile = false,
  readingViewId = 'quick_story',
  ledgerAuditItems = []
} = {}) {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const providerStages = [];
  let profileCalls = 0;
  let annotationCalls = 0;
  let ledgerCalls = 0;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    const schemaName = body.text?.format?.name;
    if (schemaName === 'study_profile') {
      profileCalls += 1;
      providerStages.push('profile');
      if (invalidProfile) return jsonResponse({ output_text: '{invalid-json' });
      return jsonResponse({ output_text: JSON.stringify({
        primary_type: 'basic_mechanistic',
        secondary_type: 'preclinical_translational',
        confidence: 0.92,
        reason_zh: '动物机制干预并含转化验证',
        blueprint: validBlueprint
      }) });
    }
    if (schemaName === 'evidence_ledger') {
      ledgerCalls += 1;
      providerStages.push('ledger');
      if (failLedger) return jsonResponse({ output_text: '{invalid-json' });
      const ledgerInput = JSON.parse(body.input);
      const firstAnnotation = ledgerInput.annotations[0];
      return jsonResponse({ output_text: JSON.stringify({
        key_annotation_ids: [firstAnnotation.annotation_id],
        relation_summaries: [{
          relation_id: firstAnnotation.relation_id,
          label_zh: 'C1q 阻断逆转突触结局',
          annotation_ids: [firstAnnotation.annotation_id],
          evidence_strength: 'rescue'
        }],
        review_warnings: [],
        audit_items: ledgerAuditItems
      }) });
    }
    annotationCalls += 1;
    providerStages.push('annotation');
    const input = JSON.parse(body.input);
    const paragraphIds = new Set(input.paragraphs.map(item => item.paragraph_id));
    const containsRescuePair = paragraphIds.has('sec-results-p-001') &&
      paragraphIds.has('sec-results-p-002');
    return jsonResponse({ output_text: JSON.stringify(containsRescuePair
      ? { ...validRescueResponse, chunk_id: input.chunk_id,
          paragraphs_reviewed: input.paragraphs.map(item => item.paragraph_id) }
      : {
          chunk_id: input.chunk_id,
          paragraphs_reviewed: input.paragraphs.map(item => item.paragraph_id),
          annotations: []
        }) });
  };
  const router = createBackgroundRouter({
    storageArea, sessionStorageArea, documentStore, fetchImpl
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'test-key', model: 'test-model' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm',
      providerId: 'openai',
      consentGranted: true,
      readingViewId
    }
  });
  return {
    router,
    storageArea,
    documentStore,
    providerStages,
    getProfileCalls: () => profileCalls,
    getAnnotationCalls: () => annotationCalls,
    getLedgerCalls: () => ledgerCalls
  };
}

async function selectStudyType(
  harness,
  document = fixtureDocument,
  studyType = 'basic_mechanistic'
) {
  const prepared = await harness.router.handle({
    type: 'LLM_PREPARE_DOCUMENT', document
  });
  assert.equal(prepared.success, true);
  const selected = await harness.router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentHash: prepared.data.documentHash,
    studyType
  });
  assert.equal(selected.success, true);
  return selected;
}

test('prepares a generic analysis mode without requiring a paper type', async () => {
  const harness = await createHarness();
  const result = await harness.router.handle({
    type: 'LLM_PREPARE_DOCUMENT', document: fixtureDocument
  });

  assert.equal(result.success, true);
  assert.equal(result.data.requiresStudyType, false);
  assert.equal(result.data.studyProfile.primaryType, '');
  assert.equal(result.data.studyProfile.useTypeSpecificWarnings, false);
  assert.equal(result.data.fullTextAnalyzed, false);
  assert.ok(result.data.activeCategories.length > 0);
  assert.ok(result.data.activeCategories.every(category =>
    typeof category.categoryId === 'string' && typeof category.name === 'string'
  ));
  assert.ok(result.data.categorySources.every(item => item.source === 'view_default'));
  assert.equal(harness.getProfileCalls(), 0);
  assert.equal(harness.getAnnotationCalls(), 0);
  assert.deepEqual(harness.providerStages, []);
});

test('analyzes a prepared document without a paper-type selection', async () => {
  const harness = await createHarness();
  const result = await harness.router.handle({
    type: 'LLM_ANALYZE_DOCUMENT', document: fixtureDocument
  });

  assert.equal(result.success, true);
  assert.ok(harness.providerStages.length > 0);
});

test('saves exactly one document study type and ignores legacy secondary fields', async () => {
  const harness = await createHarness();
  const prepared = await harness.router.handle({
    type: 'LLM_PREPARE_DOCUMENT', document: fixtureDocument
  });
  const selected = await harness.router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentHash: prepared.data.documentHash,
    studyType: 'observational',
    primaryType: 'preclinical_translational',
    secondaryType: 'basic_mechanistic'
  });

  assert.equal(selected.success, true);
  assert.equal(selected.data.studyProfile.primaryType, 'observational');
  assert.equal(selected.data.studyProfile.secondaryType, null);
  assert.equal(selected.data.studyProfile.manuallyOverridden, true);
  const record = await harness.documentStore.getDocument(prepared.data.documentId);
  assert.equal(record.studyType, 'observational');
  assert.equal(record.updatedAt, selected.data.updatedAt);
  assert.deepEqual(harness.providerStages, []);
});

test('rejects invalid or multiple study type values without using legacy fields', async () => {
  const harness = await createHarness();
  const prepared = await harness.router.handle({
    type: 'LLM_PREPARE_DOCUMENT', document: fixtureDocument
  });
  const invalid = await harness.router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentHash: prepared.data.documentHash,
    studyType: ['observational', 'clinical_trial'],
    primaryType: 'observational'
  });
  const missing = await harness.router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentHash: prepared.data.documentHash,
    primaryType: 'observational'
  });

  assert.equal(invalid.success, false);
  assert.equal(invalid.error.code, 'INVALID_SETTINGS');
  assert.equal(missing.success, false);
  assert.equal(missing.error.code, 'INVALID_SETTINGS');
  assert.equal(
    (await harness.documentStore.getDocument(prepared.data.documentId)).studyType,
    null
  );
  assert.deepEqual(harness.providerStages, []);
});

test('runs annotation before ledger with a manually selected study type', async () => {
  const harness = await createHarness({ readingViewId: 'mechanism_chain' });
  await selectStudyType(harness);
  const result = await harness.router.handle({
    type: 'LLM_ANALYZE_DOCUMENT', document: fixtureDocument
  });
  assert.equal(result.success, true);
  assert.equal(result.data.studyProfile.primaryType, 'basic_mechanistic');
  assert.ok(result.data.annotations.length > 0);
  assert.match(result.data.ledger.relationSummaries[0].relationId, /:mechanism-7$/);
  assert.equal(harness.getProfileCalls(), 0);
  assert.ok(harness.getAnnotationCalls() > 0);
  assert.equal(harness.getLedgerCalls(), 1);
  assert.equal(harness.providerStages[0], 'annotation');
  assert.equal(harness.providerStages.at(-1), 'ledger');
});

test('switching views reuses shared category cache and calls only missing categories', async () => {
  const harness = await createHarness();
  await selectStudyType(harness);
  const quick = await harness.router.handle({
    type: 'LLM_ANALYZE_DOCUMENT', document: fixtureDocument
  });
  const callsBeforeSwitch = harness.getAnnotationCalls();
  await harness.router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { readingViewId: 'review_synthesis' }
  });
  const mechanism = await harness.router.handle({
    type: 'LLM_ANALYZE_DOCUMENT', document: fixtureDocument
  });
  assert.equal(quick.success, true);
  assert.equal(mechanism.success, true);
  assert.ok(harness.getAnnotationCalls() > callsBeforeSwitch);
  assert.ok(mechanism.data.cachedCategoryIds.includes('future'));
  assert.ok(mechanism.data.analyzedCategoryIds.includes('review_scope_thesis'));
});

test('ledger failure preserves validated highlights', async () => {
  const harness = await createHarness({ failLedger: true, readingViewId: 'mechanism_chain' });
  await selectStudyType(harness);
  const result = await harness.router.handle({
    type: 'LLM_ANALYZE_DOCUMENT', document: fixtureDocument
  });
  assert.equal(result.success, true);
  assert.ok(result.data.annotations.length > 0);
  assert.equal(result.data.ledger.available, false);
  assert.equal(result.data.ledger.errorCode, 'INVALID_RESPONSE');
});

test('full-body evidence rejects a contradicted missing-information ledger item', async () => {
  const harness = await createHarness({
    readingViewId: 'mechanism_chain',
    ledgerAuditItems: [{
      audit_id: 'audit-dose', kind: 'missing_information',
      message_zh: '待核查：当前证据台账未覆盖 Bobcat339 的剂量、给药或毒性信息',
      search_terms: ['Bobcat339', 'mg/kg', 'intraperitoneally', 'toxicity'],
      confidence: 0.96
    }]
  });
  const document = {
    ...fixtureDocument,
    paragraphs: [
      ...fixtureDocument.paragraphs,
      {
        paragraphId: 'sec-methods-dose', sectionTitle: 'Methods',
        text: 'Bobcat339 2 mg/kg was administered intraperitoneally every 2 days.'
      },
      {
        paragraphId: 'sec-discussion-safety', sectionTitle: 'Discussion',
        text: 'No systemic toxicity was observed in major organs.'
      }
    ]
  };
  await selectStudyType(harness, document);
  const result = await harness.router.handle({
    type: 'LLM_ANALYZE_DOCUMENT', document
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.ledger.auditItems, []);
  assert.equal(result.data.ledger.rejected[0].reason, 'AUDIT_CONTRADICTED_BY_BODY');
});

test('reuses profile, annotation, and ledger caches on an identical analysis', async () => {
  const harness = await createHarness({ readingViewId: 'mechanism_chain' });
  await selectStudyType(harness);
  const first = await harness.router.handle({
    type: 'LLM_ANALYZE_DOCUMENT', document: fixtureDocument
  });
  const stageCount = harness.providerStages.length;
  const second = await harness.router.handle({
    type: 'LLM_ANALYZE_DOCUMENT', document: fixtureDocument
  });
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(harness.providerStages.length, stageCount);
  assert.equal(second.data.requiresStudyType, false);
  assert.equal(second.data.ledgerCacheHit, true);
});
