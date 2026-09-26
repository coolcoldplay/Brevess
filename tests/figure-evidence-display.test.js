const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEvidenceBlocks, buildFigureEvidenceDisplayLayout, createFigureWorkspaceDraft,
  mergeModelIntoFigureWorkspaceDraft, applyFigureWorkspaceMutation, normalizeFigureWorkspaceDraft,
  createFigureWorkspaceView
} = require('../core/figure-workspace.js');

const panels = ids => ids.split('').map(panelId => ({ panelId }));
const group = (id, ids, extra = {}) => ({ id, kind: 'evidence', sourceType: 'group', panelIds: ids.split(''), ...extra });

test('display omits empty bridge cards without changing stored records', () => {
  const stored = buildEvidenceBlocks({
    panelGroups: [{ panels: ['A'], groupGoal: 'test receptor', groupConclusion: 'result' }],
    argumentChain: [{ panels: [], established: 'summary only' }],
    logicBridges: [{ fromGroup: 'unknown', toGroup: 'unknown target', bridge: 'saved bridge' }]
  });
  const before = JSON.stringify(stored);
  const visible = buildFigureEvidenceDisplayLayout(stored, panels('A'));
  assert.deepEqual(visible.filter(x => x.kind === 'evidence').map(x => x.panelIds), [['A']]);
  assert.equal(JSON.stringify(stored), before);
});

test('specific groups receive their Panels before a containing whole-Figure summary', () => {
  const stored = [group('all', 'ABCD'), group('first', 'AB'), group('second', 'CD')];
  const visible = buildFigureEvidenceDisplayLayout(stored, panels('ABCD'));
  assert.deepEqual(visible.map(x => [x.id, x.panelIds]), [['first', ['A', 'B']], ['second', ['C', 'D']]]);
  assert.deepEqual(stored[0].panelIds, ['A', 'B', 'C', 'D']);
});

test('ambiguous overlap stays unassigned, unrelated Panels are never stuffed into a group', () => {
  const visible = buildFigureEvidenceDisplayLayout([group('one', 'AB'), group('two', 'BC')], panels('ABCDE'));
  assert.deepEqual(visible.map(x => x.panelIds), [['A'], ['C']]);
  assert.equal(visible.flatMap(x => x.panelIds).includes('B'), false);
});

test('duplicate groups cannot create empty evidence cards or duplicate Panel descendants', () => {
  const visible = buildFigureEvidenceDisplayLayout([group('one', 'AB'), group('two', 'AB')], panels('AB'));
  assert.deepEqual(visible, []);
});

test('display canonicalizes existing Panel IDs, excludes invented IDs and retains numeric labels', () => {
  const visible = buildFigureEvidenceDisplayLayout([
    { ...group('one', ''), panelIds: ['a', ' A ', '2', 'Z', 'not-a-panel'] }
  ], [{ panelId: 'A' }, { panelId: '2' }]);
  assert.deepEqual(visible[0].panelIds, ['A', '2']);
});

test('argument-only fallback may own uncovered Panels but cannot duplicate established group panels', () => {
  const visible = buildFigureEvidenceDisplayLayout([
    group('one', 'AB'), group('argument', 'BC', { sourceType: 'argument' })
  ], panels('ABC'));
  assert.deepEqual(visible.map(x => x.panelIds), [['A', 'B'], ['C']]);
});

test('incoming transitions survive as context but never become visible evidence cards', () => {
  const transition = { id: 'transition', kind: 'transition', fromBlockId: 'one', toBlockId: 'two', transitionToNext: 'a single bridge' };
  const visible = buildFigureEvidenceDisplayLayout([group('two', 'B'), transition, group('one', 'A')], panels('AB'));
  assert.deepEqual(visible.filter(x => x.kind === 'evidence').map(x => x.id), ['one', 'two']);
  assert.equal(visible.find(x => x.id === 'transition').transitionToNext, 'a single bridge');
});

test('more than six independent experiment groups are retained and upstream is durable', () => {
  const stored = buildEvidenceBlocks({ panelGroups: Array.from({ length: 9 }, (_, i) => ({
    panels: [String.fromCharCode(65 + i)], groupGoal: `experiment ${i}`, groupConclusion: 'observation',
    upstreamContext: '上一块尚未确认受体是否参与，本块检验其作用。'
  })) });
  assert.equal(stored.filter(x => x.kind === 'evidence').length, 9);
  assert.equal(stored[0].upstreamContext, '上一块尚未确认受体是否参与,本块检验其作用。');
});

test('upstream double-click edit survives save/reload/regeneration while old handoff is retained', () => {
  const figure = { figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A'] };
  const result = { figureId: 'figure-1', panelGroups: [{ panels: ['A'], groupGoal: 'test',
    groupConclusion: 'result', upstreamContext: 'Generated upstream.' }],
    argumentChain: [{ panels: ['A'], established: 'evidence', handoff: 'Legacy handoff.' }]
  };
  let draft = mergeModelIntoFigureWorkspaceDraft(createFigureWorkspaceDraft([figure]), figure, result);
  draft = applyFigureWorkspaceMutation(draft, { type: 'update_evidence_block',
    expectedRevision: draft.revision, figureId: 'figure-1', blockId: 'evidence-group-1',
    field: 'upstreamContext', value: 'Manually reviewed upstream.'
  }, 500);
  const restored = normalizeFigureWorkspaceDraft(JSON.parse(JSON.stringify(draft)));
  const regenerated = mergeModelIntoFigureWorkspaceDraft(restored, figure, result);
  const block = regenerated.figures['figure-1'].evidenceBlocks[0];
  assert.equal(block.upstreamContext.value, 'Manually reviewed upstream.');
  assert.equal(block.upstreamContext.humanReviewed, true);
  assert.equal(block.handoff.value, 'Legacy handoff.');
});

test('numeric and qualified Panel labels survive actual workspace storage and view construction', () => {
  const ids = ['1', 'A+', 'B.1'];
  const figure = { figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ids };
  const result = { figureId: 'figure-1', panels: ids.map(panel => ({ panel, purpose: `experiment ${panel}` })),
    panelGroups: ids.map(panel => ({ panels: [panel], groupGoal: `goal ${panel}`, upstreamContext: 'This block tests its question.' })) };
  const draft = mergeModelIntoFigureWorkspaceDraft(createFigureWorkspaceDraft([figure]), figure, result);
  const restored = normalizeFigureWorkspaceDraft(JSON.parse(JSON.stringify(draft)));
  const view = createFigureWorkspaceView({ figure, modelResult: result, draft: restored });
  assert.deepEqual(view.panels.map(panel => panel.panelId), ids);
  assert.deepEqual(buildFigureEvidenceDisplayLayout(view.evidenceBlocks, view.panels).map(block => block.panelIds), ids.map(id => [id]));
});
