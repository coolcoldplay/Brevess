const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  createPanelRecoveryBatches,
  createUnidentifiedPanelRecord,
  mergeRecoveredPanels
} = require('../core/figure-panel-recovery.js');

function panel(panelId, purpose = `Purpose ${panelId}`) {
  return { panel: panelId, purpose, directObservation: `Observation ${panelId}` };
}

test('batches normalized missing Panel labels in order without mutating the input', () => {
  const labels = [' d ', 'e', 'Ｆ', 'g'];
  assert.deepEqual(createPanelRecoveryBatches(labels, 3), [
    ['D', 'E', 'F'], ['G']
  ]);
  assert.deepEqual(labels, [' d ', 'e', 'Ｆ', 'g']);
});

test('rejects invalid, inherited, and duplicate labels with bounded diagnostics', () => {
  assert.throws(
    () => createPanelRecoveryBatches(['A', 'article body must not leak'], 3),
    error => error.code === 'PANEL_RECOVERY_LABELS_INVALID' &&
      assert.deepEqual(error.invalidLabelIndexes, [1]) === undefined &&
      !error.message.includes('article body')
  );

  const inherited = [];
  inherited.length = 2;
  inherited[0] = 'A';
  Object.setPrototypeOf(inherited, Object.assign([], { 1: 'B' }));
  assert.throws(
    () => createPanelRecoveryBatches(inherited, 3),
    error => error.code === 'PANEL_RECOVERY_LABELS_INVALID' &&
      assert.deepEqual(error.invalidLabelIndexes, [1]) === undefined
  );

  assert.throws(
    () => createPanelRecoveryBatches(['A', ' a ', 'Ａ'], 3),
    error => error.code === 'PANEL_RECOVERY_LABELS_DUPLICATED' &&
      assert.deepEqual(error.duplicatePanels, ['A']) === undefined
  );
});

test('merges recovered Panels into a fresh expected-order result and reports unresolved labels', () => {
  const base = {
    figureId: 'figure-1',
    panels: [panel('A'), panel('B'), panel('C')],
    panelCoverage: { expectedPanels: ['A', 'B', 'C', 'D', 'E', 'F'] }
  };
  const recovery = { panels: [panel('f'), panel('D')] };

  const merged = mergeRecoveredPanels(base, recovery, ['A', 'B', 'C', 'D', 'E', 'F']);

  assert.deepEqual(merged.panels.map(item => item.panel), ['A', 'B', 'C', 'D', 'F']);
  assert.deepEqual(merged.unresolvedPanels, ['E']);
  assert.deepEqual(merged.panelCoverage.returnedPanels, ['A', 'B', 'C', 'D', 'F']);
  assert.deepEqual(merged.panelCoverage.missingPanels, ['E']);
  assert.equal(base.panels.length, 3);
  assert.equal(recovery.panels[0].panel, 'f');
  assert.notEqual(merged, base);
  assert.notEqual(merged.panels[0], base.panels[0]);
});

test('rejects a recovery result from a different Figure without exposing either identity', () => {
  const base = {
    figureId: 'figure-1', figureVersion: '13-figure-evidence-fields',
    analysisDepth: 'standard', panels: [panel('A')]
  };
  const recovery = {
    figureId: 'figure-2', figureVersion: '13-figure-evidence-fields',
    analysisDepth: 'standard', panels: [panel('B')]
  };

  assert.throws(
    () => mergeRecoveredPanels(base, recovery, ['A', 'B']),
    error => error.code === 'PANEL_RECOVERY_RESULT_IDENTITY_MISMATCH' &&
      assert.deepEqual(error.mismatchedFields, ['figureId']) === undefined &&
      !error.message.includes('figure-1') && !error.message.includes('figure-2')
  );
});

test('checks optional Figure schema and depth identities only when both results provide them', () => {
  assert.throws(
    () => mergeRecoveredPanels(
      { figureVersion: '13', analysisDepth: 'standard', panels: [panel('A')] },
      { figureVersion: '14', analysisDepth: 'deep', panels: [panel('B')] },
      ['A', 'B']
    ),
    error => error.code === 'PANEL_RECOVERY_RESULT_IDENTITY_MISMATCH' &&
      assert.deepEqual(error.mismatchedFields, ['figureVersion', 'analysisDepth']) === undefined
  );

  const merged = mergeRecoveredPanels(
    { figureId: 'figure-1', analysisDepth: 'standard', panels: [panel('A')] },
    { panels: [panel('B')] },
    ['A', 'B']
  );
  assert.deepEqual(merged.panels.map(item => item.panel), ['A', 'B']);
});

