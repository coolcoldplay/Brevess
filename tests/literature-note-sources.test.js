const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.join(__dirname, '../core/literature-note-sources.js');
const api = fs.existsSync(file) ? require(file) : {};
const A = 'p-07b442fb743ae472';
const B = 'p-249532d536b26230';
const project = (...args) => {
  assert.equal(typeof api.projectLiteratureNoteSources, 'function', 'source projection API is missing');
  return api.projectLiteratureNoteSources(...args);
};
const restore = (...args) => api.restoreLiteratureNoteSources(...args);

test('sources API preserves canonical bytes and reversible ranges for a known screenshot form', () => {
  const source = `3. 未见增加，p = 0.05（ ${A}、${B} ）\r\n  - 对照 (${A})。`;
  const p = project(source);
  assert.equal(p.ok, true);
  assert.equal(p.canonicalText, source);
  assert.equal(p.references.length, 2);
  assert.deepEqual(p.references[0].sourceIds, [A, B]);
  assert.deepEqual(p.references.map(r => r.sourceNumbers), [[1, 2], [1]]);
  for (const r of p.references) {
    assert.equal(source.slice(r.canonicalStart, r.canonicalEnd), r.raw);
    assert.equal(p.displayText.slice(r.start, r.end), r.marker);
    assert.match(r.marker, /待核验/);
    assert.doesNotMatch(r.marker, /p-[a-f0-9]/);
  }
  assert.equal(restore(p, p.displayText).canonicalText, source);
  assert.deepEqual(p.tokenRanges, p.references.map(r => ({ start: r.start, end: r.end })));
});

test('only exact caller-known source IDs supplement the current 16 lowercase hex grammar', () => {
  const source = '(p-03e11aa7449a007) (pdf-paragraph:abc) (semantic-a) (p-AKT)';
  assert.equal(project(source).references.length, 0);
  const p = project(source, { knownSourceIds: ['p-03e11aa7449a007', 'semantic-a'] });
  assert.deepEqual(p.references.map(r => r.sourceIds), [['p-03e11aa7449a007'], ['semantic-a']]);
  assert.ok(p.displayText.includes('(pdf-paragraph:abc)'));
  assert.ok(p.displayText.includes('(p-AKT)'));
});

test('mixed scientific prose, bare IDs, malformed and mismatched groups remain byte-identical', () => {
  for (const source of [`p-AKT p-value p-ERK ${A}`, `(p = 0.05; ${A})`, `(see ${A})`,
    `(${A}；${B})`, `(${A} ${B})`, `(${A},)`, `(${A}，${B}）`,
    `(p-07B442fb743ae472)`, `(${A}x)`, `(${A} (${B}))`, `\\(${A})`]) {
    assert.equal(project(source).displayText, source, source);
  }
});

test('inline/fenced/indented code and Markdown links/targets/autolinks are not projected', () => {
  const cases = [`\`(${A})\``, `\`\`(${A})\`\``, `\`(${A})`,
    `\`\`\`js\n(${A})\n\`\`\``, `~~~\n(${A})\n~~~`, `    (${A})`, `\t(${A})`,
    `[label](${A})`, `[(${A})](https://example.org)`, `[label](https://example.org/(${A}))`,
    `[ref]: (${A})`, `<https://example.org/(${A})>`, `https://example.org/(${A})`,
    `<span title="(${A})">literal</span>`];
  for (const source of cases) assert.equal(project(source).displayText, source, source);
  const p = project(`\`(${A})\` then (${B})`);
  assert.deepEqual(p.references.map(r => r.sourceIds), [[B]]);
});

test('duplicate IDs retain source order and repeated group occurrences remain distinct', () => {
  const p = project(`(${A}、${A}、${B}) (${A}、${A}、${B})`);
  assert.deepEqual(p.references[0].sourceIds, [A, A, B]);
  assert.deepEqual(p.references[0].sourceNumbers, [1, 1, 2]);
  assert.notEqual(p.references[0].marker, p.references[1].marker);
  assert.equal(restore(p, p.displayText).canonicalText, p.canonicalText);
});

test('existing source-looking prose and marker-looking prose do not collide', () => {
  const initial = project(`(${A})`);
  const source = `来源1 来源 1 ⟦引文⟧ ${initial.references[0].marker} (${A})`;
  const p = project(source);
  assert.notEqual(p.references[0].marker, initial.references[0].marker);
  assert.ok(p.displayText.startsWith(source.slice(0, source.lastIndexOf('('))));
  assert.equal(restore(p, p.displayText).canonicalText, source);
});

