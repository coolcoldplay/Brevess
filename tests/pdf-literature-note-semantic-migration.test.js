const test = require('node:test');
const assert = require('node:assert/strict');

const readingTools = require('../core/reading-tools.js');

const DOCUMENT_HASH = 'a'.repeat(64);

function locator(overrides = {}) {
  const quote = 'Grounded semantic evidence.';
  return {
    locatorKind: 'pdf-semantic',
    documentId: 'sha256:article-a',
    documentHash: DOCUMENT_HASH,
    documentGeneration: 4,
    revision: 8,
    semanticCacheKey: 'semantic-cache-8',
    semanticProvenanceKey: 'semantic-provenance-8',
    paragraphId: 'semantic-results-1',
    normalizedStart: 0,
    normalizedEnd: quote.length,
    expectedNormalizedQuote: quote,
    ...overrides
  };
}

function evidence(overrides = {}) {
  return {
    status: 'verified',
    precision: 'normalized-exact',
    degradedReasonCode: '',
    rebound: false,
    documentBinding: {
      documentId: 'sha256:article-a',
      documentHash: DOCUMENT_HASH,
      documentGeneration: 4,
      revision: 8,
      semanticCacheKey: 'semantic-cache-8',
      semanticProvenanceKey: 'semantic-provenance-8'
    },
    locators: [locator()],
    pageAnchor: null,
    ...overrides
  };
}

function pageAnchor(pageNumber = 4) {
  return { paragraphId: `pdf-page-${pageNumber}`, pageNumber };
}

test('exports literature-note semantic evidence migration APIs', () => {
  assert.equal(typeof readingTools.normalizeLiteratureNoteEvidenceRecord, 'function');
  assert.equal(typeof readingTools.mergeLiteratureNoteFieldEvidence, 'function');
  assert.equal(typeof readingTools.mergeLiteratureNoteEvidenceTable, 'function');
});

test('upgrades v2 note values and statuses to v3 with historical-unsaved evidence', () => {
  const migrated = readingTools.normalizeLiteratureNoteDocumentState({
    schemaVersion: 2,
    templateId: 'basic_research',
    valuesByTemplate: {
      basic_research: { research_background: 'Reader-edited value' }
    },
    fieldStatusByTemplate: {
      basic_research: {
        research_background: 'supported',
        limitations: 'missing'
      }
    },
    updatedAt: 42
  });

  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.valuesByTemplate.basic_research.research_background,
    'Reader-edited value');
  assert.equal(migrated.fieldStatusByTemplate.basic_research.research_background,
    'supported');
  assert.equal(migrated.fieldStatusByTemplate.basic_research.limitations, 'missing');
  for (const fieldId of ['research_background', 'limitations']) {
    assert.deepEqual(migrated.fieldEvidenceByTemplate.basic_research[fieldId], {
      status: 'historical-unsaved',
      precision: 'none',
      degradedReasonCode: 'HISTORICAL_EVIDENCE_NOT_SAVED',
      rebound: false,
      documentBinding: null,
      locators: [],
      pageAnchor: null
    });
  }
});

test('round-trips bounded v3 evidence without position runs', () => {
  const state = readingTools.normalizeLiteratureNoteDocumentState({
    schemaVersion: 3,
    templateId: 'basic_research',
    valuesByTemplate: { basic_research: { findings: 'Grounded result' } },
    fieldStatusByTemplate: { basic_research: { findings: 'supported' } },
    fieldEvidenceByTemplate: { basic_research: { findings: evidence({
      locators: [locator(), locator({
        paragraphId: 'semantic-results-2'
      })]
    }) } }
  });

  assert.equal(state.schemaVersion, 3);
  assert.equal(state.fieldEvidenceByTemplate.basic_research.findings.locators.length, 2);
  assert.deepEqual(state.fieldEvidenceByTemplate.basic_research.findings.locators[0],
    locator());
  assert.doesNotMatch(JSON.stringify(state), /positionRuns|secret/);
});

test('persists a bounded legacy page-only evidence anchor in schema v3', () => {
  const pageOnly = evidence({
    status: 'degraded', precision: 'page-only',
    degradedReasonCode: 'PDF_LEGACY_PAGE_ANCHOR', rebound: false,
    locators: [], pageAnchor: pageAnchor(12)
  });
  const state = readingTools.normalizeLiteratureNoteDocumentState({
    schemaVersion: 3,
    fieldEvidenceByTemplate: { basic_research: { findings: pageOnly } }
  });
  assert.deepEqual(state.fieldEvidenceByTemplate.basic_research.findings, pageOnly);
  assert.equal(Object.hasOwn(
    state.fieldEvidenceByTemplate.basic_research.findings.pageAnchor, 'quote'), false);
});

