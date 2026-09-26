const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeLiteratureNoteDocumentState } = require('../core/reading-tools.js');
const source = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
const start = source.indexOf('function mergeLiteratureNoteDocumentState(');
const end = source.indexOf('\nfunction literatureNoteTemplates(', start);
assert.ok(start >= 0 && end > start);
const merge = Function('normalizeLiteratureNoteDocumentState',
  source.slice(start, end) + '; return mergeLiteratureNoteDocumentState;')(normalizeLiteratureNoteDocumentState);
const note = (time, value = 'saved') => ({ schemaVersion: 3, templateId: 'basic_research',
  valuesByTemplate: { basic_research: { main_findings: value } },
  fieldStatusByTemplate: { basic_research: { main_findings: 'supported' } },
  fieldEvidenceByTemplate: {}, fieldUpdatedAtByTemplate: { basic_research: { main_findings: time } }, updatedAt: time });

test('a successful save acknowledgement does not invent a later unsaved document revision', () => {
  const committed = note(200), draft = note(100, 'before');
  const acknowledged = merge(committed, draft, new Set());
  assert.equal(acknowledged.updatedAt, committed.updatedAt);
  assert.deepEqual(JSON.parse(JSON.stringify(acknowledged.valuesByTemplate)), committed.valuesByTemplate);
  assert.deepEqual(JSON.parse(JSON.stringify(acknowledged.fieldUpdatedAtByTemplate)), committed.fieldUpdatedAtByTemplate);
  assert.deepEqual(merge(committed, acknowledged, new Set()), acknowledged);
});
test('a newer pending field survives an older acknowledgement with its actual mutation revision', () => {
  const committed = note(200), draft = note(300, 'new manual edit');
  const merged = merge(committed, draft, new Set(['basic_research\u0000main_findings']));
  assert.equal(merged.updatedAt, 300);
  assert.equal(merged.valuesByTemplate.basic_research.main_findings, 'new manual edit');
  assert.equal(merged.fieldUpdatedAtByTemplate.basic_research.main_findings, 300);
  assert.equal(committed.valuesByTemplate.basic_research.main_findings, 'saved');
});
test('workspace merge retains a later unrelated committed revision without manufacturing another', () => {
  const committed = note(500), draft = note(300, 'explicit clear');
  draft.valuesByTemplate = {};
  draft.fieldStatusByTemplate.basic_research.main_findings = 'missing';
  const merged = merge(committed, draft, new Set(['basic_research\u0000main_findings']));
  assert.equal(merged.updatedAt, 500);
  assert.equal(merged.valuesByTemplate.basic_research.main_findings, undefined);
  assert.equal(merged.fieldStatusByTemplate.basic_research.main_findings, 'missing');
  assert.equal(merged.fieldUpdatedAtByTemplate.basic_research.main_findings, 300);
});
test('empty legacy merge is not itself a user modification', () => {
  assert.equal(merge(null, null, new Set()).updatedAt, 0);
});
