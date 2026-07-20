const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compileEvidenceLedgerPrompt,
  validateEvidenceLedger,
  reviewEvidenceLedger,
  MISSING_INFORMATION_PREFIX,
  EVIDENCE_LEDGER_VERSION
} = require('../core/evidence-ledger.js');
const {
  validBlueprint,
  acceptedAnnotations,
  ledgerWithUnknownId,
  validMissingInformationLedger
} = require('./helpers/adaptive-fixtures.js');

const studyProfile = Object.freeze({
  primaryType: 'basic_mechanistic',
  secondaryType: null,
  confidence: 0.92,
  reasonZh: '包含机制干预',
  paperBlueprint: validBlueprint
});

test('uses the relation-grounding ledger cache version', () => {
  assert.equal(EVIDENCE_LEDGER_VERSION, '5');
});

test('ledger request contains accepted quotes but never full paragraphs or credentials', () => {
  const request = compileEvidenceLedgerPrompt({
    viewId: 'critical_review',
    studyProfile,
    annotations: acceptedAnnotations
  });
  const payload = JSON.parse(request.userPrompt);
  assert.equal(payload.annotations[0].quote, acceptedAnnotations[0].quote);
  assert.equal(JSON.stringify(payload).includes('UNANNOTATED_FULL_PARAGRAPH'), false);
  assert.equal(JSON.stringify(payload).includes('apiKey'), false);
  assert.match(request.systemPrompt, /search_terms/);
  assert.equal(
    request.responseSchema.properties.audit_items.items.required.includes('search_terms'),
    true
  );
});

test('rejects ledger references to unknown annotation ids', () => {
  const result = validateEvidenceLedger({
    response: ledgerWithUnknownId,
    annotations: acceptedAnnotations
  });
  assert.deepEqual(result.keyAnnotationIds, []);
  assert.equal(result.rejected[0].reason, 'UNKNOWN_ANNOTATION_REFERENCE');
});

test('normalizes missing information as an audit item rather than a highlight', () => {
  const result = validateEvidenceLedger({
    response: validMissingInformationLedger,
    annotations: acceptedAnnotations,
    paragraphs: [{
      paragraphId: 'p-body',
      sectionTitle: 'Discussion',
      text: 'The study was conducted in one experimental model.'
    }]
  });
  assert.equal(result.auditItems[0].messageZh.startsWith(MISSING_INFORMATION_PREFIX), true);
  assert.deepEqual(result.auditItems[0].searchTerms, [
    'external validation', 'independent cohort'
  ]);
  assert.deepEqual(result.auditItems[0].annotationIds, []);
});

test('rejects a missing-information audit contradicted by extracted body evidence', () => {
  const result = validateEvidenceLedger({
    annotations: acceptedAnnotations,
    paragraphs: [
      {
        paragraphId: 'methods-dose', sectionTitle: 'Methods',
        text: 'Cells received 12.5 µM Bobcat339 and mice received Bobcat339 2 mg/kg intraperitoneally every 2 days.'
      },
      {
        paragraphId: 'discussion-safety', sectionTitle: 'Discussion',
        text: 'No systemic toxicity in major organs and only minimal weight loss were observed.'
      }
    ],
    response: {
      key_annotation_ids: [], relation_summaries: [], review_warnings: [],
      audit_items: [{
        audit_id: 'audit-bobcat', kind: 'missing_information',
        message_zh: `${MISSING_INFORMATION_PREFIX} Bobcat339 的剂量、给药方案或毒性数据`,
        search_terms: ['Bobcat339', 'mg/kg', 'intraperitoneally', 'toxicity'],
        confidence: 0.96
      }]
    }
  });
  assert.deepEqual(result.auditItems, []);
  assert.equal(result.rejected[0].reason, 'AUDIT_CONTRADICTED_BY_BODY');
  assert.ok(result.rejected[0].matchedSearchTerms.includes('mg/kg'));
});

test('rejects a compound missing-information audit when one specific detail is present', () => {
  const result = validateEvidenceLedger({
    annotations: acceptedAnnotations,
    paragraphs: [{
      paragraphId: 'results-expression', sectionTitle: 'Results',
      text: 'TET1 expression levels were significantly higher in TP53mut GBM samples.'
    }],
    response: {
      key_annotation_ids: [], relation_summaries: [], review_warnings: [],
      audit_items: [{
        audit_id: 'audit-expression-prognosis', kind: 'missing_information',
        message_zh: `${MISSING_INFORMATION_PREFIX} TET1 expression in TP53-mutant GBM tissue and its association with patient prognosis.`,
        search_terms: ['expression levels', 'patient prognosis'],
        confidence: 0.95
      }]
    }
  });
  assert.deepEqual(result.auditItems, []);
  assert.equal(result.rejected[0].reason, 'AUDIT_CONTRADICTED_BY_BODY');
  assert.deepEqual(result.rejected[0].matchedSearchTerms, ['expression levels']);
});

