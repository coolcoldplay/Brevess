const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateAnnotationSemantics,
  validateAnnotationStructureSemantics
} = require('../core/result-validator.js');

// Adversarial evidence structures abstracted from the open-access paper set in
// docs/testing/oa-paper-benchmark.md. The benchmark deliberately tests semantic
// distinctions rather than journal-specific keywords or CSS structure.
const cases = [
  {
    name: 'rejects a p value alone as effect uncertainty',
    categoryId: 'effect_uncertainty',
    quotes: ['The between-group difference was statistically significant (P < 0.001).'],
    valid: false,
    reason: 'UNCERTAINTY_EVIDENCE_MISSING'
  },
  {
    name: 'accepts an effect estimate with a confidence interval',
    categoryId: 'effect_uncertainty',
    quotes: ['The adjusted hazard ratio was 1.25 (95% CI 1.06 to 1.49).'],
    valid: true
  },
  {
    name: 'rejects internal cross-validation as external validation',
    categoryId: 'replication_external_validation',
    quotes: ['Ten-fold cross-validation in the training cohort yielded an AUC of 0.91.'],
    valid: false,
    reason: 'INTERNAL_VALIDATION_IS_NOT_EXTERNAL'
  },
  {
    name: 'accepts performance retained in an independent external cohort',
    categoryId: 'replication_external_validation',
    quotes: ['Calibration was retained in an independent external cohort.'],
    valid: true
  },
  {
    name: 'rejects model performance without an external validation source',
    categoryId: 'replication_external_validation',
    quotes: ['The model achieved an AUC of 0.91.'],
    valid: false,
    reason: 'EXTERNAL_VALIDATION_EVIDENCE_MISSING'
  },
  {
    name: 'rejects an interval availability statement without an effect estimate',
    categoryId: 'effect_uncertainty',
    quotes: ['The 95% confidence interval was not reported.'],
    valid: false,
    reason: 'EFFECT_ESTIMATE_MISSING'
  },
  {
    name: 'rejects significance without practical importance evidence',
    categoryId: 'statistical_vs_practical_significance',
    quotes: ['The result was statistically significant at P = 0.03.'],
    valid: false,
    reason: 'PRACTICAL_SIGNIFICANCE_EVIDENCE_MISSING'
  },
  {
    name: 'accepts an explicit comparison with a clinical threshold',
    categoryId: 'statistical_vs_practical_significance',
    quotes: ['The significant difference was below the prespecified clinically meaningful threshold.'],
    valid: true
  },
  {
    name: 'rejects clinical importance without a statistical result to compare',
    categoryId: 'statistical_vs_practical_significance',
    quotes: ['The improvement was clinically meaningful.'],
    valid: false,
    reason: 'STATISTICAL_EVIDENCE_MISSING'
  },
  {
    name: 'rejects ordinary treatment improvement as a mechanistic rescue',
    categoryId: 'rescue_evidence',
    quotes: [
      'Disease induction reduced survival.',
      'Drug treatment improved survival compared with vehicle.'
    ],
    slots: [
      { name: 'initial_perturbation', value: 'Disease induction' },
      { name: 'abnormal_outcome', value: 'reduced survival' },
      { name: 'rescue_action', value: 'Drug treatment' },
      { name: 'rescued_outcome', value: 'improved survival' }
    ],
    valid: false,
    reason: 'RESCUE_STRUCTURE_MISSING'
  },
  {
    name: 'accepts restoration of the same outcome after a distinct rescue action',
    categoryId: 'rescue_evidence',
    quotes: [
      'Neuronal activation reduced VGLUT2 terminal density.',
      'C1q blockade restored VGLUT2 terminal density after neuronal activation.'
    ],
    slots: [
      { name: 'initial_perturbation', value: 'neuronal activation' },
      { name: 'abnormal_outcome', value: 'reduced VGLUT2 terminal density' },
      { name: 'rescue_action', value: 'C1q blockade' },
      { name: 'rescued_outcome', value: 'restored VGLUT2 terminal density' }
    ],
    valid: true
  },
  {
    name: 'rejects hallucinated evidence-slot values',
    categoryId: 'rescue_evidence',
    quotes: [
      'Neuronal activation reduced VGLUT2 terminal density.',
      'C1q blockade restored VGLUT2 terminal density after neuronal activation.'
    ],
    slots: [
      { name: 'initial_perturbation', value: 'neuronal activation' },
      { name: 'abnormal_outcome', value: 'reduced VGLUT2 terminal density' },
      { name: 'rescue_action', value: 'anti-C1q antibody treatment' },
      { name: 'rescued_outcome', value: 'restored VGLUT2 terminal density' }
    ],
    valid: false,
    reason: 'SLOT_VALUE_NOT_GROUNDED'
  },
  {
    name: 'rejects a knockout group difference without a necessity chain',
    categoryId: 'necessity_evidence',
    quotes: ['C1q-deficient mice had more VGLUT2 terminals than controls.'],
    slots: [
      { name: 'upstream_factor', value: 'C1q' },
      { name: 'blocked_mediator', value: 'C1q-deficient' },
      { name: 'target_outcome', value: 'VGLUT2 terminals' },
      { name: 'effect_reduction', value: 'more VGLUT2 terminals' }
    ],
    valid: false,
    reason: 'NECESSITY_STRUCTURE_MISSING'
  },
  {
    name: 'rejects post-stimulation change as sufficiency',
    categoryId: 'sufficiency_evidence',
    quotes: ['C1q increased after neuronal stimulation.'],
    slots: [
      { name: 'activated_mediator', value: 'C1q' },
      { name: 'absent_upstream_stimulus', value: 'after neuronal stimulation' },
      { name: 'target_outcome', value: 'increased' }
    ],
    valid: false,
    reason: 'SUFFICIENCY_STRUCTURE_MISSING'
  },
  {
    name: 'rejects a routine administered dose as temporal or dose-response evidence',
    categoryId: 'temporal_dose_evidence',
    quotes: ['Mice received 2 mg/kg CNO once daily.'],
    valid: false,
    reason: 'TIME_DOSE_RELATIONSHIP_MISSING'
  },
  {
    name: 'accepts an explicit dose-response result',
    categoryId: 'temporal_dose_evidence',
    quotes: ['C1q deposition increased in a dose-dependent manner as stimulation intensity rose.'],
    valid: true
  },
  {
    name: 'rejects pathway enrichment alone as a mechanism mediator',
    categoryId: 'mechanism_mediator',
    quotes: ['Pathway enrichment identified TNF signaling among differentially expressed genes.'],
    valid: false,
    reason: 'ENRICHMENT_IS_NOT_MEDIATOR_EVIDENCE'
  },
  {
    name: 'rejects technical repeats as cross-system validation',
    categoryId: 'cross_system_validation',
    quotes: ['The effect was reproduced in technical replicates of the same samples.'],
    valid: false,
    reason: 'INDEPENDENT_SYSTEM_EVIDENCE_MISSING'
  }
];

for (const item of cases) {
  test(item.name, () => {
    const result = validateAnnotationStructureSemantics(item);
    assert.equal(result.valid, item.valid);
    if (item.reason) assert.equal(result.reason, item.reason);
  });
}

test('rejects association language returned as a causal effect', () => {
  const result = validateAnnotationSemantics({
    categoryId: 'causal_effect',
    quote: 'Higher C1q abundance was associated with fewer VGLUT2 terminals.'
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'ASSOCIATION_IS_NOT_CAUSAL');
});

test('rejects prospective hypothesis language as a novelty finding', () => {
  const result = validateAnnotationSemantics({
    categoryId: 'significance_novelty',
    quote: 'We hypothesized that the inhibitor would restore treatment sensitivity.'
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'HYPOTHESIS_IS_NOT_SIGNIFICANCE');
});

test('does not let a later therefore upgrade an earlier association to causality', () => {
  const result = validateAnnotationSemantics({
    categoryId: 'causal_effect',
    quote: 'Poor functional status was associated with dialysis treatment; therefore clinicians should discuss end-of-life care.'
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'ASSOCIATION_IS_NOT_CAUSAL');
});
