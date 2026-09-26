const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.join(__dirname, '../core/literature-note-source-storage.js');
const api = fs.existsSync(file) ? require(file) : {};
const { projectLiteratureNoteSources: project } = require('../core/literature-note-sources.js');
const A = 'p-07b442fb743ae472';
const B = 'p-249532d536b26230';
const HASH = 'article-hash-current';
const record = id => ({ paragraphId: id, sourceIdentity: `source:${id}`, textHash: `text:${id}` });
const input = (value = '未见增加，p = 0.05。', sourceIds = [A, B]) => ({
  value, sourceIds, documentHash: HASH,
  receipt: { documentHash: HASH, records: [record(A), record(B)] }
});
const prepare = args => {
  assert.equal(typeof api.prepareLiteratureNoteHtmlSources, 'function', 'HTML source storage API is missing');
  return api.prepareLiteratureNoteHtmlSources(args);
};
const refused = args => {
  const result = prepare(args);
  assert.equal(result.value, args.value);
  assert.equal(result.sourcesSaved, false);
  assert.match(result.warning, /来源未保存/);
  return result;
};

test('stores a verified HTML source group on its own line without changing original text', () => {
  const args = input('3. 🧬e\u0301 未见增加\r\n  - 对照 p-AKT 1.25 μM。');
  const result = prepare(args);
  assert.equal(result.value, `${args.value}\n（${A}、${B}）`);
  assert.equal(result.sourcesSaved, true);
  assert.equal(result.warning, '');
  assert.ok(Object.isFrozen(result));
  const p = project(result.value);
  const r = p.references[p.references.length - 1];
  assert.equal(r.canonicalStart, args.value.length + 1);
  assert.deepEqual(r.sourceIds, [A, B]);
  assert.equal(result.value.slice(0, args.value.length), args.value);
});

test('deduplicates incoming sources in first-seen order while retaining at most twelve unique IDs', () => {
  assert.equal(prepare(input('正文', [B, A, B, A])).value, `正文\n（${B}、${A}）`);
  const twelve = Array.from({ length: 12 }, (_, i) => `p-${i.toString(16).padStart(16, '0')}`);
  const args = input('正文', [...twelve, ...twelve]);
  args.receipt.records = twelve.map(record);
  assert.equal(prepare(args).sourcesSaved, true);
  refused({ ...args, sourceIds: [...twelve, 'p-ffffffffffffffff'] });
});

test('missing receipt, records or empty sources never fabricate a relation', () => {
  for (const receipt of [undefined, null, {}, { documentHash: HASH }, { documentHash: HASH, records: [] }]) {
    refused({ ...input(), receipt });
  }
  refused(input('正文', []));
  refused({ ...input(), sourceIds: null });
});

test('document binding requires an exact nonempty current hash', () => {
  for (const documentHash of ['', ' ', null, 5, `${HASH} `, HASH.toUpperCase()]) {
    refused({ ...input(), documentHash });
  }
  refused({ ...input(), receipt: { documentHash: 'other-paper', records: [record(A), record(B)] } });
});

test('accepts only current lowercase p-16hex IDs with exact receipt membership', () => {
  for (const id of ['p-03e11aa7449a007', 'p-07B442fb743ae472', 'pdf-paragraph:abc',
    'semantic-a', 'p-AKT', ` ${A}`, `${A} `, '', null]) {
    const args = input('正文', [id]);
    args.receipt.records = [{ paragraphId: id }];
    refused(args);
  }
  const args = input('正文', [A]);
  args.receipt.records = [{ paragraphId: B, sourceIdentity: A }];
  refused(args);
});

test('a cited ID must have exactly one receipt record, including identical or contradictory duplicates', () => {
  for (const duplicate of [record(A), { ...record(A), textHash: 'contradictory' },
    { ...record(A), sourceIdentity: 'other-source' }]) {
    const args = input('正文', [A]);
    args.receipt.records = [record(A), duplicate];
    refused(args);
  }
});

test('existing complete supported ID groups avoid duplication without changing their original order or whitespace', () => {
  for (const value of [`结论（ ${B}、${A} ）`, `结论(${A})\n证据(${B})`,
    `- 结论（${A}、${A}、${B}）`]) {
    const result = prepare(input(value));
    assert.equal(result.sourcesSaved, true);
    assert.equal(result.value, value);
    assert.equal(result.warning, '');
  }
});

test('an existing group never bypasses missing, mismatched or ambiguous receipt validation', () => {
  const args = input(`（${A}、${B}）`);
  refused({ ...args, receipt: undefined });
  refused({ ...args, documentHash: 'different' });
  args.receipt.records.push(record(A));
  refused(args);
});

test('illegal mixed groups or code IDs cannot masquerade as an existing saved relation', () => {
  for (const value of [`研究（${A}，即显著增加）`, `\`(${A})\``, `[link](${A})`, `bare ${A}`]) {
    const result = prepare(input(value, [A]));
    assert.equal(result.sourcesSaved, true);
    assert.equal(result.value, `${value}\n（${A}）`);
  }
});

