const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESEARCH_LOGIC_MAP_KIND,
  RESEARCH_LOGIC_MAP_SCHEMA_VERSION,
  RESEARCH_LOGIC_MAP_INDEX_PATH,
  createResearchLogicMapFromFigures,
  createBlankResearchLogicMap,
  normalizeResearchLogicMap,
  normalizeEvidenceLocator,
  updateScientificQuestion,
  updateFinalConclusion,
  upsertResearchLogicMapIndex,
  buildResearchLogicMapSvg
} = require('../core/research-logic-map');

function v3Fixture(overrides = {}) {
  const base = {
    schemaVersion: 3,
    kind: RESEARCH_LOGIC_MAP_KIND,
    mapId: 'logic-map-v3',
    origin: 'manual',
    workspaceId: 'workspace-1',
    meta: {
      title: 'Research logic map',
      backgroundItems: [{ itemId: 'background-1', text: 'Known background' }],
      scientificQuestions: [{ questionId: 'question-1', text: 'Core question' }],
      finalConclusions: [{
        conclusionId: 'conclusion-1',
        text: 'Final conclusion',
        questionIds: ['question-1']
      }],
      mechanismEdges: []
    },
    steps: [{
      stepId: 'step-1',
      figureId: 'figure-1',
      figureLabel: 'Figure 1',
      questionItems: [{ itemId: 'step-1-question-1', text: 'Figure question' }],
      proofItems: [{ itemId: 'step-1-proof-1', text: 'Figure proof' }],
      evidenceGroups: [{
        groupId: 'group-1',
        title: 'Main evidence',
        method: 'Imaging',
        groupConclusion: 'Supports the proof',
        limitation: '',
        evidencePoints: [{
          pointId: 'group-1-point-1',
          locator: { kind: 'panels', values: ['A'] },
          observation: 'Signal increases',
          argumentRole: 'support',
          limitation: '',
          sourceRefs: [{ kind: 'panel', figureId: 'figure-1', panelId: 'A' }]
        }]
      }]
    }],
    supplementalMaterials: [],
    view: {
      zoom: 1,
      editorCollapsed: false,
      collapsedStepIds: [],
      collapsedSupplementalIds: []
    }
  };
  return {
    ...base,
    ...overrides,
    meta: { ...base.meta, ...(overrides.meta || {}) },
    view: { ...base.view, ...(overrides.view || {}) },
    steps: overrides.steps || base.steps,
    supplementalMaterials: overrides.supplementalMaterials || base.supplementalMaterials
  };
}

function figureWorkspace() {
  return {
    figures: [
      {
        figureId: 'figure-1',
        figureLabel: 'Figure 1',
        figureInputHash: 'hash-1',
        activeDepth: 'deep',
        deep: {
          figureQuestion: 'Does neural signaling precede tissue ageing?',
          coreConclusion: 'Neural transmitter signaling rises with age.',
          claimBoundary: 'The first Figure establishes association only.',
          panels: [
            { panel: 'A', methodCategory: 'Imaging', localInference: 'Signal rises.' },
            { panel: 'B', methodCategory: 'Quantification', localInference: 'The rise is age-dependent.' }
          ],
          panelGroups: [{
            panels: ['A', 'B'],
            groupGoal: 'Define the age-related change',
            groupConclusion: 'Signal rises consistently with age.'
          }],
          argumentChain: [{
            panels: ['A', 'B'],
            established: 'An age-related change exists.',
            handoff: 'Is the signal causal?',
            evidenceLevel: 'association'
          }]
        }
      },
      {
        figureId: 'figure-2',
        figureLabel: 'Figure 2',
        activeDepth: 'standard',
        standard: {
          figureQuestion: 'Does the signal drive ageing?',
          coreConclusion: 'Blocking the signal reduces ageing.',
          panels: [{
            panel: 'C',
            methodCategory: 'Intervention',
            localInference: 'The phenotype declines after blockade.'
          }],
          argumentChain: [{
            panels: ['C'],
            established: 'Intervention changes the phenotype.',
            handoff: 'Which downstream pathway mediates the effect?',
            evidenceLevel: 'causal'
          }]
        }
      },
      {
        figureId: 'supplementary-figure-1',
        figureLabel: 'Supplementary Figure 1',
        isSupplemental: true,
        standard: {
          figureQuestion: 'Quality control',
          coreConclusion: 'Quality control passes.',
          panels: [{ panel: 'A', localInference: 'Technical bias is excluded.' }]
        }
      }
    ],
    crossFigureLogic: {
      result: {
        backgroundItems: ['Neural signaling is implicated in tissue homeostasis.'],
        overallThesis: 'Neural signaling drives tissue ageing through a downstream pathway.',
        mechanismEdges: [
          { from: 'neural-signal', to: 'downstream-pathway', supportPanels: ['1A'] },
          { from: 'downstream-pathway', to: 'ageing', relation: 'inhibits', strength: 'strong' }
        ],
        claimBoundary: 'The mechanism has not been validated in humans.',
        nodes: [
          {
            figureId: 'figure-1',
            role: 'phenomenon',
            established: 'Age-related neural signaling rises.',
            transition: 'Does the signal drive ageing?',
            evidenceLevel: 'association'
          },
          {
            figureId: 'figure-2',
            role: 'causal_test',
            established: 'Blocking the signal reduces ageing.',
            transition: 'Which downstream pathway mediates the effect?',
            evidenceLevel: 'causal'
          }
        ],
        dominoChain: [{
          fromFigureId: 'figure-1',
          toFigureId: 'figure-2',
          transition: 'Does the signal drive ageing?',
          evidenceBoundary: 'Figure 1 supports association only.'
        }],
        supplementalSupport: [{
          mainFigureId: 'figure-2',
          supplementalFigureId: 'supplementary-figure-1',
          supplementalFigureLabel: 'Supplementary Figure 1',
          supportRole: 'control'
        }]
      }
    }
  };
}

