const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scriptModule = import('../scripts/verify-live-mechanism-extension.mjs');

function providerBody(input) {
  return {
    model: 'deepseek-v4-flash',
    messages: [
      { role: 'system', content: 'bounded mechanism schema' },
      { role: 'user', content: JSON.stringify(input) }
    ],
    stream: false
  };
}

test('mechanism replay CLI is explicit and mutually exclusive with live mode', async () => {
  const { parseArguments } = await scriptModule;
  assert.deepEqual(parseArguments([
    '--mechanism-replay-dir', 'saved-mechanism', '--mechanism-call-cap', '24',
    '--accept-needs-review', '--no-entry-reload', '--entry-peer-edit'
  ]), {
    mechanismReplayDir: 'saved-mechanism', mechanismCallCap: '24',
    acceptNeedsReview: true, noEntryReload: true, entryPeerEdit: true
  });
  assert.throws(() => parseArguments([
    '--live-mechanism', '--mechanism-replay-dir', 'saved-mechanism'
  ]), error => error?.code === 'LIVE_MECHANISM_MODE_CONFLICT');
  assert.deepEqual(parseArguments([
    '--live-mechanism-tail', '--mechanism-replay-dir', 'saved-prefix'
  ]), {
    liveMechanismTail: true, mechanismReplayDir: 'saved-prefix'
  });
  assert.throws(() => parseArguments(['--live-mechanism-tail']),
    error => error?.code === 'LIVE_MECHANISM_MODE_CONFLICT');
  assert.throws(() => parseArguments([
    '--live-mechanism', '--live-mechanism-tail',
    '--mechanism-replay-dir', 'saved-prefix'
  ]), error => error?.code === 'LIVE_MECHANISM_MODE_CONFLICT');
});

test('mapping replay allows only the added claim uncertainty_reasons schema field',
  async () => {
    const { assertMechanismReplayMatch } = await scriptModule;
    const input = {
      stage: 'panel_relation_mapping',
      untrusted_validated_panels: [{
        panel_handle: 'panel-handle-a', panel_key: 'figure-1:A',
        source_analysis_digest: 'source-v2-0123456789abcdef',
        claims: [{
          claim_handle: 'claim-a', semantics: 'causal',
          causal_test: 'necessity', candidate_handles: ['candidate-a']
        }]
      }],
      relevant_canonical_nodes: [{
        node_handle: 'node-a', label: 'Node A', source_claim_handles: ['claim-a'],
        target_claim_handles: []
      }]
    };
    const saved = providerBody(input);
    const entry = { sequence: 1, stage: input.stage, requestBody: saved };
    const current = structuredClone(saved);
    const currentPayload = JSON.parse(current.messages[1].content);
    currentPayload.untrusted_validated_panels[0].claims[0].uncertainty_reasons =
      ['direction_not_resolved'];
    current.messages[1].content = JSON.stringify(currentPayload);
    const comparison = assertMechanismReplayMatch(current, entry);
    assert.equal(comparison.inputMatch, 'schema-only-drift');
    assert.deepEqual(comparison.schemaOnlyDrift, [
      'untrusted_validated_panels[].claims[].uncertainty_reasons'
    ]);
    const changedHandle = structuredClone(current);
    const changedPayload = JSON.parse(changedHandle.messages[1].content);
    changedPayload.untrusted_validated_panels[0].claims[0].claim_handle = 'claim-b';
    changedHandle.messages[1].content = JSON.stringify(changedPayload);
    assert.throws(() => assertMechanismReplayMatch(changedHandle, entry),
      error => error?.code === 'LIVE_MECHANISM_REPLAY_REQUEST_MISMATCH');
    const changedNode = structuredClone(current);
    const changedNodePayload = JSON.parse(changedNode.messages[1].content);
    changedNodePayload.relevant_canonical_nodes[0].label = 'Different node';
    changedNode.messages[1].content = JSON.stringify(changedNodePayload);
    assert.throws(() => assertMechanismReplayMatch(changedNode, entry),
      error => error?.code === 'LIVE_MECHANISM_REPLAY_REQUEST_MISMATCH');
  });

test('needs-review ledger classification and saved-chain comparison stay strict', async () => {
  const { reviewLedgerComplete, sameMechanismChain } = await scriptModule;
  const evidence = {
    ledgerPanelCount: 37,
    distinctDispositionPanelCount: 37,
    resolvedPanelCount: 30,
    excludedPanelCount: 2,
    unresolvedPanelCount: 5,
    dispositionStatusCounts: {
      linked_causal: 20, linked_correlative: 5, node_evidence: 5,
      excluded_schematic: 2, unresolved: 5
    }
  };
  assert.equal(reviewLedgerComplete(evidence), true);
  assert.equal(reviewLedgerComplete({ ...evidence, distinctDispositionPanelCount: 36 }), false);
  assert.equal(reviewLedgerComplete({
    ...evidence, dispositionStatusCounts: { ...evidence.dispositionStatusCounts, unknown: 1 }
  }), false);
  const chain = {
    digest: 'chain-digest', initialized: true,
    nodeCount: 2, edgeCount: 1, evidenceCount: 1
  };
  assert.equal(sameMechanismChain(chain, { ...chain }), true);
  assert.equal(sameMechanismChain(chain, { ...chain, edgeCount: 2 }), false);
});

