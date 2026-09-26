const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const FigureWorkspace = require('../core/figure-workspace.js');
const {
  EVIDENCE_FIRST_VERSIONS
} = require('../core/evidence-first-mechanism.js');

const modulePath = path.join(__dirname, '..', 'core', 'mechanism-network.js');

function complexMechanismFixture() {
  const ids = [
    'source', 'branch-a', 'branch-b', 'branch-c', 'merge-ab', 'outcome',
    'cycle-1', 'cycle-2', 'cycle-3', 'self'
  ];
  const edge = (id, from, to, polarity = 'neutral') => ({
    id, from, to, polarity, label: { value: id }, panelEvidence: []
  });
  return {
    nodes: ids.map(id => ({ id, label: { value: id } })),
    edges: [
      edge('source-a', 'source', 'branch-a'),
      edge('source-b', 'source', 'branch-b'),
      edge('source-c', 'source', 'branch-c'),
      edge('a-ab', 'branch-a', 'merge-ab'),
      edge('b-ab', 'branch-b', 'merge-ab'),
      edge('ab-outcome', 'merge-ab', 'outcome'),
      edge('c-outcome', 'branch-c', 'outcome'),
      edge('positive-feedback', 'outcome', 'branch-b', 'positive'),
      edge('negative-feedback', 'outcome', 'source', 'negative'),
      edge('cycle-12', 'cycle-1', 'cycle-2'),
      edge('cycle-23', 'cycle-2', 'cycle-3'),
      edge('cycle-31', 'cycle-3', 'cycle-1', 'negative'),
      edge('self-positive', 'self', 'self', 'positive')
    ]
  };
}

function validPaperIdentity() {
  return {
    workspaceId: `workspace:${'a'.repeat(64)}`,
    workspaceGeneration: 4,
    canonicalUrl: 'https://example.test/paper',
    contentHash: 'b'.repeat(64),
    documentId: `sha256:${'c'.repeat(64)}`,
    title: 'A branching mechanism paper'
  };
}

function durableMechanismWorkspaceFixture() {
  const sourceNodeId = `node-v2-${'1'.repeat(16)}`;
  const targetNodeId = `node-v2-${'2'.repeat(16)}`;
  const relationId = `relation-v1-${'3'.repeat(16)}`;
  const claimId = `claim-v1-${'4'.repeat(16)}`;
  const draft = FigureWorkspace.createFigureWorkspaceDraft([{
    figureId: 'figure-2', figureLabel: 'Figure 2', panelHints: ['A']
  }]);
  draft.revision = 7;
  draft.binding = {
    documentId: `sha256:${'c'.repeat(64)}`, documentHash: 'document-hash',
    canonicalUrl: 'https://example.test/paper',
    workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 4
  };
  const generation = {
    status: 'complete', evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
    operationId: 'mechanism:workspace-json-12345678', operationEpoch: 4,
    documentId: draft.binding.documentId, workspaceId: draft.binding.workspaceId,
    workspaceGeneration: draft.binding.workspaceGeneration,
    workspaceLifecycle: 9, baseWorkspaceRevision: 7,
    mechanismChainFingerprint: 'mechanism-chain-v1-a1b2c3d4',
    evidenceFirstMechanism: {
      status: 'complete', canonicalDigest: `mechanism-v3-sha256-${'b'.repeat(64)}`,
      nodes: [
        { nodeId: sourceNodeId, label: 'Source', nodeType: 'intervention' },
        { nodeId: targetNodeId, label: 'Target', nodeType: 'outcome' }
      ],
      relations: [{
        relationId, sourceNodeId, targetNodeId, relationKind: 'causal',
        relationStatus: 'supported', renderable: true, polarity: 'decreases',
        context: { species: 'mouse', tissue: 'brain', cellType: 'microglia',
          compartment: '', condition: '', timepoint: '', dose: '' },
        assignments: [{
          claimId, panelKey: 'figure-2:A', evidenceClass: 'necessity',
          role: 'supporting', claimRelationKind: 'causal',
          sourceRefs: ['figure-2:A:directObservation']
        }]
      }],
      claims: [{
        claimId, panelKey: 'figure-2:A', semantics: 'causal',
        causalTest: 'necessity', outcome: 'supports', effectSign: 'decreases',
        sourceAnalysisDigest: `source-v2-${'5'.repeat(16)}`,
        sourceRefs: ['figure-2:A:directObservation']
      }]
    }
  };
  const chain = {
    nodes: [{ id: sourceNodeId, label: 'Source' },
      { id: targetNodeId, label: 'Target' }],
    edges: [{
      id: relationId, from: sourceNodeId, to: targetNodeId,
      label: '', polarity: 'negative', panelEvidence: [{
        figureId: 'figure-2', panelId: 'A', evidenceClass: 'necessity',
        evidenceClassSource: 'inferred'
      }]
    }]
  };
  const candidate = FigureWorkspace.createMechanismGenerationCandidateEnvelope(
    JSON.stringify(generation)
  );
  const committed = FigureWorkspace.applyFigureWorkspaceMutation(draft, {
    type: 'replace_generated_mechanism_v2', expectedRevision: 7,
    chain, generationEnvelope: candidate
  }, 5000);
  return {
    chain: committed.mechanismChain,
    mechanismGeneration: committed.mechanismGeneration
  };
}

function canonicalWorkspaceChain(rawChain = complexMechanismFixture()) {
  return {
    initialized: true,
    nodes: rawChain.nodes.map(node => ({
      id: node.id,
      label: {
        value: typeof node.label === 'string' ? node.label : node.label.value,
        humanReviewed: node.label?.humanReviewed === true,
        editedAt: Number.isSafeInteger(node.label?.editedAt) ? node.label.editedAt : 0
      }
    })),
    edges: rawChain.edges.map(edge => ({
      id: edge.id, from: edge.from, to: edge.to,
      label: {
        value: typeof edge.label === 'string' ? edge.label : edge.label.value,
        humanReviewed: edge.label?.humanReviewed === true,
        editedAt: Number.isSafeInteger(edge.label?.editedAt) ? edge.label.editedAt : 0
      },
      polarity: edge.polarity || 'neutral',
      panelEvidence: (edge.panelEvidence || []).map(item => ({
        figureId: item.figureId, panelId: item.panelId, value: item.value,
        unresolved: item.unresolved === true,
        ...(item.evidenceClass ? { evidenceClass: item.evidenceClass } : {}),
        ...(item.evidenceClassSource
          ? { evidenceClassSource: item.evidenceClassSource } : {}),
        humanReviewed: item.humanReviewed === true,
        editedAt: Number.isSafeInteger(item.editedAt) ? item.editedAt : 0
      })),
      humanReviewed: edge.humanReviewed === true,
      editedAt: Number.isSafeInteger(edge.editedAt) ? edge.editedAt : 0
    })),
    panelAliases: rawChain.panelAliases || {},
    reviewTombstones: rawChain.reviewTombstones || {
      nodes: [], edges: [], evidence: []
    },
    ...(rawChain.layoutPreferences
      ? { layoutPreferences: rawChain.layoutPreferences } : {}),
    ...(rawChain.generationIssues
      ? { generationIssues: rawChain.generationIssues } : {})
  };
}

function maximumMechanismFixture(nodeCount = 64, edgeCount = 64) {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    label: { value: `Node ${index}` }
  }));
  const edges = [];
  for (let index = 0; index < edgeCount; index += 1) {
    const from = index % nodeCount;
    let to = (index + 1) % nodeCount;
    if (from === to) to = (to + 1) % nodeCount;
    edges.push({
      id: `edge-${index}`,
      from: `node-${from}`,
      to: `node-${to}`,
      polarity: index >= nodeCount - 1 ? 'negative' : 'neutral',
      label: { value: `Edge ${index}` },
      panelEvidence: []
    });
  }
  return { nodes, edges };
}

function evidenceFirstAuditFixture() {
  const nodes = ['a', 'b', 'c', 'd', 'isolated'].map(id => ({
    id, label: id === 'isolated' ? 'Astrocyte state' : `Node ${id.toUpperCase()}`,
    nodeType: id === 'isolated' ? 'cell_type' : 'entity'
  }));
  const evidence = (claimId, code, role = 'supporting') => ({
    claimId, panelKey: `figure-1:${claimId.slice(-1).toUpperCase()}`,
    code, role
  });
  const relations = [
    {
      id: 'causal-ab', from: 'a', to: 'b', relationKind: 'causal',
      renderable: true, lineStyle: 'solid', contested: false, polarity: 'increases',
      evidence: [evidence('claim-s', 'S')]
    },
    {
      id: 'correlative-ab', from: 'a', to: 'b', relationKind: 'correlative',
      renderable: true, lineStyle: 'dashed', contested: false, polarity: 'increases',
      evidence: [evidence('claim-a', 'A')]
    },
    {
      id: 'causal-cd', from: 'c', to: 'd', relationKind: 'causal',
      renderable: true, lineStyle: 'solid', contested: false, polarity: 'decreases',
      evidence: [evidence('claim-r', 'R')]
    },
    {
      id: 'counter-da', from: 'd', to: 'a', relationKind: 'causal',
      renderable: false, lineStyle: 'solid', contested: false, polarity: 'decreases',
      evidence: [evidence('claim-counter-only', 'C', 'counterclaim')]
    }
  ];
  const placements = [
    { claimId: 'claim-s', panelKey: 'figure-1:S', from: 'a', to: 'b', code: 'S',
      role: 'supporting', relationIds: ['causal-ab'] },
    { claimId: 'claim-c', panelKey: 'figure-1:C', from: 'a', to: 'b', code: 'C',
      role: 'counterclaim', relationIds: [] },
    { claimId: 'claim-a', panelKey: 'figure-1:A', from: 'a', to: 'b', code: 'A',
      role: 'supporting', relationIds: ['correlative-ab'] },
    { claimId: 'claim-r', panelKey: 'figure-1:R', from: 'c', to: 'd', code: 'R',
      role: 'supporting', relationIds: ['causal-cd'] },
    { claimId: 'claim-o', panelKey: 'figure-1:O', from: 'isolated', to: 'isolated',
      code: 'O', role: 'supporting', relationIds: [] },
    { claimId: 'claim-0', panelKey: 'figure-1:Z', from: 'a', to: 'b', code: '0',
      role: 'audit', relationIds: [] },
    { claimId: 'claim-question', panelKey: 'figure-1:Q', from: 'a', to: 'b', code: '?',
      role: 'audit', relationIds: [] },
    { claimId: 'claim-counter-only', panelKey: 'figure-1:Y', from: 'd', to: 'a',
      code: 'C', role: 'counterclaim', relationIds: ['counter-da'] }
  ];
  return {
    version: 'mechanism-audit-view-v1', status: 'complete',
    canonicalDigest: `mechanism-v2-sha256-${'a'.repeat(64)}`,
    nodes, relations, placements,
    disconnectedEvidence: [{
      nodeId: 'isolated', label: 'Astrocyte state', codes: ['O'], claimCount: 1
    }],
    exclusions: [{ panelKey: 'figure-s1:A', reason: 'source_backed_schematic' }]
  };
}

