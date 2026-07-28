const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/category-store.js');
const {
  STUDY_TYPES,
  READING_VIEWS,
  createAdaptiveCategoryCatalog,
  composeReadingView
} = require('../core/adaptive-catalog.js');

test('defines nine study types and four reading views', () => {
  assert.deepEqual(Object.keys(STUDY_TYPES), [
    'basic_mechanistic', 'preclinical_translational', 'observational',
    'clinical_trial', 'diagnostic_prognostic', 'omics_high_throughput',
    'narrative_review', 'systematic_review_meta', 'methods_resource'
  ]);
  assert.equal(STUDY_TYPES.narrative_review.name, '叙述性综述（机制/转化）');
  assert.deepEqual(Object.keys(READING_VIEWS), [
    'quick_story', 'mechanism_chain', 'critical_review', 'review_synthesis'
  ]);
});

test('defines a review synthesis view with grounded synthesis categories', () => {
  assert.ok(READING_VIEWS.review_synthesis);
  assert.deepEqual(READING_VIEWS.review_synthesis.categoryIds, [
    'review_scope_thesis', 'evidence_consensus', 'conflicting_evidence',
    'heterogeneity_source', 'evidence_quality_certainty', 'integrative_framework',
    'author_synthesis', 'knowledge_gap', 'evidence', 'conclusion',
    'limitation', 'future'
  ]);
  const catalog = createAdaptiveCategoryCatalog();
  for (const id of READING_VIEWS.review_synthesis.categoryIds) assert.ok(catalog[id]);
  assert.equal(catalog.conflicting_evidence.minimumConfidence, 0.9);
  assert.deepEqual(catalog.conflicting_evidence.allowedQuoteRoles, [
    'evidence_a', 'evidence_b', 'synthesis_statement'
  ]);
});

test('every adaptive category contains executable recognition constraints', () => {
  for (const category of Object.values(createAdaptiveCategoryCatalog())) {
    assert.match(category.categoryId, /^[a-z][a-z0-9_]*$/);
    assert.ok(category.decisionQuestion.length > 10, category.categoryId);
    assert.ok(category.includeAll.length > 0, category.categoryId);
    assert.ok(category.excludeAny.length > 0, category.categoryId);
    assert.ok(category.positiveExamples.length > 0, category.categoryId);
    assert.ok(category.hardNegativeExamples.length > 0, category.categoryId);
    assert.ok(['explicit', 'inferred', 'either'].includes(category.claimMode), category.categoryId);
  }
});

test('strong mechanism categories require discriminating evidence slots', () => {
  const categories = createAdaptiveCategoryCatalog();
  assert.deepEqual(categories.necessity_evidence.requiredSlots, [
    'upstream_factor', 'blocked_mediator', 'target_outcome', 'effect_reduction'
  ]);
  assert.deepEqual(categories.sufficiency_evidence.requiredSlots, [
    'activated_mediator', 'absent_upstream_stimulus', 'target_outcome'
  ]);
  assert.deepEqual(categories.rescue_evidence.requiredSlots, [
    'initial_perturbation', 'abnormal_outcome', 'rescue_action', 'rescued_outcome'
  ]);
});

test('critical inferences carry a fixed 0.90 category floor', () => {
  const categories = createAdaptiveCategoryCatalog();
  ['causal_overreach', 'confounding_reverse_causality', 'alternative_explanation']
    .forEach(categoryId => {
      assert.equal(categories[categoryId].claimMode, 'inferred');
      assert.equal(categories[categoryId].minimumConfidence, 0.9);
    });
});

test('composes primary plus at most four secondary overlays and manual changes', () => {
  const result = composeReadingView({
    viewId: 'mechanism_chain',
    studyProfile: {
      primaryType: 'basic_mechanistic',
      secondaryType: 'preclinical_translational',
      confidence: 0.92
    },
    override: { add: ['limitation'], remove: ['association_evidence'] },
    customCategories: []
  });
  assert.equal(result.categoryIds.includes('association_evidence'), false);
  assert.equal(result.categoryIds.includes('limitation'), true);
  assert.ok(result.sources.filter(item => item.source === 'secondary_type').length <= 4);
});

test('permanently deleted built-ins stay out of default, overlay, and manual composition', () => {
  const result = composeReadingView({
    viewId: 'mechanism_chain',
    studyProfile: {
      primaryType: 'basic_mechanistic',
      secondaryType: 'preclinical_translational',
      confidence: 0.92
    },
    override: { add: ['limitation', 'causality'], remove: [] },
    deletedBuiltInCategoryIds: ['limitation', 'causality']
  });
  assert.equal(result.categoryIds.includes('limitation'), false);
  assert.equal(result.categoryIds.includes('causality'), false);
  assert.equal(result.categories.some(category =>
    ['limitation', 'causality'].includes(category.categoryId)
  ), false);
});

test('low-confidence generic profile does not load type overlays', () => {
  const result = composeReadingView({
    viewId: 'quick_story',
    studyProfile: {
      primaryType: 'clinical_trial',
      secondaryType: null,
      confidence: 0.6,
      useTypeSpecificWarnings: false
    },
    override: { add: [], remove: [] }
  });
  assert.equal(result.sources.some(item => item.source === 'primary_type'), false);
});

test('keeps quick story compact instead of importing unrelated type categories', () => {
  const result = composeReadingView({
    viewId: 'quick_story',
    studyProfile: {
      primaryType: 'basic_mechanistic',
      secondaryType: 'preclinical_translational',
      confidence: 0.96
    },
    override: { add: [], remove: [] }
  });
  assert.deepEqual(result.categoryIds, READING_VIEWS.quick_story.categoryIds);
  assert.ok(result.categoryIds.includes('method'));
  assert.ok(result.categoryIds.includes('result'));
  assert.ok(result.categoryIds.includes('interpretation'));
});

test('treats prospective hypotheses as a hard negative for novelty', () => {
  const category = createAdaptiveCategoryCatalog().significance_novelty;
  assert.match(category.hardNegativeExamples.join(' '), /hypothesized/i);
});

test('composes merged category overrides and filters categories by requested engine', () => {
  const overrides = {
    limitation: {
      name: '适用边界',
      enabledEngines: ['regex'],
      prompt: {
        definition: 'OVERRIDDEN LIMITATION DEFINITION',
        positiveExamples: ['OVERRIDDEN LIMITATION EXAMPLE'],
        minimumConfidence: 0.93
      }
    }
  };
  const allEngines = composeReadingView({
    viewId: 'quick_story',
    studyProfile: { primaryType: 'observational', secondaryType: null, confidence: 1 },
    override: { add: [], remove: [] },
    categoryOverrides: overrides
  });
  const limitation = allEngines.categories
    .find(category => category.categoryId === 'limitation');
  assert.equal(limitation.name, '适用边界');
  assert.equal(limitation.definition, 'OVERRIDDEN LIMITATION DEFINITION');
  assert.deepEqual(limitation.positiveExamples, ['OVERRIDDEN LIMITATION EXAMPLE']);
  assert.equal(limitation.minimumConfidence, 0.93);

  const llmOnly = composeReadingView({
    viewId: 'quick_story',
    studyProfile: { primaryType: 'observational', secondaryType: null, confidence: 1 },
    override: { add: [], remove: [] },
    categoryOverrides: overrides,
    engine: 'llm'
  });
  assert.equal(llmOnly.categoryIds.includes('limitation'), false);
  assert.equal(llmOnly.sources.some(item => item.categoryId === 'limitation'), false);
});
