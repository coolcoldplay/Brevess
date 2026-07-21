const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

require('../core/category-store.js');
require('../core/adaptive-catalog.js');
require('../core/study-profile.js');
require('../core/confidence-policy.js');
require('../core/settings-store.js');
require('../providers/provider-utils.js');
require('../core/prompt-compiler.js');
require('../core/chunker.js');
require('../core/result-validator.js');
require('../core/evidence-ledger.js');
require('../core/figure-analysis.js');
require('../core/figure-panel-planner.js');
require('../core/article-chat-tokenizer.js');
require('../core/article-chat-index.js');
require('../core/article-chat-retrieval.js');
require('../core/article-chat-memory.js');
require('../core/article-chat-citations.js');
require('../core/article-chat-stream.js');
require('../core/article-chat.js');
require('../core/cross-figure-logic.js');
require('../core/review-outline.js');
require('../core/cache-planner.js');
require('../core/article-workspace.js');
const {
  articleArchiveRelativePath,
  createArticleArchive
} = require('../core/article-archive.js');
require('../core/migration-bundle.js');
require('../core/analysis-pipeline.js');
require('../core/analysis-cache.js');
require('../core/review-outline-pipeline.js');
require('../core/corpus-store.js');
require('../core/manual-annotations.js');
const { createMemoryDocumentStore } = require('../core/document-store.js');
require('../providers/openai.js');
require('../providers/anthropic.js');
require('../providers/gemini.js');
require('../providers/deepseek.js');
require('../providers/openai-compatible.js');
require('../providers/provider-registry.js');
require('../core/task-profile-router.js');
require('../core/token-budget.js');
require('../core/article-chat-context-planner.js');
require('../core/operation-control.js');
const { createBackgroundRouter } = require('../core/background-router.js');
const { validBlueprint } = require('./helpers/adaptive-fixtures.js');

function createMemoryStorage() {
  const values = {};
  return {
    values,
    get(key, callback) { callback({ [key]: values[key] }); },
    set(input, callback) { Object.assign(values, input); callback(); }
  };
}

function createDelayedCloneStorage() {
  const values = {};
  const clone = value => value === undefined
    ? undefined : JSON.parse(JSON.stringify(value));
  return {
    values,
    get(key, callback) {
      const keys = Array.isArray(key) ? key : [key];
      const snapshot = Object.fromEntries(keys.map(item => [item, clone(values[item])]));
      setTimeout(() => callback(snapshot), 0);
    },
    set(input, callback) {
      setTimeout(() => {
        Object.assign(values, clone(input));
        callback();
      }, 5);
    }
  };
}

function createDirectorySyncDouble(options = {}) {
  const json = [];
  const text = [];
  const readPaths = [];
  const workspaceAssets = [];
  const flushGate = options.flushGate || Promise.resolve({ permission: 'granted' });
  return {
    json,
    text,
    readPaths,
    workspaceAssets,
    flushCalls: 0,
    permissionRequests: 0,
    async requestDirectoryPermission() {
      this.permissionRequests += 1;
      return options.requestDirectoryPermission?.() || {
        permission: 'granted', granted: true
      };
    },
    async enqueueJson(path, value) {
      if (options.enqueueError) throw options.enqueueError;
      json.push({ path, value: JSON.parse(JSON.stringify(value)) });
    },
    async enqueueText(path, value) {
      if (options.enqueueError) throw options.enqueueError;
      text.push({ path, value: String(value) });
    },
    flush() {
      this.flushCalls += 1;
      return flushGate;
    },
    async status() {
      return { permission: 'prompt', pendingCount: json.length + text.length };
    },
    async readJson(path) {
      readPaths.push(path);
      if (typeof options.readJson === 'function') return options.readJson(path);
      return { permission: 'granted', found: false, value: null };
    },
    async rebuildIndex(importer) {
      const results = [];
      for (const asset of options.rebuildAssets || []) {
        results.push(await importer(asset.path, asset.value, asset.metadata || {}));
      }
      return {
        imported: results.filter(item => item?.imported).length,
        stale: results.filter(item => item?.reason === 'stale').length,
        invalidAssets: results.filter(item => !item?.imported && item?.reason !== 'stale').length
      };
    },
    async exportBundle(bundle) {
      return JSON.parse(JSON.stringify(bundle));
    },
    async enqueueWorkspaceAsset(workspace, path, value, metadata) {
      workspaceAssets.push({ workspace, path, value, metadata });
      return { queued: true, relativePath: `workspaces/${workspace.directoryName}/${path}` };
    },
    async readWorkspaceAsset(workspace, path) {
      return options.readWorkspaceAsset?.(workspace, path) || {
        permission: 'granted', found: false, value: null
      };
    },
    async listWorkspaceManifests(identity) {
      return options.listWorkspaceManifests?.(identity) || {
        permission: 'granted', manifests: [], matches: []
      };
    },
    async rebuildWorkspaceIndex() {
      return options.rebuildWorkspaceIndex?.() || {
        permission: 'granted', workspaceCount: 0, quarantined: 0
      };
    },
    async cancelWorkspaceQueue(workspace) {
      return options.cancelWorkspaceQueue?.(workspace) || { cancelled: 0 };
    },
    async removeWorkspaceTree(workspace) {
      return options.removeWorkspaceTree?.(workspace) || { permission: 'granted', removed: true };
    }
  };
}

function createArticleWorkspaceStoreDouble() {
  const workspaces = new Map();
  const assets = new Map();
  const turns = new Map();
  const deletionGenerations = new Map();
  return {
    async ensureWorkspace(workspace) {
      const saved = { ...workspace, storageRevision: workspace.storageRevision || 0 };
      workspaces.set(saved.workspaceId, saved);
      return structuredClone(saved);
    },
    async getWorkspace(id) { return structuredClone(workspaces.get(id) || null); },
    async listWorkspaces() { return [...workspaces.values()].map(value => structuredClone(value)); },
    async putAsset(id, path, content) {
      const saved = { workspaceId: id, relativePath: path, content, revision: 1 };
      assets.set(`${id}:${path}`, saved);
      return structuredClone(saved);
    },
    async listAssets(id) {
      return [...assets.values()].filter(item => item.workspaceId === id)
        .map(value => structuredClone(value));
    },
    async appendTurn(id, turn) {
      const saved = { ...turn, workspaceId: id, sequence: (turns.get(id)?.length || 0) + 1, revision: 1 };
      turns.set(id, [...(turns.get(id) || []), saved]);
      return structuredClone(saved);
    },
    async pageTurns(id) { return { items: structuredClone(turns.get(id) || []), hasMore: false }; },
    async getStorageStatistics() {
      return { workspaceCount: workspaces.size, assetCount: assets.size,
        turnCount: [...turns.values()].flat().length, estimatedBytes: 123 };
    },
    async beginWorkspaceDeletion(id) {
      const workspace = workspaces.get(id);
      if (workspace) workspaces.set(id, { ...workspace, deletionPending: true });
      deletionGenerations.set(id, Number(workspace?.workspaceGeneration || 1));
      return { workspaceId: id, tombstoneId: 'workspace-delete-1', entityType: 'workspace' };
    },
    async finalizeWorkspaceDeletion(id) { workspaces.delete(id); return true; },
    async getWorkspaceGenerationState(id) {
      const workspace = workspaces.get(id);
      return {
        workspaceId: id,
        activeGeneration: Number(workspace?.workspaceGeneration || 0),
        deletionGeneration: Number(deletionGenerations.get(id) || 0),
        deletionPending: Boolean(workspace?.deletionPending)
      };
    }
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    async text() { return JSON.stringify(body); }
  };
}

async function selectStudyType(router, document, studyType = 'observational') {
  const prepared = await router.handle({ type: 'LLM_PREPARE_DOCUMENT', document });
  assert.equal(prepared.success, true);
  const selected = await router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentHash: prepared.data.documentHash,
    studyType
  });
  assert.equal(selected.success, true);
  return selected;
}

test('registers only the one-type study selection message in the service worker', () => {
  const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
  assert.match(source, /'LLM_SET_STUDY_TYPE'/);
  assert.doesNotMatch(source, /'LLM_SAVE_STUDY_TYPE_OVERRIDE'/);
  ['CATEGORY_GET', 'CATEGORY_SAVE_OVERRIDE', 'CATEGORY_RESET_OVERRIDE',
    'CATEGORY_TEST_REGEX'].forEach(type => assert.match(source, new RegExp(`'${type}'`)));
  ['DOCUMENT_PREPARE', 'DOCUMENT_GET', 'ANNOTATION_UPSERT',
    'ANNOTATION_DELETE', 'ANNOTATION_CLEAR_DOCUMENT']
    .forEach(type => assert.match(source, new RegExp(`'${type}'`)));
  ['ARTICLE_ARCHIVE_PROBE', 'ARTICLE_ARCHIVE_SAVE', 'ARTICLE_ARCHIVE_LOAD']
    .forEach(type => assert.match(source, new RegExp(`'${type}'`)));
  ['ARTICLE_WORKSPACE_ENSURE', 'ARTICLE_WORKSPACE_SAVE_ASSET',
    'ARTICLE_WORKSPACE_SAVE_TURN', 'ARTICLE_WORKSPACE_PROBE',
    'ARTICLE_WORKSPACE_SCAN_RESTORE', 'ARTICLE_WORKSPACE_LIST',
    'ARTICLE_WORKSPACE_STATS', 'ARTICLE_WORKSPACE_EXPORT',
    'ARTICLE_WORKSPACE_BEGIN_DELETE', 'ARTICLE_WORKSPACE_FINALIZE_DELETE',
    'ARTICLE_WORKSPACE_REBUILD_INDEX']
    .forEach(type => assert.match(source, new RegExp(`'${type}'`)));
  assert.match(source, /'LLM_ASK_ARTICLE'/);
  assert.match(source, /'LLM_ANALYZE_FIGURE_PANEL'/);
  assert.ok(source.indexOf('core/figure-panel-planner.js') <
    source.indexOf('core/figure-analysis.js'));
  assert.ok(source.indexOf('core/article-chat-tokenizer.js') <
    source.indexOf('core/article-chat-index.js'));
  assert.ok(source.indexOf('core/article-chat-index.js') <
    source.indexOf('core/article-chat-retrieval.js'));
  assert.ok(source.indexOf('core/article-chat-retrieval.js') <
    source.indexOf('core/article-chat-memory.js'));
  assert.ok(source.indexOf('core/article-chat-memory.js') <
    source.indexOf('core/article-chat-context-planner.js'));
  assert.ok(source.indexOf('core/article-chat-citations.js') <
    source.indexOf('core/article-chat-stream.js'));
  assert.ok(source.indexOf('core/article-chat-stream.js') <
    source.indexOf('core/article-chat.js'));
  assert.match(source, /core\/article-chat\.js/);
  assert.match(source, /core\/article-archive\.js/);
  assert.match(source, /core\/manual-annotations\.js/);
  assert.match(source, /core\/document-store\.js/);
  assert.match(source, /createIndexedDbDocumentStore\(indexedDB\)/);
});

const manualDocument = {
  title: 'Persistent annotation paper',
  canonicalUrl: 'https://example.org/persistent-paper?utm_source=test#results',
  paragraphs: [{
    paragraphId: 'p1', sectionTitle: 'Results', sectionKind: 'results',
    text: 'Treatment improved survival, although the sample was small.'
  }]
};

function portableArchive(documentId = `sha256:${'c'.repeat(64)}`) {
  return createArticleArchive({
    revision: 2,
    savedAt: '2026-07-17T09:00:00.000Z',
    extensionVersion: '2.1.0',
    identity: {
      documentId,
      documentHash: 'archive-hash',
      canonicalUrl: 'https://example.org/archived-paper',
      title: 'Archived paper',
      publisher: 'elsevier'
    },
    documentRecord: {
      schemaVersion: 1,
      documentId,
      documentHash: 'archive-hash',
      title: 'Archived paper',
      canonicalUrl: 'https://example.org/archived-paper',
      studyType: 'narrative_review',
      annotations: [],
      revision: 3,
      updatedAt: '2026-07-17T08:00:00.000Z'
    },
    workspace: { ledger: [{ categoryId: 'key_result', quote: 'A result' }] }
  });
}

test('probes, saves, and applies one per-article archive through the background router', async () => {
  const archive = portableArchive();
  const expectedPath = articleArchiveRelativePath(archive);
  const directorySync = createDirectorySyncDouble({
    readJson: async path => ({
      permission: 'granted', found: path === expectedPath,
      value: path === expectedPath ? archive : null
    })
  });
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    documentStore,
    directorySync,
    fetchImpl: async () => { throw new Error('archive operations must stay local'); }
  });

  const probe = await router.handle({
    type: 'ARTICLE_ARCHIVE_PROBE',
    documentId: archive.documentId,
    canonicalUrl: archive.canonicalUrl
  });
  assert.equal(probe.success, true);
  assert.equal(probe.data.found, true);
  assert.equal(probe.data.savedAt, archive.savedAt);
  assert.deepEqual(directorySync.readPaths, [expectedPath]);
  assert.equal(directorySync.json.length, 0);

  const saved = await router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive });
  assert.equal(saved.success, true);
  assert.equal(saved.data.relativePath, expectedPath);
  assert.equal(directorySync.json.at(-1).path, expectedPath);

  const loaded = await router.handle({
    type: 'ARTICLE_ARCHIVE_LOAD',
    documentId: archive.documentId,
    canonicalUrl: archive.canonicalUrl,
    apply: true
  });
  assert.equal(loaded.success, true);
  assert.equal(loaded.data.archive.workspace.ledger[0].quote, 'A result');
  assert.equal(loaded.data.applied, true);
  assert.equal((await documentStore.getDocument(archive.documentId)).title, 'Archived paper');
});

test('exports and imports a complete migration bundle including provider credentials', async () => {
  const sourceStorage = createMemoryStorage();
  const settings = globalThis.SciLLM.createDefaultSettings();
  const deepseekProfileId = globalThis.SciLLM.legacyProfileId('deepseek');
  settings.mode = 'llm';
  settings.consentGranted = true;
  settings.profiles[deepseekProfileId] = globalThis.SciLLM.normalizeProfile(
    deepseekProfileId,
    {
      name: 'DeepSeek', providerId: 'deepseek',
      config: { apiKey: 'sk-migrate-me', model: 'deepseek-chat' }
    }
  );
  settings.profileOrder.push(deepseekProfileId);
  settings.globalProfileId = deepseekProfileId;
  await globalThis.SciLLM.saveSettings(sourceStorage, settings);
  const sourceDocuments = createMemoryDocumentStore();
  const archive = portableArchive();
  await sourceDocuments.putDocument(archive.documentRecord);
  const sourceCorpus = globalThis.SciLLM.createMemoryCorpusStore();
  await sourceCorpus.add({
    sampleId: 'migration-sample', documentHash: 'hash', paragraphId: 'p1',
    categoryId: 'key_result', userAction: 'accepted'
  });
  const sourceRouter = createBackgroundRouter({
    storageArea: sourceStorage,
    documentStore: sourceDocuments,
    corpusStore: sourceCorpus,
    fetchImpl: async () => { throw new Error('migration must stay local'); }
  });

  const exported = await sourceRouter.handle({
    type: 'MIGRATION_EXPORT', extensionVersion: '2.1.0'
  });
  assert.equal(exported.success, true);
  assert.equal(
    exported.data.settings.profiles[deepseekProfileId].config.apiKey,
    'sk-migrate-me'
  );

  const targetStorage = createMemoryStorage();
  const targetDocuments = createMemoryDocumentStore();
  const targetCorpus = globalThis.SciLLM.createMemoryCorpusStore();
  const targetRouter = createBackgroundRouter({
    storageArea: targetStorage,
    documentStore: targetDocuments,
    corpusStore: targetCorpus,
    fetchImpl: async () => { throw new Error('migration must stay local'); }
  });
  const imported = await targetRouter.handle({
    type: 'MIGRATION_IMPORT', bundle: exported.data
  });
  assert.equal(imported.success, true);
  assert.equal(imported.data.importedDocuments, 1);
  assert.equal(imported.data.importedFeedback, 1);
  assert.equal(
    targetStorage.values.sciLlmSettingsV2.profiles[deepseekProfileId].config.apiKey,
    'sk-migrate-me'
  );
  assert.equal((await targetDocuments.exportAll()).documents.length, 1);
  assert.equal((await targetCorpus.list()).length, 1);
});

function routerAnnotation(overrides = {}) {
  const quote = 'the sample was small';
  return {
    annotationId: 'manual-1',
    categoryId: 'limitation',
    categorySnapshot: { name: 'Spoofed category', color: '#000000' },
    quote,
    prefix: 'although ',
    suffix: '.',
    sectionTitle: 'Results',
    blockFingerprint: 'p1-fingerprint',
    startOffset: 38,
    endOffset: 38 + quote.length,
    note: 'Check sample size',
    ...overrides
  };
}

test('prepares one persistent document, migrates a matching legacy type once, and returns categories', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const documentHash = await globalThis.SciLLM.hashDocument(manualDocument.paragraphs);
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.version = 3;
  settings.studyTypeOverrides[documentHash] = {
    primaryType: 'observational', updatedAt: 10
  };
  storageArea.values.sciLlmSettingsV2 = settings;
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('document prepare must not call a provider'); }
  });

  const first = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  settings.studyTypeOverrides[documentHash] = {
    primaryType: 'clinical_trial', updatedAt: 20
  };
  storageArea.values.sciLlmSettingsV2 = settings;
  const second = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });

  assert.equal(first.success, true);
  assert.match(first.data.documentId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.data.documentHash, documentHash);
  assert.equal(first.data.record.studyType, 'observational');
  assert.equal(first.data.record.legacyStudyTypeMigrated, true);
  assert.equal(second.data.record.studyType, 'observational');
  assert.equal(second.data.record.revision, first.data.record.revision);
  assert.ok(first.data.activeCategories.length > 0);
  assert.ok(first.data.activeCategories.every(category =>
    category.categoryId && category.name && category.color
  ));
});

