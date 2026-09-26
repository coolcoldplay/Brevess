const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MechanismNetwork = require('../core/mechanism-network.js');
const FigureWorkspace = require('../core/figure-workspace.js');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function extractMarkedSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return source.slice(start + startMarker.length, end).trim();
}

const readerFiles = [
  'pdf-reader.html',
  'pdf-reader.js',
  'pdf-reader.css',
  'offline-reader.html',
  'offline-reader.js',
  'offline-reader.css'
];

const actionPopupFiles = [
  'action-popup.html',
  'action-popup.js',
  'action-popup.css'
];

test('Edge store ZIP stages and verifies every PDF and offline reader entry point', async () => {
  const build = read('scripts/build-edge-store-release.ps1');
  const verify = read('scripts/verify-edge-store-release.ps1');
  const { releaseInventory } = await import('../scripts/release-inventory.mjs');
  const shipped = new Set(releaseInventory(root, 'store').map(entry => entry.path));
  assert.match(build, /Copy-BrevessReleaseFiles[^\r\n]+-Profile store/);

  for (const filename of readerFiles) {
    assert.equal(shipped.has(filename), true,
      `${filename} must be copied into the store ZIP staging directory`);
    assert.equal(verify.includes(`'${filename}'`), true,
      `${filename} must be a required store ZIP member`);
  }
});

test('native Edge QA extension copies all reader entry points', () => {
  const qa = read('scripts/verify-native-side-panel-extension.js');
  const prepare = qa.slice(
    qa.indexOf('function prepareQaExtension()'),
    qa.indexOf('function articleFixture()')
  );

  for (const filename of readerFiles) {
    assert.equal(prepare.includes(`'${filename}'`), true, filename);
  }
});

test('release and native Edge QA package the deliberate action popup', async () => {
  const build = read('scripts/build-edge-store-release.ps1');
  const { releaseInventory } = await import('../scripts/release-inventory.mjs');
  const shipped = new Set(releaseInventory(root, 'store').map(entry => entry.path));
  assert.match(build, /Copy-BrevessReleaseFiles[^\r\n]+-Profile store/);
  const verify = read('scripts/verify-edge-store-release.ps1');
  const qa = read('scripts/verify-native-side-panel-extension.js');
  const prepare = qa.slice(
    qa.indexOf('function prepareQaExtension()'),
    qa.indexOf('function articleFixture()')
  );

  for (const filename of actionPopupFiles) {
    assert.equal(shipped.has(filename), true, filename);
    assert.equal(verify.includes(`'${filename}'`), true, filename);
    assert.equal(prepare.includes(`'${filename}'`), true, filename);
  }
});

test('native Edge QA validates automatic token policy without removed manual-token DOM', () => {
  const qa = read('scripts/verify-native-side-panel-extension.js');
  for (const removedId of [
    'tokenModeManual',
    'manualMaxTokens',
    'manualMaxTokensField',
    'tokenModeAuto',
    'autoTokenCap',
    'autoTokenCapField'
  ]) {
    assert.doesNotMatch(qa, new RegExp(`#?${removedId}`));
  }
  assert.match(qa, /tokenPolicy\?\.mode\s*\|\|\s*''/);
  assert.match(qa, /tokenPolicy\?\.manualMax\s*\?\?\s*null/);
  assert.match(qa, /tokenPolicy\?\.autoCap\s*\?\?\s*null/);
});