test('editing ordinary prose and wrapping an intact source token preserve canonical anchors', () => {
  const p = project(`未见增加 (${A})。`);
  const marker = p.references[0].marker;
  for (const formatted of [`**${marker}**`, `<span data-brevess-color="red">${marker}</span>`]) {
    const edited = `仍未见增加 ${formatted}。`;
    const result = restore(p, edited);
    assert.equal(result.ok, true);
    assert.equal(result.canonicalText, edited.replace(marker, `(${A})`));
  }
});

test('deleting an entire source marker is an explicit deletion without changing surrounding bytes', () => {
  const p = project(`before (${A}) after (${B}).`);
  const r = p.references[0];
  const edited = p.displayText.slice(0, r.start) + p.displayText.slice(r.end);
  const result = restore(p, edited);
  assert.equal(result.ok, true);
  assert.equal(result.canonicalText, `before  after (${B}).`);
  assert.deepEqual(result.deletedReferenceIndexes, [0]);
});

test('a partial token deletion, delimiter stripping, alteration, duplication or reordered token is refused', () => {
  const p = project(`before (${A}) after (${B}).`);
  const [r, s] = p.references;
  for (const changed of [r.marker.slice(1), r.marker.slice(0, -1), r.marker.slice(1, -1),
    r.marker.replace('来源 1', '来源 8'), r.marker + r.marker]) {
    const result = restore(p, p.displayText.replace(r.marker, changed));
    assert.equal(result.ok, false, changed);
    assert.equal(result.canonicalText, p.canonicalText);
  }
  const swapped = p.displayText.replace(r.marker, '@@').replace(s.marker, r.marker).replace('@@', s.marker);
  assert.equal(restore(p, swapped).ok, false);
});

test('explicit sequential edit ranges support disjoint body edits and whole-token deletion', () => {
  const p = project(`before (${A}) after (${B}).`);
  const r = p.references[0];
  const edits = [{ start: r.start, end: r.end, text: '' }, { start: 0, end: 6, text: 'changed' }];
  let edited = p.displayText;
  for (const e of edits) edited = edited.slice(0, e.start) + e.text + edited.slice(e.end);
  const result = restore(p, edited, { edits });
  assert.equal(result.ok, true);
  assert.equal(result.canonicalText, `changed  after (${B}).`);
  assert.equal(restore(p, edited).ok, false, 'missing token plus unrelated edits needs a proven edit history');
});

test('explicit edit ranges reject token interior edits and mismatched final text', () => {
  const p = project(`before (${A}).`);
  const r = p.references[0];
  const edit = { start: r.start + 1, end: r.end - 1, text: 'changed' };
  const edited = p.displayText.slice(0, edit.start) + edit.text + p.displayText.slice(edit.end);
  assert.equal(restore(p, edited, { edits: [edit] }).ok, false);
  assert.equal(restore(p, 'different', { edits: [] }).ok, false);
  const whole = { start: r.start, end: r.end, text: `**${r.marker}**` };
  const wrapped = p.displayText.slice(0, r.start) + whole.text + p.displayText.slice(r.end);
  assert.equal(restore(p, wrapped, { edits: [whole] }).canonicalText, `before **(${A})**.`);
});

test('length, reference-count, supplied-ID and edit-work limits preserve the full original on failure', () => {
  const long = 'x'.repeat(12001);
  const p = project(long);
  assert.equal(p.ok, false);
  assert.equal(p.canonicalText, long);
  assert.equal(p.displayText, long);
  assert.equal(project(`(${A})`.repeat(257)).ok, false);
  assert.equal(project(`(${A})`, { knownSourceIds: Array(257).fill('x') }).ok, false);
  assert.equal(project('x'.repeat(12000)).ok, true);
  const small = project(`(${A})`);
  const result = restore(small, 'x'.repeat(12001));
  assert.equal(result.ok, false);
  assert.equal(result.canonicalText, small.canonicalText);
  assert.equal(restore(small, small.displayText, { edits: Array(257).fill({ start: 0, end: 0, text: '' }) }).ok, false);
});

