const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/research-evidence.js');
const {
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
} = require('../core/research-logic-pipeline.js');

const atoms = [
  { evidenceId: 'B1', type: 'B', statement: 'PV plasticity supports circuit adaptation.', sourceRefs: [{ paragraphId: 'intro-1', sourceIdentity: 'intro:1', quote: 'supports circuit adaptation' }], origin: 'author_explicit', verificationStatus: 'verified' },
  { evidenceId: 'X1', type: 'X', statement: 'The regulator of this plasticity is unknown.', sourceRefs: [{ paragraphId: 'intro-2', sourceIdentity: 'intro:2', quote: 'regulator is unknown' }], origin: 'author_explicit', verificationStatus: 'verified' },
  { evidenceId: 'A1', type: 'A', statement: 'The study seeks regulators of PV plasticity.', sourceRefs: [{ paragraphId: 'intro-3', sourceIdentity: 'intro:3', quote: 'seeks regulators' }], origin: 'author_explicit', verificationStatus: 'verified' },
  { evidenceId: 'R1', type: 'R', statement: 'Meis2 emerged from the screen.', sourceRefs: [{ paragraphId: 'results-1', sourceIdentity: 'results:1', quote: 'Meis2 emerged' }], origin: 'author_explicit', verificationStatus: 'verified' },
  { evidenceId: 'R2', type: 'R', statement: 'Loss causes a deficit.', sourceRefs: [{ paragraphId: 'results-2', sourceIdentity: 'results:2', quote: 'causes a deficit' }], evidenceRole: 'intervention', origin: 'author_explicit', verificationStatus: 'verified' },
  { evidenceId: 'R3', type: 'R', statement: 'Re-expression restores the phenotype.', sourceRefs: [{ paragraphId: 'results-3', sourceIdentity: 'results:3', quote: 'restores the phenotype' }], evidenceRole: 'rescue', origin: 'author_explicit', verificationStatus: 'verified' }
];
const evidenceIndex = new Map(atoms.map(item => [item.evidenceId, item]));

test('requires exactly one Q0 and resolves only evidence IDs', () => {
  const trace = normalizeResearchQuestionTrace({
    coreQuestion: { questionId: 'Q0', text: 'Which regulators control PV plasticity?', evidenceIds: ['B1', 'X1', 'A1'], origin: 'brevess_reconstructed' },
    bridge: [
      { traceId: 'T1', type: 'B', evidenceIds: ['B1'] },
      { traceId: 'T2', type: 'K', evidenceIds: ['missing'] },
      { traceId: 'T3', type: 'X', evidenceIds: ['X1'] }
    ]
  }, evidenceIndex);
  assert.equal(trace.coreQuestion.questionId, 'Q0');
  assert.deepEqual(trace.coreQuestion.evidenceIds, ['B1', 'X1', 'A1']);
  assert.deepEqual(trace.bridge.map(item => item.traceId), ['T1', 'T3']);
});

test('limits progression to Q1-Q4 and requires generatedFrom to point backward', () => {
  const progression = normalizeResearchQuestionProgression([
    { questionId: 'Q1', text: 'Which regulator emerges?', generatedFrom: ['Q0'], evidenceIds: ['R1'] },
    { questionId: 'Q2', text: 'Is it functionally required?', generatedFrom: ['Q1'], evidenceIds: ['R2'] },
    { questionId: 'Q3', text: 'Can rescue restore function?', generatedFrom: ['Q2'], evidenceIds: ['R3'] },
    { questionId: 'Q4', text: 'What boundary remains?', generatedFrom: ['Q3'], evidenceIds: ['R3'] },
    { questionId: 'Q5', text: 'Must be dropped', generatedFrom: ['Q4'], evidenceIds: ['R3'] },
    { questionId: 'Q2', text: 'Duplicate', generatedFrom: ['Q3'], evidenceIds: ['R2'] }
  ], evidenceIndex, { rootQuestionId: 'Q0' });
  assert.deepEqual(progression.map(item => item.questionId), ['Q1', 'Q2', 'Q3', 'Q4']);
});

test('rejects a Results-only discovery from Q0 but allows it after discovery evidence', () => {
  const audit = auditResearchLogic({
    questionTrace: { coreQuestion: { questionId: 'Q0', text: 'Does Meis2 control PV plasticity?', evidenceIds: ['R1'] } },
    progression: [{ questionId: 'Q1', text: 'Does Meis2 associate with restored function?', generatedFrom: ['Q0'], evidenceIds: ['R1', 'R3'], causalLevel: 'association' }]
  }, evidenceIndex);
  assert.equal(audit.validCoreQuestion, false);
  assert.match(audit.issues.join(' '), /RESULTS_ONLY_Q0/);
  assert.deepEqual(audit.acceptedProgressionIds, ['Q1']);
});

