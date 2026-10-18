'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { harness, plain, content, functionSource } = require('./helpers/r29-figure-binding-harness.js');
const figureApi = require('../core/figure-extractor.js');
const archiveApi = require('../core/article-archive.js');

// Actual extractor, guards and workspace draft/CAS code. Image and persistence
// transport boundaries are deterministic; this does not stand for live Edge QA.
test('R33 unrelated paragraph insertion preserves the bound evidence and permits the same Figure commit', async () => {
  const h = harness();
  const binding = await h.start();
  const original = plain(h.state.figure.contextParagraphs);
  await h.checkpoint();
  h.addUnrelatedParagraph(); h.setClock(126000);
  await h.c.verifyLiveFigureRetryInput(h.state, h.state.figureInputHash, h.admission, 'figure_walkthrough');
  assert.deepEqual(plain(h.state.figure.contextParagraphs), original,
    'model evidence IDs and exact text must stay bound to the original request');
  await h.c.mergeCompletedFigureResultIntoWorkspaceDraft(h.state.figure, h.result, {
    expectedInputHash: h.state.figureInputHash,
    preCommit: () => h.c.assertFigureRetryCommitBinding(h.state, h.state.figureInputHash, binding.liveRevision, 4)
  });
  assert.equal(h.events.some(event => event.kind === 'whole-figure-committed'), true);
});

for (const [name, mutate] of [
  ['caption', h => h.alterCaption()],
  ['body text', h => h.changeContext()],
  ['Panel inventory', h => h.changePanels()],
  ['pixels', h => h.changePixels()],
  ['source fingerprint', h => h.changeSourceFingerprint()]
]) test(`R33 relocation tolerance still rejects changed ${name}`, async () => {
  const h = harness(); await h.start(); await h.checkpoint();
  h.addUnrelatedParagraph(); h.setClock(126000); mutate(h);
  await assert.rejects(h.c.verifyLiveFigureRetryInput(h.state, h.state.figureInputHash,
    h.admission, 'figure_walkthrough'), { code: 'FIGURE_PANEL_RETRY_SCOPE_STALE' });
  assert.equal(h.events.some(event => event.kind === 'whole-figure-committed'), false);
});

test('R33 context relocation maps unique exact evidence while preserving request paragraph IDs', () => {
  const before = [{ paragraphId: 'p1', sectionTitle: 'Results', text: 'Figure 1 shows A.' }];
  const after = [{ paragraphId: 'p2', sectionTitle: 'Results', text: 'Figure 1 shows A.' }];
  const rebound = figureApi.rebindFigureContextLocators?.(before, after);
  assert.deepEqual(rebound, { paragraphs: before, locators: [{ paragraphId: 'p1', liveParagraphId: 'p2' }] });
  assert.equal(after[0].paragraphId, 'p2');
});

for (const [name, rows] of [
  ['changed text', [{ paragraphId: 'p2', sectionTitle: 'Results', text: 'Figure 1 shows B.' }]],
  ['changed section', [{ paragraphId: 'p2', sectionTitle: 'Discussion', text: 'Figure 1 shows A.' }]],
  ['duplicated text', [
    { paragraphId: 'p2', sectionTitle: 'Results', text: 'Figure 1 shows A.' },
    { paragraphId: 'p3', sectionTitle: 'Results', text: 'Figure 1 shows A.' }
  ]],
  ['missing text', []]
]) test(`R33 context relocation refuses ${name}`, () => {
  const before = [{ paragraphId: 'p1', sectionTitle: 'Results', text: 'Figure 1 shows A.' }];
  assert.equal(figureApi.rebindFigureContextLocators?.(before, rows), null);
});

for (const ambiguous of [false, true]) test(`R33 old paragraph source ${ambiguous ? 'refuses ambiguous source text' : 'focuses the unique original evidence after locator movement'}`, async () => {
  const h = harness(); await h.start();
  const evidence = plain(h.state.figure.contextParagraphs[0]);
  h.addUnrelatedParagraph(); h.setClock(126000);
  const rows = plain(h.c.extractArticleWithTrace('relocation-focus'));
  const records = rows.map(row => ({ ...row, anchor: { text: row.text, paragraphId: row.paragraphId } }));
  if (ambiguous) records.push({ ...records[1], paragraphId: 'other-same-evidence' });
  const focused = [];
  Object.assign(h.c, {
    findFigureAnalysisTarget: () => h.state.figure,
    currentArticleStructure: { paragraphs: records },
    extractCurrentArticleStructure: () => ({ paragraphs: records }),
    resolveWorkspaceParagraph: target => records.find(row => row.paragraphId === target.paragraphId),
    focusArticleSource: anchor => { focused.push(anchor.text); return true; },
    focusArticleSourceQuote: anchor => { focused.push(anchor.text); return true; }
  });
  vm.runInContext(functionSource(content, 'focusFigureFollowupParagraphSource'), h.c);
  const result = await h.c.focusFigureFollowupParagraphSource({ figureId: h.state.figure.figureId,
    paragraphId: evidence.paragraphId });
  assert.equal(result, !ambiguous);
  assert.deepEqual(focused, ambiguous ? [] : [evidence.text]);
});

