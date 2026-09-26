const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const scriptPath = path.join(root, 'scripts', 'verify-pdf-figure-production-live.mjs');

async function verifier() {
  return import(`${pathToFileURL(scriptPath).href}?contract=${Date.now()}`);
}

function validReport(api) {
  const report = api.createReport({ outputDirectory: 'redacted-output' });
  report.status = 'PASS';
  report.source = {
    pdfSha256: api.FIXTURE_DESCRIPTOR.sha256,
    pdfBytes: 1024,
    pageCount: 12,
    figureCount: 5
  };
  report.figure = {
    figureIdSha256: '1'.repeat(64),
    captionCharacters: 50,
    captionSha256: '2'.repeat(64),
    bodyCharacters: 500,
    bodySha256: '3'.repeat(64),
    paragraphIdCount: 3,
    paragraphIdsSha256: '4'.repeat(64),
    rawRangeCount: 3,
    rawRangesSha256: '5'.repeat(64),
    traceableRawRangeCount: 3
  };
  report.routes = {
    text: {
      status: 'PASS', providerCallDelta: 1, imageInputCount: 0,
      handshakeStatus: 'PASS', resultSha256: '6'.repeat(64),
      inventoryRequestCount: 0, analysisRequestCount: 1
    },
    vision: {
      status: 'PASS', providerCallDelta: 2, imageInputCount: 1,
      handshakeStatus: 'PASS', registeredImageSha256: '7'.repeat(64),
      providerImageSha256: '7'.repeat(64), imageBytes: 4096,
      resultSha256: '8'.repeat(64), inventoryRequestCount: 1,
      analysisRequestCount: 1, inventoryFirst: true,
      inventorySchemaName: 'pdf_figure_panel_inventory_standalone',
      inventoryContractVersion: 'pdf-figure-panel-inventory-v2',
      inventoryImageSha256: '7'.repeat(64), analysisImageSha256: '7'.repeat(64),
      inventoryBoundImageContentHash: '7'.repeat(64),
      inventoryBoundSemanticContextDigest: 'a'.repeat(64),
      envelopeSemanticContextDigest: 'a'.repeat(64),
      firstAnalysisExpectedPanelLabels: ['A', 'B', 'C', 'D']
    },
    inventorySourceDrift: {
      status: 'PASS', providerCallDelta: 1, inventoryRequestCount: 1,
      analysisRequestCount: 0, errorCode: 'PDF_FIGURE_CONTEXT_STALE'
    },
    staleOwner: {
      status: 'PASS', providerCallDelta: 0, errorCode: 'PDF_FIGURE_CONTEXT_STALE'
    }
  };
  report.network = {
    fixtureOnly: true, externalRequestCount: 0, providerRequestCount: 2,
    providerRequests: []
  };
  report.stages = api.STAGE_ORDER.map(name => ({
    name, status: 'PASS', receiptSha256: '9'.repeat(64)
  }));
  return report;
}

test('live verifier pins the real eLife PDF and fixed acceptance stages', async () => {
  const api = await verifier();
  assert.equal(api.createReport().schemaVersion, 2);
  assert.equal(api.FIXTURE_DESCRIPTOR.relativePath,
    'tmp/public-pdf-acceptance/elife-83176-v2.pdf');
  assert.equal(api.FIXTURE_DESCRIPTOR.sha256,
    '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1');
  assert.equal(api.FIXTURE_DESCRIPTOR.expectedFigureCount, 4);
  assert.deepEqual(api.STAGE_ORDER, [
    'source', 'reader', 'figure-context', 'text-route', 'vision-route',
    'inventory-source-drift', 'stale-owner'
  ]);
});

test('provider request receipt hashes evidence without retaining secret or source text', async () => {
  const api = await verifier();
  const image = Buffer.alloc(4096, 0x5a);
  const sourceText = 'UNIQUE_PRIVATE_CAPTION_SENTINEL';
  const request = {
    model: 'local-fixture-model',
    messages: [{ role: 'user', content: [
      { type: 'text', text: JSON.stringify({
        figure_id: 'figure-1', pass: 'single_pass', caption: sourceText,
        expected_panel_labels: ['A', 'B', 'C', 'D']
      }) },
      { type: 'image_url', image_url: {
        url: `data:image/png;base64,${image.toString('base64')}`
      } }
    ] }]
  };
  const receipt = api.summarizeOpenAiRequest(request, {
    authorization: 'Bearer local-fixture-secret'
  });
  assert.equal(receipt.imageInputCount, 1);
  assert.equal(receipt.imageBytes, image.length);
  assert.match(receipt.providerImageSha256, /^[a-f0-9]{64}$/u);
  assert.match(receipt.requestSha256, /^[a-f0-9]{64}$/u);
  assert.equal(receipt.authorizationPresent, true);
  assert.equal(receipt.requestKind, 'figure-analysis');
  assert.deepEqual(receipt.expectedPanelLabels, ['A', 'B', 'C', 'D']);
  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(serialized, /UNIQUE_PRIVATE_CAPTION_SENTINEL|local-fixture-secret|data:image/iu);
});