test('enforces the evidence status precision rebound and anchor matrix', () => {
  const verified = evidence();
  const valid = [
    verified,
    evidence({ status: 'verified', precision: 'exact-raw', rebound: true }),
    evidence({ status: 'degraded', precision: 'page-only', rebound: false,
      degradedReasonCode: 'PDF_LEGACY_PAGE_ANCHOR', locators: [],
      pageAnchor: pageAnchor() }),
    evidence({ status: 'ambiguous', precision: 'none', rebound: false,
      degradedReasonCode: 'PDF_SEMANTIC_QUOTE_AMBIGUOUS', locators: [],
      pageAnchor: null }),
    evidence({ status: 'degraded', precision: 'none', rebound: false,
      degradedReasonCode: 'PDF_SEMANTIC_REBIND_NOT_FOUND', pageAnchor: null }),
    evidence({ status: 'ambiguous', precision: 'page-only', rebound: false,
      degradedReasonCode: 'PDF_SEMANTIC_QUOTE_AMBIGUOUS',
      pageAnchor: pageAnchor() }),
    evidence({ status: 'stale', precision: 'none', rebound: false,
      degradedReasonCode: 'PDF_DOCUMENT_CHANGED' })
  ];
  valid.forEach(item => assert.ok(
    readingTools.normalizeLiteratureNoteEvidenceRecord(item)));

  const invalid = [
    evidence({ status: 'verified', precision: 'page-only', pageAnchor: pageAnchor() }),
    evidence({ status: 'verified', locators: [], documentBinding: null }),
    evidence({ status: 'degraded', precision: 'normalized-exact',
      degradedReasonCode: 'PDF_DEGRADED' }),
    evidence({ status: 'degraded', precision: 'page-only', rebound: true,
      degradedReasonCode: 'PDF_DEGRADED', locators: [], pageAnchor: pageAnchor() }),
    evidence({ status: 'missing', precision: 'none', rebound: false,
      degradedReasonCode: 'PDF_MISSING' }),
    evidence({ status: 'invalid', precision: 'none', rebound: false,
      degradedReasonCode: 'PDF_INVALID' }),
    evidence({ status: 'historical-unsaved', precision: 'none', rebound: false,
      degradedReasonCode: 'HISTORICAL_EVIDENCE_NOT_SAVED' }),
    evidence({ status: 'degraded', precision: 'page-only', rebound: false,
      degradedReasonCode: 'PDF_DEGRADED', locators: [], pageAnchor: null }),
    evidence({ status: 'ambiguous', precision: 'none', rebound: false,
      degradedReasonCode: 'PDF_AMBIGUOUS', locators: [], pageAnchor: pageAnchor() })
  ];
  invalid.forEach(item => assert.equal(
    readingTools.normalizeLiteratureNoteEvidenceRecord(item), null));
});

test('reconcile never attaches older AI evidence to a newer manual value or cleared status', () => {
  const oldAi = {
    schemaVersion: 3,
    valuesByTemplate: { basic_research: { findings: 'AI value A' } },
    fieldStatusByTemplate: { basic_research: { findings: 'supported' } },
    fieldEvidenceByTemplate: { basic_research: { findings: evidence() } },
    updatedAt: 10
  };
  const manualValue = {
    schemaVersion: 3,
    valuesByTemplate: { basic_research: { findings: 'Manual value B' } },
    fieldStatusByTemplate: {}, fieldEvidenceByTemplate: {}, updatedAt: 20
  };
  const valueMerged = readingTools.reconcileLiteratureNoteDocumentStates(
    oldAi, manualValue);
  assert.equal(valueMerged.valuesByTemplate.basic_research.findings, 'Manual value B');
  assert.equal(valueMerged.fieldStatusByTemplate.basic_research?.findings, undefined);
  assert.equal(valueMerged.fieldEvidenceByTemplate.basic_research?.findings, undefined);

  const statusCleared = {
    ...manualValue,
    valuesByTemplate: { basic_research: { findings: 'AI value A' } }
  };
  const statusMerged = readingTools.reconcileLiteratureNoteDocumentStates(
    oldAi, statusCleared);
  assert.equal(statusMerged.fieldStatusByTemplate.basic_research?.findings, undefined);
  assert.equal(statusMerged.fieldEvidenceByTemplate.basic_research?.findings, undefined);
});

