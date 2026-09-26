const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../core/article-bibliography.js');
const { buildLocalReadingLibrary, queryLocalReadingLibrary } = require('../core/local-reading-library.js');
const identity = { workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
  canonicalUrl: 'https://example.org/paper', title: 'Preserved scientific paper' };
function asset(meta = [['citation_journal_title', 'β-Cell Research'], ['citation_date', '2024-02']]) {
  const document = { head: { querySelectorAll: () => meta.map(([name, content]) => ({
    getAttribute: key => key === 'name' ? name : key === 'content' ? content : null
  })) } };
  return { relativePath: 'article/bibliography.json', workspaceId: identity.workspaceId,
    workspaceGeneration: 1, revision: 1, contentHash: 'a'.repeat(64),
    content: { ...api.extractArticleBibliography(document, identity), workspaceId: identity.workspaceId } };
}
function query(assets, workspace = identity) {
  const library = buildLocalReadingLibrary({ workspaces: [workspace],
    assetsByWorkspace: new Map([[workspace.workspaceId, assets]]) });
  return queryLocalReadingLibrary(library, { kind: 'articles' }).items[0];
}
test('LIB-010 actual library query projects only verified journal and the recorded date precision', () => {
  const result = query([asset()]);
  assert.equal(result.journal, 'β-Cell Research');
  assert.equal(result.publicationDate, '2024-02');
  assert.equal(result.publicationDatePrecision, 'month');
});
test('old workspaces remain readable without manufacturing publication or save dates', () => {
  const result = query([], { ...identity, createdAt: '2024-01-01', updatedAt: '2024-02-01' });
  assert.equal(result.journal, ''); assert.equal(result.publicationDate, '');
  assert.equal(result.savedAt || '', '');
  assert.equal(result.title, identity.title);
});
test('wrong owner, URL, generation and malformed metadata never populate another article row', () => {
  for (const change of ['owner', 'url', 'generation', 'invalid']) {
    const value = asset();
    if (change === 'owner') value.content.workspaceId = `workspace:${'b'.repeat(64)}`;
    if (change === 'url') value.content.canonicalUrl = 'https://example.org/other';
    if (change === 'generation') value.workspaceGeneration = 2;
    if (change === 'invalid') value.content.schemaVersion = 9;
    assert.equal(query([value]).journal, '', change);
    assert.equal(query([value]).publicationDate, '', change);
  }
});
test('conflicting publication evidence stays unknown while independent journal remains readable', () => {
  const result = query([asset([['citation_journal_title', 'Journal A'],
    ['citation_date', '2020'], ['citation_publication_date', '2021']])]);
  assert.equal(result.journal, 'Journal A'); assert.equal(result.publicationDate, '');
});