test('creates a schema v4 argument chain from analyzed Figures', () => {
  const map = createResearchLogicMapFromFigures({
    workspaceId: 'workspace-1',
    articleTitle: 'Example paper',
    canonicalUrl: 'https://example.test/paper',
    figureWorkspace: figureWorkspace(),
    now: '2026-07-30T12:00:00.000Z'
  });

  assert.equal(RESEARCH_LOGIC_MAP_SCHEMA_VERSION, 4);
  assert.equal(map.schemaVersion, 4);
  assert.equal(map.kind, RESEARCH_LOGIC_MAP_KIND);
  assert.equal(map.steps.length, 2);
  assert.deepEqual(map.steps[0].questionItems.map(item => item.text), [
    'Does neural signaling precede tissue ageing?'
  ]);
  assert.deepEqual(map.steps[0].proofItems.map(item => item.text), [
    'Age-related neural signaling rises.'
  ]);
  assert.equal('question' in map.steps[0], false);
  assert.equal('established' in map.steps[0], false);
  assert.equal('nextQuestion' in map.steps[0], false);
  assert.deepEqual(
    map.steps[0].evidenceGroups[0].evidencePoints.map(point => point.locator.values),
    [['A'], ['B']]
  );
  assert.deepEqual(
    map.steps[0].evidenceGroups[0].evidencePoints.map(
      point => point.sourceRefs[0].panelId
    ),
    ['A', 'B']
  );
  assert.deepEqual(map.meta.scientificQuestions.map(item => item.questionId), ['question-1']);
  assert.deepEqual(map.meta.backgroundItems.map(item => item.text), [
    'Neural signaling is implicated in tissue homeostasis.'
  ]);
  assert.deepEqual(map.meta.finalConclusions[0].questionIds, ['question-1']);
  assert.ok(Array.isArray(map.supplementalMaterials));
  assert.equal(map.view.mode, undefined);
});

test('migrates v2 strings into stable v4 bullets and merges the handoff question', () => {
  const migrated = normalizeResearchLogicMap({
    schemaVersion: 2,
    mapId: 'migration-map',
    meta: { overallThesis: 'Known biology', mechanismEdges: [] },
    steps: [
      {
        stepId: 'step-1',
        figureLabel: 'Figure 1',
        question: 'Q1',
        established: 'P1',
        nextQuestion: 'Q2',
        evidenceGroups: []
      },
      {
        stepId: 'step-2',
        figureLabel: 'Figure 2',
        question: '',
        established: 'P2',
        nextQuestion: 'Final synthesis',
        evidenceGroups: []
      }
    ]
  });

  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(migrated.meta.backgroundItems.map(item => item.text), ['Known biology']);
  assert.deepEqual(migrated.steps[0].questionItems.map(item => item.text), ['Q1']);
  assert.deepEqual(migrated.steps[1].questionItems.map(item => item.text), ['Q2']);
  assert.deepEqual(migrated.steps[1].proofItems.map(item => item.text), ['P2']);
  assert.equal('nextQuestion' in migrated.steps[0], false);
  assert.equal(
    migrated.steps[1].questionItems[0].itemId,
    normalizeResearchLogicMap(migrated).steps[1].questionItems[0].itemId
  );
  assert.deepEqual(migrated, normalizeResearchLogicMap(migrated));
});

