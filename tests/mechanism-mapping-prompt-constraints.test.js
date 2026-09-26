const test = require('node:test');
const assert = require('node:assert/strict');
const mechanism = require('../core/evidence-first-mechanism.js');

function fixture(overrides = {}) {
  const figureId = 'figure-1', panelId = 'A';
  const projected = mechanism.projectPanelAnalysisEvidence({ figureId,
    caption: 'A controlled observation of measured endpoints.', panelAnalyses: {
      A: { panel: 'A', evidenceType: 'measurement', directObservation: 'Readout B decreases under Manipulation A.',
        observationSource: 'panel_analysis', comparison: 'intervention versus control' }
    }
  }, { figureId, panelId, panelKey: 'figure-1:A', panelOrder: 0 });
  assert.equal(projected.ok, true);
  const claim = { semantics: 'causal', causalTest: 'necessity', outcome: 'supports', effectSign: 'decreases',
    subjectTerms: ['Manipulation A'], objectTerms: ['Readout B'], perturbations: ['Manipulation A knockdown'],
    observations: ['Readout B decreases'], biologicalContexts: [{ species: 'mouse', tissue: '', cellType: '',
      compartment: '', condition: 'controlled comparison', timepoint: '', dose: '' }],
    candidateTerms: ['Manipulation A', 'Readout B'], sourceFields: ['directObservation', 'comparison'],
    uncertaintyReasons: [], modelConfidence: 0.8, ...overrides };
  const validated = mechanism.validatePanelEvidenceBatch({ records: [{ handle: projected.projection.handle,
    panelType: 'experimental', exclusionReason: '', extractionUncertainty: '', claims: [claim]
  }] }, [projected.projection]);
  assert.equal(validated.ok, true);
  const records = validated.records;
  const nodes = mechanism.createConservativeCanonicalNodes(records);
  const prompt = mechanism.compilePanelRelationMappingPrompt(records, nodes, records);
  return { records, nodes, prompt, input: JSON.parse(prompt.userPrompt) };
}

const cases = [
  ['unique causal pair', {}, ['mapped_pair', 'unmapped'], ''],
  ['source-only descriptive node', { semantics: 'descriptive', causalTest: 'none', objectTerms: [] }, ['node_only', 'unmapped'], ''],
  ['empty source pair', { semantics: 'associational', causalTest: 'none', subjectTerms: [] }, ['unmapped'], 'pair_requires_unique_source'],
  ['object-only descriptive node', { semantics: 'descriptive', causalTest: 'none', subjectTerms: [] }, ['unmapped'], 'node_only_requires_unique_source'],
  ['multiple sources', { subjectTerms: ['Manipulation A', 'Mediator C'] }, ['unmapped'], 'pair_requires_unique_source'],
  ['multiple targets', { objectTerms: ['Readout B', 'Readout D'] }, ['unmapped'], 'pair_requires_unique_target'],
  ['empty target pair', { objectTerms: [] }, ['unmapped'], 'pair_requires_unique_target'],
  ['node-only ignores object endpoint multiplicity', { semantics: 'descriptive', causalTest: 'none', objectTerms: ['Readout B', 'Readout D'] }, ['node_only', 'unmapped'], ''],
  ['same source and target', { objectTerms: ['Manipulation A'] }, ['unmapped'], 'self_relation_not_allowed'],
  ['explicit uncertainty', { uncertaintyReasons: ['Control identity is not stated.'] }, ['unmapped'], 'uncertain_claim'],
  ['unknown effect', { effectSign: 'unknown' }, ['unmapped'], 'uncertain_claim'],
  ['mixed effect', { effectSign: 'mixed' }, ['unmapped'], 'uncertain_claim'],
  ['inconclusive outcome', { outcome: 'inconclusive' }, ['unmapped'], 'uncertain_claim'],
  ['mixed outcome', { outcome: 'mixed' }, ['unmapped'], 'uncertain_claim']
];

function responseFor(state, source, target, unmappedTerm) {
  const panel = state.input.untrusted_validated_panels[0];
  const claim = panel.claims[0];
  return { records: [{ panel_handle: panel.panel_handle, mappings: [{ claim_handle: claim.claim_handle,
    source_node_handle: source, target_node_handle: target, relation_kind: claim.expected_relation_kind,
    evidence_class: claim.expected_evidence_class, polarity: claim.effect_sign, unmappedTerm }]
  }] };
}

function isAccepted(value, state) {
  try { mechanism.validatePanelRelationMapping(value, state.records, state.nodes, state.records); return true; }
  catch (error) { assert.equal(error.code, 'INVALID_RESPONSE'); return false; }
}

