const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

require('../core/cache-planner.js');
require('../core/article-workspace.js');
const {
  ARTICLE_ARCHIVE_KIND,
  articleArchiveRelativePath,
  createArticleArchive,
  validateArticleArchive,
  convertLegacyArticleArchiveToWorkspace
} = require('../core/article-archive.js');

function sampleArchiveInput() {
  const documentId = `sha256:${'a'.repeat(64)}`;
  return {
    revision: 7,
    extensionVersion: '2.1.0',
    identity: {
      documentId,
      documentHash: 'doc-hash-1',
      canonicalUrl: 'https://example.org/article/1?utm_source=test#results',
      title: 'Mechanism review',
      publisher: 'elsevier'
    },
    documentRecord: {
      schemaVersion: 1,
      documentId,
      documentHash: 'doc-hash-1',
      title: 'Mechanism review',
      canonicalUrl: 'https://example.org/article/1',
      studyType: 'narrative_review',
      revision: 4,
      updatedAt: '2026-07-17T08:00:00.000Z',
      annotations: [{
        annotationId: 'manual-1', categoryId: 'limitation',
        quote: 'sample size was small', note: 'Verify cohort size'
      }]
    },
    workspace: {
      lastRegexRequest: { mode: 'sentence', categories: [{ categoryId: 'limitation' }] },
      llm: {
        rawAnalysis: { annotations: [{ categoryId: 'key_result', quote: 'survival improved' }] },
        paragraphs: [{ paragraphId: 'p1', text: 'Survival improved in the treatment group.' }],
        confidenceThreshold: 0.8
      },
      reviewOutline: { sections: [{ title: 'Mechanisms', summary: 'A mechanism summary.' }] },
      figures: [{ figureId: 'fig-1', label: 'Figure 1', result: { summary: 'Pathway model.' } }],
      ledger: [{ categoryId: 'key_result', quote: 'survival improved' }],
      apiKey: 'sk-must-not-leak',
      headers: { Authorization: 'Bearer must-not-leak' },
      preview: 'data:image/png;base64,AAAA',
      pageHtml: '<html>whole page must not be archived</html>'
    }
  };
}

test('uses one deterministic bounded file path per document identity', () => {
  const first = articleArchiveRelativePath(`sha256:${'a'.repeat(64)}`);
  const second = articleArchiveRelativePath(`sha256:${'a'.repeat(64)}`);
  const other = articleArchiveRelativePath(`sha256:${'b'.repeat(64)}`);

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^articles\/[a-f0-9]{8}\.json$/);
  assert.ok(first.length < 80);
  assert.throws(() => articleArchiveRelativePath('../escape'), /INVALID_DOCUMENT_ID/);
});

test('creates a complete portable article archive while stripping secrets and page payloads', () => {
  const archive = createArticleArchive(sampleArchiveInput());

  assert.equal(archive.kind, ARTICLE_ARCHIVE_KIND);
  assert.equal(archive.schemaVersion, 1);
  assert.equal(archive.revision, 7);
  assert.equal(archive.documentRecord.annotations[0].note, 'Verify cohort size');
  assert.equal(archive.workspace.llm.rawAnalysis.annotations[0].categoryId, 'key_result');
  assert.equal(archive.workspace.reviewOutline.sections[0].title, 'Mechanisms');
  assert.equal(archive.workspace.figures[0].result.summary, 'Pathway model.');

  const serialized = JSON.stringify(archive);
  assert.doesNotMatch(serialized, /sk-must-not-leak|Bearer must-not-leak|data:image|whole page/);
  assert.doesNotMatch(serialized, /apiKey|Authorization|pageHtml|headers/);
  assert.deepEqual(validateArticleArchive(JSON.parse(serialized)), archive);
});

test('rejects mismatched identities, unsupported schemas, and oversized archives', () => {
  const mismatched = sampleArchiveInput();
  mismatched.documentRecord.documentId = `sha256:${'b'.repeat(64)}`;
  assert.throws(() => createArticleArchive(mismatched), /ARCHIVE_IDENTITY_MISMATCH/);

  const valid = createArticleArchive(sampleArchiveInput());
  assert.throws(
    () => validateArticleArchive({ ...valid, schemaVersion: 99 }),
    /INVALID_ARCHIVE_SCHEMA/
  );
  assert.throws(
    () => createArticleArchive({
      ...sampleArchiveInput(),
      workspace: { huge: 'x'.repeat(16 * 1024 * 1024) }
    }),
    /ARTICLE_ARCHIVE_TOO_LARGE/
  );
});

