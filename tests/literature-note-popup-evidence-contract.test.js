const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SciLLM = require('../core/reading-tools.js');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadPopupUiHelpers() {
  const script = read('popup.js');
  const startMarker = '// DOM-independent popup UI helpers: start';
  const endMarker = '// DOM-independent popup UI helpers: end';
  const start = script.indexOf(startMarker);
  const end = script.indexOf(endMarker);
  assert.ok(start >= 0 && end > start);
  const context = { SciLLM };
  vm.runInNewContext(
    `${script.slice(start + startMarker.length, end)}\n` +
      'globalThis.popupUiHelpers = PopupUiHelpers;',
    context
  );
  return context.popupUiHelpers;
}

function popupFunctionSource(name) {
  const script = read('popup.js');
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const signatureEnd = script.indexOf(') {', start);
  assert.ok(signatureEnd >= 0);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === '{') depth += 1;
    if (script[index] === '}') depth -= 1;
    if (depth === 0) return script.slice(start, index + 1);
  }
  throw new Error(`${name} must have a complete body`);
}

function loadPopupDocumentStateFunctions() {
  return Function('SciLLM',
    `${popupFunctionSource('normalizeLiteratureNoteDocumentState')}\n` +
    `${popupFunctionSource('mergeLiteratureNoteDocumentState')}\n` +
    'return { normalizeLiteratureNoteDocumentState, mergeLiteratureNoteDocumentState };'
  )(SciLLM);
}

function evidence(label = 'a', overrides = {}) {
  const documentHash = label.repeat(64);
  const quote = `Evidence ${label}`;
  const binding = {
    documentId: `sha256:${documentHash}`,
    documentHash,
    documentGeneration: 2,
    revision: 7,
    semanticCacheKey: `cache-${label}`,
    semanticProvenanceKey: `proof-${label}`
  };
  const locator = {
    locatorKind: 'pdf-semantic',
    ...binding,
    paragraphId: `semantic-${label}`,
    normalizedStart: 100,
    normalizedEnd: 100 + quote.length,
    expectedNormalizedQuote: quote
  };
  return {
    status: 'verified',
    precision: 'normalized-exact',
    degradedReasonCode: '',
    rebound: false,
    documentBinding: binding,
    locators: [locator],
    pageAnchor: { paragraphId: 'pdf-page-3', pageNumber: 3 },
    ...overrides
  };
}

test('whole-table and single-field AI merges preserve evidence outside accepted targets', () => {
  const { applyLiteratureNoteAutofillResult } = loadPopupUiHelpers();
  const template = { id: 'basic_research', fields: [
    { id: 'background' }, { id: 'methods' }, { id: 'manual' }
  ] };
  const originalManualEvidence = evidence('m');
  const state = {
    schemaVersion: 3,
    templateId: template.id,
    valuesByTemplate: { basic_research: { manual: 'Reader text' } },
    fieldStatusByTemplate: { basic_research: { manual: 'supported' } },
    fieldEvidenceByTemplate: { basic_research: { manual: originalManualEvidence } }
  };
  const backgroundEvidence = evidence('a');
  const missingEvidence = evidence('b', {
    status: 'missing', precision: 'none',
    degradedReasonCode: 'SOURCE_NOT_FOUND',
    documentBinding: evidence('b').documentBinding,
    locators: [], pageAnchor: null
  });
  applyLiteratureNoteAutofillResult({
    template,
    state,
    initialValues: { manual: 'Reader text' },
    result: {
      values: { background: 'Grounded', methods: '', manual: 'Overwrite' },
      fieldStatus: { background: 'supported', methods: 'missing', manual: 'supported' },
      sources: { background: ['semantic-a'], methods: [], manual: ['semantic-m'] },
      fieldEvidence: {
        background: backgroundEvidence,
        methods: missingEvidence,
        manual: evidence('z')
      }
    }
  });
  assert.deepEqual(plain(state.fieldEvidenceByTemplate.basic_research.background),
    plain(backgroundEvidence));
  assert.deepEqual(plain(state.fieldEvidenceByTemplate.basic_research.methods),
    plain(missingEvidence));
  assert.deepEqual(plain(state.fieldEvidenceByTemplate.basic_research.manual),
    plain(originalManualEvidence));

  const untouched = JSON.stringify({
    value: state.valuesByTemplate.basic_research.manual,
    status: state.fieldStatusByTemplate.basic_research.manual,
    evidence: state.fieldEvidenceByTemplate.basic_research.manual
  });
  const replacementEvidence = evidence('c');
  applyLiteratureNoteAutofillResult({
    template: { ...template, fields: [{ id: 'background' }] },
    state,
    initialValues: { background: 'Grounded' },
    replaceFieldIds: ['background'],
    result: {
      values: { background: 'Regenerated' },
      fieldStatus: { background: 'supported' },
      sources: { background: ['semantic-c'] },
      fieldEvidence: { background: replacementEvidence }
    }
  });
  assert.equal(state.valuesByTemplate.basic_research.background, 'Regenerated');
  assert.deepEqual(plain(state.fieldEvidenceByTemplate.basic_research.background),
    plain(replacementEvidence));
  assert.equal(JSON.stringify({
    value: state.valuesByTemplate.basic_research.manual,
    status: state.fieldStatusByTemplate.basic_research.manual,
    evidence: state.fieldEvidenceByTemplate.basic_research.manual
  }), untouched);
});

