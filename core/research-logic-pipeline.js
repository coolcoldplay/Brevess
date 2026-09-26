(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const RESEARCH_LOGIC_VERSION = '1';
  const RESEARCH_LOGIC_PROMPT_VERSION = '1';
  const TRACE_TYPES = new Set(['B', 'K', 'E', 'X', 'G', 'R', 'Q', 'H', 'A']);
  const CAUSAL_LEVELS = new Set([
    'descriptive', 'association', 'intervention_effect', 'necessity', 'sufficiency',
    'necessity_and_sufficiency', 'rescue', 'mechanistic_support', 'unknown'
  ]);

  function clean(value, maximum = 1600) {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, maximum);
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function stableHash(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function asEvidenceIndex(value) {
    const source = value instanceof Map ? [...value.values()] : value;
    const normalized = typeof shared.normalizeResearchEvidenceSet === 'function'
      ? shared.normalizeResearchEvidenceSet(source) : [];
    return new Map(normalized.map(item => [item.evidenceId, item]));
  }

  function resolvedEvidenceIds(value, evidenceIndex, maximum = 16) {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).map(item => clean(item, 80)).filter(id => {
      if (!id || seen.has(id) || !evidenceIndex.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, maximum);
  }

  function normalizeQuestion(value, evidenceIndex, fallbackId = '') {
    if (!value || typeof value !== 'object') return null;
    const text = clean(value.text || value.question, 1200);
    if (!text) return null;
    const evidenceIds = resolvedEvidenceIds(value.evidenceIds || value.evidence_ids, evidenceIndex);
    if (!evidenceIds.length) return null;
    const origin = ['author_explicit', 'brevess_reconstructed', 'legacy_unclassified']
      .includes(clean(value.origin, 80)) ? clean(value.origin, 80) : 'brevess_reconstructed';
    return {
      questionId: clean(value.questionId || value.question_id, 80) || fallbackId,
      text,
      authorWording: clean(value.authorWording || value.author_wording, 1200),
      evidenceIds,
      origin,
      confidence: ['high', 'medium', 'low', 'unknown'].includes(clean(value.confidence, 40))
        ? clean(value.confidence, 40) : 'unknown'
    };
  }

  function normalizeResearchQuestionTrace(value, evidenceValue) {
    const evidenceIndex = asEvidenceIndex(evidenceValue);
    const rawRoot = value?.coreQuestion || value?.core_question ||
      (Array.isArray(value?.questions) ? value.questions.find(item => /^(?:Q0|q0)$/u.test(item?.questionId || item?.question_id || '')) : null);
    const coreQuestion = normalizeQuestion(rawRoot, evidenceIndex, 'Q0');
    if (!coreQuestion) return deepFreeze({ version: RESEARCH_LOGIC_VERSION, coreQuestion: null, bridge: [] });
    coreQuestion.questionId = 'Q0';
    const bridge = [];
    const seen = new Set();
    for (const raw of Array.isArray(value?.bridge || value?.trace) ? value.bridge || value.trace : []) {
      const traceId = clean(raw?.traceId || raw?.trace_id, 80);
      const type = clean(raw?.type, 4).toUpperCase();
      const evidenceIds = resolvedEvidenceIds(raw?.evidenceIds || raw?.evidence_ids, evidenceIndex);
      if (!traceId || !TRACE_TYPES.has(type) || !evidenceIds.length || seen.has(traceId)) continue;
      seen.add(traceId);
      bridge.push({
        traceId, type, evidenceIds,
        statement: clean(raw?.statement, 1200),
        relation: clean(raw?.relation, 120),
        origin: ['author_explicit', 'brevess_reconstructed'].includes(clean(raw?.origin, 80))
          ? clean(raw.origin, 80) : 'brevess_reconstructed'
      });
      if (bridge.length >= 16) break;
    }
    return deepFreeze({ version: RESEARCH_LOGIC_VERSION, coreQuestion, bridge });
  }

  function normalizeResearchQuestionProgression(value, evidenceValue, options = {}) {
    const evidenceIndex = asEvidenceIndex(evidenceValue);
    const result = [];
    const acceptedIds = new Set([clean(options.rootQuestionId, 80) || 'Q0']);
    for (const raw of Array.isArray(value) ? value : []) {
      const requestedId = clean(raw?.questionId || raw?.question_id, 80).toUpperCase();
      if (!/^Q[1-4]$/u.test(requestedId) || acceptedIds.has(requestedId)) continue;
      const question = normalizeQuestion(raw, evidenceIndex, requestedId);
      const generatedFrom = (Array.isArray(raw?.generatedFrom || raw?.generated_from)
        ? raw.generatedFrom || raw.generated_from : [])
        .map(item => clean(item, 80).toUpperCase()).filter(id => acceptedIds.has(id));
      if (!question || !generatedFrom.length) continue;
      const causalLevel = clean(raw?.causalLevel || raw?.causal_level, 80);
      acceptedIds.add(requestedId);
      result.push({
        ...question,
        questionId: requestedId,
        generatedFrom: [...new Set(generatedFrom)],
        hypothesis: clean(raw?.hypothesis, 1200),
        test: clean(raw?.test || raw?.experimentalTest, 1200),
        result: clean(raw?.result, 1200),
        warrantedConclusion: clean(raw?.warrantedConclusion || raw?.warranted_conclusion, 1200),
        remainingGap: clean(raw?.remainingGap || raw?.remaining_gap, 1200),
        causalLevel: CAUSAL_LEVELS.has(causalLevel) ? causalLevel : 'unknown'
      });
      if (result.length >= 4) break;
    }
    return deepFreeze(result);
  }

  function atomIsIntroEvidence(atom) {
    return atom?.sourceRefs?.some(ref => /abstract|intro|background/iu.test(
      `${ref.sourceIdentity || ''} ${(ref.sectionPath || []).join(' ')}`
    )) || ['background', 'known_mechanism', 'prior_evidence', 'knowledge_gap', 'rationale', 'author_aim']
      .includes(atom?.type);
  }

  function atomSupportsRole(atom, roles, textPattern) {
    return roles.includes(atom?.evidenceRole) || textPattern.test(`${atom?.statement || ''}`);
  }

  function auditResearchLogic(value, evidenceValue) {
    const evidenceIndex = asEvidenceIndex(evidenceValue);
    const trace = normalizeResearchQuestionTrace(value?.questionTrace || value?.question_trace || {}, evidenceIndex);
    const progression = normalizeResearchQuestionProgression(value?.progression, evidenceIndex, { rootQuestionId: 'Q0' });
    const issues = [];
    let validCoreQuestion = Boolean(trace.coreQuestion);
    if (trace.coreQuestion) {
      const rootAtoms = trace.coreQuestion.evidenceIds.map(id => evidenceIndex.get(id)).filter(Boolean);
      const onlyResults = rootAtoms.length > 0 && rootAtoms.every(atom => atom.type === 'result' && !atomIsIntroEvidence(atom));
      if (onlyResults) {
        validCoreQuestion = false;
        issues.push('RESULTS_ONLY_Q0: 初始核心问题不能由结果段中新发现的实体倒推。');
      }
      if (/western blot|rna[- ]?seq|pcr|immunofluorescence|anova|t[- ]?test|测序|染色|方差分析/iu.test(trace.coreQuestion.text)) {
        validCoreQuestion = false;
        issues.push('METHOD_AS_QUESTION: 实验方法不能作为论文级科学问题。');
      }
    }
    const acceptedProgressionIds = [];
    for (const question of progression) {
      const questionAtoms = question.evidenceIds.map(id => evidenceIndex.get(id)).filter(Boolean);
      const hasIntervention = questionAtoms.some(atom => atomSupportsRole(atom,
        ['intervention', 'necessity', 'sufficiency', 'rescue'], /knock|loss|inhibit|overexpress|restore|rescue|敲|抑制|过表达|恢复|挽救/iu));
      const hasRescue = questionAtoms.some(atom => atomSupportsRole(atom,
        ['rescue'], /restore|rescue|re-expression|恢复|挽救|回补/iu));
      const hasDeficit = questionAtoms.some(atom => /deficit|impair|loss|reduced|缺陷|受损|降低/iu.test(atom.statement));
      const level = question.causalLevel;
      let overclaim = false;
      if (['necessity', 'sufficiency', 'necessity_and_sufficiency'].includes(level) && !hasIntervention) overclaim = true;
      if (level === 'necessity_and_sufficiency' && !(hasIntervention && hasRescue && hasDeficit)) overclaim = true;
      if (level === 'rescue' && !(hasIntervention && hasRescue && hasDeficit)) overclaim = true;
      if (overclaim) {
        issues.push(`CAUSAL_OVERCLAIM:${question.questionId}`);
        continue;
      }
      acceptedProgressionIds.push(question.questionId);
    }
    return deepFreeze({
      version: RESEARCH_LOGIC_VERSION,
      validCoreQuestion,
      acceptedProgressionIds,
      issues,
      evidenceCoverage: evidenceIndex.size,
      audited: true
    });
  }

  function canonicalAtoms(value) {
    const atoms = typeof shared.normalizeResearchEvidenceSet === 'function'
      ? shared.normalizeResearchEvidenceSet(value) : [];
    return JSON.stringify(atoms.map(atom => ({
      evidenceId: atom.evidenceId, type: atom.type, statement: atom.statement,
      evidenceRole: atom.evidenceRole, directness: atom.directness, origin: atom.origin,
      confidence: atom.confidence, verificationStatus: atom.verificationStatus,
      sourceRefs: atom.sourceRefs
    })));
  }

  function promptEnvelope(stage, stablePrefix, instruction, responseSchema) {
    return deepFreeze({
      version: RESEARCH_LOGIC_PROMPT_VERSION,
      stage,
      stablePrefix,
      systemPrompt: stablePrefix,
      userPrompt: instruction,
      responseSchema
    });
  }

  const SOURCE_REF_SCHEMA = deepFreeze({
    type: 'object',
    required: [
      'paragraphId', 'sourceIdentity', 'sourceKey', 'textHash', 'quote',
      'citationRefs', 'sectionPath', 'documentHash'
    ],
    additionalProperties: false,
    properties: {
      paragraphId: { type: 'string' },
      sourceIdentity: { type: 'string' },
      sourceKey: { type: 'string' },
      textHash: { type: 'string' },
      quote: { type: 'string' },
      citationRefs: { type: 'array', items: { type: 'string' } },
      sectionPath: { type: 'array', items: { type: 'string' } },
      documentHash: { type: 'string' }
    }
  });

  const EVIDENCE_ATOM_SCHEMA = deepFreeze({
    type: 'object',
    required: [
      'evidenceId', 'type', 'statement', 'sourceRefs', 'evidenceRole',
      'directness', 'origin', 'confidence', 'verificationStatus'
    ],
    additionalProperties: false,
    properties: {
      evidenceId: { type: 'string' },
      type: {
        type: 'string',
        enum: ['B', 'K', 'E', 'X', 'G', 'R', 'Q', 'H', 'A']
      },
      statement: { type: 'string' },
      sourceRefs: { type: 'array', minItems: 1, items: SOURCE_REF_SCHEMA },
      evidenceRole: {
        type: 'string', enum: [
          'context', 'direct_evidence', 'indirect_evidence', 'association',
          'intervention', 'necessity', 'sufficiency', 'rescue', 'boundary',
          'author_statement', 'unknown'
        ]
      },
      directness: {
        type: 'string', enum: [
          'same_cell_same_region', 'same_system', 'adjacent_system',
          'external_system', 'conceptual', 'not_applicable', 'unknown'
        ]
      },
      origin: {
        type: 'string', enum: [
          'author_explicit', 'brevess_reconstructed', 'legacy_unclassified'
        ]
      },
      confidence: {
        type: 'string', enum: ['high', 'medium', 'low', 'unknown']
      },
      verificationStatus: {
        type: 'string', enum: [
          'verified', 'evidence_insufficient', 'ambiguous', 'stale'
        ]
      }
    }
  });

  const PAPER_POINT_SCHEMA = deepFreeze({
    type: 'object',
    required: ['pointId', 'text', 'evidenceIds', 'origin', 'confidence', 'scope'],
    additionalProperties: false,
    properties: {
      pointId: { type: 'string' },
      text: { type: 'string' },
      evidenceIds: { type: 'array', minItems: 1, items: { type: 'string' } },
      origin: {
        type: 'string', enum: ['author_explicit', 'brevess_reconstructed']
      },
      confidence: {
        type: 'string', enum: ['high', 'medium', 'low', 'unknown']
      },
      scope: { type: 'string' }
    }
  });

  const QUESTION_SCHEMA = deepFreeze({
    type: 'object',
    required: [
      'questionId', 'text', 'authorWording', 'evidenceIds', 'origin', 'confidence'
    ],
    additionalProperties: false,
    properties: {
      questionId: { type: 'string' },
      text: { type: 'string' },
      authorWording: { type: 'string' },
      evidenceIds: { type: 'array', minItems: 1, items: { type: 'string' } },
      origin: {
        type: 'string', enum: ['author_explicit', 'brevess_reconstructed']
      },
      confidence: {
        type: 'string', enum: ['high', 'medium', 'low', 'unknown']
      }
    }
  });

  function compileAtomicEvidencePrompt(document) {
    return promptEnvelope('atomic_evidence', [
      'You extract evidence atoms from one biomedical paper. Use only supplied canonical source records.',
      'Ontology: B background; K known mechanism; E prior evidence; X knowledge gap; G rationale; R result; Q author question; H hypothesis; A author aim.',
      'Every atom must cite paragraphId/sourceIdentity/textHash and a short exact quote. Mark author_explicit versus brevess_reconstructed. Do not infer causal strength beyond the text.',
      `CANONICAL_EVIDENCE_DOCUMENT_V${clean(document?.version, 20) || '1'}:`,
      clean(document?.stableText, 90000)
    ].join('\n'), 'Return atomic evidence as schema-valid JSON. No prose outside JSON.', {
      type: 'object', required: ['atoms'], additionalProperties: false,
      properties: { atoms: { type: 'array', minItems: 1, items: EVIDENCE_ATOM_SCHEMA } }
    });
  }

  function groundedPrompt(stage, atoms, instruction, required, properties) {
    return promptEnvelope(stage, [
      'Use only the normalized evidence atoms below. Refer to evidenceId values; never invent a source.',
      'Preserve author_explicit versus brevess_reconstructed. Methods are not scientific questions. Results-only discoveries must not appear in Q0 unless Introduction evidence names them.',
      'Causal wording must match association, intervention, necessity, sufficiency or rescue evidence.',
      `NORMALIZED_ATOMS_V${RESEARCH_LOGIC_VERSION}:${canonicalAtoms(atoms)}`
    ].join('\n'), instruction, {
      type: 'object', required, additionalProperties: false, properties
    });
  }

  function compileQuestionTracePrompt(atoms) {
    return groundedPrompt('question_trace', atoms,
      'Derive B/K/E/X/G/A -> exactly one paper-level Q0. Return bridge and coreQuestion with evidenceIds, origin and confidence.',
      ['bridge', 'coreQuestion'], {
        bridge: {
          type: 'array', items: {
            type: 'object',
            required: ['traceId', 'type', 'evidenceIds', 'statement', 'relation', 'origin'],
            additionalProperties: false,
            properties: {
              traceId: { type: 'string' },
              type: { type: 'string', enum: [...TRACE_TYPES] },
              evidenceIds: { type: 'array', minItems: 1, items: { type: 'string' } },
              statement: { type: 'string' },
              relation: { type: 'string' },
              origin: {
                type: 'string', enum: ['author_explicit', 'brevess_reconstructed']
              }
            }
          }
        },
        coreQuestion: QUESTION_SCHEMA
      });
  }

  function compileQuestionProgressionPrompt(atoms, trace) {
    return groundedPrompt('progression', atoms,
      `Starting from ${clean(trace?.coreQuestion?.questionId, 80) || 'Q0'}, return at most Q1-Q4 in logical order. Each generatedFrom must point backward and each step includes hypothesis, test, result, warrantedConclusion, causalLevel, remainingGap and evidenceIds.`,
      ['progression'], {
        progression: {
          type: 'array', items: {
            type: 'object',
            required: [
              ...QUESTION_SCHEMA.required, 'generatedFrom', 'hypothesis', 'test',
              'result', 'warrantedConclusion', 'remainingGap', 'causalLevel'
            ],
            additionalProperties: false,
            properties: {
              ...QUESTION_SCHEMA.properties,
              generatedFrom: {
                type: 'array', minItems: 1, items: { type: 'string' }
              },
              hypothesis: { type: 'string' },
              test: { type: 'string' },
              result: { type: 'string' },
              warrantedConclusion: { type: 'string' },
              remainingGap: { type: 'string' },
              causalLevel: { type: 'string', enum: [...CAUSAL_LEVELS] }
            }
          }
        }
      });
  }

  function compileResearchAuditPrompt(atoms, trace, progression) {
    return groundedPrompt('audit', atoms,
      `Audit source binding, result leakage and causal levels for trace ${clean(JSON.stringify(trace), 12000)} and progression ${clean(JSON.stringify(progression), 24000)}. Do not rewrite unsupported claims; flag them.`,
      ['issues', 'acceptedQuestionIds'], {
        issues: { type: 'array', items: { type: 'string' } },
        acceptedQuestionIds: { type: 'array', items: { type: 'string' } }
      });
  }

  function compileInnovationPrompt(atoms) {
    return groundedPrompt('innovation', atoms,
      'Return concise paper-level innovation points. Each point needs evidenceIds, novelty type, origin, confidence and a bounded claim. Do not confuse a method name with novelty.',
      ['innovationPoints'], {
        innovationPoints: { type: 'array', items: PAPER_POINT_SCHEMA }
      });
  }

  function compileLimitationsPrompt(atoms) {
    return groundedPrompt('limitations', atoms,
      'Return concise research limitations. Separate author-explicit limitations from evidence-bounded Brevess reconstructions. Each point needs evidenceIds, scope and confidence.',
      ['limitationPoints'], {
        limitationPoints: { type: 'array', items: PAPER_POINT_SCHEMA }
      });
  }

  function researchEvidenceCacheKey(options = {}) {
    const canonical = {
      documentHash: clean(options.documentHash, 200),
      evidenceVersion: clean(options.evidenceVersion, 40) || (shared.RESEARCH_EVIDENCE_VERSION || '1'),
      promptVersion: clean(options.promptVersion, 40) || RESEARCH_LOGIC_PROMPT_VERSION,
      behaviorSignature: clean(options.behaviorSignature, 400),
      baseScope: clean(options.baseScope, 120) || 'article'
    };
    return `research-evidence:${stableHash(JSON.stringify(canonical))}`;
  }

  function stageCacheKey(baseKey, stage, dependency = '') {
    return `${baseKey}:${stage}:${stableHash(dependency || stage)}`;
  }

  async function readCache(cacheStore, key) {
    if (!cacheStore?.getMany) return null;
    const values = await cacheStore.getMany([key]);
    return values?.get?.(key)?.value ?? null;
  }

  async function writeCache(cacheStore, key, value) {
    if (!cacheStore?.setMany) return;
    await cacheStore.setMany([{ key, createdAt: Date.now(), value }]);
  }

  function invalidStage(stage, detail) {
    const error = new Error(`Invalid ${stage} response${detail ? `: ${detail}` : ''}`);
    error.code = 'INVALID_RESPONSE';
    error.stage = stage;
    return error;
  }

  function isRetryableProviderFailure(error) {
    return error?.retryable === true || [
      'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED'
    ].includes(error?.code);
  }

  async function requestValidatedStage(adapter, prompt, validate) {
    let raw;
    let stageError;
    try {
      raw = await adapter.generateJson({
        ...prompt,
        signal: prompt.signal,
        outputUnits: prompt.stage === 'atomic_evidence' ? 16 : 4
      });
      return validate(raw);
    } catch (firstError) {
      stageError = firstError;
    }
    if (prompt.retryTransient !== false && isRetryableProviderFailure(stageError)) {
      await new Promise(resolve => setTimeout(resolve, 250));
      try {
        raw = await adapter.generateJson({
          ...prompt,
          signal: prompt.signal,
          outputUnits: prompt.stage === 'atomic_evidence' ? 16 : 4
        });
        return validate(raw);
      } catch (retryError) {
        stageError = retryError;
      }
    }
    if (stageError?.code && stageError.code !== 'INVALID_RESPONSE') throw stageError;
    {
      const repairPrompt = {
        stage: 'repair',
        systemPrompt: 'Repair one structured JSON response. Use only the supplied invalid response and validation error. Return JSON only. Do not add evidence or article text.',
        stablePrefix: 'SCHEMA_REPAIR_WITHOUT_ARTICLE_V1',
        userPrompt: JSON.stringify({
          targetStage: prompt.stage,
          validationError: clean(stageError?.message || 'schema validation failed', 500),
          invalidResponse: raw ?? null
        }),
        responseSchema: prompt.responseSchema
      };
      const repaired = await adapter.generateJson({
        ...repairPrompt,
        signal: prompt.signal,
        outputUnits: prompt.stage === 'atomic_evidence' ? 16 : 4
      });
      return validate(repaired);
    }
  }

  function pipelineOptions(options = {}) {
    if (!options.adapter || typeof options.adapter.generateJson !== 'function') {
      throw invalidStage('configuration', 'adapter.generateJson is required');
    }
    const baseKey = researchEvidenceCacheKey({
      documentHash: options.documentHash || options.document?.documentHash,
      evidenceVersion: options.document?.version || shared.RESEARCH_EVIDENCE_VERSION,
      promptVersion: RESEARCH_LOGIC_PROMPT_VERSION,
      behaviorSignature: options.behaviorSignature,
      baseScope: options.baseScope
    });
    return { ...options, baseKey };
  }

  function deterministicResearchEvidenceAtoms(document = {}) {
    const records = Array.isArray(document.records) ? document.records : [];
    const rawAtoms = [];
    const patterns = [
      {
        type: 'X',
        pattern: /\b(?:remain(?:s|ed)? unknown|is unknown|unclear|poorly understood|not known|knowledge gap)\b|尚不清楚|仍未知|有待阐明/iu,
        role: 'boundary'
      },
      {
        type: 'A',
        pattern: /\b(?:here we|we (?:sought|aimed|tested|investigated|examined|asked|determined)|this study (?:aims|investigates|examines))\b|本研究(?:旨在|探讨|研究)|我们(?:旨在|检验|研究|探讨)/iu,
        role: 'author_statement'
      },
      {
        type: 'Q',
        pattern: /\?|是否|何种|如何|为什么/iu,
        role: 'author_statement'
      }
    ];
    for (const [index, record] of records.entries()) {
      if (!record || typeof record !== 'object') continue;
      const statement = clean(record.text || record.canonicalText, 1200);
      if (!statement) continue;
      const section = clean(
        `${record.sectionKind || ''} ${record.sectionTitle || ''} ${(record.sectionPath || []).join(' ')}`,
        500
      ).toLowerCase();
      if (!/abstract|summary|intro|background|结果|讨论|result|discussion|摘要|引言|背景/iu.test(section)) {
        continue;
      }
      const matched = patterns.find(candidate => candidate.pattern.test(statement));
      const type = matched?.type || (/result|discussion|结果|讨论/iu.test(section) ? 'R' : 'B');
      const sourceRef = {
        paragraphId: clean(record.paragraphId, 240),
        sourceIdentity: clean(record.sourceIdentity || record.sourceKey || record.paragraphId, 360),
        sourceKey: clean(record.sourceKey || record.paragraphId, 360),
        textHash: clean(record.textHash, 160),
        quote: clean(statement, 360),
        citationRefs: [],
        sectionPath: (Array.isArray(record.sectionPath) ? record.sectionPath : [])
          .map(item => clean(typeof item === 'string' ? item : item?.title, 180))
          .filter(Boolean).slice(0, 12),
        documentHash: clean(document.documentHash || record.documentHash, 160)
      };
      if (!sourceRef.paragraphId && !sourceRef.sourceIdentity && !sourceRef.sourceKey) continue;
      rawAtoms.push({
        evidenceId: `${type}${rawAtoms.length + 1}`,
        type,
        statement,
        sourceRefs: [sourceRef],
        evidenceRole: matched?.role || (type === 'R' ? 'direct_evidence' : 'context'),
        directness: 'conceptual',
        origin: 'author_explicit',
        confidence: 'low',
        verificationStatus: 'verified'
      });
      if (rawAtoms.length >= 48 || index >= 159) break;
    }
    return typeof shared.normalizeResearchEvidenceSet === 'function'
      ? shared.normalizeResearchEvidenceSet(rawAtoms) : rawAtoms;
  }

  function deterministicQuestionTrace(atoms) {
    const candidates = Array.isArray(atoms) ? atoms : [];
    const question = candidates.find(atom => atom.type === 'question') ||
      candidates.find(atom => atom.type === 'author_aim') ||
      candidates.find(atom => atom.type === 'knowledge_gap') ||
      candidates.find(atom => atom.type === 'background');
    if (!question) return null;
    const authorExplicit = question.type === 'question';
    const coreQuestion = {
      questionId: 'Q0',
      text: authorExplicit
        ? question.statement
        : `本研究围绕以下原文目标或缺口展开：${question.statement}？`,
      authorWording: authorExplicit ? question.statement : '',
      evidenceIds: [question.evidenceId],
      origin: authorExplicit ? 'author_explicit' : 'brevess_reconstructed',
      confidence: 'low'
    };
    const bridge = candidates
      .filter(atom => ['background', 'known_mechanism', 'prior_evidence',
        'knowledge_gap', 'rationale', 'author_aim'].includes(atom.type))
      .slice(0, 8).map((atom, index) => ({
        traceId: `T${index + 1}`,
        type: ({
          background: 'B', known_mechanism: 'K', prior_evidence: 'E',
          knowledge_gap: 'X', rationale: 'G', author_aim: 'A'
        })[atom.type] || 'B',
        evidenceIds: [atom.evidenceId],
        statement: atom.statement,
        relation: '原文证据',
        origin: atom.origin === 'author_explicit'
          ? 'author_explicit' : 'brevess_reconstructed'
      }));
    return normalizeResearchQuestionTrace({ coreQuestion, bridge }, candidates);
  }

  async function loadAtomicEvidence(options, cacheState, diagnostics) {
    const key = stageCacheKey(options.baseKey, 'atomic_evidence');
    if (options.forceRefresh !== true) {
      const cached = await readCache(options.cacheStore, key);
      const normalized = typeof shared.normalizeResearchEvidenceSet === 'function'
        ? shared.normalizeResearchEvidenceSet(cached) : [];
      if (normalized.length) {
        cacheState.atomicEvidence = 'hit';
        options.onProgress?.({ stage: 'atomic_evidence', status: 'complete', cacheHit: true, evidenceCount: normalized.length });
        return normalized;
      }
    }
    cacheState.atomicEvidence = 'miss';
    options.onProgress?.({ stage: 'atomic_evidence', status: 'running', cacheHit: false });
    const validateAtoms = raw => {
      const normalized = typeof shared.normalizeResearchEvidenceSet === 'function'
        ? shared.normalizeResearchEvidenceSet(raw?.atoms) : [];
      if (!normalized.length) throw invalidStage('atomic_evidence', 'atoms are empty');
      return normalized;
    };
    const prompt = {
      ...compileAtomicEvidencePrompt(options.document),
      signal: options.signal,
      retryTransient: false
    };
    let atoms;
    let compactRetry = false;
    let compactDocument = null;
    try {
      atoms = await requestValidatedStage(options.adapter, prompt, validateAtoms);
    } catch (error) {
      const retryable = error?.retryable === true || [
        'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'PROVIDER_UNAVAILABLE'
      ].includes(error?.code);
      if (retryable && typeof shared.compactResearchEvidenceDocument === 'function') {
        compactDocument = shared.compactResearchEvidenceDocument(options.document, {
          maxCharacters: Math.min(
            18000,
            Math.max(8000, Math.floor(Number(options.document?.characterCount) * 0.55) || 18000)
          )
        });
        if (compactDocument?.records?.length &&
            compactDocument.characterCount < Number(options.document?.characterCount || Infinity)) {
          compactRetry = true;
          options.onProgress?.({
            stage: 'atomic_evidence', status: 'retrying_compact', cacheHit: false,
            evidenceCharacters: compactDocument.characterCount,
            errorCode: error?.code || 'NETWORK_ERROR'
          });
          try {
            atoms = await requestValidatedStage(options.adapter, {
              ...compileAtomicEvidencePrompt(compactDocument),
              signal: options.signal,
              retryTransient: false
            }, validateAtoms);
          } catch (compactError) {
            diagnostics.push({
              stage: 'atomic_evidence', code: compactError?.code || 'INVALID_RESPONSE',
              compactRetry: true
            });
          }
        }
      }
      if (!atoms?.length) {
        atoms = deterministicResearchEvidenceAtoms(options.document);
        if (!atoms.length) throw error;
        diagnostics.push({
          stage: 'atomic_evidence', code: 'deterministic_evidence_fallback',
          providerCode: error?.code || 'INVALID_RESPONSE'
        });
      }
    }
    await writeCache(options.cacheStore, key, atoms);
    options.onProgress?.({ stage: 'atomic_evidence', status: 'complete', cacheHit: false, evidenceCount: atoms.length });
    diagnostics.push({
      stage: 'atomic_evidence', cacheHit: false, compactRetry,
      ...(compactDocument ? {
        initialCharacters: Number(options.document?.characterCount) || 0,
        retryCharacters: compactDocument.characterCount
      } : {})
    });
    return atoms;
  }

  async function cachedValidatedStage(options, cacheState, stage, dependency, prompt, validate) {
    const key = stageCacheKey(options.baseKey, stage, dependency);
    if (options.forceRefresh !== true) {
      const cached = await readCache(options.cacheStore, key);
      if (cached != null) {
        try {
          const value = validate(cached);
          cacheState[stage] = 'hit';
          options.onProgress?.({ stage, status: 'complete', cacheHit: true });
          return value;
        } catch (_) {}
      }
    }
    cacheState[stage] = 'miss';
    options.onProgress?.({ stage, status: 'running', cacheHit: false });
    const value = await requestValidatedStage(options.adapter, { ...prompt, signal: options.signal }, validate);
    await writeCache(options.cacheStore, key, value);
    options.onProgress?.({ stage, status: 'complete', cacheHit: false });
    return value;
  }

  function normalizePointList(raw, key, evidenceIndex) {
    const source = Array.isArray(raw?.[key]) ? raw[key] : [];
    const result = [];
    for (const item of source) {
      const text = clean(typeof item === 'string' ? item : item?.text || item?.value, 1200);
      const evidenceIds = resolvedEvidenceIds(item?.evidenceIds || item?.evidence_ids, evidenceIndex);
      if (!text || !evidenceIds.length) continue;
      result.push({
        pointId: clean(item?.pointId || item?.point_id, 80) || `${key}-${result.length + 1}`,
        text,
        evidenceIds,
        origin: ['author_explicit', 'brevess_reconstructed'].includes(clean(item?.origin, 80))
          ? clean(item.origin, 80) : 'brevess_reconstructed',
        confidence: ['high', 'medium', 'low', 'unknown'].includes(clean(item?.confidence, 40))
          ? clean(item.confidence, 40) : 'unknown',
        scope: clean(item?.scope || item?.noveltyType || item?.novelty_type, 240)
      });
      if (result.length >= 12) break;
    }
    if (!result.length) throw invalidStage(key, 'no evidence-grounded points');
    return deepFreeze(result);
  }

  async function runResearchLogicPipeline(rawOptions = {}) {
    const options = pipelineOptions(rawOptions);
    const cache = {};
    const diagnostics = [];
    const atoms = await loadAtomicEvidence(options, cache, diagnostics);
    const evidenceIndex = asEvidenceIndex(atoms);
    if (diagnostics.some(item => item?.code === 'deterministic_evidence_fallback')) {
      const fallbackTrace = deterministicQuestionTrace(atoms);
      const fallbackAudit = auditResearchLogic({
        questionTrace: fallbackTrace,
        progression: []
      }, evidenceIndex);
      return deepFreeze({
        version: RESEARCH_LOGIC_VERSION,
        atomicEvidence: atoms,
        questionTrace: fallbackTrace,
        progression: [],
        audit: fallbackAudit,
        cache,
        diagnostics,
        partial: true
      });
    }
    let trace;
    try {
      trace = await cachedValidatedStage(
        options, cache, 'questionTrace', stableHash(canonicalAtoms(atoms)),
        compileQuestionTracePrompt(atoms),
        raw => {
          const normalized = normalizeResearchQuestionTrace(raw, evidenceIndex);
          if (!normalized.coreQuestion) throw invalidStage('question_trace', 'Q0 is missing');
          return normalized;
        }
      );
    } catch (error) {
      diagnostics.push({ stage: 'question_trace', code: error?.code || 'INVALID_RESPONSE' });
      trace = deterministicQuestionTrace(atoms);
      if (!trace?.coreQuestion) {
        return deepFreeze({ version: RESEARCH_LOGIC_VERSION, atomicEvidence: atoms, questionTrace: null, progression: [], audit: null, cache, diagnostics, partial: true });
      }
      diagnostics.push({
        stage: 'question_trace', code: 'deterministic_evidence_fallback'
      });
    }
    let progression;
    try {
      progression = await cachedValidatedStage(
        options, cache, 'progression', stableHash(`${canonicalAtoms(atoms)}|${JSON.stringify(trace)}`),
        compileQuestionProgressionPrompt(atoms, trace),
        raw => {
          const normalized = normalizeResearchQuestionProgression(raw?.progression, evidenceIndex, { rootQuestionId: 'Q0' });
          if (!normalized.length) throw invalidStage('progression', 'Q1-Q4 are missing');
          return normalized;
        }
      );
    } catch (error) {
      diagnostics.push({ stage: 'progression', code: error?.code || 'INVALID_RESPONSE' });
      const audit = auditResearchLogic({ questionTrace: trace, progression: [] }, evidenceIndex);
      return deepFreeze({ version: RESEARCH_LOGIC_VERSION, atomicEvidence: atoms, questionTrace: trace, progression: [], audit, cache, diagnostics, partial: true });
    }
    try {
      await cachedValidatedStage(
        options, cache, 'audit', stableHash(`${JSON.stringify(trace)}|${JSON.stringify(progression)}`),
        compileResearchAuditPrompt(atoms, trace, progression),
        raw => {
          if (!Array.isArray(raw?.issues) || !Array.isArray(raw?.acceptedQuestionIds)) {
            throw invalidStage('audit', 'issues or acceptedQuestionIds missing');
          }
          return deepFreeze({ issues: raw.issues.map(item => clean(item, 500)).filter(Boolean).slice(0, 32), acceptedQuestionIds: raw.acceptedQuestionIds.map(item => clean(item, 80)).filter(Boolean).slice(0, 8) });
        }
      );
    } catch (error) {
      diagnostics.push({ stage: 'audit', code: error?.code || 'INVALID_RESPONSE' });
    }
    const audit = auditResearchLogic({ questionTrace: trace, progression }, evidenceIndex);
    return deepFreeze({
      version: RESEARCH_LOGIC_VERSION,
      atomicEvidence: atoms,
      questionTrace: trace,
      progression: progression.filter(item => audit.acceptedProgressionIds.includes(item.questionId)),
      audit,
      cache,
      diagnostics,
      partial: audit.validCoreQuestion !== true || audit.acceptedProgressionIds.length < progression.length
    });
  }

  async function runPointAnalysis(rawOptions, stage, compiler, key) {
    const options = pipelineOptions(rawOptions);
    const cache = {};
    const diagnostics = [];
    const atoms = await loadAtomicEvidence(options, cache, diagnostics);
    const evidenceIndex = asEvidenceIndex(atoms);
    try {
      const points = await cachedValidatedStage(
        options, cache, stage, stableHash(canonicalAtoms(atoms)), compiler(atoms),
        raw => normalizePointList(raw, key, evidenceIndex)
      );
      return deepFreeze({ version: RESEARCH_LOGIC_VERSION, atomicEvidence: atoms, [key]: points, cache, diagnostics, partial: false });
    } catch (error) {
      diagnostics.push({ stage, code: error?.code || 'INVALID_RESPONSE' });
      return deepFreeze({ version: RESEARCH_LOGIC_VERSION, atomicEvidence: atoms, [key]: [], cache, diagnostics, partial: true });
    }
  }

  function runInnovationAnalysis(options) {
    return runPointAnalysis(options, 'innovation', compileInnovationPrompt, 'innovationPoints');
  }

  function runLimitationAnalysis(options) {
    return runPointAnalysis(options, 'limitations', compileLimitationsPrompt, 'limitationPoints');
  }

  return {
    RESEARCH_LOGIC_VERSION,
    RESEARCH_LOGIC_PROMPT_VERSION,
    normalizeResearchQuestionTrace,
    normalizeResearchQuestionProgression,
    auditResearchLogic,
    compileAtomicEvidencePrompt,
    compileQuestionTracePrompt,
    compileQuestionProgressionPrompt,
    compileResearchAuditPrompt,
    compileInnovationPrompt,
    compileLimitationsPrompt,
    researchEvidenceCacheKey,
    runResearchLogicPipeline,
    runInnovationAnalysis,
    runLimitationAnalysis
  };
});