test('mechanism network graph primitives are available', () => {
  assert.equal(fs.existsSync(modulePath), true,
    'core/mechanism-network.js must exist');
  const api = require(modulePath);
  assert.equal(typeof api.findMechanismStrongComponents, 'function');
  assert.equal(typeof api.mechanismNetworkFocusSet, 'function');
  assert.equal(typeof api.createMechanismMermaidDefinition, 'function');
  assert.equal(typeof api.createMechanismEvidenceMatrix, 'function');
  assert.equal(typeof api.createMechanismAuditEvidenceMatrix, 'function');
  assert.equal(typeof api.createMechanismAuditEvidenceView, 'function');
  assert.equal(typeof api.createMechanismGraphExportDto, 'function');
  assert.equal(typeof api.createMechanismAuditMermaidDefinition, 'function');
  assert.equal(typeof api.serializeMechanismAuditSvg, 'function');
  assert.equal(typeof api.normalizeMechanismEvidenceCode, 'function');
});

test('legacy red blue black stay readable while generic intervention stays unknown', () => {
  const { normalizeMechanismEvidenceCode } = require(modulePath);
  assert.deepEqual(['red', 'blue', 'black', 'intervention'].map(value =>
    normalizeMechanismEvidenceCode(value)), ['S', 'N', '?', '?']);
  assert.deepEqual(['sufficiency', 'necessity', 'rescue', 'epistasis',
    'directional_intervention', 'associational', 'localization', 'null_result',
    'counterevidence', 'inconclusive'].map(value =>
    normalizeMechanismEvidenceCode(value)), ['S', 'N', 'R', 'E', 'I', 'A', 'O', '0', 'C', '?']);
});

test('Task 9 matrix uses one canonical node set and places every claim exactly once', () => {
  const { createMechanismAuditEvidenceMatrix } = require(modulePath);
  const audit = evidenceFirstAuditFixture();
  const matrix = createMechanismAuditEvidenceMatrix(audit);
  assert.deepEqual(matrix.nodes.map(node => node.id), audit.nodes.map(node => node.id));
  assert.equal(matrix.cells.length, audit.nodes.length ** 2);
  const placements = matrix.cells.flatMap(cell => cell.evidence.map(item => ({
    cell: `${cell.from}->${cell.to}`, claimId: item.claimId, code: item.code
  })));
  assert.equal(placements.length, audit.placements.length);
  assert.equal(new Set(placements.map(item => item.claimId)).size, placements.length);
  assert.deepEqual(placements.find(item => item.claimId === 'claim-o'), {
    cell: 'isolated->isolated', claimId: 'claim-o', code: 'O'
  });
  const mixed = matrix.cells.find(cell => cell.from === 'a' && cell.to === 'b');
  assert.equal(mixed.lineStyle, 'solid', 'causal support dominates correlation-only styling');
  assert.equal(mixed.contested, true,
    'non-graph counterevidence on a supported pair must remain visibly contested');
  assert.deepEqual(mixed.relationDescriptors, [{
    id: 'causal-ab', ordinal: 1, polarity: 'increases',
    relationKind: 'causal', contested: false,
    label: 'increases', labelSource: 'generated'
  }, {
    id: 'correlative-ab', ordinal: 2, polarity: 'increases',
    relationKind: 'correlative', contested: false,
    label: 'associated with', labelSource: 'generated'
  }], 'parallel audited relations retain a stable, human-readable identity');
  assert.deepEqual(mixed.evidence.map(item => item.code), ['S', 'C', 'A', '0', '?']);
  assert.equal(matrix.cells.find(cell => cell.from === 'd' && cell.to === 'a')
    .positiveEdge, false, 'counter-only evidence must not create a positive edge');
});

test('audited evidence view reconciles visible Panel identity without inventing edit locators', () => {
  const { createMechanismAuditEvidenceView } = require(modulePath);
  const audit = evidenceFirstAuditFixture();
  audit.placements.find(item => item.claimId === 'claim-a').relationIds = [
    'causal-ab', 'correlative-ab'
  ];
  const chain = {
    nodes: audit.nodes.map(node => ({ id: node.id, label: { value: node.label } })),
    panelAliases: {
      'figure-1:S': { value: 'Reviewed sufficiency alias' },
      'figure-1:O': { value: 'Observed-state alias' }
    },
    edges: [
      {
        id: 'causal-ab', from: 'a', to: 'b', polarity: 'positive',
        panelEvidence: [
          { figureId: 'figure-1', panelId: 'S', value: '1S',
            evidenceClass: 'sufficiency' },
          { figureId: 'figure-1', panelId: 'A', value: '1A',
            evidenceClass: 'other' }
        ]
      },
      {
        id: 'correlative-ab', from: 'a', to: 'b', polarity: 'neutral',
        panelEvidence: [{ figureId: 'figure-1', panelId: 'A', value: '1A',
          evidenceClass: 'other' }]
      },
      {
        id: 'causal-cd', from: 'c', to: 'd', polarity: 'negative',
        panelEvidence: [{ figureId: 'figure-1', panelId: 'R', value: '1R',
          evidenceClass: 'necessity' }]
      }
    ]
  };
  const panelOptions = ['S', 'A', 'R', 'O', 'C', 'Z', 'Q', 'Y'].map(panelId => ({
    figureId: 'figure-1', panelId, displayId: `1${panelId}`,
    evidenceClass: panelId === 'S' ? 'sufficiency'
      : panelId === 'R' ? 'necessity' : 'other'
  }));
  const before = JSON.stringify({ audit, chain, panelOptions });
  const view = createMechanismAuditEvidenceView(chain, audit, panelOptions);

  assert.equal(view.version, 'mechanism-audit-evidence-view-v1');
  const items = view.cells.flatMap(cell => cell.evidence);
  const unique = items.find(item => item.claimId === 'claim-s');
  assert.equal(unique.displayName, 'Reviewed sufficiency alias');
  assert.equal(unique.originalDisplayId, '1S');
  assert.equal(unique.evidenceClass, 'sufficiency');
  assert.equal(unique.claimCode, 'S');
  assert.equal(unique.placementKind, 'relation');
  assert.equal(unique.ownerEdgeId, 'causal-ab');
  assert.equal(unique.evidenceIndex, 0);

  const ambiguous = items.find(item => item.claimId === 'claim-a');
  assert.equal(ambiguous.displayName, '1A');
  assert.equal(ambiguous.evidenceClass, 'other');
  assert.equal(ambiguous.claimCode, 'A');
  assert.equal(ambiguous.mappingStatus, 'ambiguous');
  assert.equal(Object.hasOwn(ambiguous, 'ownerEdgeId'), false);
  assert.equal(Object.hasOwn(ambiguous, 'evidenceIndex'), false);

  const nodeOnly = items.find(item => item.claimId === 'claim-o');
  assert.equal(nodeOnly.displayName, 'Observed-state alias');
  assert.equal(nodeOnly.originalDisplayId, '1O');
  assert.equal(nodeOnly.placementKind, 'node_only');
  assert.equal(nodeOnly.claimCode, 'O');
  assert.equal(Object.hasOwn(nodeOnly, 'ownerEdgeId'), false);
  assert.equal(Object.hasOwn(nodeOnly, 'evidenceIndex'), false);
  assert.equal(JSON.stringify({ audit, chain, panelOptions }), before,
    'the reconciliation helper stays pure');
});

test('audited evidence locator requires the relationIds and panelKey tuple to be unique', () => {
  const { createMechanismAuditEvidenceView } = require(modulePath);
  const audit = evidenceFirstAuditFixture();
  const chain = {
    nodes: audit.nodes.map(node => ({ id: node.id, label: { value: node.label } })),
    edges: [{
      id: 'causal-ab', from: 'a', to: 'b', panelEvidence: [
        { figureId: 'figure-1', panelId: 'S', value: '1S', evidenceClass: 'sufficiency' },
        { figureId: 'figure-1', panelId: 'S', value: '1S', evidenceClass: 'sufficiency' }
      ]
    }, {
      id: 'unlisted-edge', from: 'a', to: 'b', panelEvidence: [
        { figureId: 'figure-1', panelId: 'C', value: '1C', evidenceClass: 'other' }
      ]
    }]
  };
  const view = createMechanismAuditEvidenceView(chain, audit, [
    { figureId: 'figure-1', panelId: 'S', displayId: '1S', evidenceClass: 'sufficiency' },
    { figureId: 'figure-1', panelId: 'C', displayId: '1C', evidenceClass: 'other' }
  ]);
  const items = view.cells.flatMap(cell => cell.evidence);
  const duplicated = items.find(item => item.claimId === 'claim-s');
  assert.equal(duplicated.mappingStatus, 'ambiguous');
  assert.equal(Object.hasOwn(duplicated, 'ownerEdgeId'), false);
  const relationless = items.find(item => item.claimId === 'claim-c');
  assert.equal(relationless.mappingStatus, 'unmapped');
  assert.equal(Object.hasOwn(relationless, 'ownerEdgeId'), false,
    'a matching Panel on an edge outside relationIds must never become editable');
});

test('audited aggregate placement stays view-only when one declared relation is stale', () => {
  const { createMechanismAuditEvidenceView } = require(modulePath);
  const audit = evidenceFirstAuditFixture();
  const placement = audit.placements.find(item => item.claimId === 'claim-a');
  placement.relationIds = ['causal-ab', 'correlative-ab'];
  const chain = {
    nodes: audit.nodes.map(node => ({ id: node.id, label: { value: node.label } })),
    edges: [{
      id: 'causal-ab', from: 'a', to: 'b', panelEvidence: [{
        figureId: 'figure-1', panelId: 'A', value: '1A', evidenceClass: 'other'
      }]
    }]
  };
  const view = createMechanismAuditEvidenceView(chain, audit, [{
    figureId: 'figure-1', panelId: 'A', displayId: '1A', evidenceClass: 'other'
  }]);
  const aggregate = view.cells.flatMap(cell => cell.evidence)
    .find(item => item.claimId === 'claim-a');
  assert.equal(aggregate.mappingStatus, 'ambiguous');
  assert.equal(Object.hasOwn(aggregate, 'ownerEdgeId'), false);
  assert.equal(Object.hasOwn(aggregate, 'evidenceIndex'), false);
});

