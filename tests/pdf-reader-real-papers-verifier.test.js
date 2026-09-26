const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const verifierPath = path.join(root, 'scripts', 'verify-pdf-reader-real-papers.mjs');
const matrixPath = path.join(root, 'docs', 'qa', '2026-08-17-pdf-real-paper-matrix.md');

async function verifier() {
  return import(`${pathToFileURL(verifierPath).href}?test=${Date.now()}-${Math.random()}`);
}

test('verifier fixes the three private papers and two OA regressions', async () => {
  const { requiredPapers, publicRegressions, screenshotChecklist } = await verifier();
  assert.deepEqual(requiredPapers.map(({ key }) => key), [
    'neuron-2026-dopamine-circuits',
    'neuron-2020-hippocampal-ripples',
    'nat-neuro-2020-srpx2'
  ]);
  assert.deepEqual(publicRegressions.map(({ key, pmcid }) => ({ key, pmcid })), [
    { key: 'pmc12767537', pmcid: 'PMC12767537' },
    { key: 'pmc12167935', pmcid: 'PMC12167935' }
  ]);
  assert.ok(screenshotChecklist.includes('parsed-document.png'));
  assert.ok(screenshotChecklist.includes('native-document.png'));
});

test('native selection accepts only the production document structure hash shape', async () => {
  const { nativePdfDocumentHash } = await verifier();
  const hash = 'a'.repeat(64);
  const productionDocument = {
    structure: { documentHash: hash }, outline: [], pageCount: 18,
    focusPage: 7, phase: 'ready', documentGeneration: 3
  };
  assert.equal(nativePdfDocumentHash(productionDocument), hash);
  assert.equal(nativePdfDocumentHash({ documentHash: hash, outline: [], pageCount: 18 }), '');
  assert.equal(nativePdfDocumentHash({
    ...productionDocument, structure: { documentHash: 'not-a-sha256' }
  }), '');
});

test('paper audit requires every interaction, annotation export, and diagnostic gate', async () => {
  const { checkChecklist, auditPaperEvidence } = await verifier();
  const checks = Object.fromEntries(checkChecklist.map(name => [name, true]));
  assert.equal(auditPaperEvidence({ checks, unhandledErrors: 0 }).ok, true);
  for (const name of checkChecklist) {
    assert.equal(auditPaperEvidence({
      checks: { ...checks, [name]: false }, unhandledErrors: 0
    }).ok, false, name);
  }
  assert.equal(auditPaperEvidence({ checks, unhandledErrors: 1 }).ok, false);
});

test('toolbar captures require exact live 80% and 100% display readings', async () => {
  const { auditToolbarCaptures } = await verifier();
  assert.equal(auditToolbarCaptures([
    { filename: 'toolbar-80.png', requestedScale: 0.8, displayedValue: '80%' },
    { filename: 'toolbar-100.png', requestedScale: 1, displayedValue: '100%' },
    { filename: 'toolbar-fit-width.png', fitWidth: true, pageWidth: 930, containerWidth: 948 }
  ]).ok, true);
  assert.equal(auditToolbarCaptures([
    { filename: 'toolbar-80.png', requestedScale: 0.8, displayedValue: '90%' },
    { filename: 'toolbar-100.png', requestedScale: 1, displayedValue: '100%' },
    { filename: 'toolbar-fit-width.png', fitWidth: true, pageWidth: 930, containerWidth: 948 }
  ]).ok, false);
});

test('Neuron 2026 and OA typography regressions fail closed', async () => {
  const { auditLayoutRegression } = await verifier();
  const neuron = {
    referenceOrdinalsIncrease: true,
    figure7StatisticsNotDuplicatedAsBody: true,
    italicsPreserved: true,
    d1D2SuperscriptsPreserved: true,
    h2oSubscriptPreserved: true,
    overbarAndLegacyTexResolved: true
  };
  assert.equal(auditLayoutRegression('neuron-2026-dopamine-circuits', neuron).ok, true);
  assert.equal(auditLayoutRegression('neuron-2026-dopamine-circuits', {
    ...neuron, figure7StatisticsNotDuplicatedAsBody: false
  }).ok, false);
  assert.equal(auditLayoutRegression('pmc12767537', {
    parsedCaptionBoundariesPass: true, typographyPass: true
  }).ok, true);
  assert.equal(auditLayoutRegression('pmc12167935', {
    parsedCaptionBoundariesPass: true, typographyPass: false
  }).ok, false);
});

test('Figure 7 captures bind parsed and native views to one explicit target identity', async () => {
  const { auditFigureTargetCaptures } = await verifier();
  const target = { figureId: 'figure-7', pageNumber: 18, markerSha256: 'a'.repeat(64) };
  const captures = [
    { filename: 'figure7-parsed.png', mode: 'parsed', ...target,
      observedMarkerSha256: target.markerSha256, targetVisible: true, targetRect: { width: 100, height: 20 } },
    { filename: 'figure7-native.png', mode: 'native', ...target,
      observedMarkerSha256: target.markerSha256, targetVisible: true, targetRect: { width: 100, height: 20 } }
  ];
  assert.equal(auditFigureTargetCaptures(target, captures).ok, true);
  assert.equal(auditFigureTargetCaptures(target, [
    captures[0], { ...captures[1], pageNumber: 17 }
  ]).ok, false);
  assert.equal(auditFigureTargetCaptures(target, [
    captures[0], { ...captures[1], observedMarkerSha256: 'b'.repeat(64) }
  ]).ok, false);
});