test('single-field evidence merge changes only its target evidence field', () => {
  const state = readingTools.normalizeLiteratureNoteDocumentState({
    schemaVersion: 3,
    templateId: 'basic_research',
    valuesByTemplate: { basic_research: {
      findings: 'Manual findings bytes: 1. A; 2. B',
      limitations: 'Manual limitations bytes.'
    } },
    fieldStatusByTemplate: { basic_research: {
      findings: 'supported', limitations: 'supported'
    } },
    fieldEvidenceByTemplate: { basic_research: {
      findings: evidence({ status: 'degraded', precision: 'page-only',
        degradedReasonCode: 'OLD', locators: [] }),
      limitations: evidence({ locators: [locator({ paragraphId: 'semantic-limitations' })] })
    } },
    updatedAt: 77
  });
  const valuesBefore = JSON.stringify(state.valuesByTemplate);
  const statusesBefore = JSON.stringify(state.fieldStatusByTemplate);
  const otherBefore = JSON.stringify(
    state.fieldEvidenceByTemplate.basic_research.limitations);

  const merged = readingTools.mergeLiteratureNoteFieldEvidence(state, {
    templateId: 'basic_research', fieldId: 'findings', evidence: evidence()
  });

  assert.equal(JSON.stringify(merged.valuesByTemplate), valuesBefore);
  assert.equal(JSON.stringify(merged.fieldStatusByTemplate), statusesBefore);
  assert.equal(JSON.stringify(
    merged.fieldEvidenceByTemplate.basic_research.limitations), otherBefore);
  assert.deepEqual(merged.fieldEvidenceByTemplate.basic_research.findings, evidence());
  assert.equal(merged.updatedAt, 77);
  assert.equal(Object.isFrozen(merged), true);
  assert.equal(Object.isFrozen(
    merged.fieldEvidenceByTemplate.basic_research.findings), true);
});

test('whole-table evidence merge updates every target and preserves unrelated fields', () => {
  const state = readingTools.normalizeLiteratureNoteDocumentState({
    schemaVersion: 3,
    templateId: 'basic_research',
    valuesByTemplate: { basic_research: {
      findings: 'Manual finding', limitations: 'Manual limitation', untouched: 'Keep'
    } },
    fieldStatusByTemplate: { basic_research: {
      findings: 'supported', limitations: 'supported', untouched: 'supported'
    } },
    fieldEvidenceByTemplate: { basic_research: {
      findings: evidence({ status: 'stale', precision: 'none',
        degradedReasonCode: 'OLD_FINDINGS' }),
      limitations: evidence({ status: 'stale', precision: 'none',
        degradedReasonCode: 'OLD_LIMITATIONS' }),
      untouched: evidence({ status: 'stale', precision: 'none',
        degradedReasonCode: 'KEEP_ME' })
    } }
  });
  const untouched = JSON.stringify(
    state.fieldEvidenceByTemplate.basic_research.untouched);
  const values = JSON.stringify(state.valuesByTemplate);
  const statuses = JSON.stringify(state.fieldStatusByTemplate);
  const degraded = evidence({ status: 'degraded', precision: 'page-only',
    degradedReasonCode: 'PDF_LEGACY_PAGE_ANCHOR', locators: [],
    pageAnchor: pageAnchor() });

  const merged = readingTools.mergeLiteratureNoteEvidenceTable(state, {
    templateId: 'basic_research', evidenceByField: {
      findings: evidence({ rebound: true }),
      limitations: degraded
    }
  });

  assert.equal(JSON.stringify(merged.valuesByTemplate), values);
  assert.equal(JSON.stringify(merged.fieldStatusByTemplate), statuses);
  assert.deepEqual(merged.fieldEvidenceByTemplate.basic_research.findings,
    evidence({ rebound: true }));
  assert.deepEqual(merged.fieldEvidenceByTemplate.basic_research.limitations, degraded);
  assert.equal(JSON.stringify(
    merged.fieldEvidenceByTemplate.basic_research.untouched), untouched);
});

