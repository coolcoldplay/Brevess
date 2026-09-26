const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../core/figure-workspace.js');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const url = 'https://www.cell.com/cell/fulltext/S0092-8674(26)00806-8';
const binding = {
  documentId: `sha256:${'a'.repeat(64)}`, documentHash: 'b'.repeat(64),
  canonicalUrl: url, workspaceId: `workspace:${'c'.repeat(64)}`, workspaceGeneration: 1
};
const inventory = [{ figureId: 'figure-1', figureLabel: 'Figure 1',
  caption: '(A) Study overview. (B) Donor comparison.', panelHints: ['A', 'B'] }];
function asset() {
  let draft = api.createFigureWorkspaceDraft(inventory);
  draft.binding = { ...binding };
  draft = api.applyFigureWorkspaceMutation(draft, {
    type: 'set_panel_field', figureId: 'figure-1', panelId: 'A', field: 'note',
    value: 'Keep my original reviewed note', expectedRevision: draft.revision
  }, 42);
  return { content: draft, revision: 7, contentHash: 'durable-before-refresh',
    writeToken: 'workspace-write-v1-1234567890abcdef' };
}
function contentFunction(name, dependencies) {
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(end > start);
  return Function(...Object.keys(dependencies), `return (${source.slice(start, end)});`)
    (...Object.values(dependencies));
}

for (const changed of [
  { documentHash: 'd'.repeat(64) },
  { documentHash: 'd'.repeat(64), documentId: `sha256:${'e'.repeat(64)}` }
]) {
  test(`same HTML article refresh retains reviewed data and CAS: ${Object.keys(changed).join('+')}`, async () => {
    const durable = asset(), original = JSON.stringify(durable);
    const current = { ...binding, ...changed };
    const state = api.initializeFigureWorkspaceDraftState({
      binding: current, durableAsset: durable, inventory,
      allowDocumentRevisionUpdate: true
    });
    assert.deepEqual(state.draft.binding, current);
    assert.equal(state.draft.figures['figure-1'].panels.A.note.value, 'Keep my original reviewed note');
    assert.equal(state.draft.figures['figure-1'].panels.A.note.editedAt, 42);
    assert.equal(state.dirty, true, 'the new binding must be persisted even with unchanged figure inventory');
    assert.equal(JSON.stringify(durable), original, 'never mutate the input checkpoint');
    const writes = [];
    const controller = api.createFigureWorkspaceDraftController({
      binding: current, initialDraft: state.draft, initialCheckpoint: state.checkpoint,
      initialDirty: state.dirty,
      persist: async request => { writes.push(request); return { revision: 8, contentHash: 'saved' }; }
    });
    await controller.flush();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].expectedRevision, 7);
    assert.equal(writes[0].expectedContentHash, 'durable-before-refresh');
    assert.equal(writes[0].expectedWriteToken, durable.writeToken);
    assert.deepEqual(writes[0].draft.binding, current);
  });
}

for (const changed of [
  { workspaceId: `workspace:${'e'.repeat(64)}` },
  { canonicalUrl: 'https://www.cell.com/cell/fulltext/a-different-article' },
  { workspaceGeneration: 2 }
]) {
  test(`document refresh does not admit a different owner: ${Object.keys(changed)[0]}`, () => {
    assert.throws(() => api.initializeFigureWorkspaceDraftState({
      binding: { ...binding, ...changed, documentHash: 'd'.repeat(64) },
      durableAsset: asset(), allowDocumentRevisionUpdate: true
    }), error => error.code === 'FIGURE_WORKSPACE_BINDING_MISMATCH');
  });
}

test('strict default and non-web documents still reject a changed document fingerprint', () => {
  assert.throws(() => api.initializeFigureWorkspaceDraftState({
    binding: { ...binding, documentHash: 'd'.repeat(64) }, durableAsset: asset()
  }), error => error.code === 'FIGURE_WORKSPACE_BINDING_MISMATCH');
  const durable = asset();
  durable.content.binding.canonicalUrl = 'file:///C:/paper.pdf';
  assert.throws(() => api.initializeFigureWorkspaceDraftState({
    binding: { ...durable.content.binding, documentHash: 'd'.repeat(64) },
    durableAsset: durable, allowDocumentRevisionUpdate: true
  }), error => error.code === 'FIGURE_WORKSPACE_BINDING_MISMATCH');
});

function contentDependencies(native = null) {
  const current = { ...binding, documentHash: 'd'.repeat(64) };
  const durable = asset(), writes = [];
  return { current, durable, writes, dependencies: {
    SciLLM: api, activeNativePdfStructure: () => native,
    articleWorkspaceLifecycleGeneration: 1,
    figureWorkspaceDraftController: null, figureWorkspaceDraftControllerPromise: null,
    figureWorkspaceDraftCheckpointLoaded: false, figureWorkspaceDraftDirty: false,
    figureWorkspaceDraft: api.createFigureWorkspaceDraft([]), figureWorkspaceDraftCheckpoint: null,
    FIGURE_WORKSPACE_DRAFT_ASSET_PATH: 'figures/workspace-draft.json',
    currentFigureWorkspaceRefreshBinding: () => current,
    getWorkspaceAssetCheckpoint: async () => durable,
    assertCurrentArticleWorkspaceLifecycle: n => assert.equal(n, 1),
    combinedFigureWorkspaceInventory: () => inventory,
    buildFigureWorkspaceSnapshot: () => ({ figures: [] }),
    persistWorkspaceAssetCheckpoint: async (_path, draft, options) => {
      writes.push({ draft, options });
      return { saved: true, asset: { revision: 8, contentHash: 'saved' } };
    },
    notifyFigureWorkspaceStateChanged() {},
    figureWorkspacePersistFailureCode: () => 'SAVE_FAILED',
    figureWorkspaceInventorySeedPromise: Promise.resolve(),
    figureWorkspaceCompletedModelResult: () => null
  } };
}

