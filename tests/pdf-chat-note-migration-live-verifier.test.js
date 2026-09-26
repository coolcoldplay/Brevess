const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const verifierPath = path.join(__dirname, '..', 'scripts',
  'verify-pdf-chat-note-migration-live.mjs');
const verifierModule = import('../scripts/verify-pdf-chat-note-migration-live.mjs');

test('B5 recorded selections bind both approved versions to exact PDF and projection hashes', async () => {
  const { recordedSelectionBaseline, RECORDED_SELECTION_BASELINES, EXPECTED_PDF_SHA256 } = await verifierModule;
  assert.equal(RECORDED_SELECTION_BASELINES.length, 2);
  const [old, current] = RECORDED_SELECTION_BASELINES;
  assert.equal(recordedSelectionBaseline(EXPECTED_PDF_SHA256, old.projectionSha256), old);
  assert.equal(recordedSelectionBaseline(EXPECTED_PDF_SHA256, current.projectionSha256), current);
  assert.deepEqual([old.rawCharacters, old.normalizedCharacters, old.endpoints[0].index], [573, 535, 92]);
  assert.deepEqual([current.rawCharacters, current.normalizedCharacters, current.endpoints[0].index], [546, 508, 95]);
  assert.equal(old.normalizedSha256, '9be49dd083cea38d948def406109aa804506893ccc36c33363fc5c5c90659f65');
  assert.equal(current.normalizedSha256, 'e114437d9669160cc60efe7ca5beaae612ab05f3e612a4964fefa82b46576b5d');
  for (const baseline of RECORDED_SELECTION_BASELINES) {
    assert.ok(Object.isFrozen(baseline) && Object.isFrozen(baseline.endpoints));
    assert.ok(Object.isFrozen(baseline.endpoints[0]) && Object.isFrozen(baseline.endpoints[0].geometry));
    assert.throws(() => recordedSelectionBaseline('0'.repeat(64), baseline.projectionSha256),
      /B5_RECORDED_SELECTION_BASELINE_UNKNOWN/);
  }
  assert.throws(() => recordedSelectionBaseline(EXPECTED_PDF_SHA256, '0'.repeat(64)),
    /B5_RECORDED_SELECTION_BASELINE_UNKNOWN/);
});

test('B5 physical endpoints require page, text identity, offset, index and every geometry coordinate', async () => {
  const { assertRecordedSelectionEndpoint, RECORDED_SELECTION_BASELINES } = await verifierModule;
  const expected = RECORDED_SELECTION_BASELINES[1].endpoints[0];
  assert.equal(assertRecordedSelectionEndpoint(structuredClone(expected), expected), true);
  for (const key of ['pageNumber', 'index', 'offset', 'contentSha256']) {
    assert.throws(() => assertRecordedSelectionEndpoint({ ...expected,
      [key]: key === 'contentSha256' ? 'wrong-text' : expected[key] + 1 }, expected),
    /B5_RECORDED_ENDPOINT_.*_MISMATCH/);
  }
  for (const key of ['left', 'top', 'width', 'height']) {
    assert.throws(() => assertRecordedSelectionEndpoint({ ...expected,
      geometry: { ...expected.geometry, [key]: expected.geometry[key] + 0.76 } }, expected),
    /B5_RECORDED_ENDPOINT_GEOMETRY_.*_MISMATCH/);
    assert.throws(() => assertRecordedSelectionEndpoint({ ...expected,
      geometry: { ...expected.geometry, [key]: Number.NaN } }, expected),
    /B5_RECORDED_ENDPOINT_GEOMETRY_.*_MISMATCH/);
  }
});

test('B5 verifier fixes the public PDF and defaults to an isolated offline run', async () => {
  const verifier = await verifierModule;
  const options = verifier.normalizeOptions([], {});
  assert.equal(verifier.EXPECTED_PDF_SHA256,
    '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1');
  assert.equal(verifier.EXPECTED_PAGE_COUNT, 23);
  assert.match(options.pdfPath, /elife-83176-v2\.pdf$/u);
  assert.equal(options.headed, false);
  assert.equal(options.provider, 'loopback');
  assert.equal(options.maxProviderCalls, 5);
  assert.match(verifier.helpText(), /deterministic loopback-fixture/u);
  assert.match(verifier.helpText(), /hidden TTY[\s\S]*local process/u);
});

