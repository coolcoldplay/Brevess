const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');

function functionSource(name, next) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`\nfunction ${next}(`, start);
  assert.ok(start >= 0 && end > start, `${name} production function must be extractable`);
  return source.slice(start, end);
}

function createHarness(options = {}) {
  const documentHash = 'a'.repeat(64);
  const structure = {
    adapterId: 'pdf-native',
    documentId: `sha256:${documentHash}`,
    documentHash,
    paragraphs: [{ paragraphId: 'pdf-page-1', text: 'canonical PDF text' }]
  };
  const workspace = {
    workspaceId: `workspace:${'b'.repeat(64)}`,
    workspaceGeneration: 4,
    canonicalUrl: options.canonicalUrl ||
      `file:///brevess-local-pdf/${documentHash}/paper.pdf`,
    contentHash: 'c'.repeat(64)
  };
  const native = { structure, documentGeneration: 9, phase: 'text-ready' };
  const completeTurn = {
    turnId: 'turn-selection-1',
    status: 'completed',
    question: 'question',
    answerBlocks: [{ blockId: 'answer-1', markdown: 'answer' }]
  };
  const artifact = {
    relativePath: 'analysis/full-analysis.json',
    content: { schemaVersion: 1, llm: { rawAnalysis: { categories: {} }, paragraphs: [] } }
  };
  const checkpoint = {
    workspace: { ...workspace, deletionPending: false },
    assets: [
      {
        relativePath: 'article/structure.json',
        content: { documentId: `sha256:${documentHash}`, documentHash }
      },
      artifact,
      { relativePath: 'chat/index.json', content: { turns: [completeTurn] } },
      { relativePath: 'legacy/archive.json', content: { documentId: 'legacy-document' } }
    ],
    turns: [completeTurn]
  };
  const applied = [];
  const messages = [];
  const context = vm.createContext({
    articleWorkspaceLifecycleGeneration: 12,
    currentArticleWorkspace: workspace,
    __brevessNativePdfDocument: native,
    chrome: {
      runtime: {
        sendMessage: async message => {
          messages.push(message);
          assert.deepEqual(JSON.parse(JSON.stringify(message)), {
            type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId: workspace.workspaceId
          });
          if (typeof options.duringRead === 'function') {
            options.duringRead({ context, native, workspace, checkpoint });
          }
          return {
            success: options.success !== false,
            data: options.checkpoint ? options.checkpoint(checkpoint) : checkpoint
          };
        }
      }
    },
    articleWorkspaceRestoreError(code = 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH') {
      return Object.assign(new Error(code), { code });
    },
    MECHANISM_CLEANUP_INTENTS_ASSET_PATH: 'figures/mechanism-cleanup-intents.json',
    crossFigureMechanismOwnData(value, key) { return value?.[key]; },
    hydrateCrossFigureMechanismCleanupIntents(value) {
      if (!Array.isArray(value)) {
        throw Object.assign(new Error('MECHANISM_CLEANUP_CHECKPOINT_INVALID'), {
          code: 'MECHANISM_CLEANUP_CHECKPOINT_INVALID'
        });
      }
      return value;
    },
    restoreCrossFigureMechanismState(value) {
      return { cleanupIntents: value?.cleanupIntents || [] };
    },
    async applyArticleWorkspaceAssetsUnsafe(input) {
      applied.push(input);
      return {
        success: true,
        completedTurns: (input.turns || []).filter(turn => turn.status === 'completed').length,
        artifactPaths: (input.assets || []).map(asset => asset.relativePath)
      };
    }
  });
  vm.runInContext(
    `${functionSource('loadNativePdfWorkspaceCheckpoint', 'currentNativePdfRegexProjection')}\n` +
    'globalThis.loadNativePdfWorkspaceCheckpoint = loadNativePdfWorkspaceCheckpoint;',
    context
  );
  return {
    context, workspace, native, documentHash, completeTurn, artifact, checkpoint,
    applied, messages
  };
}

test('native PDF checkpoint restores the completed turn and artifacts without legacy archive data', async () => {
  const harness = createHarness();
  const result = await harness.context.loadNativePdfWorkspaceCheckpoint(
    harness.workspace, harness.native.structure, harness.native
  );

  assert.equal(result.success, true);
  assert.equal(result.completedTurns, 1);
  assert.deepEqual(result.artifactPaths, [
    'article/structure.json', 'analysis/full-analysis.json', 'chat/index.json'
  ]);
  assert.equal(harness.applied.length, 1);
  assert.equal(harness.applied[0].match, 'exact');
  assert.equal(harness.applied[0].persistRestored, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.applied[0].turns)),
    [harness.completeTurn]
  );
  assert.equal(
    harness.applied[0].assets.some(asset => asset.relativePath === 'legacy/archive.json'),
    false
  );
});

test('native PDF checkpoint rejects an exported workspace from an old generation', async () => {
  const harness = createHarness({
    checkpoint: checkpoint => ({
      ...checkpoint,
      workspace: { ...checkpoint.workspace, workspaceGeneration: 3 }
    })
  });

  await assert.rejects(
    harness.context.loadNativePdfWorkspaceCheckpoint(
      harness.workspace, harness.native.structure, harness.native
    ),
    error => error?.code === 'PDF_WORKSPACE_CHECKPOINT_INVALID'
  );
  assert.equal(harness.applied.length, 0);
});