test('native inspection binds every review to current screenshot bytes and dimensions', async () => {
  const { auditNativeInspection } = await verifier();
  const evidence = [{ filename: 'toolbar-80.png', sha256: 'a'.repeat(64), width: 1280, height: 1000 }];
  const inspection = { screenshots: { 'toolbar-80.png': {
    status: 'PASS', nativeResolution: true, observation: 'Toolbar is unclipped.',
    sha256: 'a'.repeat(64), width: 1280, height: 1000
  } } };
  assert.equal(auditNativeInspection(inspection, evidence).ok, true);
  assert.equal(auditNativeInspection({ screenshots: { 'toolbar-80.png': {
    ...inspection.screenshots['toolbar-80.png'], sha256: 'b'.repeat(64)
  } } }, evidence).ok, false);
});

test('external reader inspection is a separately bound second stage', async () => {
  const { auditExternalReaderInspection } = await verifier();
  const binding = {
    paperKey: 'nat-neuro-2020-srpx2', sourcePdfSha256: 'a'.repeat(64),
    annotatedPdfSha256: 'b'.repeat(64), annotationIdentitySha256: 'c'.repeat(64),
    pageCount: 19, annotationCount: 2
  };
  assert.equal(auditExternalReaderInspection({
    ...binding, status: 'PASS', openedOutsideExtension: true,
    allAnnotationsVisible: true, bodyReadable: true,
    observation: 'Independent reader shows the highlight and note.'
  }, binding).ok, true);
  assert.equal(auditExternalReaderInspection({
    ...binding, status: 'PASS', openedOutsideExtension: false,
    allAnnotationsVisible: true, bodyReadable: true, observation: 'Only plugin reopen.'
  }, binding).ok, false);
});

test('audit-existing binds reviews to one immutable capture without regenerating artifacts', async () => {
  const { buildCaptureArtifactHash, auditExistingCapture } = await verifier();
  const keys = [
    'neuron-2026-dopamine-circuits', 'neuron-2020-hippocampal-ripples',
    'nat-neuro-2020-srpx2', 'pmc12767537', 'pmc12167935'
  ];
  const paperArtifact = key => ({
    key, sourcePdfSha256: 'b'.repeat(64), annotatedPdfSha256: 'c'.repeat(64),
    pageCount: 12, annotationCount: 1, annotationIdentitySha256: 'd'.repeat(64),
    screenshots: [{ filename: 'native-document.png', sha256: 'e'.repeat(64), width: 1280, height: 1000 }]
  });
  const capture = {
    captureRunId: '11111111-1111-4111-8111-111111111111',
    extensionBuildSha256: 'a'.repeat(64),
    papers: keys.map(paperArtifact)
  };
  capture.artifactSha256 = buildCaptureArtifactHash(capture);
  assert.equal(auditExistingCapture(capture).ok, false,
    'one screenshot per paper is not a complete capture receipt');
  assert.equal(auditExistingCapture({
    ...capture, papers: [{ ...capture.papers[0], annotatedPdfSha256: 'f'.repeat(64) }, ...capture.papers.slice(1)]
  }).ok, false);
  const incomplete = { ...capture, papers: capture.papers.slice(0, 4) };
  incomplete.artifactSha256 = buildCaptureArtifactHash(incomplete);
  assert.equal(auditExistingCapture(incomplete).ok, false);
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.match(source, /--audit-existing/);
  assert.ok(source.indexOf('if (args.auditExisting)') < source.indexOf("await import('playwright')"));
});

test('grounded Q&A binds an explicit action and profile to this selection citation identity', async () => {
  const { auditGroundedSelectionQa } = await verifier();
  const expected = {
    actionId: 'ask-selection', profileId: 'profile-deepseek-v4',
    pageNumber: 7, sourceId: 'pdf-page-7', evidenceSha256: 'a'.repeat(64),
    selectionDocumentSha256: 'b'.repeat(64), clickedAt: 2000
  };
  const answer = { ...expected, startedAt: 2050, completedAt: 2100,
    operationId: 'qa-operation-7', answerText: 'Grounded answer.', citations: [{
    pageNumber: 7, sourceId: 'pdf-page-7', evidenceSha256: 'a'.repeat(64)
  }] };
  assert.equal(auditGroundedSelectionQa(expected, answer).ok, true);
  assert.equal(auditGroundedSelectionQa(expected, {
    ...answer, citations: [{ ...answer.citations[0], pageNumber: 8 }]
  }).ok, false);
  assert.equal(auditGroundedSelectionQa(expected, {
    ...answer, startedAt: 1999
  }).ok, false);
});

test('provider readiness is bound to a trusted profile fingerprint and live probe receipt', async () => {
  const { auditProviderProbe } = await verifier();
  const expected = { profileFingerprintSha256: 'a'.repeat(64),
    profileId: 'profile-live', providerId: 'deepseek' };
  assert.equal(auditProviderProbe(expected, {
    ...expected, ready: true, operationId: 'probe-operation-1', checkedAt: '2026-08-18T00:00:00.000Z'
  }).ok, true);
  assert.equal(auditProviderProbe(expected, {
    ...expected, ready: true, operationId: '', checkedAt: '2026-08-18T00:00:00.000Z'
  }).ok, false);
});

