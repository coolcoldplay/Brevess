const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildPanelLedger,
  normalizePanelLedger,
  mergePanelLedgerReview,
  auditPanelCoverage
} = require('../core/panel-ledger.js');

test('builds one immutable entry for every discovered main and supplemental Panel', () => {
  const ledger = buildPanelLedger([{
    figureId: 'figure-7', figureLabel: 'Figure 7', panelHints: ['A', 'B', 'C'],
    analysis: {
      panels: { A: { purpose: 'design' }, C: { purpose: 'outcome' } },
      argumentChain: [{ panels: ['B-D'] }]
    }
  }, {
    figureId: 'figure-s2', figureLabel: 'Figure S2', isSupplemental: true,
    panelHints: ['A']
  }]);

  assert.deepEqual(ledger.entries.map(entry => entry.panelKey), [
    'figure-7:A', 'figure-7:B', 'figure-7:C', 'figure-7:D', 'figure-s2:A'
  ]);
  assert.equal(ledger.entries[0].originalDisplayId, '7A');
  assert.equal(ledger.entries[4].originalDisplayId, 'S2A');
  assert.deepEqual(ledger.entries[1].sources, ['panelHints', 'analysis.argumentChain']);
  assert.equal(Object.isFrozen(ledger), true);
  assert.equal(Object.isFrozen(ledger.entries), true);
  assert.equal(Object.isFrozen(ledger.entries[0]), true);
  assert.equal(Object.isFrozen(ledger.entries[0].sources), true);
});

test('enumerates per-Panel analysis arrays and deduplicates normalized bounded ids', () => {
  const ledger = buildPanelLedger([{
    figureId: 'figure-3', figureLabel: 'Fig. 3',
    panelHints: ['a', 'A', 'B–D', 'Discussion of panel E', 'ABCDE'],
    analysis: {
      panels: [{ panelId: 'D' }, { id: 'E' }, { panel_id: 'F' }],
      argumentChain: [{ panels: ['C', 'F-H', 'panels I and J'] }]
    }
  }]);

  assert.deepEqual(ledger.entries.map(entry => entry.panelId), [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'
  ]);
  assert.deepEqual(ledger.entries.find(entry => entry.panelId === 'D').sources, [
    'panelHints', 'analysis.panels'
  ]);
  assert.deepEqual(ledger.entries.find(entry => entry.panelId === 'F').sources, [
    'analysis.panels', 'analysis.argumentChain'
  ]);
});

test('normalizes ledger fields without permitting identity or prose injection', () => {
  const ledger = normalizePanelLedger({ entries: [{
    panelKey: 'attacker:key',
    figureId: 'FIGURE-2',
    panelId: ' b ',
    originalDisplayId: 'forged',
    displayAlias: '  causal readout  ',
    status: 'unlinked',
    statusReason: '<script>x</script>No explicit edge.',
    sources: ['panelHints', 'panelHints', 'x'.repeat(500)]
  }, {
    figureId: 'figure-2', panelId: 'this is prose', status: 'linked'
  }] });

  assert.equal(ledger.entries.length, 1);
  assert.deepEqual(ledger.entries[0], {
    panelKey: 'figure-2:B',
    figureId: 'figure-2',
    panelId: 'B',
    figureDisplayId: '2',
    originalDisplayId: '2B',
    displayAlias: 'causal readout',
    status: 'unlinked',
    statusReason: 'No explicit edge.',
    sources: ['panelHints', 'x'.repeat(120)]
  });
});

test('merges review only when every immutable identity field still matches', () => {
  const current = buildPanelLedger([{
    figureId: 'figure-4', figureLabel: 'Figure 4', panelHints: ['A', 'B']
  }]);
  const reviewed = {
    entries: [{
      ...current.entries[0], displayAlias: 'Loss-of-function', status: 'excluded',
      statusReason: 'Method-only calibration.'
    }, {
      ...current.entries[1], figureId: 'figure-999', displayAlias: 'forged',
      status: 'linked', edgeIds: ['edge-1']
    }]
  };

  const merged = mergePanelLedgerReview(current, reviewed);
  assert.equal(merged.entries[0].displayAlias, 'Loss-of-function');
  assert.equal(merged.entries[0].status, 'excluded');
  assert.equal(merged.entries[0].statusReason, 'Method-only calibration.');
  assert.equal(merged.entries[1].displayAlias, '');
  assert.equal(merged.entries[1].status, 'unreviewed');
  assert.equal(merged.entries[1].edgeIds, undefined);
  assert.equal(merged.entries[0].panelKey, current.entries[0].panelKey);
});

