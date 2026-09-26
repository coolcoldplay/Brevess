const validBlueprint = Object.freeze({
  research_question: 'Does neuronal activity drive complement-dependent synapse loss?',
  primary_hypothesis: 'Increased neuronal activity promotes C1q-dependent synapse loss.',
  population_or_model: ['mouse', 'chemogenetic neuronal activation'],
  interventions_or_exposures: ['CNO', 'C1q blockade'],
  comparators: ['vehicle', 'contralateral hemisphere'],
  primary_outcomes: ['C1q deposition', 'VGLUT2 terminal density'],
  claimed_contribution: 'An activity-dependent immune mechanism refines synapses.'
});

const fixtureParagraphs = Object.freeze([
  { paragraphId: 'sec-abstract-p-001', sectionId: 'sec-abstract', sectionTitle: 'Abstract', text: 'This complete abstract sentence states the question and principal finding.' },
  { paragraphId: 'sec-introduction-p-001', sectionId: 'sec-introduction', sectionTitle: 'Introduction', text: 'How neuronal activity recruits complement remains unknown.' },
  { paragraphId: 'sec-methods-p-001', sectionId: 'sec-methods', sectionTitle: 'Methods', text: 'We activated neurons chemogenetically and quantified synaptic terminals.' },
  { paragraphId: 'sec-results-p-001', sectionId: 'sec-results', sectionTitle: 'Results', text: 'Neuronal activation reduced VGLUT2 terminal density.' },
  { paragraphId: 'sec-results-p-002', sectionId: 'sec-results', sectionTitle: 'Results', text: 'C1q blockade restored VGLUT2 terminal density after neuronal activation.' },
  { paragraphId: 'sec-discussion-p-001', sectionId: 'sec-discussion', sectionTitle: 'Discussion', text: 'These findings support an activity-dependent complement mechanism.' }
]);

const fixtureDocument = Object.freeze({
  title: 'Activity-dependent synapse refinement',
  paragraphs: fixtureParagraphs
});

const rescueParagraphs = Object.freeze(
  fixtureParagraphs.filter(item => item.sectionTitle === 'Results')
);

const criticalParagraphs = Object.freeze([
  { paragraphId: 'discussion-p-010', sectionId: 'sec-discussion', sectionTitle: 'Discussion', text: 'These observational data demonstrate that exposure causes disease progression.' },
  { paragraphId: 'results-p-010', sectionId: 'sec-results', sectionTitle: 'Results', text: 'Exposure was associated with disease progression after age adjustment.' }
]);

const validRescueResponse = Object.freeze({
  chunk_id: 'results-1',
  paragraphs_reviewed: rescueParagraphs.map(item => item.paragraphId),
  annotations: [{
    annotation_id: 'ann-7',
    relation_id: 'mechanism-7',
    category_id: 'rescue_evidence',
    claim_mode: 'explicit',
    highlight_quotes: [
      {
        paragraph_id: 'sec-results-p-001',
        quote: 'Neuronal activation reduced VGLUT2 terminal density.',
        occurrence: 0,
        role: 'initial_abnormality'
      },
      {
        paragraph_id: 'sec-results-p-002',
        quote: 'C1q blockade restored VGLUT2 terminal density after neuronal activation.',
        occurrence: 0,
        role: 'rescued_outcome'
      }
    ],
    slots: [
      { name: 'initial_perturbation', value: 'neuronal activation' },
      { name: 'abnormal_outcome', value: 'reduced VGLUT2 terminal density' },
      { name: 'rescue_action', value: 'C1q blockade' },
      { name: 'rescued_outcome', value: 'restored VGLUT2 terminal density' }
    ],
    confidence: 0.94,
    reason_zh: '补救动作逆转了同一突触结局'
  }]
});

const rescueResponseWithoutInitialAbnormality = Object.freeze({
  chunk_id: 'results-1',
  paragraphs_reviewed: rescueParagraphs.map(item => item.paragraphId),
  annotations: [{
    annotation_id: 'ann-8',
    relation_id: 'mechanism-8',
    category_id: 'rescue_evidence',
    claim_mode: 'explicit',
    highlight_quotes: [{
      paragraph_id: 'sec-results-p-002',
      quote: 'C1q blockade restored VGLUT2 terminal density after neuronal activation.',
      occurrence: 0,
      role: 'rescued_outcome'
    }],
    slots: [
      { name: 'initial_perturbation', value: 'neuronal activation' },
      { name: 'rescue_action', value: 'C1q blockade' },
      { name: 'rescued_outcome', value: 'restored VGLUT2 terminal density' }
    ],
    confidence: 0.93,
    reason_zh: '缺少初始异常槽位'
  }]
});

const warningWithClaimOnly = Object.freeze({
  chunk_id: 'discussion-1',
  paragraphs_reviewed: criticalParagraphs.map(item => item.paragraphId),
  annotations: [{
    annotation_id: 'ann-warning',
    relation_id: 'warning-1',
    category_id: 'causal_overreach',
    claim_mode: 'inferred',
    highlight_quotes: [{
      paragraph_id: 'discussion-p-010',
      quote: 'These observational data demonstrate that exposure causes disease progression.',
      occurrence: 0,
      role: 'claim'
    }],
    slots: [
      { name: 'claim_strength', value: 'causal' },
      { name: 'evidence_strength', value: 'observational' }
    ],
    confidence: 0.93,
    reason_zh: '因果措辞强于证据设计'
  }]
});

const acceptedAnnotations = Object.freeze([
  {
    annotationId: 'ann-1',
    relationId: 'mechanism-1',
    paragraphId: 'sec-results-p-001',
    sectionTitle: 'Results',
    quote: 'Neuronal activation reduced VGLUT2 terminal density.',
    categoryId: 'causal_effect',
    claimMode: 'explicit',
    quoteRole: 'effect',
    slots: [
      { name: 'source', value: 'neuronal activation' },
      { name: 'target', value: 'VGLUT2 terminal density' }
    ],
    confidence: 0.92
  },
  {
    annotationId: 'ann-2',
    relationId: 'mechanism-1',
    paragraphId: 'sec-results-p-002',
    sectionTitle: 'Results',
    quote: 'C1q blockade restored VGLUT2 terminal density after neuronal activation.',
    categoryId: 'rescue_evidence',
    claimMode: 'explicit',
    quoteRole: 'rescued_outcome',
    slots: [{ name: 'rescue_action', value: 'C1q blockade' }],
    confidence: 0.94
  }
]);

const ledgerWithUnknownId = Object.freeze({
  key_annotation_ids: ['ann-missing'],
  relation_summaries: [],
  review_warnings: [],
  audit_items: []
});

const validMissingInformationLedger = Object.freeze({
  key_annotation_ids: ['ann-1'],
  relation_summaries: [],
  review_warnings: [],
  audit_items: [{
    audit_id: 'audit-1',
    kind: 'missing_information',
    message_zh: '待核查：当前证据台账未覆盖外部验证队列',
    search_terms: ['external validation', 'independent cohort'],
    confidence: 0.91
  }]
});

module.exports = {
  validBlueprint,
  fixtureParagraphs,
  fixtureDocument,
  rescueParagraphs,
  criticalParagraphs,
  validRescueResponse,
  rescueResponseWithoutInitialAbnormality,
  warningWithClaimOnly,
  acceptedAnnotations,
  ledgerWithUnknownId,
  validMissingInformationLedger
};
