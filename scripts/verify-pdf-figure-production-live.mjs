import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const FIXTURE_DESCRIPTOR = Object.freeze({
  relativePath: 'tmp/public-pdf-acceptance/elife-83176-v2.pdf',
  sha256: '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1',
  expectedPageCount: 23,
  expectedFigureCount: 4,
  targetFigureId: 'figure-1'
});

export const STAGE_ORDER = Object.freeze([
  'source', 'reader', 'figure-context', 'text-route', 'vision-route',
  'inventory-source-drift', 'stale-owner'
]);

export const REAL_DEEPSEEK_FOLLOW_UP = Object.freeze([
  'Keep the pinned PDF hash, Edge persistent profile, native reader, Figure UI action, and all report audits unchanged.',
  'Replace only the loopback profile with an explicitly authorized DeepSeek profile; read the API key interactively and never persist or print it.',
  'Allow only the exact DeepSeek endpoint through a loopback boundary proxy; retain request counts and request hashes, never prompt or PDF text.',
  'Run text and vision as separate fresh-profile executions, then compare result hashes and the registered-image hash receipt.',
  'Keep the owner-drift run local because it must prove zero provider dispatch.'
]);

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sha256File = filename => sha256(fs.readFileSync(filename));
const jsonHash = value => sha256(JSON.stringify(value));
const isHash = value => /^[a-f0-9]{64}$/u.test(String(value || ''));

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeCode(error) {
  const generic = ['ERR_ASSERTION', 'ERROR'].includes(String(error?.code || '').toUpperCase());
  const candidate = String((generic ? error?.message : error?.code) || error?.message || error ||
    'UNCLASSIFIED_FAILURE').split(/\r?\n/u)[0]
    .toUpperCase().replace(/[^A-Z0-9_:-]+/gu, '_').slice(0, 120);
  return /^[A-Z][A-Z0-9_:-]{2,119}$/u.test(candidate) ? candidate : 'UNCLASSIFIED_FAILURE';
}

function stableReceipt(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => item === undefined ? null : item));
}

export function createReport() {
  return {
    schemaVersion: 2,
    status: 'RUNNING',
    realPdf: true,
    browser: { engine: 'msedge', status: 'PENDING' },
    source: {},
    sourceHashes: {},
    figure: {},
    routes: {},
    network: {
      fixtureOnly: true,
      externalRequestCount: 0,
      providerRequestCount: 0,
      providerRequests: []
    },
    stages: STAGE_ORDER.map(name => ({
      name, status: 'NOT_RUN', receiptSha256: sha256(`${name}:NOT_RUN`)
    })),
    errorCode: '',
    failureEvidenceSha256: '',
    elapsedMs: 0
  };
}

export function classifyCaptionDiagnostics(value = {}) {
  const pageCount = Number(value.pageCount) || 0;
  const indexedPageCount = Number(value.indexedPageCount) || 0;
  const mappingCount = Number(value.mappingCount) || 0;
  if (value.semanticPhase !== 'text-ready' || !pageCount ||
      indexedPageCount < pageCount || mappingCount < pageCount ||
      Number(value.missingPageCount) > 0 || Number(value.failedPageCount) > 0) {
    return 'SEMANTIC_INDEX_INCOMPLETE';
  }
  if (Number(value.verifiedReferenceParagraphCount) <
      Number(value.referenceParagraphCount)) return 'LOCATOR_UNRESOLVED';
  if (Number(value.exactCaptionMatchCount) > 1) return 'CAPTION_EXACT_MATCH_AMBIGUOUS';
  if (Number(value.exactCaptionMatchCount) === 1) return 'CAPTION_BINDING_SHOULD_RESOLVE';
  if (value.fallbackTopTied === true) return 'CAPTION_FALLBACK_AMBIGUOUS';
  if (Number(value.fallbackCandidateCount) > 0) return 'CAPTION_LAYOUT_FALLBACK_ELIGIBLE';
  return 'CAPTION_TEXT_ABSENT';
}

function stageRecorder(report, persist) {
  const started = new Map();
  const set = (name, status, metrics = {}) => {
    const stage = report.stages.find(item => item.name === name);
    assert.ok(stage, `UNKNOWN_STAGE:${name}`);
    const elapsedMs = started.has(name) ? Date.now() - started.get(name) : 0;
    const { name: _ignoredName, status: _ignoredStatus, ...boundedMetrics } = metrics;
    const safe = stableReceipt({ name, status, elapsedMs, ...boundedMetrics });
    Object.assign(stage, safe, { receiptSha256: jsonHash(safe) });
    persist();
  };
  return {
    start(name) { started.set(name, Date.now()); set(name, 'RUNNING'); },
    pass(name, metrics = {}) { set(name, 'PASS', metrics); },
    fail(name, code, evidenceSha256, metrics = {}) {
      set(name, 'FAIL', { errorCode: code, evidenceSha256, ...metrics });
    }
  };
}

function openAiUserMessage(body) {
  return [...(Array.isArray(body?.messages) ? body.messages : [])]
    .reverse().find(item => item?.role === 'user');
}

function openAiUserPayload(body) {
  const content = openAiUserMessage(body)?.content;
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.find(item => item?.type === 'text')?.text || '' : '';
  try { return JSON.parse(text); } catch (_) { return {}; }
}

export function summarizeOpenAiRequest(body, headers = {}) {
  const content = openAiUserMessage(body)?.content;
  const imageUrls = (Array.isArray(content) ? content : [])
    .filter(item => item?.type === 'image_url')
    .map(item => String(item?.image_url?.url || ''));
  const images = imageUrls.filter(value => /^data:image\//iu.test(value)).map(value => {
    const comma = value.indexOf(',');
    const bytes = comma >= 0 ? Buffer.from(value.slice(comma + 1), 'base64') : Buffer.alloc(0);
    return { bytes: bytes.length, sha256: sha256(bytes) };
  });
  const payload = openAiUserPayload(body);
  const inventoryRequest = payload.contract_version === 'pdf-figure-panel-inventory-v2' &&
    payload.mode === 'standalone' && payload.figure_identity && payload.provenance;
  const expectedPanelLabels = Array.isArray(payload.expected_panel_labels)
    ? payload.expected_panel_labels.map(value => String(value || '').trim().toUpperCase())
      .filter(Boolean).slice(0, 30) : [];
  const figureId = inventoryRequest ? payload.figure_identity.figure_id : payload.figure_id;
  return {
    status: 'RECEIVED',
    requestSha256: jsonHash(body),
    payloadKindSha256: sha256(String(payload.pass || 'single_pass')),
    requestKind: inventoryRequest ? 'panel-inventory' : 'figure-analysis',
    schemaName: inventoryRequest ? 'pdf_figure_panel_inventory_standalone' : '',
    contractVersion: inventoryRequest ? String(payload.contract_version) : '',
    figureIdSha256: sha256(String(figureId || '')),
    imageContentHash: inventoryRequest
      ? String(payload.provenance.image_content_hash || '') : '',
    semanticContextDigest: inventoryRequest
      ? String(payload.provenance.semantic_context_digest || '') : '',
    expectedPanelLabels,
    imageInputCount: imageUrls.length,
    dataImageCount: images.length,
    imageBytes: images.reduce((sum, image) => sum + image.bytes, 0),
    providerImageSha256: images.length === 1 ? images[0].sha256 : '',
    authorizationPresent: Boolean(headers.authorization || headers.Authorization)
  };
}

function fixturePanel(label, index, basis) {
  return {
    panel: label,
    role: index === 0 ? 'sufficiency' : 'phenotype',
    phenotype_name_zh: `本地验收 Panel ${label}`,
    method_category: 'wet_lab',
    methods: ['Immunofluorescence'],
    evidence_type_zh: '有边界的实验结果',
    experimental_methods: ['免疫荧光'],
    statistical_methods: ['非配对 t 检验'],
    method_source: basis === 'vision_text' ? 'image' : 'caption',
    purpose_zh: `验证 Panel ${label} 的局部作用`,
    design_zh: `Panel ${label} 的处理组与对照组比较`,
    comparison_zh: `Panel ${label}：处理组与对照组`,
    direct_observation_zh: `Panel ${label} 显示一个有边界的差异`,
    observation_source: basis === 'vision_text' ? 'image_observation' : 'caption_statement',
    local_inference_zh: `Panel ${label} 只支持局部证据步骤`,
    contribution_zh: `Panel ${label} 推进当前 Figure 论证`
  };
}