test('native Edge QA restores its figure fixture through the authorized archive workflow', () => {
  const qa = read('scripts/verify-native-side-panel-extension.js');
  const fixtureRestore = qa.slice(
    qa.indexOf('archive.workspace.figureWorkspace = figureWorkspaceFixture()'),
    qa.indexOf('const figureIncrementalQa =', qa.indexOf(
      'archive.workspace.figureWorkspace = figureWorkspaceFixture()'
    ))
  );

  assert.match(fixtureRestore, /applyLoadedArticleArchive\(value/);
  assert.doesNotMatch(
    fixtureRestore,
    /chrome\.tabs\.sendMessage[\s\S]*action:\s*'applyArticleArchiveSnapshot'/
  );
});

test('native Edge QA separates all-figure mechanism synthesis from paper-level extraction', () => {
  const qa = read('scripts/verify-native-side-panel-extension.js');
  const allFiguresFlow = qa.slice(
    qa.indexOf("locator('#analyzeFiguresFromFigures').click()"),
    qa.indexOf("locator('.workspace-paragraph-summary-action')")
  );

  assert.doesNotMatch(qa, /locator\('#analyzeCrossFigureLogic'\)/);
  assert.match(allFiguresFlow, /action === 'analyzeFiguresWithLLM'/);
  assert.match(allFiguresFlow, /action === 'analyzeCrossFigureLogicWithLLM'/);
  assert.match(allFiguresFlow, /mechanismViewVisible/);
  assert.match(allFiguresFlow, /提取研究背景与科学问题/);
  assert.match(allFiguresFlow, /提取创新点/);
  assert.match(allFiguresFlow, /提取研究局限/);
  assert.match(allFiguresFlow, /researchLogicTabs/);
  assert.match(allFiguresFlow, /atomicEvidenceCalls = researchProviderStageCalls/);
  assert.match(qa, /paperMetaExtractionQa\.atomicEvidenceCalls === 1/);
  assert.match(allFiguresFlow, /workspace-research-logic-qa\.png/);
});

test('native Edge QA follows the retained per-paragraph summary action', () => {
  const qa = read('scripts/verify-native-side-panel-extension.js');

  assert.doesNotMatch(qa, /locator\('#generateOutlineSummaries'\)/);
  assert.match(qa, /workspace-tree-toggle\[aria-label\*="段落摘要"\]/);
  assert.match(qa, /\.workspace-paragraph-summary-action/);
  assert.match(qa, /analyzeReviewParagraphWithLLM/);
  assert.match(qa, /globalGeneratorRemoved/);
});

test('native Edge QA Panel follow-up fixture follows the current cited-answer schema', () => {
  const qa = read('scripts/verify-native-side-panel-extension.js');
  const fixture = qa.slice(
    qa.indexOf('const panelUiFollowupOutput ='),
    qa.indexOf('const unlabeledFigureOutput =')
  );

  assert.match(fixture, /source_refs:\s*\[\{/);
  assert.match(fixture, /paragraph_id:\s*'panel-ui-r1'/);
  assert.match(fixture, /quote:\s*'Figure 78A compares the treated group/);
});

test('native Edge QA connection server implements the minimal connectivity probe contract', () => {
  const qa = read('scripts/verify-native-side-panel-extension.js');
  const providerServer = qa.slice(
    qa.indexOf('providerServer = http.createServer'),
    qa.indexOf('await new Promise((resolve, reject)', qa.indexOf(
      'providerServer = http.createServer'
    ))
  );

  assert.match(providerServer, /Minimal connectivity probe/);
  assert.match(providerServer, /Reply with exactly OK/);
  assert.match(providerServer, /content:\s*isConnectivityProbe \? 'OK'/);
  assert.match(qa, /providerRequestQa\.connectivityPromptPresent/);
  assert.match(qa, /providerRequestQa\.streamingRequested/);
  assert.doesNotMatch(qa, /providerRequestQa\.syntheticPromptPresent/);
});

test('native Edge QA follows the current figure and mechanism visual contracts', () => {
  const qa = read('scripts/verify-native-side-panel-extension.js');

  assert.doesNotMatch(qa, /locator\('#analyzeCrossFigureLogic'\)/);
  assert.match(qa, /activated\.viewCount === 6/);
  assert.match(qa, /panelOrder\.join\('\|'\) === '1A\|1B\|1C'/);
  assert.match(qa, /\.workspace-figure-field, \.workspace-panel-input-basis/);
  assert.match(qa, /inputBasisDetails\.some\(item => item\.visible/);
  assert.match(qa, /inputBasis = answer\?\.querySelector\('\.workspace-panel-input-basis'\)/);
  assert.match(qa, /panelFollowupAnswerQa\.inputBasisVisible/);
  assert.match(qa, /mechanismViewVisible/);
  assert.match(qa, /mechanism_chain:\s*\[\{/);
  assert.match(qa, /type:\s*'LLM_SAVE_PROFILE'/);
  assert.match(qa, /crossFigureProviderRequestCount/);
  assert.match(qa, /\.workspace-mechanism-mermaid g\.node/);
  assert.match(qa, /\.workspace-mechanism-mermaid path\.flowchart-link/);
  assert.match(qa, /\.workspace-mechanism-matrix-evidence/);
  assert.match(qa, /evidenceMatrixVisible/);
  assert.match(qa, /mechanismNodes >= 2/);
  assert.match(qa, /mechanismEdges >= 1/);
  assert.match(qa, /unlabeledSingleFigureQa\.ui\.overviewFields >= 3/);
  assert.match(qa, /unlabeledSingleFigureQa\.persisted\.argumentSteps === 1/);
});

test('real-paper visual QA exercises all-figures synthesis without a legacy mechanism button', () => {
  const qa = read('scripts/capture-figure-workspace-qa.mjs');

  assert.doesNotMatch(qa, /locator\('#analyzeCrossFigureLogic'\)/);
  assert.match(qa, /locator\('#analyzeFiguresFromFigures'\)\.click\(\)/);
  assert.match(qa, /kind:\s*'cross-figure'/);
  assert.match(qa, /autoSynthesis\?\.backgroundItems >= 1/);
  assert.match(qa, /autoSynthesis\?\.scientificQuestions >= 1/);
  assert.match(qa, /autoSynthesis\?\.innovationPoints >= 1/);
  assert.match(qa, /autoSynthesis\?\.limitationPoints >= 1/);
  assert.match(qa, /locator\('\.workspace-logic-map-open'\)\.click\(\)/);
});

test('real-paper visual QA imports its exact canonical mechanism workspace v2 fixture', () => {
  const qa = read('scripts/capture-figure-workspace-qa.mjs');
  const factorySource = extractMarkedSource(
    qa,
    '// BEGIN CANONICAL_MECHANISM_QA_FIXTURE',
    '// END CANONICAL_MECHANISM_QA_FIXTURE'
  );
  assert.equal(
    qa.includes('panel.evaluate(createCanonicalMechanismQaFixture, { s1Id, s2Id })'),
    true,
    'the browser path must execute the same extracted fixture factory'
  );

  const s1Id = 'supplement-s1';
  const s2Id = 'supplement-s2';
  const paper = {
    workspaceId: `workspace:${'a'.repeat(64)}`,
    workspaceGeneration: 4,
    canonicalUrl: 'https://example.test/paper',
    contentHash: 'b'.repeat(64),
    documentId: `sha256:${'c'.repeat(64)}`,
    title: 'Figure workspace QA paper'
  };
  const createFixture = Function(
    'SciLLM',
    'mechanismNetworkPaperIdentity',
    `'use strict';\n${factorySource}\nreturn createCanonicalMechanismQaFixture;`
  )(MechanismNetwork, () => paper);
  const jsonText = createFixture({ s1Id, s2Id });

  const payload = JSON.parse(jsonText);
  assert.equal(payload.schema, 'brevess.mechanism-network');
  assert.equal(payload.schemaVersion, 2);
  assert.equal(Object.hasOwn(payload.paper, 'canonicalUrl'), false);
  assert.equal(Object.hasOwn(payload.mechanismChain, 'layoutPreferences'), false);
  assert.deepEqual(payload.mechanismChain.panelAliases, {});
  assert.deepEqual(payload.mechanismChain.reviewTombstones, {
    nodes: [], edges: [], evidence: []
  });
  assert.equal(payload.mechanismChain.nodes.every(node =>
    typeof node.label?.humanReviewed === 'boolean' &&
    Number.isSafeInteger(node.label?.editedAt)), true);
  assert.equal(payload.mechanismChain.edges.every(edge =>
    typeof edge.label?.humanReviewed === 'boolean' &&
    Number.isSafeInteger(edge.label?.editedAt) &&
    typeof edge.humanReviewed === 'boolean' &&
    Number.isSafeInteger(edge.editedAt)), true);
  assert.equal(payload.mechanismChain.edges.flatMap(edge => edge.panelEvidence)
    .every(evidence => typeof evidence.unresolved === 'boolean' &&
      typeof evidence.humanReviewed === 'boolean' &&
      Number.isSafeInteger(evidence.editedAt)), true);

  const parsed = MechanismNetwork.parseMechanismNetworkJson(jsonText, paper);
  const draft = FigureWorkspace.createFigureWorkspaceDraft([
    { figureId: s1Id, figureLabel: 'Figure S1', panelHints: ['B'] },
    { figureId: s2Id, figureLabel: 'Figure S2', panelHints: ['A'] }
  ]);
  assert.equal(FigureWorkspace.validateMechanismWorkspaceImport(
    draft, parsed.mechanismChain, parsed.mechanismGeneration
  ), true);
  const imported = FigureWorkspace.applyFigureWorkspaceMutation(draft, {
    type: 'import_mechanism_workspace',
    expectedRevision: draft.revision,
    chain: parsed.mechanismChain,
    mechanismGeneration: parsed.mechanismGeneration
  }, 1000);
  assert.equal(imported.revision, draft.revision + 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(imported.mechanismChain)),
    parsed.mechanismChain
  );
});

test('visual QA checks offline-reading launch and settings header at desktop and narrow widths', () => {
  const qa = read('scripts/capture-ai-optional-reading-qa.mjs');

  assert.match(qa, /data-workspace-action="offline"/);
  assert.match(qa, /waitForEvent\('page'/);
  assert.match(qa, /offline-reader\.html/);
  for (const width of [1440, 1024, 600]) {
    assert.match(qa, new RegExp(`width:\\s*${width}`));
  }
  assert.match(qa, /headerOverflowX/);
  assert.match(qa, /returnControlWidthRatio/);
});

test('native Edge QA waits for the settings shortcut destination before parsing its URL', () => {
  const qa = read('scripts/verify-native-side-panel-extension.js');
  const shortcut = qa.slice(
    qa.indexOf("locator('#openSidePanelSettings').click()"),
    qa.indexOf("reportQaStage('all browser interactions completed")
  );

  assert.ok(shortcut.indexOf('waitForURL') < shortcut.indexOf('new URL'));
  assert.match(shortcut, /url\.pathname\.endsWith\('\/options\.html'\)/);
  assert.match(shortcut, /url\.hash === '#categoryWorkspace'/);
});

test('native Edge QA failure diagnostics inspect the final aggregate expression', () => {
  const qa = read('scripts/verify-native-side-panel-extension.js');

  assert.match(qa, /diagnosticBlockStart = qaSource\.indexOf/);
  assert.match(qa, /qaSource\.lastIndexOf\('\\n  const passed =\\n', diagnosticBlockStart\)/);
  assert.doesNotMatch(qa, /qaSource\.indexOf\('  const passed ='\)/);
});