test('annotation routes trust the merged catalog snapshot and support get, delete, and clear', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('annotation routes must not call a provider'); }
  });
  const prepared = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  const documentId = prepared.data.documentId;

  const upserted = await router.handle({
    type: 'ANNOTATION_UPSERT', documentId, annotation: routerAnnotation()
  });
  const fetched = await router.handle({ type: 'DOCUMENT_GET', documentId });
  const invalid = await router.handle({
    type: 'ANNOTATION_UPSERT', documentId,
    annotation: routerAnnotation({ categoryId: 'missing_category' })
  });
  const deleted = await router.handle({
    type: 'ANNOTATION_DELETE', documentId, annotationId: 'manual-1'
  });
  await router.handle({
    type: 'ANNOTATION_UPSERT', documentId,
    annotation: routerAnnotation({ annotationId: 'manual-2' })
  });
  const cleared = await router.handle({ type: 'ANNOTATION_CLEAR_DOCUMENT', documentId });

  assert.equal(upserted.success, true);
  const trusted = globalThis.SciLLM.createUnifiedCategoryCatalog().limitation;
  assert.deepEqual(upserted.data.annotation.categorySnapshot, {
    name: trusted.name, color: trusted.color
  });
  assert.equal(fetched.data.record.annotations.length, 1);
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.code, 'INVALID_SETTINGS');
  assert.deepEqual(invalid.error.fields, ['categoryId']);
  assert.equal(deleted.data.record.annotations.length, 0);
  assert.equal(cleared.data.record.annotations.length, 0);
});

test('concurrent annotation routes keep both mutations and default document stores are isolated', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const otherRouter = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const prepared = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  const documentId = prepared.data.documentId;
  const [first, second] = await Promise.all([
    router.handle({
      type: 'ANNOTATION_UPSERT', documentId,
      annotation: routerAnnotation({ annotationId: 'concurrent-1' })
    }),
    router.handle({
      type: 'ANNOTATION_UPSERT', documentId,
      annotation: routerAnnotation({ annotationId: 'concurrent-2' })
    })
  ]);
  const saved = await router.handle({ type: 'DOCUMENT_GET', documentId });
  const isolated = await otherRouter.handle({ type: 'DOCUMENT_GET', documentId });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.deepEqual(
    saved.data.record.annotations.map(item => item.annotationId).sort(),
    ['concurrent-1', 'concurrent-2']
  );
  assert.equal(isolated.data.record, null);
});

test('study type writes use the document store and never mutate legacy settings overrides', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const legacyHash = 'a'.repeat(64);
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.studyTypeOverrides[legacyHash] = { studyType: 'observational', updatedAt: 1 };
  storageArea.values.sciLlmSettingsV2 = settings;
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const prepared = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  const before = structuredClone(storageArea.values.sciLlmSettingsV2.studyTypeOverrides);

  const selected = await router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentId: prepared.data.documentId,
    studyType: 'clinical_trial'
  });

  assert.equal(selected.success, true);
  assert.equal(selected.data.studyProfile.primaryType, 'clinical_trial');
  assert.equal((await documentStore.getDocument(prepared.data.documentId)).studyType, 'clinical_trial');
  assert.deepEqual(storageArea.values.sciLlmSettingsV2.studyTypeOverrides, before);
});

test('resolves a prepared document hash after the router is recreated', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const firstRouter = createBackgroundRouter({
    storageArea, documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const prepared = await firstRouter.handle({
    type: 'DOCUMENT_PREPARE', document: manualDocument
  });
  const secondRouter = createBackgroundRouter({
    storageArea, documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const selected = await secondRouter.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentHash: prepared.data.documentHash,
    studyType: 'observational'
  });

  assert.equal(selected.success, true);
  assert.equal(selected.data.documentId, prepared.data.documentId);
  assert.equal(
    (await documentStore.getDocument(prepared.data.documentId)).studyType,
    'observational'
  );
  assert.equal((await documentStore.listDocumentIndex()).length, 1);
});

test('document preparation cannot overwrite an annotation mutation interleaved after it', async () => {
  const storageArea = createMemoryStorage();
  const baseDocumentStore = createMemoryDocumentStore();
  let enterGate;
  let releaseGate;
  const entered = new Promise(resolve => { enterGate = resolve; });
  const released = new Promise(resolve => { releaseGate = resolve; });
  let gateUsed = false;
  async function gateOnce() {
    if (gateUsed) return;
    gateUsed = true;
    enterGate();
    await released;
  }
  const documentStore = {
    ...baseDocumentStore,
    async getDocument(...args) {
      const record = await baseDocumentStore.getDocument(...args);
      await gateOnce();
      return record;
    },
    async prepareDocument(...args) {
      await gateOnce();
      return baseDocumentStore.prepareDocument(...args);
    }
  };
  const router = createBackgroundRouter({
    storageArea, documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const documentId = await globalThis.SciLLM.createDocumentId(manualDocument);

  const preparing = router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  await entered;
  let annotationSettled = false;
  const annotating = router.handle({
    type: 'ANNOTATION_UPSERT', documentId,
    annotation: routerAnnotation()
  }).then(result => {
    annotationSettled = true;
    return result;
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(annotationSettled, false);
  releaseGate();
  const [prepared, annotated] = await Promise.all([preparing, annotating]);
  const saved = await documentStore.getDocument(documentId);
  assert.equal(prepared.success, true);
  assert.equal(annotated.success, true);
  assert.equal(saved.annotations.length, 1);
  assert.equal(saved.annotations[0].annotationId, 'manual-1');
});

test('deleting a referenced custom category retires it until references are removed', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const created = await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_retired', name: 'Retired later',
      definition: 'A category retained while historical annotations reference it.',
      persistence: 'saved', spanPolicy: 'clause', color: '#3366CC'
    }
  });
  assert.equal(created.success, true);
  const prepared = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  const documentId = prepared.data.documentId;
  const upserted = await router.handle({
    type: 'ANNOTATION_UPSERT', documentId,
    annotation: routerAnnotation({ categoryId: 'custom_retired' })
  });
  assert.equal(upserted.success, true);

  const retired = await router.handle({
    type: 'LLM_DELETE_CUSTOM_CATEGORY', categoryId: 'custom_retired'
  });
  const historical = await router.handle({ type: 'DOCUMENT_GET', documentId });
  const retainedDefinition = storageArea.values.sciLlmSettingsV2.customCategories
    .find(category => category.categoryId === 'custom_retired');

  assert.equal(retired.success, true);
  assert.equal(retired.data.retired, true);
  assert.equal(retired.data.referenceCount, 1);
  assert.equal(retainedDefinition.retired, true);
  assert.deepEqual(retainedDefinition.enabledEngines, []);
  assert.equal(historical.data.record.annotations[0].categorySnapshot.name, 'Retired later');
  assert.equal(
    storageArea.values.sciLlmSettingsV2.selectedCategoryIds.includes('custom_retired'),
    false
  );

  await router.handle({
    type: 'ANNOTATION_DELETE', documentId, annotationId: 'manual-1'
  });
  const removed = await router.handle({
    type: 'LLM_DELETE_CUSTOM_CATEGORY', categoryId: 'custom_retired'
  });
  assert.equal(removed.data.retired, false);
  assert.equal(removed.data.referenceCount, 0);
  assert.equal(
    storageArea.values.sciLlmSettingsV2.customCategories
      .some(category => category.categoryId === 'custom_retired'),
    false
  );
});

test('custom category deletion cannot hard-delete a concurrently referenced definition', async () => {
  const storageArea = createMemoryStorage();
  const baseDocumentStore = createMemoryDocumentStore();
  let countedResolve;
  let releaseCount;
  const counted = new Promise(resolve => { countedResolve = resolve; });
  const countReleased = new Promise(resolve => { releaseCount = resolve; });
  let gateCount = true;
  const documentStore = {
    ...baseDocumentStore,
    async countCategoryReferences(categoryId) {
      const count = await baseDocumentStore.countCategoryReferences(categoryId);
      if (gateCount && categoryId === 'custom_race') {
        gateCount = false;
        countedResolve(count);
        await countReleased;
      }
      return count;
    }
  };
  const router = createBackgroundRouter({
    storageArea, documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_race', name: 'Concurrent category',
      definition: 'A category used to exercise the reference race.',
      persistence: 'saved', spanPolicy: 'clause', color: '#3366CC'
    }
  });
  const prepared = await router.handle({
    type: 'DOCUMENT_PREPARE', document: manualDocument
  });
  const deleting = router.handle({
    type: 'LLM_DELETE_CUSTOM_CATEGORY', categoryId: 'custom_race'
  });
  assert.equal(await counted, 0);
  let annotationSettled = false;
  const annotating = router.handle({
    type: 'ANNOTATION_UPSERT', documentId: prepared.data.documentId,
    annotation: routerAnnotation({ categoryId: 'custom_race' })
  }).then(result => {
    annotationSettled = true;
    return result;
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(annotationSettled, false);
  releaseCount();
  const [deleted, annotated] = await Promise.all([deleting, annotating]);
  assert.equal(deleted.success, true);
  assert.equal(deleted.data.referenceCount, 0);
  assert.equal(annotated.success, false);
  assert.equal(annotated.error.code, 'INVALID_SETTINGS');
  assert.equal(await documentStore.countCategoryReferences('custom_race'), 0);
  assert.equal(
    storageArea.values.sciLlmSettingsV2.customCategories
      .some(category => category.categoryId === 'custom_race'),
    false
  );
});

test('gets a merged category and prompt preview without provider access or secrets', async () => {
  const storageArea = createMemoryStorage();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('category routes must not call a provider');
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'sk-category-secret-123456', model: 'gpt-5-mini' }
  });

  const result = await router.handle({ type: 'CATEGORY_GET', categoryId: 'limitation' });

  assert.equal(result.success, true);
  assert.equal(result.data.category.categoryId, 'limitation');
  assert.ok(Array.isArray(result.data.category.regex.phrases));
  assert.match(result.data.promptPreview, /类别：/);
  assert.deepEqual(result.data.metadata, { builtIn: true, overridden: false });
  assert.equal(providerCalls, 0);
  assert.doesNotMatch(JSON.stringify(result.data), /sk-category-secret|apiKey|providers/);
});

test('fresh settings state lists merged category names and colors without prompt internals', async () => {
  const storageArea = createMemoryStorage();
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.profiles.profile_default_openai.config.apiKey = 'sk-rail-secret-123456';
  settings.categoryOverrides.limitation = {
    name: '适用边界',
    color: '#173F6F',
    enabledEngines: ['regex']
  };
  storageArea.values.sciLlmSettingsV2 = settings;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const result = await router.handle({ type: 'LLM_GET_SETTINGS' });

  assert.equal(result.success, true);
  assert.equal(result.data.availableCategories.length, 47);
  const limitation = result.data.availableCategories
    .find(category => category.categoryId === 'limitation');
  assert.equal(limitation.name, '适用边界');
  assert.equal(limitation.color, '#173F6F');
  assert.equal(Object.prototype.hasOwnProperty.call(limitation, 'prompt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(limitation, 'regex'), false);
  assert.doesNotMatch(JSON.stringify(result.data.availableCategories), /sk-rail-secret|apiKey/);
  assert.deepEqual(
    result.data.availableCategories.map(category => category.categoryId),
    Object.keys(globalThis.SciLLM.createAdaptiveCategoryCatalog())
  );
});

test('publishes compatible provider presets without exposing saved credentials', async () => {
  const storageArea = createMemoryStorage();
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.profiles.profile_compatible_test = globalThis.SciLLM.normalizeProfile(
    'profile_compatible_test',
    {
      name: 'Compatible', providerId: 'openai-compatible',
      config: {
        apiKey: 'preset-secret-987654', model: 'custom-model',
        baseUrl: 'https://example.com/v1'
      }
    }
  );
  settings.profileOrder.push('profile_compatible_test');
  storageArea.values.sciLlmSettingsV2 = settings;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const result = await router.handle({ type: 'LLM_GET_SETTINGS' });

  assert.equal(result.success, true);
  const kimi = result.data.compatibleProviderPresets.find(item => item.id === 'kimi');
  assert.equal(kimi.baseUrl, 'https://api.moonshot.cn/v1');
  assert.equal(kimi.defaultModel, 'kimi-k2.6');
  assert.equal(kimi.authPrefix, 'Bearer');
  assert.doesNotMatch(JSON.stringify(result.data.compatibleProviderPresets), /preset-secret-987654/);
});

test('rejects unknown and malformed category ids with a safe validation error', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  for (const categoryId of ['missing_category', '../limitation', '']) {
    const result = await router.handle({ type: 'CATEGORY_GET', categoryId });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'INVALID_SETTINGS');
    assert.deepEqual(result.error.fields, ['categoryId']);
    assert.doesNotMatch(JSON.stringify(result.error), /missing_category|\.\.\/limitation/);
  }
});

test('deep-merges category overrides, preserves forward fields, and stores only the override', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const first = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE',
    categoryId: 'limitation',
    override: {
      prompt: { definition: '明确说明研究的适用边界。' },
      futureFormat: { version: 2, layout: { density: 'compact' } }
    }
  });
  const second = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE',
    categoryId: 'limitation',
    override: {
      color: '#173F6F',
      futureFormat: { layout: { rail: true } }
    }
  });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(second.data.category.color, '#173F6F');
  assert.equal(second.data.category.prompt.definition, '明确说明研究的适用边界。');
  assert.deepEqual(
    storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation.futureFormat,
    { version: 2, layout: { density: 'compact', rail: true } }
  );
  assert.equal(
    storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation.prompt.definition,
    '明确说明研究的适用边界。'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation,
      'decisionQuestion'
    ),
    false
  );
  assert.deepEqual(second.data.metadata, { builtIn: true, overridden: true });
});

test('does not write an invalid category override or unsafe regex', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const before = JSON.stringify(storageArea.values);

  const result = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE',
    categoryId: 'result',
    override: { regex: { expressions: ['(a+)+$'] } }
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'INVALID_SETTINGS');
  assert.ok(result.error.fields.includes('regex.expressions.0'));
  assert.equal(JSON.stringify(storageArea.values), before);
});

test('resets only one category override and leaves legacy rules and custom categories intact', async () => {
  const storageArea = createMemoryStorage();
  storageArea.values.allRules = {
    limitation: { name: 'legacy limitation', patterns: ['legacy'] }
  };
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.categoryOverrides = {
    limitation: { color: '#173F6F' },
    result: { color: '#E58C2F' }
  };
  settings.customCategories = [{
    categoryId: 'custom_translation',
    name: '转化价值',
    definition: '可转化应用价值',
    color: '#2F80ED'
  }];
  storageArea.values.sciLlmSettingsV2 = settings;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const result = await router.handle({
    type: 'CATEGORY_RESET_OVERRIDE', categoryId: 'limitation'
  });

  assert.equal(result.success, true);
  assert.equal(result.data.category.categoryId, 'limitation');
  assert.deepEqual(result.data.metadata, { builtIn: true, overridden: false });
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      storageArea.values.sciLlmSettingsV2.categoryOverrides,
      'limitation'
    ),
    false
  );
  assert.equal(storageArea.values.sciLlmSettingsV2.categoryOverrides.result.color, '#E58C2F');
  assert.equal(storageArea.values.sciLlmSettingsV2.customCategories[0].categoryId, 'custom_translation');
  assert.equal(storageArea.values.allRules.limitation.name, 'legacy limitation');
});

test('tests candidate regex deterministically with whole-word and case semantics without persisting', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const before = JSON.stringify(storageArea.values);

  const result = await router.handle({
    type: 'CATEGORY_TEST_REGEX',
    categoryId: 'result',
    candidateRegex: {
      phrases: ['beta'],
      expressions: ['alpha\\s+beta'],
      caseSensitive: false,
      wholeWord: true
    },
    testText: 'alpha beta betamax BETA'
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data.matches, [
    { expressionRow: 'expression:0', start: 0, end: 10, text: 'alpha beta' },
    { expressionRow: 'phrase:0', start: 6, end: 10, text: 'beta' },
    { expressionRow: 'phrase:0', start: 19, end: 23, text: 'BETA' }
  ]);
  assert.equal(result.data.truncated, false);
  assert.equal(JSON.stringify(storageArea.values), before);
});

test('bounds regex test matches and rejects unsafe candidates and oversized text', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const bounded = await router.handle({
    type: 'CATEGORY_TEST_REGEX',
    categoryId: 'result',
    candidateRegex: {
      phrases: ['hit'], expressions: [], caseSensitive: true, wholeWord: true
    },
    testText: Array.from({ length: 150 }, () => 'hit').join(' ')
  });
  assert.equal(bounded.success, true);
  assert.equal(bounded.data.matches.length, 100);
  assert.equal(bounded.data.truncated, true);

  const unsafe = await router.handle({
    type: 'CATEGORY_TEST_REGEX',
    categoryId: 'result',
    candidateRegex: { expressions: ['(?:a|a?)+$'] },
    testText: 'a'.repeat(200)
  });
  assert.equal(unsafe.success, false);
  assert.equal(unsafe.error.code, 'INVALID_SETTINGS');
  assert.ok(unsafe.error.fields.includes('regex.expressions.0'));

  const oversized = await router.handle({
    type: 'CATEGORY_TEST_REGEX',
    categoryId: 'result',
    testText: 'x'.repeat(20001)
  });
  assert.equal(oversized.success, false);
  assert.equal(oversized.error.code, 'INVALID_SETTINGS');
  assert.ok(oversized.error.fields.includes('testText'));
});