test('inventory request receipt exposes only bounded v2 binding and sequence metadata', async () => {
  const api = await verifier();
  const image = Buffer.alloc(4096, 0x5a);
  const request = {
    model: 'local-fixture-model',
    messages: [{ role: 'user', content: [
      { type: 'text', text: JSON.stringify({
        contract_version: 'pdf-figure-panel-inventory-v2',
        mode: 'standalone',
        figure_identity: { figure_id: 'figure-1', figure_label: 'Figure 1',
          page_numbers: [4], caption_anchor: 'PRIVATE_CAPTION' },
        provenance: { image_content_hash: '7'.repeat(64),
          semantic_context_digest: 'a'.repeat(64) }
      }) },
      { type: 'image_url', image_url: {
        url: `data:image/png;base64,${image.toString('base64')}`
      } }
    ] }]
  };
  const receipt = api.summarizeOpenAiRequest(request);
  assert.equal(receipt.requestKind, 'panel-inventory');
  assert.equal(receipt.schemaName, 'pdf_figure_panel_inventory_standalone');
  assert.equal(receipt.contractVersion, 'pdf-figure-panel-inventory-v2');
  assert.equal(receipt.imageContentHash, '7'.repeat(64));
  assert.equal(receipt.semanticContextDigest, 'a'.repeat(64));
  assert.equal(receipt.imageInputCount, 1);
  assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_CAPTION/u);
});

test('fixture response covers real figure passes without echoing input text', async () => {
  const api = await verifier();
  for (const pass of ['single_pass', 'panel_extraction', 'figure_synthesis']) {
    const value = api.createFixtureFigureResponse({
      figure_id: 'figure-1', analysis_basis: 'caption_context',
      analysis_depth: 'standard', expected_panel_labels: ['A'], pass,
      caption: 'DO_NOT_ECHO_THIS_CAPTION'
    });
    assert.equal(value.figure_id, 'figure-1');
    assert.doesNotMatch(JSON.stringify(value), /DO_NOT_ECHO_THIS_CAPTION/u);
    if (pass !== 'figure_synthesis') assert.ok(value.panels.length > 0);
  }
});

test('fixture returns an exactly bound coordinate-free A-D inventory only for an inbound v2 request', async () => {
  const api = await verifier();
  const value = api.createFixtureProviderResponse({
    contract_version: 'pdf-figure-panel-inventory-v2',
    mode: 'standalone',
    figure_identity: { figure_id: 'figure-1' },
    provenance: {
      image_content_hash: '7'.repeat(64),
      semantic_context_digest: 'a'.repeat(64)
    }
  });
  const inventory = value.panel_marker_inventory;
  assert.equal(inventory.figure_id, 'figure-1');
  assert.equal(inventory.image_content_hash, '7'.repeat(64));
  assert.equal(inventory.semantic_context_digest, 'a'.repeat(64));
  assert.equal(inventory.inventory_complete, true);
  assert.deepEqual(inventory.markers.map(marker => marker.label), ['A', 'B', 'C', 'D']);
  assert.ok(inventory.markers.every(marker =>
    Object.keys(marker).sort().join(',') === 'clarity,label' && marker.clarity === 'clear'));
});

test('caption diagnostics distinguish incomplete index, text mismatch, and locator failure', async () => {
  const api = await verifier();
  const base = {
    semanticPhase: 'text-ready', pageCount: 23, indexedPageCount: 23,
    mappingCount: 23, missingPageCount: 0, failedPageCount: 0,
    exactCaptionMatchCount: 1, rawPageExactCaptionMatchCount: 1,
    fallbackCandidateCount: 1, fallbackTopTied: false,
    referenceParagraphCount: 2, verifiedReferenceParagraphCount: 2
  };
  assert.equal(api.classifyCaptionDiagnostics(base), 'CAPTION_BINDING_SHOULD_RESOLVE');
  assert.equal(api.classifyCaptionDiagnostics({ ...base, indexedPageCount: 4 }),
    'SEMANTIC_INDEX_INCOMPLETE');
  assert.equal(api.classifyCaptionDiagnostics({
    ...base, exactCaptionMatchCount: 0, rawPageExactCaptionMatchCount: 0,
    fallbackCandidateCount: 0
  }), 'CAPTION_TEXT_ABSENT');
  assert.equal(api.classifyCaptionDiagnostics({
    ...base, verifiedReferenceParagraphCount: 1
  }), 'LOCATOR_UNRESOLVED');
  assert.equal(api.classifyCaptionDiagnostics({
    ...base, exactCaptionMatchCount: 0, fallbackTopTied: true
  }), 'CAPTION_FALLBACK_AMBIGUOUS');
});

