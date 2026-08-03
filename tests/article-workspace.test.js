const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeWorkspaceCanonicalUrl,
  normalizeWorkspaceRelativePath,
  createArticleWorkspaceIdentity,
  createWorkspaceDirectoryName,
  assertWorkspaceSafeValue,
  createWorkspaceManifest,
  validateWorkspaceManifest,
  createWorkspaceIndex,
  validateWorkspaceIndex,
  matchWorkspaceManifests
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
  for (const key of [
    'token', 'providerToken', 'password', 'bearer', 'authToken',
    'accessToken', 'refreshToken', 'credential', 'secret', 'apiToken',
    'githubToken', 'privateToken', 'personalAccessToken', 'webhookSecret',
    'privateSecret', 'clientSecret', 'privateKey', 'activeProvider',
    'providerId', 'authorizationHeader', 'authHeader', 'bearerToken',
    'databasePassword'
  ]) {
    assert.throws(
      () => assertWorkspaceSafeValue({ [key]: 'must-not-persist' }),
      /WORKSPACE_CONTAINS_CREDENTIALS/,
      key
    );
  }
  assert.deepEqual(assertWorkspaceSafeValue({
    experimentalProtocol: 'retain protocol',
    secretoryPathway: 'retain secretory biology',
    secretome: 'retain secretome biology',
    tokenizationMethod: 'retain scientific tokenization',
    tokenUsage: { input: 12 },
    tokenCount: 16,
    inputTokenCount: 12,
    headerTitle: 'retain section header'
  }), {
    experimentalProtocol: 'retain protocol',
    secretoryPathway: 'retain secretory biology',
    secretome: 'retain secretome biology',
    tokenizationMethod: 'retain scientific tokenization',
    tokenUsage: { input: 12 },
    tokenCount: 16,
    inputTokenCount: 12,
    headerTitle: 'retain section header'
  });
});

test('workspace manifests expose only relative assets and exact identity matching ignores titles', async () => {
  const workspace = await createArticleWorkspaceIdentity({
    canonicalUrl: 'https://example.org/paper', doi: '10.1000/example',
    contentHash: '1'.repeat(64), title: 'Shared title'
  });
  const manifest = createWorkspaceManifest(workspace, [{
    path: 'chat/turns/turn-1.json', type: 'json', revision: 1,
    contentHash: 'asset-1', updatedAt: '2026-07-20T01:00:00.000Z'
  }]);
  assert.deepEqual(validateWorkspaceManifest(manifest), manifest);
  assert.throws(() => createWorkspaceManifest(workspace, [{
    path: '../escape.json', revision: 1
  }]), /INVALID_WORKSPACE_PATH/);
  const index = createWorkspaceIndex([manifest]);
  assert.deepEqual(validateWorkspaceIndex(index), index);

  assert.equal(matchWorkspaceManifests({
    canonicalUrl: workspace.canonicalUrl, contentHash: workspace.contentHash
  }, [manifest])[0].match, 'exact');
  assert.equal(matchWorkspaceManifests({
    doi: '10.1000/example', contentHash: '2'.repeat(64)
  }, [manifest])[0].match, 'content-changed');
  assert.deepEqual(matchWorkspaceManifests({ title: 'Shared title' }, [manifest]), []);
});
