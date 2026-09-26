const test = require('node:test');
const assert = require('node:assert/strict');
const {
  projectPanelAnalysisEvidence, validatePanelEvidenceBatch,
  compileCanonicalNodeProposalPrompt, validateCanonicalNodeProposal,
  createConservativeCanonicalNodes, compilePanelRelationMappingPrompt
} = require('../core/evidence-first-mechanism.js');

const invalid = error => error?.code === 'INVALID_RESPONSE';

function recordFor(index, terms, overrides = {}) {
  const figureId = 'figure-1', panelId = `P${index}`;
  const observation = `${terms.join(', ')} were observed in condition ${index}.`;
  const projected = projectPanelAnalysisEvidence({ figureId, caption: observation,
    panelAnalyses: { [panelId]: { panel: panelId, directObservation: observation,
      evidenceType: 'measurement', observationSource: 'panel_analysis' } }
  }, { panelKey: `${figureId}:${panelId}`, figureId, panelId, panelOrder: index });
  assert.equal(projected.ok, true);
  const claim = { semantics: 'descriptive', causalTest: 'none', outcome: 'supports',
    effectSign: 'unknown', subjectTerms: [], objectTerms: [], perturbations: [],
    observations: [observation], biologicalContexts: [{ species: 'mouse', tissue: '',
      cellType: '', compartment: '', condition: `condition ${index}`, timepoint: '', dose: '' }],
    candidateTerms: terms, sourceFields: ['directObservation'], uncertaintyReasons: [],
    modelConfidence: 0.8, ...overrides };
  const validated = validatePanelEvidenceBatch({ records: [{ handle: projected.projection.handle,
    panelType: 'experimental', exclusionReason: '', extractionUncertainty: '', claims: [claim]
  }] }, [projected.projection]);
  assert.equal(validated.ok, true);
  return validated.records[0];
}

function recordsFor(count, { termsPerRecord = 16, uniqueTerms = false } = {}) {
  const records = [];
  for (let offset = 0; offset < count; offset += termsPerRecord) {
    const terms = Array.from({ length: Math.min(termsPerRecord, count - offset) }, (_, index) =>
      `Entity ${uniqueTerms ? offset + index : index}`);
    records.push(recordFor(records.length, terms));
  }
  return records;
}

function candidatesFor(records) {
  const prompt = compileCanonicalNodeProposalPrompt(records);
  return { prompt, candidates: JSON.parse(prompt.userPrompt).validated_candidates };
}

function singletonProposal(candidates) {
  return { groups: candidates.map(candidate => ({ preferred_handle: candidate.candidate_handle,
    member_handles: [candidate.candidate_handle] })) };
}

function proposalFor(nodes) {
  return { groups: nodes.map(node => ({ preferred_handle: node.nodeHandle, member_handles: [...node.candidateHandles] })) };
}

for (const count of [513, 598, 1024]) {
  test(`${count} candidates retain exact identity and claim provenance through canonical and mapping stages`, () => {
    const records = recordsFor(count);
    const snapshot = JSON.stringify(records);
    const { prompt, candidates } = candidatesFor(records);
    assert.equal(candidates.length, count);
    assert.equal(new Set(candidates.map(c => c.candidate_handle)).size, count);
    assert.equal(prompt.responseSchema.properties.groups.maxItems, 512);
    const canonical = createConservativeCanonicalNodes(records);
    assert.deepEqual(canonical.nodes.flatMap(n => n.candidateHandles).sort(),
      candidates.map(c => c.candidate_handle).sort());
    const byHandle = new Map(candidates.map(c => [c.candidate_handle, c]));
    for (const node of canonical.nodes) {
      assert.deepEqual(node.claimHandles, [...new Set(node.candidateHandles.flatMap(h => byHandle.get(h).claim_handles))].sort());
      assert.deepEqual(node.contextSignatures, [...new Set(node.candidateHandles.flatMap(h => byHandle.get(h).context_signatures))].sort());
      assert.ok(node.candidateHandles.length <= 64);
    }
    assert.deepEqual(validateCanonicalNodeProposal(proposalFor(canonical.nodes), records), canonical);
    assert.doesNotThrow(() => compilePanelRelationMappingPrompt(records.slice(0, 4), canonical, records));
    assert.equal(JSON.stringify(records), snapshot);
  });
}