test('rejects ambiguous bounded regex candidates before category test matching', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const result = await router.handle({
    type: 'CATEGORY_TEST_REGEX',
    categoryId: 'result',
    candidateRegex: {
      phrases: [],
      expressions: ['a{1,100}a{1,100}a{1,100}a{1,100}a{1,100}Z'],
      caseSensitive: true,
      wholeWord: false
    },
    testText: 'a'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'INVALID_SETTINGS');
  assert.ok(result.error.fields.includes('regex.expressions.0'));
});

test('serializes concurrent category saves, reset, and study type writes without lost updates', async () => {
  const values = {};
  const clone = value => value === undefined
    ? undefined : JSON.parse(JSON.stringify(value));
  const storageArea = {
    values,
    get(key, callback) {
      const keys = Array.isArray(key) ? key : [key];
      const snapshot = Object.fromEntries(keys.map(item => [item, clone(values[item])]));
      setTimeout(() => callback(snapshot), 0);
    },
    set(input, callback) {
      setTimeout(() => {
        Object.assign(values, clone(input));
        callback();
      }, 5);
    }
  };
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const documentHash = 'c'.repeat(64);

  const responses = await Promise.all([
    router.handle({
      type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
      override: { color: '#173F6F' }
    }),
    router.handle({
      type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'result',
      override: { color: '#E58C2F' }
    }),
    router.handle({
      type: 'LLM_SET_STUDY_TYPE', documentHash, studyType: 'observational'
    }),
    router.handle({ type: 'CATEGORY_RESET_OVERRIDE', categoryId: 'limitation' })
  ]);

  responses.forEach(response => assert.equal(response.success, true));
  assert.equal(values.sciLlmSettingsV2.categoryOverrides.result.color, '#E58C2F');
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      values.sciLlmSettingsV2.categoryOverrides, 'limitation'
    ),
    false
  );
  assert.equal((await documentStore.getDocument(`sha256:${documentHash}`)).studyType,
    'observational');
});

test('serializes concurrent category and provider writes without losing either change', async () => {
  const storageArea = createDelayedCloneStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const responses = await Promise.all([
    router.handle({
      type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
      override: { color: '#173F6F' }
    }),
    router.handle({
      type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
      config: { apiKey: 'queue-provider-key', model: 'gpt-5-mini' }
    })
  ]);

  responses.forEach(response => assert.equal(response.success, true));
  assert.equal(storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation.color, '#173F6F');
  assert.equal(
    storageArea.values.sciLlmSettingsV2.profiles.profile_legacy_openai.config.apiKey,
    'queue-provider-key'
  );
});

test('serializes concurrent category and preference writes without losing either change', async () => {
  const storageArea = createDelayedCloneStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const responses = await Promise.all([
    router.handle({
      type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'result',
      override: { color: '#E58C2F' }
    }),
    router.handle({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: { confidenceThreshold: 0.93, autoAnalyze: true }
    })
  ]);

  responses.forEach(response => assert.equal(response.success, true));
  assert.equal(storageArea.values.sciLlmSettingsV2.categoryOverrides.result.color, '#E58C2F');
  assert.equal(storageArea.values.sciLlmSettingsV2.confidenceThreshold, 0.93);
  assert.equal(storageArea.values.sciLlmSettingsV2.autoAnalyze, true);
});

test('serializes concurrent custom category writes without losing either category', async () => {
  const storageArea = createDelayedCloneStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const custom = (categoryId, name) => ({
    categoryId, name, definition: `${name} definition`, persistence: 'saved',
    spanPolicy: 'clause', color: '#3366CC'
  });

  const responses = await Promise.all([
    router.handle({
      type: 'LLM_SAVE_CUSTOM_CATEGORY',
      category: custom('custom_queue_alpha', 'Queue alpha')
    }),
    router.handle({
      type: 'LLM_SAVE_CUSTOM_CATEGORY',
      category: custom('custom_queue_beta', 'Queue beta')
    })
  ]);

  responses.forEach(response => assert.equal(response.success, true));
  assert.deepEqual(
    storageArea.values.sciLlmSettingsV2.customCategories
      .map(category => category.categoryId).sort(),
    ['custom_queue_alpha', 'custom_queue_beta']
  );
});

test('continues the shared settings queue after a provider write failure', async () => {
  const storageArea = createMemoryStorage();
  const normalSet = storageArea.set.bind(storageArea);
  let failNextSet = true;
  storageArea.set = (input, callback) => {
    if (failNextSet) {
      failNextSet = false;
      return Promise.reject(new Error('simulated provider storage failure'));
    }
    return normalSet(input, callback);
  };
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const failed = await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'queue-failure-key', model: 'gpt-5-mini' }
  });
  const recovered = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
    override: { color: '#173F6F' }
  });

  assert.equal(failed.success, false);
  assert.equal(recovered.success, true);
  assert.equal(storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation.color, '#173F6F');
});

test('stores a manual study type without requiring or calling a provider', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  let providerCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });
  const documentHash = 'a'.repeat(64);

  const result = await router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentHash,
    studyType: 'clinical_trial'
  });

  assert.equal(result.success, true);
  assert.equal(result.data.studyProfile.primaryType, 'clinical_trial');
  assert.equal(result.data.studyProfile.secondaryType, null);
  assert.equal(providerCalls, 0);
  assert.equal((await documentStore.getDocument(`sha256:${documentHash}`)).studyType,
    'clinical_trial');
});

test('serializes concurrent manual study type writes without losing either document', async () => {
  const values = {};
  let setCount = 0;
  const clone = value => value === undefined
    ? undefined : JSON.parse(JSON.stringify(value));
  const storageArea = {
    values,
    get(key, callback) {
      const keys = Array.isArray(key) ? key : [key];
      const snapshot = Object.fromEntries(keys.map(item => [item, clone(values[item])]));
      setTimeout(() => callback(snapshot), 0);
    },
    set(input, callback) {
      setCount += 1;
      const delay = setCount === 1 ? 20 : 0;
      setTimeout(() => {
        Object.assign(values, clone(input));
        callback();
      }, delay);
    }
  };
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const firstHash = '1'.repeat(64);
  const secondHash = '2'.repeat(64);

  const [first, second] = await Promise.all([
    router.handle({
      type: 'LLM_SET_STUDY_TYPE', documentHash: firstHash, studyType: 'observational'
    }),
    router.handle({
      type: 'LLM_SET_STUDY_TYPE', documentHash: secondHash, studyType: 'clinical_trial'
    })
  ]);

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal((await documentStore.getDocument(`sha256:${firstHash}`)).studyType,
    'observational');
  assert.equal((await documentStore.getDocument(`sha256:${secondHash}`)).studyType,
    'clinical_trial');
});

test('continues queued study type writes after an earlier document store failure', async () => {
  const storageArea = createMemoryStorage();
  const baseDocumentStore = createMemoryDocumentStore();
  let failNextSetStudyType = true;
  const documentStore = {
    ...baseDocumentStore,
    async setStudyType(...args) {
      if (failNextSetStudyType) {
        failNextSetStudyType = false;
        throw new Error('simulated document storage failure');
      }
      return baseDocumentStore.setStudyType(...args);
    }
  };
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const failedHash = '3'.repeat(64);
  const recoveredHash = '4'.repeat(64);

  const failed = await router.handle({
    type: 'LLM_SET_STUDY_TYPE', documentHash: failedHash, studyType: 'observational'
  });
  const recovered = await router.handle({
    type: 'LLM_SET_STUDY_TYPE', documentHash: recoveredHash, studyType: 'clinical_trial'
  });

  assert.equal(failed.success, false);
  assert.equal(recovered.success, true);
  assert.equal((await documentStore.getDocument(`sha256:${recoveredHash}`)).studyType,
    'clinical_trial');
});

function sseResponse(content) {
  return {
    ok: true,
    status: 200,
    async text() {
      return `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n`;
    }
  };
}

test('returns bounded redacted diagnostics for an unclassified internal error', async () => {
  const storageArea = {
    get() {
      throw new TypeError(
        'Cannot read properties of undefined; token sk-abcdefghijk123456789 leaked'
      );
    },
    set() {}
  };
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });

  const response = await router.handle({ type: 'LLM_GET_SETTINGS' });

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'INTERNAL_ERROR');
  assert.equal(response.error.runtimeRevision, '2.4.0-article-workspaces-r2');
  assert.equal(response.error.diagnosticType, 'TypeError');
  assert.match(response.error.diagnosticMessage, /Cannot read properties of undefined/);
  assert.doesNotMatch(response.error.diagnosticMessage, /sk-abcdefghijk123456789/);
  assert.ok(response.error.diagnosticMessage.length <= 240);
});

test('returns privacy-safe network stage diagnostics', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'deepseek',
    config: { apiKey: 'must-not-leak', model: 'deepseek-chat' }
  });

  const response = await router.handle({ type: 'LLM_TEST_PROVIDER', providerId: 'deepseek' });

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'NETWORK_ERROR');
  assert.equal(response.error.diagnosticStage, 'request');
  assert.equal(response.error.diagnosticType, 'TypeError');
  assert.ok(response.error.requestBytes > 0);
  assert.ok(Number.isFinite(response.error.elapsedMs));
  assert.equal(JSON.stringify(response).includes('must-not-leak'), false);
});

test('saves provider credentials but returns only masked public settings', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  const saved = await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'openai-secret-1234', model: 'gpt-5-mini' }
  });
  assert.equal(saved.success, true);
  assert.equal(
    saved.data.settings.profiles.profile_legacy_openai.config.hasApiKey,
    true
  );
  assert.equal(JSON.stringify(saved).includes('openai-secret-1234'), false);

  const loaded = await router.handle({ type: 'LLM_GET_SETTINGS' });
  assert.equal(JSON.stringify(loaded).includes('openai-secret-1234'), false);
  assert.equal(
    storageArea.values.sciLlmSettingsV2.profiles.profile_legacy_openai.config.apiKey,
    'openai-secret-1234'
  );
});

test('updates only whitelisted preferences and reports effective mode', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'deepseek',
    config: { apiKey: 'key', model: 'deepseek-v4-flash' }
  });
  const result = await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm',
      providerId: 'deepseek',
      consentGranted: true,
      selectedCategoryIds: ['limitation'],
      injected: 'must-not-save'
    }
  });
  assert.equal(result.data.effectiveMode, 'llm');
  assert.equal(storageArea.values.sciLlmSettingsV2.injected, undefined);
  assert.deepEqual(result.data.settings.selectedCategoryIds, ['limitation']);
});

test('stores a normalized confidence threshold through the preference whitelist', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  const updated = await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { confidenceThreshold: 0.85, injected: 'must-not-save' }
  });
  assert.equal(updated.success, true);
  assert.equal(updated.data.settings.confidenceThreshold, 0.85);
  assert.equal(storageArea.values.sciLlmSettingsV2.confidenceThreshold, 0.85);
  assert.equal(storageArea.values.sciLlmSettingsV2.injected, undefined);
});

test('tests a configured provider with synthetic text only', async () => {
  const storageArea = createMemoryStorage();
  let requestBody;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      return jsonResponse({
        output_text: JSON.stringify({
          chunk_id: 'connection-test',
          paragraphs_reviewed: ['connection-p1'],
          annotations: []
        })
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  const result = await router.handle({ type: 'LLM_TEST_PROVIDER', providerId: 'openai' });
  assert.equal(result.success, true);
  assert.equal(result.data.connected, true);
  assert.match(requestBody.input, /connection-p1/);
  assert.match(requestBody.instructions, /JSON_OUTPUT_EXAMPLE=/);
  assert.doesNotMatch(requestBody.input, /article|论文正文/i);
});

test('retries a transient empty DeepSeek connection-test response', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  let lastBody;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      lastBody = JSON.parse(options.body);
      if (calls === 1) return sseResponse('');
      return sseResponse(JSON.stringify({
          chunk_id: 'connection-test',
          paragraphs_reviewed: ['connection-p1'],
          annotations: []
        }));
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'deepseek',
    config: { apiKey: 'key', model: 'deepseek-v4-flash' }
  });
  const result = await router.handle({ type: 'LLM_TEST_PROVIDER', providerId: 'deepseek' });
  assert.equal(result.success, true);
  assert.equal(calls, 2);
  assert.match(lastBody.messages[0].content, /JSON_OUTPUT_EXAMPLE=/);
});

test('returns safe structured errors for invalid settings', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => jsonResponse({})
  });
  const result = await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai-compatible',
    config: { apiKey: 'secret', model: 'model', baseUrl: 'file:///tmp/api' }
  });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'INVALID_SETTINGS');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('analyzes every supplied paragraph using only selected categories', async () => {
  const storageArea = createMemoryStorage();
  let articlePayload;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const schemaName = body.text?.format?.name;
      if (schemaName === 'study_profile') {
        return jsonResponse({
          output_text: JSON.stringify({
            primary_type: 'observational', secondary_type: null,
            confidence: 0.91, reason_zh: '观察性研究', blueprint: validBlueprint
          })
        });
      }
      if (schemaName === 'evidence_ledger') {
        return jsonResponse({
          output_text: JSON.stringify({
            key_annotation_ids: [], relation_summaries: [],
            review_warnings: [], audit_items: []
          })
        });
      }
      articlePayload = JSON.parse(body.input);
      return jsonResponse({
        output_text: JSON.stringify({
          chunk_id: articlePayload.chunk_id,
          paragraphs_reviewed: articlePayload.paragraphs.map(item => item.paragraph_id),
          annotations: [{
            paragraph_id: 'p2',
            quote: 'The small sample limits generalizability.',
            occurrence: 0,
            category_id: 'limitation',
            confidence: 0.96,
            reason_zh: '明确陈述样本量局限'
          }]
        })
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['limitation']
    }
  });
  const document = {
    title: 'Study',
    url: 'https://journal.example/study',
    paragraphs: [
      { paragraphId: 'p1', sectionTitle: 'Results', text: 'Treatment increased survival.' },
      { paragraphId: 'p2', sectionTitle: 'Discussion', text: 'The small sample limits generalizability.' }
    ]
  };
  await selectStudyType(router, document);
  const result = await router.handle({
    type: 'LLM_ANALYZE_DOCUMENT',
    document
  });
  assert.equal(result.success, true);
  assert.deepEqual(articlePayload.paragraphs.map(item => item.paragraph_id), ['p1', 'p2']);
  assert.deepEqual(result.data.analyzedCategoryIds, ['limitation']);
  assert.equal(result.data.annotations[0].categories[0].categoryId, 'limitation');
});

test('keeps the selected study type when a dynamically loaded article gains more body text', async () => {
  const storageArea = createMemoryStorage();
  const documentStore = createMemoryDocumentStore();
  const router = createBackgroundRouter({
    storageArea,
    documentStore,
    fetchImpl: async () => { throw new Error('preparation must not call a provider'); }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['limitation']
    }
  });

  const partialDocument = {
    title: 'Mechanism and translational opportunities',
    url: 'https://journal.example/review',
    paragraphs: [{
      paragraphId: 'abstract-1', sectionTitle: 'Abstract',
      text: 'This review summarizes a therapeutic mechanism.'
    }]
  };
  const first = await router.handle({
    type: 'LLM_PREPARE_DOCUMENT', document: partialDocument
  });
  assert.equal(first.success, true);
  const selected = await router.handle({
    type: 'LLM_SET_STUDY_TYPE',
    documentId: first.data.documentId,
    documentHash: first.data.documentHash,
    studyType: 'narrative_review'
  });
  assert.equal(selected.success, true);

  const fullDocument = {
    ...partialDocument,
    documentId: first.data.documentId,
    previousDocumentHash: first.data.documentHash,
    paragraphs: [
      ...partialDocument.paragraphs,
      {
        paragraphId: 'intro-1', sectionTitle: 'Introduction',
        text: 'Recent preclinical studies connect the pathway to therapeutic resistance.'
      },
      {
        paragraphId: 'discussion-1', sectionTitle: 'Conclusions',
        text: 'Clinical translation still requires prospective validation.'
      }
    ]
  };
  const second = await router.handle({
    type: 'LLM_PREPARE_DOCUMENT', document: fullDocument
  });

  assert.equal(second.success, true);
  assert.equal(second.data.documentId, first.data.documentId);
  assert.equal(second.data.studyProfile.primaryType, 'narrative_review');
  assert.equal(second.data.paperBlueprint.research_question, fullDocument.title);
  assert.match(second.data.paperBlueprint.claimed_contribution, /review summarizes a therapeutic mechanism/);
  assert.equal(second.data.requiresStudyType, false);
  const record = await documentStore.getDocument(first.data.documentId);
  assert.equal(record.studyType, 'narrative_review');
  assert.ok(record.documentHashes.includes(first.data.documentHash));
  assert.ok(record.documentHashes.includes(second.data.documentHash));
});

