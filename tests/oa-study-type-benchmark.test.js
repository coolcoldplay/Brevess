const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/category-store.js');
const {
  STUDY_TYPES,
  READING_VIEWS,
  TYPE_PROMPT_GUIDANCE,
  VIEW_PROMPT_GUIDANCE,
  composeReadingView
} = require('../core/adaptive-catalog.js');
const { OA_PAPER_BENCHMARK } = require('./helpers/oa-paper-benchmark.js');

test('open-access benchmark covers all nine study types', () => {
  const covered = new Set(OA_PAPER_BENCHMARK.map(item => item.expectedPrimaryType));
  assert.deepEqual([...covered].sort(), Object.keys(STUDY_TYPES).sort());
  assert.equal(OA_PAPER_BENCHMARK.every(item => item.sourceUrl.startsWith('https://')), true);
  assert.ok(OA_PAPER_BENCHMARK.length >= 16);
  assert.equal(new Set(OA_PAPER_BENCHMARK.map(item => item.id)).size, OA_PAPER_BENCHMARK.length);
});

test('every benchmark profile resolves to valid view compositions', () => {
  for (const paper of OA_PAPER_BENCHMARK) {
    for (const viewId of Object.keys(READING_VIEWS)) {
      const result = composeReadingView({
        viewId,
        studyProfile: {
          primaryType: paper.expectedPrimaryType,
          secondaryType: paper.expectedSecondaryType,
          confidence: 0.95,
          useTypeSpecificWarnings: true
        },
        override: { add: [], remove: [] }
      });
      assert.ok(result.categoryIds.length > 0, `${paper.id}:${viewId}`);
      assert.equal(new Set(result.categoryIds).size, result.categoryIds.length);
    }
  }
});

test('study and view guidance encode the evidence boundaries found in the paper set', () => {
  assert.match(TYPE_PROMPT_GUIDANCE.observational, /adjusted association/i);
  assert.match(TYPE_PROMPT_GUIDANCE.clinical_trial, /p value without effect magnitude/i);
  assert.match(TYPE_PROMPT_GUIDANCE.diagnostic_prognostic, /AUC alone/i);
  assert.match(TYPE_PROMPT_GUIDANCE.omics_high_throughput, /does not establish a biological mechanism/i);
  assert.match(TYPE_PROMPT_GUIDANCE.narrative_review, /translational hypothesis/i);
  assert.match(TYPE_PROMPT_GUIDANCE.systematic_review_meta, /inherits the causal limitations/i);
  assert.match(TYPE_PROMPT_GUIDANCE.methods_resource, /not external validation/i);
  assert.match(VIEW_PROMPT_GUIDANCE.mechanism_chain, /distinct evidence levels/i);
  assert.match(VIEW_PROMPT_GUIDANCE.critical_review, /not generic textbook criticism/i);
});
