const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateChunkResult,
  mergeAnnotations,
  validateAnnotationSemantics,
  validateAnnotationStructureSemantics
} = require('../core/result-validator.js');
require('../core/category-store.js');
const { createAdaptiveCategoryCatalog } = require('../core/adaptive-catalog.js');

test('necessity manipulation accepts inhibiting while still requiring an observed reduced outcome', () => {
  for (const quote of [
    'Inhibiting kinase K abolished growth-factor-induced proliferation.',
    'The intervention inhibits kinase K and abolished growth-factor-induced proliferation.'
  ]) {
    assert.equal(validateAnnotationStructureSemantics({
      categoryId: 'necessity_evidence', quotes: [quote], slots: []
    }).valid, true);
  }
  for (const quote of [
    'Inhibiting kinase K changed its phosphorylation state.',
    'The growth-factor response was abolished in the second cohort.'
  ]) {
    assert.deepEqual(validateAnnotationStructureSemantics({
      categoryId: 'necessity_evidence', quotes: [quote], slots: []
    }), { valid: false, reason: 'NECESSITY_STRUCTURE_MISSING' });
  }
});
const {
  rescueParagraphs,
  criticalParagraphs,
  validRescueResponse,
  rescueResponseWithoutInitialAbnormality,
  warningWithClaimOnly
} = require('./helpers/adaptive-fixtures.js');

const paragraphs = [{
  paragraphId: 'p1',
  text: 'Compared with controls, treatment increased survival. treatment increased survival.'
}];

function reviewValidationInput({ categoryId, quotes, directions = ['improvement', 'no improvement'] }) {
  const categories = createAdaptiveCategoryCatalog();
  const reviewParagraphs = [
    { paragraphId: 'p1', text: 'Study A reported improvement in survival.' },
    { paragraphId: 'p2', text: 'Study B reported no improvement in survival.' }
  ];
  return {
    paragraphs: reviewParagraphs,
    requestedCategories: [categories[categoryId]],
    response: {
      chunk_id: 'review-1',
      paragraphs_reviewed: reviewParagraphs.map(item => item.paragraphId),
      annotations: [{
        annotation_id: 'ann-review', relation_id: 'rel-review',
        category_id: categoryId, claim_mode: 'explicit',
        highlight_quotes: quotes,
        slots: [
          { name: 'target_claim', value: 'survival' },
          { name: 'evidence_a_direction', value: directions[0] },
          { name: 'evidence_b_direction', value: directions[1] },
          ...(categoryId === 'conflicting_evidence'
            ? [{ name: 'contrast_basis', value: 'improvement' }] : [])
        ],
        confidence: 0.95, reason_zh: '比较两个证据来源'
      }]
    }
  };
}

function validConflictingEvidenceInput() {
  return reviewValidationInput({
    categoryId: 'conflicting_evidence',
    quotes: [
      { paragraph_id: 'p1', quote: 'Study A reported improvement in survival.', role: 'evidence_a' },
      { paragraph_id: 'p2', quote: 'Study B reported no improvement in survival.', role: 'evidence_b' }
    ]
  });
}

test('rejects conflicting evidence with fewer than two distinct evidence quotes', () => {
  const result = validateChunkResult(reviewValidationInput({
    categoryId: 'conflicting_evidence',
    quotes: [{
      paragraph_id: 'p1', quote: 'Study A reported improvement in survival.', role: 'evidence_a'
    }]
  }));
  assert.equal(result.annotations.length, 0);
  assert.equal(result.rejected[0].reason, 'REVIEW_RELATION_NEEDS_TWO_EVIDENCE_SOURCES');
});

test('accepts grounded opposing evidence for the same target claim', () => {
  const result = validateChunkResult(validConflictingEvidenceInput());
  assert.equal(result.annotations.length, 2);
  assert.equal(new Set(result.annotations.map(item => item.relationId)).size, 1);
});

test('rejects evidence consensus when the two evidence directions conflict', () => {
  const result = validateChunkResult(reviewValidationInput({
    categoryId: 'evidence_consensus',
    quotes: [
      { paragraph_id: 'p1', quote: 'Study A reported improvement in survival.', role: 'evidence_a' },
      { paragraph_id: 'p2', quote: 'Study B reported no improvement in survival.', role: 'evidence_b' }
    ]
  }));
  assert.equal(result.annotations.length, 0);
  assert.equal(result.rejected[0].reason, 'REVIEW_RELATION_DIRECTION_MISMATCH');
});