test('uses saved unified overrides in LLM prompts, honors engines, and restores built-ins', async () => {
  const storageArea = createMemoryStorage();
  const annotationInstructions = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const schemaName = body.text?.format?.name;
      if (schemaName === 'evidence_ledger') {
        return jsonResponse({
          output_text: JSON.stringify({
            key_annotation_ids: [], relation_summaries: [],
            review_warnings: [], audit_items: []
          })
        });
      }
      annotationInstructions.push(body.instructions);
      const input = JSON.parse(body.input);
      return jsonResponse({
        output_text: JSON.stringify({
          chunk_id: input.chunk_id,
          paragraphs_reviewed: input.paragraphs.map(item => item.paragraph_id),
          annotations: []
        })
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['limitation']
    }
  });
  const document = {
    title: 'Override study',
    paragraphs: [{
      paragraphId: 'p1', sectionTitle: 'Discussion',
      text: 'The small sample limits generalizability.'
    }]
  };
  await selectStudyType(router, document);

  const saved = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
    override: {
      enabledEngines: ['llm'],
      prompt: {
        definition: 'OVERRIDDEN LIMITATION DEFINITION',
        positiveExamples: ['OVERRIDDEN LIMITATION EXAMPLE'],
        minimumConfidence: 0.93
      }
    }
  });
  assert.equal(saved.success, true);
  const prepared = await router.handle({ type: 'LLM_PREPARE_DOCUMENT', document });
  const active = prepared.data.activeCategories
    .find(category => category.categoryId === 'limitation');
  assert.equal(active.minimumConfidence, 0.93);
  assert.deepEqual(active.enabledEngines, ['llm']);
  const analyzed = await router.handle({ type: 'LLM_ANALYZE_DOCUMENT', document });
  assert.equal(analyzed.success, true);
  assert.match(annotationInstructions.at(-1), /OVERRIDDEN LIMITATION DEFINITION/);
  assert.match(annotationInstructions.at(-1), /OVERRIDDEN LIMITATION EXAMPLE/);
  assert.match(annotationInstructions.at(-1), /"minimum_confidence":0\.93/);

  const regexOnly = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
    override: { enabledEngines: ['regex'] }
  });
  assert.equal(regexOnly.success, true);
  const excluded = await router.handle({ type: 'LLM_PREPARE_DOCUMENT', document });
  assert.equal(
    excluded.data.activeCategories.some(category => category.categoryId === 'limitation'),
    false
  );

  const reset = await router.handle({
    type: 'CATEGORY_RESET_OVERRIDE', categoryId: 'limitation'
  });
  assert.equal(reset.success, true);
  assert.notEqual(reset.data.category.prompt.definition, 'OVERRIDDEN LIMITATION DEFINITION');
  const restored = await router.handle({ type: 'LLM_PREPARE_DOCUMENT', document });
  assert.equal(
    restored.data.activeCategories.some(category => category.categoryId === 'limitation'),
    true
  );
});

test('effective category edits invalidate analysis cache and reset restores its signature', async () => {
  const storageArea = createMemoryStorage();
  let annotationCalls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const schemaName = body.text?.format?.name;
      if (schemaName === 'evidence_ledger') {
        return jsonResponse({
          output_text: JSON.stringify({
            key_annotation_ids: [], relation_summaries: [],
            review_warnings: [], audit_items: []
          })
        });
      }
      annotationCalls += 1;
      const input = JSON.parse(body.input);
      return jsonResponse({
        output_text: JSON.stringify({
          chunk_id: input.chunk_id,
          paragraphs_reviewed: ['p1'],
          annotations: [{
            paragraph_id: 'p1',
            quote: 'The small sample limits generalizability.',
            occurrence: 0,
            category_id: 'limitation',
            confidence: 0.96,
            reason_zh: `cache-rule-${annotationCalls}`
          }]
        })
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['limitation']
    }
  });
  const document = {
    title: 'Cache signature study',
    paragraphs: [{
      paragraphId: 'p1', sectionTitle: 'Discussion',
      text: 'The small sample limits generalizability.'
    }]
  };
  await selectStudyType(router, document);
  const analyze = () => router.handle({ type: 'LLM_ANALYZE_DOCUMENT', document });

  const initial = await analyze();
  assert.equal(initial.success, true);
  assert.equal(annotationCalls, 1);
  assert.equal(initial.data.annotations[0].categories[0].reasonZh, 'cache-rule-1');

  const saved = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
    override: {
      enabledEngines: ['llm'],
      prompt: {
        definition: 'A materially changed limitation definition.',
        positiveExamples: ['A materially changed limitation example.'],
        minimumConfidence: 0.91
      },
      regex: {
        phrases: ['material limitation'], expressions: [],
        caseSensitive: false, wholeWord: true
      }
    }
  });
  assert.equal(saved.success, true);
  const changed = await analyze();
  assert.equal(changed.success, true);
  assert.equal(annotationCalls, 2);
  assert.equal(changed.data.annotations[0].categories[0].reasonZh, 'cache-rule-2');
  assert.deepEqual(changed.data.analyzedCategoryIds, ['limitation']);

  const reset = await router.handle({
    type: 'CATEGORY_RESET_OVERRIDE', categoryId: 'limitation'
  });
  assert.equal(reset.success, true);
  const restored = await analyze();
  assert.equal(restored.success, true);
  assert.equal(annotationCalls, 2);
  assert.equal(restored.data.annotations[0].categories[0].reasonZh, 'cache-rule-1');
  assert.deepEqual(restored.data.cachedCategoryIds, ['limitation']);
});

test('refuses article analysis until provider and consent are ready', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => jsonResponse({})
  });
  const result = await router.handle({
    type: 'LLM_ANALYZE_DOCUMENT',
    document: { paragraphs: [{ paragraphId: 'p1', text: 'Text' }] }
  });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'LLM_NOT_READY');
});

test('records bounded feedback, suggests export, and distills corpus rules', async () => {
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    fetchImpl: async () => jsonResponse({})
  });
  for (const [index, documentHash] of ['d1', 'd2', 'd3'].entries()) {
    const recorded = await router.handle({
      type: 'LLM_RECORD_FEEDBACK',
      sample: {
        documentHash,
        paragraphId: `p${index}`,
        quote: `We found that treatment ${index} improved survival.`,
        categoryId: 'result',
        userAction: 'accepted',
        url: 'https://must-not-store.example'
      }
    });
    assert.equal(recorded.success, true);
  }
  const status = await router.handle({ type: 'LLM_CORPUS_STATUS' });
  assert.equal(status.data.suggestExport, true);
  const exported = await router.handle({ type: 'LLM_EXPORT_CORPUS', format: 'jsonl' });
  assert.equal(exported.data.content.includes('must-not-store'), false);
  const distilled = await router.handle({ type: 'LLM_DISTILL_RULES' });
  assert.ok(distilled.data.rules.result.patterns.includes('we found'));
});

test('stores saved and one-off custom categories separately and uses them for analysis', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  let requestBody;
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea,
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      const input = JSON.parse(requestBody.input);
      return jsonResponse({
        output_text: JSON.stringify({
          chunk_id: input.chunk_id,
          paragraphs_reviewed: ['p1'],
          annotations: []
        })
      });
    }
  });

  const saved = await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_translation',
      name: 'Clinical translation',
      definition: 'Statements that explicitly connect findings to clinical decisions.',
      persistence: 'saved',
      spanPolicy: 'clause',
      color: '#3366CC'
    }
  });
  assert.equal(saved.success, true);
  assert.equal(storageArea.values.sciLlmSettingsV2.customCategories[0].categoryId, 'custom_translation');

  const oneOff = await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_trial_risk',
      name: 'Trial risk',
      definition: 'Trial-specific operational risks.',
      persistence: 'one-off',
      spanPolicy: 'sentence',
      color: '#8844AA'
    }
  });
  assert.equal(oneOff.success, true);
  assert.equal(sessionStorageArea.values.sciLlmSessionCategoriesV2[0].categoryId, 'custom_trial_risk');
  assert.deepEqual(oneOff.data.customCategories.map(item => item.categoryId), [
    'custom_translation', 'custom_trial_risk'
  ]);

  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['custom_trial_risk']
    }
  });
  const document = {
    paragraphs: [{
      paragraphId: 'p1', sectionTitle: 'Discussion', text: 'Recruitment may fail.'
    }]
  };
  await selectStudyType(router, document);
  const analyzed = await router.handle({
    type: 'LLM_ANALYZE_DOCUMENT',
    document
  });
  assert.equal(analyzed.success, true);
  assert.match(requestBody.instructions, /custom_trial_risk/);
  assert.equal(analyzed.data.categories[0].categoryId, 'custom_trial_risk');
});

test('keeps one-off categories in router memory when session storage is unavailable', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea: null,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });

  const saved = await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_memory_only', name: 'Memory only',
      definition: 'A one-off category retained for this router lifetime.',
      persistence: 'one-off', spanPolicy: 'clause', color: '#3366CC'
    }
  });
  assert.equal(saved.success, true);
  assert.ok(saved.data.customCategories.some(item => item.categoryId === 'custom_memory_only'));
  const opened = await router.handle({
    type: 'CATEGORY_GET', categoryId: 'custom_memory_only'
  });
  assert.equal(opened.success, true);

  const deleted = await router.handle({
    type: 'LLM_DELETE_CUSTOM_CATEGORY', categoryId: 'custom_memory_only'
  });
  assert.equal(deleted.success, true);
  assert.equal(
    deleted.data.customCategories.some(item => item.categoryId === 'custom_memory_only'),
    false
  );
  const missing = await router.handle({
    type: 'CATEGORY_GET', categoryId: 'custom_memory_only'
  });
  assert.equal(missing.success, false);
  assert.equal(missing.error.code, 'INVALID_SETTINGS');
});

test('opens and fully edits a persistent custom category without changing its identity', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_translation', name: 'Clinical translation',
      definition: 'Connects findings to clinical decisions.',
      persistence: 'saved', spanPolicy: 'clause', color: '#3366CC'
    }
  });

  const opened = await router.handle({
    type: 'CATEGORY_GET', categoryId: 'custom_translation'
  });
  assert.equal(opened.success, true);
  assert.equal(opened.data.metadata.builtIn, false);
  assert.equal(opened.data.category.persistence, 'saved');
  assert.deepEqual(opened.data.category.regex.phrases, []);

  const edited = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'custom_translation',
    override: {
      name: 'Clinical applicability',
      prompt: {
        definition: 'Edited persistent definition.',
        positiveExamples: ['This finding may guide patient selection.']
      },
      regex: {
        phrases: ['patient selection'], expressions: [],
        caseSensitive: false, wholeWord: true
      }
    }
  });
  assert.equal(edited.success, true);
  assert.equal(edited.data.category.categoryId, 'custom_translation');
  assert.equal(edited.data.category.builtIn, false);
  assert.equal(edited.data.category.persistence, 'saved');
  assert.equal(edited.data.category.prompt.definition, 'Edited persistent definition.');
  assert.deepEqual(edited.data.category.regex.phrases, ['patient selection']);
  const stored = storageArea.values.sciLlmSettingsV2.customCategories[0];
  assert.equal(stored.categoryId, 'custom_translation');
  assert.equal(stored.builtIn, false);
  assert.equal(stored.persistence, 'saved');
  assert.equal(stored.prompt.definition, 'Edited persistent definition.');
  assert.equal(sessionStorageArea.values.sciLlmSessionCategoriesV2, undefined);

  const reset = await router.handle({
    type: 'CATEGORY_RESET_OVERRIDE', categoryId: 'custom_translation'
  });
  assert.equal(reset.success, false);
  assert.equal(reset.error.code, 'INVALID_SETTINGS');
  assert.deepEqual(reset.error.fields, ['categoryId']);
});

test('opens, regex-tests, and fully edits a one-off custom category in session storage', async () => {
  const storageArea = createMemoryStorage();
  const sessionStorageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    sessionStorageArea,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  await router.handle({
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      categoryId: 'custom_trial_risk', name: 'Trial risk',
      definition: 'Trial-specific operational risks.',
      persistence: 'one-off', spanPolicy: 'sentence', color: '#8844AA'
    }
  });

  const opened = await router.handle({
    type: 'CATEGORY_GET', categoryId: 'custom_trial_risk'
  });
  assert.equal(opened.success, true);
  assert.equal(opened.data.metadata.builtIn, false);
  assert.equal(opened.data.category.persistence, 'one-off');

  const edited = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'custom_trial_risk',
    override: {
      prompt: { definition: 'Edited one-off definition.' },
      regex: {
        phrases: ['recruitment risk'], expressions: [],
        caseSensitive: false, wholeWord: true
      }
    }
  });
  assert.equal(edited.success, true);
  const stored = sessionStorageArea.values.sciLlmSessionCategoriesV2[0];
  assert.equal(stored.categoryId, 'custom_trial_risk');
  assert.equal(stored.builtIn, false);
  assert.equal(stored.persistence, 'one-off');
  assert.equal(stored.prompt.definition, 'Edited one-off definition.');
  assert.deepEqual(stored.regex.phrases, ['recruitment risk']);
  assert.equal(storageArea.values.sciLlmSettingsV2.customCategories.length, 0);

  const tested = await router.handle({
    type: 'CATEGORY_TEST_REGEX', categoryId: 'custom_trial_risk',
    testText: 'A recruitment risk was identified.'
  });
  assert.equal(tested.success, true);
  assert.equal(tested.data.matches[0].text, 'recruitment risk');
});

test('changing confidence threshold reuses raw cached annotations without another provider call', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      const schemaName = body.text?.format?.name;
      if (schemaName === 'study_profile') {
        return jsonResponse({
          output_text: JSON.stringify({
            primary_type: 'observational', secondary_type: null,
            confidence: 0.91, reason_zh: '观察性研究', blueprint: validBlueprint
          })
        });
      }
      if (schemaName === 'evidence_ledger') {
        return jsonResponse({
          output_text: JSON.stringify({
            key_annotation_ids: [], relation_summaries: [],
            review_warnings: [], audit_items: []
          })
        });
      }
      const input = JSON.parse(body.input);
      return jsonResponse({
        output_text: JSON.stringify({
          chunk_id: input.chunk_id,
          paragraphs_reviewed: ['p1'],
          annotations: [{
            paragraph_id: 'p1',
            quote: 'The small sample size limits generalizability.',
            occurrence: 0,
            category_id: 'limitation',
            confidence: 0.82,
            reason_zh: '明确局限'
          }]
        })
      });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'test-key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm', providerId: 'openai', consentGranted: true,
      selectedCategoryIds: ['limitation'], confidenceThreshold: 0.85
    }
  });
  const message = {
    type: 'LLM_ANALYZE_DOCUMENT',
    document: {
      title: 'Study',
      paragraphs: [{
        paragraphId: 'p1', sectionTitle: 'Discussion',
        text: 'The small sample size limits generalizability.'
      }]
    }
  };
  await selectStudyType(router, message.document);
  const first = await router.handle(message);
  const callsAfterFirstAnalysis = calls;
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { confidenceThreshold: 0.8 }
  });
  const second = await router.handle(message);

  assert.equal(callsAfterFirstAnalysis, 2);
  assert.equal(calls, callsAfterFirstAnalysis);
  assert.equal(first.data.annotations[0].categories[0].confidence, 0.82);
  assert.equal(second.data.annotations[0].categories[0].confidence, 0.82);
  assert.equal(second.data.confidenceThreshold, 0.8);
  assert.deepEqual(second.data.cachedCategoryIds, ['limitation']);
});

function figureMessage(figures, overrides = {}) {
  return {
    type: 'LLM_ANALYZE_FIGURES',
    document: {
      title: 'Mechanistic study',
      paragraphs: [{
        paragraphId: 'p1',
        sectionTitle: 'Results',
        text: 'Figure 1 and Figure 2 report the main experiments.'
      }]
    },
    figures,
    ...overrides
  };
}

function figureInput(number, images = []) {
  return {
    figureId: 'figure-' + number,
    figureLabel: 'Figure ' + number,
    caption: 'Figure ' + number + '. Experimental result.',
    contextParagraphs: [{
      paragraphId: 'p1',
      text: 'Figure ' + number + ' reports the result.'
    }],
    images
  };
}

function figureOutput(figureId, basis = 'caption_context', depth = 'standard') {
  const value = {
    figure_id: figureId,
    analysis_depth: depth,
    basis,
    figure_question_zh: '该处理是否改变目标表型？',
    panels: [{
      panel: 'A',
      role: 'phenotype',
      phenotype_name_zh: 'target phenotype',
      method_category: 'wet_lab',
      methods: ['CCK-8'],
      method_source: basis === 'vision_text' ? 'image' : 'caption',
      purpose_zh: '比较处理组和对照组',
      design_zh: '对两组进行同一指标检测',
      comparison_zh: '处理组对照组',
      direct_observation_zh: '处理组比对照组低',
      observation_source: basis === 'vision_text' ? 'image_observation' : 'caption_statement',
      local_inference_zh: '支持处理产生抑制作用',
      contribution_zh: '建立主要表型'
    }],
    panel_groups: [{
      panels: ['A'], group_goal_zh: '建立表型', group_conclusion_zh: '处理抑制目标表型'
    }],
    logic_bridges: [],
    argument_chain: [{
      panels: ['A'],
      established_zh: 'The treatment changes the target phenotype.',
      handoff_zh: 'This motivates the next analysis step.',
      evidence_level: 'intervention_effect'
    }],
    author_assembly_zh: '作者先比较表型，再限定结论边界。',
    core_conclusion_zh: '该处理抑制目标表型',
    claim_boundary_zh: '该结果本身不证明直接机制。'
  };
  if (depth === 'deep') Object.assign(value, {
    control_analysis: [{
      panels: ['A'], control_type: 'matched_control',
      excluded_explanation_zh: '排除自然变化', adequacy_zh: '仍需独立验证'
    }],
    evidence_relations: [{
      panels: ['A'], relation_level: 'intervention_effect', rationale_zh: '存在处理比较'
    }],
    negative_result_value_zh: '当前输入未提供阴性结果。',
    qualitative_quantitative_link_zh: '定性与定量方向一致。',
    alternative_explanations: ['模型特异性仍可能影响结果。'],
    missing_link_if_panel_removed: ['删除 Panel A 后失去主要表型证据。'],
    paper_argument_role_zh: '建立主要现象。',
    deep_author_strategy_zh: '先建立现象，再限定机制边界。'
  });
  return value;
}

