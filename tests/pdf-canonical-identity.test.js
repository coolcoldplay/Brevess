const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
require('../core/article-chat.js');

function functionSource(name, next) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${next}(`, start + 1);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function harness(native = true) {
  const binaryHash = 'a'.repeat(64);
  const structure = { adapterId: native ? 'pdf-native' : 'html',
    documentId: `sha256:${binaryHash}`, documentHash: binaryHash, revision: 1,
    paragraphs: [{ paragraphId: 'pdf-page-1', sourceKey: 'pdf-page-1',
      text: 'This is the selected evidence.', recordType: 'body', sectionKind: 'main' }] };
  const context = vm.createContext({
    currentArticleStructure: structure, canonicalArticleSnapshotCache: null,
    currentManualDocument: null,
    lastPreparedStudy: { documentId: 'semantic-document', documentHash: 'b'.repeat(64) },
    currentArticleWorkspace: { workspaceId: 'workspace-a', workspaceGeneration: 1 },
    SciLLM: { structureSignature: () => 'structure-signature' },
    activeNativePdfStructure: () => native ? structure : null,
    extractCurrentArticleStructure: () => structure,
    canonicalArticlePreindexUrl: () => 'file:///original.pdf',
    effectiveArticlePageUrl: () => 'file:///original.pdf'
  });
  vm.runInContext(functionSource('getCanonicalArticleSnapshot', 'buildArticlePreindexFromRecords') +
    functionSource('currentFigureWorkspaceRefreshBinding', 'sameFigureWorkspaceRefreshBinding') +
    functionSource('captureEvidenceFirstMechanismBinding', 'invalidateCrossFigureLogic') +
    functionSource('captureCurrentArticleArchiveRestoreIdentity', 'captureCurrentArticleWorkspaceRestoreIdentity').replace(/async\s*$/, ''), context);
  return { context, binaryHash, structure };
}

test('PDF chat identity survives the transient manual-preparation gap and semantic LLM hashes', () => {
  const h = harness();
  const snapshot = h.context.getCanonicalArticleSnapshot();
  assert.equal(snapshot.documentHash, h.binaryHash);
  // Exercise the actual chat input validator: this used to reject selectionEvidence
  // before any API call because the snapshot fell back to the LLM text hash.
  const input = globalThis.SciLLM.normalizeArticleChatInput({
    question: 'Explain the selected passage', profileId: 'profile_pdf_test',
    selectionEvidence: { text: 'selected evidence', paragraphId: 'pdf-page-1', pageNumber: 1,
      contextHash: 'context-hash', documentHash: h.binaryHash,
      documentGeneration: 1, selectionGeneration: 1 },
    document: { documentHash: snapshot.documentHash, paragraphs: h.structure.paragraphs }
  });
  assert.equal(input.selectionEvidence.documentHash, h.binaryHash);
  h.context.currentManualDocument = { documentId: 'stale', record: { documentHash: 'c'.repeat(64) } };
  assert.equal(h.context.getCanonicalArticleSnapshot({ forceRefresh: true }).documentHash, h.binaryHash);
});

test('PDF Figure draft binding is stable while manual metadata is being rebuilt', () => {
  const h = harness();
  const before = h.context.currentFigureWorkspaceRefreshBinding();
  h.context.currentManualDocument = { documentId: 'old-id',
    record: { documentHash: 'c'.repeat(64), canonicalUrl: 'file:///old.pdf' } };
  const during = h.context.currentFigureWorkspaceRefreshBinding();
  assert.equal(during.documentId, `sha256:${h.binaryHash}`);
  assert.equal(during.documentHash, h.binaryHash);
  assert.deepEqual(JSON.parse(JSON.stringify(during)), JSON.parse(JSON.stringify(before)));
});

test('ordinary HTML retains its prepared document identity', () => {
  const h = harness(false);
  assert.equal(h.context.getCanonicalArticleSnapshot().documentHash, 'b'.repeat(64));
  assert.equal(h.context.currentFigureWorkspaceRefreshBinding().documentId, 'semantic-document');
});

test('mechanism and archive restore use the same original-PDF identity during metadata rebuild', () => {
  const h = harness();
  Object.assign(h.context, { figureWorkspaceDraft: { revision: 2, mechanismChain: {} },
    articleWorkspaceLifecycleGeneration: 3, mechanismChainFingerprint: () => 'chain',
    normalizedArticleArchiveRestoreIdentity: value => value });
  assert.equal(h.context.captureEvidenceFirstMechanismBinding().documentId, `sha256:${h.binaryHash}`);
  const archived = h.context.captureCurrentArticleArchiveRestoreIdentity();
  assert.equal(archived.documentId, `sha256:${h.binaryHash}`);
  assert.equal(archived.documentHash, h.binaryHash);
  assert.equal(archived.canonicalUrl, 'file:///original.pdf');
});