export function createFixtureFigureResponse(input = {}) {
  const basis = input.analysis_basis === 'vision_text' ? 'vision_text' : 'caption_context';
  const depth = input.analysis_depth === 'deep' ? 'deep' : 'standard';
  const requested = Array.isArray(input.expected_panel_labels)
    ? input.expected_panel_labels
    : Array.isArray(input.panel_evidence)
      ? input.panel_evidence.map(item => item?.panel) : ['A'];
  const labels = [...new Set(requested.map(value => String(value || '').trim().toUpperCase())
    .filter(Boolean))];
  if (!labels.length) labels.push('A');
  const panels = labels.map((label, index) => fixturePanel(label, index, basis));
  const result = {
    figure_id: String(input.figure_id || ''),
    analysis_depth: depth,
    basis,
    figure_title_zh: '本地确定性 Figure 验收',
    figure_question_zh: '各 Panel 如何支持当前结论？',
    remaining_question_zh: '仍需独立实验验证外推边界。',
    panels,
    panel_groups: [{
      panels: labels,
      group_goal_zh: '建立主要证据',
      group_conclusion_zh: '当前结果支持一个有边界的局部结论'
    }],
    logic_bridges: [],
    argument_chain: [{
      panels: labels,
      established_zh: '当前证据建立主要现象。',
      handoff_zh: '该现象需要后续机制检验。',
      evidence_level: 'association'
    }],
    author_assembly_zh: '作者按证据块组织当前 Figure。',
    core_conclusion_zh: '当前 Figure 建立一条有边界的证据链。',
    claim_boundary_zh: '本地 fixture 只验证生产路由，不生成真实科学判断。'
  };
  if (input.pass === 'panel_extraction') {
    return { figure_id: result.figure_id, analysis_depth: depth, basis, panels };
  }
  if (input.pass === 'figure_synthesis') {
    const { panels: _panels, ...synthesis } = result;
    return synthesis;
  }
  return result;
}

export function createFixtureProviderResponse(input = {}) {
  if (input.contract_version === 'pdf-figure-panel-inventory-v2' &&
      input.mode === 'standalone' && input.figure_identity && input.provenance) {
    return {
      panel_marker_inventory: {
        figure_id: String(input.figure_identity.figure_id || ''),
        image_content_hash: String(input.provenance.image_content_hash || ''),
        semantic_context_digest: String(input.provenance.semantic_context_digest || ''),
        inventory_complete: true,
        markers: ['A', 'B', 'C', 'D'].map(label => ({ label, clarity: 'clear' }))
      }
    };
  }
  return createFixtureFigureResponse(input);
}

function assertNoReportLeak(report) {
  const forbiddenKeys = new Set([
    'message', 'prompt', 'text', 'caption', 'apikey', 'secret', 'dataurl',
    'authorization', 'raw', 'quote'
  ]);
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key.toLowerCase()) &&
          (item === null || typeof item !== 'object')) {
        throw codedError('REPORT_FIELD_NOT_ALLOWED');
      }
      visit(item);
    }
  };
  visit(report);
  const serialized = JSON.stringify(report);
  if (/Bearer\s|data:image\/|BEGIN PRIVATE|api[_-]?key/iu.test(serialized)) {
    throw codedError('REPORT_VALUE_NOT_ALLOWED');
  }
}

export function auditReport(report) {
  assertNoReportLeak(report);
  assert.equal(report.status, 'PASS', 'REPORT_NOT_PASS');
  assert.equal(report.source?.pdfSha256, FIXTURE_DESCRIPTOR.sha256, 'SOURCE_HASH_MISMATCH');
  assert.ok(report.figure?.captionCharacters > 0, 'FIGURE_CAPTION_EMPTY');
  assert.ok(report.figure?.bodyCharacters > 0, 'FIGURE_BODY_EMPTY');
  assert.ok(report.figure?.paragraphIdCount > 0, 'FIGURE_PARAGRAPH_IDS_EMPTY');
  assert.ok(report.figure?.rawRangeCount > 0, 'FIGURE_RAW_RANGES_EMPTY');
  assert.equal(report.figure?.traceableRawRangeCount, report.figure?.rawRangeCount,
    'FIGURE_RAW_RANGES_NOT_TRACEABLE');
  assert.equal(report.routes?.text?.status, 'PASS', 'TEXT_ROUTE_FAILED');
  assert.ok(report.routes.text.providerCallDelta > 0, 'TEXT_ROUTE_NO_PROVIDER_CALL');
  assert.equal(report.routes.text.imageInputCount, 0, 'TEXT_ROUTE_HAS_IMAGE');
  assert.equal(report.routes.text.inventoryRequestCount, 0, 'TEXT_ROUTE_HAS_INVENTORY');
  assert.ok(report.routes.text.analysisRequestCount > 0, 'TEXT_ROUTE_NO_ANALYSIS_REQUEST');
  assert.equal(report.routes.text.handshakeStatus, 'PASS', 'TEXT_HANDSHAKE_MISSING');
  assert.equal(report.routes?.vision?.status, 'PASS', 'VISION_ROUTE_FAILED');
  assert.ok(report.routes.vision.providerCallDelta > 0, 'VISION_ROUTE_NO_PROVIDER_CALL');
  assert.equal(report.routes.vision.imageInputCount, 1, 'VISION_IMAGE_COUNT_INVALID');
  assert.equal(report.routes.vision.handshakeStatus, 'PASS', 'VISION_HANDSHAKE_MISSING');
  assert.ok(report.routes.vision.imageBytes >= 1024, 'VISION_IMAGE_BYTES_TOO_SMALL');
  assert.ok(isHash(report.routes.vision.registeredImageSha256), 'VISION_REGISTERED_HASH_MISSING');
  assert.equal(report.routes.vision.providerImageSha256,
    report.routes.vision.registeredImageSha256, 'VISION_IMAGE_HASH_MISMATCH');
  assert.equal(report.routes.vision.inventoryRequestCount, 1,
    'VISION_INVENTORY_REQUEST_COUNT_INVALID');
  assert.ok(report.routes.vision.analysisRequestCount > 0, 'VISION_ANALYSIS_REQUEST_MISSING');
  assert.equal(report.routes.vision.inventoryFirst, true, 'VISION_INVENTORY_NOT_FIRST');
  assert.equal(report.routes.vision.inventorySchemaName,
    'pdf_figure_panel_inventory_standalone', 'VISION_INVENTORY_SCHEMA_MISMATCH');
  assert.equal(report.routes.vision.inventoryContractVersion,
    'pdf-figure-panel-inventory-v2', 'VISION_INVENTORY_VERSION_MISMATCH');
  assert.equal(report.routes.vision.inventoryImageSha256,
    report.routes.vision.registeredImageSha256, 'VISION_INVENTORY_IMAGE_MISMATCH');
  assert.equal(report.routes.vision.analysisImageSha256,
    report.routes.vision.registeredImageSha256, 'VISION_ANALYSIS_IMAGE_MISMATCH');
  assert.equal(report.routes.vision.inventoryBoundImageContentHash,
    report.routes.vision.registeredImageSha256, 'VISION_INVENTORY_BINDING_IMAGE_MISMATCH');
  assert.equal(report.routes.vision.inventoryBoundSemanticContextDigest,
    report.routes.vision.envelopeSemanticContextDigest,
    'VISION_INVENTORY_BINDING_SEMANTIC_MISMATCH');
  assert.deepEqual(report.routes.vision.firstAnalysisExpectedPanelLabels,
    ['A', 'B', 'C', 'D'], 'VISION_ANALYSIS_PANEL_SCOPE_MISMATCH');
  assert.equal(report.routes?.inventorySourceDrift?.status, 'PASS',
    'INVENTORY_SOURCE_DRIFT_ROUTE_FAILED');
  assert.equal(report.routes.inventorySourceDrift.inventoryRequestCount, 1,
    'INVENTORY_SOURCE_DRIFT_REQUEST_COUNT_INVALID');
  assert.equal(report.routes.inventorySourceDrift.providerCallDelta, 1,
    'INVENTORY_SOURCE_DRIFT_PROVIDER_COUNT_INVALID');
  assert.equal(report.routes.inventorySourceDrift.analysisRequestCount, 0,
    'INVENTORY_SOURCE_DRIFT_ANALYSIS_DISPATCHED');
  assert.equal(report.routes.inventorySourceDrift.errorCode, 'PDF_FIGURE_CONTEXT_STALE',
    'INVENTORY_SOURCE_DRIFT_CODE_MISMATCH');
  assert.equal(report.routes?.staleOwner?.status, 'PASS', 'STALE_OWNER_ROUTE_FAILED');
  assert.equal(report.routes.staleOwner.providerCallDelta, 0,
    'STALE_OWNER_PROVIDER_DISPATCHED');
  assert.equal(report.routes.staleOwner.errorCode, 'PDF_FIGURE_CONTEXT_STALE',
    'STALE_OWNER_CODE_MISMATCH');
  assert.equal(report.network?.fixtureOnly, true, 'NETWORK_NOT_FIXTURE_ONLY');
  assert.equal(report.network?.externalRequestCount, 0, 'EXTERNAL_NETWORK_REQUESTED');
  assert.ok(STAGE_ORDER.every(name => report.stages.some(stage =>
    stage.name === name && stage.status === 'PASS' && isHash(stage.receiptSha256))),
  'STAGE_RECEIPT_INCOMPLETE');
  return { status: 'PASS', reportSha256: jsonHash(report) };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--headed') options.headed = true;
    else if (value === '--help' || value === '-h') options.help = true;
    else if (value === '--pdf') options.pdfPath = argv[++index];
    else if (value === '--extension') options.extensionRoot = argv[++index];
    else if (value === '--output') options.outputDirectory = argv[++index];
    else throw codedError('ARGUMENT_NOT_SUPPORTED');
  }
  return options;
}

