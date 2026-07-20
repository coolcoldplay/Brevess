const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeWorkspaceCanonicalUrl,
  normalizeWorkspaceRelativePath,
  createArticleWorkspaceIdentity,
  createWorkspaceDirectoryName,
  assertWorkspaceSafeValue
} = require('../core/article-workspace.js');

test('workspace identity uses normalized canonical URL, aliases, and content hash revision', async () => {
  const workspace = await createArticleWorkspaceIdentity({
    canonicalUrl: 'https://User:pass@EXAMPLE.org:443/paper//one/?utm_source=x#results',
    doi: 'https://doi.org/10.1000/ABC.1',
    siteId: '  PII:S1234  ',
    contentHash: `sha256:${'A'.repeat(64)}`,
    title: 'A result: cells / tissues?'
  });

  assert.equal(workspace.canonicalUrl, 'https://example.org/paper/one');
  assert.equal(workspace.revision, 'a'.repeat(64));
  assert.deepEqual(workspace.aliases, [
    { type: 'doi', value: '10.1000/abc.1' },
    { type: 'site', value: 'pii:s1234' }
  ]);
  assert.match(workspace.workspaceId, /^workspace:[a-f0-9]{64}$/);
  assert.match(workspace.directoryName, /^A result cells tissues--[a-f0-9]{12,}$/);

  const same = await createArticleWorkspaceIdentity({
    canonicalUrl: 'https://example.org/paper/one?different=yes',
    contentHash: 'b'.repeat(64),
    title: 'Changed title'
  });
  assert.equal(same.workspaceId, workspace.workspaceId);
  assert.notEqual(same.revision, workspace.revision);
});

test('workspace paths reject traversal, absolute, reserved, control, and credential-shaped data', () => {
  assert.equal(normalizeWorkspaceCanonicalUrl('https://example.org/a/?x=1#b'), 'https://example.org/a');
  assert.equal(normalizeWorkspaceRelativePath('chat/turns.jsonl'), 'chat/turns.jsonl');
  for (const path of ['../secret', '/absolute', 'C:/secret', 'chat/../../secret', 'CON/file.json',
    'chat/bad\u0000name.json']) {
    assert.throws(() => normalizeWorkspaceRelativePath(path), /INVALID_WORKSPACE_PATH/);
  }
  assert.throws(() => createWorkspaceDirectoryName('CON', `workspace:${'a'.repeat(64)}`),
    /INVALID_WORKSPACE_DIRECTORY/);
  assert.throws(() => assertWorkspaceSafeValue({ nested: { api_key: 'secret' } }),
    /WORKSPACE_CONTAINS_CREDENTIALS/);
  assert.throws(() => assertWorkspaceSafeValue({ Authorization: 'Bearer secret' }),
    /WORKSPACE_CONTAINS_CREDENTIALS/);
});