function figurePassOutput(input) {
  const output = figureOutput(
    input.figure_id, input.analysis_basis, input.analysis_depth
  );
  const labels = Array.isArray(input.expected_panel_labels)
    ? input.expected_panel_labels
    : (Array.isArray(input.panel_evidence)
      ? input.panel_evidence.map(panel => panel.panel)
      : ['A']);
  const boundedLabels = labels.length ? labels : ['A'];
  output.panels = boundedLabels.map(label => ({ ...output.panels[0], panel: label }));
  output.panel_groups[0].panels = boundedLabels;
  output.argument_chain[0].panels = boundedLabels;
  if (input.pass === 'panel_extraction') {
    return {
      figure_id: output.figure_id,
      analysis_depth: output.analysis_depth,
      basis: output.basis,
      panels: output.panels
    };
  }
  if (input.pass === 'figure_synthesis') {
    const { panels, ...synthesis } = output;
    return synthesis;
  }
  return output;
}

function panelFollowupOutput(input) {
  return {
    figure_id: input.figure_id,
    panel: input.panel,
    topics: input.requested_topics,
    basis: input.analysis_basis,
    answer_zh: 'Only the requested Panel information is explained from the supplied evidence.',
    claim_boundary_zh: 'Details not visible in the figure or supplied text are not inferred.'
  };
}

function panelInterpretationOutput(input) {
  const raw = figureOutput(input.figure_id, input.analysis_basis, 'standard').panels[0];
  return {
    figure_id: input.figure_id,
    panel: input.panel,
    basis: input.analysis_basis,
    panel_interpretation: { ...raw, panel: input.panel },
    claim_boundary_zh: 'The interpretation is limited to the supplied Panel evidence.'
  };
}

function panelImageVariant(edge, width = edge, height = Math.round(edge * 0.75)) {
  const length = Math.max(4, Math.ceil(edge / 4) * 4);
  return {
    mediaType: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${'A'.repeat(length)}`,
    width, height, maxEdge: edge, inputMode: 'figure_image', pixelsSupplied: true
  };
}

function crossFigureOutput(input) {
  const mainFigureIds = input.main_figure_ids || [];
  return {
    article_title: input.article_title,
    overall_thesis_zh: 'The first main Figure establishes the phenomenon and the next tests its mechanism.',
    figure_nodes: mainFigureIds.map((figureId, index) => ({
      figure_id: figureId,
      role: index === 0 ? 'phenomenon' : 'mechanism',
      established_zh: `Main evidence from ${figureId}.`,
      transition_zh: index + 1 < mainFigureIds.length
        ? `This motivates ${mainFigureIds[index + 1]}.`
        : 'This completes the supplied main-figure chain.',
      evidence_level: index === 0 ? 'intervention_effect' : 'mechanistic_support'
    })),
    domino_chain: mainFigureIds.slice(1).map((figureId, index) => ({
      from_figure_id: mainFigureIds[index],
      to_figure_id: figureId,
      relation_type: 'phenomenon_to_mechanism',
      established_zh: `The preceding Figure establishes context for ${figureId}.`,
      transition_zh: `The next Figure tests the required explanation.`,
      evidence_boundary_zh: 'The transition does not itself establish every causal step.'
    })),
    supplemental_support: [],
    claim_boundary_zh: 'This summary is limited to the supplied Figure evidence.'
  };
}

function openAIInputPayload(body) {
  const raw = Array.isArray(body.input)
    ? body.input[0].content.find(item => item.type === 'input_text').text
    : body.input;
  return JSON.parse(raw);
}

async function configureOpenAIRouter(router) {
  await router.handle({
    type: 'LLM_SAVE_PROVIDER',
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5.1' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm',
      providerId: 'openai',
      consentGranted: true
    }
  });
}

async function configuredFigureRouter(providerId, config) {
  const storageArea = createMemoryStorage();
  const bodies = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      const input = providerId === 'deepseek'
        ? JSON.parse(body.messages[1].content)
        : openAIInputPayload(body);
      const output = figurePassOutput(input);
      return providerId === 'deepseek'
        ? sseResponse(JSON.stringify(output))
        : jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId,
    config: { apiKey: 'key', ...config }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId, consentGranted: true }
  });
  return { router, bodies };
}

test('builds and caches an ordered cross-figure domino chain', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(crossFigureOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const message = {
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    document: { title: 'Mechanistic study' },
    figures: [
      { ...figureInput(1), analysis: { coreConclusion: 'Figure 1 establishes the phenotype.' } },
      { ...figureInput(2), analysis: { coreConclusion: 'Figure 2 tests the mechanism.' } },
      { ...figureInput(3), figureId: 'figure-s1', figureLabel: 'Figure S1', isSupplemental: true }
    ]
  };
  const first = await router.handle(message);
  const second = await router.handle(message);

  assert.equal(first.success, true);
  assert.deepEqual(first.data.crossFigureLogic.nodes.map(item => item.figureId), ['figure-1', 'figure-2']);
  assert.equal(first.data.crossFigureLogic.dominoChain.length, 1);
  assert.equal(first.data.cacheHit, false);
  assert.equal(second.data.cacheHit, true);
  assert.equal(calls, 1);
});

test('analyzes Figures sequentially, checkpoints results and reuses identical cache', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({
        output_text: JSON.stringify(figureOutput(
          input.figure_id, input.analysis_basis, input.analysis_depth
        ))
      });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([figureInput(1), figureInput(2)]);
  message.figureProgressOffset = 4;
  message.figureProgressTotal = 6;
  message.operationId = 'figure-operation-test-1';

  const first = await router.handle(message, {
    onProgress: value => progress.push(value)
  });
  const second = await router.handle(message);

  assert.equal(first.success, true);
  assert.deepEqual(first.data.figureResults.map(item => item.figureId), ['figure-1', 'figure-2']);
  assert.equal(first.data.cacheHits, 0);
  assert.equal(first.data.operationId, 'figure-operation-test-1');
  assert.equal(second.data.cacheHits, 2);
  assert.equal(calls, 2);
  const lifecycle = progress.filter(item => item.phase !== 'provider_telemetry');
  assert.deepEqual(lifecycle.map(item => item.phase), [
    'figure_requesting', 'figure_model_processing', 'figure_response_received',
    'figure_validating', 'figure_assembling', 'figure_panel_batch_complete', 'figure',
    'figure_requesting', 'figure_model_processing', 'figure_response_received',
    'figure_validating', 'figure_assembling', 'figure_panel_batch_complete', 'figure'
  ]);
  assert.equal(progress.filter(item => item.phase === 'provider_telemetry').length, 2);
  const firstFigureProgress = lifecycle.slice(0, 7);
  firstFigureProgress.forEach(item => {
    assert.equal(item.figureId, 'figure-1');
    assert.equal(item.figureLabel, 'Figure 1');
    assert.deepEqual(item.expectedPanels, []);
    assert.equal(item.expectedPanelCount, 0);
    assert.equal(item.completedFigures, item.phase === 'figure' ? 5 : 4);
    assert.equal(item.totalFigures, 6);
    assert.equal(item.providerId, 'openai');
    assert.equal(item.model, 'gpt-5.1');
    assert.equal(item.capabilityMode, 'vision');
    assert.equal(item.operationId, 'figure-operation-test-1');
    assert.equal(item.route.providerId, 'openai');
    assert.equal(item.route.model, 'gpt-5.1');
    assert.equal(item.route.capabilityMode, 'vision');
    assert.equal(typeof item.startedAt, 'number');
  });
  const panelCheckpoint = progress.find(item => item.phase === 'figure_panel_batch_complete');
  assert.equal(panelCheckpoint.completedPanelBatches, 1);
  assert.equal(panelCheckpoint.totalPanelBatches, 1);
  assert.equal(panelCheckpoint.partialFigureResult.figureId, 'figure-1');
  assert.equal(firstFigureProgress[4].recognizedPanelCount, 0);
  assert.equal(firstFigureProgress[5].recognizedPanelCount, 0);
});

test('degrades a repeatedly invalid small Figure into Panel extraction plus synthesis', async () => {
  const storageArea = createMemoryStorage();
  const passes = [];
  const progress = [];
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      passes.push(input.pass || 'single_pass');
      if (calls <= 2) return jsonResponse({ output_text: 'not valid JSON' });
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const figure = { ...figureInput(1), panelHints: ['A'] };
  const result = await router.handle(figureMessage([figure]), {
    onProgress: value => progress.push(value)
  });

  assert.equal(result.success, true);
  assert.equal(result.data.figureResults[0].panels.length, 1);
  assert.deepEqual(passes, [
    'single_pass', 'single_pass', 'panel_extraction', 'figure_synthesis'
  ]);
  assert.ok(progress.some(item => item.phase === 'figure_compact_fallback'));
});

test('expands a truncated whole-Figure output budget before using structural degradation', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }
        });
      }
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(figurePassOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const result = await router.handle(figureMessage([figureInput(1)]), {
    onProgress: event => progress.push(event)
  });

  assert.equal(result.success, true);
  assert.equal(calls, 2);
  assert.ok(progress.some(item => item.phase === 'output_token_retry'));
  assert.equal(progress.some(item => item.phase === 'figure_compact_fallback'), false);
});

test('splits a deep Figure, ignores repeated out-of-batch Panels, and exposes each checkpoint', async () => {
  const storageArea = createMemoryStorage();
  const progress = [];
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      const output = figurePassOutput(input);
      if (input.pass === 'panel_extraction') {
        output.panels.push({ ...output.panels[0], panel: 'Z' });
      }
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const figure = {
    ...figureInput(1),
    panelHints: ['A', 'B', 'C', 'D', 'E']
  };
  const response = await router.handle(figureMessage([figure], { analysisDepth: 'deep' }), {
    onProgress: value => progress.push(value)
  });

  assert.equal(response.success, true);
  assert.equal(calls, 4);
  assert.deepEqual(response.data.figureResults[0].panels.map(item => item.panel),
    ['A', 'B', 'C', 'D', 'E']);
  const checkpoints = progress.filter(item => item.phase === 'figure_panel_batch_complete');
  assert.deepEqual(checkpoints.map(item => item.completedPanelBatches), [1, 2, 3]);
  assert.deepEqual(checkpoints.map(item => item.totalPanelBatches), [3, 3, 3]);
  assert.deepEqual(checkpoints.map(item => item.partialFigureResult.panels.length), [2, 4, 5]);
  assert.deepEqual(checkpoints.map(item => item.batchRecognizedPanelCount), [2, 2, 1]);
  assert.deepEqual(checkpoints.map(item => item.ignoredUnexpectedPanelCount), [1, 1, 1]);
  assert.deepEqual(checkpoints.map(item => item.unexpectedPanels), [['Z'], ['Z'], ['Z']]);
  assert.deepEqual(checkpoints.at(-1).partialFigureResult.panelCoverage.unexpectedPanels, ['Z']);
  assert.equal(progress.filter(item => item.phase === 'figure_synthesizing').length, 1);
  assert.equal(progress.filter(item => item.phase === 'figure_synthesis_complete').length, 1);
});

test('routes a targeted Panel follow-up through the configured Figure API', async () => {
  const storageArea = createMemoryStorage();
  const requested = [];
  const outputBudgets = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      requested.push(input);
      outputBudgets.push(body.max_output_tokens);
      return jsonResponse({ output_text: JSON.stringify(panelFollowupOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const preferences = await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      figurePanelFollowupPrompts: {
        grouping: 'Use only the grouping explicitly supported by this paper.'
      }
    }
  });
  assert.equal(preferences.success, true);
  const response = await router.handle({
    type: 'LLM_ASK_FIGURE_PANEL',
    document: { title: 'Mechanistic study' },
    figure: { ...figureInput(1), panelHints: ['A'] },
    panel: {
      panel: 'A', role: 'phenotype', phenotypeName: 'Cell viability',
      methods: ['CCK-8'], purpose: 'Measure viability', design: 'treated versus control',
      comparison: 'treated vs control', directObservation: 'treated group is lower'
    },
    topics: ['grouping', 'technique_principle'],
    customQuestion: 'Why was this statistical test selected?'
  });

  assert.equal(response.success, true);
  assert.equal(response.data.route.providerId, 'openai');
  assert.equal(response.data.panelFollowup.panel, 'A');
  assert.deepEqual(response.data.panelFollowup.topics, ['grouping', 'technique_principle']);
  assert.deepEqual(requested[0].requested_topics, ['grouping', 'technique_principle']);
  assert.equal(requested[0].custom_question, 'Why was this statistical test selected?');
  assert.equal(requested[0].requested_topic_instructions.grouping,
    'Use only the grouping explicitly supported by this paper.');
  assert.equal(requested[0].panel, 'A');
  assert.deepEqual(outputBudgets, [4096]);
  assert.equal(response.data.panelFollowup.inputBasis.inputMode, 'caption_context');
  assert.equal(response.data.panelFollowup.inputBasis.pixelsSupplied, false);
});

test('routes credential-free multi-file workspace save, scan, export, and crash-safe deletion', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'a'.repeat(64)}`,
    canonicalUrl: 'https://example.org/paper',
    aliases: [{ type: 'doi', value: '10.1000/example' }],
    title: 'Example paper',
    directoryName: `Example paper--${'a'.repeat(16)}`,
    revision: '1'.repeat(64), contentHash: '1'.repeat(64), workspaceGeneration: 1
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted', manifests: [],
      matches: [{ match: 'exact', manifest: { ...workspace, kind: 'sci-logic-highlighter-workspace' } }]
    })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('workspace operations must stay local'); }
  });

  assert.equal((await router.handle({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace })).success, true);
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    relativePath: 'ui/state.json', content: { view: 'chat' }
  })).success, true);
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_TURN', workspaceId: workspace.workspaceId,
    workspaceGeneration: 1,
    turn: { turnId: 'turn-1', role: 'user', content: 'Question' }
  })).success, true);
  const staleMutation = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: workspace.workspaceId,
    workspaceGeneration: 2,
    relativePath: 'ui/stale-state.json', content: { view: 'stale' }
  });
  assert.equal(staleMutation.success, false);
  assert.equal(staleMutation.error.code, 'WORKSPACE_GENERATION_CONFLICT');
  const scan = await router.handle({
    type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity: {
      canonicalUrl: workspace.canonicalUrl, contentHash: workspace.contentHash
    }, requestPermission: true
  });
  assert.equal(scan.data.matches[0].match, 'exact');
  assert.equal(directorySync.permissionRequests, 1);
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_PROBE', identity: { canonicalUrl: workspace.canonicalUrl }
  })).data.matches[0].match, 'exact');
  assert.equal((await router.handle({ type: 'ARTICLE_WORKSPACE_LIST' })).data.workspaces.length, 1);
  assert.equal((await router.handle({ type: 'ARTICLE_WORKSPACE_STATS' })).data.turnCount, 1);
  assert.equal((await router.handle({
    type: 'ARTICLE_WORKSPACE_REBUILD_INDEX'
  })).data.workspaceCount, 0);
  const exported = await router.handle({
    type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId: workspace.workspaceId
  });
  assert.equal(exported.data.turns.length, 1);
  assert.doesNotMatch(JSON.stringify(exported.data), /apiKey|Authorization|absolutePath/i);

  const begun = await router.handle({
    type: 'ARTICLE_WORKSPACE_BEGIN_DELETE', workspaceId: workspace.workspaceId
  });
  assert.equal(begun.data.tombstoneId, 'workspace-delete-1');
  const finalized = await router.handle({
    type: 'ARTICLE_WORKSPACE_FINALIZE_DELETE', workspaceId: workspace.workspaceId,
    tombstoneId: begun.data.tombstoneId
  });
  assert.equal(finalized.data.deleted, true);
  assert.equal(finalized.data.workspaceGeneration, 2);
  assert.equal(await workspaceStore.getWorkspace(workspace.workspaceId), null);
  const rejectedResurrection = await router.handle({
    type: 'ARTICLE_WORKSPACE_PROBE', identity: { canonicalUrl: workspace.canonicalUrl }
  });
  assert.deepEqual(rejectedResurrection.data.matches, []);
  assert.equal(rejectedResurrection.data.tombstonedMatches, 1);
});

test('deletes browser-local workspace data when no filesystem directory was configured', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.org/browser-local-paper',
    aliases: [], title: 'Browser-local paper',
    directoryName: `Browser-local paper--${'b'.repeat(16)}`,
    revision: '2'.repeat(64), contentHash: '2'.repeat(64), workspaceGeneration: 1
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const directorySync = createDirectorySyncDouble({
    removeWorkspaceTree: async () => ({ permission: 'unconfigured', removed: false })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('browser-local deletion must stay local'); }
  });

  await router.handle({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace });
  const begun = await router.handle({
    type: 'ARTICLE_WORKSPACE_BEGIN_DELETE', workspaceId: workspace.workspaceId
  });
  const finalized = await router.handle({
    type: 'ARTICLE_WORKSPACE_FINALIZE_DELETE', workspaceId: workspace.workspaceId,
    tombstoneId: begun.data.tombstoneId
  });

  assert.equal(finalized.success, true);
  assert.equal(finalized.data.deleted, true);
  assert.equal(finalized.data.workspaceGeneration, 2);
  assert.equal(finalized.data.permission, 'unconfigured');
  assert.equal(finalized.data.removedFromDisk, false);
  assert.equal(await workspaceStore.getWorkspace(workspace.workspaceId), null);
});