function helpText() {
  return [
    'Usage: node scripts/verify-pdf-figure-production-live.mjs [options]',
    '',
    'Runs Edge against the pinned real eLife PDF and a loopback OpenAI-compatible fixture.',
    'It exercises the native reader, production Figure inventory/context, whole-Figure UI action,',
    'background validation handshake, text and inventory-to-analysis vision routes,',
    'plus post-inventory source-drift and stale-owner zero-analysis/provider-dispatch gates.',
    '',
    'Options:',
    '  --headed                 Show Edge.',
    '  --pdf <path>              Must hash to the pinned public PDF.',
    '  --extension <path>        Unpacked extension source (default: repository root).',
    '  --output <directory>      Append a timestamped redacted JSON report.',
    '',
    'Future authorized real-DeepSeek run:',
    ...REAL_DEEPSEEK_FOLLOW_UP.map((step, index) => `  ${index + 1}. ${step}`)
  ].join('\n');
}

function copyExtension(extensionRoot, targetRoot) {
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    const source = path.join(extensionRoot, directory);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(targetRoot, directory), { recursive: true });
  }
  for (const file of fs.readdirSync(extensionRoot)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(extensionRoot, file), path.join(targetRoot, file));
    }
  }
  const contentPath = path.join(targetRoot, 'content.js');
  fs.appendFileSync(contentPath, `
;(() => {
  const state = globalThis.__pdfFigureProductionLiveProbe = {
    handshakeCount: 0, ownerMutationCount: 0, mutateOwnerOnValidate: false,
    figureRequestCount: 0, lastFigureResponseCode: '', lastFigureResponseSuccess: false,
    savedSemanticOwner: null
  };
  const nativeSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = async (...args) => {
    const request = args[0];
    const observe = request?.type === 'LLM_ANALYZE_FIGURES';
    if (observe) {
      state.figureRequestCount += 1;
      state.lastFigureRequestMode = request?.figures?.[0]?.pdfFigureContext?.route || '';
      state.lastFigureRequestImageCount = Array.isArray(request?.figures?.[0]?.images)
        ? request.figures[0].images.length : 0;
      state.lastFigureRequestEnvelopePresent = Boolean(request?.figures?.[0]?.pdfFigureContext);
    }
    try {
      const response = await nativeSendMessage(...args);
      if (observe) {
        state.lastFigureResponseSuccess = response?.success === true;
        state.lastFigureResponseCode = String(
          response?.error?.code || response?.code ||
          (typeof response?.error === 'string' ? response.error : '') || ''
        ).slice(0, 120);
        state.lastFigureResponseErrorFieldCount = response?.error &&
          typeof response.error === 'object' ? Object.keys(response.error).length : 0;
      }
      return response;
    } catch (error) {
      if (observe) {
        state.lastFigureResponseSuccess = false;
        state.lastFigureResponseCode = String(error?.code || error?.name || 'SEND_THROW')
          .slice(0, 120);
      }
      throw error;
    }
  };
  chrome.runtime.onMessage.addListener(message => {
    if (message?.action !== 'validatePdfFigureProductionContext') return;
    state.handshakeCount += 1;
    state.lastAssetPresent = Boolean(message?.assetProof);
    if (state.mutateOwnerOnValidate) {
      state.mutateOwnerOnValidate = false;
      const owner = globalThis.__brevessPdfSemanticDocument;
      if (owner) {
        state.savedSemanticOwner = owner;
        globalThis.__brevessPdfSemanticDocument = Object.freeze({ ...owner });
        state.ownerMutationCount += 1;
      }
    }
  });
})();
`);
}

function safeRemoveTemporary(target, prefix) {
  const resolved = path.resolve(target);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(temporaryRoot + path.sep) ||
      !path.basename(resolved).startsWith(prefix)) return;
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function startFixtureServer() {
  const state = { requests: [], inventoryGate: null };
  const armInventoryResponseGate = () => {
    assert.equal(state.inventoryGate, null, 'INVENTORY_RESPONSE_GATE_ALREADY_ARMED');
    let announceReady;
    let releaseResponse;
    const inventoryResultReady = new Promise(resolve => { announceReady = resolve; });
    const released = new Promise(resolve => { releaseResponse = resolve; });
    state.inventoryGate = { announceReady, released };
    return {
      inventoryResultReady,
      release() {
        releaseResponse();
      }
    };
  };
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) {}
    const payload = openAiUserPayload(body);
    const receipt = summarizeOpenAiRequest(body, request.headers);
    state.requests.push(receipt);
    const value = createFixtureProviderResponse(payload);
    if (receipt.requestKind === 'panel-inventory' && state.inventoryGate) {
      const gate = state.inventoryGate;
      gate.announceReady({ requestIndex: state.requests.length - 1 });
      await gate.released;
      state.inventoryGate = null;
    }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      model: 'pdf-figure-production-local-fixture',
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 32, completion_tokens: 24, total_tokens: 56 }
    }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    state, server, armInventoryResponseGate,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    origin: `http://127.0.0.1:${server.address().port}`
  };
}

async function configureLocalProfile(panel, baseUrl, vision) {
  return panel.evaluate(async ({ baseUrl, vision }) => {
    const profileId = 'profile_pdf_figure_production_live_fixture';
    const messages = [
      {
        type: 'LLM_SAVE_PROFILE',
        profile: {
          id: profileId,
          name: 'PDF Figure production local fixture',
          providerId: 'openai-compatible',
          capabilities: { vision },
          config: {
            apiKey: 'local-fixture-only',
            model: 'pdf-figure-production-local-fixture',
            baseUrl,
            authHeader: 'Authorization',
            authPrefix: 'Bearer',
            jsonMode: true,
            supportsVision: vision,
            maxOutputTokens: 8192
          }
        }
      },
      {
        type: 'LLM_UPDATE_PROFILE_ROUTING',
        globalProfileId: profileId,
        taskRoutes: { figure: { mode: 'profile', profileId } }
      },
      {
        type: 'LLM_UPDATE_PREFERENCES',
        preferences: { mode: 'llm', consentGranted: true }
      }
    ];
    const statuses = [];
    for (const message of messages) {
      const result = await chrome.runtime.sendMessage(message);
      statuses.push(result?.success === true);
    }
    if (typeof loadLlmSettings === 'function') await loadLlmSettings();
    if (typeof refreshArticleWorkspace === 'function') await refreshArticleWorkspace({ force: true });
    return { status: statuses.every(Boolean) ? 'PASS' : 'FAIL', vision };
  }, { baseUrl, vision });
}

