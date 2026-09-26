const test = require('node:test');
const assert = require('node:assert/strict');
let tagsApi = {};
try { tagsApi = require('../core/local-library-tags'); } catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}
const { buildLocalReadingLibrary, queryLocalReadingLibrary } =
  require('../core/local-reading-library');

const PATH = 'annotations/library-tags.json';
const id = number => `workspace:${number.toString(16).padStart(64, '0')}`;
const W1 = id(1);
const W2 = id(2);
const HASH = 'a'.repeat(64);
const call = (name, ...args) => {
  assert.equal(typeof tagsApi[name], 'function', `${name} must exist`);
  return tagsApi[name](...args);
};
const normalize = tags => call('normalizeLocalLibraryTags', tags);
const validate = (value, workspaceId = W1) =>
  call('normalizeLocalLibraryTagsAsset', value, { workspaceId });
const content = (tags = ['α'], workspaceId = W1) =>
  ({ schemaVersion: 1, workspaceId, tags });
const asset = (tags = ['α'], workspaceId = W1, patch = {}) => ({
  workspaceId, workspaceGeneration: 3, relativePath: PATH,
  revision: 7, contentHash: HASH, content: content(tags, workspaceId), ...patch
});
const workspace = (workspaceId = W1, patch = {}) => ({
  workspaceId, workspaceGeneration: 3, title: 'Same scientific paper title',
  createdAt: '2026-01-01', updatedAt: '2026-02-01', ...patch
});
const build = (workspaces, pairs) => buildLocalReadingLibrary({
  workspaces, assetsByWorkspace: new Map(pairs), globalMemory: { entries: [] }
});
const query = (library, options = {}) => queryLocalReadingLibrary(library, {
  kind: 'articles', ...options
});

test('tag API publishes the single storage path and immutable normalized values', () => {
  assert.equal(tagsApi.LOCAL_LIBRARY_TAGS_ASSET_PATH, PATH);
  const input = content([' α ', 'e\u0301', 'é', 'α']);
  const result = validate(input);
  assert.deepEqual(result, content(['α', 'é']));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.tags), true);
  assert.deepEqual(input.tags, [' α ', 'e\u0301', 'é', 'α']);
});

test('tag identity preserves case, compatibility symbols and interior spaces', () => {
  const tags = ['TNF', 'tnf', 'µ', 'μ', 'H₂O', 'H2O', 'Ａ', 'A', 'a  b', 'a b'];
  assert.deepEqual(normalize(tags), tags);
});

test('tag count and Unicode code point limits reject without truncation', () => {
  assert.deepEqual(normalize(['🧬'.repeat(80)]), ['🧬'.repeat(80)]);
  assert.equal(normalize(Array.from({ length: 32 }, (_, n) => `tag${n}`)).length, 32);
  for (const invalid of [['🧬'.repeat(81)], ['x'.repeat(81)], Array(33).fill('same')]) {
    assert.throws(() => normalize(invalid), { code: 'LOCAL_LIBRARY_TAGS_INVALID' });
  }
});

test('invalid tag values, controls and unpaired surrogates are rejected', () => {
  for (const invalid of [null, {}, 'tag', [42], [''], [' \t '], ['a\nb'],
    ['a\u0000b'], ['a\u0085b'], ['a\u2028b'], ['\ud800'], ['\udc00']]) {
    assert.throws(() => normalize(invalid), { code: 'LOCAL_LIBRARY_TAGS_INVALID' });
  }
  assert.deepEqual(normalize([]), []);
});

test('schema and owner must match exactly without coercion or unknown fields', () => {
  for (const invalid of [null, [], {}, { ...content(), schemaVersion: '1' },
    { ...content(), schemaVersion: 2 }, { ...content(), workspaceId: W2 },
    { ...content(), workspaceId: `${W1} ` }, { ...content(), extra: true },
    Object.assign(Object.create({ inherited: true }), content())]) {
    assert.throws(() => validate(invalid), { code: 'LOCAL_LIBRARY_TAGS_ASSET_INVALID' });
  }
  assert.throws(() => validate(content(), ''), { code: 'LOCAL_LIBRARY_TAGS_ASSET_INVALID' });
  assert.throws(() => validate(content([], 'workspace:one'), 'workspace:one'),
    { code: 'LOCAL_LIBRARY_TAGS_ASSET_INVALID' });
});

test('missing owner options return the domain validation error', () => {
  assert.throws(() => call('normalizeLocalLibraryTagsAsset', content(), null),
    { code: 'LOCAL_LIBRARY_TAGS_ASSET_INVALID' });
});