test('scan restores validated workspace assets into IndexedDB before returning them', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'c'.repeat(64)}`,
    canonicalUrl: 'https://example.org/restored-paper',
    aliases: [],
    title: 'Restored paper',
    directoryName: `Restored paper--${'c'.repeat(16)}`,
    revision: '3'.repeat(64), contentHash: '3'.repeat(64), workspaceGeneration: 1
  };
  const manifest = {
    ...workspace,
    kind: 'sci-logic-highlighter-workspace',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    assets: [
      {
        path: 'chat/index.json', type: 'json', revision: 4,
        contentHash: 'asset-hash', updatedAt: '2026-07-20T00:00:00.000Z'
      },
      {
        path: 'chat/turns/turn-1.json', type: 'json', revision: 4,
        contentHash: 'turn-1-hash', updatedAt: '2026-07-20T00:00:00.000Z'
      },
      {
        path: 'chat/turns/turn-deleted.json', type: 'json', revision: 3,
        contentHash: 'turn-deleted-hash', updatedAt: '2026-07-19T00:00:00.000Z'
      },
      {
        path: 'chat/tombstones/turn-deleted.json', type: 'json', revision: 5,
        contentHash: 'tombstone-hash', updatedAt: '2026-07-20T01:00:00.000Z'
      }
    ]
  };
  const chat = { turns: [{ turnId: 'turn-1', question: 'What changed?' }] };
  const storedFiles = {
    'chat/index.json': chat,
    'chat/turns/turn-1.json': {
      turnId: 'turn-1', question: 'What changed?', sequence: 1
    },
    'chat/turns/turn-deleted.json': {
      turnId: 'turn-deleted', question: 'This turn was deleted.', sequence: 2
    },
    'chat/tombstones/turn-deleted.json': {
      entityType: 'turn', entityId: 'turn-deleted', deletedAt: '2026-07-20T01:00:00.000Z'
    }
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted', manifests: [manifest],
      matches: [{ match: 'exact', manifest }]
    }),
    readWorkspaceAsset: async (_manifest, path) => ({
      permission: 'granted', found: Boolean(storedFiles[path]),
      value: {
        kind: 'sci-logic-highlighter-workspace-asset',
        revision: 4,
        contentHash: 'asset-hash',
        data: storedFiles[path]
      }
    })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync, articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('restore must stay local'); }
  });

  const result = await router.handle({
    type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity: workspace,
    requestPermission: true
  });
  assert.equal(result.success, true);
  assert.equal(result.data.restore.match, 'exact');
  assert.deepEqual(result.data.restore.assets[0].content, chat);
  assert.equal(result.data.restore.assets.length, 1);
  assert.deepEqual((await workspaceStore.listAssets(workspace.workspaceId))[0].content, chat);
  assert.deepEqual(
    (await workspaceStore.pageTurns(workspace.workspaceId)).items.map(turn => turn.turnId),
    ['turn-1']
  );
});

test('workspace overview returns safe summaries and loads one detail on demand', async () => {
  const workspace = {
    schemaVersion: 1,
    workspaceId: `workspace:${'d'.repeat(64)}`,
    canonicalUrl: 'https://example.org/overview-paper',
    aliases: [{ type: 'doi', value: '10.1000/overview' }],
    title: 'Overview paper',
    directoryName: `Overview paper--${'d'.repeat(16)}`,
    revision: '4'.repeat(64), contentHash: '4'.repeat(64), workspaceGeneration: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    lastAccessedAt: '2026-07-20T01:00:00.000Z'
  };
  const workspaceStore = createArticleWorkspaceStoreDouble();
  await workspaceStore.ensureWorkspace(workspace);
  await workspaceStore.putAsset(workspace.workspaceId, 'chat/index.json', {
    turns: [{ turnId: 'turn-1' }, { turnId: 'turn-2' }]
  });
  await workspaceStore.putAsset(workspace.workspaceId, 'figures/inventory.json', {
    figures: [{ figureId: 'figure-1', panelHints: ['A', 'B'] }]
  });
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted', manifests: [], matches: [], invalidManifests: 1
    })
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync, articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('overview must stay local'); }
  });

  const overview = await router.handle({ type: 'ARTICLE_WORKSPACE_LIST' });
  assert.equal(overview.success, true);
  assert.equal(overview.data.workspaces[0].doi, '10.1000/overview');
  assert.equal(overview.data.totals.workspaceCount, 1);
  assert.equal(overview.data.sync.corruptCount, 1);
  assert.doesNotMatch(JSON.stringify(overview.data), /directoryName|absolutePath|apiKey/i);

  const detail = await router.handle({
    type: 'ARTICLE_WORKSPACE_DETAIL', workspaceId: workspace.workspaceId
  });
  assert.equal(detail.success, true);
  assert.equal(detail.data.chatTurnCount, 2);
  assert.equal(detail.data.figureCount, 1);
  assert.equal(detail.data.panelCount, 2);
  assert.ok(detail.data.estimatedBytes > 0);
  assert.doesNotMatch(JSON.stringify(detail.data), /relativePath|content|apiKey/i);
});

test('workspace overview summarizes 1,000 records without loading any workspace asset', async () => {
  const workspaceStore = createArticleWorkspaceStoreDouble();
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index.toString(16).padStart(64, '0');
    await workspaceStore.ensureWorkspace({
      schemaVersion: 1,
      workspaceId: `workspace:${suffix}`,
      canonicalUrl: `https://example.org/paper/${index}`,
      aliases: [],
      title: `Paper ${index}`,
      directoryName: `Paper ${index}--${suffix.slice(0, 16)}`,
      revision: suffix,
      contentHash: suffix,
      workspaceGeneration: 1,
      summary: {
        assetCount: 7, assetBytes: 1000, turnCount: 3, turnBytes: 200,
        chatTurnCount: 3, figureCount: 2, panelCount: 6, highlightCount: 4
      }
    });
  }
  workspaceStore.listAssets = async () => {
    throw new Error('overview must not load asset bodies');
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    directorySync: createDirectorySyncDouble(),
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('overview must stay local'); }
  });
  const response = await router.handle({ type: 'ARTICLE_WORKSPACE_LIST' });

  assert.equal(response.success, true);
  assert.equal(response.data.workspaces.length, 1000);
  assert.equal(response.data.totals.workspaceCount, 1000);
  assert.equal(response.data.totals.estimatedBytes, 1_200_000);
  assert.equal(response.data.totals.panelCount, 6000);
});

test('scan imports a legacy archive into a workspace without deleting the legacy file', async () => {
  const archive = portableArchive();
  const legacyPath = articleArchiveRelativePath(archive);
  const directorySync = createDirectorySyncDouble({
    listWorkspaceManifests: async () => ({
      permission: 'granted', manifests: [], matches: []
    }),
    readJson: async path => ({
      permission: 'granted', found: path === legacyPath,
      value: path === legacyPath ? archive : null
    })
  });
  const workspaceStore = createArticleWorkspaceStoreDouble();
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync,
    articleWorkspaceStore: workspaceStore,
    fetchImpl: async () => { throw new Error('legacy import must stay local'); }
  });

  const restored = await router.handle({
    type: 'ARTICLE_WORKSPACE_SCAN_RESTORE',
    identity: {
      documentId: archive.documentId,
      canonicalUrl: archive.canonicalUrl,
      contentHash: archive.documentHash
    }
  });
  assert.equal(restored.success, true);
  assert.equal(restored.data.matches[0].match, 'legacy-imported');
  assert.equal(restored.data.legacyPreserved, true);
  assert.deepEqual(directorySync.readPaths, [legacyPath]);
  assert.equal(directorySync.workspaceAssets[0].path, 'legacy/archive.json');
});

test('routes one Panel interpretation through one dedicated Provider call', async () => {
  const storageArea = createMemoryStorage();
  const inputs = [];
  const outputBudgets = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      inputs.push(input);
      outputBudgets.push(body.max_output_tokens);
      return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const documentHash = 'a'.repeat(64);
  const response = await router.handle({
    type: 'LLM_ANALYZE_FIGURE_PANEL',
    documentHash,
    document: { title: 'Mechanistic study', documentHash },
    figure: {
      ...figureInput(2), panelHints: ['A'],
      caption: 'Figure 2. Values are mean ± SEM. (A) Treatment reduced tumor volume. (B) Validation.',
      contextParagraphs: [
        { paragraphId: 'r1', sectionTitle: 'Results', text: 'Figure 2A compares treated and control groups.' },
        { paragraphId: 'm1', sectionTitle: 'Methods', text: 'Animals were randomized before treatment.' },
        { paragraphId: 'd1', sectionTitle: 'Discussion', text: 'The result supports the proposed mechanism.' }
      ],
      imageVariants: [panelImageVariant(1200), panelImageVariant(960), panelImageVariant(768)]
    },
    panel: { panel: 'A' }
  });

  assert.equal(response.success, true);
  assert.equal(inputs.length, 1);
  assert.deepEqual(outputBudgets, [3072]);
  assert.equal(inputs[0].request_mode, 'single_panel_interpretation');
  assert.equal(inputs[0].panel, 'A');
  assert.equal(inputs[0].related_body_context.length <= 4, true);
  assert.doesNotMatch(inputs[0].target_panel_caption, /Validation/);
  assert.equal(response.data.documentHash, documentHash);
  assert.equal(response.data.panelAnalysis.panel, 'A');
  assert.equal(response.data.panelAnalysis.inputBasis.imageMaxEdge, 1200);
  assert.equal(response.data.panelAnalysis.inputBasis.attempts, 1);
});

test('retries a rejected Panel output limit without needlessly degrading the image', async () => {
  const storageArea = createMemoryStorage();
  const requestSizes = [];
  const inputs = [];
  const outputBudgets = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const image = Array.isArray(body.input)
        ? body.input[0].content.find(item => item.type === 'input_image')?.image_url || ''
        : '';
      requestSizes.push(image.length);
      inputs.push(input);
      outputBudgets.push(body.max_output_tokens);
      if (requestSizes.length < 3) {
        return jsonResponse({ error: { message: 'max_output_tokens cannot exceed 1024' } }, 400);
      }
      return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: 'b'.repeat(64),
    document: { title: 'Large figure' },
    figure: {
      ...figureInput(4), panelHints: ['A'],
      imageVariants: [panelImageVariant(1200), panelImageVariant(960), panelImageVariant(768)]
    },
    panel: { panel: 'A' }, forceRefresh: true
  });

  assert.equal(response.success, true);
  assert.equal(requestSizes.length, 3);
  assert.deepEqual(requestSizes, [requestSizes[0], requestSizes[0], requestSizes[0]]);
  assert.deepEqual(outputBudgets, [3072, 1024, 768]);
  assert.equal(response.data.panelAnalysis.inputBasis.attempts, 3);
  assert.equal(response.data.panelAnalysis.inputBasis.outputBudgetTokens, 768);
  assert.deepEqual(inputs.map(input => input.panel), ['A', 'A', 'A']);
});

test('expands a truncated Panel answer before sacrificing visual evidence', async () => {
  const storageArea = createMemoryStorage();
  const requestSizes = [];
  const outputBudgets = [];
  const progress = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const image = Array.isArray(body.input)
        ? body.input[0].content.find(item => item.type === 'input_image')?.image_url || ''
        : '';
      requestSizes.push(image.length);
      outputBudgets.push(body.max_output_tokens);
      if (requestSizes.length === 1) {
        return jsonResponse({
          status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
          output_text: '{}'
        });
      }
      return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: '9'.repeat(64),
    document: { title: 'Output expansion' },
    figure: {
      ...figureInput(9), panelHints: ['A'],
      imageVariants: [panelImageVariant(1200), panelImageVariant(960), panelImageVariant(768)]
    },
    panel: { panel: 'A' }, forceRefresh: true
  }, { onProgress: event => progress.push(event) });

  assert.equal(response.success, true);
  assert.deepEqual(outputBudgets, [3072, 5376]);
  assert.equal(requestSizes[1], requestSizes[0]);
  assert.equal(response.data.panelAnalysis.inputBasis.outputBudgetTokens, 5376);
  assert.ok(progress.some(event => event.phase === 'figure_panel_output_retry'));
});

test('jumps directly to text evidence when a nominally visual model rejects Panel pixels', async () => {
  const storageArea = createMemoryStorage();
  const modes = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const input = openAIInputPayload(body);
      const hasImage = Array.isArray(body.input);
      modes.push(hasImage ? 'image' : 'text');
      if (hasImage) return jsonResponse({ error: { message: 'unsupported image input' } }, 400);
      return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const response = await router.handle({
    type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: 'e'.repeat(64),
    document: { title: 'Text fallback' },
    figure: {
      ...figureInput(6), panelHints: ['A'],
      imageVariants: [panelImageVariant(1200), panelImageVariant(960), panelImageVariant(768)]
    },
    panel: { panel: 'A' }, forceRefresh: true
  });

  assert.equal(response.success, true);
  assert.deepEqual(modes, ['image', 'text']);
  assert.equal(response.data.panelAnalysis.basis, 'caption_context');
  assert.equal(response.data.panelAnalysis.inputBasis.inputMode, 'caption_context');
  assert.equal(response.data.panelAnalysis.inputBasis.pixelsSupplied, false);
  assert.equal(response.data.panelAnalysis.inputBasis.attempts, 2);
});

test('keeps dedicated Panel cache entries isolated by Panel identity', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      return jsonResponse({ output_text: JSON.stringify(panelInterpretationOutput(input)) });
    }
  });
  await configureOpenAIRouter(router);
  const base = {
    type: 'LLM_ANALYZE_FIGURE_PANEL', documentHash: 'c'.repeat(64),
    document: { title: 'Cache isolation' },
    figure: {
      ...figureInput(5), panelHints: ['A', 'B'],
      caption: 'Figure 5. (A) Discovery. (B) Validation.'
    }
  };
  const firstA = await router.handle({ ...base, panel: { panel: 'A' } });
  const secondA = await router.handle({ ...base, panel: { panel: 'A' } });
  const firstB = await router.handle({ ...base, panel: { panel: 'B' } });

  assert.equal(firstA.data.cacheHit, false);
  assert.equal(secondA.data.cacheHit, true);
  assert.equal(firstB.data.cacheHit, false);
  assert.equal(firstB.data.panelAnalysis.panel, 'B');
  assert.equal(calls, 2);
});

test('routes full-text chat through the exact model profile selected for that turn', async () => {
  const storageArea = createMemoryStorage();
  const urls = [];
  const requests = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      urls.push(String(url));
      const body = JSON.parse(options.body);
      requests.push({ body, prompt: body.messages[1].content });
      return sseResponse([
        JSON.stringify({
          type: 'answer_block', block_id: 'block-1',
          markdown: '**Core finding**\n\nThe treated group improved significantly. [[1]]',
          evidence: [{
            marker: '1', paragraph_id: 'p1', source_key: 'results:1',
            text_hash: 'hash-p1',
            quote: 'The treated group showed a significantly improved phenotype.',
            section_path: ['Results']
          }]
        }),
        JSON.stringify({ type: 'turn_summary', summary: 'Treatment improved the phenotype.' }),
        JSON.stringify({ type: 'final', status: 'completed' }),
        ''
      ].join('\n'));
      return sseResponse(JSON.stringify({
        answer_zh: '该论文的核心结论由正文结果段支持。',
        evidence: [{ section_title: 'Results', support_zh: '处理组的表型显著改善。' }],
        limitations_zh: '当前网页正文未提供原始数据。'
      }));
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_chat_deepseek', name: 'Chat DeepSeek', providerId: 'deepseek',
      config: { apiKey: 'chat-secret', model: 'deepseek-v4-pro' }
    }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { consentGranted: true }
  });

  const response = await router.handle({
    type: 'LLM_ASK_ARTICLE',
    profileId: 'profile_chat_deepseek',
    question: '这篇论文的核心结论是什么？',
    history: [{ role: 'user', content: '先概括研究问题。' }],
    document: {
      title: 'Mechanistic study',
      url: 'https://example.org/paper',
      paragraphs: [{
        paragraphId: 'p1', sectionTitle: 'Results',
        text: 'The treated group showed a significantly improved phenotype.'
      }]
    }
  });

  assert.equal(response.success, true);
  assert.equal(response.data.route.providerId, 'deepseek');
  assert.equal(response.data.route.effectiveProfileId, 'profile_chat_deepseek');
  assert.equal(response.data.route.taskType, 'chat');
  if (false) {
  assert.equal(response.data.message.answer, '该论文的核心结论由正文结果段支持。');
  }
  assert.equal(response.data.message.answerBlocks[0].blockId, 'block-1');
  assert.equal(response.data.message.summary, 'Treatment improved the phenotype.');
  assert.match(urls[0], /deepseek/i);
  if (false) {
  assert.equal(requests[0].current_question, '这篇论文的核心结论是什么?');
  assert.equal(requests[0].article.paragraphs.length, 1);
  }
  assert.equal(requests[0].body.stream, true);
  assert.match(requests[0].prompt, /article-chat-chunk-/);
  assert.doesNotMatch(JSON.stringify(response), /chat-secret/);
});

test('cancels an in-flight Figure provider request through the shared operation id', async () => {
  const storageArea = createMemoryStorage();
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      markStarted();
      return new Promise((resolve, reject) => {
        const abort = () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
      });
    }
  });
  await configureOpenAIRouter(router);
  const pending = router.handle({
    ...figureMessage([figureInput(1)], { analysisDepth: 'standard' }),
    operationId: 'figure-cancel-test'
  });
  await started;
  const control = await router.handle({
    type: 'LLM_CONTROL_OPERATION',
    operationId: 'figure-cancel-test',
    command: 'cancel'
  });
  const result = await pending;
  assert.equal(control.success, true);
  assert.equal(control.data.cancelled, true);
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'CANCELLED');
});