test('audited evidence locator fails closed for duplicate raw edge identifiers', () => {
  const { createMechanismAuditEvidenceView } = require(modulePath);
  const audit = evidenceFirstAuditFixture();
  const chain = {
    nodes: audit.nodes.map(node => ({ id: node.id, label: { value: node.label } })),
    edges: [{
      id: 'causal-ab', from: 'a', to: 'b', panelEvidence: [{
        figureId: 'figure-1', panelId: 'S', value: '1S', evidenceClass: 'sufficiency'
      }]
    }, {
      id: 'causal-ab', from: 'a', to: 'b', panelEvidence: [{
        figureId: 'figure-1', panelId: 'A', value: '1A', evidenceClass: 'other'
      }]
    }]
  };
  const view = createMechanismAuditEvidenceView(chain, audit, [{
    figureId: 'figure-1', panelId: 'S', displayId: '1S',
    evidenceClass: 'sufficiency'
  }]);
  const placement = view.cells.flatMap(cell => cell.evidence)
    .find(item => item.claimId === 'claim-s');
  assert.equal(placement.mappingStatus, 'ambiguous');
  assert.equal(Object.hasOwn(placement, 'ownerEdgeId'), false);
  assert.equal(Object.hasOwn(placement, 'evidenceIndex'), false);
});

test('audited evidence view reads array descriptors without executing get traps', () => {
  const { createMechanismAuditEvidenceView } = require(modulePath);
  let getTrapCalls = 0;
  const descriptorOnlyArray = values => new Proxy(values, {
    get() {
      getTrapCalls += 1;
      throw new Error('array get trap must not execute');
    }
  });
  const audit = evidenceFirstAuditFixture();
  audit.relations.forEach(relation => {
    relation.evidence = descriptorOnlyArray(relation.evidence);
  });
  audit.placements.forEach(placement => {
    placement.relationIds = descriptorOnlyArray(placement.relationIds);
  });
  audit.nodes = descriptorOnlyArray(audit.nodes);
  audit.relations = descriptorOnlyArray(audit.relations);
  audit.placements = descriptorOnlyArray(audit.placements);
  const panelEvidence = descriptorOnlyArray([{
    figureId: 'figure-1', panelId: 'S', value: '1S', evidenceClass: 'sufficiency'
  }]);
  const chain = {
    nodes: descriptorOnlyArray([
      { id: 'a', label: { value: 'Node A' } },
      { id: 'b', label: { value: 'Node B' } }
    ]),
    edges: descriptorOnlyArray([{
      id: 'causal-ab', from: 'a', to: 'b', panelEvidence
    }])
  };
  const panelOptions = descriptorOnlyArray([{
    figureId: 'figure-1', panelId: 'S', displayId: '1S',
    evidenceClass: 'sufficiency'
  }]);

  const view = createMechanismAuditEvidenceView(chain, audit, panelOptions);
  const placement = view.cells.flatMap(cell => cell.evidence)
    .find(item => item.claimId === 'claim-s');
  assert.equal(getTrapCalls, 0);
  assert.equal(placement.mappingStatus, 'unique');
  assert.equal(placement.ownerEdgeId, 'causal-ab');
});