test('B5 real-provider mode is explicit and bounded to the five required UI calls', async () => {
  const verifier = await verifierModule;
  const options = verifier.normalizeOptions([
    '--provider', 'deepseek', '--model', 'deepseek-chat',
    '--max-provider-calls', '5'
  ]);
  assert.equal(options.provider, 'deepseek');
  assert.equal(options.model, 'deepseek-chat');
  assert.equal(options.maxProviderCalls, 5);
  assert.throws(() => verifier.normalizeOptions(['--provider', 'unknown']),
    /B5_PROVIDER_MODE_INVALID/u);
  assert.throws(() => verifier.normalizeOptions(['--max-provider-calls', '6']),
    /B5_PROVIDER_CALL_CAP_INVALID/u);
  assert.throws(() => verifier.normalizeOptions(['--max-provider-calls', '0']),
    /B5_PROVIDER_CALL_CAP_INVALID/u);
});

test('B5 redacted report rejects credentials, article bodies, locators and locations', async () => {
  const { assertRedactedReport } = await verifierModule;
  assert.equal(assertRedactedReport({ source: { pdfSha256: 'a'.repeat(64), pageCount: 23 },
    checks: { chat: { savedSemanticLocator: true } } }), true);
  for (const candidate of [
    { apiKey: 'secret' }, { quote: 'paper body' }, { ranges: [] },
    { diagnostic: 'Bearer fixture-secret' }, { source: 'https://example.invalid/a' }
  ]) assert.throws(() => assertRedactedReport(candidate), /B5_REPORT_/u);
});

test('B5 fixture preserves the requested continuation quote after question whitespace normalization', async () => {
  const { chatFixture } = await verifierModule;
  const requested = 'Exact continuation sentence on the second page.';
  const context = { article: { chunks: [{
    text: `Earlier paragraph sentence is sufficiently long. ${requested}`,
    sourceSpans: [{ paragraphId: 'semantic-p-1', sourceKey: 'source-p-1', textHash: 'hash' }]
  }] } };
  const makeBody = question => ({ messages: [{ role: 'user', content:
    `ARTICLE_CONTEXT\n${JSON.stringify(context)}\nCHAT_REQUEST\n` +
      JSON.stringify({ current_question: question }) }] });
  for (const separator of ['\n', ' ']) {
    const records = chatFixture(makeBody(`B5_CONTINUATION_QUOTE${separator}${requested}`))
      .split('\n').map(line => JSON.parse(line));
    assert.equal(records[0].evidence[0].quote, requested);
  }
  assert.throws(() => chatFixture(makeBody('B5_CONTINUATION_QUOTE Missing source quote.')),
    /B5_FIXTURE_REQUESTED_QUOTE_NOT_IN_CONTEXT/u);
});

