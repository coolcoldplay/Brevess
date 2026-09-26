const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const format = require('../core/literature-note-format.js');
const reading = require('../core/reading-tools.js');

// Exercise the actual production helper, not a rewritten provenance predicate.
const source = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
const start = source.indexOf('// DOM-independent popup UI helpers: start');
const end = source.indexOf('// DOM-independent popup UI helpers: end');
assert.ok(start >= 0 && end > start);
const context = { SciLLM: { ...reading, ...format } };
vm.runInNewContext(source.slice(start, end) + '\nglobalThis.helpers = PopupUiHelpers;', context);
const apply = context.helpers.applyLiteratureNoteManualInput;

function state(value) {
  return {
    schemaVersion: 3, templateId: 't',
    valuesByTemplate: { t: { f: value, untouched: '其他字段' } },
    fieldStatusByTemplate: { t: { f: 'supported', untouched: 'missing' } },
    fieldEvidenceByTemplate: { t: { f: { proof: 'original-paper' }, untouched: { proof: 'other' } } },
    fieldUpdatedAtByTemplate: { t: { f: 1, untouched: 1 } }
  };
}

test('NOTE-007 integration review: bold around a link retains its URL and evidence while advancing the edit revision', () => {
  const before = '[来源](https://example.test/paper-a)';
  const s = state(before);
  const result = format.formatLiteratureNoteSelection({ text: before, start: 1, end: 3, action: 'bold' });
  assert.equal(result.changed, true);
  const mutation = apply({ state: s, templateId: 't', fieldId: 'f', value: result.text, mutationAt: 10 });
  assert.equal(mutation.preservedEvidence, true);
  assert.equal(s.fieldStatusByTemplate.t.f, 'supported');
  assert.equal(s.fieldEvidenceByTemplate.t.f.proof, 'original-paper');
  assert.ok(s.fieldUpdatedAtByTemplate.t.f > 1);
  assert.equal(s.valuesByTemplate.t.untouched, '其他字段');
});

for (const [description, before, after] of [
  ['replacing a link destination', '[来源](https://example.test/paper-a)', '[来源](https://example.test/paper-b)'],
  ['removing a link destination', '[来源](https://example.test/paper-a)', '来源'],
  ['adding a link destination', '来源', '[来源](https://example.test/paper-b)'],
  ['moving the same link to another claim', '[增加](https://example.test/paper-a)，减少', '增加，[减少](https://example.test/paper-a)'],
  ['moving the same link between repeated labels', '[来源](https://example.test/paper-a) 与 来源', '来源 与 [来源](https://example.test/paper-a)']
]) {
  test(`NOTE-007 integration review: ${description} invalidates old provenance despite the same visible label`, () => {
    assert.equal(format.plainLiteratureNoteText(before), format.plainLiteratureNoteText(after));
    assert.equal(format.parseLiteratureNoteMarkdown(before).error, undefined);
    assert.equal(format.parseLiteratureNoteMarkdown(after).error, undefined);
    const s = state(before);
    const mutation = apply({ state: s, templateId: 't', fieldId: 'f', value: after, mutationAt: 10 });
    assert.equal(s.valuesByTemplate.t.f, after);
    assert.ok(s.fieldUpdatedAtByTemplate.t.f > 1);
    assert.equal(s.fieldEvidenceByTemplate.t.untouched.proof, 'other');
    assert.equal(mutation.preservedEvidence, false, 'A citation target is semantic content, not only presentation.');
    assert.equal(s.fieldStatusByTemplate.t.f, undefined);
    assert.equal(s.fieldEvidenceByTemplate.t.f, undefined);
  });
}
