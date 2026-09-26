// Bounded, fresh CLI comparison of two official DeepSeek text models on one
// pinned public Figure. The default mode is preparation-only; live execution
// requires an explicit public-result retention flag and a masked TTY secret.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';

const require = createRequire(import.meta.url);
require('../providers/provider-utils.js');
require('../core/figure-panel-planner.js');
const figureAnalysis = require('../core/figure-analysis.js');
const evidenceFirst = require('../core/evidence-first-mechanism.js');
require('../providers/deepseek.js');
const { createProviderAdapter } = require('../providers/provider-registry.js');

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const PUBLIC_PDF_RELATIVE_PATH = 'tmp/public-pdf-acceptance/elife-83176-v2.pdf';
const PUBLIC_PDF_PATH = path.join(REPOSITORY_ROOT, ...PUBLIC_PDF_RELATIVE_PATH.split('/'));
const PUBLIC_PDF_SHA256 =
  '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1';
const ARTICLE_TITLE =
  'Microglial motility is modulated by neuronal activity and correlates with dendritic spine plasticity in the hippocampus of awake mice';
const MODELS = Object.freeze(['deepseek-flash', 'deepseek-v4-pro']);
const PANEL_LABELS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);
const STAGE1_PANEL_LABELS = Object.freeze(['C', 'D', 'E', 'F']);
const PROVIDER_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MAX_ACTUAL_CALLS = 4;
const MAX_OUTPUT_TOKENS = 32768;
const REQUEST_TIMEOUT_MS = 300_000;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function benchmarkError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeErrorCode(error, fallback = 'MODEL_QUALITY_BENCHMARK_FAILED') {
  const code = String(error?.code || '');
  return /^[A-Z][A-Z0-9_]{2,100}$/u.test(code) ? code : fallback;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

function relativePath(filename) {
  return path.relative(REPOSITORY_ROOT, filename).replaceAll('\\', '/');
}

function parseArguments(argv) {
  const options = {
    mode: 'prepare', retainPublicResults: false, outputDirectory: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--prepare-only') {
      if (options.mode === 'live') throw benchmarkError('BENCHMARK_ARGUMENT_INVALID');
      options.mode = 'prepare';
      continue;
    }
    if (flag === '--live') {
      options.mode = 'live';
      continue;
    }
    if (flag === '--retain-public-results') {
      options.retainPublicResults = true;
      continue;
    }
    if (flag === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw benchmarkError('BENCHMARK_ARGUMENT_INVALID');
      options.outputDirectory = value;
      index += 1;
      continue;
    }
    if (flag === '--help') {
      options.help = true;
      continue;
    }
    throw benchmarkError('BENCHMARK_ARGUMENT_INVALID');
  }
  if (options.mode === 'live' &&
      (!options.retainPublicResults || !options.outputDirectory)) {
    throw benchmarkError('BENCHMARK_PUBLIC_RETENTION_OPT_IN_REQUIRED');
  }
  if (options.mode === 'prepare' && options.outputDirectory) {
    throw benchmarkError('BENCHMARK_PREPARE_OUTPUT_FORBIDDEN');
  }
  return options;
}

function resolveFreshOutputDirectory(requested) {
  if (path.isAbsolute(requested)) throw benchmarkError('BENCHMARK_OUTPUT_PATH_UNSAFE');
  const normalized = requested.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (!normalized.startsWith('output/')) throw benchmarkError('BENCHMARK_OUTPUT_PATH_UNSAFE');
  const resolved = path.resolve(REPOSITORY_ROOT, requested);
  const relative = path.relative(REPOSITORY_ROOT, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw benchmarkError('BENCHMARK_OUTPUT_PATH_UNSAFE');
  }
  if (fs.existsSync(resolved)) throw benchmarkError('BENCHMARK_OUTPUT_MUST_BE_FRESH');
  return resolved;
}