test('converts a legacy monolithic archive into workspace assets without changing its old path', async () => {
  const archive = createArticleArchive(sampleArchiveInput());
  const legacyPath = articleArchiveRelativePath(archive);
  const converted = await convertLegacyArticleArchiveToWorkspace(archive);

  assert.match(converted.workspace.workspaceId, /^workspace:[a-f0-9]{64}$/);
  assert.equal(converted.manifest.canonicalUrl, 'https://example.org/article/1');
  assert.ok(converted.assets.some(asset => asset.path === 'legacy/archive.json'));
  assert.equal(articleArchiveRelativePath(archive), legacyPath);
  assert.equal(converted.legacy.relativePath, legacyPath);
  assert.equal(converted.legacy.deleteAfterImport, false);
});

test('content and side panel expose archive snapshot, restore, probe, and portable file controls', () => {
  const root = join(__dirname, '..');
  const content = readFileSync(join(root, 'content.js'), 'utf8');
  const popup = readFileSync(join(root, 'popup.js'), 'utf8');
  const html = readFileSync(join(root, 'popup.html'), 'utf8');
  const messenger = readFileSync(join(root, 'core', 'tab-messenger.js'), 'utf8');

  assert.match(content, /function buildCurrentArticleArchive/);
  assert.match(content, /function applyArticleArchiveSnapshot/);
  assert.match(content, /lastRegexHighlightRequest/);
  assert.match(content, /action === 'getArticleArchiveSnapshot'/);
  assert.match(content, /action === 'applyArticleArchiveSnapshot'/);
  assert.ok(
    messenger.indexOf("'core/article-archive.js'") < messenger.indexOf("'content.js'")
  );

  assert.match(popup, /async function probeCurrentArticleArchive/);
  assert.match(popup, /workspaceAlreadyHasArticleResults/);
  assert.match(popup, /readArticleArchivePromptDecision/);
  assert.match(popup, /rememberArticleArchivePromptDecision\(\s*imported \? 'imported' : 'loaded'/);
  assert.match(popup, /rememberArticleArchivePromptDecision\('skipped'/);
  assert.match(popup, /async function loadCurrentArticleArchive/);
  assert.match(popup, /async function restoreCurrentArticleWorkspaceFromDirectory/);
  assert.match(
    popup,
    /loadCurrentArticleArchive\(\)[\s\S]*restoreCurrentArticleWorkspaceFromDirectory\([\s\S]*workspace-loaded/
  );
  assert.match(popup, /已从本地工作区恢复全部结果和 \$\{turnCount\} 轮历史问答/);
  assert.match(popup, /async function persistCurrentArticleArchive/);
  assert.match(popup, /ARTICLE_ARCHIVE_PROBE/);
  assert.match(popup, /ARTICLE_ARCHIVE_SAVE/);
  assert.match(popup, /ARTICLE_ARCHIVE_LOAD/);
  assert.match(
    popup,
    /function downloadArticleArchive\(archive\)[\s\S]*downloadBlob\(blob, `\$\{title\}\.sci-archive\.json`\)/
  );
  assert.match(html, /id="loadArticleArchive"/);
  assert.match(html, /id="reanalyzeArticle"/);
  assert.match(html, /id="exportCurrentArticleArchive"/);
  assert.match(html, /id="importCurrentArticleArchive"/);
  assert.ok(
    html.indexOf('core/article-archive.js') < html.indexOf('popup.js')
  );
});

test('workspace restore preserves changed-content safety and current-page clear controls', () => {
  const root = join(__dirname, '..');
  const content = readFileSync(join(root, 'content.js'), 'utf8');
  const popup = readFileSync(join(root, 'popup.js'), 'utf8');
  assert.match(content, /match === 'content-changed'/);
  assert.match(content, /restoredWithoutRanges/);
  assert.match(popup, /scanCurrentArticleWorkspace/);
  assert.match(popup, /clearCurrentArticleWorkspace/);
  assert.match(popup, /workspaceGeneration/);
});

test('active persistence uses bounded workspace assets while retaining legacy archive import', () => {
  const root = join(__dirname, '..');
  const content = readFileSync(join(root, 'content.js'), 'utf8');
  const router = readFileSync(join(root, 'core', 'background-router.js'), 'utf8');
  for (const relativePath of [
    'article/structure.json', 'article/paragraphs.json', 'annotations/highlights.json',
    'analysis/full-analysis.json', 'chat/index.json', 'figures/inventory.json', 'ui/state.json'
  ]) assert.match(content, new RegExp(relativePath.replace(/[./]/g, '\\$&')));
  assert.match(content, /ARTICLE_WORKSPACE_SAVE_ASSET/);
  assert.match(router, /convertLegacyArticleArchiveToWorkspace/);
  assert.match(router, /legacyPreserved\s*=\s*true/);
});