test('matches common biomedical notation variants when checking audit contradictions', () => {
  const result = validateEvidenceLedger({
    annotations: acceptedAnnotations,
    paragraphs: [{
      paragraphId: 'results-expression', sectionTitle: 'Results',
      text: 'TET1 expression levels were significantly higher in TP53mut GBM samples.'
    }],
    response: {
      key_annotation_ids: [], relation_summaries: [], review_warnings: [],
      audit_items: [{
        audit_id: 'audit-expression-variant', kind: 'missing_information',
        message_zh: `${MISSING_INFORMATION_PREFIX} TET1 expression in TP53-mutant GBM patient tissue.`,
        search_terms: ['TET1 expression in TP53 mutant GBM tissue', 'patient prognosis'],
        confidence: 0.95
      }]
    }
  });
  assert.deepEqual(result.auditItems, []);
  assert.equal(result.rejected[0].reason, 'AUDIT_CONTRADICTED_BY_BODY');
  assert.deepEqual(result.rejected[0].matchedSearchTerms, [
    'TET1 expression in TP53 mutant GBM tissue'
  ]);
});

test('does not reject an audit from a generic one-token entity mention', () => {
  const result = validateEvidenceLedger({
    annotations: acceptedAnnotations,
    paragraphs: [{
      paragraphId: 'background-tet1', sectionTitle: 'Introduction',
      text: 'TET1 is an epigenetic regulator.'
    }],
    response: {
      key_annotation_ids: [], relation_summaries: [], review_warnings: [],
      audit_items: [{
        audit_id: 'audit-prognosis', kind: 'missing_information',
        message_zh: `${MISSING_INFORMATION_PREFIX} association between TET1 and patient prognosis.`,
        search_terms: ['TET1', 'patient prognosis'],
        confidence: 0.95
      }]
    }
  });
  assert.equal(result.auditItems.length, 1);
  assert.equal(result.rejected.length, 0);
});

test('rejects a missing-information audit without source-language search terms', () => {
  const result = validateEvidenceLedger({
    annotations: acceptedAnnotations,
    paragraphs: [],
    response: {
      key_annotation_ids: [], relation_summaries: [], review_warnings: [],
      audit_items: [{
        audit_id: 'audit-unsafe', kind: 'missing_information',
        message_zh: `${MISSING_INFORMATION_PREFIX} 给药细节`,
        confidence: 0.95
      }]
    }
  });
  assert.deepEqual(result.auditItems, []);
  assert.equal(result.rejected[0].reason, 'AUDIT_SEARCH_TERMS_REQUIRED');
});

test('requires claim and evidence references and a 0.90 warning floor', () => {
  const result = validateEvidenceLedger({
    annotations: acceptedAnnotations,
    response: {
      key_annotation_ids: [], relation_summaries: [], audit_items: [],
      review_warnings: [{
        warning_id: 'w1', category_id: 'causal_overreach',
        claim_annotation_ids: ['ann-1'], evidence_annotation_ids: ['ann-2'],
        confidence: 0.89, reason_zh: '证据较弱'
      }]
    }
  });
  assert.deepEqual(result.reviewWarnings, []);
  assert.equal(result.rejected[0].reason, 'WARNING_CONFIDENCE_BELOW_FLOOR');
});

test('reviews only through the generic structured provider interface', async () => {
  let captured;
  const result = await reviewEvidenceLedger({
    viewId: 'mechanism_chain', studyProfile,
    annotations: acceptedAnnotations, paragraphs: [],
    adapter: {
      async generateJson(request) {
        captured = request;
        return {
          key_annotation_ids: ['ann-1'],
          relation_summaries: [{
            relation_id: 'mechanism-1', label_zh: '活动影响突触',
            annotation_ids: ['ann-1', 'ann-2'], evidence_strength: 'rescue'
          }],
          review_warnings: [], audit_items: []
        };
      }
    }
  });
  assert.equal(captured.schemaName, 'evidence_ledger');
  assert.equal(result.relationSummaries[0].relationId, 'mechanism-1');
});

test('rejects a synergy relation label when the cited quotes do not report synergy evidence', () => {
  const annotations = [{
    annotationId: 'ann-association', relationId: 'rel-association',
    categoryId: 'association_evidence', claimMode: 'explicit',
    paragraphId: 'p-association', quoteRole: 'association_statement',
    quote: 'TET1 depletion was associated with reduced ROS1 expression.',
    slots: [], confidence: 0.85
  }];
  const result = validateEvidenceLedger({
    annotations,
    response: {
      key_annotation_ids: ['ann-association'],
      relation_summaries: [{
        relation_id: 'rel-association',
        label_zh: 'TET1敲低与ROS1降低产生协同效应',
        annotation_ids: ['ann-association'],
        evidence_strength: 'strong'
      }],
      review_warnings: [], audit_items: []
    }
  });
  assert.deepEqual(result.relationSummaries, []);
  assert.equal(result.rejected[0].reason, 'RELATION_LABEL_SYNERGY_UNSUPPORTED');
});