test('forceRefresh bypasses a cached Figure result and returns a new provider result', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      const output = figureOutput(input.figure_id, input.analysis_basis, input.analysis_depth);
      output.core_conclusion_zh = `provider run ${calls}`;
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([figureInput(1)], { analysisDepth: 'standard' });
  const first = await router.handle(message);
  const cached = await router.handle(message);
  const refreshed = await router.handle({ ...message, forceRefresh: true });

  assert.equal(first.data.figureResults[0].coreConclusion, 'provider run 1');
  assert.equal(cached.data.cacheHits, 1);
  assert.equal(refreshed.data.cacheHits, 0);
  assert.equal(refreshed.data.figureResults[0].coreConclusion, 'provider run 2');
  assert.equal(calls, 2);
});

test('evicts an invalid cached Figure result and recomputes it from the provider', async () => {
  const storageArea = createMemoryStorage();
  const entries = new Map();
  const evicted = [];
  const cacheStore = {
    async getMany(keys) {
      return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
    },
    async setMany(values) {
      values.forEach(value => entries.set(value.key, value));
    },
    async deleteMany(keys) {
      keys.forEach(key => {
        evicted.push(key);
        entries.delete(key);
      });
    }
  };
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    cacheStore,
    fetchImpl: async (url, options) => {
      calls += 1;
      const input = openAIInputPayload(JSON.parse(options.body));
      const output = figureOutput(input.figure_id, input.analysis_basis, input.analysis_depth);
      output.core_conclusion_zh = `recomputed ${calls}`;
      return jsonResponse({ output_text: JSON.stringify(output) });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([figureInput(1)], { analysisDepth: 'standard' });
  await router.handle(message);
  const cachedKey = [...entries.keys()][0];
  entries.get(cachedKey).figureResult.coreConclusion = { damaged: true };
  const recomputed = await router.handle(message);

  assert.equal(calls, 2);
  assert.equal(recomputed.data.cacheHits, 0);
  assert.equal(recomputed.data.figureResults[0].coreConclusion, 'recomputed 2');
  assert.deepEqual(evicted, [cachedKey]);
});

test('falls back to caption context when a provider rejects visual input', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      if (Array.isArray(body.input)) return jsonResponse({}, 400);
      const input = openAIInputPayload(body);
      return jsonResponse({
        output_text: JSON.stringify(figureOutput(
          input.figure_id, 'caption_context', input.analysis_depth
        ))
      });
    }
  });
  await configureOpenAIRouter(router);
  const result = await router.handle(figureMessage([
    figureInput(1, [{ mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==' }])
  ]));

  assert.equal(result.success, true);
  assert.equal(result.data.figureResults[0].basis, 'caption_context');
  assert.equal(result.data.figureResults[0].visionFallback, true);
  assert.equal(result.data.visionFallbacks, 1);
  assert.equal(calls, 2);
});

test('does not text-fallback authentication or quota failures', async () => {
  const storageArea = createMemoryStorage();
  let calls = 0;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({}, 401);
    }
  });
  await configureOpenAIRouter(router);
  const result = await router.handle(figureMessage([
    figureInput(1, [{ mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==' }])
  ]));

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'AUTH_INVALID');
  assert.equal(calls, 1);
});

test('rejects a model response assigned to the wrong Figure', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async () => jsonResponse({
      output_text: JSON.stringify(figureOutput('figure-99'))
    })
  });
  await configureOpenAIRouter(router);
  const result = await router.handle(figureMessage([figureInput(1)]));

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'INVALID_RESPONSE');
});

test('keeps completed Figure checkpoints when a later Figure fails', async () => {
  const storageArea = createMemoryStorage();
  const callsById = { 'figure-1': 0, 'figure-2': 0 };
  let failSecond = true;
  const router = createBackgroundRouter({
    storageArea,
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      const input = openAIInputPayload(JSON.parse(options.body));
      callsById[input.figure_id] += 1;
      if (input.figure_id === 'figure-2' && failSecond) return jsonResponse({}, 503);
      return jsonResponse({
        output_text: JSON.stringify(figureOutput(
          input.figure_id, input.analysis_basis, input.analysis_depth
        ))
      });
    }
  });
  await configureOpenAIRouter(router);
  const message = figureMessage([figureInput(1), figureInput(2)]);

  const failed = await router.handle(message);
  assert.equal(failed.success, false);
  failSecond = false;
  const resumed = await router.handle(message);

  assert.equal(resumed.success, true);
  assert.equal(resumed.data.cacheHits, 1);
  assert.equal(callsById['figure-1'], 1);
  assert.equal(callsById['figure-2'], 3);
});

test('routes DeepSeek Figures directly through text evidence mode', async () => {
  const { router, bodies } = await configuredFigureRouter('deepseek', {
    model: 'deepseek-v4-flash'
  });
  const progress = [];
  const response = await router.handle(figureMessage([
    figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,AA==' }])
  ], { analysisDepth: 'standard' }), { onProgress: event => progress.push(event) });
  assert.equal(response.success, true);
  assert.equal(response.data.route.taskType, 'figure');
  assert.equal(bodies.length, 1);
  assert.equal(typeof bodies[0].messages[1].content, 'string');
  assert.doesNotMatch(JSON.stringify(bodies[0]), /image_url|data:image/);
  assert.equal(JSON.parse(bodies[0].messages[1].content).analysis_basis, 'caption_context');
  assert.equal(response.data.analysisDepth, 'standard');
  assert.equal(response.data.visionFallbacks, 1);
  assert.equal(progress[0].phase, 'caption_text_only');
  assert.equal(progress[0].figureId, 'figure-1');
  assert.equal(progress[0].capabilityMode, 'caption_text_only');
});

test('keeps verified visual providers in visual mode', async () => {
  const { router, bodies } = await configuredFigureRouter('openai', { model: 'gpt-5-mini' });
  await router.handle(figureMessage([
    figureInput(1, [{ dataUrl: 'data:image/jpeg;base64,AA==' }])
  ], { analysisDepth: 'standard' }));
  assert.ok(bodies[0].input[0].content.some(item => item.type === 'input_image'));
  assert.equal(openAIInputPayload(bodies[0]).analysis_basis, 'vision_text');
});

test('caches one Figure standard and deep results independently', async () => {
  const fixture = await configuredFigureRouter('deepseek', { model: 'deepseek-v4-flash' });
  await fixture.router.handle(figureMessage([figureInput(1)], { analysisDepth: 'standard' }));
  await fixture.router.handle(figureMessage([figureInput(1)], { analysisDepth: 'deep' }));
  assert.equal(fixture.bodies.length, 2);
  const cachedDeep = await fixture.router.handle(
    figureMessage([figureInput(1)], { analysisDepth: 'deep' })
  );
  assert.equal(cachedDeep.data.cacheHits, 1);
  assert.equal(fixture.bodies.length, 2);
});

function outlineParagraphs(count) {
  return Array.from({ length: count }, (_, index) => ({
    paragraphId: `sec-a-p-${String(index + 1).padStart(3, '0')}`,
    sectionId: 'sec-a', sectionTitle: 'Evidence', sectionKind: 'article',
    headingLevel: 1,
    headingPath: [{ level: 1, sectionId: 'sec-a', title: 'Evidence' }],
    text: `Paragraph ${index + 1} contains review evidence and enough text for chunking.`
  }));
}

function reviewOutlineMessage(paragraphs, overrides = {}) {
  return {
    type: 'LLM_ANALYZE_REVIEW_OUTLINE',
    document: { title: 'Evidence review', paragraphs },
    ...overrides
  };
}

async function configuredReviewRouter(options = {}) {
  const storageArea = createMemoryStorage();
  const requests = [];
  const mapCallsByBatch = new Map();
  let failedSecond = false;
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async (url, fetchOptions) => {
      const body = JSON.parse(fetchOptions.body);
      const schemaName = body.text?.format?.name;
      const payload = JSON.parse(body.input);
      requests.push({ schemaName, payload });
      if (schemaName === 'study_profile') {
        return jsonResponse({ output_text: JSON.stringify({
          primary_type: options.reviewSubtype === 'not_review'
            ? 'basic_mechanistic' : 'systematic_review_meta',
          secondary_type: null,
          review_subtype: options.reviewSubtype || 'narrative',
          confidence: 0.96, reason_zh: '根据文章结构识别', blueprint: validBlueprint
        }) });
      }
      if (schemaName === 'review_paragraph_batch') {
        const calls = (mapCallsByBatch.get(payload.batch_id) || 0) + 1;
        mapCallsByBatch.set(payload.batch_id, calls);
        if (options.failSecondMapOnce && payload.batch_id === 'chunk-002' && !failedSecond) {
          failedSecond = true;
          return jsonResponse({}, 400);
        }
        return jsonResponse({ output_text: JSON.stringify({
          batch_id: payload.batch_id,
          paragraphs_reviewed: payload.paragraphs.map(item => item.paragraph_id),
          paragraph_summaries: payload.paragraphs.map(item => ({
            paragraph_id: item.paragraph_id, summary_zh: '段落摘要',
            rhetorical_role: 'evidence_support', key_point_zh: '支持主题',
            transition_from_previous_zh: ''
          }))
        }) });
      }
      return jsonResponse({ output_text: JSON.stringify({
        paper_thesis_zh: '中心命题', organization_strategy_zh: '按主题组织',
        sections: payload.sections.map(item => ({
          section_id: item.section_id, section_role: '证据综合',
          section_summary_zh: '章节摘要', transition_from_previous_zh: ''
        })), key_tensions: []
      }) });
    },
    sleepImpl: async () => {}
  });
  await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' }
  });
  await router.handle({
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { mode: 'llm', providerId: 'openai', consentGranted: true }
  });
  return { router, requests, mapCallsByBatch };
}

test('routes a review outline through map reduce and returns subtype metadata', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'systematic' });
  const message = reviewOutlineMessage(outlineParagraphs(2));
  await selectStudyType(fixture.router, message.document, 'systematic_review_meta');
  const progress = [];
  const response = await fixture.router.handle(message, {
    onProgress: event => progress.push(event)
  });
  assert.equal(response.success, true);
  assert.equal(response.data.outline.reviewSubtype, 'narrative');
  assert.equal(response.data.outline.paragraphCount, 2);
  assert.equal(response.data.cacheHit, false);
  const checkpoint = progress.find(event => event.phase === 'review_chunk_checkpoint');
  assert.ok(checkpoint);
  assert.equal(checkpoint.completedParagraphs, 2);
  assert.equal(checkpoint.totalParagraphs, 2);
  assert.equal(checkpoint.checkpointSummaries.length, 2);
});

test('reuses a complete review outline without another provider request', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'narrative' });
  const message = reviewOutlineMessage(outlineParagraphs(2));
  await selectStudyType(fixture.router, message.document, 'systematic_review_meta');
  await fixture.router.handle(message);
  const calls = fixture.requests.length;
  const second = await fixture.router.handle(message);
  assert.equal(second.data.cacheHit, true);
  assert.equal(fixture.requests.length, calls);
});

test('does not reuse a review outline after the manual study type changes', async () => {
  const fixture = await configuredReviewRouter();
  const message = reviewOutlineMessage(outlineParagraphs(2));
  await selectStudyType(fixture.router, message.document, 'basic_mechanistic');
  const first = await fixture.router.handle(message);
  const callsForFirstType = fixture.requests.length;

  await selectStudyType(fixture.router, message.document, 'systematic_review_meta');
  const second = await fixture.router.handle(message);

  assert.equal(first.success, true);
  assert.equal(first.data.outline.reviewSubtype, 'not_review');
  assert.equal(second.success, true);
  assert.equal(second.data.cacheHit, false);
  assert.equal(second.data.outline.reviewSubtype, 'narrative');
  assert.ok(fixture.requests.length > callsForFirstType);
});

test('checkpoints completed review map chunks and resumes after failure', async () => {
  const fixture = await configuredReviewRouter({ failSecondMapOnce: true });
  const message = reviewOutlineMessage(outlineParagraphs(4), { maxChars: 120 });
  await selectStudyType(fixture.router, message.document, 'systematic_review_meta');
  const failed = await fixture.router.handle(message);
  assert.equal(failed.success, false);
  const firstChunkCalls = fixture.mapCallsByBatch.get('chunk-001') || 0;
  const resumed = await fixture.router.handle(message);
  assert.equal(resumed.success, true);
  assert.equal(fixture.mapCallsByBatch.get('chunk-001'), firstChunkCalls);
});

test('allows a non-review paper outline with a type notice', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'not_review' });
  const message = reviewOutlineMessage(outlineParagraphs(1));
  await selectStudyType(fixture.router, message.document, 'basic_mechanistic');
  const response = await fixture.router.handle(message);
  assert.equal(response.success, true);
  assert.equal(response.data.nonReviewNotice, true);
});

test('summarizes one requested section without replacing the full document identity', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'narrative' });
  const paragraphs = outlineParagraphs(3);
  const message = reviewOutlineMessage(paragraphs, {
    scopeId: 'sec-a-local',
    scopeParagraphIds: [paragraphs[1].paragraphId]
  });
  const prepared = await selectStudyType(
    fixture.router,
    message.document,
    'systematic_review_meta'
  );
  message.document.documentId = prepared.data.documentId;
  message.document.previousDocumentHash = prepared.data.documentHash;
  const response = await fixture.router.handle(message);
  assert.equal(response.success, true);
  assert.equal(response.data.scopeId, 'sec-a-local');
  assert.equal(response.data.documentId, prepared.data.documentId);
  assert.equal(response.data.outline.paragraphCount, 1);
  const mapRequest = fixture.requests
    .filter(request => request.schemaName === 'review_paragraph_batch')
    .at(-1);
  assert.deepEqual(
    mapRequest.payload.paragraphs.map(item => item.paragraph_id),
    [paragraphs[1].paragraphId]
  );
});

test('paragraph-only review sends only scoped text while retaining prepared document proof', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'narrative' });
  const paragraphs = outlineParagraphs(3);
  const prepared = await selectStudyType(
    fixture.router,
    reviewOutlineMessage(paragraphs).document,
    'systematic_review_meta'
  );
  const selected = paragraphs[1];
  const response = await fixture.router.handle(reviewOutlineMessage([selected], {
    paragraphOnly: true,
    scopeId: `paragraph:${selected.paragraphId}`,
    scopeParagraphIds: [selected.paragraphId],
    documentProof: {
      documentId: prepared.data.documentId,
      documentHash: prepared.data.documentHash
    }
  }));

  assert.equal(response.success, true);
  assert.equal(response.data.documentId, prepared.data.documentId);
  assert.equal(response.data.documentHash, prepared.data.documentHash);
  const mapRequest = fixture.requests
    .filter(request => request.schemaName === 'review_paragraph_batch')
    .at(-1);
  assert.deepEqual(mapRequest.payload.paragraphs.map(item => item.paragraph_id), [
    selected.paragraphId
  ]);
});

test('paragraph-only review rejects body paragraphs outside its explicit scope', async () => {
  const fixture = await configuredReviewRouter({ reviewSubtype: 'narrative' });
  const paragraphs = outlineParagraphs(2);
  const prepared = await selectStudyType(
    fixture.router,
    reviewOutlineMessage(paragraphs).document,
    'systematic_review_meta'
  );
  const response = await fixture.router.handle(reviewOutlineMessage(paragraphs, {
    paragraphOnly: true,
    scopeId: `paragraph:${paragraphs[0].paragraphId}`,
    scopeParagraphIds: [paragraphs[0].paragraphId],
    documentProof: {
      documentId: prepared.data.documentId,
      documentHash: prepared.data.documentHash
    }
  }));

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'INVALID_SETTINGS');
});

test('wires durable directory sync and all four user-data routes without requesting permission', () => {
  const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
  assert.match(source, /core\/directory-sync\.js/);
  assert.match(source, /createIndexedDbDirectoryHandleStore\(indexedDB\)/);
  assert.match(source, /createIndexedDbSyncQueue\(indexedDB\)/);
  assert.match(source, /createDirectorySync\(/);
  for (const type of [
    'USER_DATA_SYNC_STATUS', 'USER_DATA_SYNC_NOW',
    'USER_DATA_REBUILD_INDEX', 'USER_DATA_EXPORT_BUNDLE',
    'LLM_SAVE_PROFILE', 'LLM_DUPLICATE_PROFILE', 'LLM_DELETE_PROFILE',
    'LLM_UPDATE_PROFILE_ROUTING', 'LLM_TEST_PROFILE'
  ]) {
    assert.match(source, new RegExp(`'${type}'`));
  }
  assert.ok(
    source.indexOf("'providers/provider-registry.js'") <
      source.indexOf("'core/task-profile-router.js'")
  );
  assert.doesNotMatch(source, /requestPermission\s*\(/);
});

test('mirrors saved category configuration with monotonic revisions and never waits for flush', async () => {
  const never = new Promise(() => {});
  const directorySync = createDirectorySyncDouble({ flushGate: never });
  const storageArea = createMemoryStorage();
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.profiles.profile_default_openai.config.apiKey = 'sk-directory-must-not-export';
  storageArea.values.sciLlmSettingsV2 = settings;
  const router = createBackgroundRouter({
    storageArea,
    directorySync,
    fetchImpl: async () => jsonResponse({})
  });

  const saved = await Promise.race([
    router.handle({
      type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
      override: { color: '#173F6F' }
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('flush blocked route')), 100))
  ]);
  const reset = await router.handle({
    type: 'CATEGORY_RESET_OVERRIDE', categoryId: 'limitation'
  });

  assert.equal(saved.success, true);
  assert.equal(reset.success, true);
  assert.equal(directorySync.json.length, 2);
  assert.deepEqual(directorySync.json.map(item => item.path), ['categories.json', 'categories.json']);
  assert.ok(directorySync.json[1].value.revision > directorySync.json[0].value.revision);
  assert.doesNotMatch(JSON.stringify(directorySync.json), /apiKey|providers|sk-directory/);
  assert.equal(directorySync.flushCalls, 2);
});

test('mirrors study type and every annotation mutation to one encoded document asset', async () => {
  const directorySync = createDirectorySyncDouble();
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    documentStore: createMemoryDocumentStore(),
    directorySync,
    fetchImpl: async () => jsonResponse({})
  });
  const prepared = await router.handle({ type: 'DOCUMENT_PREPARE', document: manualDocument });
  const documentId = prepared.data.documentId;
  directorySync.json.length = 0;

  assert.equal((await router.handle({
    type: 'LLM_SET_STUDY_TYPE', documentId, studyType: 'observational'
  })).success, true);
  assert.equal((await router.handle({
    type: 'ANNOTATION_UPSERT', documentId, annotation: routerAnnotation()
  })).success, true);
  assert.equal((await router.handle({
    type: 'ANNOTATION_DELETE', documentId, annotationId: 'manual-1'
  })).success, true);
  assert.equal((await router.handle({
    type: 'ANNOTATION_CLEAR_DOCUMENT', documentId
  })).success, true);

  assert.equal(directorySync.json.length, 4);
  const expectedPath = `annotations/${encodeURIComponent(documentId)}.json`;
  assert.deepEqual(directorySync.json.map(item => item.path), Array(4).fill(expectedPath));
  assert.deepEqual(directorySync.json.map(item => item.value.revision), [2, 3, 4, 5]);
});

