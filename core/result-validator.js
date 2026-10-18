(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const CAUSALITY_NON_CAUSAL_PATTERNS = [
    /\bas\s+(?:shown|illustrated|reported|described|indicated|listed|depicted|presented)\s+in\b/i,
    /\bas\s+(?:an?|the)\s+(?:example|illustration|marker|measure|proxy|control|reference|baseline)\b/i,
    /\bsince\s+(?:19|20)\d{2}\b/i,
    /\bwhile\s+(?:using|measuring|recording|incubating|maintaining|performing|conducting|analyzing|preparing)\b/i
  ];
  const AMBIGUOUS_CAUSAL_OPENING = /^\s*(?:as|since|while)\b/i;
  const EXPLICIT_CAUSAL_EVIDENCE = /\b(?:because|due to|owing to|as a result|caus(?:e|ed|es|ing)|led to|result(?:ed|s)? in|mediated|promoted|inhibited|induced|triggered|drove|contributed to|responsible for|dependent on|attributable to)\b/i;
  const PROSPECTIVE_HYPOTHESIS = /\b(?:we|the authors?)\s+(?:hypothes(?:ize|ized|ise|ised)|predict(?:ed)?|postulat(?:e|ed)|speculat(?:e|ed)|propos(?:e|ed)\s+that|sought to|aimed to|set out to)\b|\b(?:the )?(?:objective|purpose|aim) (?:of (?:this|the) study )?was to\b/i;
  const EPISTEMIC_HEDGE = /\b(?:associated with|association between|correlated with|correlation between|suggest(?:s|ed|ing)?|may|might|could|possibly|potential(?:ly)?|appears? to|consistent with)\b|(?:相关|关联|提示|可能|潜在)/i;
  const CAUSAL_CERTAINTY_REASON = /(?:建立|证明|证实|确定).{0,40}(?:因果|机制链|链条)|(?:因果链|因果关系).{0,40}(?:建立|证明|证实)|\b(?:establish(?:es|ed)?|prove[sd]?|demonstrate[sd]?)\b.{0,50}\bcausal/i;
  const CONSERVATIVE_REASON_ZH = '原文仅支持相关或提示性解释，未建立确定因果';
  const ASSOCIATION_ONLY_EVIDENCE = /\b(?:associated with|association between|correlated with|correlation between|linked to|related to|co[- ]?occurred|co[- ]?varied|predicted)\b|相关(?:于|性|关系)|与.+(?:相关|关联)/i;
  const UNCERTAINTY_EVIDENCE = /\b(?:CI|confidence interval|credible interval|standard error|SE|IQR|interquartile range|uncertain(?:ty)?|imprecis(?:e|ion)|wide interval)\b|置信区间|可信区间|标准误|不确定|不精确/i;
  const EFFECT_ESTIMATE_EVIDENCE = /\b(?:(?:adjusted\s+)?(?:hazard|odds|risk|rate) ratio|mean difference|risk difference|effect size|coefficient|estimate|AUC|AUROC|c[- ]?index|sensitivity|specificity)\b.{0,50}?[-+]?\d+(?:\.\d+)?|\b(?:HR|OR|RR|RD|MD)\s*(?:=|was|of|:)?\s*[-+]?\d+(?:\.\d+)?|\b(?:increased|decreased|reduced|improved|difference)\s+(?:by|was\s+)?[-+]?\d+(?:\.\d+)?/i;
  const INTERNAL_VALIDATION_ONLY = /\b(?:cross[- ]validation|bootstrap(?:ping)?|random split|training (?:set|data|cohort)|development (?:set|data|cohort)|internal validation)\b|交叉验证|内部验证|训练集/i;
  const EXTERNAL_VALIDATION_EVIDENCE = /\b(?:external|independent|separate|new|different|another) (?:validation|cohort|dataset|sample|population|laboratory|site|hospital)|\b(?:validat(?:ed|ion)|tested|evaluated|assessed|retained|reproduc(?:ed|tion))\b.{0,60}\b(?:external|independent|separate|new|different|another)\b|外部验证|独立(?:队列|数据集|样本|实验室)|重复验证/i;
  const PRACTICAL_SIGNIFICANCE_EVIDENCE = /\b(?:clinical(?:ly)?|practical(?:ly)?|meaningful|important|relevant|minimal(?:ly)? important|MCID|effect size|magnitude|negligible|trivial)\b|临床(?:意义|重要)|实际(?:意义|重要)|最小临床重要差异|效应量/i;
  const STATISTICAL_EVIDENCE = /\b(?:statistical(?:ly)?|significant|p[- ]?value|p\s*[<=>]|FDR|q[- ]?value|confidence interval|credible interval|effect estimate)\b|统计(?:显著|意义)|置信区间|可信区间/i;
  const RESCUE_EVIDENCE = /\b(?:rescu(?:e|ed)|restor(?:e|ed|ation)|revers(?:e|ed|al)|recover(?:ed|y)|normaliz(?:e|ed|ation)|returned? to|wild[- ]type phenotype)\b|补救|挽救|恢复|逆转|回归正常/i;
  const NECESSITY_MANIPULATION = /\b(?:block(?:ed|ade|ing)?|remov(?:e|ed|al)|delet(?:e|ed|ion)|knock[- ]?(?:out|down)|inhibit(?:ed|ing|ion|s)?|deplet(?:e|ed|ion)|ablat(?:e|ed|ion)|neutraliz(?:e|ed|ation)|deficien(?:t|cy))\b|阻断|敲除|敲低|删除|抑制|耗竭|缺失/i;
  const NECESSITY_OUTCOME = /\b(?:prevent(?:ed|ion)?|abolish(?:ed)?|reduc(?:e|ed|tion)|attenuat(?:e|ed|ion)|failed to|no longer|lost|required|dependent)\b|阻止|消除|减弱|降低|不再|依赖|必需/i;
  const SUFFICIENCY_CONTEXT = /\b(?:alone|by itself|in the absence of|without (?:the )?(?:original|upstream)|sufficient|sufficed)\b|单独|足以|在缺少|无需上游/i;
  const TIME_DOSE_RELATIONSHIP = /\b(?:dose|concentration|duration|time)\b.{0,70}\b(?:dependent|response|gradient|trend|increas(?:e|ed)|decreas(?:e|ed)|rose|fell|declin(?:e|ed)|chang(?:e|ed)|peak(?:ed)?)\b|\b(?:increas(?:e|ed)|decreas(?:e|ed)|rose|fell|declin(?:e|ed)|chang(?:e|ed)|peak(?:ed)?)\b.{0,70}\b(?:dose|concentration|duration|time|before|after|subsequent(?:ly)?|over time)\b|剂量(?:依赖|反应|梯度)|随(?:剂量|时间).*(?:增加|降低|变化)|(?:先于|随后|之后).*(?:增加|降低|变化)/i;
  const ENRICHMENT_EVIDENCE = /\b(?:pathway|gene set|ontology|GO term) enrichment\b|\bGSEA\b|通路富集|基因集富集/i;
  const FUNCTIONAL_MECHANISM_EVIDENCE = /\b(?:block(?:ed|ade|ing)?|knock[- ]?(?:out|down)|inhibit(?:ed|ion)?|delet(?:e|ed|ion)|ablat(?:e|ed|ion)|rescu(?:e|ed)|restor(?:e|ed)|mediat(?:e|ed|ion)|required|necessary|sufficient|caus(?:e|ed)|led to)\b|阻断|敲除|敲低|抑制|删除|补救|恢复|介导|必需|足以|导致/i;
  const TECHNICAL_REPEAT_ONLY = /\b(?:technical replicates?|same samples?|same specimens?|repeat(?:ed)? measurements?)\b|技术重复|同一(?:样本|标本)/i;
  const INDEPENDENT_SYSTEM_EVIDENCE = /\b(?:independent|external|separate|different|second|another)\s+(?:model|species|cohort|dataset|sample|population|laboratory|site|system|assay|experiment)|\bacross\s+(?:models|species|cohorts|datasets|systems|assays)|跨(?:体系|物种|队列)|独立(?:模型|物种|队列|数据集|样本|实验室)/i;
  const GROUNDED_SLOT_CATEGORIES = new Set([
    'driver_intervention', 'association_evidence', 'causal_effect',
    'mechanism_mediator', 'necessity_evidence', 'sufficiency_evidence',
    'rescue_evidence', 'temporal_dose_evidence', 'cross_system_validation',
    'effect_uncertainty', 'replication_external_validation',
    'statistical_vs_practical_significance'
  ]);
  const REVIEW_RELATION_CATEGORIES = new Set(['evidence_consensus', 'conflicting_evidence']);

  function validateAnnotationSemantics({ quote, categoryId }) {
    const text = String(quote || '').trim();
    const tokens = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)?|[\u3400-\u9FFF]/g) || [];
    if (tokens.length < 3) {
      return { valid: false, reason: 'INCOMPLETE_SEMANTIC_SPAN' };
    }
    if (categoryId === 'significance_novelty' && PROSPECTIVE_HYPOTHESIS.test(text)) {
      return { valid: false, reason: 'HYPOTHESIS_IS_NOT_SIGNIFICANCE' };
    }
    if (!['causality', 'causal_effect'].includes(categoryId)) {
      return { valid: true, reason: '' };
    }
    if (CAUSALITY_NON_CAUSAL_PATTERNS.some(pattern => pattern.test(text))) {
      return { valid: false, reason: 'NON_CAUSAL_AMBIGUOUS_CUE' };
    }
    if (AMBIGUOUS_CAUSAL_OPENING.test(text) && !EXPLICIT_CAUSAL_EVIDENCE.test(text)) {
      return { valid: false, reason: 'NON_CAUSAL_AMBIGUOUS_CUE' };
    }
    if (ASSOCIATION_ONLY_EVIDENCE.test(text) && !EXPLICIT_CAUSAL_EVIDENCE.test(text)) {
      return { valid: false, reason: 'ASSOCIATION_IS_NOT_CAUSAL' };
    }
    return { valid: true, reason: '' };
  }

  function calibrateAnnotationEpistemics({ quotes, confidence, reasonZh }) {
    const combined = (Array.isArray(quotes) ? quotes : [])
      .map(item => typeof item === 'string' ? item : item?.quote)
      .filter(Boolean)
      .join(' ');
    if (!EPISTEMIC_HEDGE.test(combined)) return { confidence, reasonZh };
    return {
      confidence: Math.min(Number(confidence), 0.85),
      reasonZh: CAUSAL_CERTAINTY_REASON.test(String(reasonZh || ''))
        ? CONSERVATIVE_REASON_ZH : reasonZh
    };
  }

  function normalizeGroundingText(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function validateAnnotationStructureSemantics({ categoryId, quotes, slots }) {
    const combined = (Array.isArray(quotes) ? quotes : [])
      .map(item => typeof item === 'string' ? item : item?.quote)
      .filter(Boolean)
      .join(' ');
    if (GROUNDED_SLOT_CATEGORIES.has(categoryId)) {
      const groundedText = normalizeGroundingText(combined);
      const ungrounded = (Array.isArray(slots) ? slots : []).find(slot => {
        const value = normalizeGroundingText(slot?.value);
        return !value || !groundedText.includes(value);
      });
      if (ungrounded) return { valid: false, reason: 'SLOT_VALUE_NOT_GROUNDED' };
    }
    if (categoryId === 'effect_uncertainty' && !UNCERTAINTY_EVIDENCE.test(combined)) {
      return { valid: false, reason: 'UNCERTAINTY_EVIDENCE_MISSING' };
    }
    if (categoryId === 'effect_uncertainty' && !EFFECT_ESTIMATE_EVIDENCE.test(combined)) {
      return { valid: false, reason: 'EFFECT_ESTIMATE_MISSING' };
    }
    if (categoryId === 'replication_external_validation' &&
        !EXTERNAL_VALIDATION_EVIDENCE.test(combined)) {
      return {
        valid: false,
        reason: INTERNAL_VALIDATION_ONLY.test(combined)
          ? 'INTERNAL_VALIDATION_IS_NOT_EXTERNAL'
          : 'EXTERNAL_VALIDATION_EVIDENCE_MISSING'
      };
    }
    if (categoryId === 'statistical_vs_practical_significance' &&
        !PRACTICAL_SIGNIFICANCE_EVIDENCE.test(combined)) {
      return { valid: false, reason: 'PRACTICAL_SIGNIFICANCE_EVIDENCE_MISSING' };
    }
    if (categoryId === 'statistical_vs_practical_significance' &&
        !STATISTICAL_EVIDENCE.test(combined)) {
      return { valid: false, reason: 'STATISTICAL_EVIDENCE_MISSING' };
    }
    if (categoryId === 'rescue_evidence' && !RESCUE_EVIDENCE.test(combined)) {
      return { valid: false, reason: 'RESCUE_STRUCTURE_MISSING' };
    }
    if (categoryId === 'necessity_evidence' &&
        (!NECESSITY_MANIPULATION.test(combined) || !NECESSITY_OUTCOME.test(combined))) {
      return { valid: false, reason: 'NECESSITY_STRUCTURE_MISSING' };
    }
    if (categoryId === 'sufficiency_evidence' && !SUFFICIENCY_CONTEXT.test(combined)) {
      return { valid: false, reason: 'SUFFICIENCY_STRUCTURE_MISSING' };
    }
    if (categoryId === 'temporal_dose_evidence' && !TIME_DOSE_RELATIONSHIP.test(combined)) {
      return { valid: false, reason: 'TIME_DOSE_RELATIONSHIP_MISSING' };
    }
    if (categoryId === 'mechanism_mediator' && ENRICHMENT_EVIDENCE.test(combined) &&
        !FUNCTIONAL_MECHANISM_EVIDENCE.test(combined)) {
      return { valid: false, reason: 'ENRICHMENT_IS_NOT_MEDIATOR_EVIDENCE' };
    }
    if (categoryId === 'cross_system_validation' &&
        (TECHNICAL_REPEAT_ONLY.test(combined) || !INDEPENDENT_SYSTEM_EVIDENCE.test(combined))) {
      return { valid: false, reason: 'INDEPENDENT_SYSTEM_EVIDENCE_MISSING' };
    }
    return { valid: true, reason: '' };
  }

  function findOccurrence(text, quote, occurrence) {
    let from = 0;
    let found = -1;
    for (let index = 0; index <= occurrence; index += 1) {
      found = text.indexOf(quote, from);
      if (found < 0) return -1;
      from = found + quote.length;
    }
    return found;
  }

  function groundingIgnoreMask(value) {
    const text = String(value || '');
    const ignored = new Uint8Array(text.length);
    const markMatches = pattern => {
      for (const match of text.matchAll(pattern)) {
        const start = Number(match.index) || 0;
        for (let index = start; index < start + match[0].length; index += 1) {
          ignored[index] = 1;
        }
      }
    };
    markMatches(/\(\s*(?:fig(?:ure)?s?|tables?)\.?\s+[^)]{1,80}\)/gi);
    for (const match of text.matchAll(/[,.;:]\s*(\d+(?:\s*[-–,]\s*\d+)*)(?=\s|[),.;:]|$)/g)) {
      const digits = match[1];
      const start = (Number(match.index) || 0) + match[0].lastIndexOf(digits);
      for (let index = start; index < start + digits.length; index += 1) ignored[index] = 1;
    }
    return ignored;
  }

  function normalizeGroundingWithOffsets(value) {
    const raw = String(value || '');
    const ignored = groundingIgnoreMask(raw);
    let text = '';
    const starts = [];
    const ends = [];
    let pendingSpaceStart = -1;
    let pendingSpaceEnd = -1;
    const appendSpace = () => {
      if (!text || text.endsWith(' ') || pendingSpaceStart < 0) return;
      text += ' ';
      starts.push(pendingSpaceStart);
      ends.push(pendingSpaceEnd);
    };
    for (let index = 0; index < raw.length; index += 1) {
      if (ignored[index]) {
        if (pendingSpaceStart < 0) pendingSpaceStart = index;
        pendingSpaceEnd = index + 1;
        continue;
      }
      const normalized = raw[index].normalize('NFKC').toLowerCase();
      for (const character of normalized) {
        if (/[a-z0-9\u3400-\u9fff]/.test(character)) {
          appendSpace();
          pendingSpaceStart = -1;
          pendingSpaceEnd = -1;
          text += character;
          starts.push(index);
          ends.push(index + 1);
        } else {
          if (pendingSpaceStart < 0) pendingSpaceStart = index;
          pendingSpaceEnd = index + 1;
        }
      }
    }
    return { text: text.trimEnd(), starts, ends };
  }

  function findGroundedOccurrence(text, quote, occurrence) {
    const exactStart = findOccurrence(text, quote, occurrence);
    if (exactStart >= 0) {
      return { start: exactStart, end: exactStart + quote.length,
        quote: text.slice(exactStart, exactStart + quote.length) };
    }
    const source = normalizeGroundingWithOffsets(text);
    const needle = normalizeGroundingWithOffsets(quote).text;
    if (!needle) return null;
    const normalizedStart = findOccurrence(source.text, needle, occurrence);
    if (normalizedStart < 0) return null;
    const normalizedEnd = normalizedStart + needle.length - 1;
    const start = source.starts[normalizedStart];
    let end = source.ends[normalizedEnd];
    if (/[.!?;:。！？；：]\s*$/.test(quote)) {
      while (end < text.length && /[\s.!?;:。！？；：]/.test(text[end])) end += 1;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
    return { start, end, quote: text.slice(start, end) };
  }

  function normalizeRequestedCategories(requestedCategories, requestedCategoryIds) {
    if (Array.isArray(requestedCategories) && requestedCategories.length) {
      return requestedCategories;
    }
    return (Array.isArray(requestedCategoryIds) ? requestedCategoryIds : []).map(categoryId => ({
      categoryId,
      requiredSlots: [],
      allowedQuoteRoles: null,
      claimMode: 'either',
      relationRequired: false
    }));
  }

  function scopedId(namespace, value, fallback) {
    const scope = String(namespace || 'chunk').trim().replace(/[^a-zA-Z0-9_-]+/g, '-') || 'chunk';
    const local = String(value || fallback).trim().replace(/[^a-zA-Z0-9_-]+/g, '-') || fallback;
    return `${scope}:${local}`;
  }

  function stableLocalId(prefix, value) {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return `${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function localConfidence(provenance, category, displayQuotes, supportQuotes, slots) {
    let confidence = provenance === 'current' ? 0.94
      : provenance === 'prior' ? 0.86 : 0.82;
    if (category?.relationRequired && supportQuotes.length) confidence += 0.01;
    if ((category?.requiredSlots || []).length && slots.length >= category.requiredSlots.length) {
      confidence += 0.01;
    }
    if (displayQuotes.some(item => item.quote.length < 12)) confidence -= 0.04;
    return Math.max(0.5, Math.min(0.98, Math.round(confidence * 100) / 100));
  }

  /** Convert the model's compact claim census into the existing validator input.
   * Identity, occurrence, confidence and the Chinese explanation are all local,
   * deterministic fields; the model is never asked to fabricate them.
   */
  function materializeHighlightStreamRecord({ record, paragraphs, categories }) {
    const paragraphMap = new Map((Array.isArray(paragraphs) ? paragraphs : [])
      .map((item, index) => [index, item]));
    const categoryMap = new Map((Array.isArray(categories) ? categories : [])
      .map(item => [item.categoryId, item]));
    const reviewedParagraph = paragraphMap.get(record?.paragraphIndex);
    const annotations = (Array.isArray(record?.annotations) ? record.annotations : [])
      .map((item, annotationIndex) => {
        const category = categoryMap.get(item.categoryId);
        if (!category || item.needsContext) return null;
        const mapQuote = quote => {
          const paragraph = paragraphMap.get(quote.paragraphIndex);
          return {
            paragraph_id: paragraph?.paragraphId || '',
            quote: quote.quote,
            occurrence: 0,
            role: quote.role || 'statement'
          };
        };
        const displayQuotes = item.displayQuotes.map(mapQuote);
        const supportQuotes = item.supportQuotes.map(mapQuote);
        const slots = Array.isArray(item.slots) ? item.slots : [];
        const identity = {
          categoryId: item.categoryId,
          provenance: item.provenance,
          displayQuotes,
          supportQuotes,
          slots
        };
        const relationId = category.relationRequired
          ? stableLocalId('relation', identity) : '';
        return {
          annotation_id: stableLocalId('annotation', [identity, annotationIndex]),
          relation_id: relationId,
          category_id: item.categoryId,
          claim_mode: category.claimMode === 'inferred' ? 'inferred' : 'explicit',
          provenance: item.provenance,
          highlight_quotes: displayQuotes,
          support_quotes: supportQuotes,
          slots,
          confidence: localConfidence(
            item.provenance, category, displayQuotes, supportQuotes, slots
          ),
          reason_zh: `本地规则核验：原文满足“${String(category.name || item.categoryId).slice(0, 40)}”判定条件。`,
          locally_derived: true
        };
      }).filter(Boolean);
    return {
      paragraphs_reviewed: reviewedParagraph ? [reviewedParagraph.paragraphId] : [],
      annotations
    };
  }

  function normalizeRawAnnotation(raw, index, namespace) {
    if (Array.isArray(raw?.highlight_quotes)) {
      const locallyDerived = raw.locally_derived === true;
      return {
        annotationId: locallyDerived
          ? String(raw.annotation_id || stableLocalId('annotation', [raw, index]))
          : scopedId(namespace, raw.annotation_id, `annotation-${index}`),
        relationId: raw.relation_id
          ? (locallyDerived
            ? String(raw.relation_id)
            : scopedId(namespace, raw.relation_id, `relation-${index}`)) : '',
        categoryId: String(raw.category_id || ''),
        claimMode: raw.claim_mode === 'inferred' ? 'inferred' : 'explicit',
        highlightQuotes: raw.highlight_quotes,
        supportQuotes: Array.isArray(raw.support_quotes) ? raw.support_quotes : [],
        slots: Array.isArray(raw.slots) ? raw.slots : [],
        confidence: Number(raw.confidence),
        reasonZh: String(raw.reason_zh || '').slice(0, 120),
        legacy: false,
        raw
      };
    }
    return {
      annotationId: scopedId(namespace, raw?.annotation_id, `legacy-${index}`),
      relationId: raw?.relation_id
        ? scopedId(namespace, raw.relation_id, `relation-${index}`) : '',
      categoryId: String(raw?.category_id || ''),
      claimMode: 'explicit',
      highlightQuotes: [{
        paragraph_id: raw?.paragraph_id,
        quote: raw?.quote,
        occurrence: raw?.occurrence,
        role: 'statement'
      }],
      supportQuotes: [],
      slots: [],
      confidence: Number(raw?.confidence),
      reasonZh: String(raw?.reason_zh || '').slice(0, 120),
      legacy: true,
      raw
    };
  }

  function normalizeSlots(slots) {
    return (Array.isArray(slots) ? slots : [])
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        name: String(item.name || '').trim(),
        value: String(item.value || '').trim()
      }))
      .filter(item => item.name && item.value);
  }

  function missingRequiredSlot(category, slots) {
    const slotNames = new Set(slots.map(item => item.name));
    return (category.requiredSlots || []).find(name => !slotNames.has(name)) || '';
  }

  function requiredQuoteRoles(categoryId) {
    if (categoryId === 'necessity_evidence') return ['upstream_effect', 'reduced_outcome'];
    if (categoryId === 'sufficiency_evidence') return ['mediator_activation', 'induced_outcome'];
    if (categoryId === 'rescue_evidence') return ['initial_abnormality', 'rescued_outcome'];
    return [];
  }

  function reviewDirectionClass(value) {
    const text = normalizeGroundingText(value);
    if (!text) return 'unknown';
    if (/(?:no|not|none|null|absent|unchanged|failed|lack|without)\b|无(?:改善|差异|关联|效应)|未(?:改善|发现|观察到|复现)|不显著/.test(text)) {
      return 'null';
    }
    if (/\b(?:decreas|reduc|lower|wors|declin|harm|negative|inverse|less)\w*\b|降低|减少|下降|恶化|负向|有害/.test(text)) {
      return 'negative';
    }
    if (/\b(?:increas|improv|higher|benefit|positive|support|greater|enhanc)\w*\b|增加|升高|改善|获益|正向|支持|增强/.test(text)) {
      return 'positive';
    }
    return 'unknown';
  }

  function validateReviewRelationGroup(categoryId, pending, slots) {
    if (!REVIEW_RELATION_CATEGORIES.has(categoryId)) return { valid: true, reason: '' };
    const evidenceA = pending.filter(item => item.quoteRole === 'evidence_a');
    const evidenceB = pending.filter(item => item.quoteRole === 'evidence_b');
    const distinctSources = new Set([...evidenceA, ...evidenceB]
      .map(item => `${item.paragraphId}:${normalizeGroundingText(item.quote)}`));
    if (!evidenceA.length || !evidenceB.length || distinctSources.size < 2) {
      return { valid: false, reason: 'REVIEW_RELATION_NEEDS_TWO_EVIDENCE_SOURCES' };
    }
    const slotMap = new Map((Array.isArray(slots) ? slots : [])
      .map(item => [item.name, item.value]));
    if (!slotMap.get('target_claim')) {
      return { valid: false, reason: 'REVIEW_RELATION_NEEDS_TWO_EVIDENCE_SOURCES' };
    }
    const groundedText = normalizeGroundingText(pending.map(item => item.quote).join(' '));
    const ungrounded = (Array.isArray(slots) ? slots : []).find(slot => {
      const value = normalizeGroundingText(slot?.value);
      return !value || !groundedText.includes(value);
    });
    if (ungrounded) return { valid: false, reason: 'SLOT_VALUE_NOT_GROUNDED' };
    const a = reviewDirectionClass(slotMap.get('evidence_a_direction'));
    const b = reviewDirectionClass(slotMap.get('evidence_b_direction'));
    const sameKnownDirection = a !== 'unknown' && b !== 'unknown' && a === b;
    const differentKnownDirection = a !== 'unknown' && b !== 'unknown' && a !== b;
    if ((categoryId === 'evidence_consensus' && !sameKnownDirection) ||
        (categoryId === 'conflicting_evidence' && !differentKnownDirection)) {
      return { valid: false, reason: 'REVIEW_RELATION_DIRECTION_MISMATCH' };
    }
    return { valid: true, reason: '' };
  }

  function validateChunkResult({
    paragraphs,
    requestedCategoryIds,
    requestedCategories,
    response,
    expectedChunkId
  }) {
    const paragraphMap = new Map(paragraphs.map(item => [item.paragraphId, item]));
    const categories = normalizeRequestedCategories(requestedCategories, requestedCategoryIds);
    const categoryMap = new Map(categories.map(item => [item.categoryId, item]));
    const defaults = shared.createUnifiedCategoryCatalog?.() || shared.createBuiltInCategories?.() || {};
    const reviewed = new Set(Array.isArray(response?.paragraphs_reviewed)
      ? response.paragraphs_reviewed : []);
    const annotations = [];
    const rejected = [];
    const reviewCandidates = [];

    const namespace = expectedChunkId || response?.chunk_id || 'chunk';
    (Array.isArray(response?.annotations) ? response.annotations : []).forEach((raw, index) => {
      const normalized = normalizeRawAnnotation(raw, index, namespace);
      const category = categoryMap.get(normalized.categoryId);
      if (!category) {
        rejected.push({ annotation: raw, reason: 'CATEGORY_NOT_REQUESTED' });
        return;
      }
      const semanticCategoryId = shared.usesBuiltInCategorySemantics?.(
        category, defaults[normalized.categoryId]
      ) === false ? '' : normalized.categoryId;
      if (!Number.isFinite(normalized.confidence) ||
          normalized.confidence < 0 || normalized.confidence > 1) {
        rejected.push({ annotation: raw, reason: 'INVALID_CONFIDENCE' });
        return;
      }
      if (!normalized.legacy && category.claimMode !== 'either' &&
          normalized.claimMode !== category.claimMode) {
        rejected.push({ annotation: raw, reason: 'CLAIM_MODE_MISMATCH' });
        return;
      }
      const slots = normalizeSlots(normalized.slots);
      if (!normalized.legacy && missingRequiredSlot(category, slots)) {
        rejected.push({ annotation: raw, reason: 'MISSING_REQUIRED_SLOT' });
        return;
      }
      if (!normalized.legacy && category.relationRequired && !normalized.relationId) {
        rejected.push({ annotation: raw, reason: 'MISSING_RELATION_ID' });
        return;
      }
      if (!normalized.highlightQuotes.length) {
        rejected.push({ annotation: raw, reason: 'MISSING_HIGHLIGHT_QUOTE' });
        return;
      }
      const allQuotes = [...normalized.highlightQuotes, ...normalized.supportQuotes];
      if ((raw.locally_derived === true || !semanticCategoryId) && slots.some(slot =>
        !allQuotes.some(item => normalizeGroundingText(item.quote).includes(normalizeGroundingText(slot.value))))) {
        rejected.push({ annotation: raw, reason: 'SLOT_VALUE_NOT_GROUNDED' });
        return;
      }
      const calibrated = calibrateAnnotationEpistemics({
        quotes: allQuotes,
        confidence: normalized.confidence,
        reasonZh: normalized.reasonZh
      });
      const quoteRoles = new Set(
        allQuotes.map(item => String(item?.role || ''))
      );
      const allowedRoles = Array.isArray(category.allowedQuoteRoles)
        ? new Set(category.allowedQuoteRoles) : null;
      if (!normalized.legacy && allowedRoles && allQuotes.some(item =>
        !allowedRoles.has(String(item?.role || ''))
      )) {
        rejected.push({ annotation: raw, reason: 'INVALID_QUOTE_ROLE' });
        return;
      }
      if (!normalized.legacy && requiredQuoteRoles(semanticCategoryId)
        .some(role => !quoteRoles.has(role))) {
        rejected.push({ annotation: raw, reason: 'STRONG_EVIDENCE_STRUCTURE_MISSING' });
        return;
      }
      if (!normalized.legacy && normalized.claimMode === 'inferred' &&
          (!quoteRoles.has('claim') || !quoteRoles.has('evidence'))) {
        rejected.push({ annotation: raw, reason: 'INFERRED_WARNING_MISSING_EVIDENCE' });
        return;
      }

      const pending = [];
      const validationPending = [];
      for (const [quoteIndex, rawQuote] of allQuotes.entries()) {
        const paragraph = paragraphMap.get(rawQuote?.paragraph_id);
        const quote = typeof rawQuote?.quote === 'string' ? rawQuote.quote : '';
        const occurrence = Number.isInteger(rawQuote?.occurrence) && rawQuote.occurrence >= 0
          ? rawQuote.occurrence : 0;
        const grounded = paragraph && quote
          ? findGroundedOccurrence(paragraph.text, quote, occurrence) : null;
        if (!paragraph || !quote || !grounded) {
          rejected.push({ annotation: raw, reason: 'QUOTE_NOT_FOUND' });
          return;
        }
        const semantics = validateAnnotationSemantics({
          quote: grounded.quote,
          categoryId: semanticCategoryId
        });
        if (!semantics.valid) {
          rejected.push({ annotation: raw, reason: semantics.reason });
          return;
        }
        const groundedAnnotation = {
          paragraphId: rawQuote.paragraph_id,
          start: grounded.start,
          end: grounded.end,
          quote: grounded.quote,
          categoryId: normalized.categoryId,
          confidence: calibrated.confidence,
          reasonZh: calibrated.reasonZh,
          annotationId: normalized.annotationId,
          relationId: normalized.relationId,
          claimMode: normalized.claimMode,
          provenance: ['current', 'prior', 'interpretation'].includes(raw.provenance) ? raw.provenance : '',
          confidenceBasis: raw.locally_derived === true ? 'local_evidence_heuristic' : 'model_reported',
          quoteRole: String(rawQuote.role || ''),
          slots,
          minimumConfidence: Number(category.minimumConfidence) || 0.8
        };
        validationPending.push(groundedAnnotation);
        if (quoteIndex < normalized.highlightQuotes.length) pending.push(groundedAnnotation);
      }
      const supportSpans = validationPending.slice(normalized.highlightQuotes.length)
        .map(item => ({
          paragraphId: item.paragraphId,
          start: item.start,
          end: item.end,
          quote: item.quote,
          quoteRole: item.quoteRole
        }));
      pending.forEach(item => { item.supportSpans = supportSpans; });
      const structureSemantics = validateAnnotationStructureSemantics({
        categoryId: semanticCategoryId,
        quotes: allQuotes,
        slots
      });
      if (!structureSemantics.valid) {
        rejected.push({ annotation: raw, reason: structureSemantics.reason });
        return;
      }
      if (REVIEW_RELATION_CATEGORIES.has(semanticCategoryId)) {
        reviewCandidates.push({ normalized, pending, validationPending, slots, raw });
      } else {
        annotations.push(...pending);
      }
    });

    const reviewGroups = new Map();
    reviewCandidates.forEach(candidate => {
      const key = `${candidate.normalized.categoryId}:${candidate.normalized.relationId}`;
      const group = reviewGroups.get(key) || {
        categoryId: candidate.normalized.categoryId,
        pending: [], validationPending: [], slots: [], raw: []
      };
      group.pending.push(...candidate.pending);
      group.validationPending.push(...candidate.validationPending);
      group.slots.push(...candidate.slots);
      group.raw.push(candidate.raw);
      reviewGroups.set(key, group);
    });
    reviewGroups.forEach(group => {
      const semantics = validateReviewRelationGroup(
        group.categoryId, group.validationPending, group.slots
      );
      if (!semantics.valid) {
        rejected.push({ annotation: group.raw.length === 1 ? group.raw[0] : group.raw,
          reason: semantics.reason });
        return;
      }
      annotations.push(...group.pending);
    });

    return {
      annotations,
      rejected,
      missingParagraphIds: paragraphs
        .map(item => item.paragraphId)
        .filter(id => !reviewed.has(id))
    };
  }

  function mergeAnnotations(annotations) {
    const groups = new Map();
    annotations.forEach(annotation => {
      const key = `${annotation.paragraphId}:${annotation.start}:${annotation.end}`;
      const group = groups.get(key) || {
        paragraphId: annotation.paragraphId,
        start: annotation.start,
        end: annotation.end,
        quote: annotation.quote,
        categories: []
      };
      const identity = JSON.stringify({
        categoryId: annotation.categoryId,
        quoteRole: annotation.quoteRole || '',
        slots: Array.isArray(annotation.slots) ? annotation.slots : []
      });
      const existingIndex = group.categories.findIndex(item => JSON.stringify({
        categoryId: item.categoryId,
        quoteRole: item.quoteRole || '',
        slots: Array.isArray(item.slots) ? item.slots : []
      }) === identity);
      const nextCategory = {
          categoryId: annotation.categoryId,
          confidence: annotation.confidence,
          reasonZh: annotation.reasonZh || '',
          annotationId: annotation.annotationId || '',
          relationId: annotation.relationId || '',
          claimMode: annotation.claimMode || 'explicit',
          provenance: annotation.provenance || '',
          confidenceBasis: annotation.confidenceBasis || 'model_reported',
          quoteRole: annotation.quoteRole || 'statement',
          slots: Array.isArray(annotation.slots) ? annotation.slots : [],
          supportSpans: Array.isArray(annotation.supportSpans) ? annotation.supportSpans : [],
          minimumConfidence: Number(annotation.minimumConfidence) || 0.8
      };
      if (existingIndex < 0) {
        group.categories.push(nextCategory);
      } else if (Number(annotation.confidence) > Number(group.categories[existingIndex].confidence)) {
        group.categories[existingIndex] = nextCategory;
      }
      groups.set(key, group);
    });
    return [...groups.values()];
  }

  return {
    validateChunkResult,
    mergeAnnotations,
    validateAnnotationSemantics,
    validateAnnotationStructureSemantics,
    validateReviewRelationGroup,
    calibrateAnnotationEpistemics,
    materializeHighlightStreamRecord
  };
});