test('live mechanism tail replays the entire prefix before counting only new real calls',
  async () => {
    const { mechanismBoundaryMode, mechanismCallCapConsumed } = await scriptModule;
    assert.equal(mechanismBoundaryMode({
      replayCount: 13, replayUsed: 12, liveMechanism: false,
      liveMechanismTail: true
    }), 'replay');
    assert.equal(mechanismBoundaryMode({
      replayCount: 13, replayUsed: 13, liveMechanism: false,
      liveMechanismTail: true
    }), 'real');
    assert.equal(mechanismBoundaryMode({
      replayCount: 13, replayUsed: 13, liveMechanism: false,
      liveMechanismTail: false
    }), 'replay-exhausted');
    const state = {
      mechanismReplayCalls: 13, mechanismRealApiCalls: 2,
      mechanismFixtureCalls: 0
    };
    assert.equal(mechanismCallCapConsumed(state, true), 2);
    assert.equal(mechanismCallCapConsumed(state, false), 15);
  });

test('mechanism replay compares semantic Panel evidence while allowing operation identity drift',
  async () => {
    const { assertMechanismReplayMatch } = await scriptModule;
    const saved = providerBody({
      stage: 'panel_evidence_extraction',
      operationId: 'mechanism:saved',
      binding: { documentId: 'saved-document', workspaceId: 'saved-workspace' },
      untrusted_panel_evidence: [{
        handle: 'source-a', panel_key: 'figure-1:A',
        source_analysis_digest: 'source-v2-0123456789abcdef',
        source_analysis: { directObservation: 'bounded observation' }
      }]
    });
    const current = providerBody({
      stage: 'panel_evidence_extraction',
      operationId: 'mechanism:current',
      binding: { documentId: 'current-document', workspaceId: 'current-workspace' },
      untrusted_panel_evidence: [{
        handle: 'source-a', panel_key: 'figure-1:A',
        source_analysis_digest: 'source-v2-0123456789abcdef',
        source_analysis: { directObservation: 'bounded observation' }
      }]
    });
    const entry = {
      sequence: 1, stage: 'panel_evidence_extraction', requestBody: saved
    };
    assert.doesNotThrow(() => assertMechanismReplayMatch(current, entry));
    const schemaOnly = structuredClone(current);
    const schemaOnlyPayload = JSON.parse(schemaOnly.messages[1].content);
    schemaOnlyPayload.untrusted_panel_evidence[0].available_source_fields =
      ['directObservation'];
    schemaOnly.messages[1].content = JSON.stringify(schemaOnlyPayload);
    assert.equal(assertMechanismReplayMatch(schemaOnly, entry).inputMatch,
      'schema-only-drift');
    const changed = structuredClone(current);
    const payload = JSON.parse(changed.messages[1].content);
    payload.untrusted_panel_evidence[0].source_analysis_digest =
      'source-v2-fedcba9876543210';
    changed.messages[1].content = JSON.stringify(payload);
    assert.throws(() => assertMechanismReplayMatch(changed, entry),
      error => error?.code === 'LIVE_MECHANISM_REPLAY_REQUEST_MISMATCH');
  });

test('mechanism replay selects an unused semantic match across concurrent request order',
  async () => {
    const { selectMechanismReplayEntry } = await scriptModule;
    const make = (sequence, panelKey, system = 'bounded mechanism schema') => ({
      sequence,
      stage: 'panel_evidence_extraction',
      requestBody: {
        ...providerBody({
          stage: 'panel_evidence_extraction',
          untrusted_panel_evidence: [{
            handle: `source-${sequence}`, panel_key: panelKey,
            source_analysis_digest: `source-v2-${String(sequence).padStart(16, '0')}`,
            source_analysis: { directObservation: `observation ${sequence}` }
          }]
        }),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify({
            stage: 'panel_evidence_extraction',
            untrusted_panel_evidence: [{
              handle: `source-${sequence}`, panel_key: panelKey,
              source_analysis_digest: `source-v2-${String(sequence).padStart(16, '0')}`,
              source_analysis: { directObservation: `observation ${sequence}` }
            }]
          }) }
        ]
      }
    });
    const entries = [make(1, 'figure-1:A'), make(2, 'figure-1:B')];
    const selected = selectMechanismReplayEntry(
      entries[1].requestBody, entries, new Set()
    );
    assert.equal(selected.entry.sequence, 2);
    const repair = structuredClone(entries[0].requestBody);
    repair.messages[0].content += '\nSCHEMA_REPAIR_PASS: invalid schema';
    assert.throws(() => selectMechanismReplayEntry(repair, entries, new Set()),
      error => error?.code === 'LIVE_MECHANISM_REPLAY_REQUEST_MISMATCH');
  });

test('mechanism replay loader requires one contiguous request/response pair per report call',
  async () => {
    const { loadMechanismReplayEntries } = await scriptModule;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-mechanism-replay-test-'));
    try {
      const request = providerBody({
        stage: 'canonical_node_proposal',
        validated_candidates: [{
          candidate_handle: 'candidate-v2-a', term: 'Node A',
          node_type: 'factor', state: '', context_signatures: [], claim_handles: []
        }]
      });
      fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({
        mechanismProviderCalls: [{
          sequence: 1, status: 200,
          request: { stage: 'canonical_node_proposal' }
        }]
      }));
      fs.writeFileSync(path.join(directory, 'mechanism-request-001-redacted.json'),
        JSON.stringify(request));
      fs.writeFileSync(path.join(directory, 'mechanism-response-001-redacted.json'),
        JSON.stringify({ choices: [{ message: { content: '{"groups":[]}' } }] }));
      const entries = loadMechanismReplayEntries(directory);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].stage, 'canonical_node_proposal');
      fs.rmSync(path.join(directory, 'mechanism-response-001-redacted.json'));
      assert.throws(() => loadMechanismReplayEntries(directory),
        error => error?.code === 'LIVE_MECHANISM_REPLAY_INVALID');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