test('bounds evidence arrays and rejects getters, polluted records and invalid identities', () => {
  let getterCalls = 0;
  const accessor = Object.create(null, {
    status: { enumerable: true, get() { getterCalls += 1; return 'verified'; } }
  });
  const polluted = Object.create({ inherited: true });
  Object.assign(polluted, evidence());
  const invalid = [
    accessor,
    polluted,
    { ...evidence(), unknown: true },
    evidence({ locators: Array.from({ length: 13 }, () => locator()) }),
    evidence({ locators: [locator({ semanticCacheKey: '' })] }),
    evidence({ locators: [{ ...locator(), positionRuns: [{ secret: true }] }, locator()] }),
    evidence({ locators: [locator({ normalizedStart: 20000000,
      normalizedEnd: 20000001, expectedNormalizedQuote: 'x' })] })
  ];

  invalid.forEach(item => assert.equal(
    readingTools.normalizeLiteratureNoteEvidenceRecord(item), null));
  assert.equal(getterCalls, 0);
});

test('rejects malformed page anchors and revoked locator arrays without throwing', () => {
  const invalidAnchors = [
    { paragraphId: 'pdf-page-4', pageNumber: 5 },
    { paragraphId: 'semantic-results-1', pageNumber: 4 },
    { paragraphId: 'pdf-page-4', pageNumber: 4, quote: 'unknown key' }
  ];
  invalidAnchors.forEach(anchor => assert.equal(
    readingTools.normalizeLiteratureNoteEvidenceRecord(evidence({
      status: 'degraded', precision: 'page-only', rebound: false,
      degradedReasonCode: 'PDF_LEGACY_PAGE_ANCHOR', locators: [], pageAnchor: anchor
    })), null));

  const locators = Proxy.revocable([locator()], {});
  locators.revoke();
  assert.doesNotThrow(() => assert.equal(
    readingTools.normalizeLiteratureNoteEvidenceRecord(evidence({
      locators: locators.proxy
    })), null));
});

test('rejects unknown merge structures without touching the source state', () => {
  const state = readingTools.normalizeLiteratureNoteDocumentState({
    schemaVersion: 3,
    valuesByTemplate: { basic_research: { findings: 'Manual bytes' } }
  });
  const sourceBytes = JSON.stringify(state);
  assert.equal(readingTools.mergeLiteratureNoteFieldEvidence(state, {
    templateId: 'basic_research', fieldId: 'findings', evidence: evidence(), extra: true
  }), null);
  assert.equal(readingTools.mergeLiteratureNoteEvidenceTable(state, {
    templateId: 'basic_research', evidenceByField: {}, extra: true
  }), null);
  assert.equal(JSON.stringify(state), sourceBytes);
});

test('normalization never executes unknown values or revoked evidence proxies', () => {
  let coercionCalls = 0;
  const unknownValue = {
    toString() { coercionCalls += 1; return 'must not be accepted'; }
  };
  const state = readingTools.normalizeLiteratureNoteDocumentState({
    schemaVersion: 3,
    valuesByTemplate: { basic_research: { findings: unknownValue } }
  });
  assert.equal(coercionCalls, 0);
  assert.deepEqual({ ...state.valuesByTemplate }, {});

  const revocable = Proxy.revocable(evidence(), {});
  revocable.revoke();
  assert.doesNotThrow(() => assert.equal(
    readingTools.normalizeLiteratureNoteEvidenceRecord(revocable.proxy), null));
});

test('literature-note normalization preserves legacy evidence above the quote budget', () => {
  const fieldEvidenceByTemplate = {};
  for (let templateIndex = 0; templateIndex < 2; templateIndex += 1) {
    const fields = {};
    for (let fieldIndex = 0; fieldIndex < 40; fieldIndex += 1) {
      const quote = 'q'.repeat(4000);
      fields[`field_${fieldIndex}`] = evidence({
        locators: [locator({
          paragraphId: `semantic-${templateIndex}-${fieldIndex}`,
          normalizedStart: 0,
          normalizedEnd: quote.length,
          expectedNormalizedQuote: quote
        })]
      });
    }
    fieldEvidenceByTemplate[`template_${templateIndex}`] = fields;
  }
  const normalized = readingTools.normalizeLiteratureNoteDocumentState({
    schemaVersion: 3, fieldEvidenceByTemplate, updatedAt: 60
  });
  assert.equal(normalized.fieldEvidenceByTemplate.template_0.field_0
    .locators[0].expectedNormalizedQuote.length, 4000);
  assert.equal(normalized.updatedAt, 60);
  assert.equal(readingTools.measureLiteratureNoteDocumentState(normalized)
    .withinBudget, false);
});