test('tag assets round-trip as ordinary JSON without losing scientific distinctions', () => {
  const input = content(['µ', 'μ', 'H₂O', 'H2O', 'é', 'e\u0301']);
  const normalized = validate(input);
  assert.deepEqual(validate(JSON.parse(JSON.stringify(normalized))), normalized);
  assert.throws(() => normalize([' '.repeat(4097) + 'α']),
    { code: 'LOCAL_LIBRARY_TAGS_INVALID' });
});

test('browser scripts expose the same tags projection without CommonJS', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const browser = vm.createContext({});
  for (const filename of ['local-library-tags.js', 'local-reading-library.js']) {
    vm.runInContext(fs.readFileSync(require.resolve(`../core/${filename}`), 'utf8'), browser);
  }
  const payload = JSON.stringify({ workspaces: [workspace()],
    assetsByWorkspace: { [W1]: [asset(['µ', 'μ'])] } });
  const response = vm.runInContext(`JSON.stringify(SciLLM.queryLocalReadingLibrary(
    SciLLM.buildLocalReadingLibrary(${payload}), { tags: ['µ'], tagMode: 'all' }))`, browser);
  const result = JSON.parse(response);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0].tags, ['µ', 'μ']);
  assert.equal(result.items[0].tagRevision, 7);
});

test('empty and missing assets differ while preserving legacy workspaces', () => {
  const library = build([workspace(), workspace(W2, { workspaceGeneration: undefined })],
    [[W1, [asset([])]], [W2, []]]);
  const ready = query(library).items.find(item => item.workspaceId === W1);
  const missing = query(library).items.find(item => item.workspaceId === W2);
  assert.deepEqual(ready.tags, []);
  assert.equal(ready.tagState, 'ready');
  assert.equal(ready.tagRevision, 7);
  assert.equal(ready.tagContentHash, HASH);
  assert.deepEqual(missing.tags, []);
  assert.equal(missing.tagState, 'missing');
  assert.equal(missing.tagRevision, 0);
  assert.equal(missing.tagContentHash, '');
  assert.equal(missing.workspaceGeneration, 1);
});

test('real CAS metadata and generation survive both article and query projection', () => {
  const source = asset([' α '], W1, { revision: 11, contentHash: 'sha256:Exact-CAS-value' });
  const library = build([workspace()], [[W1, [source]]]);
  for (const article of [library.articles[0], query(library).items[0]]) {
    assert.deepEqual(article.tags, ['α']);
    assert.equal(article.tagRevision, 11);
    assert.equal(article.tagContentHash, 'sha256:Exact-CAS-value');
    assert.equal(article.workspaceGeneration, 3);
    assert.equal(article.tagState, 'ready');
    assert.equal(article.tagError, '');
  }
  assert.deepEqual(source.content.tags, [' α ']);
});

test('invalid content or contradictory owner/generation never contributes tags or usable CAS', () => {
  const invalidAssets = [asset(['secret'], W2), asset(['secret'], W1, {
    content: content(['secret'], W2)
  }), asset(['secret'], W1, { workspaceGeneration: 2 }),
  asset(['secret'], W1, { content: { schemaVersion: 1, workspaceId: W1, tags: 'secret' } }),
  asset(['secret'], W1, { revision: '7' }), asset(['secret'], W1, { contentHash: '' })];
  for (const bad of invalidAssets) {
    const result = query(build([workspace()], [[W1, [bad]]]));
    assert.deepEqual(result.items[0].tags, []);
    assert.equal(result.items[0].tagState, 'invalid');
    assert.equal(result.items[0].tagRevision, null);
    assert.equal(result.items[0].tagContentHash, '');
    assert.ok(result.items[0].tagError);
    assert.deepEqual(result.availableTags, []);
    assert.equal(query(build([workspace()], [[W1, [bad]]]), { tags: ['secret'] }).total, 0);
  }
});

test('same-titled workspaces keep tags and asset revision independent', () => {
  const library = build([workspace(), workspace(W2)], [[W1, [asset(['one'])]],
    [W2, [asset(['two'], W2, { revision: 2 })]]]);
  assert.deepEqual(query(library, { tags: ['one'] }).items.map(item => item.workspaceId), [W1]);
  const second = query(library, { tags: ['two'] }).items[0];
  assert.equal(second.workspaceId, W2);
  assert.equal(second.tagRevision, 2);
});

function manyArticles() {
  const workspaces = Array.from({ length: 28 }, (_, n) => workspace(id(n + 1), {
    title: `Paper ${n + 1}`, updatedAt: `2026-02-${String(n + 1).padStart(2, '0')}`
  }));
  const pairs = workspaces.map((row, n) => [row.workspaceId, [
    asset([n < 26 ? 'shared' : 'other', n % 2 === 0 ? 'even' : 'odd'], row.workspaceId),
    { relativePath: 'article/paragraphs.json', revision: 1, content: { paragraphs: [
      { sectionTitle: n % 2 === 0 ? 'Methods' : 'Results', text: 'needle TNF' }
    ] } }
  ]]);
  return { workspaces, pairs };
}

