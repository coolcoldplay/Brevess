const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../core/article-bibliography.js');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
function executable(name, dependencies) {
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const offset = source.slice(start + 1).search(/\n(?:async )?function /u);
  return Function(...Object.keys(dependencies), `return (${source.slice(start, start + 1 + offset)});`)(...Object.values(dependencies));
}
const identity = { workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
  canonicalUrl: 'https://example.org/paper' };
function doc(meta) { return { title: 'Actual paper', head: { querySelectorAll: () => meta.map(([name, content]) => ({
  getAttribute: key => key === 'name' ? name : key === 'content' ? content : null
})) } }; }
function content(meta) { return { ...api.extractArticleBibliography(doc(meta), identity), workspaceId: identity.workspaceId }; }
function collectHarness({ metas = [], native = false, url = identity.canonicalUrl } = {}) {
  const dependencies = { SciLLM: { ...api, normalizeWorkspaceCanonicalUrl: value => value },
    currentArticleWorkspace: identity, document: doc(metas), activeNativePdfStructure: () => native,
    articleWorkspaceMetadata: () => ({ canonicalUrl: url }) };
  dependencies.collectCurrentArticleBibliography = executable('collectCurrentArticleBibliography', dependencies);
  return dependencies;
}
test('raw article head creates a bound baseline asset; PDF, missing head and stale owner do not invent one', () => {
  const h = collectHarness({ metas: [['citation_journal_title', 'Journal β'], ['citation_date', '2024']] });
  const baseline = executable('buildArticleWorkspaceBaselineAssets', { ...h,
    buildArticleWorkspaceSnapshot: () => ({ title: 'Original title', nodes: [], paragraphs: [] }) });
  const assets = baseline();
  assert.equal(assets.get('article/bibliography.json').publicationDate.value, '2024');
  assert.equal(assets.get('article/bibliography.json').workspaceId, identity.workspaceId);
  assert.equal(assets.get('article/structure.json').title, 'Original title');
  for (const options of [{}, { native: {}, metas: [['citation_date', '2024']] },
    { url: 'https://example.org/other', metas: [['citation_date', '2024']] }]) {
    assert.equal(collectHarness(options).collectCurrentArticleBibliography(), null);
  }
});
function saveHarness(existing) {
  const writes = [];
  const state = { stale: false, conflict: false, existing };
  const deps = { SciLLM: api, articleWorkspaceLifecycleGeneration: 7,
    ensureCurrentArticleWorkspace: async () => identity,
    assertCurrentArticleWorkspaceLifecycle: value => { assert.equal(value, 7); if (state.stale) throw Error('STALE'); },
    getWorkspaceAssetCheckpoint: async (relativePath, options) => {
      assert.equal(relativePath, 'article/bibliography.json'); assert.equal(options.workspace, identity);
      return state.existing;
    },
    persistWorkspaceAssetCheckpoint: async (relativePath, value, options) => {
      if (state.conflict) throw Object.assign(Error('ASSET_REVISION_CONFLICT'), { code: 'ASSET_REVISION_CONFLICT' });
      writes.push({ relativePath, value, options }); return { saved: true };
    }
  };
  return { writes, state, save: executable('persistArticleBibliographyCheckpoint', deps) };
}
test('missing one re-extracted field keeps saved evidence and uses the actual checkpoint CAS', async () => {
  const existing = { workspaceGeneration: 1, revision: 3, contentHash: 'old-hash',
    content: content([['citation_journal_title', 'Saved Journal'], ['citation_date', '2020']]) };
  const h = saveHarness(existing);
  await h.save(content([['citation_date', '2024-02']]));
  assert.equal(h.writes[0].value.journal.value, 'Saved Journal');
  assert.equal(h.writes[0].value.publicationDate.value, '2024-02');
  assert.deepEqual(h.writes[0].options, { expectedRevision: 3, expectedContentHash: 'old-hash',
    createOnly: false, expectedLifecycle: 7, workspace: identity });
  assert.equal(existing.content.publicationDate.value, '2020');
});
test('new metadata uses create-only while current conflicting evidence stays explicitly unknown', async () => {
  const h = saveHarness(null);
  await h.save(content([['citation_date', '2020'], ['citation_publication_date', '2021']]));
  assert.equal(h.writes[0].options.createOnly, true);
  assert.equal(h.writes[0].value.publicationDate.reason, 'conflict');
});
test('foreign input, invalid old data, generation drift and CAS conflicts never trigger fallback writes', async () => {
  const candidate = content([['citation_date', '2024']]);
  for (const old of [{ workspaceGeneration: 2, content: candidate },
    { workspaceGeneration: 1, content: { ...candidate, schemaVersion: 99 } }]) {
    const h = saveHarness(old); await assert.rejects(h.save(candidate), /BIBLIOGRAPHY_INVALID/);
    assert.equal(h.writes.length, 0);
  }
  const h = saveHarness(null);
  await assert.rejects(h.save({ ...candidate, canonicalUrl: 'https://example.org/other' }), /BIBLIOGRAPHY_INVALID/);
  h.state.conflict = true;
  await assert.rejects(h.save(candidate), /ASSET_REVISION_CONFLICT/); assert.equal(h.writes.length, 0);
});