function normalizePdfText(items) {
  return items.map(item => String(item?.str || '')).join(' ')
    .normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function exactWordChunks(text, maximum = 1000) {
  const words = text.split(' ');
  const chunks = [];
  let current = '';
  for (const word of words) {
    if (!word) continue;
    if (word.length > maximum) throw benchmarkError('BENCHMARK_SOURCE_TOKEN_TOO_LONG');
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maximum) {
      chunks.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) chunks.push(current);
  assert.equal(chunks.join(' '), text, 'source chunking changed selected PDF text');
  return chunks;
}

function boundedSlice(text, startAnchor, endAnchor, code) {
  const start = text.indexOf(startAnchor);
  const end = text.indexOf(endAnchor, start + startAnchor.length);
  if (start < 0 || end <= start) throw benchmarkError(code);
  return text.slice(start, end).trim();
}

async function loadPinnedPublicSource() {
  const pdfBytes = fs.readFileSync(PUBLIC_PDF_PATH);
  const actualSha256 = sha256(pdfBytes);
  if (actualSha256 !== PUBLIC_PDF_SHA256) {
    throw benchmarkError('BENCHMARK_PUBLIC_PDF_HASH_MISMATCH');
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({
    data: new Uint8Array(pdfBytes), disableWorker: true,
    useSystemFonts: true, isEvalSupported: false
  }).promise;
  try {
    if (document.numPages < 7) throw benchmarkError('BENCHMARK_PUBLIC_PDF_PAGE_MISSING');
    const pages = {};
    for (const pageNumber of [1, 6, 7]) {
      const page = await document.getPage(pageNumber);
      pages[pageNumber] = normalizePdfText((await page.getTextContent()).items);
    }
    if (!pages[1].includes(ARTICLE_TITLE)) {
      throw benchmarkError('BENCHMARK_PUBLIC_PDF_TITLE_MISMATCH');
    }
    const bodyText = boundedSlice(
      pages[6],
      'Spine stability correlates with microglial contact rate',
      'After identifying altered structural plasticity of dendritic spines',
      'BENCHMARK_FIGURE3_BODY_NOT_FOUND'
    );
    const captionText = boundedSlice(
      pages[7],
      'Figure 3. Increased structural plasticity of dendritic spines',
      'The online version of this article includes',
      'BENCHMARK_FIGURE3_CAPTION_NOT_FOUND'
    );
    for (const anchor of ['1.09 ± 0.01', '1.07 ± 0.02', 'p=0.1235',
      '1.04 ± 0.03', '1.12±0.05', 'p=0.0462']) {
      if (!captionText.includes(anchor)) {
        throw benchmarkError('BENCHMARK_FIGURE3_NUMERIC_ANCHOR_MISSING');
      }
    }
    const bodyChunks = exactWordChunks(bodyText).map((text, index) => ({
      paragraphId: `figure-3-page-6-chunk-${index + 1}`,
      sectionTitle: 'Spine stability correlates with microglial contact rate',
      pageNumber: 6,
      text
    }));
    const source = {
      schemaVersion: 1,
      provenance: 'Fresh local PDF.js extraction from the pinned public PDF; no saved model answer is an input.',
      publicRetentionScope: 'Only this exact public PDF sample is authorized for retained benchmark outputs.',
      pdf: {
        relativePath: PUBLIC_PDF_RELATIVE_PATH,
        sha256: actualSha256,
        expectedSha256: PUBLIC_PDF_SHA256,
        pageCount: document.numPages
      },
      articleTitle: ARTICLE_TITLE,
      selections: {
        figureCaption: {
          pageNumber: 7,
          startAnchor: 'Figure 3. Increased structural plasticity of dendritic spines',
          endAnchorExcluded: 'The online version of this article includes',
          text: captionText,
          textSha256: sha256(captionText)
        },
        relatedBody: {
          pageNumber: 6,
          startAnchor: 'Spine stability correlates with microglial contact rate',
          endAnchorExcluded: 'After identifying altered structural plasticity of dendritic spines',
          text: bodyText,
          textSha256: sha256(bodyText),
          chunks: bodyChunks
        }
      }
    };
    source.selectedTextSha256 = sha256(`${captionText}\n${bodyText}`);
    return source;
  } finally {
    await document.destroy();
  }
}

function createFigureInput(source) {
  return {
    figureId: 'figure-3',
    figureLabel: 'Figure 3',
    articleTitle: source.articleTitle,
    caption: source.selections.figureCaption.text,
    contextParagraphs: source.selections.relatedBody.chunks.map(item => ({
      paragraphId: item.paragraphId,
      sectionTitle: item.sectionTitle,
      text: item.text
    })),
    panelHints: [...PANEL_LABELS]
    // Deliberately no pdfEvidenceBinding: this standalone CLI does not invent
    // the background verifier's signed/verified PDF evidence envelope.
  };
}

function compileFigureRequest(source) {
  const input = createFigureInput(source);
  const compiled = figureAnalysis.compileFigureAnalysisPrompt(input, {
    analysisDepth: 'deep', visualInput: false
  });
  const payload = JSON.parse(compiled.userPrompt);
  assert.equal(payload.caption, source.selections.figureCaption.text);
  assert.equal(
    payload.related_body_context.map(item => item.text).join(' '),
    source.selections.relatedBody.text,
    'production Figure prompt omitted selected public PDF body text'
  );
  assert.deepEqual(payload.expected_panel_labels, PANEL_LABELS);
  return { input, compiled };
}

function promptReceipt(compiled) {
  return {
    schemaName: compiled.schemaName,
    systemPromptSha256: sha256(compiled.systemPrompt),
    systemPromptCharacters: compiled.systemPrompt.length,
    userPromptSha256: sha256(compiled.userPrompt),
    userPromptCharacters: compiled.userPrompt.length,
    responseSchemaSha256: sha256(JSON.stringify(compiled.responseSchema))
  };
}

function sourceFigureForProjection(source, normalizedFigure) {
  return {
    figureId: normalizedFigure.figureId,
    caption: source.selections.figureCaption.text,
    panelAnalyses: Object.fromEntries(normalizedFigure.panels.map(panel => [panel.panel, {
      ...panel,
      remainingQuestion: normalizedFigure.remainingQuestion
    }]))
  };
}

function compileStage1Request(source, normalizedFigure) {
  const figure = sourceFigureForProjection(source, normalizedFigure);
  const projections = STAGE1_PANEL_LABELS.map(panelId => {
    const panelOrder = PANEL_LABELS.indexOf(panelId);
    const projected = evidenceFirst.projectPanelAnalysisEvidence(figure, {
      panelKey: `figure-3:${panelId}`,
      figureId: 'figure-3',
      panelId,
      panelOrder
    });
    if (projected?.ok !== true) {
      throw benchmarkError('BENCHMARK_STAGE1_SOURCE_PROJECTION_FAILED');
    }
    return projected.projection;
  });
  return {
    projections,
    compiled: evidenceFirst.compilePanelEvidenceExtractionPrompt(projections)
  };
}

function assertSafeRetention(value, secret) {
  const forbiddenKeys = new Set([
    'authorization', 'apikey', 'secret', 'credential', 'headers',
    'accesstoken', 'refreshtoken'
  ]);
  const inspect = (item, depth = 0) => {
    if (depth > 80) throw benchmarkError('BENCHMARK_RETENTION_OBJECT_TOO_DEEP');
    if (typeof item === 'string') {
      if ((secret && item.includes(secret)) ||
          /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}\b/iu.test(item) ||
          /\bsk-[A-Za-z0-9_-]{8,}\b/gu.test(item)) {
        throw benchmarkError('BENCHMARK_RETENTION_SECRET_REJECTED');
      }
      return;
    }
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (forbiddenKeys.has(key.toLowerCase().replace(/[^a-z]/gu, ''))) {
        throw benchmarkError('BENCHMARK_RETENTION_CREDENTIAL_FIELD_REJECTED');
      }
      inspect(child, depth + 1);
    }
  };
  inspect(value);
  const serialized = JSON.stringify(value);
  if ((secret && serialized.includes(secret)) || /"authorization"\s*:/iu.test(serialized)) {
    throw benchmarkError('BENCHMARK_RETENTION_SECRET_REJECTED');
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

function createArtifactWriter(outputDirectory, secret) {
  return (filename, value) => {
    const text = assertSafeRetention(value, secret);
    const target = path.join(outputDirectory, filename);
    fs.writeFileSync(target, text, { encoding: 'utf8', mode: 0o600, flag: 'w' });
    return {
      file: relativePath(target),
      sha256: sha256(text),
      bytes: byteLength(text)
    };
  };
}

function validateRequestBody(body, active) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      body.model !== active.model || body.stream !== false ||
      body.response_format?.type !== 'json_object' ||
      body.max_tokens !== MAX_OUTPUT_TOKENS ||
      !Array.isArray(body.messages) || body.messages.length !== 2 ||
      body.messages[0]?.role !== 'system' || body.messages[1]?.role !== 'user') {
    throw benchmarkError('BENCHMARK_PROVIDER_REQUEST_SHAPE_MISMATCH');
  }
  if (body.thinking?.type !== 'disabled') {
    throw benchmarkError('BENCHMARK_NON_THINKING_SETTING_MISMATCH');
  }
  if (body.reasoning_effort !== undefined) {
    throw benchmarkError('BENCHMARK_NON_THINKING_SETTING_MISMATCH');
  }
}