for (const matchingHash of [true, false]) test(`R33 JSON-restored evidence context ${matchingHash ? 'retains request IDs' : 'cannot claim a different input binding'}`, async () => {
  const h = harness(); await h.start();
  const original = plain(h.state.figure.contextParagraphs);
  const saved = plain({ figures: [{ figureId: h.state.figure.figureId,
    figureInputHash: h.state.figureInputHash,
    figureEvidenceContext: { ...h.state.figureEvidenceContext,
      inputHash: matchingHash ? h.state.figureInputHash : 'another-input' } }] });
  h.c.figureWalkthroughState.clear(); h.c.restoredFigureWorkspaceSnapshot = saved;
  h.addUnrelatedParagraph(); h.setClock(126000);
  const current = h.c.getFigureWorkspaceInventory({ forceRefresh: true })[0];
  if (matchingHash) assert.deepEqual(plain(current.contextParagraphs), original);
  else assert.notEqual(current.contextParagraphs[0].paragraphId, original[0].paragraphId);
});

test('R33 immutable verified evidence snapshot survives a subsequent genuine input rejection', async () => {
  const h = harness(); await h.start();
  const evidence = plain(h.state.figureEvidenceContext);
  assert.equal(Object.isFrozen(h.state.figureEvidenceContext.paragraphs[0]), true);
  h.changeContext();
  await assert.rejects(h.c.verifyLiveFigureRetryInput(h.state, h.state.figureInputHash, h.admission,
    'figure_walkthrough'), { code: 'FIGURE_PANEL_RETRY_SCOPE_STALE' });
  assert.deepEqual(plain(h.state.figureEvidenceContext), evidence);
});

test('R33 equal-length duplicate evidence and evidence reordering are ambiguous', () => {
  const a = { paragraphId: 'p1', sectionTitle: 'Results', text: 'Figure 1 shows A.' };
  const b = { paragraphId: 'p2', sectionTitle: 'Results', text: 'Figure 1 shows B.' };
  assert.equal(figureApi.rebindFigureContextLocators([a, { ...a, paragraphId: 'p3' }],
    [{ ...a, paragraphId: 'p4' }, { ...a, paragraphId: 'p5' }]), null);
  assert.equal(figureApi.rebindFigureContextLocators([a, b],
    [{ ...b, paragraphId: 'p3' }, { ...a, paragraphId: 'p4' }]), null);
});

for (const input of [
  { text: 'Figure 1 shows A;the full source stays exact;', sectionTitle: 'Results;Evidence' },
  { text: 'Figure 1 shows Ａ and its measurement.', sectionTitle: 'Results' }
]) test(`R33 actual portable archive preserves safe exact evidence ${input.text}`, () => {
  const evidence = { inputHash: 'r29-evidence-v8:12345678', paragraphs: [
    { paragraphId: 'p1', ...input }
  ] };
  const archive = archiveApi.createArticleArchive({
    identity: { documentId: 'r33-archive-evidence', documentHash: 'same-source', canonicalUrl: 'https://offline.example/article' },
    documentRecord: { documentId: 'r33-archive-evidence', documentHash: 'same-source' },
    workspace: { figureWorkspace: { figures: [{ figureId: 'figure-1',
      figureInputHash: evidence.inputHash, figureEvidenceContext: evidence }] } }
  });
  const restored = archiveApi.validateArticleArchive(JSON.parse(JSON.stringify(archive)));
  assert.deepEqual(restored.workspace.figureWorkspace.figures[0].figureEvidenceContext, evidence);
});

test('R33 portable exact evidence does not restore stripped authorization credentials', () => {
  const archive = archiveApi.createArticleArchive({
    identity: { documentId: 'r33-private-evidence', documentHash: 'same-source', canonicalUrl: 'https://offline.example/article' },
    documentRecord: { documentId: 'r33-private-evidence', documentHash: 'same-source' },
    workspace: { figureWorkspace: { figures: [{ figureId: 'figure-1', figureInputHash: 'bound',
      figureEvidenceContext: { inputHash: 'bound', paragraphs: [{ paragraphId: 'p1', sectionTitle: 'Results',
        text: 'Figure 1; Authorization: Bearer synthetic-secret-token-12345' }] } }] } }
  });
  assert.doesNotMatch(JSON.stringify(archive), /synthetic-secret-token-12345/);
});

