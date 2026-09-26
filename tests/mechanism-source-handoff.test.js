const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('../core/panel-ledger.js');
const { normalizeCrossFigureLogicInput } = require('../core/cross-figure-logic.js');
const { projectPanelAnalysisEvidence } = require('../core/evidence-first-mechanism.js');

function contentFigures(figures, states = new Map()) {
  const script = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
  const start = script.indexOf('function buildCrossFigureLogicInput()');
  const end = script.indexOf('\nfunction captureEvidenceFirstMechanismBinding', start);
  const context = { buildFigureWorkspaceSnapshot: () => ({ figures }),
    figureWalkthroughState: states, getActiveFigureAnalysisForDomino: state => state?.standard || null };
  vm.runInNewContext(`${script.slice(start, end)}; globalThis.result = buildCrossFigureLogicInput();`, context);
  // Chrome Messaging transfers plain JSON into the background realm.
  return JSON.parse(JSON.stringify(context.result));
}

test('actual content handoff retains Panel evidence for the production mechanism projector', () => {
  const labels = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
  const result = { analysisDepth: 'standard', figureQuestion: 'Does treatment restore the rhythm?',
    panels: labels.map(panel => ({ panel, purpose: 'Test the timed treatment',
      design: 'Compare vehicle and treatment at two circadian phases',
      comparison: 'Timed treatment versus vehicle',
      experimentalMethods: ['Bioluminescence recording'],
      directObservation: `Panel ${panel}: treatment increased oscillation amplitude`,
      observationSource: 'body_statement' })) };
  const figures = contentFigures([
    { figureId: 'figure-1', figureLabel: 'Figure 1', caption: 'Measured treatment response',
      activeDepth: 'standard', panelHints: labels, standard: result },
    { figureId: 'figure-2', figureLabel: 'Figure 2', caption: '(A) Control. (B) Treatment.',
      panelHints: ['A', 'B'], standard: null }
  ]);
  const input = normalizeCrossFigureLogicInput({ figures });
  assert.equal(input.panelLedger.entries.length, 28, 'unread panel identities also remain auditable');
  const byId = new Map(figures.map(figure => [figure.figureId, figure]));
  const projected = input.panelLedger.entries.map((entry, panelOrder) =>
    projectPanelAnalysisEvidence(byId.get(entry.figureId), { ...entry, panelOrder }));
  assert.equal(projected.filter(item => item.ok).length, 26);
  assert.equal(projected[0].projection.sourceAnalysis.directObservation, result.panels[0].directObservation);
  assert.equal(projected[0].projection.sourceAnalysis.experimentalMethods[0], 'Bioluminescence recording');
  assert.equal(projected.filter(item => !item.ok).length, 2, 'unread evidence is not fabricated');
});

test('mechanism source follows the displayed depth and retains independent Panel edits', () => {
  const figures = contentFigures([{ figureId: 'figure-1', figureLabel: 'Figure 1',
    caption: '(A) Control experiment.', activeDepth: 'deep', panelHints: ['A'],
    standard: { panels: [{ panel: 'A', directObservation: 'Old standard observation' }] },
    deep: { analysisDepth: 'deep', panels: [{ panel: 'A', directObservation: 'Deep observation' }] },
    panelAnalyses: { A: { panel: 'A', directObservation: 'User-visible Panel correction' } }
  }]);
  const input = normalizeCrossFigureLogicInput({ figures });
  const projected = projectPanelAnalysisEvidence(figures[0], { ...input.panelLedger.entries[0], panelOrder: 0 });
  assert.equal(projected.ok, true);
  assert.equal(projected.projection.sourceAnalysis.directObservation, 'User-visible Panel correction');
});

test('mechanism admission can use the live workspace document before annotation preparation', () => {
  const script = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
  const start = script.indexOf('function captureFigureWorkspaceEditContext()');
  const end = script.indexOf('\nfunction mechanismSnapshotMatchesContext', start);
  const context = {
    currentWorkspaceSnapshot: { documentId: 'sha256:live-document', documentHash: 'live-hash',
      url: 'https://www.cell.com/cell/fulltext/example',
      localWorkspace: { workspaceId: 'workspace:live', workspaceGeneration: 1, contentHash: 'body' },
      figures: { workspaceLifecycle: 4, draft: { revision: 9, mechanismChain: {} } } },
    preparedDocumentState: null, manualAnnotationState: {},
    activePanelTabContext: { tabId: 7, key: 'tab-7' },
    mechanismWorkspaceDraft: snapshot => snapshot.figures.draft,
    mechanismChainFingerprint: () => 'fingerprint'
  };
  vm.runInNewContext(`${script.slice(start, end)}; globalThis.captured = captureFigureWorkspaceEditContext();`, context);
  assert.equal(context.captured.documentId, 'sha256:live-document');
  assert.equal(context.captured.documentKey, 'live-hash');
  assert.equal(context.captured.draftRevision, 9);
  vm.runInNewContext('currentWorkspaceSnapshot.documentId = "sha256:next-document"; globalThis.stillCurrent = isCurrentFigureWorkspaceEditContext(captured);', context);
  assert.equal(context.stillCurrent, false, 'a real document change still invalidates generation');
});

test('content binding reads content-owned identity without depending on a popup-only global', () => {
  const script = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
  const start = script.indexOf('function captureEvidenceFirstMechanismBinding()');
  const end = script.indexOf('\nfunction invalidateCrossFigureLogic', start);
  const context = {
    figureWorkspaceDraft: { revision: 9, mechanismChain: {} },
    currentManualDocument: { documentId: 'sha256:live-document' },
    lastPreparedStudy: null,
    currentArticleWorkspace: { workspaceId: 'workspace:live', workspaceGeneration: 1 },
    articleWorkspaceLifecycleGeneration: 4,
    mechanismChainFingerprint: () => 'fingerprint'
  };
  vm.runInNewContext(`${script.slice(start, end)}; globalThis.binding = captureEvidenceFirstMechanismBinding();`, context);
  assert.equal(context.binding.documentId, 'sha256:live-document');
  assert.equal(context.binding.baseWorkspaceRevision, 9);
});