test('trusted profile is copied read-only, probed without SAVE or secret extraction, and cleaned', async () => {
  const { snapshotTrustedProfile, probeTrustedExistingProfile } = await verifier();
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-edge-profile-source-'));
  const storageDir = path.join(sourceDir, 'Default', 'Local Extension Settings', 'extension-id');
  fs.mkdirSync(storageDir, { recursive: true });
  const sourceFile = path.join(storageDir, '000003.log');
  fs.writeFileSync(sourceFile, 'existing encrypted extension storage', 'utf8');
  const sourceBefore = fs.readFileSync(sourceFile, 'utf8');
  const snapshot = snapshotTrustedProfile(sourceDir);
  try {
    assert.notEqual(snapshot.userDataDir, sourceDir);
    fs.writeFileSync(path.join(snapshot.userDataDir, 'copy-only.tmp'), 'browser mutation', 'utf8');
    assert.equal(fs.readFileSync(sourceFile, 'utf8'), sourceBefore);
    assert.equal(snapshot.verifySourceUnchanged(), true);
    const messages = [];
    const result = await probeTrustedExistingProfile(async message => {
      messages.push(message);
      if (message.type === 'LLM_GET_SETTINGS') return { success: true, data: { settings: {
        consentGranted: true, profiles: { 'profile-live': {
          id: 'profile-live', providerId: 'deepseek', config: { hasApiKey: true }
        } }
      } } };
      return { success: true, data: {
        connected: true, profileId: 'profile-live', providerId: 'deepseek',
        probes: message.probeIds.map(id => ({ id, status: 'passed' }))
      } };
    }, { profileId: 'profile-live', providerId: 'deepseek', probeIds: ['structured_schema'] });
    assert.equal(result.ready, true);
    assert.deepEqual(messages.map(message => message.type), ['LLM_GET_SETTINGS', 'LLM_TEST_PROFILE']);
    assert.equal(JSON.stringify(messages).includes('apiKey'), false);
    await assert.rejects(probeTrustedExistingProfile(async () => ({ success: true, data: {
      settings: { consentGranted: false, profiles: { 'profile-live': {
        id: 'profile-live', providerId: 'deepseek'
      } } }
    } }), { profileId: 'profile-live', providerId: 'deepseek' }), /PENDING_EXTERNAL_INPUT/);
  } finally {
    snapshot.cleanup();
    assert.equal(fs.existsSync(snapshot.tempRoot), false);
    assert.equal(fs.readFileSync(sourceFile, 'utf8'), sourceBefore);
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('trusted profile rejects empty and whitespace-only input before resolving the cwd', async () => {
  const { snapshotTrustedProfile } = await verifier();
  const previousCwd = process.cwd();
  const tinyCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-edge-profile-empty-input-'));
  fs.writeFileSync(path.join(tinyCwd, 'must-not-be-copied.txt'), 'cwd is not a trusted profile', 'utf8');
  const unexpectedSnapshots = [];
  try {
    process.chdir(tinyCwd);
    for (const value of ['', '   \t\r\n', null, undefined]) {
      assert.throws(() => {
        const snapshot = snapshotTrustedProfile(value);
        unexpectedSnapshots.push(snapshot);
      }, /trusted profile path is empty/i);
    }
  } finally {
    process.chdir(previousCwd);
    for (const snapshot of unexpectedSnapshots) snapshot.cleanup();
    fs.rmSync(tinyCwd, { recursive: true, force: true });
  }
});

test('trusted profile rejects a changed temporary copy and removes it before returning', async () => {
  const { snapshotTrustedProfile } = await verifier();
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-edge-profile-copy-mismatch-'));
  fs.mkdirSync(path.join(sourceDir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'Default', 'Preferences'), '{"safe":true}', 'utf8');
  let copiedUserDataDir = '';
  let temporaryRoot = '';
  let unexpectedSnapshot;
  try {
    assert.throws(() => {
      unexpectedSnapshot = snapshotTrustedProfile(sourceDir, {
        copyDirectory: (source, destination) => {
          copiedUserDataDir = destination;
          temporaryRoot = path.dirname(destination);
          fs.cpSync(source, destination, { recursive: true, errorOnExist: true });
          fs.writeFileSync(path.join(destination, 'Default', 'Preferences'), '{"safe":false}', 'utf8');
        }
      });
    }, /trusted profile copy fingerprint mismatch/i);
    assert.notEqual(copiedUserDataDir, '', 'the test must exercise a completed real directory copy');
    assert.equal(fs.existsSync(temporaryRoot), false,
      'a mismatched temporary profile must be removed before the verifier fails');
  } finally {
    try { unexpectedSnapshot?.cleanup(); } catch { /* expected only from the vulnerable implementation */ }
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('trusted profile rejects source changes during a real copy and removes the temporary copy', async () => {
  const { snapshotTrustedProfile } = await verifier();
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-edge-profile-source-race-'));
  const sourceFile = path.join(sourceDir, 'Default', 'Preferences');
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.writeFileSync(sourceFile, '{"version":1}', 'utf8');
  let temporaryRoot = '';
  let unexpectedSnapshot;
  try {
    assert.throws(() => {
      unexpectedSnapshot = snapshotTrustedProfile(sourceDir, {
        copyDirectory: (source, destination) => {
          temporaryRoot = path.dirname(destination);
          fs.cpSync(source, destination, { recursive: true, errorOnExist: true });
          fs.writeFileSync(sourceFile, '{"version":2}', 'utf8');
        }
      });
    }, /trusted profile source changed during copy/i);
    assert.notEqual(temporaryRoot, '', 'the test must complete a real directory copy');
    assert.equal(fs.existsSync(temporaryRoot), false,
      'a source race must remove the temporary profile before failing');
  } finally {
    try { unexpectedSnapshot?.cleanup(); } catch { /* expected only from the vulnerable implementation */ }
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('trusted profile root rejects a real directory symlink or junction before traversal', async () => {
  const { snapshotTrustedProfile } = await verifier();
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-edge-profile-root-link-'));
  const targetDir = path.join(testRoot, 'real-profile');
  const linkedDir = path.join(testRoot, 'linked-profile');
  fs.mkdirSync(path.join(targetDir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'Default', 'Preferences'), '{}', 'utf8');
  try {
    fs.symlinkSync(targetDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(fs.lstatSync(linkedDir).isSymbolicLink(), true,
      'test fixture must be a real filesystem link, not a mocked directory');
    assert.throws(() => snapshotTrustedProfile(linkedDir), /trusted profile (?:root )?(?:symlink|link)/i);
  } finally {
    fs.rmSync(linkedDir, { recursive: true, force: true });
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

test('trusted profile traversal continues to reject a real internal directory link', async () => {
  const { snapshotTrustedProfile } = await verifier();
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-edge-profile-internal-link-'));
  const sourceDir = path.join(testRoot, 'profile');
  const externalDir = path.join(testRoot, 'external-data');
  const linkedDir = path.join(sourceDir, 'Default', 'linked-data');
  fs.mkdirSync(path.dirname(linkedDir), { recursive: true });
  fs.mkdirSync(externalDir, { recursive: true });
  fs.writeFileSync(path.join(externalDir, 'secret.txt'), 'must not be traversed', 'utf8');
  try {
    fs.symlinkSync(externalDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(fs.lstatSync(linkedDir).isSymbolicLink(), true,
      'test fixture must be a real filesystem link, not a mocked directory');
    assert.throws(() => snapshotTrustedProfile(sourceDir), /trusted profile symlink is not allowed/i);
  } finally {
    fs.rmSync(linkedDir, { recursive: true, force: true });
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

test('provider provisioning uses an extension control page, never a worker self-send', async () => {
  const { probeTrustedExistingProfile } = await verifier();
  const profile = { id: 'profile-live', providerId: 'deepseek' };
  await assert.rejects(probeTrustedExistingProfile(async () => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  }, { profileId: profile.id, providerId: profile.providerId }), /Receiving end does not exist/,
  'a service worker self-send has no receiving background endpoint');
  const messages = [];
  const provisioned = await probeTrustedExistingProfile(async message => {
    messages.push(message);
    return message.type === 'LLM_GET_SETTINGS'
      ? { success: true, data: { settings: { consentGranted: true, profiles: {
        [profile.id]: { ...profile, config: { hasApiKey: true } }
      } } } }
      : { success: true, data: {
        connected: true, profileId: profile.id, providerId: profile.providerId,
        probes: message.probeIds.map(id => ({ id, status: 'passed' }))
      } };
  }, { profileId: profile.id, providerId: profile.providerId, probeIds: ['structured_schema'] });
  assert.equal(provisioned.ready, true);
  assert.deepEqual(messages.map(message => message.type), ['LLM_GET_SETTINGS', 'LLM_TEST_PROFILE']);
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.doesNotMatch(source, /workers\[0\]\.evaluate/);
  assert.doesNotMatch(source, /LLM_SAVE_PROFILE/);
  assert.match(source, /chrome-extension:\/\/\$\{extensionId\}\/options\.html/);
  assert.match(source, /sendFromControlPage[\s\S]{0,1200}probeTrustedExistingProfile\(\s*sendFromControlPage/);
});

test('trusted profile readiness requires connected true and every requested probe passed', async () => {
  const { probeTrustedExistingProfile } = await verifier();
  const expected = {
    profileId: 'profile-live', providerId: 'deepseek',
    probeIds: ['connectivity', 'structured_schema']
  };
  const settings = { success: true, data: { settings: {
    consentGranted: true, profiles: { 'profile-live': {
      id: 'profile-live', providerId: 'deepseek', config: { hasApiKey: true }
    } }
  } } };
  const invoke = testData => probeTrustedExistingProfile(async message =>
    message.type === 'LLM_GET_SETTINGS' ? settings : { success: true, data: testData }, expected);
  assert.equal((await invoke({
    connected: true, profileId: 'profile-live', providerId: 'deepseek',
    probes: [
      { id: 'connectivity', status: 'passed' },
      { id: 'structured_schema', status: 'passed' }
    ]
  })).ready, true);
  await assert.rejects(invoke({
    connected: false, profileId: 'profile-live', providerId: 'deepseek',
    probes: [
      { id: 'connectivity', status: 'passed' },
      { id: 'structured_schema', status: 'passed' }
    ]
  }), /readiness probe failed/i);
  await assert.rejects(invoke({
    connected: true, profileId: 'profile-live', providerId: 'deepseek',
    probes: [{ id: 'connectivity', status: 'passed' }]
  }), /readiness probe failed/i);
  await assert.rejects(invoke({
    connected: true, profileId: 'profile-live', providerId: 'deepseek',
    probes: [
      { id: 'connectivity', status: 'passed' },
      { id: 'structured_schema', status: 'failed' }
    ]
  }), /readiness probe failed/i);
  await assert.rejects(invoke({
    connected: true, profileId: 'profile-live', providerId: 'deepseek', probes: { status: 'passed' }
  }), /readiness probe failed/i);
  await assert.rejects(invoke({
    connected: true, profileId: 'profile-live', providerId: 'deepseek',
    probes: [
      { id: 'connectivity', status: 'passed' },
      { id: 'structured_schema', status: 'passed' },
      { id: 'structured_schema', status: 'passed' }
    ]
  }), /readiness probe failed/i, 'duplicate passed probes must not satisfy one requested identity');
  await assert.rejects(invoke({
    connected: true, profileId: 'profile-live', providerId: 'deepseek',
    probes: [
      { id: 'connectivity', status: 'passed' },
      { id: 'structured_schema', status: 'passed' },
      { id: 'structured_schema', status: 'failed' }
    ]
  }), /readiness probe failed/i, 'a passed+failed duplicate must fail closed');
  await assert.rejects(invoke({
    connected: true, profileId: 'profile-live', providerId: 'deepseek',
    probes: [
      { id: 'connectivity', status: 'passed' },
      { id: 'structured_schema', status: 'passed' },
      { id: '', status: 'passed' }
    ]
  }), /readiness probe failed/i, 'a malformed extra probe must invalidate the complete response');
  await assert.rejects(invoke({
    connected: true, profileId: 'profile-live', providerId: 'deepseek',
    probes: [
      { id: 'connectivity', status: 'passed' },
      { id: 'structured_schema', status: 'passed' },
      { id: 'reasoning_structured', status: 'passed' }
    ]
  }), /readiness probe failed/i, 'unexpected probes are outside the exact production response contract');
});

test('control page diagnostics reject errors and always close the page exactly once', async () => {
  const { runWithControlPageDiagnostics } = await verifier();
  const mockPage = () => {
    const handlers = new Map();
    let closeCount = 0;
    return {
      on: (name, handler) => handlers.set(name, handler),
      emit: (name, value) => handlers.get(name)?.(value),
      close: async () => { closeCount += 1; },
      get closeCount() { return closeCount; }
    };
  };
  for (const kind of ['console', 'pageerror', 'crash', 'context']) {
    const page = mockPage();
    await assert.rejects(runWithControlPageDiagnostics(page, async () => {
      if (kind === 'console') page.emit('console', { type: () => 'error', text: () => 'control error' });
      else if (kind === 'context') page.emit('console', {
        type: () => 'error', text: () => 'Extension context invalidated.'
      });
      else if (kind === 'pageerror') page.emit('pageerror', new Error('control page error'));
      else page.emit('crash');
      return 'unused';
    }), /CONTROL_PAGE_DIAGNOSTICS_FAILED/, kind);
    assert.equal(page.closeCount, 1, `${kind} close count`);
  }
  const healthy = mockPage();
  const result = await runWithControlPageDiagnostics(healthy, async () => 'ready');
  assert.equal(result.value, 'ready');
  assert.equal(result.diagnostics.ok, true);
  assert.equal(healthy.closeCount, 1);
  const failedOperation = mockPage();
  await assert.rejects(runWithControlPageDiagnostics(failedOperation, async () => {
    throw new Error('PROVISION_FAILED');
  }), /PROVISION_FAILED/);
  assert.equal(failedOperation.closeCount, 1);
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.match(source, /globalReceipt:\s*\{\s*ok:\s*controlPageDiagnostics/);
  assert.match(source, /payload\.globalReceipt\.controlPageDiagnostics\.count\s*===\s*0/);
});

test('Q&A waits for a new production runtime completion and rejects preexisting receipts', async () => {
  const { waitForProductionQaResponse, auditCapturedQaReceipt } = await verifier();
  const channel = () => {
    let listener;
    return { subscribe: callback => { listener = callback; return () => { listener = null; }; },
      emit: event => listener?.(event) };
  };
  const expected = { profileId: 'profile-live', pageNumber: 7,
    sourceId: 'pdf-page-7', evidenceSha256: 'a'.repeat(64),
    selectionDocumentSha256: 'b'.repeat(64) };
  const live = channel();
  const pending = waitForProductionQaResponse(live.subscribe, expected, {
    clickedAt: 2000, baselineOperationIds: ['old-op'], profileInFlight: false, timeoutMs: 500
  });
  live.emit({ phase: 'chat_completed', turn: {
    operationId: 'old-op', createdAt: 1000, status: 'completed' } });
  live.emit({ phase: 'chat_started', turn: { operationId: 'new-op', createdAt: 2050,
    status: 'generating', selectedProfileId: 'profile-live' } });
  live.emit({ phase: 'chat_completed', turn: {
    operationId: 'new-op', createdAt: 2050, updatedAt: 2100, status: 'completed',
    selectedProfileId: 'profile-live', answerBlocks: [{ markdown: 'Answer', evidence: [{
      sourceKey: 'pdf-page-7', paragraphId: 'pdf-page-7', textHash: 'a'.repeat(64)
    }] }] } });
  const result = await pending;
  assert.equal(result.operationId, 'new-op');
  const receipt = { ok: true, identityMatches: true, citationMatches: true,
    operationId: 'new-op', clickedAt: 2000, startedAt: 2050, completedAt: 2100,
    pageNumber: 7, sourceId: 'pdf-page-7', evidenceSha256: 'a'.repeat(64),
    selectionDocumentSha256: 'b'.repeat(64) };
  assert.equal(auditCapturedQaReceipt(receipt), true);
  assert.equal(auditCapturedQaReceipt({ ...receipt, startedAt: 1999 }), false);

  const concurrent = channel();
  const concurrentPending = waitForProductionQaResponse(concurrent.subscribe, expected, {
    clickedAt: 2000, baselineOperationIds: ['old-op'], profileInFlight: false, timeoutMs: 100
  });
  concurrent.emit({ phase: 'chat_started', turn: { operationId: 'new-a', createdAt: 2050,
    status: 'generating', selectedProfileId: 'profile-live' } });
  concurrent.emit({ phase: 'chat_started', turn: { operationId: 'new-b', createdAt: 2060,
    status: 'generating', selectedProfileId: 'profile-live' } });
  await assert.rejects(concurrentPending, /PDF_QA_CONCURRENT_OPERATION/);

  const wrong = channel();
  const wrongPending = waitForProductionQaResponse(wrong.subscribe, expected, {
    clickedAt: 2000, baselineOperationIds: ['old-op'], profileInFlight: false, timeoutMs: 20
  });
  wrong.emit({ phase: 'chat_started', turn: { operationId: 'old-op', createdAt: 1000,
    status: 'generating', selectedProfileId: 'profile-live' } });
  wrong.emit({ phase: 'chat_completed', turn: { operationId: 'old-op', createdAt: 1000,
    updatedAt: 2100, status: 'completed', selectedProfileId: 'profile-live', answerBlocks: [{
      markdown: 'Old', evidence: [{ sourceKey: 'pdf-page-7', paragraphId: 'pdf-page-7',
        textHash: 'a'.repeat(64) }] }] } });
  await assert.rejects(wrongPending, /PDF_QA_RESPONSE_TIMEOUT/);

  const mismatched = channel();
  const mismatchPending = waitForProductionQaResponse(mismatched.subscribe, expected, {
    clickedAt: 2000, baselineOperationIds: [], profileInFlight: false, timeoutMs: 20
  });
  mismatched.emit({ phase: 'chat_started', turn: { operationId: 'wrong-selection-op',
    createdAt: 2050, status: 'generating', selectedProfileId: 'profile-live' } });
  mismatched.emit({ phase: 'chat_completed', turn: { operationId: 'wrong-selection-op',
    createdAt: 2050, updatedAt: 2100, status: 'completed',
    selectedProfileId: 'profile-live', answerBlocks: [{ markdown: 'Wrong selection', evidence: [{
      sourceKey: 'pdf-page-8', paragraphId: 'pdf-page-8', textHash: 'a'.repeat(64)
    }] }] } });
  await assert.rejects(mismatchPending, /PDF_QA_RESPONSE_TIMEOUT/);
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.doesNotMatch(source, /qaResponseReceiptPath/);
  assert.doesNotMatch(source, /startedNonce|selectionId/);
  assert.match(source, /getArticleWorkspaceSnapshot/);
  assert.match(source, /chat_started/);
  assert.match(source, /chat_completed/);
});

test('diagnostic gate covers console, page crash, worker, and extension-context invalidation', async () => {
  const { auditDiagnostics } = await verifier();
  assert.equal(auditDiagnostics({
    pageErrors: [], consoleErrors: [], pageCrashes: 0, workerErrors: [], contextInvalidations: 0
  }).ok, true);
  for (const field of ['pageErrors', 'consoleErrors', 'workerErrors']) {
    assert.equal(auditDiagnostics({ [field]: ['failure'] }).ok, false, field);
  }
  assert.equal(auditDiagnostics({ pageCrashes: 1 }).ok, false);
  assert.equal(auditDiagnostics({ contextInvalidations: 1 }).ok, false);
});

test('reopened copy binds the exact annotation id, page, note, and standard PDF data', async () => {
  const { auditReopenedAnnotation, countExactAnnotationIdentity } = await verifier();
  const expected = {
    annotationId: 'annotation-7', pageNumber: 7, noteSha256: 'a'.repeat(64)
  };
  const observed = {
    annotationId: 'annotation-7', pageNumber: 7, noteSha256: 'a'.repeat(64),
    standard: {
      annotationType: 9, author: 'Brevess', commentSha256: 'a'.repeat(64),
      pageNumber: 7, quadPointCount: 8, matchCount: 1
    }, overlayMatchCount: 1
  };
  assert.equal(auditReopenedAnnotation(expected, observed).ok, true);
  assert.equal(auditReopenedAnnotation(expected, {
    ...observed, annotationId: 'some-other-annotation'
  }).ok, false);
  assert.equal(countExactAnnotationIdentity([
    observed, { ...observed, annotationId: 'older-annotation' }
  ], expected), 1);
  assert.equal(auditReopenedAnnotation(expected, {
    ...observed, standard: { ...observed.standard, matchCount: 2 }
  }).ok, false);
  assert.equal(auditReopenedAnnotation(expected, {
    ...observed, standard: { ...observed.standard, pageNumber: 8 }
  }).ok, false);
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.match(source, /annotationCount:\s*reopened\.overlayMatchCount/);
});

test('layout evidence is bound to named markers, pages, semantics, and original-PDF inspection', async () => {
  const { auditTargetedLayoutInspection } = await verifier();
  const expected = {
    paperKey: 'neuron-2026-dopamine-circuits', pdfSha256: 'a'.repeat(64),
    targets: [{ key: 'figure7-statistics', pageNumber: 18,
      markerSha256: 'b'.repeat(64), semantic: 'figure-caption' }]
  };
  const observed = { targets: [{ ...expected.targets[0], targetVisible: true, semanticVerified: true }] };
  const inspection = {
    status: 'PASS', originalPdfReviewed: true, paperKey: expected.paperKey,
    pdfSha256: expected.pdfSha256, observation: 'Compared at native resolution.',
    targets: [{ key: 'figure7-statistics', pageNumber: 18,
      markerSha256: 'b'.repeat(64), status: 'PASS' }]
  };
  assert.equal(auditTargetedLayoutInspection(expected, observed, inspection).ok, true);
  assert.equal(auditTargetedLayoutInspection(expected, {
    targets: [{ ...observed.targets[0], pageNumber: 17 }]
  }, inspection).ok, false);
});

test('public report is an allowlist that excludes private paths, text, prompts, and credentials', async () => {
  const { publicPaperResult } = await verifier();
  const secret = path.join(os.tmpdir(), 'private-zotero-library', 'paper.pdf');
  const result = publicPaperResult({
    key: 'nat-neuro-2020-srpx2', title: 'SRPX2', doi: '10.1038/example',
    sha256: 'a'.repeat(64), pageCount: 19, checks: { ok: true },
    layout: { ok: true }, screenshots: { ok: true, evidence: [] },
    nativeInspection: { ok: true }, externalReaderInspection: { ok: true },
    receipt: { qaOk: true, qa: { ok: true, identityMatches: true, citationMatches: true,
      operationId: 'chat-current-operation', clickedAt: 2000,
      startedAt: 2050, completedAt: 2100, pageNumber: 7,
      sourceId: 'pdf-page-7', evidenceSha256: 'a'.repeat(64),
      selectionDocumentSha256: 'b'.repeat(64) } },
    artifacts: { annotatedPdf: { relativePath: secret, sha256: 'a'.repeat(64), size: 99 } },
    diagnostics: { unhandledErrors: 0 }, pass: true,
    pdfPath: secret, zoteroAttachmentPath: secret, fullText: 'PRIVATE ARTICLE TEXT',
    prompt: 'PRIVATE RAW PROMPT', response: 'PRIVATE RAW RESPONSE', apiKey: 'sk-private'
  });
  assert.deepEqual(Object.keys(result), [
    'key', 'kind', 'title', 'doi', 'pmid', 'pmcid', 'sha256', 'pageCount',
    'checks', 'layout', 'screenshots', 'nativeInspection',
    'externalReaderInspection', 'artifact', 'receipt', 'artifacts', 'diagnostics', 'pass'
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private-zotero|PRIVATE|sk-private/i);
  assert.deepEqual(result.receipt.qa, {
    ok: true, identityMatches: true, citationMatches: true,
    operationId: 'chat-current-operation', clickedAt: 2000,
    startedAt: 2050, completedAt: 2100, pageNumber: 7,
    sourceId: 'pdf-page-7', evidenceSha256: 'a'.repeat(64),
    selectionDocumentSha256: 'b'.repeat(64)
  });
});

test('explicit unpacked build binding is deterministic and path-free', async () => {
  const { extensionBuildBinding } = await verifier();
  const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-reader-build-'));
  try {
    fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'Brevess Test', version: '1.2.3'
    }), 'utf8');
    fs.writeFileSync(path.join(extension, 'pdf-reader.html'), '<main></main>', 'utf8');
    const first = extensionBuildBinding(extension);
    const second = extensionBuildBinding(extension);
    assert.deepEqual(first, second);
    assert.match(first.manifestSha256, /^[a-f0-9]{64}$/);
    assert.match(first.buildSha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(first), /pdf-reader-build-/);
  } finally {
    fs.rmSync(extension, { recursive: true, force: true });
  }
});

test('source binds headed Edge, private inputs, production interactions, and two-stage review', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  for (const token of [
    'first_page_interactive', 'zoom_changes_width', 'fit_width_matches_container',
    'toggle_round_trip', 'selection_highlight_visible', 'selection_note_persisted',
    'selection_qa_grounded', 'saved_copy_reopens_with_annotation',
    'independent_reopen_verified', 'no_unhandled_error'
  ]) assert.match(source, new RegExp(token), token);
  assert.match(source, /channel:\s*['"]msedge['"]/);
  assert.match(source, /HEADLESS/);
  assert.match(source, /--extension/);
  assert.match(source, /PDF_READER_QA_INPUT/);
  assert.match(source, /PDF_READER_TRUSTED_PROFILE/);
  assert.match(source, /--trusted-profile/);
  assert.match(source, /PDF_READER_NATIVE_INSPECTION/);
  assert.match(source, /PDF_READER_EXTERNAL_INSPECTION/);
  assert.match(source, /CAPTURED_PENDING_AUDIT/);
  assert.match(source, /process\.exitCode\s*=\s*1/);
  assert.match(source, /inspectLiveLayout/);
  assert.match(source, /pdfPageCount/);
  assert.match(source, /annotatedPageCount\s*!==\s*paper\.pageCount/);
  assert.doesNotMatch(source, /paper\.layoutEvidence/);
});

test('missing private input fails honestly and invalidates stale PASS output', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-reader-verifier-'));
  const reportPath = path.join(outputDir, 'qa-result.json');
  try {
    fs.writeFileSync(reportPath, JSON.stringify({ pass: true }), 'utf8');
    const run = spawnSync(process.execPath, [verifierPath, '--output', outputDir], {
      cwd: root, encoding: 'utf8', env: {
        ...process.env, PDF_READER_QA_INPUT: '', PDF_READER_NATIVE_INSPECTION: '',
        PDF_READER_EXTERNAL_INSPECTION: '', EXTENSION_PATH: ''
      }
    });
    assert.equal(run.status, 1);
    assert.match(`${run.stdout}\n${run.stderr}`, /PENDING_EXTERNAL_INPUT/);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.status, 'FAILED');
    assert.equal(report.pass, false);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('audit-existing CLI rejects receipts whose claimed artifacts do not exist on disk', async () => {
  const { buildCaptureArtifactHash } = await verifier();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-reader-audit-existing-'));
  const keys = [
    'neuron-2026-dopamine-circuits', 'neuron-2020-hippocampal-ripples',
    'nat-neuro-2020-srpx2', 'pmc12767537', 'pmc12167935'
  ];
  try {
    const papers = keys.map(key => ({
      key, sourcePdfSha256: 'b'.repeat(64), annotatedPdfSha256: 'c'.repeat(64),
      pageCount: 12, annotationCount: 1, annotationIdentitySha256: 'd'.repeat(64),
      screenshots: [{ filename: 'native-document.png', sha256: 'e'.repeat(64), width: 1280, height: 1000 }]
    }));
    const capture = {
      captureRunId: '11111111-1111-4111-8111-111111111111',
      extensionBuildSha256: 'a'.repeat(64), papers
    };
    capture.artifactSha256 = buildCaptureArtifactHash(capture);
    const native = { papers: {} };
    const external = { papers: {} };
    for (const paper of papers) {
      native.papers[paper.key] = { screenshots: { 'native-document.png': {
        status: 'PASS', nativeResolution: true, observation: 'Reviewed at 100%.',
        sha256: 'e'.repeat(64), width: 1280, height: 1000
      } } };
      external.papers[paper.key] = {
        status: 'PASS', openedOutsideExtension: true, allAnnotationsVisible: true,
        bodyReadable: true, observation: 'Independent reader verified.',
        paperKey: paper.key, sourcePdfSha256: paper.sourcePdfSha256,
        annotatedPdfSha256: paper.annotatedPdfSha256,
        annotationIdentitySha256: paper.annotationIdentitySha256,
        pageCount: paper.pageCount, annotationCount: paper.annotationCount
      };
    }
    const capturePath = path.join(temp, 'capture.json');
    const nativePath = path.join(temp, 'native.json');
    const externalPath = path.join(temp, 'external.json');
    const outputDir = path.join(temp, 'audit-output');
    fs.writeFileSync(capturePath, JSON.stringify(capture), 'utf8');
    fs.writeFileSync(nativePath, JSON.stringify(native), 'utf8');
    fs.writeFileSync(externalPath, JSON.stringify(external), 'utf8');
    const run = spawnSync(process.execPath, [verifierPath,
      '--audit-existing', capturePath, '--inspection', nativePath,
      '--external-inspection', externalPath, '--output', outputDir
    ], { cwd: root, encoding: 'utf8', env: {
      ...process.env, HEADLESS: '1', EXTENSION_PATH: '', PDF_READER_QA_INPUT: ''
    } });
    assert.equal(run.status, 1, run.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'qa-result.json'), 'utf8'));
    assert.equal(report.pass, false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('committed matrix is an honest public PENDING template', () => {
  const markdown = fs.readFileSync(matrixPath, 'utf8');
  for (const key of [
    'neuron-2026-dopamine-circuits', 'neuron-2020-hippocampal-ripples',
    'nat-neuro-2020-srpx2', 'PMC12767537', 'PMC12167935'
  ]) assert.match(markdown, new RegExp(key));
  assert.match(markdown, /PENDING_EXTERNAL_INPUT/);
  assert.match(markdown, /native resolution/i);
  assert.match(markdown, /independent PDF reader/i);
  assert.match(markdown, /--audit-existing/);
  assert.match(markdown, /does not (?:start|launch) (?:Edge|a browser)/i);
  assert.match(markdown, /ARTICLE_CHAT_STATE_CHANGED/);
  assert.match(markdown, /LLM_GET_SETTINGS/);
  assert.match(markdown, /--trusted-profile/);
  assert.match(markdown, /root and internal[^\n]*(?:symlink|junction|reparse)/i);
  assert.match(markdown, /empty or whitespace-only[^\n]*rejected/i);
  assert.match(markdown, /temporary copy fingerprint[^\n]*exactly match[^\n]*before Edge/i);
  assert.match(markdown, /initial and post-copy source fingerprints[^\n]*temporary copy fingerprint[^\n]*exactly match/i);
  assert.match(markdown, /LLM_TEST_PROFILE[^\n]*connected[^\n]*requested probe[^\n]*passed/i);
  assert.match(markdown, /probe array[^\n]*well-formed[^\n]*exactly once[^\n]*no unexpected/i);
  assert.match(markdown, /never calls `LLM_SAVE_PROFILE`/);
  assert.match(markdown, /pre-stored response receipt[^\n]*cannot/i);
  assert.match(markdown, /exactly one[^\n]*(?:overlay|standard annotation)/i);
  assert.doesNotMatch(markdown, /private production response receipt/i);
  assert.match(markdown, /DO NOT MARK PASS/i);
  assert.doesNotMatch(markdown, /\|\s*PASS\s*\|/);
  assert.doesNotMatch(markdown, /[A-Z]:\\|Zotero[\\/]|sk-[A-Za-z0-9]/i);
});
