// Preparation-first, bounded Figure conflict recheck.
// Default execution only compiles request receipts. --live requires a fresh
// output directory and a separately authorized key read from a masked TTY.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';
import {
  loadCapturedSynthesisInput,
  assertExactPartition,
  assertWorkspaceProjection
} from './verify-figure-group-synthesis-live.mjs';

const require = createRequire(import.meta.url);
require('../providers/provider-utils.js');
require('../core/figure-panel-planner.js');
const figureAnalysis = require('../core/figure-analysis.js');
require('../core/evidence-first-mechanism.js');
require('../core/figure-workspace.js');
require('../providers/deepseek.js');
const { createProviderAdapter, getProviderMaxOutputTokens,
  getProviderContextWindowTokens } = require('../providers/provider-registry.js');
const { computeOutputTokenBudget } = require('../core/token-budget.js');

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const fixtureDirectory = path.join(projectRoot, 'tmp', 'figure-speed-r5-live-vision');
const sourceDirectory = path.join(
  projectRoot, 'output', 'playwright', 'figure-detail-tiles-source-r12'
);
const preparedDirectory = path.join(
  projectRoot, 'output', 'playwright', 'figure-conflict-recheck-prepared-r12'
);
const endpoint = 'https://api.deepseek.com/chat/completions';
const visionModel = 'deepseek-v4-flash-vision-exp';
const synthesisModel = 'deepseek-v4-flash';
const maxHttpAttempts = 9;
const timeoutMs = 300_000;
const maxArtifactBytes = 12 * 1024 * 1024;
const fixtures = Object.freeze([
  {
    id: 'figure-1', requestFile: 'provider-request-006-redacted.json',
    modelReceiptFile: 'provider-request-001-redacted.json',
    imageFile: 'figure-1-production.jpg',
    expectedPanels: labels('A', 'Z'),
    extractionBatches: [
      ['A', 'B', 'C', 'D', 'E', 'F'],
      ['G', 'H', 'I', 'J', 'K'],
      ['L', 'M', 'N', 'O', 'P'],
      ['Q', 'R', 'S', 'T', 'U'],
      ['V', 'W', 'X', 'Y', 'Z']
    ]
  },
  {
    id: 'figure-2', requestFile: 'provider-request-009-redacted.json',
    modelReceiptFile: 'provider-request-007-redacted.json',
    imageFile: 'figure-2-production.jpg',
    expectedPanels: labels('A', 'K'),
    extractionBatches: [
      ['A', 'B', 'C', 'D', 'E', 'F'],
      ['G', 'H', 'I', 'J', 'K']
    ]
  }
]);

function labels(first, last) {
  const result = [];
  for (let code = first.charCodeAt(0); code <= last.charCodeAt(0); code += 1) {
    result.push(String.fromCharCode(code));
  }
  return result;
}

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeErrorCode(error) {
  const value = String(error?.code || error?.message || 'FIGURE_CONFLICT_RECHECK_FAILED');
  return /^[A-Z][A-Z0-9_]{2,100}$/u.test(value)
    ? value : 'FIGURE_CONFLICT_RECHECK_FAILED';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArguments(argv) {
  const options = { live: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--live') {
      options.live = true;
      continue;
    }
    if (flag !== '--output-dir' || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw codedError('FIGURE_CONFLICT_ARGUMENT_INVALID');
    }
    options.outputDir = argv[index + 1];
    index += 1;
  }
  if (options.live && !options.outputDir) {
    throw codedError('FIGURE_CONFLICT_LIVE_OUTPUT_REQUIRED');
  }
  return options;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function redactText(value, secret = '') {
  let output = String(value ?? '')
    .replace(/\bsk-[A-Za-z0-9_-]{3,}\b/gu, '[REDACTED_SECRET]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{3,}/giu, 'Bearer [REDACTED_SECRET]');
  if (secret) output = output.split(secret).join('[REDACTED_SECRET]');
  return output;
}

function sanitize(value, secret = '', depth = 0) {
  if (depth > 24) return '[TRUNCATED_DEPTH]';
  if (Array.isArray(value)) return value.map(item => sanitize(item, secret, depth + 1));
  if (!isPlainObject(value)) return typeof value === 'string'
    ? redactText(value, secret) : value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(?:authorization|api.?key|secret|credential|access.?token|refresh.?token|^token$)/iu
      .test(key)) continue;
    result[key] = sanitize(child, secret, depth + 1);
  }
  return result;
}