test('causal audit rejects necessity-and-sufficiency overclaim and accepts supported rescue', () => {
  const invalid = auditResearchLogic({
    questionTrace: { coreQuestion: { questionId: 'Q0', text: 'Which regulator matters?', evidenceIds: ['B1', 'X1'] } },
    progression: [{ questionId: 'Q1', text: 'Is the candidate causal?', generatedFrom: ['Q0'], evidenceIds: ['R1'], causalLevel: 'necessity_and_sufficiency' }]
  }, evidenceIndex);
  assert.match(invalid.issues.join(' '), /CAUSAL_OVERCLAIM/);

  const valid = auditResearchLogic({
    questionTrace: { coreQuestion: { questionId: 'Q0', text: 'Which regulator matters?', evidenceIds: ['B1', 'X1'] } },
    progression: [{ questionId: 'Q1', text: 'Can restoration rescue the deficit?', generatedFrom: ['Q0'], evidenceIds: ['R2', 'R3'], causalLevel: 'rescue' }]
  }, evidenceIndex);
  assert.deepEqual(valid.acceptedProgressionIds, ['Q1']);
  assert.doesNotMatch(valid.issues.join(' '), /CAUSAL_OVERCLAIM/);
});

test('staged prompts keep article text only in Stage 1 and ground later tasks in atom IDs', () => {
  const document = { version: '1', stableText: 'FULL ARTICLE EVIDENCE', documentHash: 'doc1' };
  const atomic = compileAtomicEvidencePrompt(document);
  assert.match(atomic.stablePrefix, /FULL ARTICLE EVIDENCE/);
  for (const prompt of [
    compileQuestionTracePrompt(atoms), compileQuestionProgressionPrompt(atoms, { coreQuestion: { questionId: 'Q0' } }),
    compileResearchAuditPrompt(atoms, { coreQuestion: { questionId: 'Q0' } }, []),
    compileInnovationPrompt(atoms), compileLimitationsPrompt(atoms)
  ]) {
    assert.match(prompt.stablePrefix, /"evidenceId":"B1"/);
    assert.doesNotMatch(prompt.stablePrefix, /FULL ARTICLE EVIDENCE/);
    assert.doesNotMatch(prompt.stablePrefix, /operationId|timestamp|retry/i);
  }
});

test('every structured prompt declares each required root field for strict providers', () => {
  const prompts = [
    compileAtomicEvidencePrompt({ version: '1', stableText: 'ARTICLE' }),
    compileQuestionTracePrompt(atoms),
    compileQuestionProgressionPrompt(atoms, { coreQuestion: { questionId: 'Q0' } }),
    compileResearchAuditPrompt(atoms, { coreQuestion: { questionId: 'Q0' } }, []),
    compileInnovationPrompt(atoms),
    compileLimitationsPrompt(atoms)
  ];
  for (const prompt of prompts) {
    assert.equal(prompt.responseSchema.type, 'object');
    for (const key of prompt.responseSchema.required || []) {
      assert.ok(prompt.responseSchema.properties?.[key], `${prompt.stage} must declare ${key}`);
    }
  }
  const atomSchema = prompts[0].responseSchema.properties.atoms.items;
  assert.deepEqual(atomSchema.required, [
    'evidenceId', 'type', 'statement', 'sourceRefs', 'evidenceRole',
    'directness', 'origin', 'confidence', 'verificationStatus'
  ]);
  assert.deepEqual(atomSchema.properties.sourceRefs.items.required, [
    'paragraphId', 'sourceIdentity', 'sourceKey', 'textHash', 'quote',
    'citationRefs', 'sectionPath', 'documentHash'
  ]);
  for (const prompt of [prompts[4], prompts[5]]) {
    const key = prompt.stage === 'innovation' ? 'innovationPoints' : 'limitationPoints';
    const pointSchema = prompt.responseSchema.properties[key].items;
    assert.deepEqual(pointSchema.required,
      ['pointId', 'text', 'evidenceIds', 'origin', 'confidence', 'scope']);
    assert.equal(pointSchema.additionalProperties, false);
    assert.equal(pointSchema.properties.evidenceIds.minItems, 1);
  }
});