for (const [name, overrides, forms, reason] of cases) test(name, () => {
  const state = fixture(overrides);
  const claim = state.input.untrusted_validated_panels[0].claims[0];
  assert.deepEqual(claim.mapping_constraints, { allowed_forms: forms, must_unmap_reason: reason });
  const validated = state.records[0].claims[0];
  for (const [promptField, recordField] of [
    ['subject_terms', 'subjectTerms'], ['object_terms', 'objectTerms'], ['semantics', 'semantics'],
    ['causal_test', 'causalTest'], ['outcome', 'outcome'], ['effect_sign', 'effectSign'],
    ['uncertainty_reasons', 'uncertaintyReasons'], ['perturbations', 'perturbations'],
    ['observations', 'observations'], ['candidate_terms', 'candidateTerms'], ['claim_handle', 'claimId']
  ]) assert.deepEqual(claim[promptField], validated[recordField], `${name}: ${promptField}`);
  assert.equal(state.input.untrusted_validated_panels[0].panel_handle, state.records[0].panelUid);
  assert.equal(state.prompt.schemaName, 'panel_relation_mapping_v2');

  // Exhaust all supplied endpoint handles, empty slots and unmapped/no-reason
  // forms. The public validator independently decides whether each is legal.
  const sources = ['', ...claim.allowed_source_node_handles], targets = ['', ...claim.allowed_target_node_handles];
  for (const source of sources) for (const target of targets) for (const unmapped of ['', 'Current representation requires review.']) {
    const value = responseFor(state, source, target, unmapped);
    const allowed = (!source && !target && Boolean(unmapped)) || (!unmapped && (
      forms.includes('node_only') && source && !target ||
      forms.includes('mapped_pair') && source && target && source !== target));
    assert.equal(isAccepted(value, state), Boolean(allowed), `${name}: ${JSON.stringify(value)}`);
  }
});

test('prompt distinguishes representation limitations from scientific uncertainty and forbids moving target to source', () => {
  const state = fixture({ semantics: 'descriptive', causalTest: 'none', subjectTerms: [] });
  assert.match(state.prompt.systemPrompt, /mapping_constraints/);
  assert.match(state.prompt.systemPrompt, /provenance.*not.*permission/);
  assert.match(state.prompt.systemPrompt, /representation.*not.*paper.*evidence/);
  assert.match(state.prompt.systemPrompt, /Never move.*target.*source/);
  const claim = state.input.untrusted_validated_panels[0].claims[0];
  assert.equal(claim.allowed_target_node_handles.length, 1);
  assert.deepEqual(claim.subject_terms, []);
  assert.equal(isAccepted(responseFor(state, claim.allowed_target_node_handles[0], '', ''), state), false);
});

test('mapping guidance uses prompt v9 while retaining schema, cache, normalization and id contracts', () => {
  assert.deepEqual(mechanism.EVIDENCE_FIRST_VERSIONS, {
    evidenceSchemaVersion: 'evidence-record-schema-v3', canonicalSchemaVersion: 'mechanism-schema-v4',
    promptVersion: 'evidence-first-prompt-v9', cacheVersion: 'cross-figure-evidence-v11',
    normalizationVersion: 'mechanism-normalization-v4', idAlgorithmVersion: 'mechanism-v3'
  });
  assert.strictEqual(mechanism.normalizeEvidenceFirstVersions(mechanism.EVIDENCE_FIRST_VERSIONS), mechanism.EVIDENCE_FIRST_VERSIONS);
  assert.equal(mechanism.normalizeEvidenceFirstVersions({
    ...mechanism.EVIDENCE_FIRST_VERSIONS, promptVersion: 'evidence-first-prompt-v8'
  }), null);
});

test('v9 cannot resume a v8 checkpoint as the same operation; a new v9 operation has no old checkpoint', async () => {
  Object.assign(globalThis.SciLLM || (globalThis.SciLLM = {}),
    require('../core/operation-control.js'), require('../core/analysis-cache.js'), mechanism);
  const api = require('../core/mechanism-operation-coordinator.js');
  assert.equal(api.MECHANISM_BINDING_VERSIONS.promptVersion, 'evidence-first-prompt-v9');
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const identity = {
    operationId: 'mechanism:prompt-upgrade', documentId: 'doc-1', documentHash: 'a'.repeat(64),
    workspaceId: 'workspace-1', workspaceGeneration: 1, workspaceLifecycle: 0,
    mechanismChainFingerprint: 'mechanism-chain-v1-0123456789abcdef', senderExtensionId: 'extension-1',
    senderTabId: 1, senderFrameId: 0, senderDocumentId: '11111111-1111-4111-8111-111111111111',
    profileSignature: 'profile-a', baseWorkspaceRevision: 7
  };
  const oldVersions = { ...api.MECHANISM_BINDING_VERSIONS, promptVersion: 'evidence-first-prompt-v8' };
  const first = api.createMechanismOperationCoordinator({ cacheStore });
  const oldOperation = await first.beginEvidenceFirstOperation({ ...identity, versions: oldVersions });
  await first.commitCheckpoint(oldOperation, {
    schemaVersion: api.MECHANISM_CHECKPOINT_SCHEMA_VERSION, binding: oldOperation.binding,
    phase: 'edge_batch', nextBatchIndex: 2, completedPanelKeys: ['fig1::a'],
    providerReceiptIds: [], payload: { edgeCount: 3 }
  });
  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  await assert.rejects(
    restarted.beginEvidenceFirstOperation({ ...identity, versions: api.MECHANISM_BINDING_VERSIONS }),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
  const sameOld = await restarted.beginEvidenceFirstOperation({ ...identity, versions: oldVersions });
  const oldCheckpoint = await restarted.resume(sameOld);
  assert.equal(oldCheckpoint.binding.promptVersion, 'evidence-first-prompt-v8');
  assert.equal(oldCheckpoint.nextBatchIndex, 2);
  const next = await restarted.beginEvidenceFirstOperation({ ...identity,
    operationId: 'mechanism:prompt-upgrade-v9', versions: api.MECHANISM_BINDING_VERSIONS });
  assert.equal(next.binding.promptVersion, 'evidence-first-prompt-v9');
  assert.equal(await restarted.resume(next), null);
});