async function waitForNativeReader(reader) {
  await reader.waitForFunction(() => {
    const native = globalThis.__brevessNativePdfDocument;
    const page = document.querySelector('.pdf-native-page[data-pdf-page-number="1"]');
    const canvas = page?.querySelector('canvas');
    return document.querySelector('#pdfNativeViewer')?.dataset?.state === 'ready' &&
      native?.phase === 'text-ready' && native?.structure?.documentHash &&
      page?.classList.contains('is-rendered') && canvas?.width > 0 && canvas?.height > 0 &&
      document.documentElement.dataset.pdfWorkspaceReady === 'true' &&
      document.documentElement.dataset.pdfWorkspaceIndexed === 'true' &&
      Array.isArray(globalThis.__brevessNativePdfFigures?.figures);
  }, null, { timeout: 120_000 });
}

async function readerReceipt(reader) {
  return reader.evaluate(() => {
    const native = globalThis.__brevessNativePdfDocument;
    const figures = globalThis.__brevessNativePdfFigures?.figures || [];
    const canvas = document.querySelector(
      '.pdf-native-page[data-pdf-page-number="1"] canvas'
    );
    return {
      status: 'PASS',
      documentHash: String(native?.structure?.documentHash || ''),
      pageCount: Number(native?.pageCount) || 0,
      figureCount: figures.length,
      targetPresent: figures.some(figure => figure?.figureId === 'figure-1'),
      canvasPixels: Number(canvas?.width || 0) * Number(canvas?.height || 0)
    };
  });
}

