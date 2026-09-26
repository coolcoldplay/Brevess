const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/evidence-first-mechanism.js');
require('../core/figure-workspace.js');
require('../core/mechanism-network.js');
const {
  createMechanismPendingPreviewModel,
  createMechanismPendingPreviewSection,
  renderMechanismPendingPreview
} = require('../core/mechanism-pending-preview.js');

function validPendingPreview() {
  const node1 = `node-v2-${'1'.repeat(16)}`;
  const node2 = `node-v2-${'2'.repeat(16)}`;
  const node3 = `node-v2-${'6'.repeat(16)}`;
  const relationId = `relation-v1-${'1'.repeat(16)}`;
  const claim = index => `claim-v1-${String(index).repeat(16)}`;
  const source = index => `source-v2-${String(index).repeat(16)}`;
  return {
    status: 'needs_review',
    canonicalDigest: `mechanism-v3-sha256-${'a'.repeat(64)}`,
    nodes: [
      { nodeId: node1, label: 'Microglial TNF', nodeType: 'intervention' },
      { nodeId: node2, label: 'Synapse loss', nodeType: 'outcome' },
      { nodeId: node3, label: 'Astrocyte state', nodeType: 'state' }
    ],
    relations: [{
      relationId, sourceNodeId: node1, targetNodeId: node2,
      relationKind: 'causal', relationStatus: 'supported', renderable: true,
      polarity: 'increases',
      context: {
        species: 'mouse', tissue: 'brain', cellType: 'microglia', compartment: '',
        condition: 'injury', timepoint: '', dose: ''
      },
      assignments: [
        {
          claimId: claim(1), panelKey: 'figure-1:A', evidenceClass: 'necessity',
          role: 'supporting', claimRelationKind: 'causal',
          sourceRefs: ['figure-1:A:directObservation']
        },
        {
          claimId: claim(2), panelKey: 'figure-1:B', evidenceClass: 'other',
          role: 'counterclaim', claimRelationKind: 'causal',
          sourceRefs: ['figure-1:B:directObservation']
        }
      ]
    }],
    claims: [
      {
        claimId: claim(1), panelKey: 'figure-1:A', semantics: 'causal',
        causalTest: 'necessity', outcome: 'supports', effectSign: 'increases',
        sourceAnalysisDigest: source(1), sourceRefs: ['figure-1:A:directObservation']
      },
      {
        claimId: claim(2), panelKey: 'figure-1:B', semantics: 'causal',
        causalTest: 'necessity', outcome: 'refutes', effectSign: 'increases',
        sourceAnalysisDigest: source(2), sourceRefs: ['figure-1:B:directObservation']
      },
      {
        claimId: claim(3), panelKey: 'figure-2:A', semantics: 'descriptive',
        causalTest: 'none', outcome: 'supports', effectSign: 'unknown',
        sourceAnalysisDigest: source(3), sourceRefs: ['figure-2:A:directObservation']
      },
      {
        claimId: claim(4), panelKey: 'figure-2:B', semantics: 'descriptive',
        causalTest: 'none', outcome: 'inconclusive', effectSign: 'unknown',
        sourceAnalysisDigest: source(4), sourceRefs: ['figure-2:B:directObservation']
      },
      {
        claimId: claim(5), panelKey: 'figure-3:A', semantics: 'descriptive',
        causalTest: 'none', outcome: 'inconclusive', effectSign: 'unknown',
        sourceAnalysisDigest: source(5), sourceRefs: ['figure-3:A:directObservation']
      }
    ],
    nodeEvidence: [{
      claimId: claim(3), panelKey: 'figure-2:A', nodeIds: [node3],
      evidenceKind: 'node_observation'
    }],
    nonGraphEvidence: [{
      claimId: claim(4), panelKey: 'figure-2:B', sourceNodeId: node1,
      targetNodeId: node2, evidenceKind: 'inconclusive'
    }],
    claimUsages: [
      {
        claimId: claim(1), panelKey: 'figure-1:A', usageKind: 'relation',
        relationIds: [relationId], nodeIds: [node1, node2],
        evidenceClass: 'necessity', color: 'blue'
      },
      {
        claimId: claim(2), panelKey: 'figure-1:B', usageKind: 'counterclaim',
        relationIds: [relationId], nodeIds: [node1, node2],
        evidenceClass: 'other', color: 'purple'
      },
      {
        claimId: claim(3), panelKey: 'figure-2:A', usageKind: 'node_observation',
        relationIds: [], nodeIds: [node3], evidenceClass: 'other', color: 'black'
      },
      {
        claimId: claim(4), panelKey: 'figure-2:B', usageKind: 'inconclusive',
        relationIds: [], nodeIds: [node1, node2], evidenceClass: 'other', color: 'amber'
      }
    ],
    unresolvedClaims: [{
      claimId: claim(5), panelKey: 'figure-3:A', reason: 'ambiguous_target'
    }],
    panelDispositions: [
      {
        panelKey: 'figure-1:A', status: 'linked_causal', relationIds: [relationId],
        nodeIds: [node1, node2], claimIds: [claim(1)], reason: ''
      },
      {
        panelKey: 'figure-1:B', status: 'linked_causal', relationIds: [relationId],
        nodeIds: [node1, node2], claimIds: [claim(2)], reason: ''
      },
      {
        panelKey: 'figure-2:A', status: 'node_evidence', relationIds: [],
        nodeIds: [node3], claimIds: [claim(3)], reason: ''
      },
      {
        panelKey: 'figure-2:B', status: 'unresolved', relationIds: [],
        nodeIds: [node1, node2], claimIds: [claim(4)], reason: 'inconclusive_evidence'
      },
      {
        panelKey: 'figure-3:A', status: 'unresolved', relationIds: [],
        nodeIds: [], claimIds: [claim(5)], reason: 'ambiguous_target'
      },
      {
        panelKey: 'figure-4:A', status: 'excluded_schematic', relationIds: [],
        nodeIds: [], claimIds: [], reason: 'source_backed_schematic'
      }
    ]
  };
}