function createAuditedFetch(report, persistReceipt, getActive) {
  return async (url, options = {}) => {
    const active = getActive();
    if (!active || report.actualApiCalls >= MAX_ACTUAL_CALLS) {
      throw benchmarkError('BENCHMARK_CALL_CAP_EXCEEDED');
    }
    if (String(url) !== PROVIDER_ENDPOINT || options.method !== 'POST' ||
        typeof options.body !== 'string' || byteLength(options.body) > MAX_REQUEST_BYTES) {
      throw benchmarkError('BENCHMARK_PROVIDER_REQUEST_REJECTED');
    }
    let body;
    try { body = JSON.parse(options.body); } catch (_) {
      throw benchmarkError('BENCHMARK_PROVIDER_REQUEST_SHAPE_MISMATCH');
    }
    validateRequestBody(body, active);
    report.actualApiCalls += 1;
    const receipt = {
      sequence: report.actualApiCalls,
      model: active.model,
      stage: active.stage,
      endpoint: PROVIDER_ENDPOINT,
      responseFormat: 'json_object',
      nonThinkingRequested: true,
      wireThinking: body.thinking.type,
      maxOutputTokens: body.max_tokens,
      requestBodySha256: sha256(options.body),
      requestBytes: byteLength(options.body),
      startedAt: new Date().toISOString(),
      status: 0,
      elapsedMs: 0,
      responseSha256: '',
      responseBytes: 0,
      responseModel: '',
      finishReason: '',
      usage: null,
      telemetry: null
    };
    report.calls.push(receipt);
    active.receipt = receipt;
    persistReceipt();
    const started = Date.now();
    try {
      const response = await globalThis.fetch(url, options);
      const responseText = await response.text();
      if (byteLength(responseText) > MAX_RESPONSE_BYTES) {
        throw benchmarkError('BENCHMARK_PROVIDER_RESPONSE_TOO_LARGE');
      }
      let envelope = null;
      try { envelope = JSON.parse(responseText); } catch (_) {}
      Object.assign(receipt, {
        status: Number(response.status) || 0,
        elapsedMs: Date.now() - started,
        responseSha256: sha256(responseText),
        responseBytes: byteLength(responseText),
        responseModel: String(envelope?.model || '').slice(0, 160),
        finishReason: String(envelope?.choices?.[0]?.finish_reason || '').slice(0, 80),
        usage: envelope?.usage && typeof envelope.usage === 'object'
          ? envelope.usage : null
      });
      receipt.reasoningTokens = Number(envelope?.usage?.completion_tokens_details?.reasoning_tokens) || 0;
      receipt.nonThinkingVerified = response.ok && envelope?.usage && receipt.reasoningTokens === 0;
      persistReceipt();
      if (response.ok && receipt.reasoningTokens > 0) {
        throw benchmarkError('BENCHMARK_UNEXPECTED_REASONING_TOKENS');
      }
      return new Response(responseText, {
        status: response.status,
        headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' }
      });
    } catch (error) {
      receipt.elapsedMs = Date.now() - started;
      receipt.transportErrorCode = safeErrorCode(error, 'BENCHMARK_PROVIDER_TRANSPORT_FAILED');
      persistReceipt();
      throw error;
    }
  };
}