test('B5 acceptance evidence requires every migration and reopen invariant', async () => {
  const { assertAcceptanceEvidence } = await verifierModule;
  const passing = {
    chat: { savedSemanticLocator: true, rawPageAnchorVerified: true,
      continuationPageQuote: true, reopened: true,
      sentenceFocusBeforeReopen: true, sentenceFocusAfterReopen: true },
    selection: { semanticLocatorSaved: true, globalQuoteSpanVerified: true,
      rawPageAnchorVerified: true, reopened: true, regenerated: true,
      regeneratedIdentityPreserved: true,
      citationFocusBeforeReopen: true, citationFocusAfterReopen: true,
      citationFocusAfterRegenerate: true },
    duplicate: { locatorDisambiguated: true, quoteOnlyAmbiguous: true,
      ambiguousScrollCount: 0 },
    revision: { rebound: true, duplicateRejected: true, duplicateScrollCount: 0 },
    replacement: { stale: true, scrollCount: 0 },
    legacy: { usable: true, pageLevelDegraded: true },
    note: { wholeTableEvidenceSaved: true, singleFieldEvidenceSaved: true,
      otherFieldsUnchanged: true, persistedContentIdentical: true, reopenedIdentical: true },
    legacyNote: { visible: true, historicalSourceLabel: true }
  };
  assert.equal(assertAcceptanceEvidence(passing), true);
  assert.throws(() => assertAcceptanceEvidence({ ...passing,
    duplicate: { ...passing.duplicate, quoteOnlyAmbiguous: false } }),
  /B5_DUPLICATE_QUOTE_DID_NOT_FAIL_CLOSED/u);
  assert.throws(() => assertAcceptanceEvidence({ ...passing,
    note: { ...passing.note, otherFieldsUnchanged: false } }),
  /B5_NOTE_FIELD_UPDATE_CHANGED_SIBLINGS/u);
  assert.throws(() => assertAcceptanceEvidence({ ...passing,
    selection: { ...passing.selection, regeneratedIdentityPreserved: false } }),
  /B5_SELECTION_REGENERATED_LOCATOR_IDENTITY_CHANGED/u);
  assert.throws(() => assertAcceptanceEvidence({ ...passing,
    revision: { ...passing.revision, duplicateRejected: false } }),
  /B5_REVISION_DUPLICATE_NOT_REJECTED/u);
  assert.throws(() => assertAcceptanceEvidence({ ...passing,
    note: { ...passing.note, persistedContentIdentical: false } }),
  /B5_NOTE_SAVED_CONTENT_MISMATCH/u);
});

test('B5 reopened state comparison ignores object key order and preserves every value and clock', async () => {
  const { stateIdentityDigest } = await verifierModule;
  const original = { schemaVersion: 3, values: { a: 'first', b: 'second' },
    evidence: { a: { locators: [{ revision: 1, quote: 'exact' }] } }, updatedAt: 12 };
  const reordered = { updatedAt: 12, evidence: { a: { locators: [{ quote: 'exact', revision: 1 }] } },
    values: { b: 'second', a: 'first' }, schemaVersion: 3 };
  assert.equal(stateIdentityDigest(original), stateIdentityDigest(reordered));
  for (const altered of [
    { ...original, updatedAt: 13 },
    { ...original, values: { a: 'changed', b: 'second' } },
    { ...original, evidence: { a: { locators: [{ revision: 2, quote: 'exact' }] } } }
  ]) assert.notEqual(stateIdentityDigest(original), stateIdentityDigest(altered));
});

test('B5 note reopen ignores only the document save timestamp and retains field revisions', async () => {
  const { noteContentIdentityDigest } = await verifierModule;
  const original = { updatedAt: 10, valuesByTemplate: { t: { f: 'saved' } },
    fieldUpdatedAtByTemplate: { t: { f: 7 } }, fieldEvidenceByTemplate: { t: { f: { revision: 2 } } } };
  assert.equal(noteContentIdentityDigest(original),
    noteContentIdentityDigest({ ...original, updatedAt: 11 }));
  for (const changed of [
    { ...original, valuesByTemplate: { t: { f: 'changed' } } },
    { ...original, fieldUpdatedAtByTemplate: { t: { f: 8 } } },
    { ...original, fieldEvidenceByTemplate: { t: { f: { revision: 3 } } } }
  ]) assert.notEqual(noteContentIdentityDigest(original), noteContentIdentityDigest(changed));
});