test('manual edits clear evidence and persistence delta explicitly carries the clear', async () => {
  const {
    applyLiteratureNoteManualInput,
    createLiteratureNotePersistenceCoordinator
  } = loadPopupUiHelpers();
  const key = 'basic_research\u0000background';
  let state = {
    schemaVersion: 3,
    templateId: 'basic_research',
    valuesByTemplate: { basic_research: { background: 'AI text' } },
    fieldStatusByTemplate: { basic_research: { background: 'supported' } },
    fieldEvidenceByTemplate: { basic_research: { background: evidence('a') } }
  };
  const revisions = new Map([[key, 1]]);
  applyLiteratureNoteManualInput({
    state, templateId: 'basic_research', fieldId: 'background', value: '',
    mutationAt: 20
  });
  assert.equal(state.fieldEvidenceByTemplate.basic_research?.background, undefined);
  assert.equal(state.fieldUpdatedAtByTemplate.basic_research.background, 20);

  let capturedDelta;
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: plain,
    merge: (_committed, live) => live,
    getState: () => state,
    setState: next => { state = next; },
    getDirtyRevisions: () => revisions,
    clearDirtyRevision: () => revisions.clear()
  });
  await coordinator.save(async ({ delta, snapshot }) => {
    capturedDelta = plain(delta);
    return { state: snapshot, clearDirty: true };
  });
  assert.equal(capturedDelta.fields[0].evidence, null);
  assert.equal(capturedDelta.fields[0].value, '');
  assert.equal(capturedDelta.fields[0].fieldUpdatedAt, 20);

  const reopened = SciLLM.normalizeLiteratureNoteDocumentState({
    ...plain(state),
    fieldEvidenceByTemplate: {}
  });
  assert.equal(reopened.schemaVersion, 3);
  assert.equal(reopened.valuesByTemplate.basic_research?.background, undefined);
  assert.equal(reopened.fieldEvidenceByTemplate.basic_research?.background, undefined);
  assert.equal(reopened.fieldUpdatedAtByTemplate.basic_research.background, 20);
});