test('calculates offsets from exact quote and occurrence', () => {
  const result = validateChunkResult({
    paragraphs,
    requestedCategoryIds: ['result'],
    response: {
      paragraphs_reviewed: ['p1'],
      annotations: [{
        paragraph_id: 'p1',
        quote: 'treatment increased survival.',
        occurrence: 1,
        category_id: 'result',
        confidence: 0.91,
        reason_zh: '直接报告结果'
      }]
    }
  });
  assert.equal(result.annotations[0].start, 54);
  assert.equal(result.annotations[0].end, 83);
  assert.deepEqual(result.missingParagraphIds, []);
});

test('grounds quotes across inline figure references and superscript variants', () => {
  const paragraph = {
    paragraphId: 'p-figure-ref',
    text: 'Notably, rKLK14 suppressed eWAT lipolysis in vivo (Figure S5F) but not in cultured adipocytes (Figure S5G), indicating that KLK14 acts through hypothalamic LRRC7⁺ astrocytes.'
  };
  const result = validateChunkResult({
    paragraphs: [paragraph],
    requestedCategoryIds: ['result'],
    response: {
      chunk_id: 'results-1', paragraphs_reviewed: [paragraph.paragraphId],
      annotations: [{
        paragraph_id: paragraph.paragraphId,
        category_id: 'result',
        quote: 'Notably, rKLK14 suppressed eWAT lipolysis in vivo but not in cultured adipocytes, indicating that KLK14 acts through hypothalamic LRRC7+ astrocytes.',
        occurrence: 0, confidence: 0.93, reason_zh: '关键结果'
      }]
    }
  });
  assert.equal(result.rejected.length, 0);
  assert.equal(result.annotations.length, 1);
  assert.equal(paragraph.text.slice(result.annotations[0].start, result.annotations[0].end), result.annotations[0].quote);
  assert.match(result.annotations[0].quote, /Figure S5F/);
  assert.match(result.annotations[0].quote, /LRRC7⁺/);
});

test('grounds a quote when DOM citation numbers interrupt the sentence', () => {
  const paragraph = {
    paragraphId: 'p-citation',
    text: 'Astrocytes are molecularly and functionally heterogeneous,12 and certain subsets undergo long-lasting adaptation to environmental cues.'
  };
  const result = validateChunkResult({
    paragraphs: [paragraph],
    requestedCategoryIds: ['background'],
    response: {
      chunk_id: 'introduction-1', paragraphs_reviewed: [paragraph.paragraphId],
      annotations: [{
        paragraph_id: paragraph.paragraphId,
        category_id: 'background',
        quote: 'Astrocytes are molecularly and functionally heterogeneous, and certain subsets undergo long-lasting adaptation to environmental cues.',
        occurrence: 0, confidence: 0.9, reason_zh: '研究背景'
      }]
    }
  });
  assert.equal(result.rejected.length, 0);
  assert.equal(result.annotations.length, 1);
  assert.equal(result.annotations[0].quote, paragraph.text);
});

test('rejects invalid annotations and categories not requested', () => {
  const result = validateChunkResult({
    paragraphs,
    requestedCategoryIds: ['result'],
    response: {
      paragraphs_reviewed: ['p1'],
      annotations: [
        { paragraph_id: 'p1', quote: 'invented', occurrence: 0, category_id: 'result', confidence: 0.8 },
        { paragraph_id: 'p1', quote: 'Compared with controls', occurrence: 0, category_id: 'comparison', confidence: 0.8 },
        { paragraph_id: 'p1', quote: '', occurrence: 0, category_id: 'result', confidence: 0.8 },
        { paragraph_id: 'p1', quote: 'Compared with controls', occurrence: 0, category_id: 'result', confidence: 'unknown' }
      ]
    }
  });
  assert.equal(result.annotations.length, 0);
  assert.equal(result.rejected.length, 4);
});

test('keeps separate category relations while grouping the same span', () => {
  const grouped = mergeAnnotations([
    { paragraphId: 'p1', start: 0, end: 22, quote: 'Compared with controls', categoryId: 'comparison', confidence: 0.9 },
    { paragraphId: 'p1', start: 0, end: 22, quote: 'Compared with controls', categoryId: 'result', confidence: 0.7 }
  ]);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].categories.map(item => item.categoryId), ['comparison', 'result']);
});

test('deduplicates the same evidence returned by overlapping chunks', () => {
  const grouped = mergeAnnotations([
    {
      paragraphId: 'p1', start: 0, end: 22, quote: 'Compared with controls',
      categoryId: 'comparison', quoteRole: 'statement', slots: [],
      annotationId: 'chunk-001:ann-1', relationId: 'chunk-001:rel-1', confidence: 0.84
    },
    {
      paragraphId: 'p1', start: 0, end: 22, quote: 'Compared with controls',
      categoryId: 'comparison', quoteRole: 'statement', slots: [],
      annotationId: 'chunk-002:ann-1', relationId: 'chunk-002:rel-1', confidence: 0.91
    }
  ]);
  assert.equal(grouped[0].categories.length, 1);
  assert.equal(grouped[0].categories[0].annotationId, 'chunk-002:ann-1');
});

