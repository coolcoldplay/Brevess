const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function verifier() {
  return import('../scripts/verify-pdf-semantic-highlights-live.mjs');
}

test('B4 live verifier defaults to an explicit offline fixture boundary', async () => {
  const { normalizeOptions } = await verifier();
  const options = normalizeOptions([], {});
  assert.equal(options.apiMode, 'fixture');
  assert.match(options.pdfPath, /elife-83176-v2\.pdf$/u);
  assert.equal(options.headed, false);
});

test('B4 real API is opt-in and invalid modes fail closed', async () => {
  const { normalizeOptions } = await verifier();
  assert.equal(normalizeOptions(['--api-mode', 'real-api']).apiMode, 'real-api');
  assert.throws(() => normalizeOptions(['--api-mode', 'replay']), /B4_API_MODE_INVALID/u);
});

test('B4 multi-page overlays must cover every distinct requested page', async () => {
  const { assertMultiPageOverlayCoverage } = await verifier();
  assert.equal(assertMultiPageOverlayCoverage([5, 6], [6, 5]), true);
  assert.throws(() => assertMultiPageOverlayCoverage([5, 5], [5]),
    /B4_MULTI_PAGE_TARGET_UNAVAILABLE/u);
  assert.throws(() => assertMultiPageOverlayCoverage([5, 6], [5]),
    /B4_MULTI_PAGE_OVERLAY_INCOMPLETE/u);
});

test('B4 report redaction rejects credentials, raw ranges, and locations', async () => {
  const { assertRedactedReport } = await verifier();
  assert.equal(assertRedactedReport({ execution: { apiMode: 'fixture' }, count: 1 }), true);
  assert.throws(() => assertRedactedReport({ apiKey: 'secret' }), /B4_REPORT_FORBIDDEN_KEY/u);
  assert.throws(() => assertRedactedReport({ ranges: [] }), /B4_REPORT_FORBIDDEN_KEY/u);
  assert.throws(() => assertRedactedReport({ diagnostic: 'Bearer secret-value' }),
    /B4_REPORT_SECRET_OR_LOCATION_LEAK/u);
});

test('B4 help distinguishes fixture evidence from fresh provider smoke', async () => {
  const { helpText } = await verifier();
  const help = helpText();
  assert.match(help, /--api-mode fixture\|real-api/u);
  assert.match(help, /zero provider calls/u);
  assert.match(help, /fresh/u);
  assert.doesNotMatch(help, /sk-[A-Za-z0-9]/u);
});

test('B4 Methods selection plan uses canonical workspace messages only', async () => {
  const { buildMethodsSelectionMessages } = await verifier();
  const snapshot = { nodes: [
    { sectionId: 'canonical-intro', title: 'Introduction', sectionKind: 'introduction',
      analysisSectionIds: ['canonical-intro'], children: [] },
    { sectionId: 'canonical-methods', title: 'Materials and methods', sectionKind: 'methods',
      analysisSectionIds: ['canonical-methods', 'canonical-methods-child'], children: [
        { sectionId: 'canonical-methods-child', title: 'Animals', sectionKind: '',
          analysisSectionIds: ['canonical-methods-child'], children: [] }
      ] },
    { sectionId: 'canonical-results', title: 'Results', sectionKind: 'results',
      analysisSectionIds: ['canonical-results'], children: [] }
  ] };
  const plan = buildMethodsSelectionMessages(snapshot);
  assert.deepEqual(plan.messages, [
    { action: 'setArticleAnalysisSectionSelection',
      sectionIds: ['canonical-intro', 'canonical-methods', 'canonical-methods-child',
        'canonical-results'], selected: false },
    { action: 'setArticleAnalysisSectionSelection',
      sectionIds: ['canonical-methods', 'canonical-methods-child'], selected: true }
  ]);
  assert.deepEqual(plan.methodSectionIds,
    ['canonical-methods', 'canonical-methods-child']);
  assert.equal(JSON.stringify(plan).includes('semantic-'), false);
});

