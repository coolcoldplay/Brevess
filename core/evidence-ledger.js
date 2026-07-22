(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const EVIDENCE_LEDGER_VERSION = '5';
  const MISSING_INFORMATION_PREFIX = '待核查：当前证据台账未覆盖';
  const SYNERGY_LABEL = /\bsynerg(?:y|istic|istically)?\b|协同/i;
  const SYNERGY_EVIDENCE = /\b(?:synerg(?:y|istic|istically)?|ZIP score|Bliss|Loewe|combination index)\b|协同/i;
  const EVIDENCE_STRENGTH_ORDER = Object.freeze({ weak: 0, moderate: 1, strong: 2 });
  const CAUSAL_EVIDENCE_CATEGORIES = new Set([
    'causal_effect', 'mechanism_mediator', 'necessity_evidence',
    'sufficiency_evidence', 'rescue_evidence'
  ]);
  const EXPLICIT_CAUSAL_EVIDENCE = /\b(?:caus(?:e|es|ed|ing)|led to|resulted in|drove|driven by|promot(?:e|es|ed|ing)|suppress(?:es|ed|ing)?|inhibit(?:s|ed)?|induc(?:e|es|ed|ing)|trigger(?:s|ed|ing)?|mediat(?:e|es|ed|ing)|regulat(?:e|es|ed|ing)|control(?:s|led|ling)?)\b/i;
  const RELATION_CLAIM_RULES = Object.freeze([
    {
      label: /\bmediat(?:e|es|ed|ing|ion)\b|\u4ecb\u5bfc/i,
      categories: new Set(['mechanism_mediator']),
      evidence: /\bmediat(?:e|es|ed|ing|ion)\b/i
    },
    {
      label: /\brescu(?:e|es|ed|ing)\b|\u633d\u6551|\u8865\u6551/i,
      categories: new Set(['rescue_evidence']),
      evidence: /\brescu(?:e|es|ed|ing)\b/i
    },
    {
      label: /\b(?:regulat(?:e|es|ed|ing|ion|ory)|control(?:s|led|ling)?|modulat(?:e|es|ed|ing|ion))\b|\u8c03\u63a7|\u8c03\u8282/i,
      categories: CAUSAL_EVIDENCE_CATEGORIES,
      evidence: EXPLICIT_CAUSAL_EVIDENCE
    },
    {
      label: /\b(?:caus(?:e|es|ed|ing)|lead(?:s|ing)? to|led to|result(?:s|ed|ing)? in|driv(?:e|es|en|ing)|promot(?:e|es|ed|ing)|suppress(?:es|ed|ing)?|inhibit(?:s|ed|ing)?|induc(?:e|es|ed|ing)|trigger(?:s|ed|ing)?)\b|\u5bfc\u81f4|\u5f15\u8d77|\u9a71\u52a8|\u4fc3\u8fdb|\u6291\u5236|\u8bf1\u5bfc/i,
      categories: CAUSAL_EVIDENCE_CATEGORIES,
      evidence: EXPLICIT_CAUSAL_EVIDENCE
    }
  ]);

  function createEvidenceLedgerSchema() {
    const annotationIds = { type: 'array', items: { type: 'string' } };
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        key_annotation_ids: annotationIds,
        relation_summaries: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              relation_id: { type: 'string' },
              label_zh: { type: 'string' },
              annotation_ids: annotationIds,
              evidence_strength: {
                type: 'string', enum: ['strong', 'moderate', 'weak']
              }
            },
            required: ['relation_id', 'label_zh', 'annotation_ids', 'evidence_strength']
          }
        },
        review_warnings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              warning_id: { type: 'string' },
              category_id: { type: 'string' },
              claim_annotation_ids: annotationIds,
              evidence_annotation_ids: annotationIds,
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              reason_zh: { type: 'string' }
            },
            required: [
              'warning_id', 'category_id', 'claim_annotation_ids',
              'evidence_annotation_ids', 'confidence', 'reason_zh'
            ]
          }
        },
        audit_items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              audit_id: { type: 'string' },
              kind: { type: 'string' },
              message_zh: { type: 'string' },
              search_terms: {
                type: 'array',
                minItems: 2,
                maxItems: 6,
                items: { type: 'string' }
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 }
            },
            required: ['audit_id', 'kind', 'message_zh', 'search_terms', 'confidence']
          }
        }
      },
      required: [
        'key_annotation_ids', 'relation_summaries', 'review_warnings', 'audit_items'
      ]
    };
  }

  function flattenAcceptedAnnotations(annotations, paragraphs = []) {
    const sectionByParagraph = new Map(
      paragraphs.map(item => [item.paragraphId, item.sectionTitle || ''])
    );
    return (Array.isArray(annotations) ? annotations : []).flatMap(group => {
      if (!Array.isArray(group?.categories)) {
        return [{
          annotation_id: String(group.annotationId || ''),
          relation_id: String(group.relationId || ''),
          category_id: String(group.categoryId || ''),
          claim_mode: String(group.claimMode || 'explicit'),
          paragraph_id: String(group.paragraphId || ''),
          section_title: String(group.sectionTitle || sectionByParagraph.get(group.paragraphId) || ''),
          quote: String(group.quote || ''),
          quote_role: String(group.quoteRole || 'statement'),
          support_quotes: (Array.isArray(group.supportSpans) ? group.supportSpans : [])
            .map(item => ({
              paragraph_id: String(item?.paragraphId || ''),
              quote: String(item?.quote || ''),
              quote_role: String(item?.quoteRole || 'statement')
            })).filter(item => item.paragraph_id && item.quote),
          slots: Array.isArray(group.slots) ? group.slots : [],
          confidence: Number(group.confidence)
        }];
      }
      return group.categories.map(category => ({
        annotation_id: String(category.annotationId || ''),
        relation_id: String(category.relationId || ''),
        category_id: String(category.categoryId || ''),
        claim_mode: String(category.claimMode || 'explicit'),
        paragraph_id: String(group.paragraphId || ''),
        section_title: String(sectionByParagraph.get(group.paragraphId) || ''),
        quote: String(group.quote || ''),
        quote_role: String(category.quoteRole || 'statement'),
        support_quotes: (Array.isArray(category.supportSpans) ? category.supportSpans : [])
          .map(item => ({
            paragraph_id: String(item?.paragraphId || ''),
            quote: String(item?.quote || ''),
            quote_role: String(item?.quoteRole || 'statement')
          })).filter(item => item.paragraph_id && item.quote),
        slots: Array.isArray(category.slots) ? category.slots : [],
        confidence: Number(category.confidence)
      }));
    }).filter(item => item.annotation_id && item.quote && Number.isFinite(item.confidence));
  }

  function compileEvidenceLedgerPrompt({
    viewId,
    studyProfile,
    annotations,
    paragraphs = []
  }) {
    const accepted = flattenAcceptedAnnotations(annotations, paragraphs);
    const systemPrompt = [
      'You synthesize an evidence ledger from already validated scientific annotations.',
      'Use only the supplied accepted quotes and structured fields. Do not request or infer from unquoted full text.',
      'Select truly central annotations for the current reading view.',
      'For quick_story, return at most 5 non-duplicative relation summaries ordered by importance.',
      'Do not use causal, regulatory, mediation, rescue, or synergy wording unless the cited accepted quotes explicitly support that evidence level.',
      'Every Latin-script scientific token in a relation label must appear in its cited accepted quotes or structured slots; never substitute a mutation, target, treatment, or outcome.',
      'Use evidence_strength only as strong, moderate, or weak.',
      'Link cross-paragraph evidence only through annotation_id and relation_id values supplied in the input.',
      'A review warning must cite at least one author claim annotation and one evidence annotation.',
      'Do not create a review warning below confidence 0.90.',
      `Every missing-information audit message must begin with: ${MISSING_INFORMATION_PREFIX}`,
      'You are not authorized to claim that information is absent from the full article because unquoted body text is not supplied here.',
      'For every missing-information audit, return 2 to 6 source-language search_terms that directly name the entity and requested detail.',
      'Each missing-information audit must request one atomic detail only; split expression, prognosis, dose, safety, or other independent details into separate audit items.',
      'The client will search the locally extracted full body and reject an audit contradicted by those terms.',
      'Return JSON only.'
    ].join('\n');
    return {
      schemaName: 'evidence_ledger',
      responseSchema: createEvidenceLedgerSchema(),
      systemPrompt,
      userPrompt: JSON.stringify({
        reading_view: viewId || 'quick_story',
        study_type: {
          primary_type: studyProfile?.primaryType || '',
          secondary_type: studyProfile?.secondaryType || ''
        },
        annotations: accepted
      })
    };
  }

  function allKnown(ids, knownIds) {
    return Array.isArray(ids) && ids.length > 0 && ids.every(id => knownIds.has(id));
  }

  function normalizeSearchText(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function normalizeAuditSearchTerms(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
      .map(item => String(item || '').trim().slice(0, 80))
      .filter(item => normalizeSearchText(item).length >= 2))]
      .slice(0, 6);
  }

  function canonicalAuditTokens(value) {
    const expanded = normalizeSearchText(value)
      .replace(/\b([a-z]+\d+)mut\b/g, '$1 mutant')
      .replace(/\b([a-z]+\d+)wt\b/g, '$1 wild type');
    const stopwords = new Set([
      'a', 'an', 'the', 'in', 'of', 'to', 'with', 'and', 'or', 'for',
      'its', 'between', 'among', 'from', 'by', 'at', 'on'
    ]);
    const aliases = {
      tissue: 'sample', tissues: 'sample', sample: 'sample', samples: 'sample',
      specimen: 'sample', specimens: 'sample',
      mutation: 'mutant', mutations: 'mutant', mutants: 'mutant',
      level: 'level', levels: 'level', patients: 'patient'
    };
    return expanded.split(' ')
      .filter(token => token && !stopwords.has(token))
      .map(token => aliases[token] || token);
  }

  function isSpecificAuditSearchTerm(value) {
    return canonicalAuditTokens(value).length >= 2;
  }

  function fuzzyAuditTermMatch(term, paragraphText) {
    const termTokens = canonicalAuditTokens(term);
    if (termTokens.length < 2) return false;
    const paragraphTokens = new Set(canonicalAuditTokens(paragraphText));
    const anchors = termTokens.filter(token => /\d/.test(token));
    if (anchors.some(token => !paragraphTokens.has(token))) return false;
    const matched = termTokens.filter(token => paragraphTokens.has(token)).length;
    return matched >= 2 && matched / termTokens.length >= 0.6;
  }

  function findAuditContradictions(searchTerms, paragraphs) {
    const bodyParagraphs = (Array.isArray(paragraphs) ? paragraphs : [])
      .map(item => String(item?.text || ''))
      .filter(Boolean);
    const normalizedBody = normalizeSearchText(bodyParagraphs.join('\n'));
    if (!normalizedBody) return [];
    return searchTerms.filter(term => {
      const normalized = normalizeSearchText(term);
      return normalized && (
        normalizedBody.includes(normalized) ||
        bodyParagraphs.some(paragraph => fuzzyAuditTermMatch(term, paragraph))
      );
    });
  }

  function hasSpecificProtocolMatch(matchedSearchTerms) {
    return matchedSearchTerms.some(term =>
      /\b\d+(?:\.\d+)?\s*(?:mg|ug|kg|ml|mm|um|nm)\b|µm|μm|intraperitone|intraven|oral|toxicit|weight loss/i
        .test(String(term || '').normalize('NFKC'))
    );
  }

  function normalizeEvidenceStrength(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (/^(?:strong|high|robust)$/.test(normalized)) return 'strong';
    if (/^(?:weak|low|limited)$/.test(normalized)) return 'weak';
    return 'moderate';
  }

  function calibrateEvidenceStrength(value, citedAnnotations) {
    const requested = normalizeEvidenceStrength(value);
    const confidences = citedAnnotations.map(item => Number(item.confidence))
      .filter(Number.isFinite);
    let ceiling = 'strong';
    if (citedAnnotations.some(item => item.claim_mode === 'inferred') ||
        confidences.some(confidence => confidence < 0.9)) {
      ceiling = 'moderate';
    }
    if (confidences.some(confidence => confidence < 0.8)) ceiling = 'weak';
    return EVIDENCE_STRENGTH_ORDER[requested] <= EVIDENCE_STRENGTH_ORDER[ceiling]
      ? requested : ceiling;
  }

  function supportsRelationClaimLevel(label, citedAnnotations, citedQuotes) {
    return RELATION_CLAIM_RULES.every(rule => {
      if (!rule.label.test(label)) return true;
      return citedAnnotations.some(annotation => rule.categories.has(annotation.category_id)) ||
        rule.evidence.test(citedQuotes);
    });
  }

  function unsupportedScientificTokens(label, citedAnnotations) {
    const evidence = citedAnnotations.map(annotation => [
      annotation.quote,
      ...(Array.isArray(annotation.slots)
        ? annotation.slots.flatMap(slot => [slot?.name || '', slot?.value || '']) : [])
    ].join(' ')).join(' ').toUpperCase().replace(/[^A-Z0-9]+/g, '');
    const tokens = String(label || '').match(/[A-Za-z][A-Za-z0-9+._]*/g) || [];
    return [...new Set(tokens
      .filter(token => /\d/.test(token) || /^[A-Z]{2,}$/.test(token))
      .map(token => token.toUpperCase().replace(/[^A-Z0-9]+/g, ''))
      .filter(token => token.length >= 2 && !evidence.includes(token)))];
  }

  function validateEvidenceLedger({ response, annotations, paragraphs = [] }) {
    const accepted = flattenAcceptedAnnotations(annotations, paragraphs);
    const knownIds = new Set(accepted.map(item => item.annotation_id));
    const acceptedById = new Map(accepted.map(item => [item.annotation_id, item]));
    const rejected = [];
    const keyAnnotationIds = [];
    (Array.isArray(response?.key_annotation_ids) ? response.key_annotation_ids : [])
      .forEach(annotationId => {
        if (knownIds.has(annotationId)) keyAnnotationIds.push(annotationId);
        else rejected.push({ reason: 'UNKNOWN_ANNOTATION_REFERENCE', value: annotationId });
      });

    const relationSummaries = [];
    const relationEvidenceKeys = new Set();
    (Array.isArray(response?.relation_summaries) ? response.relation_summaries : [])
      .forEach(item => {
        if (!item?.relation_id || !allKnown(item.annotation_ids, knownIds)) {
          rejected.push({ reason: 'UNKNOWN_ANNOTATION_REFERENCE', value: item });
          return;
        }
        const annotationIds = [...new Set(item.annotation_ids)];
        const evidenceKey = [...annotationIds].sort().join('|');
        if (relationEvidenceKeys.has(evidenceKey)) {
          rejected.push({ reason: 'DUPLICATE_RELATION_EVIDENCE', value: item });
          return;
        }
        const citedAnnotations = annotationIds.map(id => acceptedById.get(id)).filter(Boolean);
        const labelZh = String(item.label_zh || '').slice(0, 240);
        const citedQuotes = citedAnnotations.map(annotation => annotation.quote).join(' ');
        if (SYNERGY_LABEL.test(labelZh) && !SYNERGY_EVIDENCE.test(citedQuotes)) {
          rejected.push({ reason: 'RELATION_LABEL_SYNERGY_UNSUPPORTED', value: item });
          return;
        }
        if (!supportsRelationClaimLevel(labelZh, citedAnnotations, citedQuotes)) {
          rejected.push({ reason: 'RELATION_LABEL_EVIDENCE_LEVEL_UNSUPPORTED', value: item });
          return;
        }
        const unsupportedTokens = unsupportedScientificTokens(labelZh, citedAnnotations);
        if (unsupportedTokens.length) {
          rejected.push({
            reason: 'RELATION_LABEL_SCIENTIFIC_TOKEN_UNSUPPORTED',
            value: item,
            unsupportedTokens
          });
          return;
        }
        relationEvidenceKeys.add(evidenceKey);
        relationSummaries.push({
          relationId: String(item.relation_id),
          labelZh,
          annotationIds,
          evidenceStrength: calibrateEvidenceStrength(
            item.evidence_strength, citedAnnotations
          )
        });
      });

    const reviewWarnings = [];
    (Array.isArray(response?.review_warnings) ? response.review_warnings : [])
      .forEach(item => {
        const confidence = Number(item?.confidence);
        if (!allKnown(item?.claim_annotation_ids, knownIds) ||
            !allKnown(item?.evidence_annotation_ids, knownIds)) {
          rejected.push({ reason: 'UNKNOWN_ANNOTATION_REFERENCE', value: item });
          return;
        }
        if (!Number.isFinite(confidence) || confidence < 0.9 || confidence > 1) {
          rejected.push({ reason: 'WARNING_CONFIDENCE_BELOW_FLOOR', value: item });
          return;
        }
        reviewWarnings.push({
          warningId: String(item.warning_id || ''),
          categoryId: String(item.category_id || ''),
          claimAnnotationIds: [...new Set(item.claim_annotation_ids)],
          evidenceAnnotationIds: [...new Set(item.evidence_annotation_ids)],
          confidence,
          reasonZh: String(item.reason_zh || '').slice(0, 300)
        });
      });

    const auditItems = [];
    (Array.isArray(response?.audit_items) ? response.audit_items : [])
      .forEach(item => {
        const confidence = Number(item?.confidence);
        const kind = String(item?.kind || '');
        const messageZh = String(item?.message_zh || '').trim().slice(0, 300);
        if (!Number.isFinite(confidence) || confidence < 0.9 || confidence > 1) {
          rejected.push({ reason: 'AUDIT_CONFIDENCE_BELOW_FLOOR', value: item });
          return;
        }
        if (kind === 'missing_information' &&
            !messageZh.startsWith(MISSING_INFORMATION_PREFIX)) {
          rejected.push({ reason: 'UNSAFE_MISSING_INFORMATION_WORDING', value: item });
          return;
        }
        const searchTerms = normalizeAuditSearchTerms(item?.search_terms);
        if (kind === 'missing_information' && searchTerms.length < 2) {
          rejected.push({ reason: 'AUDIT_SEARCH_TERMS_REQUIRED', value: item });
          return;
        }
        const matchedSearchTerms = kind === 'missing_information'
          ? findAuditContradictions(searchTerms, paragraphs) : [];
        const matchedSpecificSearchTerms = matchedSearchTerms.filter(isSpecificAuditSearchTerm);
        if (kind === 'missing_information' &&
            (matchedSpecificSearchTerms.length >= 1 ||
             matchedSearchTerms.length >= 2 ||
             hasSpecificProtocolMatch(matchedSearchTerms))) {
          rejected.push({
            reason: 'AUDIT_CONTRADICTED_BY_BODY',
            value: item,
            matchedSearchTerms
          });
          return;
        }
        auditItems.push({
          auditId: String(item.audit_id || ''),
          kind,
          messageZh,
          confidence,
          annotationIds: [],
          searchTerms
        });
      });

    return {
      available: true,
      keyAnnotationIds: [...new Set(keyAnnotationIds)],
      relationSummaries,
      reviewWarnings,
      auditItems,
      rejected
    };
  }

  async function reviewEvidenceLedger({
    viewId,
    studyProfile,
    annotations,
    paragraphs,
    adapter,
    signal,
    waitIfPaused = async () => {}
  }) {
    await waitIfPaused();
    if (signal?.aborted) {
      throw shared.operationError
        ? shared.operationError()
        : Object.assign(new Error('Analysis was cancelled'), { code: 'CANCELLED' });
    }
    const request = compileEvidenceLedgerPrompt({
      viewId,
      studyProfile,
      annotations,
      paragraphs
    });
    const response = await adapter.generateJson({ ...request, signal });
    return validateEvidenceLedger({ response, annotations, paragraphs });
  }

  return {
    EVIDENCE_LEDGER_VERSION,
    MISSING_INFORMATION_PREFIX,
    createEvidenceLedgerSchema,
    flattenAcceptedAnnotations,
    compileEvidenceLedgerPrompt,
    validateEvidenceLedger,
    reviewEvidenceLedger
  };
});