test('migrates ambiguous legacy evidence without inventing panel-role pairings', () => {
  const map = normalizeResearchLogicMap({
    schemaVersion: 2,
    mapId: 'legacy-evidence',
    meta: {},
    steps: [{
      stepId: 'step-1',
      figureId: 'figure-1',
      figureLabel: 'Figure 1',
      question: 'Q',
      established: 'P',
      evidenceGroups: [{
        groupId: 'group-1',
        title: 'Legacy combined evidence',
        panels: ['A', 'B'],
        conclusion: 'Combined result',
        category: 'causal'
      }]
    }]
  });

  const points = map.steps[0].evidenceGroups[0].evidencePoints;
  assert.equal(points.length, 1);
  assert.equal(points[0].needsManualSplit, true);
  assert.deepEqual(points[0].locator, { kind: 'panels', values: ['A', 'B'] });
  assert.equal(points[0].observation, 'Combined result');
  assert.equal(points[0].argumentRole, 'causal');
});

test('normalizes missing and duplicate IDs deterministically and filters dangling conclusions', () => {
  const map = normalizeResearchLogicMap(v3Fixture({
    meta: {
      scientificQuestions: [
        { questionId: 'question-kept', text: 'Q1' },
        { text: 'Q2' },
        { questionId: 'question-kept', text: 'Q3' }
      ],
      finalConclusions: [
        {
          conclusionId: 'conclusion-kept',
          text: 'C1',
          questionIds: ['question-kept', 'missing', 'question-kept'],
          questionItemIds: ['must-never-be-used']
        },
        { conclusionId: 'conclusion-kept', text: 'C2', questionIds: [] }
      ]
    }
  }));

  assert.deepEqual(map.meta.scientificQuestions.map(item => item.questionId), [
    'question-kept', 'question-2', 'question-3'
  ]);
  assert.deepEqual(map.meta.finalConclusions.map(item => item.conclusionId), [
    'conclusion-kept', 'conclusion-2'
  ]);
  assert.deepEqual(map.meta.finalConclusions[0].questionIds, ['question-kept']);
  assert.doesNotMatch(JSON.stringify(map), /questionItemIds/);
  assert.deepEqual(map, normalizeResearchLogicMap(map));
});

test('migrates legacy scientific questions and preserves paper-level relationship fields', () => {
  const migrated = normalizeResearchLogicMap(v3Fixture({
    schemaVersion: 3,
    meta: {
      centralScientificQuestion: '',
      scientificQuestions: [
        { questionId: 'root', text: 'What phenomenon does the paper explain?' },
        {
          questionId: 'mechanism', text: 'What mechanism explains it?',
          relationType: 'progressive', parentQuestionIds: ['root'],
          supportingFigureIds: ['figure-2', 'figure-2']
        },
        {
          questionId: 'convergence', text: 'Where do the branches converge?',
          relationType: 'convergent', parentQuestionIds: ['root', 'mechanism', 'missing'],
          supportingFigureIds: ['figure-1', 'figure-2']
        }
      ]
    }
  }));

  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.meta.centralScientificQuestion,
    'What phenomenon does the paper explain?');
  assert.deepEqual(migrated.meta.scientificQuestions, [
    {
      questionId: 'root', text: 'What phenomenon does the paper explain?',
      relationType: 'root', parentQuestionIds: [], supportingFigureIds: [],
      manuallyEdited: false, manuallyEditedFields: [], humanReviewed: false
    },
    {
      questionId: 'mechanism', text: 'What mechanism explains it?',
      relationType: 'progressive', parentQuestionIds: ['root'],
      supportingFigureIds: ['figure-2'], manuallyEdited: false,
      manuallyEditedFields: [], humanReviewed: false
    },
    {
      questionId: 'convergence', text: 'Where do the branches converge?',
      relationType: 'convergent', parentQuestionIds: ['root', 'mechanism'],
      supportingFigureIds: ['figure-1', 'figure-2'], manuallyEdited: false,
      manuallyEditedFields: [], humanReviewed: false
    }
  ]);
  assert.deepEqual(migrated, normalizeResearchLogicMap(migrated));
});