test('R33 actual partial checkpoint CAS saves bound evidence atomically and cold inventory can rebind it', async () => {
  const h = harness(); await h.start();
  const original = plain(h.state.figure.contextParagraphs);
  const snapshot = h.c.buildFigureWorkspaceSnapshot;
  h.c.buildFigureWorkspaceSnapshot = () => {
    const value = snapshot();
    value.figures[0].figureEvidenceContext = plain(h.state.figureEvidenceContext);
    return value;
  };
  assert.equal((await h.checkpoint()).savedPanelCount, 3);
  const saved = plain(h.assets.get('figures/inventory.json').content);
  assert.deepEqual(saved.figures[0].figureEvidenceContext, plain(h.state.figureEvidenceContext));
  h.c.figureWalkthroughState.clear(); h.c.restoredFigureWorkspaceSnapshot = saved;
  h.addUnrelatedParagraph(); h.setClock(126000);
  assert.deepEqual(plain(h.c.getFigureWorkspaceInventory({ forceRefresh: true })[0].contextParagraphs), original);
});

test('R33 stale generic snapshot cannot replace the inputHash or evidence attached to a partial checkpoint', async () => {
  const h = harness(); await h.start();
  const snapshot = h.c.buildFigureWorkspaceSnapshot;
  h.c.buildFigureWorkspaceSnapshot = () => {
    const value = snapshot(); value.figures[0].figureEvidenceContext = plain(h.state.figureEvidenceContext); return value;
  };
  await h.checkpoint();
  const original = plain(h.assets.get('figures/inventory.json').content);
  const stale = plain(original);
  stale.figures[0].figureInputHash = 'stale-other-input'; stale.figures[0].figureEvidenceContext = null;
  await h.c.persistFigureInventoryWithCasMutation(stale);
  const saved = h.assets.get('figures/inventory.json').content.figures[0];
  assert.equal(saved.figureInputHash, original.figures[0].figureInputHash);
  assert.deepEqual(plain(saved.figureEvidenceContext), original.figures[0].figureEvidenceContext);
});

test('R33 actual batch extraction and state construction retain bound IDs and a resumable checkpoint', async () => {
  const h = harness(); Object.assign(h.c.SciLLM, require('../core/figure-result-binding.js'));
  await h.start(); await h.checkpoint();
  const oldHash = h.state.figureInputHash, original = plain(h.state.figure.contextParagraphs);
  h.addUnrelatedParagraph(); h.setClock(126000); h.c.restoredFigureWorkspaceSnapshot = null;
  const batch = content.indexOf('async function analyzeFiguresWithLLM');
  const extractStart = content.indexOf('const mainFigures = extractCurrentArticleFigures(extractedParagraphs);', batch);
  const extractEnd = content.indexOf('const workspace = await ensureCurrentArticleWorkspace();', extractStart);
  Object.assign(h.c, { originalBatchState: h.state });
  vm.runInContext(`(()=>{const previousFigureState=new Map(figureWalkthroughState),extractedParagraphs=extractArticleWithTrace('analyze_figures');
    ${content.slice(extractStart, extractEnd)}; batchFigure=mainFigures[0];})()`, h.c);
  const figure = h.c.batchFigure, prepared = await h.c.preparePdfFigureProductionInput(figure, h.admission);
  const hash = h.c.buildFigureInputHash(figure, prepared.images);
  assert.equal(hash, oldHash, 'rebind must happen before the batch computes its new request hash');
  const start = content.indexOf('figureWalkthroughState.set(figure.figureId, {', batch);
  const end = content.indexOf('\n                    });', start) + '\n                    });'.length;
  vm.runInContext(functionSource(content, 'figureResultInputHashesFromSources'), h.c);
  vm.runInContext(functionSource(content, 'selectFigureResumeCheckpoint'), h.c);
  h.c.batchHash = hash;
  vm.runInContext(`(()=>{const figure=batchFigure,figureInputHash=batchHash,previous=originalBatchState,restored=null,
    previousStandard=null,previousDeep=null,analysisDepth='deep',followupCollections={panelFollowups:{},panelFollowupHistories:{}};
    ${content.slice(start, end)}})()`, h.c);
  const state = h.c.figureWalkthroughState.get(figure.figureId);
  assert.deepEqual(plain(state.figureEvidenceContext), plain(h.state.figureEvidenceContext));
  assert.ok(h.c.selectFigureResumeCheckpoint(state, 'deep', oldHash, hash));
  await h.c.verifyLiveFigureRetryInput(state, hash, h.admission, 'figure_walkthrough', prepared.images);
  assert.deepEqual(plain(state.figure.contextParagraphs), original);
});

