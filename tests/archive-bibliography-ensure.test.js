const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bibliography = require('../core/article-bibliography.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
function realFunction(name, deps) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const next = source.slice(start + 1).search(/\n(?:async )?function /u);
  assert.ok(next > 0);
  return Function(...Object.keys(deps), `return (${source.slice(start, start + 1 + next)});`)(...Object.values(deps));
}
const workspace = { workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
  canonicalUrl: 'https://example.test/paper', contentHash: 'b'.repeat(64) };
const archive = { documentId: 'doc-paper', documentHash: 'hash-paper', canonicalUrl: workspace.canonicalUrl };
function fixture(options = {}) {
  const calls = [];
  const current = Object.hasOwn(options, 'current') ? options.current : workspace;
  const metas = options.metas || [['citation_journal_title', 'Synthetic Journal'], ['citation_publication_date', '2024-02-29']];
  const collect = realFunction('collectCurrentArticleBibliography', {
    SciLLM: { ...bibliography, normalizeWorkspaceCanonicalUrl: value => value },
    currentArticleWorkspace: current,
    activeNativePdfStructure: () => options.nativePdf || null,
    articleWorkspaceMetadata: () => ({ canonicalUrl: options.pageUrl || workspace.canonicalUrl }),
    document: { title: 'Synthetic paper', head: { querySelectorAll: () => metas.map(([name, content]) => ({
      getAttribute: key => key === 'name' ? name : key === 'content' ? content : null
    })) } }
  });
  const run = realFunction('createArticleWorkspaceEnsureResponse', {
    currentManualDocument: { documentId: archive.documentId,
      record: { ...archive }, documentCreationToken: 'existing-creation-token' },
    currentArticleWorkspace: current,
    SciLLM: { normalizeWorkspaceCanonicalUrl: value => value },
    captureCurrentArticleArchiveRestoreIdentity: () => {
      calls.push('identity'); return options.archive || archive;
    },
    collectCurrentArticleBibliography: () => {
      calls.push('fresh-head');
      if (options.throwRead) throw Error('HEAD_UNAVAILABLE');
      return collect();
    },
    createArticleWorkspaceRestoreAuthorization: value => {
      calls.push('authorization'); return { token: 'unchanged-nonce', identity: value };
    }
  });
  return { run: owner => run(owner === undefined ? workspace : owner), calls };
}

test('ensure returns a synchronous fresh head bibliography bound to its workspace and archive identity', () => {
  const h = fixture();
  const value = h.run();
  assert.equal(value.bibliographyBaseline?.journal.value, 'Synthetic Journal');
  assert.equal(value.bibliographyBaseline.publicationDate.value, '2024-02-29');
  assert.equal(value.bibliographyBaseline.workspaceId, workspace.workspaceId);
  assert.equal(value.bibliographyBaseline.canonicalUrl, archive.canonicalUrl);
  assert.equal(value.bibliographyBaseline.journal.source, 'meta:citation_journal_title');
  assert.deepEqual(h.calls, ['identity', 'fresh-head', 'authorization']);
  assert.equal(value.documentCreationToken, 'existing-creation-token');
  assert.equal(value.restoreAuthorization.token, 'unchanged-nonce');
  assert.strictEqual(value.archiveIdentity, archive);
  assert.strictEqual(value.workspace, workspace);
});

test('stale ensure owner or archive URL cannot borrow a bibliography from the current page', () => {
  for (const owner of [null, {}, { ...workspace, workspaceId: `workspace:${'c'.repeat(64)}` },
    { ...workspace, workspaceGeneration: 2 }, { ...workspace, canonicalUrl: 'https://example.test/other' }]) {
    const h = fixture();
    assert.equal(h.run(owner).bibliographyBaseline, null);
    assert.deepEqual(h.calls, ['identity', 'authorization']);
  }
  const h = fixture({ archive: { ...archive, canonicalUrl: 'https://example.test/other' } });
  assert.equal(h.run().bibliographyBaseline, null);
  assert.deepEqual(h.calls, ['identity', 'authorization']);
});

test('missing current workspace and invalid matching generations provide no baseline', () => {
  const absent = fixture({ current: null });
  assert.equal(absent.run().bibliographyBaseline, null);
  assert.deepEqual(absent.calls, ['identity', 'authorization']);
  for (const generation of [0, -1, 1.5, NaN, '1']) {
    const invalid = { ...workspace, workspaceGeneration: generation };
    const h = fixture({ current: invalid });
    assert.equal(h.run(invalid).bibliographyBaseline, null);
    assert.deepEqual(h.calls, ['identity', 'authorization']);
  }
});

test('author/DOI-only, native PDF, changed page URL and unreadable head give an explicit null', () => {
  for (const options of [
    { metas: [['citation_author', 'Synthetic Author'], ['citation_doi', '10.0000/synthetic']] },
    { nativePdf: {} }, { pageUrl: 'https://example.test/other' }, { throwRead: true }
  ]) {
    const h = fixture(options);
    const value = h.run();
    assert.equal(value.bibliographyBaseline, null);
    assert.equal(value.restoreAuthorization.token, 'unchanged-nonce');
    assert.equal(value.documentCreationToken, 'existing-creation-token');
  }
});

test('fresh bibliography observes current head and retains raw evidence without reading saved assets', () => {
  const metas = [['citation_journal_title', '  Page Journal  '], ['citation_publication_date', '2024']];
  const h = fixture({ metas });
  const first = h.run().bibliographyBaseline;
  assert.equal(first?.journal.raw, '  Page Journal  ');
  assert.equal(first.publicationDate.precision, 'year');
  metas[0][1] = 'New Page Journal';
  const next = h.run().bibliographyBaseline;
  assert.equal(next.journal.value, 'New Page Journal');
  assert.equal(first.journal.value, 'Page Journal');
});