test('pending preview model accepts only validated node-v2 evidence', () => {
  const model = createMechanismPendingPreviewModel(validPendingPreview());
  assert.ok(model);
  assert.equal(model.status, 'needs_review');
  assert.equal(model.nodes.length, 3);
  assert.equal(model.relations.length, 1);
  assert.equal(model.relations[0].sourceLabel, 'Microglial TNF');
  assert.equal(model.relations[0].targetLabel, 'Synapse loss');
  assert.match(model.relations[0].nature, /因果.*促进.*有支持证据/u);
  assert.deepEqual(model.relations[0].panels.map(item => item.split(' · ')[0]), [
    'figure-1:A', 'figure-1:B'
  ]);
  assert.equal(model.panelCoverageKnown, true);
  assert.equal(model.panelCount, 6);
  assert.deepEqual(model.connectedNodes.map(item => item.label), [
    'Microglial TNF', 'Synapse loss'
  ]);
  assert.deepEqual(model.disconnectedNodes.map(item => item.label), ['Astrocyte state']);
  assert.match(model.mermaidDefinition, /^flowchart LR/mu);
});

test('pending preview retains node-only, non-relation, unresolved, and schematic evidence', () => {
  const model = createMechanismPendingPreviewModel(validPendingPreview());
  assert.ok(model.nonRelationEvidence.some(item =>
    item.panelKey === 'figure-2:A' && item.kind === '节点观察'));
  assert.ok(model.nonRelationEvidence.some(item =>
    item.panelKey === 'figure-2:B' && item.kind === '证据不足'));
  assert.ok(model.nonRelationEvidence.some(item =>
    item.panelKey === 'figure-3:A' && item.kind === '未解析证据'));
  assert.ok(model.nonRelationEvidence.some(item =>
    item.panelKey === 'figure-4:A' && item.kind.includes('示意图')));
  assert.ok(model.nodes.some(item => item.label === 'Astrocyte state'));
});

test('a fully node-only preview stays visible without inventing a relation', () => {
  const preview = validPendingPreview();
  const node = preview.nodes[2];
  const claim = preview.claims[2];
  preview.nodes = [node];
  preview.relations = [];
  preview.claims = [claim];
  preview.nodeEvidence = [preview.nodeEvidence[0]];
  preview.nonGraphEvidence = [];
  preview.claimUsages = [preview.claimUsages[2]];
  preview.unresolvedClaims = [];
  preview.panelDispositions = [preview.panelDispositions[2]];
  const model = createMechanismPendingPreviewModel(preview);
  assert.ok(model);
  assert.deepEqual(model.nodes.map(item => item.label), ['Astrocyte state']);
  assert.deepEqual(model.relations, []);
  assert.equal(model.graph.edges.length, 0);
  assert.deepEqual(model.connectedNodes, []);
  assert.deepEqual(model.disconnectedNodes.map(item => item.label), ['Astrocyte state']);
  assert.doesNotMatch(model.mermaidDefinition, /Astrocyte state/u);
});

test('missing Panel disposition data is labeled as incomplete coverage', () => {
  const preview = validPendingPreview();
  delete preview.panelDispositions;
  const model = createMechanismPendingPreviewModel(preview);
  assert.ok(model);
  assert.equal(model.panelCoverageKnown, false);
  assert.equal(model.panelCount, 5);
});

test('invalid or legacy preview is rejected without a DOM mutation opportunity', async () => {
  const forged = validPendingPreview();
  forged.nodes[0].nodeId = `node-v1-${'1'.repeat(16)}`;
  assert.equal(createMechanismPendingPreviewModel(forged), null);
  assert.equal(createMechanismPendingPreviewSection(forged), null);
  assert.equal(await renderMechanismPendingPreview(forged), null);
});

test('module source has no persistence or editing surface', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../core/mechanism-pending-preview.js'), 'utf8'
  );
  assert.doesNotMatch(source, /chrome\.(?:storage|runtime)|sendMessage|fetch\s*\(/u);
  assert.doesNotMatch(source, /addEventListener|contenteditable|createElement\(['"](?:button|input|select|textarea)/u);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/u);
  assert.match(source, /normalizeGeneratedMechanismPreview\(value, 'node-v2'\)/u);
});

module.exports = { validPendingPreview };