test('repeated invalid DeepSeek-style structured output falls back to exact article evidence', async () => {
  let calls = 0;
  const adapter = {
    async generateJson() {
      calls += 1;
      return { atoms: [{}] };
    }
  };
  const document = {
    version: '2', documentHash: 'doc-fallback', characterCount: 320,
    stableText: 'canonical records',
    records: [
      {
        paragraphId: 'intro-1', sourceIdentity: 'intro:1', sourceKey: 'intro-1',
        textHash: 'hash-1', sectionKind: 'introduction', sectionTitle: 'Introduction',
        sectionPath: ['Introduction'],
        text: 'Hippocampal ripple routing to subcortical targets remains unknown.'
      },
      {
        paragraphId: 'intro-2', sourceIdentity: 'intro:2', sourceKey: 'intro-2',
        textHash: 'hash-2', sectionKind: 'introduction', sectionTitle: 'Introduction',
        sectionPath: ['Introduction'],
        text: 'Here we sought to determine how lateral septal neurons read hippocampal ripples.'
      }
    ]
  };
  const result = await runResearchLogicPipeline({
    document, documentHash: document.documentHash,
    behaviorSignature: 'deepseek|auto', adapter
  });
  assert.ok(result.atomicEvidence.length >= 2);
  assert.equal(result.questionTrace.coreQuestion.questionId, 'Q0');
  assert.ok(result.questionTrace.coreQuestion.evidenceIds.length >= 1);
  assert.equal(result.partial, true);
  assert.match(JSON.stringify(result.diagnostics), /deterministic_evidence_fallback/);
  assert.ok(calls <= 4, `provider calls must remain bounded, got ${calls}`);
});

test('research, innovation and limitation operations share the same Stage 1 cache key', () => {
  const options = { documentHash: 'doc1', evidenceVersion: '1', promptVersion: '1', behaviorSignature: 'deepseek|auto' };
  assert.equal(researchEvidenceCacheKey({ ...options, task: 'research' }), researchEvidenceCacheKey({ ...options, task: 'innovation' }));
  assert.equal(researchEvidenceCacheKey({ ...options, task: 'research' }), researchEvidenceCacheKey({ ...options, task: 'limitations' }));
  assert.notEqual(researchEvidenceCacheKey(options), researchEvidenceCacheKey({ ...options, behaviorSignature: 'deepseek|high' }));
});

test('three independent operations reuse one Stage 1 provider result', async () => {
  const entries = new Map();
  const cacheStore = {
    async getMany(keys) { return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)])); },
    async setMany(values) { values.forEach(value => entries.set(value.key, value)); }
  };
  const calls = [];
  const adapter = {
    async generateJson(request) {
      calls.push(request.stage);
      if (request.stage === 'atomic_evidence') return { atoms };
      if (request.stage === 'question_trace') return {
        coreQuestion: { questionId: 'Q0', text: 'Which regulators control PV plasticity?', evidenceIds: ['B1', 'X1', 'A1'] },
        bridge: [{ traceId: 'T1', type: 'B', evidenceIds: ['B1'] }, { traceId: 'T2', type: 'X', evidenceIds: ['X1'] }]
      };
      if (request.stage === 'progression') return { progression: [
        { questionId: 'Q1', text: 'Which regulator emerges?', generatedFrom: ['Q0'], evidenceIds: ['R1'], causalLevel: 'association' }
      ] };
      if (request.stage === 'audit') return { issues: [], acceptedQuestionIds: ['Q0', 'Q1'] };
      if (request.stage === 'innovation') return { innovationPoints: [{ text: 'Links discovery to rescue.', evidenceIds: ['R1', 'R3'], origin: 'brevess_reconstructed', confidence: 'medium' }] };
      if (request.stage === 'limitations') return { limitationPoints: [{ text: 'Evidence is limited to one system.', evidenceIds: ['R2'], origin: 'brevess_reconstructed', confidence: 'medium' }] };
      throw new Error(`unexpected stage ${request.stage}`);
    }
  };
  const input = {
    document: { version: '1', documentHash: 'doc1', stableText: 'stable canonical evidence' },
    documentHash: 'doc1', behaviorSignature: 'deepseek|auto', adapter, cacheStore
  };
  const research = await runResearchLogicPipeline(input);
  const innovation = await runInnovationAnalysis(input);
  const limitations = await runLimitationAnalysis(input);
  assert.equal(calls.filter(stage => stage === 'atomic_evidence').length, 1);
  assert.equal(research.questionTrace.coreQuestion.questionId, 'Q0');
  assert.deepEqual(research.progression.map(item => item.questionId), ['Q1']);
  assert.equal(innovation.innovationPoints[0].text, 'Links discovery to rescue.');
  assert.equal(limitations.limitationPoints[0].text, 'Evidence is limited to one system.');
  assert.equal(innovation.cache.atomicEvidence, 'hit');
  assert.equal(limitations.cache.atomicEvidence, 'hit');
});