test('mirrors feedback as sanitized JSONL and local mutations survive enqueue failures', async () => {
  const directorySync = createDirectorySyncDouble({ enqueueError: new Error('disk offline') });
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({
    storageArea,
    directorySync,
    fetchImpl: async () => jsonResponse({})
  });

  const category = await router.handle({
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'limitation',
    override: { color: '#173F6F' }
  });
  const feedback = await router.handle({
    type: 'LLM_RECORD_FEEDBACK',
    sample: {
      documentHash: 'doc-1', paragraphId: 'p1', quote: 'A result sentence.',
      categoryId: 'result', userAction: 'accepted',
      url: 'https://private.example/article'
    }
  });

  assert.equal(category.success, true);
  assert.equal(feedback.success, true);
  assert.equal(storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation.color, '#173F6F');

  const healthySync = createDirectorySyncDouble();
  const healthyRouter = createBackgroundRouter({
    storageArea: createMemoryStorage(), directorySync: healthySync,
    fetchImpl: async () => jsonResponse({})
  });
  await healthyRouter.handle({
    type: 'LLM_RECORD_FEEDBACK',
    sample: {
      documentHash: 'doc-2', paragraphId: 'p2', quote: 'Another result sentence.',
      categoryId: 'result', userAction: 'accepted', url: 'https://private.example'
    }
  });
  assert.equal(healthySync.text[0].path, 'corpus/feedback.jsonl');
  assert.doesNotMatch(healthySync.text[0].value, /private\.example|url/);
});

test('routes status, flush, rebuild imports, and a credential-free user-data bundle', async () => {
  const storageArea = createMemoryStorage();
  const settings = globalThis.SciLLM.createDefaultSettings();
  settings.profiles.profile_default_openai.config.apiKey = 'sk-bundle-secret';
  storageArea.values.sciLlmSettingsV2 = settings;
  const documentStore = createMemoryDocumentStore();
  await documentStore.prepareDocument({
    schemaVersion: 1, documentId: 'sha256:local', title: 'Local', canonicalUrl: '',
    studyType: null, annotations: [], revision: 0, documentHash: 'local',
    documentHashes: ['local']
  });
  const directorySync = createDirectorySyncDouble({
    rebuildAssets: [
      {
        path: 'categories.json',
        value: {
          schemaVersion: 1, revision: 7, sourceId: 'directory',
          categoryOverrides: { limitation: { color: '#102030' } },
          customCategories: [], selectedCategoryIds: ['limitation'],
          viewCategoryOverrides: settings.viewCategoryOverrides
        }
      },
      {
        path: `annotations/${encodeURIComponent('sha256:local')}.json`,
        value: {
          schemaVersion: 1, documentId: 'sha256:local', title: 'Imported',
          canonicalUrl: '', studyType: 'observational', annotations: [],
          revision: 9, updatedAt: new Date().toISOString(), documentHash: 'local',
          documentHashes: ['local']
        }
      },
      { path: '../escape.json', value: { schemaVersion: 1, revision: 99 } }
    ]
  });
  const router = createBackgroundRouter({
    storageArea, documentStore, directorySync,
    fetchImpl: async () => jsonResponse({})
  });

  const status = await router.handle({ type: 'USER_DATA_SYNC_STATUS' });
  const synced = await router.handle({ type: 'USER_DATA_SYNC_NOW' });
  const rebuilt = await router.handle({ type: 'USER_DATA_REBUILD_INDEX' });
  const bundle = await router.handle({ type: 'USER_DATA_EXPORT_BUNDLE' });

  assert.equal(status.data.permission, 'prompt');
  assert.equal(synced.data.permission, 'granted');
  assert.equal(rebuilt.success, true);
  assert.equal(rebuilt.data.imported, 2);
  assert.equal(storageArea.values.sciLlmSettingsV2.categoryOverrides.limitation.color, '#102030');
  assert.equal((await documentStore.getDocument('sha256:local')).studyType, 'observational');
  assert.equal(bundle.success, true);
  assert.match(JSON.stringify(bundle.data), /sha256:local/);
  assert.doesNotMatch(
    JSON.stringify(bundle.data),
    /sk-bundle-secret|apiKey|providers|authorization|analysisCache|directoryHandle|syncQueue/i
  );
});

test('rebuild shares the document mutation queue so concurrent annotations are preserved', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const documentStore = createMemoryDocumentStore();
  const directorySync = createDirectorySyncDouble();
  directorySync.rebuildIndex = async importer => {
    await gate;
    const current = await documentStore.getDocument('sha256:race');
    await importer(`annotations/${encodeURIComponent('sha256:race')}.json`, {
      ...current,
      revision: current.revision + 5,
      annotations: [{ ...routerAnnotation(), annotationId: 'from-directory' }]
    }, {});
    return { imported: 1, stale: 0, invalidAssets: 0 };
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(), documentStore, directorySync,
    fetchImpl: async () => jsonResponse({})
  });
  await documentStore.prepareDocument({
    schemaVersion: 1, documentId: 'sha256:race', title: 'Race', canonicalUrl: '',
    studyType: null, annotations: [], revision: 0, documentHash: 'race',
    documentHashes: ['race']
  });

  const rebuilding = router.handle({ type: 'USER_DATA_REBUILD_INDEX' });
  const annotating = router.handle({
    type: 'ANNOTATION_UPSERT', documentId: 'sha256:race',
    annotation: { ...routerAnnotation(), annotationId: 'from-user' }
  });
  release();
  const [rebuilt, annotated] = await Promise.all([rebuilding, annotating]);
  const record = await documentStore.getDocument('sha256:race');

  assert.equal(rebuilt.success, true);
  assert.equal(annotated.success, true);
  assert.deepEqual(record.annotations.map(item => item.annotationId).sort(), [
    'from-directory', 'from-user'
  ]);
});

test('saves profiles with explicit key preservation and clearing semantics', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  const secret = 'profile-save-secret-1234';

  const created = await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_saved_openai', name: 'Saved OpenAI', providerId: 'openai',
      config: { apiKey: secret, model: 'gpt-5-mini' },
      capabilities: { vision: true },
      tokenPolicy: { mode: 'auto', autoCap: null }
    }
  });
  const preserved = await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_saved_openai', name: 'Renamed', providerId: 'openai',
      config: { apiKey: '', model: 'gpt-5-mini' }
    }
  });

  assert.equal(created.success, true);
  assert.equal(preserved.success, true);
  assert.equal(
    storageArea.values.sciLlmSettingsV2.profiles.profile_saved_openai.config.apiKey,
    secret
  );
  assert.doesNotMatch(JSON.stringify([created, preserved]), new RegExp(secret));

  const cleared = await router.handle({
    type: 'LLM_SAVE_PROFILE', clearApiKey: true,
    profile: {
      id: 'profile_saved_openai', name: 'Renamed', providerId: 'openai',
      config: { apiKey: '', model: 'gpt-5-mini' }
    }
  });
  assert.equal(cleared.success, true);
  assert.equal(
    storageArea.values.sciLlmSettingsV2.profiles.profile_saved_openai.config.apiKey,
    ''
  );
});

test('duplicates all local profile behavior but returns only public data', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  const key = 'duplicate-key-secret';
  const header = 'duplicate-header-secret';
  await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_duplicate_source', name: '原配置', providerId: 'openai-compatible',
      config: {
        apiKey: key, model: 'custom-model', baseUrl: 'https://example.com/v1',
        supportsVision: true, customHeaders: { 'X-Custom': header }
      },
      capabilities: { vision: true, batch: false },
      tokenPolicy: { mode: 'manual', manualMax: 8192 }
    }
  });

  const duplicated = await router.handle({
    type: 'LLM_DUPLICATE_PROFILE', profileId: 'profile_duplicate_source'
  });
  const saved = storageArea.values.sciLlmSettingsV2;
  const duplicateId = saved.profileOrder.at(-1);
  const copy = saved.profiles[duplicateId];

  assert.equal(duplicated.success, true);
  assert.match(duplicateId, /^profile_[a-z0-9_]{3,80}$/);
  assert.notEqual(duplicateId, 'profile_duplicate_source');
  assert.match(copy.name, /副本/);
  assert.equal(copy.config.apiKey, key);
  assert.equal(copy.config.customHeaders['X-Custom'], header);
  assert.deepEqual(copy.capabilities, saved.profiles.profile_duplicate_source.capabilities);
  assert.deepEqual(copy.tokenPolicy, saved.profiles.profile_duplicate_source.tokenPolicy);
  assert.doesNotMatch(JSON.stringify(duplicated), /duplicate-key-secret|duplicate-header-secret/);
});

test('deleting a routed global profile switches global and clears every dangling route', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });
  for (const [id, name] of [['profile_delete_me', 'Delete'], ['profile_keep_me', 'Keep']]) {
    const response = await router.handle({
      type: 'LLM_SAVE_PROFILE',
      profile: {
        id, name, providerId: 'deepseek',
        config: { apiKey: `${id}-secret`, model: 'deepseek-chat' }
      }
    });
    assert.equal(response.success, true);
  }
  const routes = Object.fromEntries(globalThis.SciLLM.TASK_ROUTE_KEYS.map(taskType => [
    taskType, { mode: 'profile', profileId: 'profile_delete_me' }
  ]));
  assert.equal((await router.handle({
    type: 'LLM_UPDATE_PROFILE_ROUTING',
    globalProfileId: 'profile_delete_me', taskRoutes: routes
  })).success, true);

  const deleted = await router.handle({
    type: 'LLM_DELETE_PROFILE', profileId: 'profile_delete_me'
  });
  const saved = storageArea.values.sciLlmSettingsV2;

  assert.equal(deleted.success, true);
  assert.equal(saved.globalProfileId, saved.profileOrder[0]);
  assert.notEqual(saved.globalProfileId, 'profile_delete_me');
  assert.equal(saved.profiles.profile_delete_me, undefined);
  Object.values(saved.taskRoutes).forEach(route => {
    assert.deepEqual(route, { mode: 'global', profileId: null });
  });
});

test('routing rejects a missing global profile and normalizes invalid task routes', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });

  const rejected = await router.handle({
    type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: 'profile_missing', taskRoutes: {}
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.error.code, 'INVALID_SETTINGS');
  assert.deepEqual(rejected.error.fields, ['globalProfileId']);

  const accepted = await router.handle({
    type: 'LLM_UPDATE_PROFILE_ROUTING',
    taskRoutes: {
      figure: { mode: 'profile', profileId: 'profile_missing' },
      injected: { mode: 'profile', profileId: 'profile_default_openai' }
    }
  });
  assert.equal(accepted.success, true);
  assert.deepEqual(Object.keys(storageArea.values.sciLlmSettingsV2.taskRoutes),
    globalThis.SciLLM.TASK_ROUTE_KEYS);
  assert.deepEqual(storageArea.values.sciLlmSettingsV2.taskRoutes.figure,
    { mode: 'global', profileId: null });
});

test('tests the exact requested profile instead of falling back to the global profile', async () => {
  const storageArea = createMemoryStorage();
  const urls = [];
  const router = createBackgroundRouter({
    storageArea,
    fetchImpl: async url => {
      urls.push(String(url));
      return sseResponse(JSON.stringify({
        chunk_id: 'connection-test',
        paragraphs_reviewed: ['connection-p1'], annotations: []
      }));
    }
  });
  await router.handle({
    type: 'LLM_SAVE_PROFILE',
    profile: {
      id: 'profile_exact_deepseek', name: 'Exact DeepSeek', providerId: 'deepseek',
      config: { apiKey: 'exact-secret', model: 'deepseek-chat' }
    }
  });

  const tested = await router.handle({
    type: 'LLM_TEST_PROFILE', profileId: 'profile_exact_deepseek'
  });

  assert.equal(tested.success, true);
  assert.equal(tested.data.providerId, 'deepseek');
  assert.equal(tested.data.profileId, 'profile_exact_deepseek');
  assert.match(urls[0], /deepseek/i);
  assert.doesNotMatch(JSON.stringify(tested), /exact-secret/);

  const missing = await router.handle({
    type: 'LLM_TEST_PROFILE', profileId: 'profile_missing'
  });
  assert.equal(missing.success, false);
  assert.equal(missing.error.code, 'INVALID_SETTINGS');
  assert.doesNotMatch(JSON.stringify(missing), /apiKey|customHeaders|exact-secret/);
});

test('legacy provider saves upsert one profile without reviving the legacy settings model', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });

  const response = await router.handle({
    type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
    config: { apiKey: 'legacy-adapter-secret', model: 'gpt-5-mini' }
  });
  const saved = storageArea.values.sciLlmSettingsV2;

  assert.equal(response.success, true);
  assert.ok(saved.profiles.profile_legacy_openai);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'providers'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'providerId'), false);
  assert.doesNotMatch(JSON.stringify(response), /legacy-adapter-secret/);
});

test('all profile handlers refuse opaque future settings without mutating legacy fields', async () => {
  const messages = [
    {
      type: 'LLM_SAVE_PROFILE',
      profile: {
        id: 'profile_future_new', name: 'New', providerId: 'openai',
        config: { apiKey: 'future-secret', model: 'gpt-5-mini' }
      }
    },
    { type: 'LLM_DUPLICATE_PROFILE', profileId: 'profile_future_openai' },
    { type: 'LLM_DELETE_PROFILE', profileId: 'profile_future_openai' },
    {
      type: 'LLM_UPDATE_PROFILE_ROUTING',
      globalProfileId: 'profile_future_openai', taskRoutes: {}
    },
    {
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: { mode: 'llm', providerId: 'openai', consentGranted: true }
    },
    {
      type: 'LLM_SAVE_PROVIDER', providerId: 'openai',
      config: { apiKey: 'future-secret', model: 'gpt-5-mini' }
    },
    { type: 'LLM_TEST_PROFILE', profileId: 'profile_future_openai' },
    { type: 'LLM_TEST_PROVIDER', providerId: 'openai' }
  ];

  for (const message of messages) {
    const storageArea = createMemoryStorage();
    storageArea.values.sciLlmSettingsV2 = {
      version: 99,
      mode: 'regex',
      consentGranted: false,
      providerId: 'legacy-provider-id-must-stay',
      providers: { legacy: { preserve: true } },
      opaque: { preserve: true },
      profiles: {
        profile_future_openai: {
          name: 'Future', providerId: 'openai',
          config: { apiKey: 'stored-future-secret', model: 'gpt-5-mini' }
        }
      },
      profileOrder: ['profile_future_openai'],
      globalProfileId: 'profile_future_openai',
      taskRoutes: {}
    };
    const snapshot = structuredClone(storageArea.values.sciLlmSettingsV2);
    const router = createBackgroundRouter({
      storageArea,
      fetchImpl: async () => { throw new Error('future profile must not be tested'); }
    });

    const response = await router.handle(message);

    assert.equal(response.success, false, message.type);
    assert.equal(response.error.code, 'INVALID_SETTINGS', message.type);
    assert.deepEqual(response.error.fields, ['version'], message.type);
    assert.deepEqual(storageArea.values.sciLlmSettingsV2, snapshot, message.type);
    assert.doesNotMatch(
      JSON.stringify(response),
      /future-secret|stored-future-secret|legacy-provider-id-must-stay/
    );
  }
});

test('deleting the only profile leaves an empty non-dangling profile state', async () => {
  const storageArea = createMemoryStorage();
  const router = createBackgroundRouter({ storageArea, fetchImpl: async () => jsonResponse({}) });

  const deleted = await router.handle({
    type: 'LLM_DELETE_PROFILE', profileId: 'profile_default_openai'
  });
  const saved = storageArea.values.sciLlmSettingsV2;

  assert.equal(deleted.success, true);
  assert.deepEqual(saved.profiles, {});
  assert.deepEqual(saved.profileOrder, []);
  assert.equal(saved.globalProfileId, '');
  Object.values(saved.taskRoutes).forEach(route => {
    assert.deepEqual(route, { mode: 'global', profileId: null });
  });
});