test('B5 exact citation focus requires resolved raw quotes, pages, and overlay geometry', async () => {
  const { assertExactCitationFocusEvidence } = await verifierModule;
  const passing = { resolved: true, expectedRangeCount: 2, quoteMatchCount: 2,
    expectedPageNumbers: [4, 5], overlayPageNumbers: [4, 5],
    expectedRectCount: 3, overlayRectCount: 3, geometryMatches: true };
  assert.equal(assertExactCitationFocusEvidence(passing), true);
  assert.throws(() => assertExactCitationFocusEvidence({
    ...passing, overlayPageNumbers: [4]
  }), /B5_CITATION_FOCUS_NOT_EXACT_PAGE_MISMATCH/u);
  assert.throws(() => assertExactCitationFocusEvidence({
    ...passing, quoteMatchCount: 1
  }), /B5_CITATION_FOCUS_NOT_EXACT_RAW_QUOTE_MISMATCH/u);
  assert.throws(() => assertExactCitationFocusEvidence({
    ...passing, geometryMatches: false
  }), /B5_CITATION_FOCUS_NOT_EXACT_GEOMETRY_MISMATCH/u);
});

test('B5 citation capture must match the owning turn locator identity', async () => {
  const { assertCitationLocatorIdentity } = await verifierModule;
  const expected = {
    locatorKind: 'pdf-semantic', documentId: 'sha256:fixture',
    documentHash: 'a'.repeat(64), documentGeneration: 3, revision: 7,
    semanticCacheKey: 'cache-7', semanticProvenanceKey: 'provenance-7',
    paragraphId: 'semantic-results-2', normalizedStart: 140, normalizedEnd: 151,
    expectedNormalizedQuote: 'exact quote',
    pageAnchor: { paragraphId: 'pdf-page-5', pageNumber: 5 }
  };
  const captured = { ...expected, locator: { ...expected }, quote: 'exact quote' };
  assert.equal(assertCitationLocatorIdentity(expected, captured), true);
  assert.throws(() => assertCitationLocatorIdentity(expected, {
    ...captured, locator: { ...captured.locator, normalizedStart: 141 }
  }), /B5_CITATION_UI_LOCATOR_IDENTITY_MISMATCH/u);
  assert.throws(() => assertCitationLocatorIdentity(expected, {
    ...captured, pageAnchor: { paragraphId: 'pdf-page-6', pageNumber: 6 }
  }), /B5_CITATION_UI_LOCATOR_IDENTITY_MISMATCH/u);
  const missingAnchor = { ...captured, pageAnchor: null,
    locator: { ...captured.locator, pageAnchor: undefined } };
  assert.throws(() => assertCitationLocatorIdentity(expected, missingAnchor),
    /B5_CITATION_UI_LOCATOR_IDENTITY_MISMATCH/u);
  assert.equal(assertCitationLocatorIdentity(expected, missingAnchor,
    'B5_CITATION_UI_LOCATOR_IDENTITY_MISMATCH', { allowMissingPageAnchor: true }), true);
  for (const invalid of [
    { ...missingAnchor, pageAnchor: {} },
    { ...missingAnchor, pageAnchor: { paragraphId: 'pdf-page-6', pageNumber: 6 } },
    { ...missingAnchor, locator: { ...missingAnchor.locator, normalizedStart: 141 } }
  ]) assert.throws(() => assertCitationLocatorIdentity(expected, invalid,
    'B5_CITATION_UI_LOCATOR_IDENTITY_MISMATCH', { allowMissingPageAnchor: true }),
  /B5_CITATION_UI_LOCATOR_IDENTITY_MISMATCH/u);
});

test('B5 selection regeneration identity ignores generation counters but binds locators', async () => {
  const { selectionLocatorIdentityDigest } = await verifierModule;
  const semanticLocator = { locatorKind: 'pdf-semantic', paragraphId: 'semantic-p-2',
    normalizedStart: 120, normalizedEnd: 125, expectedNormalizedQuote: 'hello' };
  const first = { selectionGeneration: 2, segments: [{ text: 'hello', pageNumber: 3,
    paragraphId: 'semantic-p-2', paragraphTextHash: 'hash', semanticLocator,
    pageAnchor: { paragraphId: 'pdf-page-3', pageNumber: 3 } }] };
  const regenerated = { ...first, selectionGeneration: 3,
    segments: first.segments.map(item => ({ ...item, selectionGeneration: 3 })) };
  assert.equal(selectionLocatorIdentityDigest(first),
    selectionLocatorIdentityDigest(regenerated));
  assert.notEqual(selectionLocatorIdentityDigest(first),
    selectionLocatorIdentityDigest({ ...regenerated, segments: [{
      ...regenerated.segments[0], semanticLocator: {
        ...semanticLocator, normalizedStart: 121, normalizedEnd: 126
      }
    }] }));
});