test('1025 distinct candidate identities fail without returning a truncated set', () => {
  const records = recordsFor(1025);
  const snapshot = JSON.stringify(records);
  assert.throws(() => compileCanonicalNodeProposalPrompt(records), invalid);
  assert.throws(() => createConservativeCanonicalNodes(records), invalid);
  assert.equal(JSON.stringify(records), snapshot);
});

test('512 canonical groups pass but 513 groups fail even inside the candidate capacity', () => {
  const records = recordsFor(512, { uniqueTerms: true });
  const { candidates } = candidatesFor(records);
  const canonical = validateCanonicalNodeProposal(singletonProposal(candidates), records);
  assert.equal(canonical.nodes.length, 512);
  assert.doesNotThrow(() => compilePanelRelationMappingPrompt(records.slice(0, 4), canonical, records));
  const overflow = recordsFor(513, { uniqueTerms: true });
  const overflowCandidates = candidatesFor(overflow).candidates;
  assert.throws(() => validateCanonicalNodeProposal(singletonProposal(overflowCandidates), overflow), invalid);
  assert.throws(() => createConservativeCanonicalNodes(overflow), invalid);
});

test('larger candidate sets still reject duplicate, missing and foreign proposal handles', () => {
  const records = recordsFor(598);
  const canonical = createConservativeCanonicalNodes(records);
  const duplicate = proposalFor(canonical.nodes);
  duplicate.groups[1].member_handles.push(duplicate.groups[0].member_handles[0]);
  assert.throws(() => validateCanonicalNodeProposal(duplicate, records), invalid);
  const missing = proposalFor(canonical.nodes);
  missing.groups[0].member_handles.pop();
  assert.throws(() => validateCanonicalNodeProposal(missing, records), invalid);
  const foreign = proposalFor(canonical.nodes);
  foreign.groups[0].member_handles.push('candidate-v2-0000000000000000');
  assert.throws(() => validateCanonicalNodeProposal(foreign, records), invalid);
});

test('larger sets still reject wrong type and mutually exclusive state merges', () => {
  const base = recordsFor(513);
  for (const extra of [
    recordFor(80, ['Entity X', 'Outcome Y'], { objectTerms: ['Outcome Y'] }),
    recordFor(80, ['active Mediator', 'inactive Mediator'])
  ]) {
    const records = [...base, extra];
    const canonical = createConservativeCanonicalNodes(records);
    const pair = canonical.nodes.filter(n => ['Entity X', 'Outcome Y', 'active Mediator', 'inactive Mediator'].includes(n.label));
    assert.equal(pair.length, 2);
    const malformed = proposalFor(canonical.nodes.filter(n => !pair.includes(n)));
    malformed.groups.push({ preferred_handle: pair[0].nodeHandle, member_handles: pair.flatMap(n => n.candidateHandles) });
    assert.throws(() => validateCanonicalNodeProposal(malformed, records), invalid);
  }
});

test('64-member groups remain bounded and forged canonical provenance fails in mapping', () => {
  const records = recordsFor(65, { termsPerRecord: 1 });
  const { candidates } = candidatesFor(records);
  const canonical = createConservativeCanonicalNodes(records);
  assert.deepEqual(canonical.nodes.map(n => n.candidateHandles.length).sort((a, b) => a - b), [1, 64]);
  assert.throws(() => validateCanonicalNodeProposal({ groups: [{
    preferred_handle: candidates[0].candidate_handle, member_handles: candidates.map(c => c.candidate_handle)
  }] }, records), invalid);
  const forged = structuredClone(canonical);
  forged.nodes[0].claimHandles.pop();
  assert.throws(() => compilePanelRelationMappingPrompt(records.slice(0, 4), forged, records), invalid);
  const oversized = { nodes: Array(513).fill(canonical.nodes[0]) };
  assert.throws(() => compilePanelRelationMappingPrompt(records.slice(0, 4), oversized, records), invalid);
});

test('old smaller inputs keep exact prompt limits and deterministic conservative identities', () => {
  for (const count of [1, 16, 511, 512]) {
    const records = recordsFor(count);
    const { prompt, candidates } = candidatesFor(records);
    assert.equal(candidates.length, count);
    assert.equal(prompt.responseSchema.properties.groups.maxItems, count);
    assert.equal(prompt.responseSchema.properties.groups.items.properties.member_handles.maxItems, Math.min(64, count));
    assert.deepEqual(createConservativeCanonicalNodes([...records].reverse()), createConservativeCanonicalNodes(records));
  }
});