test('audits exact Panel coverage and disposition evidence requirements', () => {
  const ledger = buildPanelLedger([{
    figureId: 'figure-5', figureLabel: 'Figure 5', panelHints: ['A', 'B', 'C', 'D']
  }]);
  const complete = auditPanelCoverage(ledger, {
    edges: [{ edgeId: 'edge-1', assignments: [{ panelKey: 'figure-5:A' }] }],
    dispositions: [
      { panelKey: 'figure-5:A', status: 'linked', edgeIds: ['edge-1'] },
      { panelKey: 'figure-5:B', status: 'unlinked', reason: 'No explicit edge.' },
      { panelKey: 'figure-5:C', status: 'excluded', reason: 'Method-only control.' },
      { panelKey: 'figure-5:D', status: 'ambiguous', candidatePanelKeys: ['figure-5:C'] }
    ]
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.covered, 4);

  const incomplete = auditPanelCoverage(ledger, {
    edges: [],
    dispositions: [
      { panelKey: 'figure-5:A', status: 'linked', edgeIds: [] },
      { panelKey: 'figure-5:B', status: 'unlinked', reason: '' },
      { panelKey: 'figure-5:B', status: 'excluded', reason: 'duplicate' },
      { panelKey: 'figure-9:Z', status: 'unlinked', reason: 'unknown' }
    ]
  });
  assert.equal(incomplete.ok, false);
  assert.deepEqual(incomplete.missingPanelKeys, ['figure-5:C', 'figure-5:D']);
  assert.deepEqual(incomplete.duplicatePanelKeys, ['figure-5:B']);
  assert.deepEqual(incomplete.unknownPanelKeys, ['figure-9:Z']);
  assert.deepEqual(incomplete.invalidPanelKeys, ['figure-5:A', 'figure-5:B']);
});

test('loads the Panel ledger before cross-Figure logic in the service worker', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  assert.ok(source.indexOf("'core/panel-ledger.js'") >= 0);
  assert.ok(source.indexOf("'core/panel-ledger.js'") < source.indexOf("'core/cross-figure-logic.js'"));
});

test('reads every supported own Panel id field and keeps distinct provenance sources', () => {
  const ledger = buildPanelLedger([{
    figureId: 'figure-8',
    panelHints: [
      { panelId: 'A' }, { panel_id: 'B' }, { panel: 'C' }, { id: 'D' }
    ],
    analysis: { panels: [{ panelId: 'E' }] },
    panelAnalyses: [{ panel_id: 'E' }, { panel: 'F' }]
  }]);
  assert.deepEqual(ledger.entries.map(entry => entry.panelId), [
    'A', 'B', 'C', 'D', 'E', 'F'
  ]);
  assert.deepEqual(ledger.entries.find(entry => entry.panelId === 'E').sources, [
    'analysis.panels', 'panelAnalyses'
  ]);
});

test('accepts exact scan boundaries and hard-fails every scan overflow', () => {
  const exactFigures = Array.from({ length: 128 }, (_, index) => ({
    figureId: `figure-${index + 1}`, panelHints: ['A']
  }));
  assert.equal(buildPanelLedger(exactFigures).entries.length, 128);
  assert.throws(
    () => buildPanelLedger([...exactFigures, { figureId: 'figure-129', panelHints: ['A'] }]),
    error => error?.code === 'PANEL_LEDGER_FIGURE_LIMIT'
  );

  const exactPanelRefs = Array.from({ length: 512 }, () => 'A');
  assert.equal(buildPanelLedger([{
    figureId: 'figure-1', panelHints: exactPanelRefs
  }]).entries.length, 1);
  assert.throws(
    () => buildPanelLedger([{
      figureId: 'figure-1', panelHints: [...exactPanelRefs, 'B']
    }]),
    error => error?.code === 'PANEL_LEDGER_PANEL_LIMIT'
  );

  assert.throws(() => normalizePanelLedger({ entries: [{
    figureId: 'figure-1', panelId: 'A',
    sources: Array.from({ length: 13 }, (_, index) => `source-${index}`)
  }] }), error => error?.code === 'PANEL_LEDGER_SOURCE_LIMIT');
});