test('projection records are immutable and tampered ranges are not trusted', () => {
  const p = project(`(${A})`);
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.references[0].sourceIds));
  const forged = JSON.parse(JSON.stringify(p));
  forged.references[0].end -= 1;
  const result = restore(forged, p.displayText);
  assert.equal(result.ok, false);
  assert.equal(result.canonicalText, p.canonicalText);
});

test('UTF-16 ranges preserve emoji, combining characters, CRLF and non-ASCII scientific content', () => {
  const source = `🧬e\u0301 Δp = 0.05\r\n否定 (${A}) μM`;
  const p = project(source);
  assert.equal(restore(p, p.displayText).canonicalText, source);
  assert.equal(p.references[0].canonicalStart, source.indexOf('('));
});

test('optional display-only serialization retains text/format and never changes the projection', () => {
  const p = project(`**未见增加** (${A})`);
  assert.equal(api.serializeLiteratureNoteSourceProjection(p), p.displayText);
  assert.equal(p.canonicalText, `**未见增加** (${A})`);
});

test('accepted edits advance the base, keep source numbering stable, and retain deleted mappings for undo/redo', () => {
  const original = project(`before (${A}) after (${B}).`);
  const first = restore(original, original.displayText.replace('before', 'changed'));
  assert.equal(first.ok, true);
  const p = first.nextProjection;
  assert.equal(p.displayText, first.displayText);
  assert.equal(p.references[0].marker, original.references[0].marker);
  const r = p.references[0];
  const deletedText = p.displayText.slice(0, r.start) + p.displayText.slice(r.end);
  const deleted = restore(p, deletedText);
  assert.equal(deleted.ok, true);
  assert.equal(deleted.nextProjection.references[0].marker, original.references[1].marker);
  assert.deepEqual(deleted.nextProjection.references[0].sourceNumbers, [2]);
  assert.equal(deleted.nextProjection.registry.length, 2);
  const undone = restore(deleted.nextProjection, p.displayText);
  assert.equal(undone.ok, true);
  assert.equal(undone.canonicalText, `changed (${A}) after (${B}).`);
  const redone = restore(undone.nextProjection, deletedText);
  assert.equal(redone.ok, true);
  assert.equal(redone.canonicalText, `changed  after (${B}).`);
});

test('complete formatting followed by body input, deletion, undo, and format undo is lossless', () => {
  let p = project(`A (${A}) B`);
  const marker = p.references[0].marker;
  const formatted = p.displayText.replace(marker, `**${marker}**`);
  let r = restore(p, formatted); assert.equal(r.ok, true); p = r.nextProjection;
  const typed = formatted.replace(' B', ' 新正文 B');
  r = restore(p, typed); assert.equal(r.ok, true); p = r.nextProjection;
  const deleted = typed.replace(marker, '');
  r = restore(p, deleted); assert.equal(r.ok, true); p = r.nextProjection;
  r = restore(p, typed); assert.equal(r.ok, true); p = r.nextProjection;
  r = restore(p, formatted); assert.equal(r.ok, true); p = r.nextProjection;
  r = restore(p, formatted.replace(`**${marker}**`, marker));
  assert.equal(r.ok, true);
  assert.equal(r.canonicalText, `A (${A}) B`);
});

test('deleting either of two adjacent tokens is unambiguous despite their shared label prefix', () => {
  const p = project(`(${A})(${B})`);
  for (const ref of p.references) {
    const edited = p.displayText.slice(0, ref.start) + p.displayText.slice(ref.end);
    const r = restore(p, edited);
    assert.equal(r.ok, true);
    assert.equal(r.canonicalText, ref.index === 0 ? `(${B})` : `(${A})`);
    assert.equal(restore(r.nextProjection, p.displayText).canonicalText, p.canonicalText);
  }
});

test('all single-character token damage is refused while insertion at either token boundary is allowed', () => {
  const p = project(`prefix (${A}) suffix`);
  const ref = p.references[0];
  for (let at = ref.start; at < ref.end; at += 1) {
    const edited = p.displayText.slice(0, at) + p.displayText.slice(at + 1);
    assert.equal(restore(p, edited).ok, false, `delete at ${at}`);
  }
  for (let at = ref.start + 1; at < ref.end; at += 1) {
    const edited = p.displayText.slice(0, at) + 'x' + p.displayText.slice(at);
    assert.equal(restore(p, edited).ok, false, `insert at ${at}`);
  }
  for (const at of [ref.start, ref.end]) {
    const edited = p.displayText.slice(0, at) + 'x' + p.displayText.slice(at);
    assert.equal(restore(p, edited, { edits: [{ start: at, end: at, text: 'x' }] }).ok, true);
  }
});