test('canonicalizes panelId-only and matching dual aliases into one panel field', () => {
  const basePanel = { panel: ' a ', panelId: '\uff21', purpose: 'Existing' };
  const recoveryPanel = { panelId: ' b ', purpose: 'Recovered' };
  const merged = mergeRecoveredPanels(
    { panels: [basePanel] }, { panels: [recoveryPanel] }, ['A', 'B']
  );

  assert.deepEqual(merged.panels.map(item => item.panel), ['A', 'B']);
  assert.equal(Object.hasOwn(merged.panels[0], 'panelId'), false);
  assert.equal(Object.hasOwn(merged.panels[1], 'panelId'), false);
  assert.equal(merged.panels[0].purpose, 'Existing');
  assert.equal(merged.panels[1].purpose, 'Recovered');
  assert.equal(basePanel.panel, ' a ');
  assert.equal(recoveryPanel.panelId, ' b ');
});

test('rejects conflicting dual panel aliases in base and recovery records', () => {
  for (const [base, recovery, code] of [
    [{ panels: [{ panel: 'A', panelId: 'B' }] }, { panels: [] },
      'PANEL_RECOVERY_BASE_PANELS_INVALID'],
    [{ panels: [] }, { panels: [{ panel: 'A', panelId: 'B' }] },
      'PANEL_RECOVERY_PANELS_INVALID']
  ]) {
    assert.throws(
      () => mergeRecoveredPanels(base, recovery, ['A', 'B']),
      error => error.code === code &&
        assert.deepEqual(error.invalidPanelIndexes, [0]) === undefined
    );
  }
});

test('requires plain records for both merge inputs', () => {
  assert.throws(
    () => mergeRecoveredPanels([], { panels: [] }, []),
    error => error.code === 'PANEL_RECOVERY_RESULT_INVALID'
  );
  assert.throws(
    () => mergeRecoveredPanels({ panels: [] }, [], []),
    error => error.code === 'PANEL_RECOVERY_RESULT_INVALID'
  );
  assert.throws(
    () => mergeRecoveredPanels(new Date(), { panels: [] }, []),
    error => error.code === 'PANEL_RECOVERY_RESULT_INVALID'
  );
});

test('rejects recovery output containing a completed Panel and preserves human content', () => {
  const base = {
    panels: [{
      ...panel('A', 'Human purpose'),
      humanReviewed: true,
      editedAt: 42
    }]
  };
  const recovery = { panels: [panel('A', 'Model replacement'), panel('B')] };

  assert.throws(
    () => mergeRecoveredPanels(base, recovery, ['A', 'B']),
    error => error.code === 'PANEL_RECOVERY_OVERLAP' &&
      assert.deepEqual(error.overlapPanels, ['A']) === undefined &&
      !error.message.includes('Human purpose') &&
      !error.message.includes('Model replacement')
  );
  assert.equal(base.panels[0].purpose, 'Human purpose');
  assert.equal(base.panels[0].humanReviewed, true);
});

test('rejects duplicate and inherited recovery Panel entries without reading raw content', () => {
  assert.throws(
    () => mergeRecoveredPanels({ panels: [] }, {
      panels: [panel('D'), panel(' d ', 'private article text')]
    }, ['D']),
    error => error.code === 'PANEL_RECOVERY_PANELS_DUPLICATED' &&
      assert.deepEqual(error.duplicatePanels, ['D']) === undefined &&
      !error.message.includes('private article text')
  );

  const panels = [];
  panels.length = 1;
  Object.setPrototypeOf(panels, Object.assign([], { 0: panel('D', 'inherited text') }));
  assert.throws(
    () => mergeRecoveredPanels({ panels: [] }, { panels }, ['D']),
    error => error.code === 'PANEL_RECOVERY_PANELS_INVALID' &&
      assert.deepEqual(error.invalidPanelIndexes, [0]) === undefined &&
      !error.message.includes('inherited text')
  );
});

test('creates an explicit unidentified record from bounded evidence references only', () => {
  const record = createUnidentifiedPanelRecord(' d ', {
    inputMode: 'figure_image',
    evidenceRefs: [
      'caption:panel_D',
      'paragraph:p-7',
      'paragraph:p-7',
      'raw article text that is not a source reference'
    ]
  });

  assert.deepEqual(record, {
    panel: 'D',
    status: 'not_identifiable',
    reasonCode: 'insufficient_panel_evidence',
    inputMode: 'figure_image',
    evidenceRefs: ['caption:panel_D', 'paragraph:p-7']
  });
  assert.equal(Object.hasOwn(record, 'purpose'), false);
  assert.equal(Object.hasOwn(record, 'directObservation'), false);
  assert.equal(Object.hasOwn(record, 'localInference'), false);
});

test('loads the recovery helper before the background router', () => {
  const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
  assert.ok(source.indexOf('core/figure-panel-recovery.js') >= 0);
  assert.ok(source.indexOf('core/figure-panel-recovery.js') <
    source.indexOf('core/background-router.js'));
});
