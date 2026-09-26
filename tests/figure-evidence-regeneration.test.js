const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFigureWorkspaceDraft,
  mergeModelIntoFigureWorkspaceDraft,
  applyFigureWorkspaceMutation
} = require('../core/figure-workspace.js');

const figure = {
  figureId: 'figure-1',
  figureLabel: 'Figure 1',
  panelHints: ['A', 'B', 'C']
};

function model(groups, bridges = []) {
  return {
    figureId: figure.figureId,
    analysisDepth: 'standard',
    panelGroups: groups.map(group => ({
      panels: group.panels,
      groupGoal: group.goal,
      groupConclusion: group.conclusion || `${group.goal} result`,
      upstreamContext: group.upstream || `${group.goal} upstream`
    })),
    logicBridges: bridges.map(bridge => ({
      fromGroup: bridge.from,
      toGroup: bridge.to,
      relationType: 'necessity',
      bridge: bridge.text || `${bridge.from} to ${bridge.to}`
    }))
  };
}

function figureBlocks(draft) {
  return draft.figures[figure.figureId].evidenceBlocks;
}

function groupForPanels(draft, panelIds) {
  const identity = panelIds.slice().sort().join(',');
  return figureBlocks(draft).find(block =>
    block.kind === 'evidence' && block.sourceType === 'group' &&
    block.panelIds.slice().sort().join(',') === identity
  );
}

test('reviewed upstream follows its exact Panel group when generated groups reorder', () => {
  let draft = mergeModelIntoFigureWorkspaceDraft(
    createFigureWorkspaceDraft([figure]), figure,
    model([
      { panels: ['A'], goal: 'experiment A' },
      { panels: ['B'], goal: 'experiment B' }
    ], [{ from: 'experiment A', to: 'experiment B' }])
  );
  draft = applyFigureWorkspaceMutation(draft, {
    type: 'update_evidence_block',
    expectedRevision: draft.revision,
    figureId: figure.figureId,
    blockId: groupForPanels(draft, ['A']).id,
    field: 'upstreamContext',
    value: 'Reviewed context for experiment A.'
  }, 100);

  const regenerated = mergeModelIntoFigureWorkspaceDraft(draft, figure, model([
    { panels: ['B'], goal: 'experiment B regenerated' },
    { panels: ['A'], goal: 'experiment A regenerated' }
  ], [{ from: 'experiment B regenerated', to: 'experiment A regenerated' }]));

  const groupA = groupForPanels(regenerated, ['A']);
  const groupB = groupForPanels(regenerated, ['B']);
  assert.equal(groupA.id, 'evidence-group-1');
  assert.equal(groupB.id, 'evidence-group-2');
  assert.deepEqual(groupA.upstreamContext, {
    value: 'Reviewed context for experiment A.', humanReviewed: true, editedAt: 100
  });
  assert.equal(groupB.upstreamContext.value, 'experiment B regenerated upstream');
});

test('split groups do not inherit reviewed text from a different Panel set', () => {
  let draft = mergeModelIntoFigureWorkspaceDraft(
    createFigureWorkspaceDraft([figure]), figure,
    model([{ panels: ['A', 'B'], goal: 'combined experiment' }])
  );
  draft = applyFigureWorkspaceMutation(draft, {
    type: 'update_evidence_block',
    expectedRevision: draft.revision,
    figureId: figure.figureId,
    blockId: groupForPanels(draft, ['A', 'B']).id,
    field: 'upstreamContext',
    value: 'Reviewed context for the combined experiment.'
  }, 200);

  const regenerated = mergeModelIntoFigureWorkspaceDraft(draft, figure, model([
    { panels: ['A'], goal: 'split experiment A' },
    { panels: ['B'], goal: 'split experiment B' }
  ]));

  assert.equal(groupForPanels(regenerated, ['A']).upstreamContext.value,
    'split experiment A upstream');
  assert.equal(groupForPanels(regenerated, ['B']).upstreamContext.value,
    'split experiment B upstream');
  const retained = groupForPanels(regenerated, ['A', 'B']);
  assert.ok(retained);
  assert.equal(retained.id, 'evidence-group-1-2');
  assert.equal(retained.upstreamContext.value,
    'Reviewed context for the combined experiment.');
  assert.equal(retained.upstreamContext.humanReviewed, true);
  assert.equal(new Set(figureBlocks(regenerated).map(block => block.id)).size,
    figureBlocks(regenerated).length);
});