test('save and reopen retains generated field evidence', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  const key = 'basic_research\u0000background';
  const generatedEvidence = evidence('s');
  let state = {
    schemaVersion: 3,
    templateId: 'basic_research',
    valuesByTemplate: { basic_research: { background: 'Saved AI text' } },
    fieldStatusByTemplate: { basic_research: { background: 'supported' } },
    fieldEvidenceByTemplate: { basic_research: { background: generatedEvidence } }
  };
  const revisions = new Map([[key, 4]]);
  let saved;
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: plain,
    merge: committed => committed,
    getState: () => state,
    setState: next => { state = next; },
    getDirtyRevisions: () => revisions,
    clearDirtyRevision: () => revisions.clear()
  });
  await coordinator.save(async ({ delta, snapshot }) => {
    assert.deepEqual(plain(delta.fields[0].evidence), plain(generatedEvidence));
    saved = plain(snapshot);
    return { state: snapshot, clearDirty: true };
  });
  const reopened = SciLLM.normalizeLiteratureNoteDocumentState(saved);
  assert.equal(reopened.valuesByTemplate.basic_research.background, 'Saved AI text');
  assert.deepEqual(plain(reopened.fieldEvidenceByTemplate.basic_research.background),
    plain(generatedEvidence));
});

test('source state labels and focus payload are precision-bounded', () => {
  const {
    describeLiteratureNoteFieldEvidence,
    createLiteratureNoteEvidenceFocusTarget,
    applyLiteratureNoteEvidenceElementState
  } = loadPopupUiHelpers();
  const verified = evidence('a');
  const pageOnly = evidence('p', {
    status: 'degraded', precision: 'page-only',
    degradedReasonCode: 'SEMANTIC_LOCATOR_UNAVAILABLE',
    documentBinding: evidence('p').documentBinding,
    locators: [], pageAnchor: { paragraphId: 'pdf-page-9', pageNumber: 9 }
  });
  const historical = {
    status: 'historical-unsaved', precision: 'none',
    degradedReasonCode: 'HISTORICAL_EVIDENCE_NOT_SAVED', rebound: false,
    documentBinding: null, locators: [], pageAnchor: null
  };
  assert.deepEqual(plain(describeLiteratureNoteFieldEvidence(verified)), {
    kind: 'verified', label: '正文来源 1', trusted: true, focusable: true
  });
  assert.deepEqual(plain(describeLiteratureNoteFieldEvidence(pageOnly)), {
    kind: 'page-only', label: '页级·待核验', trusted: false, focusable: true
  });
  assert.deepEqual(plain(describeLiteratureNoteFieldEvidence(historical)), {
    kind: 'historical', label: '历史内容，来源未保存', trusted: false, focusable: false
  });
  for (const status of ['stale', 'ambiguous', 'missing', 'invalid']) {
    const record = { ...pageOnly, status, precision: 'none', pageAnchor: null };
    assert.equal(describeLiteratureNoteFieldEvidence(record).trusted, false);
    assert.ok(describeLiteratureNoteFieldEvidence(record).label.length > 0);
    assert.equal(describeLiteratureNoteFieldEvidence(record).focusable, false);
  }

  const target = createLiteratureNoteEvidenceFocusTarget(verified);
  assert.equal(target.kind, 'article-chat-citation');
  assert.equal(target.documentRevision, 7);
  assert.deepEqual(plain(target.evidence.locator), plain(verified.locators[0]));
  assert.equal(target.evidence.quote, verified.locators[0].expectedNormalizedQuote);
  assert.equal(target.evidence.paragraphId, 'semantic-a');
  assert.equal(createLiteratureNoteEvidenceFocusTarget(historical), null);

  const pageTarget = createLiteratureNoteEvidenceFocusTarget(pageOnly);
  assert.deepEqual(plain(pageTarget.evidence.pageAnchor),
    { paragraphId: 'pdf-page-9', pageNumber: 9 });
  assert.equal(pageTarget.evidence.quote, undefined);

  const element = {
    dataset: {},
    setAttribute(name, value) { this[name] = value; }
  };
  applyLiteratureNoteEvidenceElementState(element, verified);
  assert.equal(element.hidden, false);
  assert.equal(element.disabled, false);
  assert.equal(element.textContent, '正文来源 1');
  assert.equal(element.dataset.evidenceTrusted, 'true');
  applyLiteratureNoteEvidenceElementState(element, pageOnly);
  assert.equal(element.textContent, '页级·待核验');
  assert.equal(element.dataset.evidenceTrusted, 'false');
  applyLiteratureNoteEvidenceElementState(element, { ...pageOnly, status: 'stale',
    precision: 'none', pageAnchor: null });
  assert.equal(element.hidden, false);
  assert.equal(element.disabled, true);
  assert.equal(element.textContent, '来源已过期，待重新核验');
});