test('restoring every deletion of one full token among many preserves source order and spacing', () => {
  const source = Array.from({ length: 24 }, (_, i) => `段 ${i} (${i % 2 ? A : B})`).join('\r\n');
  const p = project(source);
  for (const ref of p.references) {
    const edited = p.displayText.slice(0, ref.start) + p.displayText.slice(ref.end);
    const result = restore(p, edited);
    assert.equal(result.ok, true);
    assert.equal(result.canonicalText,
      source.slice(0, ref.canonicalStart) + source.slice(ref.canonicalEnd));
    assert.equal(restore(result.nextProjection, p.displayText).canonicalText, source);
  }
});

test('a complete replacement can delete sources with an explicit range, but a lost marker never restores by guessing', () => {
  const p = project(`A (${A}) B`);
  assert.equal(restore(p, 'new body').ok, false);
  const result = restore(p, 'new body', { edits: [{ start: 0, end: p.displayText.length, text: 'new body' }] });
  assert.equal(result.ok, true);
  assert.equal(result.canonicalText, 'new body');
  assert.equal(restore(result.nextProjection, p.displayText).canonicalText, p.canonicalText);
});

test('restored canonical length is bounded even when short displayed markers hide larger originals', () => {
  const source = `(${A}、${B})`;
  const p = project(source);
  const edited = 'x'.repeat(12000 - p.displayText.length) + p.displayText;
  assert.equal(edited.length, 12000);
  assert.equal(restore(p, edited).ok, false);
  assert.equal(restore(p, edited).canonicalText, source);
});

test('malformed nesting and excessive edit work return an explicit bounded failure', () => {
  const malformed = '['.repeat(12000);
  const p = project(malformed);
  assert.equal(p.ok, false);
  assert.equal(p.error, 'NOTE_SOURCE_LIMIT');
  assert.equal(p.displayText, malformed);
  const body = project('x'.repeat(11000));
  const edits = Array.from({ length: 30 }, () => ({ start: 0, end: 0, text: '' }));
  assert.equal(restore(body, body.displayText, { edits }).error, 'NOTE_SOURCE_LIMIT');
});

test('rooted nested lists and their continuation lines project sources at four or more spaces', () => {
  const source = `1. 结论\n   - 子项\n     - 条件（${A}）\n       补充条件（${B}）\n   - 子项二（${A}）`;
  const p = project(source);
  assert.deepEqual(p.references.map(ref => ref.sourceIds), [[A], [B], [A]]);
  assert.equal(restore(p, p.displayText).canonicalText, source);
});

test('true indented code inside a list stays protected, including apparent list markers', () => {
  const source = `- 结论\n  续行（${A}）\n\n      条件（${B}）\n      - code（${B}）\n- 后续（${A}）`;
  const p = project(source);
  assert.deepEqual(p.references.map(ref => ref.sourceIds), [[A], [A]]);
  assert.ok(p.displayText.includes(`      - code（${B}）`));
});

test('fenced code nested in a list does not expose source-like scientific code', () => {
  const source = `- 子项\n  - 深层\n    \`\`\`js\n    (${A})\n    \`\`\`\n  - 结论（${B}）`;
  const p = project(source);
  assert.deepEqual(p.references.map(ref => ref.sourceIds), [[B]]);
});

test('existing bracket characters immediately adjacent to a projected group never steal its delimiter', () => {
  for (const source of [`⟦(${A})`, `(${A})⟧`, `⟦(${A})⟧`, `⟦⟦(${A})⟧⟧`]) {
    const p = project(source);
    assert.equal(p.ok, true);
    const restored = restore(p, p.displayText);
    assert.equal(restored.ok, true, source);
    assert.equal(restored.canonicalText, source);
  }
});

test('browser namespace matches the CommonJS API without DOM, network, or storage', () => {
  project('');
  const source = fs.readFileSync(file, 'utf8');
  const context = { SciLLM: { existing: true } };
  vm.runInNewContext(source, context);
  assert.equal(context.SciLLM.existing, true);
  assert.equal(context.SciLLM.projectLiteratureNoteSources(`(${A})`).ok, true);
  assert.doesNotMatch(source, /innerHTML|createElement|document\.|fetch\(|localStorage|chrome\./);
});