test('B5 verifier uses real extension UI and tab-message entrances', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.match(source, /chromium\.launchPersistentContext/u);
  assert.match(source, /channel:\s*'msedge'/u);
  assert.match(source, /#pdfLocalFile/u);
  assert.match(source, /chrome-extension:\/\/\$\{extensionId\}\/popup\.html/u);
  assert.match(source, /synchronizeActiveTabContext\(\{ force: true \}\)/u);
  assert.match(source, /#articleChatQuestion/u);
  assert.match(source, /#sendArticleChat/u);
  assert.match(source, /\.article-chat-inline-citation\.is-verified/u);
  assert.match(source, /#openLiteratureNote/u);
  assert.match(source, /#autofillLiteratureNote/u);
  assert.match(source, /data-generate-literature-note-field/u);
  assert.match(source, /action:\s*'focusArticleWorkspaceSource'/u);
  assert.match(source, /globalThis\.__b5AmbiguousScrolls\s*=\s*0/u);
  assert.match(source, /const ambiguousResponse = await focus/u);
  assert.match(source, /Number\(globalThis\.__b5AmbiguousScrolls\)/u);
  assert.match(source, /globalThis\.__b5LastCitationFocusTarget\s*=\s*structuredClone\(message\.target\)/u);
  assert.match(source, /const locator = target\?\.evidence\?\.locator \|\| target\?\.evidence/u);
  assert.match(source, /locator\?\.locatorKind, 'pdf-semantic'/u);
  assert.match(source, /assertCitationLocatorIdentity\(expectedEvidence, target\?\.evidence/u);
  assert.match(source, /paragraph\.pageNumbers\?\.length > 1/u);
  assert.match(source, /nativeResponsePageNumber/u);
  assert.match(source, /NATIVE_PAGE_MISMATCH/u);
  assert.match(source, /chat\.evidence, 'B5_CHAT_INITIAL_CITATION'/u);
  assert.match(source, /chat\.evidence, 'B5_CHAT_REOPEN_CITATION'/u);
  assert.match(source, /selectionTurn\.citationEvidence/u);
  assert.match(source, /reopenedSelectionState\?\.citationEvidence/u);
  assert.match(source, /regeneratedSelection\?\.citationEvidence/u);
  assert.match(source,
    /pdf-native-semantic-focus-layer'\)\.forEach\(layer => layer\.remove\(\)\)/u);
  assert.match(source, /dragSelectAcrossNativePdfPages/u);
  assert.match(source, /inspectPreparedNativePdfSelectionEvidence/u);
  assert.match(source, /\.sci-manual-llm-action/u);
  assert.match(source, /data-article-chat-action="regenerate"/u);
  assert.match(source, /reopenedSelectionState/u);
  assert.match(source, /reopenedSelectionDiagnostics/u);
  assert.match(source, /regeneratedCitation\.waitFor/u);
  assert.ok((source.match(/clickAndInspectCitation\(/gu) || []).length >= 6,
    'every chat/selection citation click must capture its UI target and verify exact overlay');
  assert.match(source, /selectionLocatorIdentityDigest/u);
  assert.match(source, /B5_SELECTION_REGENERATED_LOCATOR_IDENTITY_CHANGED/u);
  assert.match(source, /B5_SELECTION_CITATION_FOCUS_REGENERATED_FAILED/u);
});

test('B5 verifier fails closed instead of calling migration helpers directly', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.doesNotMatch(source, /migratePdfArticleChatEvidence\s*\(/u);
  assert.doesNotMatch(source, /mergeLiteratureNoteFieldEvidence\s*\(/u);
  assert.doesNotMatch(source, /mergeLiteratureNoteEvidenceTable\s*\(/u);
  assert.match(source, /B5_CHAT_SEMANTIC_LOCATOR_NOT_SAVED/u);
  assert.match(source, /B5_NOTE_TABLE_EVIDENCE_NOT_SAVED/u);
  assert.match(source, /B5_REPLACEMENT_NOT_STALE/u);
  assert.match(source, /whole\.fieldIds\.every\(fieldId\s*=>/u);
  assert.doesNotMatch(source, /globalThis\.__brevess(?:PdfSemanticDocument|NativePdfDocument|PdfSemanticCompatibility)\s*=/u);
  assert.match(source, /fixture: 'earlier-native-publication'/u);
  assert.match(source, /B5_EARLIER_NATIVE_REVISION_SAMPLE_MISSING/u);
});

test('B5 verifier blocks external HTTP and records browser error surfaces', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.match(source, /context\.route\(\/\^https\?:\\\/\\\//u);
  assert.match(source, /route\.abort\('blockedbyclient'\)/u);
  assert.match(source, /realApiCalls:\s*0/u);
  assert.match(source, /externalHttpRequests/u);
  assert.match(source, /fixtureErrors/u);
  assert.match(source, /pageErrors/u);
  assert.match(source, /consoleErrors/u);
  assert.match(source, /workerErrors/u);
  assert.match(source, /collectPanelFailureDiagnostics/u);
  assert.match(source, /fixtureProfileConfigured/u);
  assert.match(source, /latestTurnErrorCode/u);
  assert.match(source, /NON_CODE_ERROR/u);
  assert.match(source, /action === 'askArticleWithLLM'/u);
  assert.match(source, /globalThis\.__b5ChatDispatch/u);
  assert.match(source, /B5_CHAT_DISPATCH_REJECTED/u);
  assert.match(source, /MESSAGE_RECEIVER_MISSING/u);
  assert.match(source, /PROXY_ACCESS_ERROR/u);
  assert.match(source, /semanticNavigationReady/u);
  assert.match(source, /citationStates/u);
  assert.match(source, /locatorShape/u);
  assert.match(source, /semanticContextShape/u);
  assert.match(source, /B5_CONTINUATION_QUOTE/u);
  assert.match(source, /resolveSemanticHighlight\?\.\(evidence\)/u);
  assert.match(source,
    /const rawLocatorShape = await reader\.evaluate\([\s\S]*?resolveSemanticHighlight\?\.\(evidence\)/u);
  assert.match(source, /Object\.assign\(chat\.locatorShape, rawLocatorShape\)/u);
  assert.match(source, /pageAnchorMatchesRaw/u);
  assert.doesNotMatch(source,
    /Number\(evidence\.pageAnchor\.pageNumber\)\s*===\s*\n?\s*Number\(target\?\.pageNumber\)/u);
});

test('B5 failure codes are stable and do not expose arbitrary diagnostics', async () => {
  const { stableFailureCode } = await verifierModule;
  assert.equal(stableFailureCode(new Error('B5_NOTE_FIELD_EVIDENCE_NOT_SAVED')),
    'B5_NOTE_FIELD_EVIDENCE_NOT_SAVED');
  assert.equal(stableFailureCode(new Error('private paper contents')),
    'B5_LIVE_ACCEPTANCE_FAILED');
});

test('B5 DeepSeek boundary keeps credentials outside the extension and caps before fetch', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.match(source, /readSecretFromTty\(\{ prompt: 'DeepSeek API key: ' \}\)/u);
  assert.match(source, /request\.headers\.authorization, `Bearer \$\{DUMMY_SECRET\}`/u);
  assert.match(source, /state\.calls >= maxProviderCalls/u);
  assert.ok(source.indexOf('state.calls >= maxProviderCalls') <
    source.indexOf("fetch('https://api.deepseek.com/chat/completions'"));
  assert.match(source, /B5_PROVIDER_CALL_COUNT_CHANGED/u);
  assert.doesNotMatch(source, /process\.env\.(?:DEEPSEEK|API)/u);
});