function modelEntry(model) {
  return {
    model,
    status: 'PENDING',
    scientificQualityEvaluated: false,
    figure: { status: 'PENDING', prompt: null, artifact: null },
    stage1: { status: 'PENDING', prompt: null, artifact: null }
  };
}

function resultArtifactBase(model, stage, source) {
  return {
    schemaVersion: 1,
    model,
    stage,
    generatedFresh: true,
    retainedPublicSample: true,
    publicPdfSha256: source.pdf.sha256,
    selectedSourceTextSha256: source.selectedTextSha256,
    scientificQualityEvaluated: false,
    uiAcceptanceEvaluated: false
  };
}

function normalizedReviewTargets(normalizedFigure, normalizedEvidence) {
  const panels = Object.fromEntries(normalizedFigure.panels
    .filter(panel => STAGE1_PANEL_LABELS.includes(panel.panel))
    .map(panel => [panel.panel, {
      comparison: panel.comparison,
      directObservation: panel.directObservation,
      localInference: panel.localInference,
      contribution: panel.contribution
    }]));
  const stage1Records = normalizedEvidence?.ok === true
    ? normalizedEvidence.records.filter(record =>
      STAGE1_PANEL_LABELS.includes(record.panelKey.split(':').at(-1)))
    : [];
  return {
    purpose: 'Human review targets only; these fields do not score scientific correctness.',
    panelCOriginalNumericDirection: '1.09 to 1.07 with p=0.1235',
    watchForUnsupportedNoChange: true,
    watchForD0D2CausalOrProceduralNode: true,
    panels,
    stage1Records
  };
}