test('a later-stage failure preserves verified evidence and trace for a resumable retry', async () => {
  const entries = new Map();
  const cacheStore = {
    async getMany(keys) { return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)])); },
    async setMany(values) { values.forEach(value => entries.set(value.key, value)); }
  };
  let progressionAttempts = 0;
  const adapter = {
    async generateJson(request) {
      if (request.stage === 'atomic_evidence') return { atoms };
      if (request.stage === 'question_trace') return { coreQuestion: { questionId: 'Q0', text: 'Which regulators matter?', evidenceIds: ['B1', 'X1'] }, bridge: [] };
      if (request.stage === 'progression') {
        progressionAttempts += 1;
        return progressionAttempts < 2 ? { progression: [] } : { progression: [{ questionId: 'Q1', text: 'Which candidate?', generatedFrom: ['Q0'], evidenceIds: ['R1'] }] };
      }
      if (request.stage === 'repair') return { progression: [] };
      if (request.stage === 'audit') return { issues: [], acceptedQuestionIds: [] };
      throw new Error('unexpected');
    }
  };
  const input = { document: { version: '1', documentHash: 'doc1', stableText: 'stable' }, documentHash: 'doc1', behaviorSignature: 'deepseek|auto', adapter, cacheStore };
  const partial = await runResearchLogicPipeline(input);
  assert.equal(partial.partial, true);
  assert.equal(partial.questionTrace.coreQuestion.questionId, 'Q0');
  assert.deepEqual(partial.progression, []);
  const resumed = await runResearchLogicPipeline(input);
  assert.equal(resumed.cache.atomicEvidence, 'hit');
  assert.equal(resumed.cache.questionTrace, 'hit');
  assert.deepEqual(resumed.progression.map(item => item.questionId), ['Q1']);
});

test('retries atomic evidence once with a compact balanced document after a transient network failure', async () => {
  const atomicPromptSizes = [];
  let atomicAttempts = 0;
  const adapter = {
    async generateJson(request) {
      if (request.stage === 'atomic_evidence') {
        atomicAttempts += 1;
        atomicPromptSizes.push(request.systemPrompt.length);
        if (atomicAttempts === 1) {
          const error = new Error('Unable to reach the provider');
          error.code = 'NETWORK_ERROR';
          error.retryable = true;
          throw error;
        }
        return { atoms };
      }
      if (request.stage === 'innovation') {
        return {
          innovationPoints: [{
            text: 'Connects discovery to rescue.', evidenceIds: ['R1', 'R3'],
            origin: 'brevess_reconstructed', confidence: 'medium'
          }]
        };
      }
      throw new Error(`unexpected stage ${request.stage}`);
    }
  };
  const records = ['abstract', 'introduction', 'results', 'discussion'].flatMap(
    sectionKind => Array.from({ length: 5 }, (_, index) => ({
      paragraphId: `${sectionKind}-${index}`,
      sourceIdentity: `${sectionKind}:${index}`,
      sourceKey: `${sectionKind}-${index}`,
      textHash: `${sectionKind}-hash-${index}`,
      sectionKind,
      sectionTitle: sectionKind,
      sectionPath: [sectionKind],
      text: `${sectionKind} evidence ${index} ${'x'.repeat(2200)}`
    }))
  );
  const document = {
    version: '2', documentHash: 'transient-network-doc', records,
    stableText: records.map(record => JSON.stringify(record)).join('\n')
  };

  const result = await runInnovationAnalysis({
    document,
    documentHash: document.documentHash,
    behaviorSignature: 'deepseek|auto',
    adapter
  });

  assert.equal(result.innovationPoints.length, 1);
  assert.equal(atomicAttempts, 2);
  assert.ok(atomicPromptSizes[1] < atomicPromptSizes[0]);
  assert.equal(result.diagnostics.some(item =>
    item.stage === 'atomic_evidence' && item.compactRetry === true
  ), true);
});

test('retries a later research stage once after a transient provider failure', async () => {
  let traceAttempts = 0;
  const adapter = {
    async generateJson(request) {
      if (request.stage === 'atomic_evidence') return { atoms };
      if (request.stage === 'question_trace') {
        traceAttempts += 1;
        if (traceAttempts === 1) {
          const error = new Error('Unable to reach the provider');
          error.code = 'NETWORK_ERROR';
          error.retryable = true;
          throw error;
        }
        return {
          coreQuestion: {
            questionId: 'Q0', text: 'Which regulators control PV plasticity?',
            evidenceIds: ['B1', 'X1', 'A1']
          },
          bridge: []
        };
      }
      if (request.stage === 'progression') return { progression: [] };
      if (request.stage === 'audit') return { issues: [], acceptedQuestionIds: ['Q0'] };
      throw new Error(`unexpected stage ${request.stage}`);
    }
  };
  const result = await runResearchLogicPipeline({
    document: { version: '2', documentHash: 'later-stage-retry', stableText: 'stable' },
    documentHash: 'later-stage-retry', behaviorSignature: 'deepseek|auto', adapter
  });
  assert.equal(traceAttempts, 2);
  assert.equal(result.questionTrace.coreQuestion.questionId, 'Q0');
});