test('B4 semantic-ready lifecycle requires revision, scoped rebind, and one scroll-free restore',
  async () => {
    const { assertSemanticReadyLifecycleEvidence } = await verifier();
    assert.equal(assertSemanticReadyLifecycleEvidence({
      revisionBefore: 7,
      revisionAfter: 8,
      methodsOnlyBefore: true,
      methodsOnlyAfter: true,
      legacyParagraphBefore: true,
      semanticParagraphAfter: true,
      restoreAppliedCount: 1,
      pendingAfter: false,
      scrollCallCount: 0,
      layerCountAfterFirstReady: 1,
      layerCountAfterSecondReady: 1,
      markCountAfterFirstReady: 3,
      markCountAfterSecondReady: 3,
      regexMapRetained: true,
      llmMapRetained: true,
      regexMarkCountAfterSecondReady: 1,
      llmMarkCountAfterSecondReady: 2
    }), true);
    assert.throws(() => assertSemanticReadyLifecycleEvidence({
      revisionBefore: 8,
      revisionAfter: 8,
      methodsOnlyBefore: true,
      methodsOnlyAfter: true,
      legacyParagraphBefore: true,
      semanticParagraphAfter: true,
      restoreAppliedCount: 1,
      pendingAfter: false,
      scrollCallCount: 0,
      layerCountAfterFirstReady: 1,
      layerCountAfterSecondReady: 1,
      markCountAfterFirstReady: 3,
      markCountAfterSecondReady: 3,
      regexMapRetained: true,
      llmMapRetained: true,
      regexMarkCountAfterSecondReady: 1,
      llmMarkCountAfterSecondReady: 2
    }), /B4_SEMANTIC_REVISION_DID_NOT_ADVANCE/u);
  });

function readyPendingPrerequisites() {
  return {
    workspaceReady: true, workspaceIndexed: true, nativePhaseReady: true,
    targetPagePresent: true, targetRenderedPagePresent: true,
    targetTextLayerConnected: true, targetProjectionHashMatches: true,
    targetProjectionGenerationMatches: true, renderedPagePresent: true,
    projectionPresent: true, projectionHashMatches: true,
    projectionGenerationMatches: true, semanticIdentityMatches: true,
    readiness: 'ready'
  };
}

test('B4 pending restore reports the missing prerequisite without relaxing lifecycle assertions',
  async () => {
    const { assertPendingRestorePrerequisites, assertRedactedReport } = await verifier();
    const ready = readyPendingPrerequisites();
    assert.equal(assertPendingRestorePrerequisites(ready), true);
    for (const [field, value] of Object.entries(ready)) {
      const evidence = { ...ready, [field]: typeof value === 'boolean' ? false : 'waiting' };
      assert.throws(() => assertPendingRestorePrerequisites(evidence), error =>
        /^B4_PENDING_PREREQUISITE_/u.test(error.code) &&
        error.prerequisites === evidence, field);
      assert.equal(assertRedactedReport({ prerequisites: evidence }), true);
    }
  });

test('B4 pending preparation materializes first and reports a bounded workspace failure',
  async () => {
    const { preparePendingRestorePrerequisites, readPendingRestorePrerequisites } =
      await verifier();
    const calls = [];
    const blocked = { ...readyPendingPrerequisites(), workspaceIndexed: false,
      readiness: 'waiting' };
    const reader = { evaluate: async (callback, pageNumber) => {
      calls.push({ callback, pageNumber });
      if (callback === readPendingRestorePrerequisites) return blocked;
    } };
    await assert.rejects(preparePendingRestorePrerequisites(reader, 7, { timeoutMs: 0 }),
      error => error.code === 'B4_PENDING_PREREQUISITE_WORKSPACE_INDEXED' &&
        error.prerequisites === blocked);
    assert.equal(calls.length, 2);
    assert.match(String(calls[0].callback), /__b4ShowProjectedPage/u);
    assert.equal(calls[1].callback, readPendingRestorePrerequisites);
    assert.ok(calls.every(call => call.pageNumber === 7));
  });

