const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/privacy-sanitizer.js');
require('../core/article-workspace.js');
const {
  normalizeWorkspacePublicationIdentity,
  sameWorkspacePublicationIdentity,
  classifyWorkspaceAssetConflict,
  createWorkspaceSaveTransactionContext,
  validateWorkspaceRestoreAuthorization
} = require('../core/article-workspace-save.js');

const base = {
  workspaceId: `workspace:${'a'.repeat(64)}`,
  workspaceGeneration: 3,
  canonicalUrl: 'https://www.nature.com/articles/example?utm_source=x#part',
  aliases: [{ type: 'doi', value: '10.1038/example' }],
  contentHash: 'b'.repeat(64)
};

test('publication identity ignores mutable content revision but keeps publication boundaries', () => {
  assert.equal(sameWorkspacePublicationIdentity(base, {
    ...base, contentHash: 'c'.repeat(64), revision: 'c'.repeat(64)
  }), true);
  assert.equal(sameWorkspacePublicationIdentity(base, {
    ...base, canonicalUrl: 'https://www.nature.com/articles/other'
  }), false);
  assert.equal(sameWorkspacePublicationIdentity(base, {
    ...base, aliases: [{ type: 'doi', value: '10.1038/other' }]
  }), false);
  const normalized = normalizeWorkspacePublicationIdentity(base);
  assert.equal(normalized.canonicalUrl, 'https://www.nature.com/articles/example');
  assert.equal(normalized.doi, '10.1038/example');
  assert.equal(Object.hasOwn(normalized, 'contentHash'), false);
  assert.equal(Object.isFrozen(normalized), true);
});

test('asset conflict policy never selects a generic overwrite', () => {
  assert.equal(classifyWorkspaceAssetConflict('figures/workspace-draft.json'), 'mergeable_state');
  assert.equal(classifyWorkspaceAssetConflict('figures/supplemental/ed1.json'), 'mergeable_state');
  assert.equal(classifyWorkspaceAssetConflict('offline/article.html'), 'recapturable_snapshot');
  assert.equal(classifyWorkspaceAssetConflict('chat/turns/t1.json'), 'immutable_turn');
  assert.equal(classifyWorkspaceAssetConflict('unknown/custom.json'), 'manual_resolution');
});

test('save transaction is immutable, bounded and contains one captured inventory', () => {
  const transaction = createWorkspaceSaveTransactionContext({
    operationId: 'save-1', publicationIdentity: base,
    contentRevision: { contentHash: base.contentHash, bindingEpoch: 7 },
    generation: 3, capturedAt: 1234,
    assetInventory: [
      { path: 'article/paragraphs.json', contentHash: '1'.repeat(64), revision: 2 },
      { path: '../escape', contentHash: '2'.repeat(64), revision: 1 }
    ]
  });
  assert.equal(transaction.operationId, 'save-1');
  assert.equal(transaction.assetInventory.length, 1);
  assert.equal(transaction.retryLimit, 1);
  assert.equal(Object.isFrozen(transaction), true);
  assert.equal(Object.isFrozen(transaction.assetInventory), true);
  assert.doesNotMatch(JSON.stringify(transaction), /Nature article text|apiKey|absolutePath/i);
});

test('restore authorization accepts same-publication drift but rejects generation and nonce drift', () => {
  const authorization = {
    nonce: 'restore-1234567890', publicationIdentity: base,
    workspaceGeneration: 3, contentRevision: { contentHash: base.contentHash },
    expiresAt: 5000
  };
  const rebound = validateWorkspaceRestoreAuthorization(authorization, {
    ...base, contentHash: 'd'.repeat(64), nonce: 'restore-1234567890'
  }, { now: 4000 });
  assert.equal(rebound.authorized, true);
  assert.equal(rebound.contentRevisionChanged, true);
  assert.throws(() => validateWorkspaceRestoreAuthorization(authorization, {
    ...base, workspaceGeneration: 4, nonce: 'restore-1234567890'
  }, { now: 4000 }), /ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH/);
  assert.throws(() => validateWorkspaceRestoreAuthorization(authorization, {
    ...base, nonce: 'restore-wrong-0000'
  }, { now: 4000 }), /ARTICLE_WORKSPACE_RESTORE_AUTHORIZATION_INVALID/);
});
