const test = require('node:test');
const assert = require('node:assert/strict');
const { createFigureWorkspaceDraft, mergeModelIntoFigureWorkspaceDraft,
  applyFigureWorkspaceMutation, createFigureWorkspaceView, normalizeFigureWorkspaceDraft,
  publicFigureWorkspaceDraft, buildFigureEvidenceDisplayLayout } = require('../core/figure-workspace.js');
const figure = { figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A', 'C'] };
const model = { figureId: figure.figureId, analysisDepth: 'standard', panelGroups: [{
  panels: ['A', 'C'], groupGoal: '确认 RTX 条件', groupConclusion: 'D2 与 D4–D8 显示不同时间过程'
}] };
function fixture() {
  return mergeModelIntoFigureWorkspaceDraft(createFigureWorkspaceDraft([figure]), figure, model);
}
function clearUpstream(draft) {
  return applyFigureWorkspaceMutation(draft, { type: 'update_evidence_block',
    expectedRevision: draft.revision, figureId: figure.figureId,
    blockId: 'evidence-group-1', field: 'upstreamContext', value: '' }, 501);
}

test('FIG-006 projected evidence fields retain reviewed empty values and original strings', () => {
  const draft = clearUpstream(fixture());
  const block = createFigureWorkspaceView({ figure, draft }).evidenceBlocks[0];
  assert.equal(block.upstreamContext, '');
  assert.deepEqual(block.fieldStates.upstreamContext, { value: '', humanReviewed: true, editedAt: 501 });
  assert.deepEqual(block.panelIds, ['A', 'C']);
  for (const [field, state] of Object.entries(block.fieldStates)) {
    assert.deepEqual(state, draft.figures[figure.figureId].evidenceBlocks[0][field]);
    assert.equal(block[field], state.value);
  }
});

test('FIG-006 display layout carries field states without expanding Panel membership', () => {
  const view = createFigureWorkspaceView({ figure, draft: clearUpstream(fixture()) });
  const layout = buildFigureEvidenceDisplayLayout(view.evidenceBlocks, view.panels);
  assert.equal(layout.length, 1);
  assert.deepEqual(layout[0].panelIds, ['A', 'C']);
  assert.equal(layout[0].fieldStates.upstreamContext.humanReviewed, true);
  assert.equal(layout[0].fieldStates.upstreamContext.value, '');
});

test('FIG-006 field state projections are detached from stored drafts and later views', () => {
  const draft = clearUpstream(fixture()); const before = JSON.stringify(draft);
  const view = createFigureWorkspaceView({ figure, draft });
  view.evidenceBlocks[0].fieldStates.upstreamContext.value = 'must not persist';
  view.evidenceBlocks[0].fieldStates.groupConclusion.humanReviewed = true;
  assert.equal(JSON.stringify(draft), before);
  assert.equal(createFigureWorkspaceView({ figure, draft }).evidenceBlocks[0].fieldStates.upstreamContext.value, '');
});

test('FIG-006 JSON save/reload and regeneration keep human blanks without changing the stored schema', () => {
  const draft = clearUpstream(fixture());
  const serialized = JSON.stringify(publicFigureWorkspaceDraft(draft));
  assert.equal(serialized.includes('fieldStates'), false);
  const restored = normalizeFigureWorkspaceDraft(JSON.parse(serialized));
  const regenerated = mergeModelIntoFigureWorkspaceDraft(restored, figure, model);
  const block = createFigureWorkspaceView({ figure, draft: regenerated }).evidenceBlocks[0];
  assert.deepEqual(block.fieldStates.upstreamContext, { value: '', humanReviewed: true, editedAt: 501 });
  assert.equal(regenerated.schemaVersion, draft.schemaVersion);
  assert.equal(block.groupConclusion, draft.figures[figure.figureId].evidenceBlocks[0].groupConclusion.value);
});

test('FIG-006 model-only evidence fields remain unreviewed, not artificial human edits', () => {
  const block = createFigureWorkspaceView({ figure, modelResult: model }).evidenceBlocks[0];
  assert.equal(block.fieldStates.groupGoal.humanReviewed, false);
  assert.equal(block.fieldStates.upstreamContext.humanReviewed, false);
  assert.equal(block.fieldStates.groupGoal.value, block.groupGoal);
});