test('B4 pending readiness samples production gates and verifies connected target projection',
  async () => {
    const { readPendingRestorePrerequisites } = await verifier();
    const vm = require('node:vm');
    const native = { phase: 'text-ready', documentGeneration: 3,
      structure: { documentHash: 'fixture-hash' } };
    const semanticContext = { documentHash: 'fixture-hash', documentGeneration: 3,
      revision: 4, semanticCacheKey: 'fixture-cache', semanticProvenanceKey: 'fixture-provenance' };
    const projection = { documentHash: 'fixture-hash', documentGeneration: 3,
      textLayer: { isConnected: true } };
    const gates = [];
    const sandbox = {
      document: { documentElement: { dataset: { pdfWorkspaceReady: 'true',
        pdfWorkspaceIndexed: 'false' } }, querySelector: () => ({}) },
      __brevessNativePdfDocument: native,
      __brevessPdfReaderBridge: { command: () => projection },
      articleWorkspaceLifecycleGeneration: 2,
      readPdfSemanticNavigationContext: () => semanticContext,
      currentNativePdfRegexProjection: () => projection,
      nativePdfRegexRestoreReadiness: (pending, current, options) => {
        gates.push({ pending, current, options });
        return options.workspaceIndexed ? 'ready' : 'waiting';
      }
    };
    const sample = () => vm.runInNewContext(`(${readPendingRestorePrerequisites})(7)`, sandbox);
    const waiting = sample();
    assert.equal(waiting.workspaceReady, true);
    assert.equal(waiting.workspaceIndexed, false);
    assert.equal(waiting.readiness, 'waiting');
    assert.equal(gates[0].options.workspaceIndexed, false);
    assert.equal(gates[0].options.projection, projection);
    assert.equal(gates[0].current, native);
    projection.textLayer.isConnected = false;
    projection.documentGeneration = 1;
    const stale = sample();
    assert.equal(stale.targetTextLayerConnected, false);
    assert.equal(stale.targetProjectionGenerationMatches, false);
    assert.equal(stale.projectionGenerationMatches, false);
    assert.ok(Object.values(stale).every(value => typeof value === 'boolean' ||
      ['missing', 'stale', 'waiting', 'ready'].includes(value)));
  });

test('B4 pending monitor is installed only after materialization and prerequisite acceptance', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts',
    'verify-pdf-semantic-highlights-live.mjs'), 'utf8');
  const stage = source.slice(source.indexOf("stage = 'SEMANTIC_READY_PENDING_REBIND'"),
    source.indexOf("stage = 'LEGACY_PAGE'"));
  const preparation = stage.indexOf('await preparePendingRestorePrerequisites(');
  const monitor = stage.indexOf('const monitor =');
  const staging = stage.indexOf('stageNativePdfLlmRestore(savedLlm');
  assert.ok(preparation > 0 && monitor > preparation && staging > monitor);
  assert.match(stage, /restoreEnteredRender/u);
  assert.match(stage, /renderLlmAnalysis = originalRenderLlmAnalysis/u);
  assert.match(stage, /assertSemanticReadyLifecycleEvidence\(semanticReadyLifecycle\)/u);
  assert.doesNotMatch(stage, /dataset\.pdfWorkspace(?:Ready|Indexed)\s*=/u);
});

test('B4 live Methods stage enters through tab messages without injected paragraph ids', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts',
    'verify-pdf-semantic-highlights-live.mjs'), 'utf8');
  const start = source.indexOf("stage = 'DEFAULT_SCOPE_MESSAGE'");
  const end = source.indexOf("stage = 'SEMANTIC_READY_PENDING_REBIND'", start);
  assert.ok(start > 0 && end > start);
  const scopeStage = source.slice(start, end);
  assert.match(scopeStage, /sendTabMessage\(worker, readerTabId/u);
  assert.match(scopeStage, /selectedArticleAnalysisParagraphIds\(\)/u);
  assert.match(scopeStage, /action: 'applyHighlight'/u);
  assert.match(scopeStage, /action: 'getMatchCounts'/u);
  assert.doesNotMatch(scopeStage, /allowedParagraphIds\s*:/u);
  assert.doesNotMatch(scopeStage, /highlighter\.applyHighlight\(/u);
});

test('B4 real API diagnostics redact secret material while retaining turn failure evidence',
  async () => {
    const { redactRealApiTurnDiagnostic } = await verifier();
    const diagnostic = redactRealApiTurnDiagnostic({
      turnId: 'turn-7', status: 'error', intent: 'highlight',
      errorCode: 'INVALID_SETTINGS',
      error: 'POST https://api.example.test/v1 with Bearer sk-example-secret-value failed',
      selectedProfileId: 'profile_pdf_semantic_b4_real_api',
      profileName: 'PDF semantic B4 real API', model: 'deepseek-chat',
      route: { taskType: 'article_chat', providerId: 'deepseek',
        model: 'deepseek-chat', effectiveProfileId: 'profile_pdf_semantic_b4_real_api' },
      matchCount: 0, degradedCount: 0, unresolvedCount: 1
    });
    assert.equal(diagnostic.turnId, 'turn-7');
    assert.equal(diagnostic.status, 'error');
    assert.equal(diagnostic.errorCode, 'INVALID_SETTINGS');
    assert.match(diagnostic.error, /\[redacted-location\]/u);
    assert.match(diagnostic.error, /\[redacted-secret\]/u);
    assert.doesNotMatch(JSON.stringify(diagnostic), /api\.example|sk-example|Bearer/u);
  });

