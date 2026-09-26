const test = require('node:test');
const assert = require('node:assert/strict');
const {
  projectLiteratureNoteSources: project,
  restoreLiteratureNoteSources: restore,
  serializeLiteratureNoteSourceProjection: serialize
} = require('../core/literature-note-sources.js');

const A = 'p-07b442fb743ae472';
const B = 'p-249532d536b26230';

for (const [label, text] of [
  ['multiline inline code', '`sample\n(' + A + ')\nend`'],
  ['multiline code with CRLF', '``sample\r\n(' + A + ')\r\nend``'],
  ['code fence inside a blockquote', '> ```text\n> (' + A + ')\n> ```'],
  ['nested quoted code fence', '> > ~~~text\n> > (' + A + ')\n> > ~~~'],
  ['quoted code fence inside a list', '- > ```text\n  > (' + A + ')\n  > ```'],
  ['bare FTP URL path', 'ftp://example.test/archive/(' + A + ')'],
  ['URI scheme containing plus', 'git+ssh://example.test/archive/(' + A + ')'],
  ['opaque URI', 'urn:example:(' + A + ')'],
  ['reference link label', '[(' + A + ')][paper]\n\n[paper]: https://example.test/paper'],
  ['collapsed reference label', '[(' + A + ')][]\n\n[(' + A + ')]: https://example.test/paper'],
  ['shortcut reference label', '[(' + A + ')]\n\n[(' + A + ')]: https://example.test/paper'],
  ['escaped reference label', '[(' + A + ')\\]]\n\n[(' + A + ')\\]]: https://example.test/paper'],
  ['reference destination on the next line', '[paper]:\n  (' + A + ')']
]) {
  test(`NOTE-007 sources review: preserve ${label} as literal content`, () => {
    const p = project(text);
    assert.equal(p.ok, true);
    assert.equal(p.canonicalText, text);
    assert.equal(p.displayText, text, 'Source projection must not rewrite code or URL content.');
    assert.equal(p.references.length, 0);
    assert.equal(serialize(p), text);
  });
}

test('NOTE-007 sources review: prose following a multiline code span remains independently projectable', () => {
  const code = '`sample\n(' + A + ')\nend`';
  const p = project(code + '\n\n正文 (' + B + ')');
  assert.equal(p.ok, true);
  assert.ok(p.displayText.startsWith(code));
  assert.deepEqual(p.references.map(ref => ref.sourceIds), [[B]]);
  assert.equal(restore(p, p.displayText).canonicalText, p.canonicalText);
});

test('NOTE-007 sources review: ending a quoted code fence does not mask the following source', () => {
  const code = '> ```text\n> (' + A + ')\n> ```';
  const p = project(code + '\n正文 (' + B + ')');
  assert.equal(p.ok, true);
  assert.ok(p.displayText.startsWith(code));
  assert.deepEqual(p.references.map(ref => ref.sourceIds), [[B]]);
});

test('NOTE-007 sources review: a missing backtick does not mask a new paragraph citation', () => {
  const p = project('`unclosed\n\n正文 (' + B + ')');
  assert.equal(p.ok, true);
  assert.deepEqual(p.references.map(ref => ref.sourceIds), [[B]]);
});

test('NOTE-007 sources review: an empty reference definition does not consume a following code fence', () => {
  const text = '[paper]:\n```text\n(' + A + ')\n```';
  const p = project(text);
  assert.equal(p.ok, true);
  assert.equal(p.displayText, text);
  assert.equal(p.references.length, 0);
});

test('NOTE-007 sources review: damage after partial source deletion preserves the latest canonical value', () => {
  const initial = project(`原论断 (${A})；其他论断 (${B})。`);
  const first = initial.references[0];
  const withoutFirst = initial.displayText.slice(0, first.start) + initial.displayText.slice(first.end);
  const deleted = restore(initial, withoutFirst);
  assert.equal(deleted.ok, true);
  const advanced = restore(deleted.nextProjection, deleted.displayText.replace('原论断', '修改后的论断'));
  assert.equal(advanced.ok, true);
  const survivor = advanced.nextProjection.references[0];
  assert.equal(survivor.index, 1);
  assert.deepEqual(survivor.sourceNumbers, [2]);
  const damaged = advanced.displayText.slice(0, survivor.start + 1) + advanced.displayText.slice(survivor.start + 2);
  const rejected = restore(advanced.nextProjection, damaged);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.canonicalText, `修改后的论断 ；其他论断 (${B})。`);
  assert.equal(rejected.displayText, advanced.displayText);
});

test('NOTE-007 sources review: replacement undo and redo need the retained registry plus edit history', () => {
  const original = project(`前文 (${A}) 后文`);
  const replacement = '替换后的科学正文';
  const replaceAll = { start: 0, end: original.displayText.length, text: replacement };
  const replaced = restore(original, replacement, { edits: [replaceAll] });
  assert.equal(replaced.ok, true);
  assert.equal(replaced.nextProjection.references.length, 0);
  assert.equal(replaced.nextProjection.registry.length, 1);
  const undone = restore(replaced.nextProjection, original.displayText);
  assert.equal(undone.ok, true);
  assert.equal(undone.canonicalText, original.canonicalText);
  const unprovenRedo = restore(undone.nextProjection, replacement);
  assert.equal(unprovenRedo.ok, false);
  assert.equal(unprovenRedo.error, 'NOTE_SOURCE_EDIT_HISTORY_REQUIRED');
  assert.equal(unprovenRedo.canonicalText, original.canonicalText);
  const redone = restore(undone.nextProjection, replacement, { edits: [replaceAll] });
  assert.equal(redone.ok, true);
  assert.equal(redone.canonicalText, replacement);
});

test('NOTE-007 sources review: recreating a projection after deletion cannot decode the old native undo token', () => {
  const original = project(`前文 (${A}) 后文`);
  const ref = original.references[0];
  const display = original.displayText.slice(0, ref.start) + original.displayText.slice(ref.end);
  const deleted = restore(original, display);
  assert.equal(deleted.ok, true);
  const retained = restore(deleted.nextProjection, original.displayText);
  assert.equal(retained.ok, true);
  assert.equal(retained.canonicalText, original.canonicalText);
  const recreated = project(deleted.canonicalText);
  const noRegistry = restore(recreated, original.displayText);
  assert.equal(noRegistry.ok, true);
  assert.notEqual(noRegistry.canonicalText, original.canonicalText);
  assert.equal(noRegistry.canonicalText, original.displayText, 'Without the registry an old token is only literal text.');
});