async function invokeFresh(adapter, compiled, activeState, model, stage) {
  const telemetry = [];
  activeState.current = { model, stage, receipt: null };
  try {
    const raw = await adapter.generateJson({
      systemPrompt: compiled.systemPrompt,
      userPrompt: compiled.userPrompt,
      responseSchema: compiled.responseSchema,
      schemaName: compiled.schemaName,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: REQUEST_TIMEOUT_MS,
      reasoningEnabled: false,
      reasoningEffort: 'auto',
      onProviderTelemetry: event => telemetry.push(event)
    });
    if (activeState.current.receipt) {
      activeState.current.receipt.telemetry = telemetry.length === 1 ? telemetry[0] : null;
    }
    return raw;
  } finally {
    activeState.current = null;
  }
}

async function runModel({ model, entry, source, figureInput, figureCompiled,
  adapter, activeState, writeArtifact, persistReceipt }) {
  entry.status = 'RUNNING';
  entry.figure.prompt = promptReceipt(figureCompiled);
  persistReceipt();
  let rawFigure;
  try {
    rawFigure = await invokeFresh(
      adapter, figureCompiled, activeState, model, 'figure_analysis_a_to_f'
    );
  } catch (error) {
    entry.figure.status = 'PROVIDER_CALL_FAILED';
    entry.figure.errorCode = safeErrorCode(error, 'BENCHMARK_FIGURE_CALL_FAILED');
    entry.stage1.status = 'SKIPPED_FIGURE_CALL_FAILED';
    entry.status = 'INCOMPLETE_SCIENTIFIC_REVIEW_REQUIRED';
    persistReceipt();
    return;
  }

  let normalizedFigure;
  let figureValidation = { status: 'PASS', errorCode: '' };
  try {
    normalizedFigure = figureAnalysis.validateFigureAnalysis(rawFigure, figureInput, {
      analysisDepth: 'deep', visualInput: false, repairResponse: false,
      requireCompletePanels: true
    });
  } catch (error) {
    figureValidation = {
      status: 'FAIL',
      errorCode: safeErrorCode(error, 'BENCHMARK_FIGURE_VALIDATION_FAILED')
    };
  }
  const figureArtifactValue = {
    ...resultArtifactBase(model, 'figure_analysis_a_to_f', source),
    structuralValidation: figureValidation,
    rawGeneratedResult: rawFigure,
    normalizedResult: normalizedFigure || null
  };
  entry.figure.artifact = writeArtifact(`${model}-figure-result.json`, figureArtifactValue);
  entry.figure.status = figureValidation.status === 'PASS' ? 'STRUCTURAL_PASS' : 'STRUCTURAL_FAIL';
  persistReceipt();
  if (!normalizedFigure) {
    entry.stage1.status = 'SKIPPED_FIGURE_VALIDATION_FAILED';
    entry.status = 'INCOMPLETE_SCIENTIFIC_REVIEW_REQUIRED';
    persistReceipt();
    return;
  }

  let stage1;
  try {
    stage1 = compileStage1Request(source, normalizedFigure);
  } catch (error) {
    entry.stage1.status = 'SOURCE_PROJECTION_FAILED';
    entry.stage1.errorCode = safeErrorCode(error, 'BENCHMARK_STAGE1_SOURCE_PROJECTION_FAILED');
    entry.status = 'INCOMPLETE_SCIENTIFIC_REVIEW_REQUIRED';
    persistReceipt();
    return;
  }
  entry.stage1.prompt = promptReceipt(stage1.compiled);
  persistReceipt();
  let rawStage1;
  try {
    rawStage1 = await invokeFresh(
      adapter, stage1.compiled, activeState, model, 'panel_evidence_stage1_c_to_f'
    );
  } catch (error) {
    entry.stage1.status = 'PROVIDER_CALL_FAILED';
    entry.stage1.errorCode = safeErrorCode(error, 'BENCHMARK_STAGE1_CALL_FAILED');
    entry.status = 'INCOMPLETE_SCIENTIFIC_REVIEW_REQUIRED';
    persistReceipt();
    return;
  }
  const normalizedStage1 = evidenceFirst.validatePanelEvidenceBatch(
    rawStage1, stage1.projections
  );
  const stage1ArtifactValue = {
    ...resultArtifactBase(model, 'panel_evidence_stage1_c_to_f', source),
    structuralValidation: normalizedStage1?.ok === true
      ? { status: 'PASS', errorCode: '' }
      : { status: 'FAIL', errorCode: String(normalizedStage1?.reason || 'invalid_provider_batch') },
    sourceProjections: stage1.projections,
    rawGeneratedResult: rawStage1,
    normalizedResult: normalizedStage1,
    reviewTargets: normalizedReviewTargets(normalizedFigure, normalizedStage1)
  };
  entry.stage1.artifact = writeArtifact(`${model}-panel-evidence-result.json`, stage1ArtifactValue);
  entry.stage1.status = normalizedStage1?.ok === true ? 'STRUCTURAL_PASS' : 'STRUCTURAL_FAIL';
  entry.status = normalizedStage1?.ok === true
    ? 'COMPLETE_SCIENTIFIC_REVIEW_REQUIRED'
    : 'INCOMPLETE_SCIENTIFIC_REVIEW_REQUIRED';
  persistReceipt();
}

