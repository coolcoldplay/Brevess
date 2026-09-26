const test = require('node:test');
const assert = require('node:assert/strict');
const tags = require('../core/local-library-tags.js');
const { buildLocalReadingLibrary: build, queryLocalReadingLibrary: query } = require('../core/local-reading-library.js');
const W = 'workspace:' + 'a'.repeat(64);
const OTHER = 'workspace:' + 'b'.repeat(64);
const PATH = 'annotations/library-tags.json';
const workspace = { workspaceId: W, workspaceGeneration: 2, title: '科学论文', updatedAt: '2026-09-23' };
function asset(overrides = {}) {
  return { workspaceId: W, workspaceGeneration: 2, relativePath: PATH, revision: 3,
    contentHash: 'raw-cas-hash', content: { schemaVersion: 1, workspaceId: W, tags: ['TNF'] }, ...overrides };
}
function library(assets, globalMemory = { entries: [] }) {
  return build({ workspaces: [workspace], assetsByWorkspace: new Map([[W, assets]]), globalMemory });
}

test('LIB-010 review: a hidden required field plus an extra field is not a valid three-field JSON asset', () => {
  const value = { schemaVersion: 1, workspaceId: W, extra: 'unknown field' };
  Object.defineProperty(value, 'tags', { value: ['TNF'], enumerable: false });
  assert.deepEqual(Object.keys(value), ['schemaVersion', 'workspaceId', 'extra']);
  assert.equal(Object.hasOwn(value, 'tags'), true);
  assert.throws(() => tags.normalizeLocalLibraryTagsAsset(value, { workspaceId: W }),
    { code: 'LOCAL_LIBRARY_TAGS_ASSET_INVALID' });
});

test('LIB-010 review: a later invalid owner record does not reveal tags from either same-path version', () => {
  const original = asset();
  const invalid = asset({ revision: 4, workspaceId: OTHER });
  const before = JSON.stringify([original, invalid]);
  const result = query(library([original, invalid]), { tags: [] });
  assert.equal(result.items[0].tagState, 'invalid');
  assert.equal(result.items[0].tagRevision, null);
  assert.deepEqual(result.availableTags, []);
  assert.equal(query(library([original, invalid]), { tags: ['TNF'] }).total, 0);
  assert.equal(JSON.stringify([original, invalid]), before);
});

test('LIB-010 review: normalized-looking tag paths stay invalid instead of offering editable CAS metadata', () => {
  for (const relativePath of [' annotations/library-tags.json ', 'annotations/ｌibrary-tags.json']) {
    const record = asset({ relativePath });
    const result = query(library([record]));
    assert.equal(result.items[0].tagState, 'invalid');
    assert.equal(result.items[0].tagRevision, null);
    assert.equal(result.items[0].tagContentHash, '');
    assert.deepEqual(result.availableTags, []);
    assert.equal(record.relativePath, relativePath);
  }
});

test('LIB-010 review: a scientific abbreviation in tags is not counted as a paper text occurrence', () => {
  const result = library([asset()], { entries: [{ abbreviation: 'TNF', fullName: 'tumor necrosis factor' }] });
  const abbreviation = query(result, { kind: 'abbreviations' }).items[0];
  assert.equal(abbreviation.documentCount, 0);
  assert.equal(abbreviation.totalCount, 0);
  assert.equal(query(result, { kind: 'occurrences', abbreviationId: abbreviation.id }).total, 0);
  assert.equal(query(result, { tags: ['TNF'] }).total, 1);
});

test('LIB-010 review: equivalent NFC filters do not become duplicate ALL requirements or mutate supplied filters', () => {
  const record = asset({ content: { schemaVersion: 1, workspaceId: W, tags: ['é', 'µ', 'μ'] } });
  const filters = { tags: ['e\u0301', 'é', 'µ'], tagMode: 'all' };
  const before = JSON.stringify(filters);
  const result = query(library([record]), filters);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0].tags, ['é', 'µ', 'μ']);
  assert.equal(JSON.stringify(filters), before);
});