test('creates map questions from the whole-paper synthesis instead of Figure 1', () => {
  const workspace = figureWorkspace();
  workspace.crossFigureLogic.result.centralScientificQuestion =
    'How does neural signaling causally organize tissue ageing across the study?';
  workspace.crossFigureLogic.result.scientificQuestions = [
    {
      questionId: 'root', text: 'Does a reproducible age-related signal exist?',
      relationType: 'root', parentQuestionIds: [], supportingFigureIds: ['figure-1']
    },
    {
      questionId: 'causality', text: 'Is that signal causally required?',
      relationType: 'validation', parentQuestionIds: ['root'],
      supportingFigureIds: ['figure-2']
    }
  ];
  const map = createResearchLogicMapFromFigures({
    workspaceId: 'workspace-1', figureWorkspace: workspace,
    now: '2026-07-30T12:00:00.000Z'
  });

  assert.equal(map.meta.centralScientificQuestion,
    workspace.crossFigureLogic.result.centralScientificQuestion);
  assert.deepEqual(map.meta.scientificQuestions.map(item => ({
    questionId: item.questionId,
    relationType: item.relationType,
    parentQuestionIds: item.parentQuestionIds,
    supportingFigureIds: item.supportingFigureIds
  })), workspace.crossFigureLogic.result.scientificQuestions.map(item => ({
    questionId: item.questionId,
    relationType: item.relationType,
    parentQuestionIds: item.parentQuestionIds,
    supportingFigureIds: item.supportingFigureIds
  })));
  assert.notEqual(map.meta.centralScientificQuestion,
    map.steps[0].questionItems[0].text);
});

test('normalizes locator boundaries without mixing locator shapes', () => {
  assert.deepEqual(normalizeEvidenceLocator({
    kind: 'panels',
    values: ['Panel A', 'B', 'A', ...Array.from({ length: 40 }, (_, index) => `P${index}`)]
  }), {
    kind: 'panels',
    values: ['A', 'B', ...Array.from({ length: 28 }, (_, index) => `P${index}`)]
  });
  assert.deepEqual(normalizeEvidenceLocator({
    kind: 'time-range', startSeconds: -5, endSeconds: -2
  }), { kind: 'time-range', startSeconds: 0, endSeconds: 0 });
  assert.deepEqual(normalizeEvidenceLocator({
    kind: 'time-range', startSeconds: 34, endSeconds: 12
  }), { kind: 'time-range', startSeconds: 34, endSeconds: 34 });
  const table = normalizeEvidenceLocator({ kind: 'table-range', value: 'x'.repeat(240) });
  assert.equal(table.kind, 'table-range');
  assert.equal(table.value.length, 160);
  assert.deepEqual(Object.keys(table), ['kind', 'value']);
});

test('normalizes mechanism effects and evidence strength for pathway rendering', () => {
  const map = normalizeResearchLogicMap(v3Fixture({
    meta: {
      mechanismEdges: [
        { sourceId: 'A', targetId: 'B', effect: 'promote', evidence: 'strong' },
        { from: 'B', to: 'C', relation: 'inhibits', strength: 'strong' },
        { from: 'C', to: 'D' }
      ]
    }
  }));
  assert.deepEqual(map.meta.mechanismEdges.map(edge => ({
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    effect: edge.effect,
    evidence: edge.evidence
  })), [
    { sourceId: 'A', targetId: 'B', effect: 'promote', evidence: 'strong' },
    { sourceId: 'B', targetId: 'C', effect: 'inhibit', evidence: 'strong' },
    { sourceId: 'C', targetId: 'D', effect: 'associate', evidence: 'weak' }
  ]);
  assert.equal(map.meta.mechanismEdges[0].from, undefined);
  assert.equal(map.meta.mechanismEdges[0].relation, undefined);
});