async function prepareBenchmark() {
  const source = await loadPinnedPublicSource();
  const { input, compiled } = compileFigureRequest(source);
  return { source, input, compiled };
}

function preparationSummary(prepared) {
  return {
    schemaVersion: 1,
    status: 'PREPARED_NO_MODEL_RESULTS',
    executionMode: 'prepare_only',
    actualApiCalls: 0,
    modelValidationClaimed: false,
    scientificQualityEvaluated: false,
    uiAcceptanceEvaluated: false,
    warning: 'This CLI text-model comparison does not replace real extension UI acceptance.',
    models: [...MODELS],
    plannedActualApiCalls: MAX_ACTUAL_CALLS,
    noRetries: true,
    productionContracts: {
      figureAnalysisVersion: figureAnalysis.FIGURE_ANALYSIS_VERSION,
      figurePromptVersion: figureAnalysis.FIGURE_ANALYSIS_PROMPT_VERSION,
      evidenceFirstVersions: evidenceFirst.EVIDENCE_FIRST_VERSIONS
    },
    settings: {
      reasoningEnabled: false,
      reasoningEffort: 'auto',
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS
    },
    source: {
      pdfRelativePath: prepared.source.pdf.relativePath,
      pdfSha256: prepared.source.pdf.sha256,
      pageCount: prepared.source.pdf.pageCount,
      captionPage: prepared.source.selections.figureCaption.pageNumber,
      captionCharacters: prepared.source.selections.figureCaption.text.length,
      captionSha256: prepared.source.selections.figureCaption.textSha256,
      bodyPage: prepared.source.selections.relatedBody.pageNumber,
      bodyCharacters: prepared.source.selections.relatedBody.text.length,
      bodySha256: prepared.source.selections.relatedBody.textSha256,
      bodyChunkCount: prepared.source.selections.relatedBody.chunks.length,
      selectedTextSha256: prepared.source.selectedTextSha256
    },
    figurePrompt: promptReceipt(prepared.compiled),
    stage1: {
      panels: [...STAGE1_PANEL_LABELS],
      status: 'WILL_COMPILE_ONLY_FROM_EACH_FRESH_VALIDATED_FIGURE_RESULT'
    }
  };
}

