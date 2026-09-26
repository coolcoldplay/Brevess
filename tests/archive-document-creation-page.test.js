const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function executable(file, name, dependencies, inspectPrepared = false) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0); if (source.slice(start - 6, start) === 'async ') start -= 6;
  const offset = source.slice(start + 1).search(/\n(?:async )?function /u);
  assert.ok(offset > 0);
  const body = source.slice(start, start + 1 + offset);
  const returned = inspectPrepared ? `{run: (${body}), prepared: () => currentManualDocument}` : `(${body})`;
  return Function(...Object.keys(dependencies), `return ${returned};`)(...Object.values(dependencies));
}
const workspace = { workspaceId: `workspace:${'a'.repeat(64)}`, canonicalUrl: 'https://example.org/paper',
  workspaceGeneration: 1, contentHash: 'b'.repeat(64) };
const record = { documentId: `sha256:${'c'.repeat(64)}`, canonicalUrl: workspace.canonicalUrl, documentHash: 'd'.repeat(64) };
const token = 'document-create-opaque-token-from-actual-router';
function ensure(prepared, identity = record, owner = workspace) {
  return executable('content.js', 'createArticleWorkspaceEnsureResponse', {
    currentManualDocument: prepared,
    currentArticleWorkspace: workspace,
    collectCurrentArticleBibliography: () => null,
    SciLLM: { normalizeWorkspaceCanonicalUrl: value => value },
    captureCurrentArticleArchiveRestoreIdentity: () => identity,
    createArticleWorkspaceRestoreAuthorization: () => ({ token: 'operation-nonce' })
  })(owner);
}
test('ensure pairs only the opaque creation token of the currently matching prepared document', () => {
  const prepared = { documentId: record.documentId, record, documentCreationToken: token };
  const result = ensure(prepared);
  assert.equal(result.documentCreationToken, token);
  assert.equal(result.archiveIdentity, record);
  assert.equal(result.restoreAuthorization.token, 'operation-nonce');
  assert.equal(result.workspace, workspace);
  assert.equal(Object.hasOwn(result, 'createdFromAbsence'), false);
});

test('record mutation, explicit clear and committed projection discard the old creation token', () => {
  const initial = () => ({ documentId: record.documentId, record: { ...record, annotations: [] },
    documentCreationToken: token, activeCategories: ['preserved'] });
  const update = executable('content.js', 'updateCurrentManualRecord', {
    currentManualDocument: initial(), scheduleArticleWorkspaceArtifactsSave: () => {},
    notifyManualAnnotationStateChanged: () => {}
  }, true);
  update.run({ ...record, revision: 2, annotations: [] });
  assert.equal(update.prepared().documentCreationToken, undefined);
  assert.deepEqual(update.prepared().activeCategories, ['preserved']);
  const clear = executable('content.js', 'clearManualAnnotationsAfterBackground', {
    currentManualDocument: initial(), MANUAL_CLEAR_COMPLETION_TYPE: 'document-clear',
    clearManualHighlightMarks: () => {}, currentManualUnresolved: [],
    manualUiLifecycle: { retain() {} }, publishNativePdfAnnotations: () => {},
    showManualStatus: () => {}, notifyManualAnnotationStateChanged: () => {}
  }, true);
  assert.equal(clear.run('document-clear'), true);
  assert.equal(clear.prepared().documentCreationToken, undefined);
  const project = executable('content.js', 'projectCommittedArticleWorkspaceDocument', {
    currentManualDocument: initial(), manualPrepareSequence: 1, manualDocumentEpochState: {},
    nextManualDocumentEpochState: () => ({}), articleWorkspaceLifecycleGeneration: 1,
    currentManualBlocks: [], manualPreparedHref: '', effectiveArticlePageUrl: () => workspace.canonicalUrl,
    manualPreparedContentSequence: 1, articleStructureChangeSequence: 1,
    manualUiLifecycle: { beginDocument() {} }, restoreManualAnnotations: () => ({ unresolved: [] }),
    scheduleManualSelectionInspection: () => {}
  }, true);
  project.run({ record: { ...record, revision: 2, annotations: [] }, blocks: [] });
  assert.equal(project.prepared().documentCreationToken, undefined);
  assert.deepEqual(project.prepared().activeCategories, ['preserved']);
});
test('missing token or mismatched prepared document/hash/canonical cannot forward creation provenance', () => {
  const prepared = { documentId: record.documentId, record, documentCreationToken: token };
  for (const value of [null, { ...prepared, documentCreationToken: '' },
    { ...prepared, documentCreationToken: 123 }, { ...prepared, documentCreationToken: 'x'.repeat(161) },
    { ...prepared, documentId: 'other' },
    { ...prepared, record: { ...record, documentHash: 'different' } },
    { ...prepared, record: { ...record, canonicalUrl: 'https://example.org/other' } }]) {
    assert.equal(Object.hasOwn(ensure(value), 'documentCreationToken'), false);
  }
  assert.equal(Object.hasOwn(ensure(prepared, record, { ...workspace, canonicalUrl: 'https://example.org/other' }),
    'documentCreationToken'), false);
});
for (const name of ['restoreCurrentArticleWorkspaceFromDirectory', 'scanArticleWorkspaceForContext']) {
  test(`actual ${name} forwards the paired token and fresh archive identity to SCAN`, async () => {
    const calls = [];
    const ensured = ensure({ documentId: record.documentId, record, documentCreationToken: token });
    const fn = executable('popup.js', name, {
      capturePanelContext: () => ({ tabId: 4 }), isCurrentPanelContext: () => true,
      resolveArticleWorkspaceDirectoryPermission: async () => 'granted',
      sendTabMessage: async () => ensured, assertArticleWorkspaceRestorePanelReady: () => {},
      currentArticleArchiveIdentity: () => { throw Error('stale sidebar identity must not be used'); },
      currentArticleArchiveProbe: null, setArticleArchivePrompt: () => {},
      describeArticleWorkspaceRestoreError: error => error.message,
      showStatus: () => {}, t: value => value,
      sendLlmMessage: async message => { calls.push(message); return { permission: 'denied' }; }
    });
    await fn({ panelContext: { tabId: 4 } }).catch(() => {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, 'ARTICLE_WORKSPACE_SCAN_RESTORE');
    assert.equal(calls[0].documentCreationToken, token);
    assert.equal(calls[0].operationNonce, 'operation-nonce');
    assert.equal(calls[0].identity.documentId, record.documentId);
    assert.equal(calls[0].identity.documentHash, record.documentHash);
  });
}