test('rejects a regulatory relation label supported only by correlation wording', () => {
  const annotations = [{
    annotationId: 'ann-correlation', relationId: 'rel-correlation',
    categoryId: 'key_result', claimMode: 'explicit',
    paragraphId: 'p-correlation', quoteRole: 'key_finding',
    quote: 'Inhibiting TET1 correlates with reduced ROS1 expression and attenuation of ERK signaling.',
    slots: [], confidence: 0.85
  }];
  const result = validateEvidenceLedger({
    annotations,
    response: {
      key_annotation_ids: ['ann-correlation'],
      relation_summaries: [{
        relation_id: 'rel-correlation',
        label_zh: 'TET1-ROS1-ERK axis regulates DNA damage and senescence',
        annotation_ids: ['ann-correlation'],
        evidence_strength: 'moderate'
      }],
      review_warnings: [], audit_items: []
    }
  });
  assert.deepEqual(result.relationSummaries, []);
  assert.equal(result.rejected[0].reason, 'RELATION_LABEL_EVIDENCE_LEVEL_UNSUPPORTED');
});

test('rejects scientific entities in a relation label that are absent from cited evidence', () => {
  const annotations = [{
    annotationId: 'ann-combination', relationId: 'rel-combination',
    categoryId: 'key_result', claimMode: 'explicit',
    paragraphId: 'p-combination', quoteRole: 'key_finding',
    quote: 'Bobcat339 with cisplatin synergistically inhibited TP53mut GBM growth.',
    slots: [], confidence: 0.95
  }];
  const result = validateEvidenceLedger({
    annotations,
    response: {
      key_annotation_ids: ['ann-combination'],
      relation_summaries: [{
        relation_id: 'rel-combination',
        label_zh: 'TET1 and TP53 synergistically inhibit GBM growth',
        annotation_ids: ['ann-combination'],
        evidence_strength: 'strong'
      }],
      review_warnings: [], audit_items: []
    }
  });
  assert.deepEqual(result.relationSummaries, []);
  assert.equal(result.rejected[0].reason, 'RELATION_LABEL_SCIENTIFIC_TOKEN_UNSUPPORTED');
  assert.deepEqual(result.rejected[0].unsupportedTokens, ['TET1']);
});

test('keeps an explicitly supported causal relation label', () => {
  const annotations = [{
    annotationId: 'ann-causal', relationId: 'rel-causal',
    categoryId: 'key_result', claimMode: 'explicit',
    paragraphId: 'p-causal', quoteRole: 'key_finding',
    quote: 'TET1 depletion caused increased genome fragility in TP53mut GBM cells.',
    slots: [], confidence: 0.95
  }];
  const result = validateEvidenceLedger({
    annotations,
    response: {
      key_annotation_ids: ['ann-causal'],
      relation_summaries: [{
        relation_id: 'rel-causal',
        label_zh: 'TET1 depletion causes genome fragility in TP53mut GBM',
        annotation_ids: ['ann-causal'],
        evidence_strength: 'strong'
      }],
      review_warnings: [], audit_items: []
    }
  });
  assert.equal(result.relationSummaries.length, 1);
  assert.equal(result.rejected.length, 0);
});

test('downgrades model-reported strong evidence when all cited annotations are moderate', () => {
  const annotations = [{
    annotationId: 'ann-moderate', relationId: 'rel-moderate',
    categoryId: 'key_result', claimMode: 'explicit',
    paragraphId: 'p-result', quoteRole: 'key_finding',
    quote: 'TET1 depletion was associated with reduced ROS1 expression.',
    slots: [], confidence: 0.85
  }];
  const result = validateEvidenceLedger({
    annotations,
    response: {
      key_annotation_ids: ['ann-moderate'],
      relation_summaries: [{
        relation_id: 'rel-moderate',
        label_zh: 'TET1敲低与ROS1表达降低相关',
        annotation_ids: ['ann-moderate'],
        evidence_strength: 'strong'
      }],
      review_warnings: [], audit_items: []
    }
  });
  assert.equal(result.relationSummaries[0].evidenceStrength, 'moderate');
});

test('deduplicates relation summaries that cite the same evidence set', () => {
  const result = validateEvidenceLedger({
    annotations: acceptedAnnotations,
    response: {
      key_annotation_ids: ['ann-1', 'ann-2'],
      relation_summaries: [
        {
          relation_id: 'rel-a', label_zh: '神经活动改变突触结局',
          annotation_ids: ['ann-1', 'ann-2'], evidence_strength: 'strong'
        },
        {
          relation_id: 'rel-b', label_zh: '神经活动与突触改变的核心关系',
          annotation_ids: ['ann-2', 'ann-1'], evidence_strength: 'moderate'
        }
      ],
      review_warnings: [], audit_items: []
    }
  });
  assert.equal(result.relationSummaries.length, 1);
  assert.equal(result.rejected[0].reason, 'DUPLICATE_RELATION_EVIDENCE');
});