test('closed code fences and trailing raw URLs allow a separate source line; unclosed fences fail intact', () => {
  for (const value of ['```js\ncode\n```', 'https://example.org/paper', '`unclosed inline']) {
    assert.equal(prepare(input(value, [A])).sourcesSaved, true);
  }
  for (const value of ['```js\ncode', '~~~\ncode', '- item\n  ```js\n  code']) {
    refused(input(value, [A]));
  }
});

test('preflight checks exact appended IDs and range, including existing prose and nested lists', () => {
  const value = `1. 结论\n   - 子项\n     - 条件（${A}）`;
  const result = prepare(input(value));
  assert.equal(result.value, `${value}\n（${A}、${B}）`);
  const p = project(result.value);
  assert.deepEqual(p.references[p.references.length - 1].sourceIds, [A, B]);
});

test('canonical 12000 boundary never truncates prose or source IDs', () => {
  const suffix = `\n（${A}）`;
  const exact = 'x'.repeat(12000 - suffix.length);
  assert.equal(prepare(input(exact, [A])).value.length, 12000);
  refused(input(`${exact}x`, [A]));
  refused(input('x'.repeat(12001), [A]));
});

test('display length budget can reject an otherwise valid 12000 canonical string without losing any prose', () => {
  const suffix = `\n（${A}）`;
  const prefix = '⟧⟧⟧';
  const value = prefix + 'x'.repeat(12000 - suffix.length - prefix.length);
  assert.equal((value + suffix).length, 12000);
  assert.equal(project(value + suffix).ok, false);
  refused(input(value, [A]));
});

test('projection node/work limits fail with explicit warning and preserve every original character', () => {
  refused(input(`(${A})`.repeat(257), [A]));
  refused(input('['.repeat(11000), [A]));
});

test('frozen inputs remain unchanged and a second successful call is idempotent', () => {
  const args = input('原文', [A, B]);
  Object.freeze(args.sourceIds);
  args.receipt.records.forEach(Object.freeze); Object.freeze(args.receipt.records);
  Object.freeze(args.receipt); Object.freeze(args);
  const before = JSON.stringify(args);
  const first = prepare(args);
  const second = prepare({ ...args, value: first.value });
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(args), before);
});

test('empty or malformed values and excessive input sizes fail without trimming or reading past bounds', () => {
  for (const value of ['', ' \r\n ', null, 7]) refused(input(value, [A]));
  refused(input('正文', Array(2049).fill(A)));
  const args = input('正文', [A]);
  args.receipt.records = Array(20001).fill(record(A));
  refused(args);
});

test('receipt accessors are not invoked and inherited paragraph IDs do not count as matches', () => {
  let calls = 0;
  const args = input('正文', [A]);
  Object.defineProperty(args.receipt, 'records', { get() { calls += 1; return [record(A)]; } });
  refused(args);
  assert.equal(calls, 0);
  const inherited = input('正文', [A]);
  inherited.receipt.records = [Object.create({ paragraphId: A })];
  refused(inherited);
});

test('existing supported string schemas and JSON round trips retain prepared anchors without adding a PDF record', () => {
  const { normalizeLiteratureNoteDocumentState: normalize } = require('../core/reading-tools.js');
  const result = prepare(input('**结论**\n  - 未见增加。', [A]));
  const state = normalize({ schemaVersion: 3, templateId: 'research',
    valuesByTemplate: { research: { background: result.value } },
    fieldStatusByTemplate: { research: { background: 'supported' } } });
  const restored = normalize(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.schemaVersion, 3);
  assert.equal(restored.valuesByTemplate.research.background, result.value);
  assert.deepEqual(Object.keys(restored.fieldEvidenceByTemplate), []);
  assert.deepEqual(project(restored.valuesByTemplate.research.background).references[0].sourceIds, [A]);
});

test('an unavailable projector returns an explicit intact failure rather than appending unrenderable IDs', () => {
  prepare(input());
  const source = fs.readFileSync(file, 'utf8');
  const context = { SciLLM: {} };
  vm.runInNewContext(source, context);
  const args = input('正文', [A]);
  const result = context.SciLLM.prepareLiteratureNoteHtmlSources(args);
  assert.equal(result.value, args.value);
  assert.equal(result.sourcesSaved, false);
  assert.match(result.warning, /来源未保存/);
});

test('browser export works after the projection script and does not use DOM, network or storage', () => {
  prepare(input());
  const source = fs.readFileSync(file, 'utf8');
  const context = { SciLLM: { existing: true } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../core/literature-note-sources.js'), 'utf8'), context);
  vm.runInNewContext(source, context);
  const result = context.SciLLM.prepareLiteratureNoteHtmlSources(input('正文', [A]));
  assert.equal(result.sourcesSaved, true);
  assert.equal(context.SciLLM.existing, true);
  assert.doesNotMatch(source, /innerHTML|createElement|document\.|fetch\(|localStorage|chrome\./);
});