async function runLive(prepared, options) {
  const outputDirectory = resolveFreshOutputDirectory(options.outputDirectory);
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  let secret = '';
  try {
    secret = await readSecretFromTty({
      prompt: 'DeepSeek key for exactly four bounded public-PDF benchmark calls (masked): '
    });
    const writeArtifact = createArtifactWriter(outputDirectory, secret);
    const report = {
      schemaVersion: 1,
      status: 'RUNNING',
      executionMode: 'live_cli_model_comparison',
      startedAt: new Date().toISOString(),
      completedAt: '',
      retainedPublicSample: true,
      publicRetentionOptIn: true,
      publicPdfSha256: prepared.source.pdf.sha256,
      selectedSourceTextSha256: prepared.source.selectedTextSha256,
      plannedApiCalls: MAX_ACTUAL_CALLS,
      actualApiCalls: 0,
      noRetries: true,
      scientificQualityEvaluated: false,
      uiAcceptanceEvaluated: false,
      warning: 'This CLI text-model comparison does not replace real extension UI acceptance.',
      productionContracts: {
        figureAnalysisVersion: figureAnalysis.FIGURE_ANALYSIS_VERSION,
        figurePromptVersion: figureAnalysis.FIGURE_ANALYSIS_PROMPT_VERSION,
        evidenceFirstVersions: evidenceFirst.EVIDENCE_FIRST_VERSIONS
      },
      settings: {
        reasoningEnabled: false,
        reasoningEffort: 'auto',
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        responseFormat: 'json_object'
      },
      sourceArtifact: null,
      calls: [],
      models: MODELS.map(modelEntry)
    };
    report.sourceArtifact = writeArtifact('source-selection.json', prepared.source);
    const receiptPath = path.join(outputDirectory, 'benchmark-receipt.json');
    const persistReceipt = () => {
      const text = assertSafeRetention(report, secret);
      fs.writeFileSync(receiptPath, text, { encoding: 'utf8', mode: 0o600, flag: 'w' });
    };
    persistReceipt();
    const activeState = { current: null };
    const auditedFetch = createAuditedFetch(
      report, persistReceipt, () => activeState.current
    );
    for (const entry of report.models) {
      const adapter = createProviderAdapter({
        providerId: 'deepseek',
        config: {
          apiKey: secret,
          model: entry.model,
          reasoningEnabled: false,
          reasoningEffort: 'auto',
          thinking: false
        },
        fetchImpl: auditedFetch
      });
      await runModel({
        model: entry.model,
        entry,
        source: prepared.source,
        figureInput: prepared.input,
        figureCompiled: prepared.compiled,
        adapter,
        activeState,
        writeArtifact,
        persistReceipt
      });
    }
    if (report.actualApiCalls > MAX_ACTUAL_CALLS) {
      throw benchmarkError('BENCHMARK_CALL_CAP_EXCEEDED');
    }
    report.completedAt = new Date().toISOString();
    report.status = report.models.every(item =>
      item.status === 'COMPLETE_SCIENTIFIC_REVIEW_REQUIRED')
      ? 'COMPLETE_SCIENTIFIC_REVIEW_REQUIRED'
      : 'INCOMPLETE_SCIENTIFIC_REVIEW_REQUIRED';
    persistReceipt();
    process.stdout.write(`${JSON.stringify({
      status: report.status,
      outputDirectory: relativePath(outputDirectory),
      receipt: relativePath(receiptPath),
      actualApiCalls: report.actualApiCalls,
      models: report.models.map(item => ({ model: item.model, status: item.status }))
    }, null, 2)}\n`);
    if (report.status !== 'COMPLETE_SCIENTIFIC_REVIEW_REQUIRED') {
      throw benchmarkError('BENCHMARK_MODEL_OUTPUT_INCOMPLETE');
    }
    return report;
  } finally {
    secret = '';
  }
}

export {
  MAX_ACTUAL_CALLS,
  MAX_OUTPUT_TOKENS,
  MODELS,
  PUBLIC_PDF_RELATIVE_PATH,
  PUBLIC_PDF_SHA256,
  assertSafeRetention,
  loadPinnedPublicSource,
  parseArguments,
  prepareBenchmark
};

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write([
      'Prepare only (default):',
      '  node scripts/benchmark-public-pdf-mechanism-quality.mjs --prepare-only',
      'Live bounded run (masked TTY key; fresh repository-relative output path):',
      '  node scripts/benchmark-public-pdf-mechanism-quality.mjs --live --retain-public-results --output output/<fresh-directory>',
      ''
    ].join('\n'));
    return;
  }
  const prepared = await prepareBenchmark();
  if (options.mode === 'prepare') {
    process.stdout.write(`${JSON.stringify(preparationSummary(prepared), null, 2)}\n`);
    return;
  }
  await runLive(prepared, options);
}

const directExecution = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (directExecution) {
  main().catch(error => {
    process.stderr.write(`FAIL ${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}