test('derives original display identity canonically and handles Unicode range boundaries', () => {
  const normalized = normalizePanelLedger({ entries: [{
    figureId: 'figure-2', panelId: '\uff22', originalDisplayId: '999Z', sources: []
  }, {
    figureId: 'figure-s3', panelId: 'A', originalDisplayId: '1A', sources: []
  }] });
  assert.deepEqual(normalized.entries.map(entry => entry.originalDisplayId), ['2B', 'S3A']);

  const ranges = buildPanelLedger([{
    figureId: 'figure-1', panelHints: ['\uff21\u2013\uff23', 'D\u2014F', 'Z-A', '\u00c5', 'AA']
  }]);
  assert.deepEqual(ranges.entries.map(entry => entry.panelId), ['A', 'B', 'C', 'D', 'E', 'F']);
});

test('ignores inherited and accessor-backed input without invoking getters', () => {
  const inherited = Object.create({ panelHints: ['Z'], analysis: { panels: { Y: {} } } });
  Object.defineProperty(inherited, 'figureId', { value: 'figure-1', enumerable: true });
  Object.defineProperty(inherited, 'panelHints', {
    enumerable: true,
    get() { throw new Error('must not invoke panelHints getter'); }
  });
  const panelObject = {};
  Object.defineProperty(panelObject, 'panelId', {
    enumerable: true,
    get() { throw new Error('must not invoke panelId getter'); }
  });
  const safe = { figureId: 'figure-2', panelHints: [panelObject, { panel: 'A' }] };
  assert.doesNotThrow(() => buildPanelLedger([inherited, safe]));
  assert.deepEqual(buildPanelLedger([inherited, safe]).entries.map(entry => entry.panelKey), [
    'figure-2:A'
  ]);

  const poisoned = {};
  Object.defineProperty(poisoned, 'entries', {
    enumerable: true,
    get() { throw new Error('must not invoke entries getter'); }
  });
  assert.doesNotThrow(() => normalizePanelLedger(poisoned));
  assert.equal(normalizePanelLedger(poisoned).entries.length, 0);
});

test('rejects duplicate review keys and ignores dispositions that violate their status contract', () => {
  const current = buildPanelLedger([{
    figureId: 'figure-6', panelHints: ['A', 'B', 'C', 'D']
  }]);
  assert.throws(() => mergePanelLedgerReview(current, { entries: [
    { ...current.entries[0], status: 'unlinked', statusReason: 'No edge.' },
    { ...current.entries[0], status: 'excluded', statusReason: 'Control.' }
  ] }), error => error?.code === 'PANEL_LEDGER_REVIEW_DUPLICATE');

  const merged = mergePanelLedgerReview(current, { entries: [
    { ...current.entries[0], status: 'linked', edgeIds: [] },
    { ...current.entries[1], status: 'unlinked', statusReason: '' },
    { ...current.entries[2], status: 'excluded', statusReason: 'Method control.' },
    { ...current.entries[3], status: 'ambiguous', candidatePanelKeys: ['figure-6:D'] }
  ] });
  assert.deepEqual(merged.entries.map(entry => entry.status), [
    'unreviewed', 'unreviewed', 'excluded', 'unreviewed'
  ]);
});

test('coverage audit fails closed on malformed, duplicate, unknown and overflowing assignments', () => {
  const ledger = buildPanelLedger([{
    figureId: 'figure-9', panelHints: ['A', 'B']
  }]);
  const invalid = auditPanelCoverage(ledger, {
    edges: [
      { edgeId: 'edge-1', assignments: [
        { panelKey: 'figure-9:A' }, { panelKey: 'figure-9:A' },
        { panelKey: 'figure-99:Z' }, null
      ] },
      { edgeId: 'edge-1', assignments: [{ panelKey: 'figure-9:B' }] }
    ],
    dispositions: [
      { panelKey: 'figure-9:A', status: 'linked', edgeIds: ['edge-1', 'edge-missing'] },
      { panelKey: 'figure-9:B', status: 'unlinked', reason: 'No edge.' }
    ]
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.malformed, true);
  assert.deepEqual(invalid.unknownPanelKeys, ['figure-99:Z']);
  assert.deepEqual(invalid.unknownEdgeIds, ['edge-missing']);

  const overflow = auditPanelCoverage(ledger, {
    edges: [],
    dispositions: Array.from({ length: 513 }, () => ({
      panelKey: 'figure-9:A', status: 'unlinked', reason: 'No edge.'
    }))
  });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.limitExceeded, true);

  const poisoned = {};
  Object.defineProperty(poisoned, 'dispositions', {
    get() { throw new Error('must not invoke audit getter'); }
  });
  assert.doesNotThrow(() => auditPanelCoverage(ledger, poisoned));
  assert.equal(auditPanelCoverage(ledger, poisoned).ok, false);
});