test('preserves manual-review metadata at module item group and point layers', () => {
  const map = normalizeResearchLogicMap(v3Fixture({
    manuallyEdited: true,
    manuallyEditedFields: ['meta'],
    humanReviewed: true,
    meta: {
      manuallyEdited: true,
      manuallyEditedFields: ['backgroundItems'],
      humanReviewed: true,
      backgroundItems: [{
        itemId: 'background-1',
        text: 'Reviewed background',
        manuallyEdited: true,
        manuallyEditedFields: ['text'],
        humanReviewed: true
      }]
    },
    steps: [{
      ...v3Fixture().steps[0],
      manuallyEdited: true,
      manuallyEditedFields: ['proofItems'],
      humanReviewed: true,
      evidenceGroups: [{
        ...v3Fixture().steps[0].evidenceGroups[0],
        manuallyEdited: true,
        manuallyEditedFields: ['evidencePoints'],
        humanReviewed: true,
        evidencePoints: [{
          ...v3Fixture().steps[0].evidenceGroups[0].evidencePoints[0],
          manuallyEdited: true,
          manuallyEditedFields: ['locator', 'observation'],
          humanReviewed: true
        }]
      }]
    }]
  }));

  assert.equal(map.manuallyEdited, true);
  assert.equal(map.meta.humanReviewed, true);
  assert.equal(map.meta.backgroundItems[0].manuallyEdited, true);
  assert.equal(map.steps[0].humanReviewed, true);
  assert.equal(map.steps[0].evidenceGroups[0].manuallyEdited, true);
  assert.deepEqual(
    map.steps[0].evidenceGroups[0].evidencePoints[0].manuallyEditedFields,
    ['locator', 'observation']
  );
});

test('scientific question and final conclusion updates are immutable and round-trip cleanly', () => {
  const original = normalizeResearchLogicMap(v3Fixture());
  const originalSnapshot = JSON.stringify(original);
  let updated = updateScientificQuestion(original, 'question-1', {
    text: 'Edited scientific question',
    relationType: 'validation',
    parentQuestionIds: [],
    supportingFigureIds: ['figure-1'],
    humanReviewed: true
  });
  updated = updateFinalConclusion(updated, 'conclusion-1', {
    text: 'Edited final conclusion',
    questionIds: ['question-1', 'dangling']
  });
  const roundTrip = normalizeResearchLogicMap(JSON.parse(JSON.stringify(updated)));

  assert.equal(JSON.stringify(original), originalSnapshot);
  assert.notEqual(updated, original);
  assert.equal(roundTrip.meta.scientificQuestions[0].text, 'Edited scientific question');
  assert.equal(roundTrip.meta.scientificQuestions[0].humanReviewed, true);
  assert.equal(roundTrip.meta.scientificQuestions[0].relationType, 'validation');
  assert.deepEqual(roundTrip.meta.scientificQuestions[0].supportingFigureIds, ['figure-1']);
  assert.deepEqual(roundTrip.meta.scientificQuestions[0].manuallyEditedFields, [
    'text', 'relationType', 'parentQuestionIds', 'supportingFigureIds'
  ]);
  assert.equal(roundTrip.meta.finalConclusions[0].text, 'Edited final conclusion');
  assert.deepEqual(roundTrip.meta.finalConclusions[0].questionIds, ['question-1']);
  assert.equal(roundTrip.meta.finalConclusions[0].manuallyEdited, true);
  assert.doesNotMatch(JSON.stringify(roundTrip), /questionItemIds/);
});

test('normalizes v3 view and top-level supplemental placeholders', () => {
  const map = normalizeResearchLogicMap(v3Fixture({
    supplementalMaterials: [{
      supplementalId: 'supplement-1',
      type: 'video',
      label: 'Video S1',
      manuallyEdited: true,
      manuallyEditedFields: ['label'],
      humanReviewed: true,
      unsafeFutureField: 'discard'
    }],
    view: {
      mode: 'evidence',
      zoom: 9,
      editorCollapsed: true,
      collapsedStepIds: ['step-1', 'missing', 'step-1'],
      collapsedSupplementalIds: ['supplement-1', 'missing']
    }
  }));

  assert.deepEqual(map.supplementalMaterials, [{
    supplementalId: 'supplement-1',
    type: 'video',
    label: 'Video S1',
    summary: '',
    proofItems: [],
    evidenceGroups: [],
    connections: [],
    manuallyEdited: true,
    manuallyEditedFields: ['label'],
    humanReviewed: true
  }]);
  assert.deepEqual(map.view, {
    zoom: 1.6,
    editorCollapsed: true,
    collapsedStepIds: ['step-1'],
    collapsedSupplementalIds: ['supplement-1']
  });
});