test('native PDF checkpoint rejects a source-hash change while IndexedDB is being read', async () => {
  const harness = createHarness({
    duringRead: ({ native }) => {
      native.structure = { ...native.structure, documentHash: 'd'.repeat(64) };
    }
  });

  await assert.rejects(
    harness.context.loadNativePdfWorkspaceCheckpoint(
      harness.workspace, harness.native.structure, harness.native
    ),
    error => error?.code === 'PDF_WORKSPACE_CHECKPOINT_STALE'
  );
  assert.equal(harness.applied.length, 0);
});

test('native PDF checkpoint rejects a clear lifecycle while IndexedDB is being read', async () => {
  const harness = createHarness({
    duringRead: ({ context }) => {
      context.articleWorkspaceLifecycleGeneration += 1;
      context.currentArticleWorkspace = null;
    }
  });

  await assert.rejects(
    harness.context.loadNativePdfWorkspaceCheckpoint(
      harness.workspace, harness.native.structure, harness.native
    ),
    error => error?.code === 'PDF_WORKSPACE_CHECKPOINT_STALE'
  );
  assert.equal(harness.applied.length, 0);
});

test('native PDF checkpoint validates every throwing asset before mutating restore state', async () => {
  const harness = createHarness({
    checkpoint: checkpoint => ({
      ...checkpoint,
      assets: [...checkpoint.assets, {
        relativePath: 'figures/mechanism-cleanup-intents.json',
        content: { schemaVersion: 2, cleanupIntents: [] }
      }]
    })
  });

  await assert.rejects(
    harness.context.loadNativePdfWorkspaceCheckpoint(
      harness.workspace, harness.native.structure, harness.native
    ),
    error => error?.code === 'MECHANISM_CLEANUP_CHECKPOINT_INVALID'
  );
  assert.equal(harness.applied.length, 0,
    'a corrupt later asset must not leave analysis or chat half-restored');
});

test('native PDF checkpoint rejects remote assets saved for another binary at the same URL', async () => {
  const harness = createHarness({
    canonicalUrl: 'https://example.test/paper.pdf',
    checkpoint: checkpoint => ({
      ...checkpoint,
      assets: checkpoint.assets.map(asset => asset.relativePath === 'article/structure.json'
        ? { ...asset, content: { ...asset.content, documentHash: 'd'.repeat(64) } }
        : asset)
    })
  });

  await assert.rejects(
    harness.context.loadNativePdfWorkspaceCheckpoint(
      harness.workspace, harness.native.structure, harness.native
    ),
    error => error?.code === 'PDF_WORKSPACE_SOURCE_CHANGED'
  );
  assert.equal(harness.applied.length, 0);
});

test('native PDF checkpoint rejects remote legacy results without a saved binary hash', async () => {
  const harness = createHarness({
    canonicalUrl: 'https://example.test/paper.pdf',
    checkpoint: checkpoint => ({
      ...checkpoint,
      assets: checkpoint.assets.map(asset => asset.relativePath === 'article/structure.json'
        ? { ...asset, content: { documentId: asset.content.documentId } }
        : asset)
    })
  });

  await assert.rejects(
    harness.context.loadNativePdfWorkspaceCheckpoint(
      harness.workspace, harness.native.structure, harness.native
    ),
    error => error?.code === 'PDF_WORKSPACE_SOURCE_CHANGED'
  );
  assert.equal(harness.applied.length, 0);
});

test('native PDF checkpoint accepts legacy hashless results under the exact local hash URL', async () => {
  const harness = createHarness({
    checkpoint: checkpoint => ({
      ...checkpoint,
      assets: checkpoint.assets.map(asset => asset.relativePath === 'article/structure.json'
        ? { ...asset, content: { documentId: asset.content.documentId } }
        : asset)
    })
  });

  const result = await harness.context.loadNativePdfWorkspaceCheckpoint(
    harness.workspace, harness.native.structure, harness.native
  );
  assert.equal(result.success, true);
  assert.equal(result.completedTurns, 1);
  assert.equal(harness.applied.length, 1);
});

test('native PDF checkpoint allows an empty first remote workspace without a saved hash', async () => {
  const harness = createHarness({
    canonicalUrl: 'https://example.test/paper.pdf',
    checkpoint: checkpoint => ({
      ...checkpoint,
      assets: checkpoint.assets.filter(asset =>
        ['article/structure.json', 'article/paragraphs.json'].includes(asset.relativePath)
      ).map(asset => ({ ...asset, content: {} })),
      turns: []
    })
  });

  const result = await harness.context.loadNativePdfWorkspaceCheckpoint(
    harness.workspace, harness.native.structure, harness.native
  );
  assert.equal(result.success, true);
  assert.equal(result.completedTurns, 0);
  assert.equal(harness.applied.length, 1);
});

test('native PDF checkpoint with no expected source leaves storage and memory untouched', async () => {
  const harness = createHarness();
  const result = await harness.context.loadNativePdfWorkspaceCheckpoint(
    harness.workspace, { ...harness.native.structure, documentHash: '' },
    harness.native
  );
  assert.equal(result, undefined);
  assert.equal(harness.messages.length, 0);
  assert.equal(harness.applied.length, 0);
});

test('native PDF initialization hydrates local checkpoints before regex restore and baseline save', () => {
  const start = source.indexOf('async function prepareNativePdfWorkspace()');
  const end = source.indexOf('\nfunction nativePdfRegexRestoreReadiness', start);
  assert.ok(start >= 0 && end > start);
  const preparation = source.slice(start, end);
  const hydrate = preparation.indexOf('loadNativePdfWorkspaceCheckpoint(');
  const regex = preparation.indexOf('loadNativePdfRegexRestoreFromWorkspace(');
  const baseline = preparation.indexOf('persistArticleWorkspaceArtifacts(');
  assert.ok(hydrate >= 0 && hydrate < regex && regex < baseline);
});