test('report audit enforces text, real-image, stale-owner, and privacy gates', async () => {
  const api = await verifier();
  const report = validReport(api);
  assert.equal(api.auditReport(report).status, 'PASS');

  const onePixel = structuredClone(report);
  onePixel.routes.vision.imageBytes = 68;
  assert.throws(() => api.auditReport(onePixel), /VISION_IMAGE_BYTES_TOO_SMALL/u);

  const mismatch = structuredClone(report);
  mismatch.routes.vision.providerImageSha256 = 'a'.repeat(64);
  assert.throws(() => api.auditReport(mismatch), /VISION_IMAGE_HASH_MISMATCH/u);

  const leaked = structuredClone(report);
  leaked.failure = { message: 'Bearer secret source caption' };
  assert.throws(() => api.auditReport(leaked), /REPORT_FIELD_NOT_ALLOWED/u);

  const dispatched = structuredClone(report);
  dispatched.routes.staleOwner.providerCallDelta = 1;
  assert.throws(() => api.auditReport(dispatched), /STALE_OWNER_PROVIDER_DISPATCHED/u);

  const textInventory = structuredClone(report);
  textInventory.routes.text.inventoryRequestCount = 1;
  assert.throws(() => api.auditReport(textInventory), /TEXT_ROUTE_HAS_INVENTORY/u);

  const wrongOrder = structuredClone(report);
  wrongOrder.routes.vision.inventoryFirst = false;
  assert.throws(() => api.auditReport(wrongOrder), /VISION_INVENTORY_NOT_FIRST/u);

  const wrongPanels = structuredClone(report);
  wrongPanels.routes.vision.firstAnalysisExpectedPanelLabels = ['B', 'C', 'D'];
  assert.throws(() => api.auditReport(wrongPanels), /VISION_ANALYSIS_PANEL_SCOPE_MISMATCH/u);

  const driftDispatched = structuredClone(report);
  driftDispatched.routes.inventorySourceDrift.analysisRequestCount = 1;
  assert.throws(() => api.auditReport(driftDispatched),
    /INVENTORY_SOURCE_DRIFT_ANALYSIS_DISPATCHED/u);
});

test('script is wired to Edge, the actual PDF reader, whole-Figure UI, and local-only routing', async () => {
  await verifier();
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.match(source, /channel:\s*['"]msedge['"]/u);
  assert.match(source, /launchPersistentContext/u);
  assert.match(source, /pdf-reader\.html/u);
  assert.match(source, /#pdfLocalFile/u);
  assert.match(source, /\.workspace-figure-analyze-action/u);
  assert.match(source, /LLM_SAVE_PROFILE/u);
  assert.match(source, /openai-compatible/u);
  assert.match(source, /127\.0\.0\.1/u);
  assert.match(source, /validatePdfFigureProductionContext/u);
  assert.match(source, /lastFigureResponseCode/u);
  assert.match(source,
    /safeCode\(\s*staleProbeAfter\.lastFigureResponseCode\s*\|\|\s*staleResult\.errorCode\s*\)/u);
  assert.match(source,
    /registeredImageBytes\s*=\s*Number\(resolved\?\.bytes\?\.byteLength\s*\|\|\s*0\)/u);
  assert.match(source, /armInventoryResponseGate/u);
  assert.match(source, /const value = createFixtureProviderResponse\(payload\)/u);
  assert.match(source, /inventoryResultReady/u);
  assert.match(source, /restorePdfSemanticOwner/u);
  assert.match(source, /report\.routes\.inventorySourceDrift\s*=\s*sourceDriftRoute/u);
  assert.ok(
    source.indexOf('report.routes.inventorySourceDrift = sourceDriftRoute;') <
      source.indexOf("assert.equal(sourceDriftRoute.status, 'PASS'"),
    'inventory source-drift evidence must be persisted before the gate can throw'
  );
  assert.ok(
    source.indexOf('report.routes.staleOwner = staleRoute;') <
      source.indexOf("assert.equal(staleRoute.status, 'PASS'"),
    'stale-owner evidence must be persisted before the gate can throw'
  );
  assert.doesNotMatch(source, /createPdfFigureContextProductionAdapter|mock.*selector|mock.*router/iu);
});