test('unrelated manual blocks survive regeneration under a noncolliding ID', () => {
  let draft = mergeModelIntoFigureWorkspaceDraft(
    createFigureWorkspaceDraft([figure]), figure,
    model([
      { panels: ['A'], goal: 'experiment A' },
      { panels: ['B'], goal: 'experiment B' }
    ])
  );
  draft = applyFigureWorkspaceMutation(draft, {
    type: 'add_evidence_block',
    expectedRevision: draft.revision,
    figureId: figure.figureId,
    block: {
      id: 'evidence-group-3',
      panelIds: ['C'],
      groupGoal: 'Manual note',
      groupConclusion: 'Keep this unrelated review.'
    }
  }, 300);

  const regenerated = mergeModelIntoFigureWorkspaceDraft(draft, figure, model([
    { panels: ['A'], goal: 'experiment A regenerated' },
    { panels: ['B'], goal: 'experiment B regenerated' },
    { panels: ['C'], goal: 'new generated experiment C' }
  ]));

  const manual = figureBlocks(regenerated).find(block => block.sourceType === 'manual');
  assert.ok(manual);
  assert.equal(manual.id, 'evidence-group-3-2');
  assert.deepEqual(manual.panelIds, ['C']);
  assert.equal(manual.groupConclusion.value, 'Keep this unrelated review.');
  assert.equal(groupForPanels(regenerated, ['C']).id, 'evidence-group-3');
});

test('transition endpoints follow stable group IDs after generated order changes', () => {
  let draft = mergeModelIntoFigureWorkspaceDraft(
    createFigureWorkspaceDraft([figure]), figure,
    model([
      { panels: ['A'], goal: 'experiment A' },
      { panels: ['B'], goal: 'experiment B' }
    ], [{ from: 'experiment A', to: 'experiment B' }])
  );
  const originalTransition = figureBlocks(draft).find(block => block.kind === 'transition');
  draft = applyFigureWorkspaceMutation(draft, {
    type: 'update_evidence_block',
    expectedRevision: draft.revision,
    figureId: figure.figureId,
    blockId: originalTransition.id,
    field: 'transitionToNext',
    value: 'Reviewed transition from A to B.'
  }, 400);

  draft = mergeModelIntoFigureWorkspaceDraft(draft, figure, model([
    { panels: ['B'], goal: 'experiment B next' },
    { panels: ['A'], goal: 'experiment A next' }
  ], [{ from: 'experiment B next', to: 'experiment A next' }]));

  const transition = figureBlocks(draft).find(block => block.kind === 'transition');
  assert.ok(transition);
  assert.equal(transition.fromBlockId, groupForPanels(draft, ['B']).id);
  assert.equal(transition.toBlockId, groupForPanels(draft, ['A']).id);
  assert.deepEqual(
    [transition.fromBlockId, transition.toBlockId],
    ['evidence-group-2', 'evidence-group-1']
  );
  assert.equal(transition.transitionToNext.value,
    'experiment B next to experiment A next');
  assert.equal(transition.transitionToNext.humanReviewed, false);

  const retained = figureBlocks(draft).find(block =>
    block.kind === 'transition' && block.id !== transition.id
  );
  assert.ok(retained);
  assert.equal(retained.id, 'evidence-transition-bridge-1-2');
  assert.deepEqual(
    [retained.fromBlockId, retained.toBlockId],
    ['evidence-group-1', 'evidence-group-2']
  );
  assert.equal(retained.transitionToNext.value, 'Reviewed transition from A to B.');
  assert.equal(retained.transitionToNext.humanReviewed, true);
});