function writeJson(file, value, secret = '') {
  const text = `${JSON.stringify(sanitize(value, secret), null, 2)}\n`;
  if ((secret && text.includes(secret)) ||
      /\bsk-[A-Za-z0-9_-]{3,}\b|Bearer\s+(?!\[REDACTED_SECRET\])/iu.test(text)) {
    throw codedError('FIGURE_CONFLICT_REDACTION_FAILED');
  }
  fs.writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
}

function loadModelReceipt(fixture) {
  const file = path.join(fixtureDirectory, fixture.modelReceiptFile);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(value.model, visionModel,
    `${fixture.id}: captured visual model receipt changed`);
  return {
    file: path.relative(projectRoot, file).replace(/\\/gu, '/'),
    sha256: sha256(fs.readFileSync(file)), model: value.model
  };
}

function loadImage(fixture) {
  const receipt = JSON.parse(fs.readFileSync(path.join(sourceDirectory, 'source-receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'PASS');
  const figure = receipt.figures.find(item => item.figureId === fixture.id);
  assert.equal(figure?.tiles?.length, 4);
  const images = figure.tiles.map(tile => {
    const bytes = fs.readFileSync(path.join(sourceDirectory, tile.outputFile));
    assert.equal(sha256(bytes), tile.outputSha256);
    assert.ok(bytes.length > 10_000 && bytes.length < 1572864);
    return { mediaType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` };
  });
  return {
    receipt: {
      ...figure,
      provenance: 'Four complete-coverage overlapping regions of the same official original Figure, encoded with production content.js functions; no Panel annotations or expected answers'
    },
    images
  };
}

function compileRecheck(input, recheckPanels) {
  return figureAnalysis.compileFigurePanelBatchPrompt(
    { ...input, panelHints: recheckPanels },
    { analysisDepth: 'standard', visualInput: true }
  );
}

function createAdapter(model, secret, fetchImpl) {
  return createProviderAdapter({
    providerId: 'deepseek',
    config: {
      model, apiKey: secret,
      reasoningEnabled: true, reasoningEffort: 'high'
    },
    fetchImpl
  });
}

function outputBudget(model, compiled) {
  const payload = JSON.parse(compiled.userPrompt);
  const units = (payload.expected_panel_labels || payload.panel_evidence || []).length;
  assert.ok(units > 0 && units <= 30);
  return computeOutputTokenBudget('figure_walkthrough', {
    units,
    adapterCap: getProviderMaxOutputTokens('deepseek', { model }),
    contextWindowTokens: getProviderContextWindowTokens('deepseek', { model }),
    reasoningProviderId: 'deepseek', reasoningEnabled: true, reasoningEffort: 'high'
  });
}

async function serializeProviderRequest(model, compiled, images) {
  let captured = null;
  const adapter = createAdapter(model, 'PREPARATION_ONLY_NO_SECRET', async (url, options) => {
    captured = { url: String(url), body: String(options.body || '') };
    return new Response(JSON.stringify({
      model, choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
      usage: { prompt_tokens: 0, completion_tokens: 0 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await adapter.generateJson({
    ...compiled, images, maxOutputTokens: outputBudget(model, compiled).initial, timeoutMs,
    reasoningEnabled: true, reasoningEffort: 'high'
  });
  assert.equal(captured?.url, endpoint);
  const body = JSON.parse(captured.body);
  assert.equal(body.thinking?.type, 'enabled');
  assert.equal(body.reasoning_effort, 'high');
  const userContent = body.messages.find(item => item.role === 'user').content;
  const actualImages = Array.isArray(userContent) ? userContent.filter(item => item.type === 'image_url') : [];
  assert.deepEqual(actualImages.map(item => item.image_url.url), images.map(item => item.dataUrl));
  return { body, bodyText: captured.body };
}

function requestReceipt(
  index, kind, fixture, targetPanels, compiled, serialized, imageReceipt = null
) {
  const body = serialized.body;
  return {
    index, figureId: fixture.id, kind, model: body.model,
    targetPanels,
    endpoint, method: 'POST', stream: body.stream,
    thinking: body.thinking, reasoning_effort: body.reasoning_effort,
    responseFormat: body.response_format?.type,
    maxTokens: body.max_tokens,
    outputBudget: outputBudget(body.model, compiled),
    schemaName: compiled.schemaName,
    systemPromptSha256: sha256(compiled.systemPrompt),
    userPromptSha256: sha256(compiled.userPrompt),
    responseSchemaSha256: sha256(JSON.stringify(compiled.responseSchema)),
    serializedRequestSha256: sha256(serialized.bodyText),
    serializedRequestChars: serialized.bodyText.length,
    image: imageReceipt,
    execution: 'NOT_EXECUTED'
  };
}

function assertExactReplacement(fixture, oldPanels, newPanels) {
  const target = new Set(fixture.expectedPanels);
  assert.deepEqual(newPanels.map(panel => String(panel?.panel || '').trim()),
    fixture.expectedPanels, `${fixture.id}: fresh extraction labels changed`);
  const replacement = new Map(newPanels.map(panel => [panel.panel, panel]));
  const merged = oldPanels.map(panel => replacement.get(panel.panel) || panel);
  assert.equal(merged.length, fixture.expectedPanels.length);
  assert.deepEqual(merged.map(panel => panel.panel), fixture.expectedPanels);
  assert.equal(replacement.size, target.size);
  for (const panel of oldPanels) {
    if (!target.has(panel.panel)) {
      assert.deepEqual(merged.find(item => item.panel === panel.panel), panel,
        `${fixture.id}: an untargeted captured Panel changed`);
    }
  }
  return merged;
}

function responseArtifactName(index) {
  return `provider-response-${String(index).padStart(3, '0')}-redacted.json`;
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const outputDirectory = path.resolve(options.outputDir || preparedDirectory);
  if (fs.existsSync(outputDirectory) && fs.readdirSync(outputDirectory).length > 0) {
    throw codedError('FIGURE_CONFLICT_OUTPUT_ALREADY_EXISTS');
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  const sourceReceiptFile = path.join(sourceDirectory, 'source-receipt.json');
  const report = {
    schemaVersion: 1,
    status: options.live ? 'LIVE_STARTED' : 'PREPARED_ZERO_API',
    classification: options.live
      ? 'BOUNDED_CONFLICT_RECHECK_SCIENTIFIC_REVIEW_REQUIRED'
      : 'PREPARE_ONLY_ZERO_NETWORK_ZERO_KEY_ACCESS',
    purpose: 'higher-reasoning-quality fresh full-Panel extraction and synthesis; not a speed comparison',
    authorization: {
      authorizationScope: 'User authorizes necessary API calls until acceptance; each invocation remains bounded.',
      priorRecentHttpAttempts: 16,
      additionalAuthorizationRequired: false,
      thisRunLiveFlag: options.live,
      keyAccessed: false
    },
    callPolicy: {
      hardHttpAttemptCap: maxHttpAttempts,
      automaticRetries: 0,
      plannedCalls: 9,
      plan: [
        'Figure 1 original-image fresh extraction in five batches of at most six Panels',
        'Figure 1 synthesis from 26 fresh validated Panel records',
        'Figure 2 original-image fresh extraction in two batches of at most six Panels',
        'Figure 2 synthesis from 11 fresh validated Panel records'
      ]
    },
    scope: {
      totalPanelRecords: 37,
      plannedFreshPanelRecords: 37,
      freshlyExtractedPanelRecords: 0,
      retainedPreviouslyCapturedPanelRecords: 0,
      freshLabelsByFigure: {
        'figure-1': labels('A', 'Z'), 'figure-2': labels('A', 'K')
      },
      exclusions: [
        'previously captured Panel records are input provenance only and are not retained in synthesis',
        'no model-list request',
        'no automatic retry or repair request',
        'no whole-extension or broad scientific-correctness claim'
      ],
      expectedAnswersEmbeddedInPrompt: false
    },
    sourceReceipt: {
      file: path.relative(projectRoot, sourceReceiptFile).replace(/\\/gu, '/'),
      sha256: sha256(fs.readFileSync(sourceReceiptFile))
    },
    sourceHashes: Object.fromEntries([
      'core/figure-analysis.js', 'core/figure-workspace.js',
      'core/token-budget.js',
      'core/figure-image-tiles.js',
      'providers/deepseek.js', 'providers/provider-utils.js',
      'providers/provider-registry.js',
      'scripts/verify-figure-conflict-recheck-live.mjs'
    ].map(file => [file, sha256(fs.readFileSync(path.join(projectRoot, file)))])),
    models: { vision: visionModel, synthesis: synthesisModel },
    realApiHttpAttempts: 0,
    preparedAt: new Date().toISOString(),
    figures: [], callPlan: []
  };
  const materials = [];
  let callIndex = 0;
  for (const fixture of fixtures) {
    const captured = loadCapturedSynthesisInput(fixtureDirectory, fixture);
    const image = loadImage(fixture);
    const modelReceipt = loadModelReceipt(fixture);
    const synthesisInput = { ...captured.input, panelHints: fixture.expectedPanels };
    const synthesisCompiledPreview = figureAnalysis.compileFigureSynthesisPrompt(
      synthesisInput, captured.panelEvidence,
      { analysisDepth: 'standard', visualInput: true }
    );
    const synthesisSerializedPreview = await serializeProviderRequest(
      synthesisModel, synthesisCompiledPreview, []
    );
    const batches = [];
    for (const panelBatch of fixture.extractionBatches) {
      assert.ok(panelBatch.length > 0 && panelBatch.length <= 6);
      const batchInput = { ...captured.input, panelHints: panelBatch };
      const compiled = compileRecheck(captured.input, panelBatch);
      const serialized = await serializeProviderRequest(visionModel, compiled, image.images);
      report.callPlan.push(requestReceipt(
        ++callIndex, 'fresh_panel_extraction', fixture, panelBatch,
        compiled, serialized, image.receipt
      ));
      batches.push({ panelBatch, batchInput, compiled });
    }
    report.callPlan.push({
      ...requestReceipt(
        ++callIndex, 'figure_synthesis_from_fresh_panels', fixture,
        fixture.expectedPanels, synthesisCompiledPreview, synthesisSerializedPreview
      ),
      dependency: 'Final userPrompt and serialized-request hashes are recomputed from all fresh validated Panel batches.',
      previewUsesCapturedPanelSetOnlyForCompilerSerialization: true
    });
    report.figures.push({
      figureId: fixture.id,
      expectedPanelCount: fixture.expectedPanels.length,
      extractionBatches: fixture.extractionBatches,
      freshPanelCount: fixture.expectedPanels.length,
      retainedCapturedPanelCount: 0,
      capturedPanelSource: captured.sourceReceipt,
      imageSource: image.receipt,
      visionModelSource: modelReceipt
    });
    materials.push({
      fixture, captured, image, batches,
      synthesisInput, synthesisCompiledPreview
    });
  }
  assert.equal(report.callPlan.length, 9);
  assert.equal(report.scope.retainedPreviouslyCapturedPanelRecords, 0);
  writeJson(path.join(outputDirectory, 'compiled-call-plan.json'), report.callPlan);
  writeJson(path.join(outputDirectory, 'report.json'), report);
  if (!options.live) return report;

  let secret = '';
  let activeCall = null;
  const persist = () => writeJson(path.join(outputDirectory, 'report.json'), report, secret);
  const liveFetch = async (url, requestOptions) => {
    if (report.realApiHttpAttempts >= maxHttpAttempts) {
      throw codedError('FIGURE_CONFLICT_HTTP_CAP_REACHED');
    }
    const sequence = report.realApiHttpAttempts + 1;
    const receipt = report.callPlan[sequence - 1];
    assert.equal(activeCall, sequence, 'unexpected HTTP call order');
    assert.equal(String(url), endpoint);
    assert.equal(requestOptions.method, 'POST');
    report.realApiHttpAttempts = sequence;
    const bodyText = String(requestOptions.body || '');
    const body = JSON.parse(bodyText);
    const userParts = body.messages.find(item => item.role === 'user').content;
    const imageParts = Array.isArray(userParts) ? userParts.filter(item => item.type === 'image_url') : [];
    assert.deepEqual(imageParts.map(item => sha256(Buffer.from(item.image_url.url.split(',')[1], 'base64'))),
      (receipt.image?.tiles || []).map(item => item.outputSha256));
    receipt.actualImageCount = imageParts.length;
    receipt.execution = 'STARTED';
    receipt.actualSerializedRequestSha256 = sha256(bodyText);
    receipt.actualSerializedRequestChars = bodyText.length;
    receipt.thinking = body.thinking;
    receipt.reasoning_effort = body.reasoning_effort;
    receipt.startedAt = new Date().toISOString();
    persist();
    try {
      const startedAt = Date.now();
      const response = await fetch(url, {
        ...requestOptions, signal: AbortSignal.timeout(timeoutMs)
      });
      const responseText = await response.text();
      if (Buffer.byteLength(responseText, 'utf8') > maxArtifactBytes) {
        throw codedError('FIGURE_CONFLICT_RESPONSE_TOO_LARGE');
      }
      let envelope = null;
      try { envelope = JSON.parse(responseText); } catch (_) {}
      const artifact = responseArtifactName(sequence);
      writeJson(path.join(outputDirectory, artifact),
        envelope || { redacted_non_json_body: responseText }, secret);
      Object.assign(receipt, {
        execution: response.ok ? 'RESPONSE_SAVED' : 'HTTP_FAILURE_SAVED',
        status: response.status, elapsedMs: Date.now() - startedAt,
        responseSha256: sha256(responseText), responseArtifact: artifact,
        finishReason: envelope?.choices?.[0]?.finish_reason || '',
        usage: envelope?.usage || null
      });
      persist();
      return new Response(responseText, {
        status: response.status,
        headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' }
      });
    } catch (error) {
      receipt.execution = 'FETCH_FAILURE_SAVED';
      receipt.errorCode = safeErrorCode(error);
      receipt.errorMessage = redactText(error?.message || '', secret).slice(0, 1000);
      writeJson(path.join(outputDirectory,
        `provider-failure-${String(sequence).padStart(3, '0')}-redacted.json`), {
        sequence, figureId: receipt.figureId, kind: receipt.kind,
        errorCode: receipt.errorCode, errorMessage: receipt.errorMessage
      }, secret);
      persist();
      throw error;
    }
  };

  try {
    secret = await readSecretFromTty({
      prompt: 'Authorized DeepSeek key for this bounded 9-call Figure run (masked): '
    });
    report.authorization.keyAccessed = true;
    const visionAdapter = createAdapter(visionModel, secret, liveFetch);
    const synthesisAdapter = createAdapter(synthesisModel, secret, liveFetch);
    for (let index = 0; index < materials.length; index += 1) {
      const material = materials[index];
      const figureReport = report.figures[index];
      const freshPanels = [];
      for (const batch of material.batches) {
        activeCall = report.realApiHttpAttempts + 1;
        const rawBatch = await visionAdapter.generateJson({
          ...batch.compiled, images: material.image.images,
          maxOutputTokens: outputBudget(visionModel, batch.compiled).initial, timeoutMs,
          reasoningEnabled: true, reasoningEffort: 'high'
        });
        const validatedBatch = figureAnalysis.validateFigurePanelBatch(
          rawBatch, batch.batchInput,
          { analysisDepth: 'standard', visualInput: true, repairResponse: false }
        );
        assert.deepEqual(validatedBatch.panels.map(panel => panel.panel), batch.panelBatch);
        freshPanels.push(...validatedBatch.panels);
        report.scope.freshlyExtractedPanelRecords += validatedBatch.panels.length;
        persist();
      }
      const mergedPanels = assertExactReplacement(
        material.fixture, material.captured.panelEvidence, freshPanels
      );
      writeJson(path.join(outputDirectory,
        `${material.fixture.id}-fresh-panels-normalized-redacted.json`),
      mergedPanels, secret);
      const compiledSynthesis = figureAnalysis.compileFigureSynthesisPrompt(
        material.synthesisInput, mergedPanels,
        { analysisDepth: 'standard', visualInput: true }
      );
      activeCall = report.realApiHttpAttempts + 1;
      const rawSynthesis = await synthesisAdapter.generateJson({
        ...compiledSynthesis, images: [],
        maxOutputTokens: outputBudget(synthesisModel, compiledSynthesis).initial, timeoutMs,
        reasoningEnabled: true, reasoningEffort: 'high'
      });
      const memberships = assertExactPartition(rawSynthesis, material.fixture);
      const validatedSynthesis = figureAnalysis.validateFigureSynthesis(
        rawSynthesis, material.synthesisInput, mergedPanels,
        {
          analysisDepth: 'standard', visualInput: true,
          repairResponse: false, requireCompletePanels: true
        }
      );
      const workspace = assertWorkspaceProjection(
        material.fixture, material.synthesisInput, validatedSynthesis, memberships
      );
      writeJson(path.join(outputDirectory,
        `${material.fixture.id}-synthesis-normalized-redacted.json`),
      validatedSynthesis, secret);
      figureReport.status = 'STRUCTURAL_PASS_SCIENTIFIC_REVIEW_REQUIRED';
      figureReport.merge = {
        replacedPanelCount: material.fixture.expectedPanels.length,
        retainedCapturedPanelCount: 0,
        exactLabelReplacement: 'PASS'
      };
      figureReport.panelGroups = memberships;
      figureReport.workspace = workspace;
    }
    assert.equal(report.realApiHttpAttempts, maxHttpAttempts);
    report.status = 'STRUCTURAL_PASS_SCIENTIFIC_REVIEW_REQUIRED';
    report.completedAt = new Date().toISOString();
    persist();
    return report;
  } catch (error) {
    report.status = 'FAILED_NO_RETRY';
    report.errorCode = safeErrorCode(error);
    report.errorMessage = redactText(error?.message || '', secret).slice(0, 1000);
    report.completedAt = new Date().toISOString();
    persist();
    throw error;
  } finally {
    secret = '';
  }
}

const directExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directExecution) {
  run().then(report => {
    process.stdout.write(`${JSON.stringify({
      status: report.status,
      realApiHttpAttempts: report.realApiHttpAttempts,
      callPlanCount: report.callPlan.length,
      freshlyExtractedPanelRecords: report.scope.freshlyExtractedPanelRecords
    })}\n`);
  }).catch(error => {
    process.stderr.write(`FAIL ${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}

export { run, parseArguments, compileRecheck, assertExactReplacement, outputBudget };