test('B4 real API evidence requires independent automatic and Q&A provider closures',
  async () => {
    const { assertRealApiSmokeEvidence } = await verifier();
    const passing = {
      profile: { stored: true, llmReady: true, effectiveMode: 'llm',
        providerId: 'deepseek', model: 'deepseek-chat', credentialPresent: true,
        routes: { documentHighlight: { effectiveProfileMatches: true },
          articleChat: { effectiveProfileMatches: true } } },
      autoHighlight: { responseSuccess: true, providerRequestDelta: 1,
        mapItemCount: 2, markCount: 3, nonzeroRectCount: 3 },
      qaHighlight: { responseSuccess: true, providerRequestDelta: 1,
        turn: { status: 'completed', intent: 'highlight', matchCount: 1,
          error: '', errorCode: '' }, mapItemCount: 1, markCount: 2,
        nonzeroRectCount: 2 },
      totalProviderRequestDelta: 2
    };
    assert.equal(assertRealApiSmokeEvidence(passing), true);
    assert.throws(() => assertRealApiSmokeEvidence({
      ...passing,
      autoHighlight: { ...passing.autoHighlight, providerRequestDelta: 0 }
    }), /B4_REAL_API_AUTO_NO_FRESH_REQUEST/u);
    assert.throws(() => assertRealApiSmokeEvidence({
      ...passing,
      qaHighlight: { ...passing.qaHighlight, markCount: 0, nonzeroRectCount: 0 }
    }), /B4_REAL_API_QA_SEMANTIC_HIGHLIGHT_EMPTY/u);
  });

test('B4 real API path records nested queued turn and runs both production entry points', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts',
    'verify-pdf-semantic-highlights-live.mjs'), 'utf8');
  const start = source.indexOf("stage = 'REAL_API_PROFILE'");
  const end = source.indexOf("stage = 'FINAL'", start);
  assert.ok(start > 0 && end > start);
  const realStage = source.slice(start, end);
  assert.match(realStage, /action: 'analyzeArticleWithLLM'/u);
  assert.match(realStage, /action: 'highlightArticleMatchesWithLLM'/u);
  assert.match(realStage, /submission\?\.turn\?\.turnId/u);
  assert.match(realStage, /providerRequestDelta/u);
  assert.match(realStage, /redactRealApiTurnDiagnostic/u);
});

test('B4 fixture paths require distinct pages and verify each painted page immediately', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts',
    'verify-pdf-semantic-highlights-live.mjs'), 'utf8');
  assert.match(source,
    /new Set\(request\.ranges\.map\(range => range\.pageNumber\)\)\.size >= 2/u);
  assert.match(source, /Number\(target\?\.normalizedStart\) > 0/u);
  assert.match(source, /B4_MULTI_PAGE_TARGET_UNAVAILABLE/u);
  for (const code of [
    'B4_REGEX_MULTI_PAGE_OVERLAY_INCOMPLETE',
    'B4_LLM_MULTI_PAGE_OVERLAY_INCOMPLETE',
    'B4_QA_MULTI_PAGE_OVERLAY_INCOMPLETE'
  ]) assert.match(source, new RegExp(code, 'u'));
  assert.ok((source.match(/const overlayPageNumbers = \[\];/gu) || []).length >= 3);
  assert.ok((source.match(/assertMultiPageOverlayCoverage\(/gu) || []).length >= 4);
  assert.ok((source.match(/locatorGlobalOffsetsMatch:/gu) || []).length >= 3);
  for (const code of [
    'B4_REGEX_LOCATOR_NOT_GLOBAL_TARGET',
    'B4_LLM_LOCATOR_NOT_GLOBAL_TARGET',
    'B4_QA_LOCATOR_NOT_GLOBAL_TARGET'
  ]) assert.match(source, new RegExp(code, 'u'));
});