test('tags combine with query and scope across more than one page', () => {
  const { workspaces, pairs } = manyArticles();
  const library = build(workspaces, pairs);
  const result = query(library, {
    tags: [' shared ', 'even'], tagMode: 'all', query: 'needle', scope: 'method',
    page: 2, pageSize: 12
  });
  assert.equal(result.total, 13);
  assert.equal(result.matchedCount, 13);
  assert.equal(result.pageCount, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].workspaceId, W1);
  assert.deepEqual(result.items[0].hitScopes, ['method']);
  assert.equal(result.matchedCoverage.fulltext, 13);
  assert.equal(result.matchedCoverage.method, 13);
  assert.equal(result.totals.articles, 28);
  assert.equal(result.totals.coverage.fulltext, 28);
  assert.equal(result.totals.coverage.method, 14);
});

test('any is the explicit default; all requires every selected exact tag', () => {
  const { workspaces, pairs } = manyArticles();
  const library = build(workspaces, pairs);
  assert.equal(query(library, { tags: ['even', 'other'] }).total, 15);
  assert.equal(query(library, { tags: ['even', 'other'], tagMode: 'any' }).total, 15);
  assert.equal(query(library, { tags: ['even', 'other'], tagMode: 'all' }).total, 1);
  assert.equal(query(library, { tags: ['EVEN'] }).total, 0);
  assert.throws(() => query(library, { tagMode: 'some' }), { code: 'LOCAL_LIBRARY_TAG_MODE_INVALID' });
  assert.throws(() => query(library, { tags: 'even' }), { code: 'LOCAL_LIBRARY_TAGS_INVALID' });
});

test('available tags come from the whole live library and clear does not clear query or scope', () => {
  const { workspaces, pairs } = manyArticles();
  const library = build(workspaces, pairs);
  const selected = { tags: ['missing'], query: 'needle', scope: 'method', pageSize: 12 };
  const none = query(library, selected);
  assert.equal(none.total, 0);
  assert.equal(none.matchedCoverage.fulltext, 0);
  assert.deepEqual(none.availableTags, ['even', 'odd', 'other', 'shared']);
  const cleared = query(library, { ...selected, tags: [] });
  assert.equal(cleared.total, 14);
  assert.equal(cleared.scope, 'method');
  assert.deepEqual(cleared.items[0].hitScopes, ['method']);
  assert.deepEqual(selected.tags, ['missing']);
});

test('removing the last-page match clamps page and keeps other workspace tags', () => {
  const { workspaces, pairs } = manyArticles();
  const filters = { tags: ['shared', 'even'], tagMode: 'all', page: 2, pageSize: 12 };
  const original = query(build(workspaces, pairs), filters);
  assert.equal(original.items[0].workspaceId, W1);
  pairs.find(([owner]) => owner === W1)[1][0] = asset(['even']);
  const changed = query(build(workspaces, pairs), filters);
  assert.equal(changed.total, 12);
  assert.equal(changed.page, 1);
  assert.equal(changed.pageCount, 1);
  assert.equal(changed.items.length, 12);
  assert.ok(changed.items.every(item => item.tags.includes('shared')));
});

test('rebuilding excludes deleted workspaces and does not change existing article ordering', () => {
  const { workspaces, pairs } = manyArticles();
  const before = build(workspaces, pairs);
  const order = before.articles.map(row => row.workspaceId);
  const afterTags = build(workspaces, pairs.map(([owner, assets]) => [owner, assets.slice(1)]));
  assert.deepEqual(afterTags.articles.map(row => row.workspaceId), order);
  workspaces[27].deletionPending = true;
  workspaces[26].deletionPending = true;
  const result = query(build(workspaces, pairs));
  assert.equal(result.totals.articles, 26);
  assert.deepEqual(result.availableTags, ['even', 'odd', 'shared']);
});

test('tag controls do not alter abbreviation or occurrence queries even when malformed', () => {
  const { workspaces, pairs } = manyArticles();
  const library = buildLocalReadingLibrary({ workspaces,
    assetsByWorkspace: new Map(pairs), globalMemory: { entries: [
      { abbreviation: 'TNF', fullName: 'tumor necrosis factor' }
    ] }
  });
  for (const kind of ['abbreviations', 'occurrences']) {
    const options = { kind, abbreviationId: library.abbreviations[0].id, pageSize: 12 };
    assert.deepEqual(queryLocalReadingLibrary(library, { ...options,
      tags: { invalid: true }, tagMode: 'invalid' }), queryLocalReadingLibrary(library, options));
  }
});