test('evidence groups prefer panel argument function and omit setup-only legend details', () => {
  const workspace = figureWorkspace();
  workspace.figures[0].deep.panels = [
    {
      panel: 'A',
      directObservation: '示意图及代表性图像，比例尺 200 μm。',
      localInference: '示意图及代表性图像，比例尺 200 μm。',
      contribution: '验证目标细胞群被准确标记，为后续功能比较提供操作有效性依据。'
    },
    {
      panel: 'B',
      directObservation: '处理组信号降低。',
      localInference: '干预降低目标信号，支持该信号参与表型。',
      contribution: '建立干预与表型变化之间的功能联系。'
    }
  ];
  workspace.figures[0].deep.panelGroups = [{
    panels: ['A', 'B'],
    groupGoal: '验证操作并检验功能效应',
    groupConclusion: '操作有效且干预改变表型。'
  }];

  const map = createResearchLogicMapFromFigures({
    workspaceId: 'workspace-1',
    figureWorkspace: workspace,
    now: '2026-08-04T00:00:00.000Z'
  });
  const points = map.steps[0].evidenceGroups[0].evidencePoints;
  assert.match(points[0].observation, /操作有效性依据/);
  assert.doesNotMatch(JSON.stringify(points), /比例尺|200 μm/);
});

test('persists editable supplemental evidence and validates its two connection modes', () => {
  const map = normalizeResearchLogicMap(v3Fixture({
    supplementalMaterials: [{
      supplementalId: 'supplement-1',
      type: 'figure',
      label: 'Supplementary Figure 1',
      proofItems: [{ itemId: 'supplement-proof-1', text: 'The control excludes drift.' }],
      evidenceGroups: [{
        groupId: 'supplement-group-1',
        title: 'Control panels',
        groupConclusion: 'The assay remains stable.',
        evidencePoints: [{
          pointId: 'supplement-point-1',
          locator: { kind: 'panels', values: ['S1A', 'S1B'] },
          observation: 'Both controls remain stable.',
          argumentRole: 'control',
          limitation: 'One batch',
          sourceRefs: []
        }]
      }],
      connections: [
        {
          connectionId: 'whole-figure-link',
          mode: 'figure',
          targetStepId: 'step-1'
        },
        {
          connectionId: 'panel-group-link',
          mode: 'evidence-group',
          sourceGroupId: 'supplement-group-1',
          targetStepId: 'step-1',
          targetGroupId: 'group-1'
        },
        {
          connectionId: 'dangling-link',
          mode: 'evidence-group',
          sourceGroupId: 'missing',
          targetStepId: 'step-1',
          targetGroupId: 'group-1'
        },
        {
          connectionId: 'misspelled-mode',
          mode: 'panel-gropu',
          targetStepId: 'step-1'
        }
      ]
    }]
  }));

  const material = map.supplementalMaterials[0];
  assert.deepEqual(material.proofItems.map(item => item.text), [
    'The control excludes drift.'
  ]);
  assert.equal(material.evidenceGroups[0].evidencePoints[0].argumentRole, 'control');
  assert.deepEqual(material.connections, [
    {
      connectionId: 'whole-figure-link',
      mode: 'figure',
      targetStepId: 'step-1',
      sourceGroupId: '',
      targetGroupId: '',
      manuallyEdited: false,
      manuallyEditedFields: [],
      humanReviewed: false
    },
    {
      connectionId: 'panel-group-link',
      mode: 'evidence-group',
      targetStepId: 'step-1',
      sourceGroupId: 'supplement-group-1',
      targetGroupId: 'group-1',
      manuallyEdited: false,
      manuallyEditedFields: [],
      humanReviewed: false
    }
  ]);
  assert.deepEqual(map, normalizeResearchLogicMap(map));
});

test('maps analyzed supplemental Figures into the left-lane material contract', () => {
  const map = createResearchLogicMapFromFigures({
    workspaceId: 'workspace-1',
    articleTitle: 'Example paper',
    canonicalUrl: 'https://example.test/paper',
    figureWorkspace: figureWorkspace(),
    now: '2026-07-30T12:00:00.000Z'
  });

  assert.equal(map.supplementalMaterials.length, 1);
  const material = map.supplementalMaterials[0];
  assert.equal(material.label, 'Supplementary Figure 1');
  assert.ok(material.evidenceGroups.length > 0);
  assert.deepEqual(material.connections.map(connection => ({
    mode: connection.mode,
    targetStepId: connection.targetStepId
  })), [{
    mode: 'figure',
    targetStepId: map.steps[1].stepId
  }]);
});