test('audited evidence view absorbs throwing length descriptors and revoked proxies', () => {
  const { createMechanismAuditEvidenceView } = require(modulePath);
  const inputs = () => {
    const audit = evidenceFirstAuditFixture();
    return {
      audit,
      chain: {
        nodes: audit.nodes.map(node => ({ id: node.id, label: { value: node.label } })),
        edges: [{
          id: 'causal-ab', from: 'a', to: 'b', panelEvidence: [{
            figureId: 'figure-1', panelId: 'S', value: '1S',
            evidenceClass: 'sufficiency'
          }]
        }]
      },
      panelOptions: [{
        figureId: 'figure-1', panelId: 'S', displayId: '1S',
        evidenceClass: 'sufficiency'
      }]
    };
  };
  let lengthDescriptorCalls = 0;
  const descriptorInputs = inputs();
  descriptorInputs.panelOptions = new Proxy(descriptorInputs.panelOptions, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'length') {
        lengthDescriptorCalls += 1;
        throw new Error('length descriptor denied');
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  let descriptorView;
  assert.doesNotThrow(() => {
    descriptorView = createMechanismAuditEvidenceView(
      descriptorInputs.chain, descriptorInputs.audit, descriptorInputs.panelOptions
    );
  });
  assert.equal(lengthDescriptorCalls, 1);
  assert.equal(descriptorView.version, 'mechanism-audit-evidence-view-v1');

  const revokedArray = () => {
    const pair = Proxy.revocable([], {});
    pair.revoke();
    return pair.proxy;
  };
  const revokedObject = () => {
    const pair = Proxy.revocable({}, {});
    pair.revoke();
    return pair.proxy;
  };
  const cases = [
    ['chain root', value => { value.chain = revokedObject(); }],
    ['audit root', value => { value.audit = revokedObject(); }],
    ['panelOptions', value => { value.panelOptions = revokedArray(); }],
    ['chain nodes', value => { value.chain.nodes = revokedArray(); }],
    ['chain edges', value => { value.chain.edges = revokedArray(); }],
    ['chain panelEvidence', value => {
      value.chain.edges[0].panelEvidence = revokedArray();
    }],
    ['audit placements', value => { value.audit.placements = revokedArray(); }],
    ['audit relationIds', value => {
      value.audit.placements[0].relationIds = revokedArray();
    }],
    ['audit evidence', value => {
      value.audit.relations[0].evidence = revokedArray();
    }]
  ];
  cases.forEach(([name, mutate]) => {
    const value = inputs();
    mutate(value);
    let view;
    assert.doesNotThrow(() => {
      view = createMechanismAuditEvidenceView(
        value.chain, value.audit, value.panelOptions
      );
    }, name);
    assert.equal(view.version, 'mechanism-audit-evidence-view-v1', name);
  });
});

test('audited evidence reconciliation indexes bounded records instead of rescanning them', () => {
  const { createMechanismAuditEvidenceView } = require(modulePath);
  const nodes = [
    { id: 'a', label: { value: 'Source' } },
    { id: 'b', label: { value: 'Target' } }
  ];
  const edges = Array.from({ length: 64 }, (_, edgeIndex) => ({
    id: `edge-${edgeIndex}`, from: 'a', to: 'b',
    panelEvidence: Array.from({ length: 64 }, (_, evidenceIndex) => ({
      figureId: `figure-${edgeIndex}`, panelId: `P${evidenceIndex}`,
      value: `${edgeIndex + 1}${evidenceIndex + 1}`, evidenceClass: 'other'
    }))
  }));
  const relations = edges.map(edge => ({
    id: edge.id, from: 'a', to: 'b', relationKind: 'causal',
    renderable: true, contested: false, polarity: 'increases', evidence: []
  }));
  const placements = edges.flatMap((edge, edgeIndex) => edge.panelEvidence.map(
    (evidence, evidenceIndex) => ({
      claimId: `claim-${edgeIndex}-${evidenceIndex}`,
      panelKey: `${evidence.figureId}:${evidence.panelId}`,
      from: 'a', to: 'b', code: 'O', role: 'supporting',
      relationIds: [edge.id]
    })
  )).slice(0, 1024);
  const audit = {
    version: 'mechanism-audit-view-v1', status: 'complete',
    nodes: [
      { id: 'a', label: 'Source', nodeType: 'entity' },
      { id: 'b', label: 'Target', nodeType: 'entity' }
    ],
    relations, placements, disconnectedEvidence: [], exclusions: []
  };
  const originalFilter = Array.prototype.filter;
  let fullRecordScans = 0;
  Array.prototype.filter = function countedFilter(callback, thisArg) {
    if (this.length === 4096) fullRecordScans += 1;
    return Reflect.apply(originalFilter, this, [callback, thisArg]);
  };
  let view;
  try {
    view = createMechanismAuditEvidenceView({ nodes, edges }, audit, []);
  } finally {
    Array.prototype.filter = originalFilter;
  }
  const items = view.cells.find(cell => cell.from === 'a' && cell.to === 'b').evidence;
  assert.equal(fullRecordScans, 0,
    'a prebuilt locator index must replace one full record scan per placement');
  assert.equal(items.length, 1024);
  assert.deepEqual([
    items[0].mappingStatus, items[0].ownerEdgeId, items[0].evidenceIndex
  ], ['unique', 'edge-0', 0]);
  assert.deepEqual([
    items[1023].mappingStatus, items[1023].ownerEdgeId, items[1023].evidenceIndex
  ], ['unique', 'edge-15', 63]);
});

test('audited evidence locator index keeps hostile tuple fields structurally separate', () => {
  const { createMechanismAuditEvidenceView } = require(modulePath);
  const chain = {
    nodes: ['a', 'b', 'figure-2:Q', 'a\u0000b'].map(id => ({
      id, label: { value: id }
    })),
    edges: [{
      id: 'safe-edge', from: 'a', to: 'b', panelEvidence: [{
        figureId: 'figure-1', panelId: 'S', value: '1S', evidenceClass: 'sufficiency'
      }]
    }, {
      id: 'edge\u0000figure-1:P', from: 'a', to: 'b', panelEvidence: [{
        figureId: 'figure-2', panelId: 'Q', value: '2Q', evidenceClass: 'other'
      }]
    }, {
      id: 'edge', from: 'figure-2:Q', to: 'a\u0000b', panelEvidence: [{
        figureId: 'figure-1', panelId: 'P', value: '1P', evidenceClass: 'other'
      }]
    }]
  };
  const audit = {
    version: 'mechanism-audit-view-v1', status: 'complete',
    nodes: ['a', 'b', 'figure-2:Q', 'a b'].map(id => ({
      id, label: id, nodeType: 'entity'
    })),
    relations: [{
      id: 'safe-edge', from: 'a', to: 'b', relationKind: 'causal',
      renderable: true, contested: false, polarity: 'increases', evidence: []
    }, {
      id: 'edge', from: 'figure-2:Q', to: 'a b', relationKind: 'causal',
      renderable: true, contested: false, polarity: 'increases', evidence: []
    }],
    placements: [{
      claimId: 'safe-claim', panelKey: 'figure-1:S', from: 'a', to: 'b',
      code: 'S', role: 'supporting', relationIds: ['safe-edge']
    }, {
      claimId: 'hostile-claim', panelKey: 'figure-1:P',
      from: 'figure-2:Q', to: 'a b', code: 'O', role: 'supporting',
      relationIds: ['edge']
    }],
    disconnectedEvidence: [], exclusions: []
  };
  const originalSet = Map.prototype.set;
  let serializedLocatorKeys = 0;
  Map.prototype.set = function countedSet(key, value) {
    if (typeof key === 'string' && key.split('\u0000').length >= 4) {
      serializedLocatorKeys += 1;
    }
    return Reflect.apply(originalSet, this, [key, value]);
  };
  let view;
  try {
    view = createMechanismAuditEvidenceView(chain, audit, []);
  } finally {
    Map.prototype.set = originalSet;
  }
  assert.equal(serializedLocatorKeys, 0,
    'locator tuple parts must not share an in-band string key');
  const items = view.cells.flatMap(cell => cell.evidence);
  assert.equal(items.find(item => item.claimId === 'safe-claim').mappingStatus, 'unique');
  const hostile = items.find(item => item.claimId === 'hostile-claim');
  assert.equal(hostile.mappingStatus, 'unmapped');
  assert.equal(Object.hasOwn(hostile, 'ownerEdgeId'), false);
});

test('audited edit locators require a complete and readable raw edge inventory', () => {
  const {
    createMechanismAuditEvidenceView, createMechanismEvidenceMatrix
  } = require(modulePath);
  const audit = evidenceFirstAuditFixture();
  const nodes = audit.nodes.map(node => ({ id: node.id, label: { value: node.label } }));
  const primary = () => ({
    id: 'causal-ab', from: 'a', to: 'b', panelEvidence: [{
      figureId: 'figure-1', panelId: 'S', value: '1S', evidenceClass: 'sufficiency'
    }]
  });
  const independent = () => ({
    id: 'causal-cd', from: 'c', to: 'd', panelEvidence: [{
      figureId: 'figure-1', panelId: 'R', value: '1R', evidenceClass: 'necessity'
    }]
  });
  const duplicate = () => ({
    id: 'causal-ab', from: 'a', to: 'b', panelEvidence: [{
      figureId: 'figure-1', panelId: 'S', value: 'duplicate',
      evidenceClass: 'sufficiency'
    }]
  });
  let accessorCalls = 0;
  let descriptorTrapCalls = 0;
  const scenarios = [
    ['throwing index descriptor', () => new Proxy(
      [primary(), independent(), duplicate()], {
        getOwnPropertyDescriptor(target, key) {
          if (key === '2') {
            descriptorTrapCalls += 1;
            throw new Error('hidden duplicate edge');
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        }
      }
    )],
    ['over-limit duplicate', () => Array.from({ length: 65 }, (_, index) => {
      if (index === 0) return primary();
      if (index === 1) return independent();
      if (index === 64) return duplicate();
      return { id: `filler-${index}`, from: 'a', to: 'b', panelEvidence: [] };
    })],
    ['accessor index', () => {
      const edges = [primary(), independent()];
      Object.defineProperty(edges, '2', {
        configurable: true,
        get() {
          accessorCalls += 1;
          return duplicate();
        }
      });
      return edges;
    }],
    ['sparse index', () => {
      const edges = [primary(), independent()];
      edges.length = 3;
      return edges;
    }],
    ['accessor edge id', () => {
      const hidden = duplicate();
      delete hidden.id;
      Object.defineProperty(hidden, 'id', {
        configurable: true,
        get() {
          accessorCalls += 1;
          return 'causal-ab';
        }
      });
      return [primary(), independent(), hidden];
    }],
    ['throwing edge field descriptor', () => [
      primary(), independent(), new Proxy(duplicate(), {
        getOwnPropertyDescriptor(target, key) {
          if (key === 'id') {
            descriptorTrapCalls += 1;
            throw new Error('hidden edge id');
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        }
      })
    ]],
    ['revoked edge item', () => {
      const pair = Proxy.revocable(duplicate(), {});
      pair.revoke();
      return [primary(), independent(), pair.proxy];
    }]
  ];
  const results = scenarios.map(([name, buildEdges]) => {
    const chain = { nodes, edges: buildEdges() };
    const view = createMechanismAuditEvidenceView(chain, audit, []);
    const items = view.cells.flatMap(cell => cell.evidence);
    const matrix = createMechanismEvidenceMatrix(chain);
    return {
      name,
      primaryEditable: Object.hasOwn(
        items.find(item => item.claimId === 'claim-s'), 'ownerEdgeId'
      ),
      independentEditable: Object.hasOwn(
        items.find(item => item.claimId === 'claim-r'), 'ownerEdgeId'
      ),
      readablePrefix: matrix.cells.some(cell => cell.evidence.some(
        item => item.panelId === 'S'
      ))
    };
  });
  assert.equal(accessorCalls, 0, 'accessor indices and fields must never execute');
  assert.ok(descriptorTrapCalls > 0, 'descriptor failures are exercised and absorbed');
  assert.deepEqual(results.map(result => [
    result.name, result.primaryEditable, result.independentEditable,
    result.readablePrefix
  ]), scenarios.map(([name]) => [name, false, false, true]));
});

test('audited edit locators require complete related Panel evidence records', () => {
  const {
    createMechanismAuditEvidenceView, createMechanismEvidenceMatrix
  } = require(modulePath);
  const audit = evidenceFirstAuditFixture();
  const nodes = audit.nodes.map(node => ({ id: node.id, label: { value: node.label } }));
  const evidence = () => ({
    figureId: 'figure-1', panelId: 'S', value: '1S', evidenceClass: 'sufficiency'
  });
  const duplicate = () => ({
    figureId: 'figure-1', panelId: 'S', value: 'duplicate',
    evidenceClass: 'sufficiency'
  });
  const independent = () => ({
    id: 'causal-cd', from: 'c', to: 'd', panelEvidence: [{
      figureId: 'figure-1', panelId: 'R', value: '1R', evidenceClass: 'necessity'
    }]
  });
  let accessorCalls = 0;
  let descriptorTrapCalls = 0;
  const scenarios = [
    ['throwing index descriptor', () => new Proxy([evidence(), duplicate()], {
      getOwnPropertyDescriptor(target, key) {
        if (key === '1') {
          descriptorTrapCalls += 1;
          throw new Error('hidden duplicate evidence');
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    })],
    ['over-limit duplicate', () => Array.from({ length: 65 }, (_, index) => {
      if (index === 0) return evidence();
      if (index === 64) return duplicate();
      return {
        figureId: 'figure-1', panelId: `F${index}`, value: `1F${index}`,
        evidenceClass: 'other'
      };
    })],
    ['accessor index', () => {
      const values = [evidence()];
      Object.defineProperty(values, '1', {
        configurable: true,
        get() {
          accessorCalls += 1;
          return duplicate();
        }
      });
      return values;
    }],
    ['sparse index', () => {
      const values = [evidence()];
      values.length = 2;
      return values;
    }],
    ['accessor figure id', () => {
      const hidden = duplicate();
      delete hidden.figureId;
      Object.defineProperty(hidden, 'figureId', {
        configurable: true,
        get() {
          accessorCalls += 1;
          return 'figure-1';
        }
      });
      return [evidence(), hidden];
    }],
    ['throwing item field descriptor', () => [
      evidence(), new Proxy(duplicate(), {
        getOwnPropertyDescriptor(target, key) {
          if (key === 'panelId') {
            descriptorTrapCalls += 1;
            throw new Error('hidden Panel identity');
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        }
      })
    ]],
    ['revoked evidence item', () => {
      const pair = Proxy.revocable(duplicate(), {});
      pair.revoke();
      return [evidence(), pair.proxy];
    }]
  ];
  const results = scenarios.map(([name, buildEvidence]) => {
    const chain = {
      nodes,
      edges: [{
        id: 'causal-ab', from: 'a', to: 'b', panelEvidence: buildEvidence()
      }, independent()]
    };
    const view = createMechanismAuditEvidenceView(chain, audit, []);
    const items = view.cells.flatMap(cell => cell.evidence);
    const matrix = createMechanismEvidenceMatrix(chain);
    return {
      name,
      primaryEditable: Object.hasOwn(
        items.find(item => item.claimId === 'claim-s'), 'ownerEdgeId'
      ),
      independentEditable: Object.hasOwn(
        items.find(item => item.claimId === 'claim-r'), 'ownerEdgeId'
      ),
      readablePrefix: matrix.cells.some(cell => cell.evidence.some(
        item => item.panelId === 'S'
      ))
    };
  });
  assert.equal(accessorCalls, 0, 'evidence accessors must never execute');
  assert.ok(descriptorTrapCalls > 0, 'evidence descriptor failures are absorbed');
  assert.deepEqual(results.map(result => [
    result.name, result.primaryEditable, result.independentEditable,
    result.readablePrefix
  ]), scenarios.map(([name]) => [name, false, false, true]));

  const unrelated = [evidence()];
  unrelated.length = 2;
  const isolatedFailureChain = {
    nodes,
    edges: [{
      id: 'causal-ab', from: 'a', to: 'b', panelEvidence: [evidence()]
    }, independent(), {
      id: 'unrelated', from: 'a', to: 'b', panelEvidence: unrelated
    }]
  };
  const isolatedItems = createMechanismAuditEvidenceView(
    isolatedFailureChain, audit, []
  ).cells.flatMap(cell => cell.evidence);
  assert.equal(
    isolatedItems.find(item => item.claimId === 'claim-s').mappingStatus,
    'unique',
    'an incomplete edge outside every audit relationId cannot revoke unrelated locators'
  );
});

test('Task 9 graph renders every supported component and audits evidence-only nodes separately', () => {
  const { createMechanismGraphExportDto } = require(modulePath);
  const dto = createMechanismGraphExportDto(evidenceFirstAuditFixture());
  assert.deepEqual(dto.components.map(component => component.nodeIds), [
    ['a', 'b'], ['c', 'd']
  ]);
  assert.deepEqual(dto.nodes.map(node => node.id), ['a', 'b', 'c', 'd']);
  assert.equal(dto.nodes.some(node => node.id === 'isolated'), false);
  assert.deepEqual(dto.disconnectedEvidence, [{
    nodeId: 'isolated', label: 'Astrocyte state', codes: ['O'], claimCount: 1
  }]);
  assert.equal(dto.edges.some(edge => edge.from === edge.to), false);
  assert.equal(dto.edges.some(edge => edge.id.includes('counter-da')), false);
  const mixed = dto.edges.find(edge => edge.from === 'a' && edge.to === 'b');
  assert.equal(mixed.lineStyle, 'solid');
  assert.equal(mixed.contested, true);
  assert.deepEqual(mixed.codes, ['S', 'A', 'C']);
});

test('graph DTO Mermaid and SVG exports omit provenance and reject injection-shaped labels', () => {
  const {
    createMechanismGraphExportDto,
    createMechanismAuditMermaidDefinition,
    createMechanismNetworkLayout,
    serializeMechanismAuditSvg
  } = require(modulePath);
  const audit = evidenceFirstAuditFixture();
  audit.nodes[0].label = `${'Long biology '.repeat(30)}end\nclick n0 \"javascript:alert(1)\" ` +
    '<svg onload="alert(1)">Panel 2A</svg>';
  audit.nodes[0].panelUid = 'secret-panel-uid';
  audit.nodes[0].sourceRefs = ['figure-2:A:directObservation'];
  audit.relations[0].claimId = 'secret-claim';
  audit.relations[0].metadata = { evidenceText: 'private evidence', panelKey: 'figure-2:A' };
  const dto = createMechanismGraphExportDto(audit);
  const serialized = JSON.stringify(dto);
  for (const forbidden of [
    'panelUid', 'panelKey', 'claimId', 'sourceRefs', 'evidenceText',
    'private evidence', 'secret-panel-uid', 'secret-claim'
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden, 'iu'));
  assert.ok(dto.nodes.every(node => Array.from(node.label).length <= 120));
  const mermaid = createMechanismAuditMermaidDefinition(dto);
  assert.doesNotMatch(mermaid, /javascript:|<svg|onload|\bclick\b|Panel\s*2A|\r/u);
  assert.match(mermaid, /-\.->|-->/u);
  assert.match(mermaid, /contested/u);
  const layout = createMechanismNetworkLayout(dto, { viewportWidth: 900 });
  const svg = serializeMechanismAuditSvg({ graph: dto, layout });
  assert.doesNotMatch(svg, /javascript:|<svg[^>]+onload|panelUid|panelKey|claimId|sourceRefs/iu);
  assert.match(svg, /data-line-style="solid"/u);
  assert.match(svg, /data-contested="true"/u);
  const correlationOnly = {
    ...dto,
    edges: dto.edges.map((edge, index) => ({
      ...edge,
      lineStyle: index === 0 ? 'dashed' : edge.lineStyle,
      contested: index === 0 ? false : edge.contested
    }))
  };
  const correlationLayout = createMechanismNetworkLayout(correlationOnly, {
    viewportWidth: 900
  });
  const correlationSvg = serializeMechanismAuditSvg({
    graph: correlationOnly, layout: correlationLayout
  });
  assert.match(correlationSvg,
    /class="mechanism-edge correlation-only"[^>]+data-line-style="dashed"/u);
  assert.match(correlationSvg, /marker-end="url\(#audit-arrow-correlation\)"/u);
  assert.match(correlationSvg, /\.mechanism-edge\.correlation-only\{stroke:#111\}/u);
});

test('creates a concise Mermaid mechanism graph without putting Panel ids on arrows', () => {
  const { createMechanismMermaidDefinition } = require(modulePath);
  const chain = {
    nodes: [
      { id: 'p1', label: { value: '表型 P1 增强' } },
      { id: 'cell', label: { value: '关键细胞 C' } },
      { id: 'm1', label: { value: '分子 M1 上调' } },
      { id: 'hostile', label: {
        value: 'Panel 2A <svg onload="alert(1)"> click n0 "javascript:alert(1)"'
      } }
    ],
    edges: [
      { id: 'e1', from: 'p1', to: 'cell', polarity: 'neutral', panelEvidence: [
        { value: '1A', evidenceClass: 'other' },
        { value: 'S1B', evidenceClass: 'necessity' }
      ] },
      { id: 'e2', from: 'cell', to: 'm1', polarity: 'positive', panelEvidence: [
        { value: '2C', evidenceClass: 'sufficiency' }
      ] }
    ]
  };
  const mermaid = createMechanismMermaidDefinition(chain, { language: 'zh-CN' });
  assert.match(mermaid, /^flowchart LR/m);
  assert.match(mermaid, /表型 P1 增强/);
  assert.match(mermaid, /关键细胞 C/);
  assert.doesNotMatch(mermaid, /1A|S1B|2C/);
  assert.doesNotMatch(mermaid, /Panel\s*2A|<svg|onload|\bclick\b|javascript:/iu);
  const narrowMermaid = createMechanismMermaidDefinition(chain, {
    language: 'zh-CN',
    direction: 'TD'
  });
  assert.match(narrowMermaid, /^flowchart TD/m);
});

test('creates a directed evidence matrix and preserves evidence class colors', () => {
  const { createMechanismEvidenceMatrix } = require(modulePath);
  const matrix = createMechanismEvidenceMatrix({
    nodes: [
      { id: 'p1', label: { value: 'Phenotype P1' } },
      { id: 'cell', label: { value: 'Cell C' } },
      { id: 'm1', label: { value: 'Molecule M1' } }
    ],
    edges: [
      { id: 'e1', from: 'p1', to: 'cell', panelEvidence: [
        { value: '1A', evidenceClass: 'other' },
        { value: 'S1B', evidenceClass: 'necessity' }
      ] },
      { id: 'e2', from: 'cell', to: 'm1', panelEvidence: [
        { value: '2C', evidenceClass: 'sufficiency' },
        { value: '2D', evidenceClass: 'other' }
      ] }
    ]
  });
  assert.deepEqual(matrix.nodes.map(node => node.id), ['p1', 'cell', 'm1']);
  assert.deepEqual(matrix.cells.find(cell => cell.from === 'p1' && cell.to === 'cell')
    .evidence, [
      {
        panelKey: '', figureId: '', panelId: '', originalDisplayId: '1A',
        displayName: '1A', evidenceClass: 'other',
        ownerEdgeId: 'e1', edgeId: 'e1', evidenceIndex: 0
      },
      {
        panelKey: '', figureId: '', panelId: '', originalDisplayId: 'S1B',
        displayName: 'S1B', evidenceClass: 'necessity',
        ownerEdgeId: 'e1', edgeId: 'e1', evidenceIndex: 1
      }
    ]);
  assert.deepEqual(matrix.cells.find(cell => cell.from === 'p1' && cell.to === 'cell')
    .edgeIds, ['e1']);
  assert.deepEqual(matrix.cells.find(cell => cell.from === 'cell' && cell.to === 'm1')
    .evidence, [
      {
        panelKey: '', figureId: '', panelId: '', originalDisplayId: '2C',
        displayName: '2C', evidenceClass: 'sufficiency',
        ownerEdgeId: 'e2', edgeId: 'e2', evidenceIndex: 0
      },
      {
        panelKey: '', figureId: '', panelId: '', originalDisplayId: '2D',
        displayName: '2D', evidenceClass: 'other',
        ownerEdgeId: 'e2', edgeId: 'e2', evidenceIndex: 1
      }
    ]);
});

test('keeps immutable Panel identity and aliases in the matrix only', () => {
  const {
    createMechanismEvidenceMatrix,
    createMechanismMermaidDefinition,
    createMechanismNetworkLayout,
    serializeMechanismNetworkSvg
  } = require(modulePath);
  const chain = complexMechanismFixture();
  chain.panelAliases = {
    'figure-2:C': { value: 'rescue alias', humanReviewed: true, editedAt: 12 }
  };
  chain.edges[0].panelEvidence = [{
    figureId: 'figure-2', panelId: 'C', value: '2C',
    evidenceClass: 'sufficiency'
  }];
  const evidence = createMechanismEvidenceMatrix(chain).cells
    .find(cell => cell.evidence.length).evidence[0];
  assert.deepEqual(evidence, {
    panelKey: 'figure-2:C', figureId: 'figure-2', panelId: 'C',
    originalDisplayId: '2C', displayName: 'rescue alias',
    evidenceClass: 'sufficiency', ownerEdgeId: 'source-a',
    edgeId: 'source-a', evidenceIndex: 0
  });
  assert.doesNotMatch(createMechanismMermaidDefinition(chain), /2C|rescue alias/u);
  const layout = createMechanismNetworkLayout(chain, { viewportWidth: 900 });
  assert.doesNotMatch(serializeMechanismNetworkSvg({ chain, layout }), /2C|rescue alias/u);
});

test('parallel edges keep identical Panels as separately editable matrix chips', () => {
  const { createMechanismEvidenceMatrix } = require(modulePath);
  const matrix = createMechanismEvidenceMatrix({
    nodes: [{ id: 'a', label: { value: 'A' } }, { id: 'b', label: { value: 'B' } }],
    edges: [
      { id: 'edge-positive', from: 'a', to: 'b', polarity: 'positive',
        contested: true, label: { value: 'activates', humanReviewed: true },
        panelEvidence: [{ figureId: 'figure-2', panelId: 'A', value: '2A' }] },
      { id: 'edge-negative', from: 'a', to: 'b', polarity: 'negative',
        relationKind: 'correlative', label: {
          value: 'tracks inversely', humanReviewed: false
        },
        panelEvidence: [{ figureId: 'figure-2', panelId: 'A', value: '2A' }] }
    ]
  });
  const cell = matrix.cells.find(item => item.from === 'a' && item.to === 'b');
  assert.equal(cell.evidence.length, 2);
  assert.deepEqual(cell.evidence.map(item => [item.ownerEdgeId, item.evidenceIndex]), [
    ['edge-positive', 0], ['edge-negative', 0]
  ]);
  assert.deepEqual(cell.relationDescriptors, [{
    id: 'edge-positive', ordinal: 1, polarity: 'positive',
    relationKind: 'causal', contested: true,
    label: 'activates', labelSource: 'source'
  }, {
    id: 'edge-negative', ordinal: 2, polarity: 'negative',
    relationKind: 'correlative', contested: false,
    label: 'tracks inversely', labelSource: 'generated'
  }]);
});

test('audit Mermaid localizes only generated relation chrome and leaves its export DTO unchanged', () => {
  const { createMechanismAuditMermaidDefinition } = require(modulePath);
  const graph = {
    schema: 'brevess.mechanism-graph', schemaVersion: 1,
    nodes: [
      { id: 'a', label: 'STAT3' },
      { id: 'b', label: 'Microglia activation' },
      { id: 'c', label: 'Behavioral outcome' }
    ],
    edges: [
      { id: 'increase', from: 'a', to: 'b', label: 'increases',
        lineStyle: 'solid', contested: false, codes: ['S'], polarity: 'positive' },
      { id: 'decrease', from: 'b', to: 'c', label: 'decreases',
        lineStyle: 'solid', contested: true, codes: ['C'], polarity: 'negative' },
      { id: 'correlation', from: 'a', to: 'c', label: 'associated with',
        lineStyle: 'dashed', contested: false, codes: ['A'], polarity: 'neutral' },
      { id: 'custom', from: 'c', to: 'a', label: 'tracks phase shift',
        lineStyle: 'solid', contested: false, codes: [], polarity: 'neutral' }
    ]
  };
  const frozen = structuredClone(graph);
  const sourceZh = createMechanismAuditMermaidDefinition(graph, { language: 'zh-CN' });
  const zh = createMechanismAuditMermaidDefinition(graph, {
    language: 'zh-CN', generatedRelationLabels: true
  });
  const en = createMechanismAuditMermaidDefinition(graph, {
    language: 'en', generatedRelationLabels: true
  });

  assert.match(sourceZh, /\bincreases\b/u,
    'a caller-provided scientific label equal to a generated token stays verbatim');
  assert.match(sourceZh, /有争议：decreases/u);
  assert.match(sourceZh, /associated with/u);
  assert.match(zh, /促进/u);
  assert.match(zh, /有争议：抑制/u);
  assert.match(zh, /相关/u);
  assert.match(zh, /tracks phase shift/u, 'scientific relation text stays verbatim');
  assert.doesNotMatch(zh, /contested:|associated with|\bincreases\b|\bdecreases\b/u);
  assert.match(en, /increases/u);
  assert.match(en, /contested: decreases/u);
  assert.match(en, /associated with/u);
  assert.deepEqual(graph, frozen, 'view localization must not mutate export data');
});

test('matrix relation descriptors leave missing labels for interface-localized polarity fallback', () => {
  const { createMechanismEvidenceMatrix } = require(modulePath);
  const matrix = createMechanismEvidenceMatrix({
    nodes: [{ id: 'a', label: { value: 'A' } }, { id: 'b', label: { value: 'B' } }],
    edges: [{
      id: 'edge-neutral', from: 'a', to: 'b', polarity: 'neutral', panelEvidence: []
    }]
  });
  assert.deepEqual(matrix.cells.find(cell => cell.from === 'a' && cell.to === 'b')
    .relationDescriptors, [{
    id: 'edge-neutral', ordinal: 1, polarity: 'neutral',
    relationKind: 'causal', contested: false,
    label: '', labelSource: 'generated'
  }]);
});

test('bounds aliases and ignores hostile alias accessors and invalid classes', () => {
  const { createMechanismEvidenceMatrix } = require(modulePath);
  const aliases = Object.create(null);
  Object.defineProperty(aliases, 'figure-2:C', {
    enumerable: true,
    get() { throw new Error('alias getter must not run'); }
  });
  const chain = {
    nodes: [
      { id: 'a', label: { value: 'A' } },
      { id: 'b', label: { value: 'B' } }
    ],
    edges: [{
      id: 'a-b', from: 'a', to: 'b', panelEvidence: [{
        figureId: 'figure-2', panelId: 'C', value: '2C',
        evidenceClass: 'sufficiency<script>'
      }]
    }],
    panelAliases: aliases
  };
  const evidence = createMechanismEvidenceMatrix(chain).cells
    .find(cell => cell.evidence.length).evidence[0];
  assert.equal(evidence.displayName, '2C');
  assert.equal(evidence.evidenceClass, 'other');

  chain.panelAliases = {
    'figure-2:C': { value: ` ${'x'.repeat(100)} ` }
  };
  const bounded = createMechanismEvidenceMatrix(chain).cells
    .find(cell => cell.evidence.length).evidence[0];
  assert.equal(bounded.displayName.length, 80);
});

test('finds stable strongly connected components without mutating input', () => {
  assert.equal(fs.existsSync(modulePath), true,
    'core/mechanism-network.js must exist');
  const { findMechanismStrongComponents } = require(modulePath);
  const chain = {
    nodes: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: { value: id } })),
    edges: [
      { id: 'ab', from: 'a', to: 'b', polarity: 'neutral' },
      { id: 'bc', from: 'b', to: 'c', polarity: 'neutral' },
      { id: 'cb', from: 'c', to: 'b', polarity: 'positive' },
      { id: 'cd', from: 'c', to: 'd', polarity: 'neutral' },
      { id: 'ed', from: 'e', to: 'd', polarity: 'neutral' }
    ]
  };
  const before = JSON.stringify(chain);
  assert.deepEqual(findMechanismStrongComponents(chain), [
    ['a'], ['b', 'c'], ['d'], ['e']
  ]);
  assert.equal(JSON.stringify(chain), before);
});

test('focus set includes selected node ancestors and descendants only', () => {
  assert.equal(fs.existsSync(modulePath), true,
    'core/mechanism-network.js must exist');
  const { mechanismNetworkFocusSet } = require(modulePath);
  const chain = {
    nodes: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: { value: id } })),
    edges: [
      { id: 'ab', from: 'a', to: 'b', polarity: 'neutral' },
      { id: 'bc', from: 'b', to: 'c', polarity: 'neutral' },
      { id: 'cb', from: 'c', to: 'b', polarity: 'positive' },
      { id: 'cd', from: 'c', to: 'd', polarity: 'neutral' },
      { id: 'ed', from: 'e', to: 'd', polarity: 'neutral' }
    ]
  };
  const focused = mechanismNetworkFocusSet(chain, { nodeId: 'c' });
  assert.deepEqual([...focused.nodeIds].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual([...focused.edgeIds].sort(), ['ab', 'bc', 'cb', 'cd']);
});

test('lays out branches staged merges cycles and feedback deterministically', () => {
  const { createMechanismNetworkLayout } = require(modulePath);
  assert.equal(typeof createMechanismNetworkLayout, 'function');
  const graph = complexMechanismFixture();
  const first = createMechanismNetworkLayout(graph, { viewportWidth: 680 });
  const second = createMechanismNetworkLayout(structuredClone(graph), {
    viewportWidth: 680
  });
  assert.deepEqual(second, first);
  const byId = new Map(first.nodes.map(node => [node.id, node]));
  assert.ok(byId.get('source').y < byId.get('branch-a').y);
  assert.ok(byId.get('branch-a').y < byId.get('merge-ab').y);
  assert.ok(byId.get('merge-ab').y < byId.get('outcome').y);
  const negative = first.edges.find(edge => edge.id === 'negative-feedback');
  const positive = first.edges.find(edge => edge.id === 'positive-feedback');
  const self = first.edges.find(edge => edge.id === 'self-positive');
  assert.equal(negative.feedback, true);
  assert.equal(positive.feedback, true);
  assert.equal(self.selfLoop, true);
  assert.match(negative.path, /^M /u);
  assert.match(positive.path, /^M /u);
  assert.match(self.path, /^M /u);
});

test('produces bounded finite paths and target boundary endpoints at narrow width', () => {
  const { createMechanismNetworkLayout } = require(modulePath);
  const layout = createMechanismNetworkLayout(complexMechanismFixture(), {
    viewportWidth: 360
  });
  const nodes = new Map(layout.nodes.map(node => [node.id, node]));
  assert.ok(layout.width >= 320);
  assert.ok(layout.height > 0 && layout.height < 6000);
  layout.edges.forEach(edge => {
    assert.equal(edge.path.includes('NaN'), false);
    assert.equal(edge.hitPath, edge.path);
    assert.ok(Number.isFinite(edge.labelX));
    assert.ok(Number.isFinite(edge.labelY));
    assert.ok(edge.labelX >= 0 && edge.labelX <= layout.width);
    assert.ok(edge.labelY >= 0 && edge.labelY <= layout.height);
    const target = nodes.get(edge.to);
    assert.ok(target);
    assert.equal(Number.isFinite(edge.endX), true);
    assert.equal(Number.isFinite(edge.endY), true);
    if (!edge.selfLoop) {
      const onHorizontalBoundary = edge.endX === target.x ||
        edge.endX === target.x + target.width;
      const onVerticalBoundary = edge.endY === target.y ||
        edge.endY === target.y + target.height;
      assert.equal(onHorizontalBoundary || onVerticalBoundary, true);
    }
  });
});

test('64 node 64 edge layout is bounded and cached by revision width and measurements', () => {
  const {
    createMechanismLayoutCache,
    createMechanismNetworkLayout
  } = require(modulePath);
  assert.equal(typeof createMechanismLayoutCache, 'function');
  const graph = maximumMechanismFixture();
  let calls = 0;
  const cache = createMechanismLayoutCache(input => {
    calls += 1;
    return createMechanismNetworkLayout(input.chain, input.options);
  });
  const input = {
    chain: graph,
    revision: 8,
    options: { viewportWidth: 420, nodeSizes: new Map() }
  };
  const first = cache.get(input);
  const second = cache.get({
    ...input,
    chain: structuredClone(graph),
    options: { viewportWidth: 420, nodeSizes: new Map() }
  });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  assert.ok(first.width >= 320 && first.width < 20000);
  assert.ok(first.height >= 160 && first.height < 20000);
  assert.equal(first.edges.every(edge => !edge.path.includes('NaN')), true);

  cache.get({ ...input, revision: 9 });
  assert.equal(calls, 2);
  for (let revision = 10; revision < 30; revision += 1) {
    cache.get({ ...input, revision });
  }
  assert.ok(cache.size() <= 12);
});

test('edge accessible name contains endpoints polarity and evidence count', () => {
  const { mechanismEdgeAccessibleName } = require(modulePath);
  assert.equal(typeof mechanismEdgeAccessibleName, 'function');
  assert.equal(mechanismEdgeAccessibleName({
    fromLabel: '结果', toLabel: '上游', polarity: 'negative', evidenceCount: 2
  }), '从“结果”到“上游”的负反馈，2 项 Panel 证据');
  assert.equal(mechanismEdgeAccessibleName({
    fromLabel: 'A', toLabel: 'B', polarity: 'positive', evidenceCount: 0
  }), '从“A”到“B”的正反馈，0 项 Panel 证据');
  assert.equal(mechanismEdgeAccessibleName({
    fromLabel: 'STAT3', toLabel: 'Outcome', polarity: 'negative', evidenceCount: 2,
    contested: true
  }, { language: 'en' }),
  'Contested negative relation from “STAT3” to “Outcome”, 2 Panel evidence items');
  assert.equal(mechanismEdgeAccessibleName({
    fromLabel: 'STAT3', toLabel: '表型', polarity: 'negative', evidenceCount: 1,
    contested: true
  }, { language: 'zh-CN' }), '有争议：从“STAT3”到“表型”的负反馈，1 项 Panel 证据');
});

test('measurement frame scheduler coalesces resize bursts and runs the latest work', () => {
  const { createMechanismFrameScheduler } = require(modulePath);
  assert.equal(typeof createMechanismFrameScheduler, 'function');
  const frames = [];
  const calls = [];
  const scheduler = createMechanismFrameScheduler(callback => {
    frames.push(callback);
    return frames.length;
  });
  for (let index = 0; index < 50; index += 1) {
    scheduler.request(() => calls.push(index));
  }
  assert.equal(frames.length, 1);
  frames[0]();
  assert.deepEqual(calls, [49]);
  scheduler.request(() => calls.push(50));
  assert.equal(frames.length, 2);
  frames[1]();
  assert.deepEqual(calls, [49, 50]);
});

test('SVG export contains vector nodes arrowheads feedback styles and no controls', () => {
  const {
    createMechanismNetworkLayout,
    serializeMechanismNetworkSvg
  } = require(modulePath);
  const chain = complexMechanismFixture();
  chain.edges.find(edge => edge.id === 'negative-feedback').panelEvidence = [{
    figureId: 'figure-2', panelId: 'A', value: '2A', evidenceClass: 'necessity',
    evidenceClassSource: 'manual', humanReviewed: true, editedAt: 123
  }];
  const layout = createMechanismNetworkLayout(chain, { viewportWidth: 900 });
  const svg = serializeMechanismNetworkSvg({
    chain, layout, title: 'Paper <mechanism> & evidence'
  });
  assert.match(svg, /<marker[^>]+id="mechanism-arrow"/u);
  assert.match(svg, /marker-end="url\(#mechanism-arrow-negative\)"/u);
  assert.match(svg, /stroke-dasharray="7 5"/u);
  assert.match(svg, />负反馈</u);
  assert.doesNotMatch(svg, />2A</u);
  assert.doesNotMatch(svg, /class="evidence/u);
  assert.match(svg, /Paper &lt;mechanism&gt; &amp; evidence/u);
  assert.doesNotMatch(svg, /<select|<textarea|删除|新增/u);
});

test('JSON round-trip preserves topology reviewed fields and bounded layout preferences', () => {
  const {
    createMechanismNetworkJson,
    parseMechanismNetworkJson
  } = require(modulePath);
  const chain = complexMechanismFixture();
  chain.nodes[0].label = {
    value: 'Source', humanReviewed: true, editedAt: 123
  };
  chain.edges[0].panelEvidence = [{
    figureId: 'figure-1', panelId: 'A', value: '1A', evidenceClass: 'sufficiency',
    evidenceClassSource: 'manual', humanReviewed: true, editedAt: 456
  }];
  chain.panelAliases = {
    'figure-1:A': { value: 'reader rescue', humanReviewed: true, editedAt: 457 }
  };
  chain.reviewTombstones = {
    nodes: [{ id: 'deleted-node', editedAt: 458 }],
    edges: [{
      id: 'deleted-edge', from: 'source', to: 'outcome', editedAt: 459
    }],
    evidence: [{
      edgeId: 'source-a', from: 'source', to: 'branch-a',
      figureId: 'figure-1', panelId: 'B', editedAt: 460
    }]
  };
  chain.layoutPreferences = {
    pinnedRanks: { source: 0, outcome: 4 },
    siblingOrder: { 'branch-a': 0, 'branch-b': 1, 'branch-c': 2 },
    collapsedGroups: ['cycle-scc']
  };
  const canonicalChain = canonicalWorkspaceChain(chain);
  const payload = createMechanismNetworkJson({
    chain: canonicalChain,
    paper: validPaperIdentity(),
    exportedAt: '2026-08-13T00:00:00.000Z'
  });
  const text = JSON.stringify(payload);
  assert.doesNotMatch(text, /apiKey|authorization|data:image|provider/iu);
  const parsed = parseMechanismNetworkJson(text, validPaperIdentity());
  assert.deepEqual(parsed.mechanismChain, payload.mechanismChain);
  assert.deepEqual(parsed.paper, payload.paper);
  assert.equal(parsed.mechanismChain.edges[0].panelEvidence[0].evidenceClassSource,
    'manual');
  assert.deepEqual(parsed.mechanismChain.panelAliases['figure-1:A'], {
    value: 'reader rescue', humanReviewed: true, editedAt: 457
  });
  assert.deepEqual(parsed.mechanismChain.reviewTombstones,
    canonicalChain.reviewTombstones);
});

test('mechanism workspace v2 exports exact private-safe identity and preserves durable envelope bytes', () => {
  const {
    createMechanismNetworkJson,
    parseMechanismNetworkJson,
    MECHANISM_NETWORK_EXPORT_VERSION
  } = require(modulePath);
  const durable = durableMechanismWorkspaceFixture();
  const mechanismGeneration = durable.mechanismGeneration;
  const payload = createMechanismNetworkJson({
    chain: durable.chain,
    paper: validPaperIdentity(),
    mechanismGeneration,
    exportedAt: '2026-09-04T00:00:00.000Z'
  });

  assert.equal(MECHANISM_NETWORK_EXPORT_VERSION, 2);
  assert.deepEqual(Object.keys(payload), [
    'schema', 'schemaVersion', 'exportedAt', 'paper',
    'mechanismChain', 'mechanismGeneration'
  ]);
  assert.deepEqual(Object.keys(payload.paper), [
    'workspaceId', 'workspaceGeneration', 'contentHash', 'documentId', 'title'
  ]);
  assert.equal(Object.hasOwn(payload.paper, 'canonicalUrl'), false);
  assert.equal(payload.mechanismGeneration, mechanismGeneration);
  const text = JSON.stringify(payload);
  assert.doesNotMatch(text, /https:\/\/example\.test|canonicalUrl|authorization|apiKey/iu);

  const parsed = parseMechanismNetworkJson(text, validPaperIdentity());
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.mechanismGeneration, mechanismGeneration);
  assert.deepEqual(parsed.mechanismChain, payload.mechanismChain);

  const validEnvelope = JSON.parse(mechanismGeneration);
  const tamperCases = [
    value => { value.updatedAt += 1; },
    value => { value.preview.nodes[0].label = 'Tampered source'; },
    value => {
      value.projectionDigest = `mechanism-envelope-v1-${'0'.repeat(64)}`;
    },
    value => {
      value.chainProjectionDigest = `mechanism-envelope-v1-${'0'.repeat(64)}`;
    }
  ];
  for (const tamper of tamperCases) {
    const envelope = structuredClone(validEnvelope);
    tamper(envelope);
    const serialized = JSON.stringify(envelope);
    assert.throws(() => createMechanismNetworkJson({
      chain: durable.chain, paper: validPaperIdentity(),
      mechanismGeneration: serialized
    }), error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID');
    const malformed = structuredClone(payload);
    malformed.mechanismGeneration = serialized;
    assert.throws(() => parseMechanismNetworkJson(malformed, validPaperIdentity()),
      error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID');
  }

  const invalidDigests = [
    `mechanism-envelope-v1-${'a'.repeat(63)}-`,
    `${validEnvelope.projectionDigest}00000000`,
    `mechanism-envelope-v1-${'a'.repeat(73)}`
  ];
  for (const projectionDigest of invalidDigests) {
    const malformedDigest = structuredClone(validEnvelope);
    malformedDigest.projectionDigest = projectionDigest;
    assert.throws(() => createMechanismNetworkJson({
      chain: durable.chain, paper: validPaperIdentity(),
      mechanismGeneration: JSON.stringify(malformedDigest)
    }), error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID');
  }

  const nodeOnly = {
    initialized: true,
    nodes: [{ id: 'only', label: {
      value: 'Only node', humanReviewed: true, editedAt: 1
    } }],
    edges: [], panelAliases: {},
    reviewTombstones: { nodes: [], edges: [], evidence: [] }
  };
  const withoutAudit = createMechanismNetworkJson({
    chain: nodeOnly,
    paper: validPaperIdentity(), mechanismGeneration: null
  });
  assert.equal(withoutAudit.mechanismGeneration, null);
  assert.deepEqual(withoutAudit.mechanismChain, nodeOnly);

  const emptyBase = {
    nodes: [], edges: [], panelAliases: {},
    reviewTombstones: { nodes: [], edges: [], evidence: [] }
  };
  for (const chain of [emptyBase, { initialized: true, ...emptyBase }]) {
    const emptyPayload = createMechanismNetworkJson({
      chain, paper: validPaperIdentity(), mechanismGeneration: null
    });
    const emptyParsed = parseMechanismNetworkJson(
      JSON.stringify(emptyPayload), validPaperIdentity()
    );
    assert.deepEqual(emptyParsed.mechanismChain, chain);
    assert.equal(FigureWorkspace.validateMechanismWorkspaceImport(
      FigureWorkspace.createFigureWorkspaceDraft([]),
      emptyParsed.mechanismChain,
      emptyParsed.mechanismGeneration
    ), true);
  }
});

test('mechanism workspace v2 rejects every silently normalized chain shape', () => {
  const { createMechanismNetworkJson, parseMechanismNetworkJson } = require(modulePath);
  const paper = validPaperIdentity();
  const baseChain = canonicalWorkspaceChain({
    nodes: [
      { id: 'source', label: { value: 'Source', humanReviewed: true, editedAt: 1 } },
      { id: 'target', label: { value: 'Target', humanReviewed: true, editedAt: 1 } }
    ],
    edges: [{
      id: 'edge', from: 'source', to: 'target', polarity: 'neutral',
      label: { value: '', humanReviewed: true, editedAt: 1 },
      panelEvidence: [{
        figureId: 'figure-2', panelId: 'A', value: '2A', unresolved: false,
        humanReviewed: true, editedAt: 1
      }], humanReviewed: true, editedAt: 1
    }],
    panelAliases: {
      'figure-2:A': { value: 'Alias', humanReviewed: true, editedAt: 1 }
    },
    layoutPreferences: {
      pinnedRanks: { source: 0 }, siblingOrder: {}, collapsedGroups: []
    }
  });
  const valid = createMechanismNetworkJson({ chain: baseChain, paper });
  assert.deepEqual(valid.mechanismChain.layoutPreferences,
    baseChain.layoutPreferences);
  const cases = [
    value => { delete value.panelAliases; },
    value => { delete value.reviewTombstones; },
    value => { value.initialized = false; },
    value => { value.nodes[0].label = 'Source'; },
    value => { value.nodes[0].label.value = ' Source '; },
    value => {
      const id = `n${'x'.repeat(80)}`;
      value.nodes[0].id = id;
      value.edges[0].from = id;
    },
    value => { value.nodes[0].label.editedAt = 4102444800001; },
    value => { value.edges[0].panelEvidence[0].editedAt = 4102444800001; },
    value => { value.edges[0].panelEvidence[0].figureId = 'f'.repeat(161); },
    value => {
      value.panelAliases['figure-2:a'] = value.panelAliases['figure-2:A'];
      delete value.panelAliases['figure-2:A'];
    },
    value => {
      value.layoutPreferences = {
        pinnedRanks: {}, siblingOrder: {}, collapsedGroups: []
      };
    },
    value => { value.generationIssues = []; },
    value => {
      value.generationIssues = [{
        code: '', message: 'Issue', edgeIndex: 0,
        edgeId: 'edge', displayId: 'figure-2:A'
      }];
    },
    value => {
      value.generationIssues = [{
        code: 'missing_panel', message: '', edgeIndex: 0,
        edgeId: 'edge', displayId: 'figure-2:A'
      }];
    }
  ];
  for (const mutate of cases) {
    const chain = structuredClone(baseChain);
    mutate(chain);
    assert.throws(() => createMechanismNetworkJson({ chain, paper }),
      error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID');
    const payload = structuredClone(valid);
    payload.mechanismChain = chain;
    assert.throws(() => parseMechanismNetworkJson(payload, paper),
      error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID');
  }

});

test('mechanism workspace v2 preserves canonical 4000-code-point scientific text and unresolved evidence', () => {
  const { createMechanismNetworkJson, parseMechanismNetworkJson } = require(modulePath);
  const suffix = ' DOI doi:10.1000/password-study';
  const text = `${'α'.repeat(4000 - Array.from(suffix).length)}${suffix}`;
  assert.equal(Array.from(text).length, 4000);
  const chain = {
    initialized: true,
    nodes: [
      { id: 'source', label: { value: text, humanReviewed: true, editedAt: 1 } },
      { id: 'target', label: { value: 'Target', humanReviewed: true, editedAt: 1 } }
    ],
    edges: [{
      id: 'edge', from: 'source', to: 'target', polarity: 'neutral',
      label: { value: '', humanReviewed: true, editedAt: 1 },
      panelEvidence: [{
        figureId: '', panelId: '', value: 'Unresolved DOI panel', unresolved: true,
        humanReviewed: true, editedAt: 2
      }], humanReviewed: true, editedAt: 2
    }],
    panelAliases: {
      'figure-2:A': { value: text, humanReviewed: true, editedAt: 3 }
    },
    reviewTombstones: { nodes: [], edges: [], evidence: [] }
  };
  const payload = createMechanismNetworkJson({ chain, paper: validPaperIdentity() });
  const parsed = parseMechanismNetworkJson(
    JSON.stringify(payload), validPaperIdentity()
  );
  assert.equal(parsed.mechanismChain.nodes[0].label.value, text);
  assert.equal(parsed.mechanismChain.panelAliases['figure-2:A'].value, text);
  assert.deepEqual(parsed.mechanismChain.edges[0].panelEvidence[0],
    chain.edges[0].panelEvidence[0]);

  const draft = FigureWorkspace.createFigureWorkspaceDraft([{
    figureId: 'figure-2', figureLabel: 'Figure 2', panelHints: ['A']
  }]);
  assert.equal(FigureWorkspace.validateMechanismWorkspaceImport(
    draft, parsed.mechanismChain, parsed.mechanismGeneration
  ), true);
  const restored = FigureWorkspace.applyFigureWorkspaceMutation(draft, {
    type: 'import_mechanism_workspace', expectedRevision: draft.revision,
    chain: parsed.mechanismChain,
    mechanismGeneration: parsed.mechanismGeneration
  }, 10);
  assert.equal(restored.mechanismChain.nodes[0].label.value, text);
  assert.equal(restored.mechanismChain.panelAliases['figure-2:A'].value, text);

  const validPayload = structuredClone(payload);
  for (const unsafeText of [
    'HTTPS DOI https://doi.org/10.1000/example',
    'opaque file:C:/private/paper.pdf',
    'Authorization: Bearer secret-value',
    'password hunter2'
  ]) {
    const unsafeChain = structuredClone(chain);
    unsafeChain.nodes[0].label.value = unsafeText;
    assert.throws(() => createMechanismNetworkJson({
      chain: unsafeChain, paper: validPaperIdentity()
    }), error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID');
    const unsafePayload = structuredClone(validPayload);
    unsafePayload.mechanismChain.nodes[0].label.value = unsafeText;
    assert.throws(() => parseMechanismNetworkJson(
      unsafePayload, validPaperIdentity()
    ), error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID');
  }
});

test('mechanism workspace v2 documentId is optional in file but authoritative when declared', () => {
  const { createMechanismNetworkJson, parseMechanismNetworkJson } = require(modulePath);
  const current = validPaperIdentity();
  const withoutDocument = { ...current };
  delete withoutDocument.documentId;
  const omitted = createMechanismNetworkJson({
    chain: canonicalWorkspaceChain(), paper: withoutDocument
  });
  assert.doesNotThrow(() => parseMechanismNetworkJson(omitted, current));

  const declared = createMechanismNetworkJson({
    chain: canonicalWorkspaceChain(), paper: current
  });
  assert.doesNotThrow(() => parseMechanismNetworkJson(declared, current));
  assert.throws(() => parseMechanismNetworkJson(declared, withoutDocument),
    error => error?.code === 'MECHANISM_NETWORK_IMPORT_PAPER_MISMATCH');
  assert.throws(() => parseMechanismNetworkJson(declared, {
    ...current, documentId: `sha256:${'d'.repeat(64)}`
  }), error => error?.code === 'MECHANISM_NETWORK_IMPORT_PAPER_MISMATCH');
});

test('mechanism workspace v2 preserves canonical long issue display IDs only on initialized chains', () => {
  const { createMechanismNetworkJson, parseMechanismNetworkJson } = require(modulePath);
  const paper = validPaperIdentity();
  const figureId = `f${'x'.repeat(159)}`;
  const displayIds = [
    `${figureId}:A`,
    `${figureId}:A${'X'.repeat(31)}`
  ];
  assert.deepEqual(displayIds.map(value => value.length), [162, 193]);
  for (const displayId of displayIds) {
    const chain = {
      initialized: true, nodes: [], edges: [], panelAliases: {},
      reviewTombstones: { nodes: [], edges: [], evidence: [] },
      generationIssues: [{
        code: 'missing_panel', message: 'Panel requires review', edgeIndex: -1,
        edgeId: 'missing-edge', displayId
      }]
    };
    const payload = createMechanismNetworkJson({ chain, paper });
    const parsed = parseMechanismNetworkJson(JSON.stringify(payload), paper);
    assert.equal(parsed.mechanismChain.generationIssues[0].displayId, displayId);
    assert.equal(FigureWorkspace.validateMechanismWorkspaceImport(
      FigureWorkspace.createFigureWorkspaceDraft([]),
      parsed.mechanismChain, null
    ), true);
  }

  const uninitialized = {
    nodes: [], edges: [], panelAliases: {},
    reviewTombstones: { nodes: [], edges: [], evidence: [] },
    generationIssues: [{
      code: 'missing_panel', message: 'Panel requires review', edgeIndex: -1,
      edgeId: 'missing-edge', displayId: 'figure-2:A'
    }]
  };
  for (const chain of [uninitialized, { initialized: false, ...uninitialized }]) {
    assert.throws(() => createMechanismNetworkJson({ chain, paper }),
      error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID');
  }

  const overlong = {
    initialized: true, nodes: [], edges: [], panelAliases: {},
    reviewTombstones: { nodes: [], edges: [], evidence: [] },
    generationIssues: [{
      code: 'missing_panel', message: 'Panel requires review', edgeIndex: -1,
      edgeId: 'missing-edge', displayId: `${figureId}:A${'X'.repeat(32)}`
    }]
  };
  assert.throws(() => createMechanismNetworkJson({ chain: overlong, paper }),
    error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID');
});

test('mechanism-network v1 remains chain-only while future and noncanonical envelopes fail closed', () => {
  const { parseMechanismNetworkJson, createMechanismNetworkJson } = require(modulePath);
  const paper = validPaperIdentity();
  const chain = {
    nodes: [{ id: 'a', label: { value: 'A', humanReviewed: true, editedAt: 1 } }],
    edges: []
  };
  const legacy = {
    schema: 'brevess.mechanism-network', schemaVersion: 1,
    exportedAt: '2026-08-13T00:00:00.000Z',
    paper, mechanismChain: chain
  };
  const parsedLegacy = parseMechanismNetworkJson(JSON.stringify(legacy), paper);
  assert.equal(parsedLegacy.schemaVersion, 1);
  assert.equal(parsedLegacy.mechanismGeneration, null);
  assert.deepEqual(parsedLegacy.mechanismChain.nodes.map(node => node.id), ['a']);
  assert.throws(() => parseMechanismNetworkJson(JSON.stringify(legacy), {
    ...paper, canonicalUrl: 'https://example.test/another-paper'
  }), error => error?.code === 'MECHANISM_NETWORK_IMPORT_PAPER_MISMATCH');

  for (const schemaVersion of [0, 3, 999]) {
    assert.throws(() => parseMechanismNetworkJson(JSON.stringify({
      ...legacy, schemaVersion
    }), paper), error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID');
  }
  for (const mechanismGeneration of [
    JSON.stringify({ schemaVersion: 1, envelopeKind: 'durable', status: 'complete' }),
    '{"envelopeKind":"durable", "schemaVersion":1,"status":"complete"}',
    JSON.stringify({ schemaVersion: 1, envelopeKind: 'candidate', status: 'complete' }),
    '{}', 17, undefined
  ]) {
    assert.throws(() => createMechanismNetworkJson({
      chain, paper, mechanismGeneration
    }), error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID');
  }
});

test('PNG plan rejects unsafe dimensions before canvas allocation', () => {
  const { createMechanismNetworkPngPlan } = require(modulePath);
  assert.deepEqual(createMechanismNetworkPngPlan(
    { width: 800, height: 600 }, { scale: 2 }
  ), { scale: 2, width: 1600, height: 1200, pixels: 1920000 });
  assert.throws(
    () => createMechanismNetworkPngPlan(
      { width: 20000, height: 20000 }, { scale: 2 }
    ),
    error => error?.code === 'MECHANISM_NETWORK_PNG_TOO_LARGE'
  );
});

test('hostile mechanism import is descriptor-only private and paper-bound', () => {
  const { createMechanismNetworkJson, parseMechanismNetworkJson } = require(modulePath);
  const payload = createMechanismNetworkJson({
    chain: canonicalWorkspaceChain(), paper: validPaperIdentity(),
    exportedAt: '2026-08-13T00:00:00.000Z'
  });
  let getterReads = 0;
  const hostile = structuredClone(payload);
  Object.defineProperty(hostile.mechanismChain.nodes[0], 'apiKey', {
    enumerable: true,
    get() { getterReads += 1; return 'secret'; }
  });
  assert.throws(
    () => parseMechanismNetworkJson(hostile, validPaperIdentity()),
    error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID'
  );
  assert.equal(getterReads, 0);

  const revokedRoot = Proxy.revocable({}, {});
  revokedRoot.revoke();
  assert.throws(
    () => parseMechanismNetworkJson(revokedRoot.proxy, validPaperIdentity()),
    error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID'
  );

  const revokedNodes = Proxy.revocable([], {});
  revokedNodes.revoke();
  const hostileArray = structuredClone(payload);
  hostileArray.mechanismChain.nodes = revokedNodes.proxy;
  assert.throws(
    () => parseMechanismNetworkJson(hostileArray, validPaperIdentity()),
    error => error?.code === 'MECHANISM_NETWORK_IMPORT_INVALID'
  );

  assert.throws(
    () => parseMechanismNetworkJson(JSON.stringify(payload), {
      ...validPaperIdentity(), contentHash: 'd'.repeat(64)
    }),
    error => error?.code === 'MECHANISM_NETWORK_IMPORT_PAPER_MISMATCH'
  );
});