test('production HTML controller can reopen an older extraction without clearing notes', async () => {
  const { dependencies, current, writes } = contentDependencies();
  const ensure = contentFunction('ensureFigureWorkspaceDraftController', dependencies);
  const controller = await ensure();
  await controller.flush();
  assert.deepEqual(controller.getBinding(), current);
  assert.equal(writes[0].draft.figures['figure-1'].panels.A.note.value, 'Keep my original reviewed note');
  assert.equal(writes[0].options.expectedRevision, 7);
});

test('production HTML durable restore keeps the checkpoint and reopens the same article', () => {
  const { dependencies, current, durable } = contentDependencies();
  const restore = contentFunction('restoreFigureWorkspaceDraft', dependencies);
  const draft = restore(durable.content, [], durable);
  assert.deepEqual(draft.binding, current);
  assert.equal(draft.figures['figure-1'].panels.A.note.value, 'Keep my original reviewed note');
});

test('native PDF controller keeps strict fingerprint isolation even at an HTTPS source URL', async () => {
  const { dependencies } = contentDependencies({ documentHash: 'd'.repeat(64) });
  const ensure = contentFunction('ensureFigureWorkspaceDraftController', dependencies);
  await assert.rejects(ensure(), error => error.code === 'FIGURE_WORKSPACE_BINDING_MISMATCH');
});

test('failed revision save leaves durable data untouched and can retry with the original CAS', async () => {
  const durable = asset(), original = JSON.stringify(durable);
  const current = { ...binding, documentHash: 'd'.repeat(64) };
  const state = api.initializeFigureWorkspaceDraftState({
    binding: current, durableAsset: durable, inventory, allowDocumentRevisionUpdate: true
  });
  let fail = true;
  const writes = [];
  const controller = api.createFigureWorkspaceDraftController({
    binding: current, initialDraft: state.draft, initialCheckpoint: state.checkpoint,
    initialDirty: state.dirty,
    persist: async request => {
      writes.push(request);
      if (fail) throw Object.assign(new Error('disk unavailable'), { code: 'ASSET_WRITE_FAILED' });
      return { revision: 8, contentHash: 'saved' };
    }
  });
  await assert.rejects(controller.flush(), { code: 'ASSET_WRITE_FAILED' });
  assert.equal(controller.isDirty(), true);
  assert.equal(JSON.stringify(durable), original);
  fail = false;
  await controller.flush();
  assert.equal(controller.isDirty(), false);
  assert.ok(writes.every(write => write.expectedRevision === 7 &&
    write.expectedContentHash === durable.contentHash && write.expectedWriteToken === durable.writeToken));
  assert.equal(controller.getDraft().figures['figure-1'].panels.A.note.value,
    'Keep my original reviewed note');
});

test('an unsaved same-owner review survives a revision update while a foreign memory draft is refused', () => {
  const durable = asset();
  const memoryDraft = api.applyFigureWorkspaceMutation(durable.content, {
    type: 'set_panel_field', figureId: 'figure-1', panelId: 'A', field: 'note',
    value: 'Latest unsaved review', expectedRevision: durable.content.revision
  }, 43);
  const options = { binding: { ...binding, documentHash: 'd'.repeat(64) },
    durableAsset: durable, memoryDraft, preferMemoryDraft: true, inventory,
    allowDocumentRevisionUpdate: true };
  const state = api.initializeFigureWorkspaceDraftState(options);
  assert.equal(state.draft.figures['figure-1'].panels.A.note.value, 'Latest unsaved review');
  assert.deepEqual(state.checkpoint, { revision: 7, contentHash: durable.contentHash, writeToken: durable.writeToken });
  memoryDraft.binding = { ...binding, workspaceGeneration: 2 };
  assert.throws(() => api.initializeFigureWorkspaceDraftState(options),
    { code: 'FIGURE_WORKSPACE_BINDING_MISMATCH' });
});

test('a successfully saved new binding reopens cleanly without repeated writes', () => {
  const current = { ...binding, documentHash: 'd'.repeat(64) };
  const state = api.initializeFigureWorkspaceDraftState({
    binding: current, durableAsset: asset(), inventory, allowDocumentRevisionUpdate: true
  });
  const reopened = api.initializeFigureWorkspaceDraftState({
    binding: current, inventory, allowDocumentRevisionUpdate: true,
    durableAsset: { content: state.draft, revision: 8, contentHash: 'saved' }
  });
  assert.equal(reopened.dirty, false);
  assert.deepEqual(reopened.draft, state.draft);
});