test('derives supplemental display ids from canonical real workspace identities', () => {
  const ids = [
    'figure-s1',
    'supp-manual-image-s2',
    'supp-caption-s3-s3',
    'supp-cell-supporting-information-pdf-s4',
    'supp-manual-figure-5'
  ];
  const normalized = normalizePanelLedger({ entries: ids.map(figureId => ({
    figureId, panelId: 'A', originalDisplayId: '999Z', sources: []
  })) });
  assert.deepEqual(normalized.entries.map(entry => entry.originalDisplayId), [
    'S1A', 'S2A', 'S3A', 'S4A', 'S5A'
  ]);

  const built = buildPanelLedger([{
    figureId: 'supp-manual-opaque', figureLabel: 'Supplementary Figure 6',
    isSupplemental: true, panelHints: ['A']
  }]);
  assert.equal(built.entries[0].originalDisplayId, 'SUPP-MANUAL-OPAQUE:A');
});

test('preserves a bounded alias independently from review disposition validity', () => {
  const current = buildPanelLedger([{
    figureId: 'figure-2', panelHints: ['A', 'B']
  }]);
  const merged = mergePanelLedgerReview(current, { entries: [
    { ...current.entries[0], displayAlias: '  causal control  ', status: 'linked', edgeIds: [] },
    { ...current.entries[1], displayAlias: 'Outcome readout', status: 'unreviewed' }
  ] });
  assert.deepEqual(merged.entries.map(entry => ({ alias: entry.displayAlias, status: entry.status })), [
    { alias: 'causal control', status: 'unreviewed' },
    { alias: 'Outcome readout', status: 'unreviewed' }
  ]);
});

test('coverage audit rejects unknown, self, malformed and irrelevant disposition fields', () => {
  const ledger = buildPanelLedger([{
    figureId: 'figure-10', panelHints: ['A', 'B']
  }]);
  const cases = [
    { panelKey: 'figure-10:A', status: 'ambiguous', candidatePanelKeys: ['figure-10:Z'] },
    { panelKey: 'figure-10:A', status: 'ambiguous', candidatePanelKeys: ['figure-10:A'] },
    { panelKey: 'figure-10:A', status: 'ambiguous', candidatePanelKeys: [42] },
    { panelKey: 'figure-10:A', status: 'ambiguous', candidatePanelKeys: 'figure-10:B' },
    { panelKey: 'figure-10:A', status: 'unlinked', reason: 'No edge.', edgeIds: 'edge-1' },
    { panelKey: 'figure-10:A', status: 'linked', edgeIds: ['edge-1'], candidatePanelKeys: [] }
  ];
  for (const disposition of cases) {
    const result = auditPanelCoverage(ledger, {
      edges: [{ edgeId: 'edge-1', assignments: [{ panelKey: 'figure-10:A' }] }],
      dispositions: [
        disposition,
        { panelKey: 'figure-10:B', status: 'unlinked', reason: 'No edge.' }
      ]
    });
    assert.equal(result.ok, false, JSON.stringify(disposition));
    assert.ok(result.invalidPanelKeys.includes('figure-10:A'), JSON.stringify(disposition));
  }
});