async function captionDiagnosticReceipt(reader, figureId) {
  const value = await reader.evaluate(async figureId => {
    const semantic = globalThis.__brevessPdfSemanticDocument;
    const compatibility = globalThis.__brevessPdfSemanticCompatibility;
    const index = semantic?.index;
    const figure = (globalThis.__brevessNativePdfFigures?.figures || [])
      .find(item => item?.figureId === figureId);
    const normalize = input => String(input || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const caption = normalize(figure?.caption);
    const figurePages = [...new Set([
      Number(figure?.pageNumber),
      ...(Array.isArray(figure?.pageNumbers) ? figure.pageNumbers.map(Number) : [])
    ].filter(value => Number.isSafeInteger(value) && value > 0))];
    const paragraphs = Array.isArray(index?.paragraphs) ? index.paragraphs : [];
    const mappings = Array.isArray(index?.mappings) ? index.mappings : [];
    const targets = new Map();
    const pending = Array.isArray(compatibility?.semanticNavigation?.sections)
      ? [...compatibility.semanticNavigation.sections] : [];
    while (pending.length) {
      const section = pending.shift();
      pending.push(...(Array.isArray(section?.children) ? section.children : []));
      for (const target of Array.isArray(section?.paragraphTargets)
        ? section.paragraphTargets : []) {
        if (target?.paragraphId && !targets.has(target.paragraphId)) {
          targets.set(target.paragraphId, target);
        }
      }
    }
    const labelNumber = /(?:fig(?:ure)?s?\.?\s*)?(S?\d+)/iu
      .exec(String(figure?.figureLabel || figure?.label || ''))?.[1] || '';
    const referencePattern = labelNumber
      ? new RegExp(`\\bfig(?:ure)?s?\\.?\\s*${labelNumber}(?![\\p{L}\\d])`, 'iu')
      : null;
    const records = [];
    let referenceParagraphCount = 0;
    let verifiedReferenceParagraphCount = 0;
    let locatorResolvedCount = 0;
    let locatorUnresolvedCount = 0;
    const locatorReasonCodes = new Set();
    for (const paragraph of paragraphs) {
      const text = String(paragraph?.normalizedText || '');
      const target = targets.get(paragraph?.paragraphId);
      const referencesFigure = referencePattern?.test(text) === true;
      if (referencesFigure) referenceParagraphCount += 1;
      let resolved = null;
      try {
        if (target && text && typeof compatibility?.resolvePdfSemanticRange === 'function') {
          resolved = compatibility.resolvePdfSemanticRange(
            paragraph.paragraphId, target.normalizedStart, target.normalizedEnd, text
          );
        }
      } catch (error) {
        locatorReasonCodes.add(String(error?.code || error?.name || 'LOCATOR_THROW').slice(0, 80));
      }
      const verified = resolved?.status === 'resolved' && resolved?.verified === true &&
        resolved?.paragraphId === paragraph?.paragraphId &&
        resolved?.normalizedQuote === text;
      if (verified) locatorResolvedCount += 1;
      else {
        locatorUnresolvedCount += 1;
        locatorReasonCodes.add(String(resolved?.reasonCode || 'LOCATOR_NOT_RESOLVED').slice(0, 80));
      }
      if (referencesFigure && verified) verifiedReferenceParagraphCount += 1;
      if (verified) records.push({
        paragraphId: String(paragraph.paragraphId || ''),
        text,
        pageNumbers: [...new Set((paragraph.ranges || []).map(range => Number(range.pageNumber))
          .filter(value => Number.isSafeInteger(value) && value > 0))]
      });
    }
    let searchable = '';
    const placements = [];
    for (const record of records) {
      if (searchable) searchable += ' ';
      const start = searchable.length;
      searchable += record.text;
      placements.push({ ...record, start, end: searchable.length });
    }
    let exactCaptionMatchCount = 0;
    let cursor = 0;
    while (caption && cursor <= searchable.length - caption.length) {
      const start = searchable.indexOf(caption, cursor);
      if (start < 0) break;
      const end = start + caption.length;
      const touched = placements.filter(item => item.start < end && item.end > start);
      if (touched.length && touched.every(item =>
        item.pageNumbers.some(page => figurePages.includes(page)))) exactCaptionMatchCount += 1;
      cursor = start + 1;
    }
    const rawFigurePages = mappings.filter(mapping => figurePages.includes(Number(mapping.pageNumber)))
      .map(mapping => normalize(mapping.rawText)).join(' ');
    let rawPageExactCaptionMatchCount = 0;
    cursor = 0;
    while (caption && cursor <= rawFigurePages.length - caption.length) {
      const start = rawFigurePages.indexOf(caption, cursor);
      if (start < 0) break;
      rawPageExactCaptionMatchCount += 1;
      cursor = start + 1;
    }
    const captionTokens = new Set(caption.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
    const candidates = [];
    for (const record of records) {
      const boundaries = typeof globalThis.SciLLM?.splitSentenceRanges === 'function'
        ? globalThis.SciLLM.splitSentenceRanges(record.text) : [];
      for (const boundary of boundaries) {
        const sentence = record.text.slice(boundary.start, boundary.end);
        if (!referencePattern?.test(sentence) ||
            !record.pageNumbers.some(page => figurePages.includes(page))) continue;
        const tokens = new Set(sentence.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
        const overlap = [...tokens].filter(token => captionTokens.has(token)).length;
        const density = tokens.size ? overlap / tokens.size : 0;
        if (overlap >= 3 && density >= 0.45) candidates.push({ overlap, density });
      }
    }
    candidates.sort((left, right) => right.overlap - left.overlap || right.density - left.density);
    const fallbackTopTied = Boolean(candidates[0] && candidates[1] &&
      candidates[0].overlap === candidates[1].overlap &&
      candidates[0].density === candidates[1].density);
    let longestCaptionPrefixCharacters = 0;
    for (let length = 1; length <= caption.length; length += 1) {
      if (!searchable.includes(caption.slice(0, length))) break;
      longestCaptionPrefixCharacters = length;
    }
    const digest = async input => {
      const bytes = new TextEncoder().encode(String(input || ''));
      const result = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(result)].map(item => item.toString(16).padStart(2, '0')).join('');
    };
    const pageCount = Number(semantic?.pageCount) || 0;
    const indexedPageCount = Number(semantic?.indexedPageCount) || 0;
    return {
      status: 'OBSERVED',
      semanticPhase: String(semantic?.phase || ''),
      semanticRevision: Number(semantic?.revision) || 0,
      pageCount,
      indexedPageCount,
      mappingCount: mappings.length,
      paragraphCount: paragraphs.length,
      sentenceCount: Array.isArray(index?.sentences) ? index.sentences.length : 0,
      navigationTargetCount: targets.size,
      missingPageCount: Math.max(0, pageCount - mappings.length),
      failedPageCount: Number(semantic?.coverage?.failedPages) || 0,
      coverageComplete: semantic?.coverage?.complete === true,
      figurePageCount: figurePages.length,
      figureCaptionCharacters: caption.length,
      figureCaptionSha256: await digest(caption),
      verifiedRecordCount: records.length,
      referenceParagraphCount,
      verifiedReferenceParagraphCount,
      locatorResolvedCount,
      locatorUnresolvedCount,
      locatorReasonCodeCount: locatorReasonCodes.size,
      locatorReasonCodesSha256: await digest([...locatorReasonCodes].sort().join('|')),
      semanticSearchableCharacters: searchable.length,
      semanticSearchableSha256: await digest(searchable),
      exactCaptionMatchCount,
      rawPageExactCaptionMatchCount,
      fallbackCandidateCount: candidates.length,
      fallbackTopOverlapCount: candidates[0]?.overlap || 0,
      fallbackTopDensityPermille: Math.round((candidates[0]?.density || 0) * 1000),
      fallbackTopTied,
      longestCaptionPrefixCharacters
    };
  }, figureId);
  return { ...value, classification: classifyCaptionDiagnostics(value),
    diagnosticSha256: jsonHash(value) };
}

async function envelopeReceipt(reader, figureId) {
  return reader.evaluate(async figureId => {
    const envelope = getPdfFigureProductionEnvelope(figureId);
    const selected = envelope?.context;
    const context = selected?.context;
    const captionEvidence = Array.isArray(context?.captionEvidence) ? context.captionEvidence : [];
    const bodyEvidence = Array.isArray(context?.bodyEvidence) ? context.bodyEvidence : [];
    const evidence = [...captionEvidence, ...bodyEvidence];
    const records = Array.isArray(selected?.records) ? selected.records : [];
    const semantic = globalThis.__brevessPdfSemanticDocument;
    const mappings = Array.isArray(semantic?.index?.mappings) ? semantic.index.mappings : [];
    const rawPages = new Map(mappings.map(item => [Number(item.pageNumber), String(item.rawText || '')]));
    const producerSentences = new Map(records.flatMap(record =>
      (record.semanticSentences || []).map(sentence => [String(sentence.sentenceId || ''), sentence])));
    const publicFragments = evidence.flatMap(item => item?.location?.sourceFragments || []);
    let registeredImageBytes = 0;
    if (envelope?.assetProof && pdfFigureAssetRegistry) {
      try {
        const resolved = await pdfFigureAssetRegistry.resolveForRequest({
          assetIds: [envelope.assetProof.assetId], expected: envelope.assetProof
        });
        registeredImageBytes = Number(resolved?.bytes?.byteLength || 0);
      } catch (_) {}
    }
    let traceable = 0;
    for (const item of evidence) {
      const producer = producerSentences.get(String(item?.location?.sentenceId || ''));
      const expected = producer?.sourceFragments || [];
      const actual = item?.location?.sourceFragments || [];
      for (const fragment of actual) {
        const matched = expected.find(candidate =>
          Number(candidate.pageNumber) === Number(fragment.pageNumber) &&
          Number(candidate.start) === Number(fragment.start) &&
          Number(candidate.end) === Number(fragment.end));
        if (matched && rawPages.get(Number(matched.pageNumber))
          ?.slice(Number(matched.start), Number(matched.end)) === String(matched.quote || '')) {
          traceable += 1;
        }
      }
    }
    const paragraphIds = [...new Set(records.flatMap(record =>
      Array.isArray(record.paragraphIds) ? record.paragraphIds : [record.paragraphId]
    ).map(value => String(value || '')).filter(Boolean))];
    const digest = async value => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
    };
    return {
      status: 'PASS',
      route: String(envelope?.route || ''),
      figureIdSha256: await digest(String(envelope?.figure?.figureId || '')),
      captionCharacters: captionEvidence.reduce((sum, item) => sum + String(item?.text || '').length, 0),
      captionSha256: await digest(captionEvidence.map(item => item?.text || '')),
      bodyCharacters: bodyEvidence.reduce((sum, item) => sum + String(item?.text || '').length, 0),
      bodySha256: await digest(bodyEvidence.map(item => item?.text || '')),
      paragraphIdCount: paragraphIds.length,
      paragraphIdsSha256: await digest(paragraphIds),
      rawRangeCount: publicFragments.length,
      rawRangesSha256: await digest(publicFragments.map(fragment => ({
        pageNumber: Number(fragment.pageNumber), start: Number(fragment.start), end: Number(fragment.end)
      }))),
      traceableRawRangeCount: traceable,
      semanticContextDigest: String(envelope?.semanticContextDigest || ''),
      assetPresent: Boolean(envelope?.assetProof),
      registeredImageSha256: String(envelope?.assetProof?.imageContentHash || ''),
      registeredImageBytes,
      registeredWidth: Number(envelope?.assetProof?.width || 0),
      registeredHeight: Number(envelope?.assetProof?.height || 0)
    };
  }, figureId);
}

async function probeReceipt(reader) {
  return reader.evaluate(() => ({
    handshakeCount: Number(globalThis.__pdfFigureProductionLiveProbe?.handshakeCount) || 0,
    ownerMutationCount: Number(globalThis.__pdfFigureProductionLiveProbe?.ownerMutationCount) || 0,
    lastAssetPresent: globalThis.__pdfFigureProductionLiveProbe?.lastAssetPresent === true,
    figureRequestCount: Number(globalThis.__pdfFigureProductionLiveProbe?.figureRequestCount) || 0,
    lastFigureRequestMode: String(
      globalThis.__pdfFigureProductionLiveProbe?.lastFigureRequestMode || ''
    ),
    lastFigureRequestImageCount: Number(
      globalThis.__pdfFigureProductionLiveProbe?.lastFigureRequestImageCount
    ) || 0,
    lastFigureRequestEnvelopePresent:
      globalThis.__pdfFigureProductionLiveProbe?.lastFigureRequestEnvelopePresent === true,
    lastFigureResponseSuccess:
      globalThis.__pdfFigureProductionLiveProbe?.lastFigureResponseSuccess === true,
    lastFigureResponseCode: String(
      globalThis.__pdfFigureProductionLiveProbe?.lastFigureResponseCode || ''
    ),
    lastFigureResponseErrorFieldCount: Number(
      globalThis.__pdfFigureProductionLiveProbe?.lastFigureResponseErrorFieldCount
    ) || 0
  }));
}

async function recordedEnvelopeProbe(reader, figureId) {
  const probe = await reader.evaluate(figureId => {
    try {
      const envelope = getPdfFigureProductionEnvelope(figureId);
      const context = envelope?.context?.context;
      const textual = envelope?.textualEvidence;
      const summarize = (items, kind) => {
        const values = Array.isArray(items) ? items : [];
        const countValues = getter => values.reduce((counts, item) => {
          const value = String(getter(item) || 'missing').slice(0, 64);
          counts[value] = (counts[value] || 0) + 1;
          return counts;
        }, {});
        return {
          count: values.length,
          kindMismatchCount: values.filter(item => item?.kind !== kind).length,
          emptyTextCount: values.filter(item =>
            typeof item?.text !== 'string' || !item.text.trim()).length,
          quoteMismatchCount: values.filter(item =>
            item?.location?.expectedNormalizedQuote !== item?.text).length,
          paragraphIdMissingCount: values.filter(item =>
            typeof item?.location?.paragraphId !== 'string' ||
            !item.location.paragraphId).length,
          locatorStatusMismatchCount: values.filter(item =>
            item?.location?.locatorStatus !== 'resolved').length,
          locatorPrecisionMismatchCount: values.filter(item => ![
            'exact-raw', 'normalized-equivalent', 'discontinuous'
          ].includes(item?.location?.locatorPrecision)).length,
          sourceFragmentsMissingCount: values.filter(item =>
            !Array.isArray(item?.location?.sourceFragments) ||
            !item.location.sourceFragments.length).length,
          locatorStatusCounts: countValues(item => item?.location?.locatorStatus),
          locatorPrecisionCounts: countValues(item => item?.location?.locatorPrecision),
          locationFieldNames: [...new Set(values.flatMap(item =>
            Object.keys(item?.location || {})))].sort()
        };
      };
      return {
        status: envelope ? 'PRESENT' : 'ABSENT',
        route: String(envelope?.route || ''),
        verified: envelope?.verified === true,
        semanticContextDigestPresent: Boolean(envelope?.semanticContextDigest),
        captionEvidenceCount: Array.isArray(context?.captionEvidence)
          ? context.captionEvidence.length : 0,
        bodyEvidenceCount: Array.isArray(context?.bodyEvidence)
          ? context.bodyEvidence.length : 0,
        assetPresent: Boolean(envelope?.assetProof),
        textualEvidenceVersion: Number(textual?.version) || 0,
        publicCaptions: summarize(textual?.captions, 'caption'),
        publicBody: summarize(textual?.body, 'body')
      };
    } catch (error) {
      return {
        status: 'ERROR',
        errorCode: String(error?.code || error?.name || 'ENVELOPE_PROBE_FAILED').slice(0, 120)
      };
    }
  }, figureId);
  for (const groupName of ['publicCaptions', 'publicBody']) {
    const group = probe?.[groupName];
    if (!group || !Array.isArray(group.locationFieldNames)) continue;
    group.locationFieldNameCount = group.locationFieldNames.length;
    group.locationFieldNamesSha256 = jsonHash(group.locationFieldNames);
    delete group.locationFieldNames;
  }
  return probe;
}

async function runWholeFigure(panel, figureId, priorOperationId = '') {
  await panel.evaluate(() => switchWorkspaceView('figures'));
  const card = panel.locator(`.workspace-figure-card[data-figure-id="${figureId}"]`);
  await card.waitFor({ state: 'visible', timeout: 60_000 });
  if (!await card.evaluate(element => element.open)) await card.locator(':scope > summary').click();
  const button = card.locator('.workspace-figure-analyze-action');
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  await button.click();
  await panel.waitForFunction(({ figureId, priorOperationId }) => {
    const figure = (currentWorkspaceSnapshot?.figures?.figures || [])
      .find(item => item?.figureId === figureId);
    const result = figure?.modelStandard || figure?.standard || figure?.result;
    const operationId = String(result?.operationId || '');
    return Boolean(figure?.standardError || figure?.deepError) ||
      (Array.isArray(result?.panels) && result.panels.length > 0 && operationId &&
        operationId !== priorOperationId);
  }, { figureId, priorOperationId }, { timeout: 180_000 });
  return panel.evaluate(figureId => {
    const figure = (currentWorkspaceSnapshot?.figures?.figures || [])
      .find(item => item?.figureId === figureId);
    const result = figure?.modelStandard || figure?.standard || figure?.result;
    const error = figure?.standardError || figure?.deepError;
    return {
      status: error ? 'FAIL' : 'PASS',
      errorCode: String(error?.code || error?.message || error || ''),
      operationIdSha256: result?.operationId ? '' : '',
      operationId: String(result?.operationId || ''),
      panelCount: Array.isArray(result?.panels) ? result.panels.length : 0,
      result
    };
  }, figureId);
}

async function mutatePdfSemanticOwner(reader) {
  return reader.evaluate(() => {
    const state = globalThis.__pdfFigureProductionLiveProbe;
    const owner = globalThis.__brevessPdfSemanticDocument;
    if (!state || !owner || state.savedSemanticOwner) return false;
    state.savedSemanticOwner = owner;
    globalThis.__brevessPdfSemanticDocument = Object.freeze({ ...owner });
    state.ownerMutationCount += 1;
    return true;
  });
}

async function restorePdfSemanticOwner(reader) {
  return reader.evaluate(() => {
    const state = globalThis.__pdfFigureProductionLiveProbe;
    if (!state?.savedSemanticOwner) return false;
    globalThis.__brevessPdfSemanticDocument = state.savedSemanticOwner;
    state.savedSemanticOwner = null;
    return true;
  });
}

function waitWithTimeout(promise, timeoutMs, code) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(codedError(code)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function compactRouteReceipt({ result, requests, probeBefore, probeAfter, envelope }) {
  const imageRequests = requests.filter(item => item.imageInputCount > 0);
  const singleImage = imageRequests.find(item => item.imageInputCount === 1 &&
    item.dataImageCount === 1);
  const inventoryRequests = requests.filter(item => item.requestKind === 'panel-inventory');
  const analysisRequests = requests.filter(item => item.requestKind === 'figure-analysis');
  const inventory = inventoryRequests[0];
  const analysis = analysisRequests[0];
  return {
    status: result.status,
    providerCallDelta: requests.length,
    providerRequestReceiptSha256: jsonHash(requests),
    imageInputCount: imageRequests.length ? Math.max(...imageRequests.map(item =>
      item.imageInputCount)) : 0,
    imageBytes: singleImage?.imageBytes || 0,
    providerImageSha256: singleImage?.providerImageSha256 || '',
    registeredImageSha256: envelope?.registeredImageSha256 || '',
    registeredImageBytes: envelope?.registeredImageBytes || 0,
    registeredWidth: envelope?.registeredWidth || 0,
    registeredHeight: envelope?.registeredHeight || 0,
    envelopeSemanticContextDigest: envelope?.semanticContextDigest || '',
    inventoryRequestCount: inventoryRequests.length,
    analysisRequestCount: analysisRequests.length,
    inventoryFirst: requests.length > 0 && requests[0]?.requestKind === 'panel-inventory',
    inventorySchemaName: inventory?.schemaName || '',
    inventoryContractVersion: inventory?.contractVersion || '',
    inventoryImageSha256: inventory?.providerImageSha256 || '',
    analysisImageSha256: analysis?.providerImageSha256 || '',
    inventoryBoundImageContentHash: inventory?.imageContentHash || '',
    inventoryBoundSemanticContextDigest: inventory?.semanticContextDigest || '',
    firstAnalysisExpectedPanelLabels: analysis?.expectedPanelLabels || [],
    handshakeStatus: probeAfter.handshakeCount > probeBefore.handshakeCount ? 'PASS' : 'FAIL',
    handshakeCountDelta: probeAfter.handshakeCount - probeBefore.handshakeCount,
    panelCount: result.panelCount,
    resultSha256: jsonHash(result.result || {}),
    operationIdSha256: sha256(result.operationId || '')
  };
}

function writeReport(filename, report) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, filename);
}