test('R33 checkpoint completion carries its evidence companion and explicit reset clears it', async () => {
  const h = harness(); await h.start();
  const snapshot = h.c.buildFigureWorkspaceSnapshot;
  h.c.buildFigureWorkspaceSnapshot = () => {
    const value = snapshot(); value.figures[0].figureEvidenceContext = plain(h.state.figureEvidenceContext); return value;
  };
  await h.checkpoint();
  let disk = plain(h.assets.get('figures/inventory.json'));
  const incoming = plain(disk.content), row = incoming.figures[0];
  const envelope = row.pendingDeepCheckpointEnvelope;
  // This fixture exercises content CAS, whose completed checkpoint contract
  // requires the immutable Panel plan (provider signatures are a separate layer).
  envelope.operationPlan = [{ figureId: row.figureId, panelCount: 3 }];
  disk.content.figures[0].pendingDeepCheckpointEnvelope.operationPlan = plain(envelope.operationPlan);
  row.deep = { ...h.result, operationId: h.operation.operationId }; row.modelDeep = row.deep;
  row.analysisStatus = 'complete'; row.activeDepth = 'deep';
  const io = { getAssetCheckpoint: async () => disk,
    persistAssetCheckpoint: async (_path, content, options) => {
      assert.equal(options.expectedRevision, disk.revision);
      disk = { revision: disk.revision + 1, contentHash: 'f'.repeat(64), content: plain(content) };
      return { saved: true, asset: disk };
    } };
  await h.c.persistFigureInventoryWithCasMutation(incoming, { ...io,
    figureId: row.figureId, analysisDepth: 'deep', operationId: h.operation.operationId,
    clearCheckpointEnvelope: envelope });
  assert.deepEqual(disk.content.figures[0].figureEvidenceContext, plain(h.state.figureEvidenceContext));
  assert.equal(disk.content.figures[0].pendingDeepCheckpointEnvelope, undefined);
  const stale = plain(incoming);
  stale.figures[0].figureInputHash = 'other-input'; stale.figures[0].figureEvidenceContext = null;
  await h.c.persistFigureInventoryWithCasMutation(stale, io);
  assert.deepEqual(disk.content.figures[0].figureEvidenceContext, plain(h.state.figureEvidenceContext));
  await h.c.persistFigureInventoryWithCasMutation(disk.content, { ...io,
    figureId: row.figureId, analysisDepth: 'deep', resetFigureAnalysis: true });
  assert.equal(disk.content.figures[0].figureEvidenceContext, undefined);
  assert.equal(disk.content.figures[0].deep, undefined);
});

test('R33 malformed evidence cannot be paired with another inputHash by generic CAS', async () => {
  const h = harness(); await h.start();
  const inventory = { figures: [{ figureId: h.state.figure.figureId, figureInputHash: 'new-input',
    figureEvidenceContext: plain(h.state.figureEvidenceContext) }] };
  await assert.rejects(h.c.persistFigureInventoryWithCasMutation(inventory), { code: 'FIGURE_CHECKPOINT_CONFLICT' });
  assert.equal(h.assets.size, 0);
});

for (const status of ['complete', 'partial']) test(`R33 legacy ${status} generic CAS cannot attach evidence for a different protected input`, async () => {
  const h = harness(); await h.start();
  if (status === 'partial') await h.checkpoint();
  const oldHash = h.state.figureInputHash;
  const durable = status === 'partial' ? plain(h.assets.get('figures/inventory.json').content) : {
    schemaVersion: 1, figures: [{ figureId: h.state.figure.figureId,
      figureInputHash: oldHash, deep: plain(h.result) }]
  };
  delete durable.figures[0].figureEvidenceContext;
  const original = plain(durable.figures[0]);
  const incoming = plain(durable);
  incoming.figures[0].figureInputHash = 'r29-evidence-v8:12345678';
  incoming.figures[0].figureEvidenceContext = { ...plain(h.state.figureEvidenceContext),
    inputHash: incoming.figures[0].figureInputHash };
  let saved;
  await h.c.persistFigureInventoryWithCasMutation(incoming, {
    getAssetCheckpoint: async () => ({ revision: 1, contentHash: 'old-content', content: durable }),
    persistAssetCheckpoint: async (_path, value) => {
      saved = plain(value); return { saved: true, asset: { revision: 2, contentHash: 'new-content' } };
    }
  });
  assert.equal(saved.figures[0].figureInputHash, oldHash);
  assert.equal(saved.figures[0].figureEvidenceContext, undefined);
  assert.deepEqual(saved.figures[0].deep, original.deep);
  assert.deepEqual(saved.figures[0].pendingDeepCheckpointEnvelope, original.pendingDeepCheckpointEnvelope);
});
