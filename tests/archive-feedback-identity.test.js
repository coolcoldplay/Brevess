const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sources = Object.fromEntries(['content.js', 'popup.js'].map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
function fn(file, name, deps = {}) {
  const source = sources[file];
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Production function ${name} must exist`);
  const next = source.slice(start + 1).search(/\n(?:async )?function /u);
  const end = next < 0 ? source.length : start + 1 + next;
  return Function(...Object.keys(deps), `return (${source.slice(start, end).trim()});`)(...Object.values(deps));
}
const workspace = { workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 2,
  canonicalUrl: 'https://example.org/paper-a', contentHash: 'a'.repeat(64) };
const live = { documentId: 'sha256:live-article', documentHash: 'live-document-hash', canonicalUrl: workspace.canonicalUrl };
const stale = { documentId: 'sha256:previous-sidebar', documentHash: 'stale-document-hash', canonicalUrl: workspace.canonicalUrl };
const ensured = { success: true, workspace, archiveIdentity: live, bibliographyBaseline: null, restoreAuthorization: { token: 'one-time-restore-token', identity: workspace } };
const deps = { currentArticleArchiveIdentity: () => stale };
const own = fn('content.js', 'ownArticleWorkspaceRestoreValue');
const normalDeps = { ownArticleWorkspaceRestoreValue: own, SciLLM: { normalizeWorkspaceCanonicalUrl: value => new URL(value).href.replace(/\/$/u, '') } };
const validate = fn('content.js', 'validateArticleArchiveRestoreTarget', {
  ...normalDeps,
  normalizedArticleWorkspaceRestoreIdentity: fn('content.js', 'normalizedArticleWorkspaceRestoreIdentity', normalDeps),
  normalizedArticleArchiveRestoreIdentity: fn('content.js', 'normalizedArticleArchiveRestoreIdentity', normalDeps),
  sameArticleWorkspaceRestoreIdentity: fn('content.js', 'sameArticleWorkspaceRestoreIdentity'),
  sameArticleArchiveRestoreIdentity: fn('content.js', 'sameArticleArchiveRestoreIdentity'),
  articleWorkspaceRestoreError: fn('content.js', 'articleWorkspaceRestoreError')
});
function target(override = {}) { return fn('popup.js', 'buildArticleArchiveRestoreTarget', deps)({ ...ensured, ...override }, live); }

test('ARCH-009 ensure response pairs fresh page archive identity with the current authorization', () => {
  const calls = [];
  const response = fn('content.js', 'createArticleWorkspaceEnsureResponse', {
    currentManualDocument: null,
    currentArticleWorkspace: workspace,
    collectCurrentArticleBibliography: () => null,
    captureCurrentArticleArchiveRestoreIdentity: () => { calls.push('identity'); return live; },
    createArticleWorkspaceRestoreAuthorization: value => { assert.equal(value, workspace); calls.push('authorization'); return ensured.restoreAuthorization; }
  })(workspace);
  assert.deepEqual(response, ensured);
  assert.deepEqual(calls, ['identity', 'authorization']);
  assert.match(sources['content.js'], /\.then\(workspace => sendResponse\(createArticleWorkspaceEnsureResponse\(workspace\)\)\)/u);
});
test('ARCH-009 stale sidebar no longer rejects a fresh same-article archive restore', () => {
  const restoreTarget = target();
  assert.deepEqual(restoreTarget.currentArchive, live);
  assert.equal(restoreTarget.allowContentChanged, false);
  assert.doesNotThrow(() => validate({ archive: live, restoreTarget }, workspace, ensured.restoreAuthorization, live));
});
test('ARCH-009 workspace commit binds the same document as the live page receipt', () => {
  const restoreTarget = fn('popup.js', 'buildArticleWorkspaceRestoreTarget', deps)(ensured, { manifest: workspace, match: 'exact' });
  assert.equal(restoreTarget.documentId, live.documentId);
  assert.equal(restoreTarget.authorizationToken, ensured.restoreAuthorization.token);
});
test('ARCH-009 older content response retains legacy identity fallback', () => {
  const oldResponse = { ...ensured }; delete oldResponse.archiveIdentity;
  assert.deepEqual(fn('popup.js', 'buildArticleArchiveRestoreTarget', deps)(oldResponse, live).currentArchive, stale);
  assert.equal(fn('popup.js', 'buildArticleWorkspaceRestoreTarget', deps)(oldResponse, { manifest: workspace }).documentId, stale.documentId);
});
test('ARCH-009 explicit empty fresh identity cannot fall back to the stale sidebar', () => {
  const restoreTarget = target({ archiveIdentity: {} });
  assert.equal(restoreTarget.currentArchive.documentId, '');
  assert.throws(() => validate({ archive: live, restoreTarget }, workspace, ensured.restoreAuthorization, live), /ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH/u);
});
for (const drift of ['paper', 'generation', 'archive']) {
  test(`ARCH-009 fresh snapshot still rejects post-authorization ${drift} drift`, () => {
    const current = drift === 'paper' ? { ...workspace, workspaceId: `workspace:${'b'.repeat(64)}`, canonicalUrl: 'https://example.org/paper-b' }
      : drift === 'generation' ? { ...workspace, workspaceGeneration: 3 } : workspace;
    const archive = drift === 'archive' ? { ...live, documentId: 'sha256:new-live-document' } : live;
    assert.throws(() => validate({ archive: live, restoreTarget: target() }, current, ensured.restoreAuthorization, archive), /ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH/u);
  });
}
test('ARCH-009 same-article archived content revision can still map to a new live document', () => {
  const oldArchive = { ...live, documentId: 'legacy.previous-version', documentHash: 'old-revision' };
  const restoreTarget = fn('popup.js', 'buildArticleArchiveRestoreTarget', deps)(ensured, oldArchive);
  const accepted = validate({ archive: oldArchive, restoreTarget }, workspace, ensured.restoreAuthorization, live);
  assert.equal(accepted.allowContentChanged, true);
  assert.deepEqual(accepted.archive, oldArchive);
  assert.deepEqual(accepted.currentArchive, live);
});