test('uses the requested chunk namespace even when the model repeats local ids', () => {
  const response = {
    chunk_id: 'model-invented-id',
    paragraphs_reviewed: ['p1'],
    annotations: [{
      paragraph_id: 'p1', quote: 'Compared with controls', occurrence: 0,
      category_id: 'comparison', confidence: 0.9, reason_zh: 'comparison'
    }]
  };
  const result = validateChunkResult({
    paragraphs,
    requestedCategoryIds: ['comparison'],
    expectedChunkId: 'chunk-013',
    response
  });
  assert.match(result.annotations[0].annotationId, /^chunk-013:/);
});

test('rejects isolated rhetorical cue words for every category', () => {
  ['as', 'because', 'therefore'].forEach(quote => {
    assert.equal(validateAnnotationSemantics({ quote, categoryId: 'causality' }).valid, false);
  });
});

test('rejects high-certainty non-causal uses of ambiguous conjunctions', () => {
  [
    'As shown in Fig. 1, survival increased.',
    'As an example, we examined the control group.',
    'Since 2020, this method has been widely used.',
    'While incubating the sections, we prepared the buffer.'
  ].forEach(quote => {
    assert.equal(validateAnnotationSemantics({ quote, categoryId: 'causality' }).valid, false, quote);
  });
});

test('accepts a complete explicit causal relationship', () => {
  assert.deepEqual(validateAnnotationSemantics({
    quote: 'Increased neuronal activity caused C1q deposition.',
    categoryId: 'causality'
  }), { valid: true, reason: '' });
});

test('rejects a high-confidence non-causal model annotation before caching', () => {
  const paragraph = {
    paragraphId: 'p-cause',
    text: 'As shown in Fig. 1, survival increased.'
  };
  const result = validateChunkResult({
    paragraphs: [paragraph],
    requestedCategoryIds: ['causality'],
    response: {
      paragraphs_reviewed: ['p-cause'],
      annotations: [{
        paragraph_id: 'p-cause',
        quote: paragraph.text,
        occurrence: 0,
        category_id: 'causality',
        confidence: 0.96,
        reason_zh: 'Incorrectly inferred causality from as'
      }]
    }
  });
  assert.equal(result.annotations.length, 0);
  assert.equal(result.rejected[0].reason, 'NON_CAUSAL_AMBIGUOUS_CUE');
});

test('expands valid multi-quote rescue evidence and preserves relation metadata', () => {
  const categories = createAdaptiveCategoryCatalog();
  const result = validateChunkResult({
    paragraphs: rescueParagraphs,
    requestedCategories: [categories.rescue_evidence],
    response: validRescueResponse
  });
  assert.equal(result.annotations.length, 2);
  assert.equal(result.annotations[0].relationId, 'results-1:mechanism-7');
  assert.equal(result.annotations[0].annotationId, 'results-1:ann-7');
  assert.equal(result.annotations[0].claimMode, 'explicit');
});

test('rejects rescue evidence when a required slot is missing', () => {
  const categories = createAdaptiveCategoryCatalog();
  const result = validateChunkResult({
    paragraphs: rescueParagraphs,
    requestedCategories: [categories.rescue_evidence],
    response: rescueResponseWithoutInitialAbnormality
  });
  assert.equal(result.annotations.length, 0);
  assert.equal(result.rejected[0].reason, 'MISSING_REQUIRED_SLOT');
});

test('rejects inferred critical warnings without claim and evidence quote roles', () => {
  const categories = createAdaptiveCategoryCatalog();
  const result = validateChunkResult({
    paragraphs: criticalParagraphs,
    requestedCategories: [categories.causal_overreach],
    response: warningWithClaimOnly
  });
  assert.equal(result.annotations.length, 0);
  assert.equal(result.rejected[0].reason, 'INFERRED_WARNING_MISSING_EVIDENCE');
});

test('rejects non-causal ambiguous cues for adaptive causal effects', () => {
  assert.equal(validateAnnotationSemantics({
    quote: 'As shown in Fig. 1, survival increased.',
    categoryId: 'causal_effect'
  }).valid, false);
});