test('keeps opaque supplemental fallback identity stable across every lifecycle boundary', () => {
  const built = buildPanelLedger([{
    figureId: 'supp-manual-opaque', figureLabel: 'Supplementary Figure 6',
    isSupplemental: true, panelHints: ['A']
  }]);
  assert.equal(built.entries[0].figureDisplayId, undefined);
  assert.equal(built.entries[0].originalDisplayId, 'SUPP-MANUAL-OPAQUE:A');

  const normalized = normalizePanelLedger(structuredClone(built));
  assert.equal(normalized.entries[0].figureDisplayId, undefined);
  assert.equal(normalized.entries[0].originalDisplayId, 'SUPP-MANUAL-OPAQUE:A');

  const merged = mergePanelLedgerReview(normalized, { entries: [{
    ...normalized.entries[0],
    figureDisplayId: 'S999', originalDisplayId: 'S999A',
    displayAlias: 'Control', status: 'unlinked', statusReason: 'No mechanism edge.'
  }] });
  assert.equal(merged.entries[0].figureDisplayId, undefined);
  assert.equal(merged.entries[0].originalDisplayId, 'SUPP-MANUAL-OPAQUE:A');
  assert.equal(merged.entries[0].displayAlias, 'Control');

  const forgedMain = normalizePanelLedger({ entries: [{
    figureId: 'figure-2', panelId: 'A', figureDisplayId: 'S999',
    originalDisplayId: 'S999A', sources: []
  }] });
  assert.equal(forgedMain.entries[0].figureDisplayId, '2');
  assert.equal(forgedMain.entries[0].originalDisplayId, '2A');
});

test('never accepts cloned or serialized supplemental display metadata as self-authenticating', () => {
  const built = buildPanelLedger([{
    figureId: 'supp-manual-opaque', figureLabel: 'Supplementary Figure 6',
    isSupplemental: true, panelHints: ['A']
  }]);
  const jsonForgery = JSON.parse(JSON.stringify(built));
  jsonForgery.entries[0].figureDisplayId = 'S999';
  jsonForgery.entries[0].originalDisplayId = 'S999A';
  const normalizedJson = normalizePanelLedger(jsonForgery);
  assert.equal(normalizedJson.entries[0].figureDisplayId, undefined);
  assert.equal(normalizedJson.entries[0].originalDisplayId, 'SUPP-MANUAL-OPAQUE:A');

  const clonedForgery = structuredClone(built);
  clonedForgery.entries[0].figureDisplayId = 'S888';
  clonedForgery.entries[0].originalDisplayId = 'S888A';
  const normalizedClone = normalizePanelLedger(clonedForgery);
  assert.equal(normalizedClone.entries[0].figureDisplayId, undefined);
  assert.equal(normalizedClone.entries[0].originalDisplayId, 'SUPP-MANUAL-OPAQUE:A');

  const recognized = normalizePanelLedger({ entries: [{
    figureId: 'supp-manual-image-s2', panelId: 'A',
    figureDisplayId: 'S999', originalDisplayId: 'S999A', sources: []
  }] });
  assert.equal(recognized.entries[0].figureDisplayId, 'S2');
  assert.equal(recognized.entries[0].originalDisplayId, 'S2A');
});

test('normalizes review metadata with the same exclusive status field matrix as audit', () => {
  const current = buildPanelLedger([{
    figureId: 'figure-11', panelHints: ['A', 'B', 'C', 'D', 'E']
  }]);
  const merged = mergePanelLedgerReview(current, { entries: [
    { ...current.entries[0], displayAlias: 'A alias', status: 'linked',
      edgeIds: ['edge-1'], statusReason: 'Contradiction.' },
    { ...current.entries[1], displayAlias: 'B alias', status: 'unlinked',
      statusReason: 'No edge.', candidatePanelKeys: ['figure-11:A'] },
    { ...current.entries[2], displayAlias: 'C alias', status: 'ambiguous',
      edgeIds: ['edge-1'], candidatePanelKeys: ['figure-11:A'] },
    { ...current.entries[3], displayAlias: 'D alias', status: 'unreviewed',
      statusReason: 'Must not survive.' },
    { ...current.entries[4], displayAlias: 'E alias', status: 'ambiguous',
      candidatePanelKeys: ['figure-11:A'] }
  ] });
  assert.deepEqual(merged.entries.map(entry => entry.status), [
    'unreviewed', 'unreviewed', 'unreviewed', 'unreviewed', 'ambiguous'
  ]);
  assert.deepEqual(merged.entries.map(entry => entry.displayAlias), [
    'A alias', 'B alias', 'C alias', 'D alias', 'E alias'
  ]);
  for (const entry of merged.entries.slice(0, 4)) {
    assert.equal(entry.edgeIds, undefined);
    assert.equal(entry.statusReason, undefined);
    assert.equal(entry.candidatePanelKeys, undefined);
  }
});