export async function run(inputOptions = {}) {
  const cli = parseArguments(process.argv.slice(2));
  const options = { ...cli, ...inputOptions };
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return null;
  }
  const startedAt = Date.now();
  const runId = new Date().toISOString().replace(/[:.]/gu, '-');
  const pdfPath = path.resolve(options.pdfPath || path.join(repositoryRoot,
    FIXTURE_DESCRIPTOR.relativePath));
  const extensionRoot = path.resolve(options.extensionRoot || repositoryRoot);
  const outputDirectory = path.resolve(options.outputDirectory || path.join(
    repositoryRoot, 'output', 'playwright', 'pdf-figure-production-live'));
  const reportFilename = path.join(outputDirectory, `report-${runId}.json`);
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-figure-live-profile-'));
  const temporaryExtension = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-figure-live-extension-'));
  const report = createReport();
  const persist = () => writeReport(reportFilename, report);
  const stage = stageRecorder(report, persist);
  let activeStage = 'source';
  let fixture = null;
  let context = null;
  persist();

  try {
    stage.start('source');
    assert.ok(fs.existsSync(pdfPath) && fs.statSync(pdfPath).isFile(), 'SOURCE_PDF_MISSING');
    assert.equal(sha256File(pdfPath), FIXTURE_DESCRIPTOR.sha256, 'SOURCE_HASH_MISMATCH');
    assert.ok(fs.existsSync(path.join(extensionRoot, 'manifest.json')), 'EXTENSION_ROOT_INVALID');
    copyExtension(extensionRoot, temporaryExtension);
    report.source = {
      pdfSha256: FIXTURE_DESCRIPTOR.sha256,
      pdfBytes: fs.statSync(pdfPath).size,
      pageCount: 0,
      figureCount: 0
    };
    for (const file of [
      'content.js', 'background.js', 'popup.js', 'pdf-reader.html', 'pdf-reader.js',
      'pdf-native-reader.mjs', 'core/background-router.js',
      'core/pdf-figure-context-production.js', 'core/pdf-figure-panel-inventory.js',
      'core/figure-asset-registry.js', 'core/figure-analysis.js'
    ]) {
      const source = path.join(extensionRoot, file);
      if (fs.existsSync(source)) report.sourceHashes[file] = sha256File(source);
    }
    stage.pass('source', {
      pdfSha256: report.source.pdfSha256,
      pdfBytes: report.source.pdfBytes,
      sourceFileCount: Object.keys(report.sourceHashes).length,
      sourceHashesSha256: jsonHash(report.sourceHashes)
    });

    fixture = await startFixtureServer();
    const { chromium } = await import('playwright');
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'msedge',
      headless: options.headed !== true,
      viewport: { width: 1320, height: 1000 },
      reducedMotion: 'reduce',
      args: [
        `--disable-extensions-except=${temporaryExtension}`,
        `--load-extension=${temporaryExtension}`
      ]
    });
    report.browser.status = 'PASS';
    await context.route(/^https?:\/\//u, async route => {
      const url = route.request().url();
      if (url.startsWith(`${fixture.origin}/`)) await route.continue();
      else {
        report.network.externalRequestCount += 1;
        await route.abort('blockedbyclient');
      }
    });
    const worker = context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).host;
    const reader = context.pages()[0] || await context.newPage();

    activeStage = 'reader';
    stage.start('reader');
    await reader.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
      waitUntil: 'domcontentloaded'
    });
    await reader.locator('#pdfLocalFile').setInputFiles(pdfPath);
    await waitForNativeReader(reader);
    const native = await readerReceipt(reader);
    assert.equal(native.documentHash, FIXTURE_DESCRIPTOR.sha256, 'READER_HASH_MISMATCH');
    assert.equal(native.pageCount, FIXTURE_DESCRIPTOR.expectedPageCount, 'READER_PAGE_COUNT_MISMATCH');
    assert.ok(native.targetPresent && native.canvasPixels > 0, 'READER_TARGET_FIGURE_MISSING');
    report.source.pageCount = native.pageCount;
    report.source.figureCount = native.figureCount;
    if (native.figureCount === FIXTURE_DESCRIPTOR.expectedFigureCount) {
      stage.pass('reader', native);
    } else {
      stage.fail('reader', 'READER_FIGURE_COUNT_MISMATCH',
        jsonHash({ actual: native.figureCount, expected: FIXTURE_DESCRIPTOR.expectedFigureCount }),
        { ...native, expectedFigureCount: FIXTURE_DESCRIPTOR.expectedFigureCount });
    }

    await reader.locator('#pdfReaderStudy').click();
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 560, height: 1000 });
    await panel.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded'
    });
    await reader.bringToFront();
    await panel.waitForFunction(expectedHash =>
      currentWorkspaceSnapshot?.documentHash === expectedHash &&
      Boolean(currentWorkspaceSnapshot?.documentId), FIXTURE_DESCRIPTOR.sha256,
    { timeout: 90_000 });

    activeStage = 'figure-context';
    stage.start('figure-context');
    await panel.evaluate(() => switchWorkspaceView('figures'));
    await panel.waitForFunction(figureId =>
      (currentWorkspaceSnapshot?.figures?.figures || [])
        .some(figure => figure?.figureId === figureId), FIXTURE_DESCRIPTOR.targetFigureId,
    { timeout: 60_000 });
    const inventoryReceipt = await panel.evaluate(figureId => {
      const figure = (currentWorkspaceSnapshot?.figures?.figures || [])
        .find(item => item?.figureId === figureId);
      return {
        status: figure ? 'PASS' : 'FAIL',
        figureIdPresent: Boolean(figure?.figureId),
        captionCharacters: String(figure?.caption || '').length,
        panelHintCount: Array.isArray(figure?.panelHints) ? figure.panelHints.length : 0,
        contextParagraphCount: Array.isArray(figure?.contextParagraphs)
          ? figure.contextParagraphs.length : 0
      };
    }, FIXTURE_DESCRIPTOR.targetFigureId);
    assert.equal(inventoryReceipt.status, 'PASS', 'FIGURE_SELECTION_FAILED');
    assert.ok(inventoryReceipt.captionCharacters > 0, 'FIGURE_CAPTION_EMPTY');
    const captionDiagnostics = await captionDiagnosticReceipt(
      reader, FIXTURE_DESCRIPTOR.targetFigureId
    );
    report.captionDiagnostics = captionDiagnostics;
    stage.pass('figure-context', {
      ...inventoryReceipt,
      captionDiagnosticClassification: captionDiagnostics.classification,
      captionDiagnosticSha256: captionDiagnostics.diagnosticSha256,
      semanticPhase: captionDiagnostics.semanticPhase,
      pageCount: captionDiagnostics.pageCount,
      indexedPageCount: captionDiagnostics.indexedPageCount,
      mappingCount: captionDiagnostics.mappingCount,
      paragraphCount: captionDiagnostics.paragraphCount,
      exactCaptionMatchCount: captionDiagnostics.exactCaptionMatchCount,
      rawPageExactCaptionMatchCount: captionDiagnostics.rawPageExactCaptionMatchCount,
      fallbackCandidateCount: captionDiagnostics.fallbackCandidateCount,
      locatorUnresolvedCount: captionDiagnostics.locatorUnresolvedCount
    });

    activeStage = 'text-route';
    stage.start('text-route');
    assert.equal((await configureLocalProfile(panel, fixture.baseUrl, false)).status, 'PASS',
      'TEXT_PROFILE_SETUP_FAILED');
    const textCallsBefore = fixture.state.requests.length;
    const textProbeBefore = await probeReceipt(reader);
    const textResult = await runWholeFigure(panel, FIXTURE_DESCRIPTOR.targetFigureId);
    const textProbeAfter = await probeReceipt(reader);
    const textRequests = fixture.state.requests.slice(textCallsBefore);
    if (textResult.status !== 'PASS') {
      const envelope = await recordedEnvelopeProbe(reader, FIXTURE_DESCRIPTOR.targetFigureId);
      const backgroundCode = safeCode(
        textProbeAfter.lastFigureResponseCode || textResult.errorCode
      );
      report.routes.text = {
        status: 'FAIL',
        errorCode: backgroundCode,
        providerCallDelta: textRequests.length,
        figureRequestCountDelta:
          textProbeAfter.figureRequestCount - textProbeBefore.figureRequestCount,
        handshakeCountDelta:
          textProbeAfter.handshakeCount - textProbeBefore.handshakeCount,
        requestMode: textProbeAfter.lastFigureRequestMode,
        requestImageCount: textProbeAfter.lastFigureRequestImageCount,
        requestEnvelopePresent: textProbeAfter.lastFigureRequestEnvelopePresent,
        responseSuccess: textProbeAfter.lastFigureResponseSuccess,
        responseErrorFieldCount: textProbeAfter.lastFigureResponseErrorFieldCount,
        recordedEnvelope: envelope
      };
      persist();
      throw codedError(`TEXT_ROUTE_FAILED:${backgroundCode}`);
    }
    const textEnvelope = await envelopeReceipt(reader, FIXTURE_DESCRIPTOR.targetFigureId);
    const textRoute = compactRouteReceipt({
      result: textResult, requests: textRequests,
      probeBefore: textProbeBefore, probeAfter: textProbeAfter,
      envelope: textEnvelope
    });
    assert.equal(textEnvelope.route, 'text-only', 'TEXT_ENVELOPE_ROUTE_MISMATCH');
    assert.equal(textEnvelope.assetPresent, false, 'TEXT_ENVELOPE_HAS_ASSET');
    assert.ok(textRoute.providerCallDelta > 0, 'TEXT_ROUTE_NO_PROVIDER_CALL');
    assert.equal(textRoute.imageInputCount, 0, 'TEXT_ROUTE_HAS_IMAGE');
    assert.equal(textRoute.handshakeStatus, 'PASS', 'TEXT_HANDSHAKE_MISSING');
    report.figure = {
      figureIdSha256: textEnvelope.figureIdSha256,
      captionCharacters: textEnvelope.captionCharacters,
      captionSha256: textEnvelope.captionSha256,
      bodyCharacters: textEnvelope.bodyCharacters,
      bodySha256: textEnvelope.bodySha256,
      paragraphIdCount: textEnvelope.paragraphIdCount,
      paragraphIdsSha256: textEnvelope.paragraphIdsSha256,
      rawRangeCount: textEnvelope.rawRangeCount,
      rawRangesSha256: textEnvelope.rawRangesSha256,
      traceableRawRangeCount: textEnvelope.traceableRawRangeCount
    };
    report.routes.text = textRoute;
    stage.pass('text-route', textRoute);

    activeStage = 'vision-route';
    stage.start('vision-route');
    assert.equal((await configureLocalProfile(panel, fixture.baseUrl, true)).status, 'PASS',
      'VISION_PROFILE_SETUP_FAILED');
    const visionCallsBefore = fixture.state.requests.length;
    const visionProbeBefore = await probeReceipt(reader);
    const visionResult = await runWholeFigure(
      panel, FIXTURE_DESCRIPTOR.targetFigureId, textResult.operationId
    );
    assert.equal(visionResult.status, 'PASS', `VISION_ROUTE_FAILED:${safeCode(visionResult.errorCode)}`);
    const visionProbeAfter = await probeReceipt(reader);
    const visionEnvelope = await envelopeReceipt(reader, FIXTURE_DESCRIPTOR.targetFigureId);
    const visionRequests = fixture.state.requests.slice(visionCallsBefore);
    const visionRoute = compactRouteReceipt({
      result: visionResult, requests: visionRequests,
      probeBefore: visionProbeBefore, probeAfter: visionProbeAfter,
      envelope: visionEnvelope
    });
    assert.equal(visionEnvelope.route, 'vision', 'VISION_ENVELOPE_ROUTE_MISMATCH');
    assert.equal(visionEnvelope.assetPresent, true, 'VISION_ENVELOPE_ASSET_MISSING');
    assert.ok(visionRoute.providerCallDelta > 0, 'VISION_ROUTE_NO_PROVIDER_CALL');
    assert.equal(visionRoute.imageInputCount, 1, 'VISION_IMAGE_COUNT_INVALID');
    assert.ok(visionRoute.imageBytes >= 1024, 'VISION_IMAGE_BYTES_TOO_SMALL');
    assert.equal(visionRoute.providerImageSha256,
      visionRoute.registeredImageSha256, 'VISION_IMAGE_HASH_MISMATCH');
    assert.equal(visionRoute.handshakeStatus, 'PASS', 'VISION_HANDSHAKE_MISSING');
    report.routes.vision = visionRoute;
    stage.pass('vision-route', visionRoute);

    activeStage = 'inventory-source-drift';
    stage.start('inventory-source-drift');
    const sourceDriftCallsBefore = fixture.state.requests.length;
    const sourceDriftGate = fixture.armInventoryResponseGate();
    const sourceDriftRun = runWholeFigure(
      panel, FIXTURE_DESCRIPTOR.targetFigureId, visionResult.operationId
    ).catch(error => ({ status: 'FAIL', errorCode: safeCode(error), operationId: '',
      panelCount: 0, result: null }));
    let sourceDriftResult;
    try {
      await waitWithTimeout(sourceDriftGate.inventoryResultReady, 60_000,
        'INVENTORY_SOURCE_DRIFT_REQUEST_TIMEOUT');
      assert.equal(await mutatePdfSemanticOwner(reader), true,
        'INVENTORY_SOURCE_DRIFT_MUTATION_FAILED');
      sourceDriftGate.release();
      sourceDriftResult = await sourceDriftRun;
    } finally {
      sourceDriftGate.release();
      await restorePdfSemanticOwner(reader);
    }
    const sourceDriftProbeAfter = await probeReceipt(reader);
    const sourceDriftRequests = fixture.state.requests.slice(sourceDriftCallsBefore);
    const sourceDriftInventoryRequests = sourceDriftRequests.filter(item =>
      item.requestKind === 'panel-inventory');
    const sourceDriftAnalysisRequests = sourceDriftRequests.filter(item =>
      item.requestKind === 'figure-analysis');
    const sourceDriftCode = safeCode(
      sourceDriftProbeAfter.lastFigureResponseCode || sourceDriftResult.errorCode
    );
    const sourceDriftRoute = {
      status: sourceDriftResult.status === 'FAIL' &&
        sourceDriftCode === 'PDF_FIGURE_CONTEXT_STALE' &&
        sourceDriftInventoryRequests.length === 1 &&
        sourceDriftAnalysisRequests.length === 0 ? 'PASS' : 'FAIL',
      providerCallDelta: sourceDriftRequests.length,
      inventoryRequestCount: sourceDriftInventoryRequests.length,
      analysisRequestCount: sourceDriftAnalysisRequests.length,
      errorCode: sourceDriftCode,
      inventoryRequestReceiptSha256: jsonHash(sourceDriftInventoryRequests)
    };
    report.routes.inventorySourceDrift = sourceDriftRoute;
    persist();
    assert.equal(sourceDriftRoute.status, 'PASS', 'INVENTORY_SOURCE_DRIFT_GATE_FAILED');
    stage.pass('inventory-source-drift', sourceDriftRoute);

    activeStage = 'stale-owner';
    stage.start('stale-owner');
    await reader.evaluate(() => {
      globalThis.__pdfFigureProductionLiveProbe.mutateOwnerOnValidate = true;
    });
    const staleCallsBefore = fixture.state.requests.length;
    const staleProbeBefore = await probeReceipt(reader);
    const staleResult = await runWholeFigure(
      panel, FIXTURE_DESCRIPTOR.targetFigureId, visionResult.operationId
    );
    const staleProbeAfter = await probeReceipt(reader);
    const staleCode = safeCode(
      staleProbeAfter.lastFigureResponseCode || staleResult.errorCode
    );
    const staleRoute = {
      status: staleResult.status === 'FAIL' && staleCode === 'PDF_FIGURE_CONTEXT_STALE' &&
        fixture.state.requests.length === staleCallsBefore ? 'PASS' : 'FAIL',
      providerCallDelta: fixture.state.requests.length - staleCallsBefore,
      errorCode: staleCode,
      handshakeStatus: staleProbeAfter.handshakeCount > staleProbeBefore.handshakeCount
        ? 'PASS' : 'FAIL',
      handshakeCountDelta: staleProbeAfter.handshakeCount - staleProbeBefore.handshakeCount,
      ownerMutationCountDelta: staleProbeAfter.ownerMutationCount - staleProbeBefore.ownerMutationCount
    };
    report.routes.staleOwner = staleRoute;
    persist();
    await restorePdfSemanticOwner(reader);
    assert.equal(staleRoute.status, 'PASS', 'STALE_OWNER_GATE_FAILED');
    stage.pass('stale-owner', staleRoute);

    report.network.providerRequestCount = fixture.state.requests.length;
    report.network.providerRequests = fixture.state.requests;
    report.status = 'PASS';
    report.elapsedMs = Date.now() - startedAt;
    auditReport(report);
    persist();
    return { reportFilename, report };
  } catch (error) {
    const code = safeCode(error);
    const evidenceSha256 = sha256(String(error?.stack || error || ''));
    report.status = 'FAIL';
    report.errorCode = code;
    report.failureEvidenceSha256 = evidenceSha256;
    if (typeof error?.actual === 'number') report.failureActualCount = error.actual;
    if (typeof error?.expected === 'number') report.failureExpectedCount = error.expected;
    report.elapsedMs = Date.now() - startedAt;
    report.network.providerRequestCount = fixture?.state?.requests?.length || 0;
    report.network.providerRequests = fixture?.state?.requests || [];
    try { stage.fail(activeStage, code, evidenceSha256); } catch (_) { persist(); }
    throw Object.assign(codedError(code), { reportFilename });
  } finally {
    if (context) await context.close().catch(() => {});
    if (fixture?.server) await new Promise(resolve => fixture.server.close(resolve));
    safeRemoveTemporary(profileDirectory, 'pdf-figure-live-profile-');
    safeRemoveTemporary(temporaryExtension, 'pdf-figure-live-extension-');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then(result => {
    if (result) process.stdout.write(`${JSON.stringify({
      status: result.report.status,
      reportFilename: result.reportFilename,
      reportSha256: sha256File(result.reportFilename),
      providerRequestCount: result.report.network.providerRequestCount
    })}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAIL', errorCode: safeCode(error), reportFilename: error.reportFilename || ''
    })}\n`);
    process.exitCode = 1;
  });
}