test('rejects an association relation when a required variable is absent from its quotes', () => {
  const categories = createAdaptiveCategoryCatalog();
  const paragraph = {
    paragraphId: 'p-association',
    text: 'Higher C1q abundance was associated with fewer VGLUT2 terminals.'
  };
  const result = validateChunkResult({
    paragraphs: [paragraph],
    requestedCategories: [categories.association_evidence],
    response: {
      chunk_id: 'results-association',
      paragraphs_reviewed: [paragraph.paragraphId],
      annotations: [{
        annotation_id: 'ann-association',
        relation_id: 'rel-association',
        category_id: 'association_evidence',
        claim_mode: 'explicit',
        highlight_quotes: [{
          paragraph_id: paragraph.paragraphId,
          quote: paragraph.text,
          occurrence: 0,
          role: 'association_statement'
        }],
        slots: [
          { name: 'variable_a', value: 'C1q abundance' },
          { name: 'variable_b', value: 'microglial activation' },
          { name: 'association', value: 'associated with' }
        ],
        confidence: 0.96,
        reason_zh: '变量共同变化'
      }]
    }
  });
  assert.equal(result.annotations.length, 0);
  assert.equal(result.rejected[0].reason, 'SLOT_VALUE_NOT_GROUNDED');
});

test('rejects a stated hypothesis as significance or novelty', () => {
  const categories = createAdaptiveCategoryCatalog();
  const paragraph = {
    paragraphId: 'p-hypothesis',
    text: 'We hypothesized that knocking down TET1 would reprogram TAMs toward an antitumor phenotype.'
  };
  const result = validateChunkResult({
    paragraphs: [paragraph],
    requestedCategories: [categories.significance_novelty],
    response: {
      chunk_id: 'introduction-1',
      paragraphs_reviewed: [paragraph.paragraphId],
      annotations: [{
        annotation_id: 'ann-hypothesis', relation_id: '',
        category_id: 'significance_novelty', claim_mode: 'explicit',
        highlight_quotes: [{
          paragraph_id: paragraph.paragraphId, quote: paragraph.text,
          occurrence: 0, role: 'significance_statement'
        }],
        slots: [
          { name: 'contribution', value: 'knocking down TET1' },
          { name: 'field_impact', value: 'reprogram TAMs' }
        ],
        confidence: 0.95,
        reason_zh: '提出了新的免疫重编程机制'
      }]
    }
  });
  assert.deepEqual(result.annotations, []);
  assert.equal(result.rejected[0].reason, 'HYPOTHESIS_IS_NOT_SIGNIFICANCE');
});

test('rejects a stated research objective as significance or novelty', () => {
  const result = validateAnnotationSemantics({
    categoryId: 'significance_novelty',
    quote: 'We sought to determine whether the model generalized to human samples.'
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'HYPOTHESIS_IS_NOT_SIGNIFICANCE');
});

test('distinguishes a proposed contribution from a proposed hypothesis', () => {
  assert.equal(validateAnnotationSemantics({
    categoryId: 'significance_novelty',
    quote: 'We propose a novel calibration framework for external validation.'
  }).valid, true);
  const hypothesis = validateAnnotationSemantics({
    categoryId: 'significance_novelty',
    quote: 'We propose that higher exposure causes disease progression.'
  });
  assert.equal(hypothesis.valid, false);
  assert.equal(hypothesis.reason, 'HYPOTHESIS_IS_NOT_SIGNIFICANCE');
});

test('caps hedged association confidence and removes causal overclaiming from its reason', () => {
  const categories = createAdaptiveCategoryCatalog();
  const paragraph = {
    paragraphId: 'p-associated',
    text: 'TET1 depletion was associated with reduced ROS1 expression, suggesting attenuation of ERK signaling.'
  };
  const result = validateChunkResult({
    paragraphs: [paragraph],
    requestedCategories: [categories.key_result],
    response: {
      chunk_id: 'results-hedged',
      paragraphs_reviewed: [paragraph.paragraphId],
      annotations: [{
        annotation_id: 'ann-hedged', relation_id: '',
        category_id: 'key_result', claim_mode: 'explicit',
        highlight_quotes: [{
          paragraph_id: paragraph.paragraphId, quote: paragraph.text,
          occurrence: 0, role: 'key_finding'
        }],
        slots: [
          { name: 'finding', value: 'reduced ROS1 expression' },
          { name: 'primary_outcome', value: 'attenuation of ERK signaling' },
          { name: 'blueprint_link', value: 'TET1 depletion' }
        ],
        confidence: 0.95,
        reason_zh: '建立了TET1-ROS1-ERK因果链条'
      }]
    }
  });
  assert.equal(result.annotations.length, 1);
  assert.equal(result.annotations[0].confidence, 0.85);
  assert.equal(result.annotations[0].reasonZh, '原文仅支持相关或提示性解释，未建立确定因果');
});