test('a normalized v2 field renders the historical-source label', () => {
  const { describeLiteratureNoteFieldEvidence } = loadPopupUiHelpers();
  const migrated = SciLLM.normalizeLiteratureNoteDocumentState({
    schemaVersion: 2,
    templateId: 'basic_research',
    valuesByTemplate: { basic_research: { background: 'Legacy note' } },
    fieldStatusByTemplate: { basic_research: { background: 'supported' } }
  });
  assert.equal(migrated.valuesByTemplate.basic_research.background, 'Legacy note');
  assert.equal(migrated.fieldStatusByTemplate.basic_research.background, 'supported');
  assert.equal(describeLiteratureNoteFieldEvidence(
    migrated.fieldEvidenceByTemplate.basic_research.background
  ).label, '历史内容，来源未保存');
});

test('popup dirty merge makes a newer missing field authoritative over an old value', () => {
  const { mergeLiteratureNoteDocumentState } = loadPopupDocumentStateFunctions();
  const missingEvidence = evidence('m', {
    status: 'missing', precision: 'none', degradedReasonCode: 'SOURCE_NOT_FOUND',
    documentBinding: evidence('m').documentBinding, locators: [], pageAnchor: null
  });
  const latest = {
    schemaVersion: 3,
    templateId: 'basic_research',
    valuesByTemplate: { basic_research: { background: 'Old workspace value' } },
    fieldStatusByTemplate: { basic_research: { background: 'supported' } },
    fieldEvidenceByTemplate: { basic_research: { background: evidence('o') } },
    fieldUpdatedAtByTemplate: { basic_research: { background: 10 } },
    updatedAt: 10
  };
  const current = {
    schemaVersion: 3,
    templateId: 'basic_research',
    valuesByTemplate: {},
    fieldStatusByTemplate: { basic_research: { background: 'missing' } },
    fieldEvidenceByTemplate: { basic_research: { background: missingEvidence } },
    fieldUpdatedAtByTemplate: { basic_research: { background: 20 } },
    updatedAt: 20
  };
  const merged = mergeLiteratureNoteDocumentState(
    latest, current, new Set(['basic_research\u0000background'])
  );
  assert.equal(merged.valuesByTemplate.basic_research?.background, undefined);
  assert.equal(merged.fieldStatusByTemplate.basic_research.background, 'missing');
  assert.deepEqual(plain(merged.fieldEvidenceByTemplate.basic_research.background),
    plain(missingEvidence));
  assert.equal(merged.fieldUpdatedAtByTemplate.basic_research.background, 20);
});

test('first popup field clock freezes every legacy sibling at the old document time', () => {
  const { markLiteratureNoteFieldUpdated } = loadPopupUiHelpers();
  const state = {
    schemaVersion: 2,
    valuesByTemplate: {
      basic_research: { field_a: 'A', field_b: 'B' }
    },
    fieldStatusByTemplate: {},
    fieldEvidenceByTemplate: {},
    updatedAt: 100
  };
  assert.equal(markLiteratureNoteFieldUpdated(
    state, 'basic_research', 'field_a', 200
  ), 200);
  assert.equal(state.fieldUpdatedAtByTemplate.basic_research.field_a, 200);
  assert.equal(state.fieldUpdatedAtByTemplate.basic_research.field_b, 100);
  assert.equal(state.updatedAt, 200);
});

test('popup runtime delegates document-state normalization to core schema v3', () => {
  const script = read('popup.js');
  assert.match(script,
    /SciLLM\.normalizeLiteratureNoteDocumentState\?\.\(value\)/);
  assert.match(script, /fieldEvidenceByTemplate/);
  assert.match(script, /action:\s*'focusArticleWorkspaceSource'/);
  assert.match(script, /data-literature-note-evidence-field/);
});