test('uses each preceding Figure handoff as the single next-Figure question source', () => {
  const workspace = figureWorkspace();
  workspace.figures[1].standard.figureQuestion = 'A conflicting independently analyzed question';
  workspace.crossFigureLogic.result.dominoChain[0].transition =
    'The authoritative handoff question';
  const map = createResearchLogicMapFromFigures({
    workspaceId: 'workspace-1',
    figureWorkspace: workspace,
    now: '2026-07-30T12:00:00.000Z'
  });

  assert.deepEqual(map.steps[1].questionItems.map(item => item.text), [
    'The authoritative handoff question'
  ]);
  assert.equal('nextQuestion' in map.steps[0], false);
});

test('exports pathway-standard long mechanism connectors', () => {
  const svg = buildResearchLogicMapSvg(normalizeResearchLogicMap(v3Fixture({
    meta: {
      mechanismEdges: [
        { sourceId: 'A', targetId: 'B', effect: 'promote', evidence: 'strong' },
        { sourceId: 'B', targetId: 'C', effect: 'inhibit', evidence: 'strong' },
        { sourceId: 'C', targetId: 'D', effect: 'associate', evidence: 'strong' },
        { sourceId: 'D', targetId: 'E', effect: 'promote', evidence: 'weak' }
      ]
    }
  })));

  assert.match(svg, /class="mechanism-connector is-promote is-strong"/);
  assert.match(svg, /marker-end="url\(#mechanism-arrowhead\)"/);
  assert.match(svg, /class="mechanism-inhibition-bar"/);
  assert.match(svg, /class="mechanism-connector is-associate is-weak"[^>]*stroke-dasharray=/);
  assert.match(svg, /class="mechanism-connector is-promote is-weak"[^>]*stroke-dasharray=/);
});

test('exports evidence-group titles above full-width evidence text without overlap', () => {
  const fixture = v3Fixture();
  fixture.steps[0].evidenceGroups[0].title =
    'A very long evidence group title that must wrap before the observation starts';
  const svg = buildResearchLogicMapSvg(normalizeResearchLogicMap(fixture));
  assert.match(svg, /class="group-index" x="102"/);
  assert.match(svg, /class="evidence" x="124"/);
  assert.doesNotMatch(svg, /class="evidence" x="320"/);
});

test('normalizes editable maps, indexes them, and exports every v3 chain layer', () => {
  const map = normalizeResearchLogicMap(v3Fixture());
  const index = upsertResearchLogicMapIndex({}, map);
  const svg = buildResearchLogicMapSvg(map);

  assert.equal(index.activeMapId, 'logic-map-v3');
  assert.equal(index.maps[0].relativePath, 'logic-maps/logic-map-v3.json');
  assert.equal(index.maps[0].stepCount, 1);
  assert.equal(RESEARCH_LOGIC_MAP_INDEX_PATH, 'logic-maps/index.json');
  assert.match(svg, /^<svg /);
  assert.match(svg, /Known background/);
  assert.match(svg, /Core question/);
  assert.match(svg, /Figure question/);
  assert.match(svg, /Figure proof/);
  assert.match(svg, /Signal increases/);
  assert.match(svg, /Final conclusion/);
  assert.match(svg, /<\/svg>$/);
});

test('creates a normalized blank v4 map and requires analysis for generated maps', () => {
  const map = createBlankResearchLogicMap({
    workspaceId: 'workspace-2',
    mapId: 'manual-map',
    articleTitle: 'Manual paper',
    now: '2026-07-30T12:00:00.000Z'
  });
  assert.equal(map.schemaVersion, 4);
  assert.equal(map.meta.centralScientificQuestion, '');
  assert.deepEqual(map.meta.backgroundItems, []);
  assert.deepEqual(map.meta.scientificQuestions, []);
  assert.deepEqual(map.meta.finalConclusions, []);
  assert.deepEqual(map.steps[0].questionItems, []);
  assert.deepEqual(map.steps[0].proofItems, []);

  assert.throws(
    () => createResearchLogicMapFromFigures({
      figureWorkspace: {
        figures: [{ figureId: 'figure-1', figureLabel: 'Figure 1' }]
      }
    }),
    error => error.code === 'RESEARCH_LOGIC_MAP_REQUIRES_FIGURE_ANALYSIS'
  );
});
