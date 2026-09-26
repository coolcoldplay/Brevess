// Mechanism-network acceptance for the real MV3 content/popup/background chain.
// Saved Figure responses reconstruct the explicitly selected source without new Figure cost;
// only the mechanism provider stage is either deterministic local fixture or live DeepSeek.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';
import {
  mechanismSourcePlan, loadMechanismArticle, matchMechanismFigureCards, captionFingerprint,
  assertFigureReplaySource, assertFigureReplaySemanticMatch
} from './lib/mechanism-acceptance-input.mjs';
import {
  loadReplayEntries,
  assertReplayMatch,
  safeRequestShape as figureRequestShape,
  copyExtension as copyFigureExtension,
  sanitizedArtifact,
  panelsAreSubstantive
} from './verify-live-figure-extension.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const providerOrigin = 'https://api.deepseek.com';
const providerPath = '/chat/completions';
const defaultConfiguredModel = 'deepseek-v4-flash';
const dummySecret = 'live-figure-proxy-dummy-not-a-real-key';
const legacyExpectedPanelTotal = 37;
const defaultMechanismCallCap = 24;
const providerTimeoutMs = 300_000;
const uiTimeoutMs = 22 * 60_000;
const maxRequestBytes = 16 * 1024 * 1024;
const maxResponseBytes = 16 * 1024 * 1024;

function safeError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^[A-Z][A-Z0-9_]{2,100}$/u.test(code)
    ? code : 'LIVE_MECHANISM_ACCEPTANCE_FAILED';
}

function parseArguments(argv) {
  const result = {};
  const valued = new Set([
    '--article', '--extension-root', '--output-dir', '--figure-replay-dir',
    '--mechanism-call-cap', '--mechanism-replay-dir', '--source-manifest',
    '--model', '--deadline-ms', '--transport', '--portable-config', '--profile',
    '--profile-model-override'
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--preflight-only') {
      result.preflightOnly = true;
      continue;
    }
    if (flag === '--live-mechanism') {
      result.liveMechanism = true;
      continue;
    }
    if (flag === '--live-mechanism-tail') {
      result.liveMechanismTail = true;
      continue;
    }
    if (flag === '--accept-needs-review') {
      result.acceptNeedsReview = true;
      continue;
    }
    if (flag === '--no-entry-reload') {
      result.noEntryReload = true;
      continue;
    }
    if (flag === '--entry-peer-edit') {
      result.entryPeerEdit = true;
      continue;
    }
    if (!valued.has(flag)) throw safeError('LIVE_MECHANISM_ARGUMENT_INVALID');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw safeError('LIVE_MECHANISM_ARGUMENT_INVALID');
    result[flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  if (result.liveMechanism && (result.mechanismReplayDir || result.liveMechanismTail)) {
    throw safeError('LIVE_MECHANISM_MODE_CONFLICT');
  }
  if (result.liveMechanismTail && !result.mechanismReplayDir) {
    throw safeError('LIVE_MECHANISM_MODE_CONFLICT');
  }
  if (result.preflightOnly && (result.liveMechanism || result.liveMechanismTail)) {
    throw safeError('LIVE_MECHANISM_MODE_CONFLICT');
  }
  return result;
}

function resolveRuntimeOptions(args = {}, figureEntries = [], mechanismEntries = []) {
  const model = args.model ?? defaultConfiguredModel;
  const validModel = value => typeof value === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(value) && !/^sk-/iu.test(value);
  if (!validModel(model)) throw safeError('LIVE_MECHANISM_MODEL_INVALID');
  const deadlineMs = Number(args.deadlineMs ?? 30 * 60_000);
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60 * 60_000) {
    throw safeError('LIVE_MECHANISM_DEADLINE_INVALID');
  }
  const figureModels = new Set(figureEntries.map(entry => entry.requestBody?.model));
  if (figureModels.size > 1 || [...figureModels].some(value => !validModel(value))) {
    throw safeError('LIVE_MECHANISM_FIGURE_MODELS_MISMATCH');
  }
  if ((mechanismEntries || []).some(entry => entry.requestBody?.model !== model)) {
    throw safeError('LIVE_MECHANISM_REPLAY_MODEL_MISMATCH');
  }
  return { model, figureReplayModel: [...figureModels][0] || defaultConfiguredModel, deadlineMs };
}

function resolveConnectionOptions(args = {}) {
  const networkTransport = args.transport || 'node';
  if (!['node', 'curl'].includes(networkTransport)) {
    throw safeError('LIVE_MECHANISM_TRANSPORT_INVALID');
  }
  if (Boolean(args.portableConfig) !== Boolean(args.profile)) {
    throw safeError('LIVE_MECHANISM_PROFILE_REQUIRED');
  }
  if (args.profileModelOverride && (!args.portableConfig || !args.profile ||
      !args.model || args.profileModelOverride !== args.model)) {
    throw safeError('LIVE_MECHANISM_PROFILE_OVERRIDE_INVALID');
  }
  return { networkTransport };
}

// Testable credential boundary. The actual key remains non-enumerable and in memory.
async function loadMechanismCredential(args, requestedModel, dependencies = {}) {
  resolveConnectionOptions(args);
  let secret;
  let metadata;
  if (args.portableConfig) {
    const loadProfile = dependencies.loadProfile ||
      (await import('./lib/live-portable-profile.mjs')).loadLivePortableProfile;
    const selected = await loadProfile(args.portableConfig, args.profile,
      { expectedModel: args.profileModelOverride ? undefined : requestedModel });
    let endpoint;
    try { endpoint = new URL(selected.baseUrl || `${providerOrigin}${providerPath}`); }
    catch (_) { throw safeError('LIVE_MECHANISM_PROFILE_MISMATCH'); }
    if (selected.providerId !== 'deepseek' || endpoint.origin !== providerOrigin ||
        endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        !['/', '/v1', '/v1/', providerPath].includes(endpoint.pathname) ||
        (args.profileModelOverride ? args.profileModelOverride !== requestedModel
          : selected.model !== requestedModel)) {
      throw safeError('LIVE_MECHANISM_PROFILE_MISMATCH');
    }
    secret = selected.apiKey; // Intentionally do not spread the non-enumerable key.
    metadata = { mode: 'authorized portable config; memory-only key',
      sourceSha256: selected.sourceSha256, profileName: selected.name,
      savedModel: selected.model, requestedModel,
      explicitModelOverride: args.profileModelOverride || null };
  } else {
    secret = await (dependencies.readSecret || readSecretFromTty)({
      prompt: args.liveMechanismTail
        ? 'DeepSeek API key for isolated live mechanism tail acceptance: '
        : 'DeepSeek API key for isolated live mechanism acceptance: '
    });
    metadata = { mode: 'hidden TTY API key' };
  }
  const result = { metadata };
  Object.defineProperty(result, 'secret', { value: secret, enumerable: false });
  return result;
}

// One clock covers browser launch, Figure replay, mechanism calls and save/reload.
// The interactive secret prompt is deliberately outside this execution budget.
function createRunDeadline(durationMs) {
  const controller = new AbortController();
  const expiresAt = Date.now() + durationMs;
  const error = safeError('LIVE_MECHANISM_DEADLINE_EXCEEDED');
  let timer = setTimeout(() => controller.abort(error), durationMs);
  const check = () => {
    if (Date.now() >= expiresAt && !controller.signal.aborted) controller.abort(error);
    if (controller.signal.aborted) throw error;
  };
  return {
    signal: controller.signal,
    check,
    remainingMs: () => controller.signal.aborted ? 0 : Math.max(0, expiresAt - Date.now()),
    dispose: () => { clearTimeout(timer); timer = null; },
    async run(work) {
      check();
      let onAbort;
      const expired = new Promise((_, reject) => {
        onAbort = () => reject(error);
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      try { return await Promise.race([Promise.resolve().then(() => { check(); return work(); }), expired]); }
      finally { controller.signal.removeEventListener('abort', onAbort); }
    }
  };
}

function finalizeRunCleanup(report, closed, profile, extension, remove = safeTemporaryRemoval) {
  report.cleanupStatus = closed ? 'closed' : 'temporary-files-retained';
  if (closed) {
    try {
      remove(profile, 'brevess-live-mechanism-profile-');
      remove(extension, 'brevess-live-mechanism-extension-');
    } catch (error) {
      // Windows may retain handles after Edge closes. Do not replace the run's failure.
      report.cleanupStatus = 'closed-temporary-files-retained';
      report.cleanupErrorCode = safeErrorCode(error);
    }
  }
  if (report.cleanupStatus !== 'closed') report.retainedTemporaryPaths = { profile, extension };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function articleHtml(article) {
  const paragraphs = article.paragraphs.map(item =>
    `<section data-section="${escapeHtml(item.section)}"><h2>${escapeHtml(item.section)}</h2>` +
    `<p id="${escapeHtml(item.id)}">${escapeHtml(item.text)}</p></section>`
  ).join('\n');
  const figures = article.figures.map(item =>
    `<figure id="${escapeHtml(item.sourceId)}"><img src="${escapeHtml(item.publicImageUrl)}" ` +
    `alt="${escapeHtml(item.title)}"><figcaption><span class="figure-label">` +
    `${escapeHtml(item.label)}</span>. <strong>${escapeHtml(item.title)}</strong> ` +
    `${escapeHtml(item.caption)}</figcaption></figure>`
  ).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(article.title)}</title>` +
    `<link rel="canonical" href="${escapeHtml(article.url)}"></head><body><main><article>` +
    `<h1>${escapeHtml(article.title)}</h1>${paragraphs}${figures}</article></main></body></html>`;
}

function readBoundedRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = code => {
      if (settled) return;
      settled = true;
      reject(safeError(code));
      request.destroy();
    };
    request.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxRequestBytes) return fail('LIVE_MECHANISM_REQUEST_TOO_LARGE');
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size).toString('utf8'));
    });
    request.on('error', () => fail('LIVE_MECHANISM_PROXY_REQUEST_FAILED'));
  });
}

async function readBoundedResponse(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (byteLength(text) > maxResponseBytes) throw safeError('LIVE_MECHANISM_RESPONSE_TOO_LARGE');
    return text;
  }
  const chunks = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > maxResponseBytes) {
      await reader.cancel().catch(() => {});
      throw safeError('LIVE_MECHANISM_RESPONSE_TOO_LARGE');
    }
    chunks.push(Buffer.from(item.value));
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

function writeReport(report, outputDirectory, secret = '') {
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'report.json'),
    sanitizedArtifact(JSON.stringify(report), secret), { encoding: 'utf8', mode: 0o600 });
}

function writeArtifact(outputDirectory, file, body, secret = '') {
  fs.writeFileSync(path.join(outputDirectory, file), sanitizedArtifact(body, secret), {
    encoding: 'utf8', mode: 0o600
  });
  return file;
}

function clearKnownArtifacts(outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const file of fs.readdirSync(outputDirectory)) {
    if (/^(?:report\.json|live-mechanism-.*\.png|.*-redacted\.json)$/u.test(file)) {
      const target = path.resolve(outputDirectory, file);
      if (path.dirname(target) === path.resolve(outputDirectory) && fs.statSync(target).isFile()) {
        fs.rmSync(target, { force: true });
      }
    }
  }
}

function deepSeekUserPayload(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = messages.findLast?.(item => item?.role === 'user') ||
    [...messages].reverse().find(item => item?.role === 'user');
  if (typeof user?.content !== 'string') throw safeError('LIVE_MECHANISM_REQUEST_INVALID');
  let value;
  try { value = JSON.parse(user.content); } catch (_) {
    throw safeError('LIVE_MECHANISM_REQUEST_INVALID');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw safeError('LIVE_MECHANISM_REQUEST_INVALID');
  }
  return value;
}

function mechanismRequestSummary(body) {
  const input = deepSeekUserPayload(body);
  const extractionPanels = Array.isArray(input.untrusted_panel_evidence)
    ? input.untrusted_panel_evidence : [];
  const mappingPanels = Array.isArray(input.untrusted_validated_panels)
    ? input.untrusted_validated_panels : [];
  const candidates = Array.isArray(input.validated_candidates)
    ? input.validated_candidates : [];
  const sourceEvidence = extractionPanels.map(panel => {
    const source = panel?.source_analysis || {};
    const fields = [
      'role', 'evidenceType', 'purpose', 'design', 'comparison',
      'directObservation', 'localInference', 'contribution'
    ].filter(field => String(source?.[field] || '').trim().length > 0);
    return {
      panelKey: String(panel?.panel_key || ''),
      handlePresent: Boolean(panel?.handle),
      sourceAnalysisDigest: String(panel?.source_analysis_digest || '').slice(0, 100),
      evidenceFieldCount: fields.length,
      evidenceChars: fields.reduce((total, field) =>
        total + String(source[field] || '').trim().length, 0),
      directObservationChars: String(source?.directObservation || '').trim().length,
      localInferenceChars: String(source?.localInference || '').trim().length,
      contributionChars: String(source?.contribution || '').trim().length
    };
  });
  return {
    endpoint: providerPath,
    model: String(body?.model || '').slice(0, 160),
    stream: body?.stream === true,
    stage: String(input.stage || '').slice(0, 100),
    requestBytes: byteLength(JSON.stringify(body)),
    extractionPanelCount: extractionPanels.length,
    extractionPanelKeys: extractionPanels.map(item => String(item?.panel_key || '')),
    extractionSourceEvidence: sourceEvidence,
    mappingPanelCount: mappingPanels.length,
    mappingPanelKeys: mappingPanels.map(item => String(item?.panel_key || '')),
    candidateCount: candidates.length
  };
}

function localMechanismProviderOutput(input) {
  if (Array.isArray(input?.untrusted_panel_evidence)) {
    return {
      records: input.untrusted_panel_evidence.map(panel => {
        const cohort = (Number(panel.panel_order) || 0) % 2 + 1;
        const intervention = `Observed intervention signal ${cohort}`;
        const outcome = `Observed downstream outcome ${cohort}`;
        return ({
        handle: panel.handle,
        panelType: 'experimental',
        exclusionReason: '',
        extractionUncertainty: '',
        claims: [{
          semantics: 'causal',
          causalTest: 'necessity',
          outcome: 'supports',
          effectSign: 'decreases',
          subjectTerms: [intervention],
          objectTerms: [outcome],
          perturbations: [`Perturb ${intervention}`],
          observations: [`Bounded directional change recorded in ${panel.panel_key}`],
          biologicalContexts: [{
            species: '', tissue: '', cellType: '', compartment: '', condition: '',
            timepoint: '', dose: ''
          }],
          candidateTerms: [intervention, outcome],
          sourceFields: ['directObservation'],
          uncertaintyReasons: [],
          modelConfidence: 0.9
        }]
        })
      })
    };
  }
  if (Array.isArray(input?.validated_candidates)) {
    return {
      groups: input.validated_candidates.map(candidate => ({
        preferred_handle: candidate.candidate_handle,
        member_handles: [candidate.candidate_handle]
      }))
    };
  }
  if (Array.isArray(input?.untrusted_validated_panels)) {
    return {
      records: input.untrusted_validated_panels.map(panel => ({
        panel_handle: panel.panel_handle,
        mappings: panel.claims.map(claim => {
          const source = input.relevant_canonical_nodes.find(node =>
            node.source_claim_handles.includes(claim.claim_handle));
          const target = input.relevant_canonical_nodes.find(node =>
            node.target_claim_handles.includes(claim.claim_handle));
          if (!source || !target) throw safeError('LIVE_MECHANISM_FIXTURE_MAPPING_INVALID');
          return {
            claim_handle: claim.claim_handle,
            source_node_handle: source.node_handle,
            target_node_handle: target.node_handle,
            relation_kind: claim.causal_test === 'none' ? 'correlative' : 'causal',
            evidence_class: ['necessity', 'sufficiency'].includes(claim.causal_test)
              ? claim.causal_test : 'other',
            polarity: claim.effect_sign,
            unmappedTerm: ''
          };
        })
      }))
    };
  }
  throw safeError('LIVE_MECHANISM_FIXTURE_STAGE_INVALID');
}

function deepSeekFixtureEnvelope(output, sequence, model = defaultConfiguredModel) {
  return JSON.stringify({
    id: `fixture-mechanism-${String(sequence).padStart(3, '0')}`,
    object: 'chat.completion',
    created: 1,
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: JSON.stringify(output) },
      finish_reason: 'stop'
    }],
    usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 }
  });
}

function replayResponseBody(entry) {
  return String(entry.responseBody || '');
}

const mechanismEphemeralKeys = new Set([
  'operation', 'binding', 'operationId', 'operation_id',
  'operationEpoch', 'operation_epoch', 'documentId', 'document_id',
  'workspaceId', 'workspace_id', 'workspaceGeneration', 'workspace_generation',
  'workspaceLifecycle', 'workspace_lifecycle',
  'baseWorkspaceRevision', 'base_workspace_revision',
  'mechanismChainFingerprint', 'mechanism_chain_fingerprint'
]);

function withoutMechanismEphemeral(value) {
  if (Array.isArray(value)) return value.map(withoutMechanismEphemeral);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (mechanismEphemeralKeys.has(key)) continue;
    result[key] = withoutMechanismEphemeral(value[key]);
  }
  return result;
}

function mechanismSemanticInput(body) {
  return withoutMechanismEphemeral(deepSeekUserPayload(body));
}

function withoutMechanismSchemaOnly(value) {
  const result = JSON.parse(JSON.stringify(value));
  if (Array.isArray(result?.untrusted_panel_evidence)) {
    for (const panel of result.untrusted_panel_evidence) {
      if (panel && typeof panel === 'object' && !Array.isArray(panel)) {
        delete panel.available_source_fields;
      }
    }
  }
  if (Array.isArray(result?.untrusted_validated_panels)) {
    for (const panel of result.untrusted_validated_panels) {
      if (!Array.isArray(panel?.claims)) continue;
      for (const claim of panel.claims) {
        if (claim && typeof claim === 'object' && !Array.isArray(claim)) {
          delete claim.uncertainty_reasons;
        }
      }
    }
  }
  return result;
}

function mechanismSchemaOnlyDriftPaths(actual, expected) {
  const paths = [];
  if (JSON.stringify(actual?.untrusted_panel_evidence) !==
      JSON.stringify(expected?.untrusted_panel_evidence)) {
    paths.push('untrusted_panel_evidence[].available_source_fields');
  }
  if (JSON.stringify(actual?.untrusted_validated_panels) !==
      JSON.stringify(expected?.untrusted_validated_panels)) {
    paths.push('untrusted_validated_panels[].claims[].uncertainty_reasons');
  }
  return paths;
}

function mechanismRequestVariant(body) {
  const systemText = (Array.isArray(body?.messages) ? body.messages : [])
    .filter(item => item?.role === 'system' && typeof item.content === 'string')
    .map(item => item.content).join('\n');
  return {
    schemaRepair: systemText.includes('SCHEMA_REPAIR_PASS:'),
    targetedRepair: systemText.includes('TARGETED_REPAIR_PASS:')
  };
}

function mechanismReplayComparison(body, entry) {
  try {
    const actual = mechanismSemanticInput(body);
    const expected = mechanismSemanticInput(entry.requestBody);
    assert.equal(String(actual.stage || ''), entry.stage);
    assert.equal(String(body?.model || ''), String(entry.requestBody?.model || ''));
    assert.equal(body?.stream === true, entry.requestBody?.stream === true);
    assert.deepEqual(mechanismRequestVariant(body),
      mechanismRequestVariant(entry.requestBody));
    try {
      assert.deepEqual(actual, expected);
      return { matches: true, inputMatch: 'exact', schemaOnlyDrift: [] };
    } catch (_) {
      assert.deepEqual(withoutMechanismSchemaOnly(actual),
        withoutMechanismSchemaOnly(expected));
      return {
        matches: true,
        inputMatch: 'schema-only-drift',
        schemaOnlyDrift: mechanismSchemaOnlyDriftPaths(actual, expected)
      };
    }
  } catch (_) {
    return { matches: false, inputMatch: '', schemaOnlyDrift: [] };
  }
}

function assertMechanismReplayMatch(body, entry) {
  const comparison = mechanismReplayComparison(body, entry);
  if (!comparison.matches) throw safeError('LIVE_MECHANISM_REPLAY_REQUEST_MISMATCH');
  return comparison;
}

function selectMechanismReplayEntry(body, entries, usedSequences) {
  for (const entry of entries) {
    if (usedSequences.has(entry.sequence)) continue;
    const comparison = mechanismReplayComparison(body, entry);
    if (comparison.matches) return { entry, comparison };
  }
  throw safeError('LIVE_MECHANISM_REPLAY_REQUEST_MISMATCH');
}

function mechanismBoundaryMode({ replayCount, replayUsed, liveMechanism, liveMechanismTail }) {
  if (replayCount > replayUsed) return 'replay';
  if (replayCount > 0 && !liveMechanismTail) return 'replay-exhausted';
  if (liveMechanism || liveMechanismTail) return 'real';
  return 'fixture';
}

function mechanismCallCapConsumed(state, liveMechanismTail) {
  return liveMechanismTail
    ? state.mechanismRealApiCalls
    : state.mechanismFixtureCalls + state.mechanismRealApiCalls +
      state.mechanismReplayCalls;
}

function loadMechanismReplayEntries(directory, { maxEntries = 40 } = {}) {
  // Source-bound 107-Panel runs can contain over 40 already captured calls.
  // This limit admits offline evidence only; live API caps remain unchanged.
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 96) {
    throw safeError('LIVE_MECHANISM_REPLAY_INVALID');
  }
  const reportFile = path.join(directory, 'report.json');
  if (!fs.existsSync(reportFile)) throw safeError('LIVE_MECHANISM_REPLAY_INVALID');
  let replayReport;
  try { replayReport = JSON.parse(fs.readFileSync(reportFile, 'utf8')); } catch (_) {
    throw safeError('LIVE_MECHANISM_REPLAY_INVALID');
  }
  const calls = Array.isArray(replayReport.mechanismProviderCalls)
    ? replayReport.mechanismProviderCalls : [];
  if (!calls.length || calls.length > maxEntries) throw safeError('LIVE_MECHANISM_REPLAY_INVALID');
  return calls.map((call, index) => {
    const sequence = index + 1;
    if (Number(call?.sequence) !== sequence ||
        !['panel_evidence_extraction', 'canonical_node_proposal',
          'panel_relation_mapping'].includes(call?.request?.stage) ||
        !Number.isInteger(call?.status) || call.status < 100 || call.status > 599) {
      throw safeError('LIVE_MECHANISM_REPLAY_INVALID');
    }
    const suffix = String(sequence).padStart(3, '0');
    const requestFile = path.join(directory,
      `mechanism-request-${suffix}-redacted.json`);
    const responseFile = path.join(directory,
      `mechanism-response-${suffix}-redacted.json`);
    if (!fs.existsSync(requestFile) || !fs.existsSync(responseFile)) {
      throw safeError('LIVE_MECHANISM_REPLAY_INVALID');
    }
    let requestBody;
    const responseBody = fs.readFileSync(responseFile, 'utf8');
    try {
      requestBody = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
      JSON.parse(responseBody);
    } catch (_) {
      throw safeError('LIVE_MECHANISM_REPLAY_INVALID');
    }
    const summary = mechanismRequestSummary(requestBody);
    if (summary.stage !== call.request.stage) {
      throw safeError('LIVE_MECHANISM_REPLAY_INVALID');
    }
    return {
      sequence,
      stage: summary.stage,
      status: call.status,
      contentType: 'application/json',
      requestBody,
      responseBody
    };
  });
}

async function startCombinedProxy({
  secret, replayEntries, mechanismReplayEntries, liveMechanism, liveMechanismTail,
  mechanismCallCap, configuredModel, deadline,
  report, state, outputDirectory, downloadedHashes, strictFigureSource = false,
  fetchImpl = globalThis.fetch
}) {
  const persist = () => {
    report.figureReplayCalls = state.figureReplayCalls;
    report.mechanismFixtureCalls = state.mechanismFixtureCalls;
    report.mechanismRealApiCalls = state.mechanismRealApiCalls;
    report.mechanismReplayCalls = state.mechanismReplayCalls;
    report.callCapRejected = state.callCapRejected;
    writeReport(report, outputDirectory, secret);
  };
  const server = http.createServer(async (request, reply) => {
    reply.setHeader('Access-Control-Allow-Origin', '*');
    reply.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
    if (request.method === 'OPTIONS') {
      reply.writeHead(204);
      reply.end();
      return;
    }
    let record = null;
    try {
      deadline.check();
      const remote = String(request.socket.remoteAddress || '');
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
        throw safeError('LIVE_MECHANISM_PROXY_REQUEST_REJECTED');
      }
      const diagnosticFields = {
        '/__mechanism_qa_binding': 'contentBinding',
        '/__mechanism_qa_popup_binding': 'popupBindingSent',
        '/__mechanism_qa_handoff': 'contentHandoff',
        '/__mechanism_qa_background': 'backgroundResponse'
      };
      if (request.method === 'POST' && diagnosticFields[request.url]) {
        const diagnosticText = await readBoundedRequest(request);
        try {
          report[diagnosticFields[request.url]] = JSON.parse(diagnosticText);
        } catch (_) {
          throw safeError('LIVE_MECHANISM_DIAGNOSTIC_INVALID');
        }
        persist();
        reply.writeHead(204);
        reply.end();
        return;
      }
      if (
          request.method !== 'POST' || request.url !== providerPath ||
          request.headers.authorization !== `Bearer ${dummySecret}`) {
        throw safeError('LIVE_MECHANISM_PROXY_REQUEST_REJECTED');
      }
      const bodyText = await readBoundedRequest(request);
      deadline.check();
      const body = JSON.parse(bodyText);
      state.boundaryCalls += 1;
      state.lastRequestBody = bodyText;
      if (state.figureReplayCalls < replayEntries.length) {
        const entry = replayEntries[state.figureReplayCalls];
        const shape = figureRequestShape(body, providerPath, downloadedHashes);
        assertReplayMatch(body, shape, entry);
        if (strictFigureSource) assertFigureReplaySemanticMatch(body, entry.requestBody);
        state.figureReplayCalls += 1;
        const responseBody = replayResponseBody(entry);
        state.lastResponseBody = responseBody;
        report.figureReplay.push({
          sequence: state.figureReplayCalls,
          endpoint: providerPath,
          figureId: shape.figureId,
          pass: shape.pass,
          status: entry.status,
          responseBytes: byteLength(responseBody)
        });
        persist();
        reply.writeHead(entry.status, { 'Content-Type': entry.contentType });
        reply.end(responseBody);
        return;
      }
      // Pure saved replay is bounded by its loaded entries and fails closed at exhaustion.
      // It cannot spend a credential or fall through to the fixture/real provider branches.
      const savedReplayOnly = Boolean(mechanismReplayEntries?.length &&
        !liveMechanism && !liveMechanismTail);
      const providerCallCapConsumed = mechanismCallCapConsumed(state, liveMechanismTail);
      if (!savedReplayOnly && providerCallCapConsumed >= mechanismCallCap) {
        state.callCapRejected = true;
        persist();
        reply.writeHead(429, { 'Content-Type': 'application/json' });
        reply.end(JSON.stringify({ error: { code: 'LIVE_MECHANISM_PROVIDER_CALL_CAP' } }));
        return;
      }
      const summary = mechanismRequestSummary(body);
      if (summary.model !== configuredModel || summary.stream ||
          !['panel_evidence_extraction', 'canonical_node_proposal',
            'panel_relation_mapping'].includes(summary.stage)) {
        throw safeError('LIVE_MECHANISM_REQUEST_INVALID');
      }
      const sequence = state.mechanismFixtureCalls + state.mechanismRealApiCalls +
        state.mechanismReplayCalls + 1;
      const boundaryMode = mechanismBoundaryMode({
        replayCount: mechanismReplayEntries?.length || 0,
        replayUsed: state.mechanismReplayUsedSequences.size,
        liveMechanism,
        liveMechanismTail
      });
      record = {
        sequence,
        mode: boundaryMode === 'replay-exhausted' ? 'replay' : boundaryMode,
        request: summary,
        status: null,
        elapsedMs: null,
        responseBytes: null,
        providerErrorCode: '',
        artifacts: {}
      };
      report.mechanismProviderCalls.push(record);
      record.artifacts.request = writeArtifact(
        outputDirectory,
        `mechanism-request-${String(sequence).padStart(3, '0')}-redacted.json`,
        bodyText,
        secret
      );
      const startedAt = Date.now();
      let status;
      let responseBody;
      let contentType = 'application/json';
      if (boundaryMode === 'replay') {
        const { entry, comparison } = selectMechanismReplayEntry(
          body, mechanismReplayEntries, state.mechanismReplayUsedSequences
        );
        state.mechanismReplayUsedSequences.add(entry.sequence);
        state.mechanismReplayCalls += 1;
        status = entry.status;
        contentType = entry.contentType;
        responseBody = entry.responseBody;
        record.replaySourceSequence = entry.sequence;
        record.replayInputMatch = comparison.inputMatch;
        record.replaySchemaOnlyDrift = comparison.schemaOnlyDrift;
      } else if (boundaryMode === 'replay-exhausted') {
        throw safeError('LIVE_MECHANISM_REPLAY_REQUEST_COUNT_MISMATCH');
      } else if (boundaryMode === 'real') {
        if (liveMechanismTail &&
            state.mechanismReplayUsedSequences.size !== mechanismReplayEntries.length) {
          throw safeError('LIVE_MECHANISM_REPLAY_REQUEST_COUNT_MISMATCH');
        }
        state.mechanismRealApiCalls += 1;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
        try {
          const providerResponse = await fetchImpl(`${providerOrigin}${providerPath}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
            body: bodyText,
            signal: AbortSignal.any([controller.signal, deadline.signal])
          });
          status = providerResponse.status;
          contentType = providerResponse.headers.get('content-type') || contentType;
          responseBody = await readBoundedResponse(providerResponse);
        } catch (error) {
          if (Number.isInteger(error?.exitCode) && error.exitCode >= 0 && error.exitCode <= 255) {
            record.transportExitCode = error.exitCode;
          }
          record.transportErrorCode = deadline.signal.aborted
            ? 'LIVE_MECHANISM_DEADLINE_EXCEEDED' : error?.name === 'AbortError'
            ? 'LIVE_MECHANISM_PROVIDER_TIMEOUT' : 'LIVE_MECHANISM_PROVIDER_FETCH_FAILED';
          throw safeError(record.transportErrorCode);
        } finally {
          clearTimeout(timeout);
        }
      } else {
        state.mechanismFixtureCalls += 1;
        status = 200;
        responseBody = deepSeekFixtureEnvelope(
          localMechanismProviderOutput(deepSeekUserPayload(body)), sequence, configuredModel
        );
      }
      state.lastResponseBody = responseBody;
      record.status = status;
      record.elapsedMs = Date.now() - startedAt;
      record.responseBytes = byteLength(responseBody);
      try {
        const parsed = JSON.parse(responseBody);
        record.providerErrorCode = String(parsed?.error?.code || '').slice(0, 100);
      } catch (_) {}
      record.artifacts.response = writeArtifact(
        outputDirectory,
        `mechanism-response-${String(sequence).padStart(3, '0')}-redacted.json`,
        responseBody,
        secret
      );
      persist();
      reply.writeHead(status, { 'Content-Type': contentType });
      reply.end(responseBody);
    } catch (error) {
      const code = safeErrorCode(error);
      state.boundaryErrorCode = code;
      if (record && !record.errorCode) record.errorCode = code;
      persist();
      if (!reply.headersSent) reply.writeHead(502, { 'Content-Type': 'application/json' });
      if (!reply.writableEnded) reply.end(JSON.stringify({ error: { code } }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function installContentHandoffDiagnostic(temporaryExtension, report, diagnosticOrigin) {
  const contentFile = path.join(temporaryExtension, 'content.js');
  let source = fs.readFileSync(contentFile, 'utf8');
  const bindingPattern = / {12}const liveBinding = captureEvidenceFirstMechanismBinding\(\);\r?\n {12}if \(!sameCrossFigureMechanismBinding\(liveBinding, frozenBinding\)\) \{/gu;
  const bindingMatches = [...source.matchAll(bindingPattern)];
  if (bindingMatches.length !== 1) {
    throw safeError('LIVE_MECHANISM_BINDING_HOOK_FAILED');
  }
  const bindingIndex = bindingMatches[0].index;
  const bindingNeedle = bindingMatches[0][0];
  const bindingHook = '            const liveBinding = captureEvidenceFirstMechanismBinding();\n' +
    `            let mechanismQaBinding = null;\n` +
    `            try {\n` +
    `                const bindingKeys = ['documentId', 'workspaceId', 'workspaceGeneration',\n` +
    `                    'workspaceLifecycle', 'baseWorkspaceRevision',\n` +
    `                    'mechanismChainFingerprint'];\n` +
    `                mechanismQaBinding = { frozenBinding, liveBinding,\n` +
    `                    differingKeys: bindingKeys.filter(key =>\n` +
    `                        frozenBinding?.[key] !== liveBinding?.[key])\n` +
    `                };\n` +
    `                console.info('MECHANISM_QA_BINDING ' + JSON.stringify(mechanismQaBinding));\n` +
    `                void chrome.storage.local.set({ __MECHANISM_QA_BINDING__: mechanismQaBinding });\n` +
    `                void fetch(${JSON.stringify(`${diagnosticOrigin}/__mechanism_qa_binding`)}, {\n` +
    `                    method: 'POST', headers: { 'Content-Type': 'application/json' },\n` +
    `                    body: JSON.stringify(mechanismQaBinding)\n` +
    `                });\n` +
    `            } catch (_) {}\n` +
    '            if (!sameCrossFigureMechanismBinding(liveBinding, frozenBinding)) {';
  source = source.slice(0, bindingIndex) + bindingHook +
    source.slice(bindingIndex + bindingNeedle.length);
  const conflictReturnPattern = / {16}return \{\r?\n {20}success: false, status: 'revision_conflict',\r?\n {20}code: 'MECHANISM_REVISION_CONFLICT',\r?\n {20}operationId: operation\.operationId, operationEpoch: operation\.epoch\r?\n {16}\};/gu;
  const conflictReturnMatches = [...source.matchAll(conflictReturnPattern)];
  if (conflictReturnMatches.length !== 1) {
    throw safeError('LIVE_MECHANISM_BINDING_RETURN_HOOK_FAILED');
  }
  const conflictReturn = conflictReturnMatches[0][0];
  source = source.replace(conflictReturn,
    `                return {\n` +
    `                    success: false, status: 'revision_conflict',\n` +
    `                    code: 'MECHANISM_REVISION_CONFLICT',\n` +
    `                    operationId: operation.operationId, operationEpoch: operation.epoch,\n` +
    `                    __mechanismQaBinding: mechanismQaBinding\n` +
    `                };`);
  const backgroundNeedle =
    '            const response = await chrome.runtime.sendMessage(backgroundRequest);';
  const backgroundIndex = source.indexOf(backgroundNeedle);
  if (backgroundIndex < 0 || source.indexOf(backgroundNeedle,
    backgroundIndex + backgroundNeedle.length) >= 0) {
    throw safeError('LIVE_MECHANISM_BACKGROUND_HOOK_FAILED');
  }
  const backgroundHook = `${backgroundNeedle}\n` +
    `            globalThis.__MECHANISM_QA_BACKGROUND_DATA__ =\n` +
    `                response?.data || null;\n` +
    `            try {\n` +
    `                const backgroundQaError = response?.error || {};\n` +
    `                const backgroundQaResponse = {\n` +
    `                    success: response?.success === true,\n` +
    `                    errorCode: String(backgroundQaError?.code || ''),\n` +
    `                    errorName: String(backgroundQaError?.name || ''),\n` +
    `                    errorMessage: String(backgroundQaError?.message || '').slice(0, 1000),\n` +
    `                    dataStatus: String(response?.data?.status || '')\n` +
    `                };\n` +
    `                void fetch(${JSON.stringify(`${diagnosticOrigin}/__mechanism_qa_background`)}, {\n` +
    `                    method: 'POST', headers: { 'Content-Type': 'application/json' },\n` +
    `                    body: JSON.stringify(backgroundQaResponse)\n` +
    `                });\n` +
    `            } catch (_) {}`;
  source = source.slice(0, backgroundIndex) + backgroundHook +
    source.slice(backgroundIndex + backgroundNeedle.length);
  const providerFailureNeedle =
    `                return { success: false, status: 'failed', code: crossFigureLogicState.audit.code };`;
  const providerFailureIndex = source.indexOf(providerFailureNeedle);
  if (providerFailureIndex < 0 || source.indexOf(providerFailureNeedle,
    providerFailureIndex + providerFailureNeedle.length) >= 0) {
    throw safeError('LIVE_MECHANISM_BACKGROUND_RETURN_HOOK_FAILED');
  }
  const providerFailureHook =
    `                return { success: false, status: 'failed',\n` +
    `                    code: crossFigureLogicState.audit.code,\n` +
    `                    __mechanismQaBackground: {\n` +
    `                        success: response?.success === true,\n` +
    `                        errorCode: String(response?.error?.code || ''),\n` +
    `                        errorName: String(response?.error?.name || ''),\n` +
    `                        errorMessage: String(response?.error?.message || '').slice(0, 1000),\n` +
    `                        dataStatus: String(response?.data?.status || '')\n` +
    `                    }\n` +
    `                };`;
  source = source.slice(0, providerFailureIndex) + providerFailureHook +
    source.slice(providerFailureIndex + providerFailureNeedle.length);
  const providerCatchNeedle = '            return { success: false, status, code };';
  const providerCatchIndex = source.indexOf(providerCatchNeedle);
  if (providerCatchIndex < 0 || source.indexOf(providerCatchNeedle,
    providerCatchIndex + providerCatchNeedle.length) >= 0) {
    throw safeError('LIVE_MECHANISM_PROVIDER_CATCH_HOOK_FAILED');
  }
  const providerCatchHook =
    `            return { success: false, status, code,\n` +
    `                __mechanismQaCaughtError: {\n` +
    `                    code: String(error?.code || ''),\n` +
    `                    name: String(error?.name || ''),\n` +
    `                    message: String(error?.message || '').slice(0, 1000)\n` +
    `                },\n` +
    `                __mechanismQaHandoff: globalThis.__MECHANISM_QA_HANDOFF__ || null\n` +
    `            };`;
  source = source.slice(0, providerCatchIndex) + providerCatchHook +
    source.slice(providerCatchIndex + providerCatchNeedle.length);
  const settleNeedle = '            if (nextState === crossFigureLogicState) {';
  const settleIndex = source.indexOf(settleNeedle);
  if (settleIndex < 0 || source.indexOf(settleNeedle,
    settleIndex + settleNeedle.length) >= 0) {
    throw safeError('LIVE_MECHANISM_SETTLE_HOOK_FAILED');
  }
  const settleHook =
    `            try {\n` +
    `                const settleQaStage0 = data?.evidenceFirstStage0 || {};\n` +
    `                const settleQaOperation = crossFigureLogicState?.operation || {};\n` +
    `                globalThis.__MECHANISM_QA_SETTLE__ = {\n` +
    `                    nextStateSame: nextState === crossFigureLogicState,\n` +
    `                    dataStatus: String(data?.status || ''),\n` +
    `                    previewAccepted: Boolean(normalizeCrossFigureMechanismPendingPreview(\n` +
    `                        data?.crossFigureLogic, 'node-v2'\n` +
    `                    )),\n` +
    `                    stage0OperationId: String(settleQaStage0?.operationId || ''),\n` +
    `                    stage0OperationEpoch: Number(settleQaStage0?.operationEpoch) || 0,\n` +
    `                    stage0VersionsAccepted: Boolean(\n` +
    `                        SciLLM.normalizeEvidenceFirstVersions?.(\n` +
    `                            settleQaStage0?.evidenceFirstVersions\n` +
    `                        )\n` +
    `                    ),\n` +
    `                    currentOperationId: String(settleQaOperation?.operationId || ''),\n` +
    `                    currentOperationEpoch: Number(settleQaOperation?.epoch) || 0\n` +
    `                };\n` +
    `            } catch (_) {}\n` +
    settleNeedle;
  source = source.slice(0, settleIndex) + settleHook +
    source.slice(settleIndex + settleNeedle.length);
  const commitNeedle = '            const durableWorkspaceCommitted =';
  const commitIndex = source.indexOf(commitNeedle);
  if (commitIndex < 0 || source.indexOf(commitNeedle,
    commitIndex + commitNeedle.length) >= 0) {
    throw safeError('LIVE_MECHANISM_COMMIT_HOOK_FAILED');
  }
  const commitHook =
    `            globalThis.__MECHANISM_QA_COMMIT_OUTCOME__ = commitOutcome;\n` +
    commitNeedle;
  source = source.slice(0, commitIndex) + commitHook +
    source.slice(commitIndex + commitNeedle.length);
  const unsettledReturnPattern = / {20}code: crossFigureLogicState\.audit\.code\r?\n {16}\};/gu;
  const unsettledReturnMatches = [...source.matchAll(unsettledReturnPattern)];
  if (unsettledReturnMatches.length !== 1) {
    throw safeError('LIVE_MECHANISM_UNSETTLED_RETURN_HOOK_FAILED');
  }
  const unsettledReturnIndex = unsettledReturnMatches[0].index;
  const unsettledReturnNeedle = unsettledReturnMatches[0][0];
  const unsettledReturnHook =
    `                    code: crossFigureLogicState.audit.code,\n` +
    `                    __mechanismQaBackground: {\n` +
    `                        success: response?.success === true,\n` +
    `                        dataStatus: String(data?.status || ''),\n` +
    `                        dataErrorCode: String(data?.errorCode || ''),\n` +
    `                        dataTopKeys: Object.keys(data || {}).sort().slice(0, 60),\n` +
    `                        crossFigureTopKeys: Object.keys(data?.crossFigureLogic || {})\n` +
    `                            .sort().slice(0, 60),\n` +
    `                        crossFigureStatus: String(data?.crossFigureLogic?.status || ''),\n` +
    `                        evidenceStatus: String(\n` +
    `                            data?.evidenceFirstMechanism?.status ||\n` +
    `                            data?.crossFigureLogic?.evidenceFirstMechanism?.status || ''\n` +
    `                        ),\n` +
    `                        nodeCount: Number(\n` +
    `                            data?.evidenceFirstMechanism?.nodes?.length ||\n` +
    `                            data?.crossFigureLogic?.evidenceFirstMechanism?.nodes?.length || 0\n` +
    `                        ),\n` +
    `                        relationCount: Number(\n` +
    `                            data?.evidenceFirstMechanism?.relations?.length ||\n` +
    `                            data?.crossFigureLogic?.evidenceFirstMechanism?.relations?.length || 0\n` +
    `                        )\n` +
    `                    },\n` +
    `                    __mechanismQaBackgroundData: data,\n` +
    `                    __mechanismQaHandoff: globalThis.__MECHANISM_QA_HANDOFF__ || null\n` +
    `                };`;
  source = source.slice(0, unsettledReturnIndex) + unsettledReturnHook +
    source.slice(unsettledReturnIndex + unsettledReturnNeedle.length);
  const completedReturnPattern = / {16}logicMapError: ''\r?\n {12}\};/gu;
  const completedReturnMatches = [...source.matchAll(completedReturnPattern)];
  if (completedReturnMatches.length !== 1) {
    throw safeError('LIVE_MECHANISM_COMPLETED_RETURN_HOOK_FAILED');
  }
  const completedReturnIndex = completedReturnMatches[0].index;
  const completedReturnNeedle = completedReturnMatches[0][0];
  const completedReturnHook = `                logicMapError: '',\n` +
    `                __mechanismQaHandoff: globalThis.__MECHANISM_QA_HANDOFF__ || null\n` +
    `            };`;
  source = source.slice(0, completedReturnIndex) + completedReturnHook +
    source.slice(completedReturnIndex + completedReturnNeedle.length);
  const listenerNeedle =
    'chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {';
  const listenerIndex = source.indexOf(listenerNeedle);
  if (listenerIndex < 0 || source.indexOf(listenerNeedle,
    listenerIndex + listenerNeedle.length) >= 0) {
    throw safeError('LIVE_MECHANISM_DIAGNOSTIC_READ_HOOK_FAILED');
  }
  const listenerHook = `${listenerNeedle}\n` +
    `    if (request?.action === '__MECHANISM_QA_READ_BACKGROUND__') {\n` +
    `        sendResponse({ success: true,\n` +
    `            data: globalThis.__MECHANISM_QA_BACKGROUND_DATA__ || null,\n` +
    `            settle: globalThis.__MECHANISM_QA_SETTLE__ || null,\n` +
    `            commit: globalThis.__MECHANISM_QA_COMMIT_OUTCOME__ || null\n` +
    `        });\n` +
    `        return false;\n` +
    `    }`;
  source = source.slice(0, listenerIndex) + listenerHook +
    source.slice(listenerIndex + listenerNeedle.length);
  const needle = '            const figures = buildCrossFigureLogicInput();';
  const index = source.indexOf(needle);
  if (index < 0 || source.indexOf(needle, index + needle.length) >= 0) {
    throw safeError('LIVE_MECHANISM_HANDOFF_HOOK_FAILED');
  }
  const hook = `${needle}\n` +
    `            try {\n` +
    `                const figureEvidence = figures.map(figure => {\n` +
    `                    const result = figure.standard || figure.deep || {};\n` +
    `                    const panels = Array.isArray(result.panels) ? result.panels : [];\n` +
    `                    return {\n` +
    `                        figureId: String(figure.figureId || ''),\n` +
    `                        panelCount: panels.length,\n` +
    `                        panelsWithEvidence: panels.filter(panel =>\n` +
    `                            String(panel?.directObservation || '').trim() &&\n` +
    `                            String(panel?.localInference || '').trim() &&\n` +
    `                            String(panel?.contribution || '').trim()).length,\n` +
    `                        panelIds: panels.map(panel => String(panel?.panel || panel?.panelId || ''))\n` +
    `                    };\n` +
    `                });\n` +
    `                const mechanismQaHandoff = { figureEvidence };\n` +
    `                globalThis.__MECHANISM_QA_HANDOFF__ = mechanismQaHandoff;\n` +
    `                console.info('MECHANISM_QA_HANDOFF ' + JSON.stringify(mechanismQaHandoff));\n` +
    `                void fetch(${JSON.stringify(`${diagnosticOrigin}/__mechanism_qa_handoff`)}, {\n` +
    `                    method: 'POST', headers: { 'Content-Type': 'application/json' },\n` +
    `                    body: JSON.stringify(mechanismQaHandoff)\n` +
    `                });\n` +
    `            } catch (_) {}`;
  fs.writeFileSync(contentFile,
    source.slice(0, index) + hook + source.slice(index + needle.length));
  const popupFile = path.join(temporaryExtension, 'popup.js');
  let popupSource = fs.readFileSync(popupFile, 'utf8');
  const popupNeedle = '        const rawResponse = await sendTabMessage(tab.id, generationRequest);';
  const popupIndex = popupSource.indexOf(popupNeedle);
  if (popupIndex < 0 || popupSource.indexOf(popupNeedle,
    popupIndex + popupNeedle.length) >= 0) {
    throw safeError('LIVE_MECHANISM_POPUP_RESPONSE_HOOK_FAILED');
  }
  const popupHook =
    `        const mechanismQaPopupBinding = {\n` +
    `            operationId: String(generationRequest?.operationId || ''),\n` +
    `            documentId: String(generationRequest?.documentId || ''),\n` +
    `            workspaceId: String(generationRequest?.workspaceId || ''),\n` +
    `            workspaceGeneration: Number(generationRequest?.workspaceGeneration) || 0,\n` +
    `            workspaceLifecycle: Number(generationRequest?.workspaceLifecycle) || 0,\n` +
    `            baseWorkspaceRevision: Number(generationRequest?.baseWorkspaceRevision) || 0,\n` +
    `            mechanismChainFingerprint:\n` +
    `                String(generationRequest?.mechanismChainFingerprint || '')\n` +
    `        };\n` +
    `        globalThis.__MECHANISM_QA_POPUP_BINDING_SENT__ = mechanismQaPopupBinding;\n` +
    `        try {\n` +
    `            void fetch(${JSON.stringify(`${diagnosticOrigin}/__mechanism_qa_popup_binding`)}, {\n` +
    `                method: 'POST', headers: { 'Content-Type': 'application/json' },\n` +
    `                body: JSON.stringify(mechanismQaPopupBinding)\n` +
    `            });\n` +
    `        } catch (_) {}\n` +
    `${popupNeedle}\n` +
    `        globalThis.__MECHANISM_QA_RAW_RESPONSE__ = rawResponse;`;
  popupSource = popupSource.slice(0, popupIndex) + popupHook +
    popupSource.slice(popupIndex + popupNeedle.length);
  fs.writeFileSync(popupFile, popupSource);
  report.testInjections.push('temporary content frozen/live binding diagnostic before admission');
  report.testInjections.push('temporary response-only binding diagnostic on revision conflict');
  report.testInjections.push('temporary redacted background response diagnostic');
  report.testInjections.push('temporary popup raw mechanism response observation');
  report.testInjections.push('temporary popup emitted binding diagnostic before content handoff');
  report.testInjections.push('temporary content handoff count diagnostic after buildCrossFigureLogicInput');
}

function installReceiptCheckpointDiagnostic(temporaryExtension, report) {
  const coordinatorFile = path.join(
    temporaryExtension, 'core', 'mechanism-operation-coordinator.js'
  );
  let coordinatorSource = fs.readFileSync(coordinatorFile, 'utf8')
    .replace(/\r\n/gu, '\n');
  const mismatchNeedle =
    `        if (state.providerRequestReceipts.length !==\n` +
    `            state.providerReceiptsCheckpointed.length ||\n` +
    `            state.providerRequestReceipts.some(receipt =>\n` +
    `              !state.providerReceiptsCheckpointed.includes(receipt.receipt))) {\n` +
    `          throw mechanismError('MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS');\n` +
    `        }`;
  const mismatchIndex = coordinatorSource.indexOf(mismatchNeedle);
  if (mismatchIndex < 0 || coordinatorSource.indexOf(
    mismatchNeedle, mismatchIndex + mismatchNeedle.length
  ) >= 0) {
    throw safeError('LIVE_MECHANISM_RECEIPT_COORDINATOR_HOOK_FAILED');
  }
  const mismatchHook =
    `        if (state.providerRequestReceipts.length !==\n` +
    `            state.providerReceiptsCheckpointed.length ||\n` +
    `            state.providerRequestReceipts.some(receipt =>\n` +
    `              !state.providerReceiptsCheckpointed.includes(receipt.receipt))) {\n` +
    `          const mechanismQaContracts = Array.isArray(\n` +
    `            globalThis.__MECHANISM_QA_PROVIDER_RECEIPT_CONTRACTS__\n` +
    `          ) ? globalThis.__MECHANISM_QA_PROVIDER_RECEIPT_CONTRACTS__ : [];\n` +
    `          const mechanismQaCheckpointed = new Set(\n` +
    `            state.providerReceiptsCheckpointed\n` +
    `          );\n` +
    `          const mechanismQaReceipts = state.providerRequestReceipts.map(item => {\n` +
    `            const contract = mechanismQaContracts.find(candidate =>\n` +
    `              candidate?.receipt === item.receipt\n` +
    `            );\n` +
    `            return {\n` +
    `              requestNumber: item.requestNumber,\n` +
    `              receipt: item.receipt,\n` +
    `              bindingDigest: item.bindingDigest,\n` +
    `              stage: String(contract?.stage || 'unknown'),\n` +
    `              checkpointed: mechanismQaCheckpointed.has(item.receipt)\n` +
    `            };\n` +
    `          });\n` +
    `          globalThis.__MECHANISM_QA_RECEIPT_CHECKPOINT_DIAGNOSTIC__ = {\n` +
    `            providerRequestsClaimed: state.providerRequestsClaimed,\n` +
    `            checkpointSequence: state.checkpointSequence,\n` +
    `            checkpointCommits: state.checkpointCommits,\n` +
    `            completedPanelCount: state.completedPanelKeys.length,\n` +
    `            providerRequestReceipts: mechanismQaReceipts,\n` +
    `            providerReceiptsCheckpointed: [...state.providerReceiptsCheckpointed],\n` +
    `            missingProviderReceipts: mechanismQaReceipts\n` +
    `              .filter(item => !item.checkpointed)\n` +
    `              .map(item => ({\n` +
    `                requestNumber: item.requestNumber, receipt: item.receipt,\n` +
    `                bindingDigest: item.bindingDigest, stage: item.stage\n` +
    `              }))\n` +
    `          };\n` +
    `          throw mechanismError('MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS');\n` +
    `        }`;
  coordinatorSource = coordinatorSource.slice(0, mismatchIndex) + mismatchHook +
    coordinatorSource.slice(mismatchIndex + mismatchNeedle.length);
  fs.writeFileSync(coordinatorFile, coordinatorSource);

  const routerFile = path.join(temporaryExtension, 'core', 'background-router.js');
  let routerSource = fs.readFileSync(routerFile, 'utf8')
    .replace(/\r\n/gu, '\n');
  const contractNeedle = '          return { receipt, bindingDigest };';
  const contractIndex = routerSource.indexOf(contractNeedle);
  if (contractIndex < 0 || routerSource.indexOf(
    contractNeedle, contractIndex + contractNeedle.length
  ) >= 0) {
    throw safeError('LIVE_MECHANISM_RECEIPT_CONTRACT_HOOK_FAILED');
  }
  const contractHook =
    `          const mechanismQaContract = {\n` +
    `            stage, receipt, bindingDigest\n` +
    `          };\n` +
    `          const mechanismQaContracts = Array.isArray(\n` +
    `            globalThis.__MECHANISM_QA_PROVIDER_RECEIPT_CONTRACTS__\n` +
    `          ) ? globalThis.__MECHANISM_QA_PROVIDER_RECEIPT_CONTRACTS__ : [];\n` +
    `          globalThis.__MECHANISM_QA_PROVIDER_RECEIPT_CONTRACTS__ = [\n` +
    `            ...mechanismQaContracts, mechanismQaContract\n` +
    `          ].slice(-40);\n` +
    `          return { receipt, bindingDigest };`;
  routerSource = routerSource.slice(0, contractIndex) + contractHook +
    routerSource.slice(contractIndex + contractNeedle.length);

  const publicFailureNeedle =
    `      const publicFailure = (status, errorCode) => ({\n` +
    `        status,\n` +
    `        errorCode,\n` +
    `        evidenceFirstMechanism: null,\n` +
    `        mechanismGraph: null,\n` +
    `        stage0: publicEvidenceStage0(stage0, operation)\n` +
    `      });`;
  const publicFailureIndex = routerSource.indexOf(publicFailureNeedle);
  if (publicFailureIndex < 0 || routerSource.indexOf(
    publicFailureNeedle, publicFailureIndex + publicFailureNeedle.length
  ) >= 0) {
    throw safeError('LIVE_MECHANISM_RECEIPT_FAILURE_HOOK_FAILED');
  }
  const publicFailureHook =
    `      const publicFailure = (status, errorCode) => ({\n` +
    `        status,\n` +
    `        errorCode,\n` +
    `        evidenceFirstMechanism: null,\n` +
    `        mechanismGraph: null,\n` +
    `        stage0: publicEvidenceStage0(stage0, operation),\n` +
    `        __mechanismQaReceiptDiagnostic:\n` +
    `          globalThis.__MECHANISM_QA_RECEIPT_CHECKPOINT_DIAGNOSTIC__ || null\n` +
    `      });`;
  routerSource = routerSource.slice(0, publicFailureIndex) + publicFailureHook +
    routerSource.slice(publicFailureIndex + publicFailureNeedle.length);

  const returnedFailureNeedle =
    `            resumed: evidenceOutcome.resumed === true,\n` +
    `            documentHash,`;
  const returnedFailureIndex = routerSource.indexOf(returnedFailureNeedle);
  if (returnedFailureIndex < 0 || routerSource.indexOf(
    returnedFailureNeedle, returnedFailureIndex + returnedFailureNeedle.length
  ) >= 0) {
    throw safeError('LIVE_MECHANISM_RECEIPT_RETURN_HOOK_FAILED');
  }
  const returnedFailureHook =
    `            resumed: evidenceOutcome.resumed === true,\n` +
    `            __mechanismQaReceiptDiagnostic:\n` +
    `              evidenceOutcome.__mechanismQaReceiptDiagnostic || null,\n` +
    `            documentHash,`;
  routerSource = routerSource.slice(0, returnedFailureIndex) + returnedFailureHook +
    routerSource.slice(returnedFailureIndex + returnedFailureNeedle.length);
  fs.writeFileSync(routerFile, routerSource);
  report.testInjections.push(
    'temporary background provider receipt stage and checkpoint frontier diagnostic'
  );
  report.testInjections.push(
    'temporary coordinator missing provider receipt diagnostic on ambiguous resume'
  );
}

function attachDiagnostics(context, report, persist, secret = '') {
  const attached = new WeakSet();
  const attach = (surface, kind) => {
    if (!surface || attached.has(surface)) return;
    attached.add(surface);
    surface.on('console', message => {
      const text = String(message.text() || '');
      if (text.startsWith('MECHANISM_QA_HANDOFF ')) {
        try {
          report.contentHandoff = JSON.parse(text.slice('MECHANISM_QA_HANDOFF '.length));
        } catch (_) {
          report.contentHandoff = { parseError: true };
        }
        persist();
        return;
      }
      if (text.startsWith('MECHANISM_QA_BINDING ')) {
        try {
          report.contentBinding = JSON.parse(text.slice('MECHANISM_QA_BINDING '.length));
        } catch (_) {
          report.contentBinding = { parseError: true };
        }
        persist();
        return;
      }
      if (text.startsWith('FIGURE_QA_DIAG ')) {
        let detail;
        try { detail = JSON.parse(text.slice('FIGURE_QA_DIAG '.length)); }
        catch (_) { detail = { parseError: true }; }
        report.diagnostics.push({ sequence: report.diagnostics.length + 1, surface: kind,
          detail: JSON.parse(sanitizedArtifact(JSON.stringify(detail), secret)) });
        persist();
      }
    });
  };
  context.pages().forEach(page => attach(page, 'page'));
  context.serviceWorkers().forEach(worker => attach(worker, 'serviceworker'));
  context.on('page', page => attach(page, 'page'));
  context.on('serviceworker', worker => attach(worker, 'serviceworker'));
}

async function setupProfile(panel, configuredModel) {
  return panel.evaluate(async ({ model, dummy }) => {
    const profileId = 'profile_live_mechanism_acceptance';
    for (const message of [
      {
        type: 'LLM_SAVE_PROFILE',
        profile: {
          id: profileId,
          name: 'Live mechanism acceptance',
          providerId: 'deepseek',
          config: {
            apiKey: dummy,
            model,
            maxOutputTokens: 16384,
            reasoningEnabled: false
          }
        }
      },
      {
        type: 'LLM_UPDATE_PROFILE_ROUTING',
        globalProfileId: profileId,
        taskRoutes: {}
      },
      {
        type: 'LLM_UPDATE_PREFERENCES',
        preferences: { mode: 'llm', consentGranted: true }
      }
    ]) {
      const response = await chrome.runtime.sendMessage(message);
      if (response?.success !== true) throw new Error('LIVE_MECHANISM_PROFILE_SETUP_FAILED');
    }
    await loadLlmSettings();
    await refreshArticleWorkspace();
    switchWorkspaceView('figures');
  }, { model: configuredModel, dummy: dummySecret });
}

async function currentArchive(panel) {
  return panel.evaluate(async () => (await getCurrentArticleArchiveFromTab()).archive);
}

async function readStoredBindingDiagnostic(worker) {
  if (!worker) return null;
  try {
    return await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('__MECHANISM_QA_BINDING__');
      return stored.__MECHANISM_QA_BINDING__ || null;
    });
  } catch (_) {
    return null;
  }
}

async function popupBindingSnapshot(panel) {
  return panel.evaluate(() => {
    const context = captureFigureWorkspaceEditContext();
    return {
      documentId: String(context?.documentId || ''),
      workspaceId: String(context?.workspaceId || ''),
      workspaceGeneration: Number(context?.workspaceGeneration) || 0,
      workspaceLifecycle: Number(context?.workspaceLifecycle) || 0,
      baseWorkspaceRevision: Number(context?.draftRevision) || 0,
      mechanismChainFingerprint: String(context?.mechanismChainFingerprint || '')
    };
  });
}

async function entryPeerEditAndClick(panel, figureId) {
  return panel.evaluate(async ({ targetFigureId }) => {
    const context = captureFigureWorkspaceEditContext();
    const draft = mechanismWorkspaceDraft(currentWorkspaceSnapshot) || {};
    const panelId = 'A';
    const field = 'note';
    const panelDraft = draft?.figures?.[targetFigureId]?.panels?.[panelId];
    const oldValue = String(panelDraft?.[field]?.value || '');
    const marker = `Mechanism entry peer edit from revision ${Number(draft.revision) || 0}`;
    const newValue = oldValue ? `${oldValue}\n${marker}` : marker;
    const tab = await queryPanelTargetTab();
    if (!tab?.id) throw new Error('LIVE_MECHANISM_PEER_EDIT_TAB_NOT_FOUND');
    const response = await SciLLM.sendTabMessageWithRecovery(chrome, tab.id, {
      action: 'updateFigureWorkspaceDraft',
      mutation: {
        type: 'set_panel_field',
        expectedRevision: Number(draft.revision) || 0,
        figureId: targetFigureId,
        panelId,
        field,
        value: newValue
      },
      workspaceTarget: buildFigureWorkspaceEditTarget(context)
    });
    if (response?.success !== true || !response?.draft) {
      const error = new Error(response?.code || 'LIVE_MECHANISM_PEER_EDIT_FAILED');
      error.code = response?.code || 'LIVE_MECHANISM_PEER_EDIT_FAILED';
      throw error;
    }
    const popupBeforeClick = captureFigureWorkspaceEditContext();
    document.querySelector('#figureWorkspace .workspace-logic-map-open')?.click();
    return {
      figureId: targetFigureId,
      panelId,
      field,
      oldValue,
      newValue,
      expectedRevision: Number(draft.revision) || 0,
      returnedRevision: Number(response.draft.revision) || 0,
      popupRevisionBeforeClick: Number(popupBeforeClick.draftRevision) || 0,
      responseSuccess: true
    };
  }, { targetFigureId: figureId });
}

function archivedPanelFieldValue(archive, edit) {
  const draft = archive?.workspace?.figureWorkspaceDraft ||
    archive?.workspace?.figures?.draft || archive?.figureWorkspaceDraft || null;
  return String(draft?.figures?.[edit?.figureId]?.panels?.[edit?.panelId]?.[edit?.field]?.value || '');
}

async function popupRawMechanismResponse(panel) {
  try {
    return await panel.evaluate(() => {
      const response = globalThis.__MECHANISM_QA_RAW_RESPONSE__;
      if (!response || typeof response !== 'object') return null;
      return {
        success: response.success === true,
        status: String(response.status || ''),
        code: String(response.code || ''),
        operationEpoch: Number(response.operationEpoch) || 0,
        binding: response.__mechanismQaBinding || null,
        background: response.__mechanismQaBackground || null,
        caughtError: response.__mechanismQaCaughtError || null,
        backgroundData: response.__mechanismQaBackgroundData || null,
        handoff: response.__mechanismQaHandoff || null
      };
    });
  } catch (_) {
    return null;
  }
}

async function recordRawMechanismResponse(report, panel, outputDirectory, secret = '') {
  const raw = await popupRawMechanismResponse(panel);
  if (!raw) return;
  const backgroundData = raw.backgroundData;
  if (raw.handoff) report.contentHandoff = raw.handoff;
  delete raw.backgroundData;
  delete raw.handoff;
  if (backgroundData) {
    report.receiptCheckpointDiagnostic =
      backgroundData.__mechanismQaReceiptDiagnostic || null;
    report.backgroundDataArtifact = writeArtifact(
      outputDirectory,
      'mechanism-background-data-redacted.json',
      JSON.stringify(backgroundData),
      secret
    );
    report.backgroundDataSha256 = sha256(sanitizedArtifact(
      JSON.stringify(backgroundData), secret
    ));
  }
  report.rawMechanismResponse = raw;
}

async function recordContentBackgroundData(report, panel, outputDirectory, secret = '') {
  try {
    const response = await panel.evaluate(async () => {
      const tab = await queryPanelTargetTab();
      if (!tab?.id) return null;
      return sendTabMessage(tab.id, { action: '__MECHANISM_QA_READ_BACKGROUND__' });
    });
    if (!response?.data) return;
    report.receiptCheckpointDiagnostic =
      response.data.__mechanismQaReceiptDiagnostic || null;
    report.settleDiagnostic = response.settle || null;
    const sanitized = sanitizedArtifact(JSON.stringify(response.data), secret);
    report.backgroundDataArtifact = writeArtifact(
      outputDirectory, 'mechanism-background-data-redacted.json', sanitized, secret
    );
    report.backgroundDataSha256 = sha256(sanitized);
    if (response.commit) {
      const commitSanitized = sanitizedArtifact(JSON.stringify(response.commit), secret);
      report.commitOutcomeArtifact = writeArtifact(
        outputDirectory, 'mechanism-commit-outcome-redacted.json',
        commitSanitized, secret
      );
      report.commitOutcomeSummary = {
        success: response.commit.success === true,
        status: String(response.commit.status || ''),
        code: String(response.commit.code || ''),
        durableWorkspaceCommitted: response.commit.durableWorkspaceCommitted === true,
        resultPresent: Boolean(response.commit.result),
        pendingResultPresent: Boolean(response.commit.pendingResult),
        topKeys: Object.keys(response.commit).sort()
      };
    }
  } catch (_) {}
}

function archiveFigures(archive) {
  return Array.isArray(archive?.workspace?.figures) ? archive.workspace.figures : [];
}

function figureResult(figure) {
  return figure?.modelStandard || figure?.standard || figure?.result || null;
}

function completedFigure(figure, panelIds) {
  const result = figureResult(figure);
  const actual = Array.isArray(result?.panels)
    ? result.panels.map(panel => String(panel?.panel || panel?.panelId || '').toUpperCase()) : [];
  return JSON.stringify(actual) === JSON.stringify(panelIds) &&
    panelsAreSubstantive(result.panels) &&
    !String(figure?.standardError || '') && !String(figure?.deepError || '');
}

async function runtimeFigureProgress(panel, figureId) {
  return panel.evaluate(id => {
    try {
      const progress = typeof figureProgress !== 'undefined' ? figureProgress.get(id) : null;
      return progress ? {
        running: progress.running === true,
        failed: progress.failed === true,
        code: String(progress.code || progress.errorCode || progress.error?.code || '')
      } : null;
    } catch (_) { return null; }
  }, figureId);
}

async function waitForFigure(panel, figureId, panelIds) {
  const deadline = Date.now() + uiTimeoutMs;
  while (Date.now() < deadline) {
    let archive = null;
    try { archive = await currentArchive(panel); } catch (_) {}
    const figure = archiveFigures(archive).find(item => item?.figureId === figureId);
    if (figure && completedFigure(figure, panelIds)) return { archive, figure };
    const progress = await runtimeFigureProgress(panel, figureId);
    const archiveError = String(figure?.standardError || figure?.deepError || '');
    if (archiveError || progress?.failed) throw safeError('LIVE_MECHANISM_FIGURE_REPLAY_FAILED', {
      terminalErrorCode: String(progress?.code || archiveError).slice(0, 100)
    });
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw safeError('LIVE_MECHANISM_FIGURE_REPLAY_TIMEOUT');
}

async function discoveredFigureIds(panel, figures) {
  const cards = await panel.locator('.workspace-figure-card[data-figure-id]').evaluateAll(nodes =>
    nodes.map(node => ({
      id: String(node.dataset.figureId || ''),
      label: String(node.querySelector(':scope > summary')?.textContent || '')
    }))
  );
  return matchMechanismFigureCards(cards, figures);
}

async function clickFigureReplay(panel, figureId, panelIds) {
  const card = panel.locator(`.workspace-figure-card[data-figure-id="${figureId}"]`);
  if (!await card.evaluate(element => element.open)) await card.locator(':scope > summary').click();
  await card.locator('.workspace-figure-analyze-action').click();
  return waitForFigure(panel, figureId, panelIds);
}

async function mechanismRuntimeState(panel) {
  return panel.evaluate(() => {
    const draft = mechanismWorkspaceDraft(currentWorkspaceSnapshot) || {};
    const chain = draft.mechanismChain || { nodes: [], edges: [] };
    const audit = mechanismWorkspaceAudit(draft);
    const cross = currentWorkspaceSnapshot?.figures?.crossFigureLogic || {};
    const result = cross.result || {};
    const pendingResult = cross.pendingResult || null;
    const pendingMechanism = pendingResult?.evidenceFirstMechanism || null;
    const normalizedPending = pendingMechanism &&
      typeof SciLLM.normalizeGeneratedMechanismPreview === 'function'
      ? SciLLM.normalizeGeneratedMechanismPreview(pendingMechanism, 'node-v2') : null;
    const pendingModel = pendingMechanism &&
      typeof SciLLM.createMechanismPendingPreviewModel === 'function'
      ? SciLLM.createMechanismPendingPreviewModel(pendingMechanism) : null;
    const effectiveResult = cross.status === 'needs_review' && pendingResult
      ? pendingResult : result;
    const mechanism = effectiveResult.evidenceFirstMechanism || {};
    const mechanismAudit = mechanism.audit || {};
    const panelDispositions = Array.isArray(mechanism.panelDispositions)
      ? mechanism.panelDispositions : [];
    const presentation = mechanismGenerationUiController.presentation();
    return {
      presentation: {
        status: String(presentation?.status || ''),
        code: String(presentation?.code || ''),
        stage: String(presentation?.stage || presentation?.progress?.stage || ''),
        completed: Number(presentation?.completed ?? presentation?.progress?.completed) || 0,
        total: Number(presentation?.total ?? presentation?.progress?.total) || 0,
        operationId: String(presentation?.operation?.operationId || '')
      },
      crossStatus: String(cross.status || ''),
      crossAuditCode: String(cross.audit?.code || ''),
      draftRevision: Number(draft.revision) || 0,
      saveStatus: String(document.getElementById('mechanismChainSaveStatus')?.textContent || ''),
      pending: {
        present: Boolean(pendingResult),
        valid: Boolean(normalizedPending && pendingModel),
        status: String(normalizedPending?.status || ''),
        digest: pendingResult && typeof SciLLM.stableHash === 'function'
          ? SciLLM.stableHash(pendingResult) : '',
        bytes: pendingResult
          ? new TextEncoder().encode(JSON.stringify(pendingResult)).byteLength : 0,
        canonicalDigest: String(normalizedPending?.canonicalDigest || ''),
        nodeCount: Array.isArray(normalizedPending?.nodes)
          ? normalizedPending.nodes.length : 0,
        relationCount: Array.isArray(normalizedPending?.relations)
          ? normalizedPending.relations.length : 0,
        evidenceCount: Array.isArray(pendingModel?.relations)
          ? pendingModel.relations.reduce((total, relation) =>
            total + (Array.isArray(relation?.panels) ? relation.panels.length : 0), 0)
          : 0,
        panelCount: Number(pendingModel?.panelCount) || 0,
        panelCoverageKnown: pendingModel?.panelCoverageKnown === true
      },
      chain: {
        initialized: chain.initialized === true,
        nodeCount: Array.isArray(chain.nodes) ? chain.nodes.length : 0,
        edgeCount: Array.isArray(chain.edges) ? chain.edges.length : 0,
        evidenceCount: Array.isArray(chain.edges) ? chain.edges.reduce((total, edge) =>
          total + (Array.isArray(edge?.panelEvidence) ? edge.panelEvidence.length : 0), 0) : 0,
        digest: typeof SciLLM.stableHash === 'function'
          ? SciLLM.stableHash({ nodes: chain.nodes || [], edges: chain.edges || [] }) : ''
      },
      evidence: {
        status: String(mechanism.status || audit?.status || ''),
        nodeCount: Array.isArray(mechanism.nodes) ? mechanism.nodes.length
          : Array.isArray(audit?.nodes) ? audit.nodes.length : 0,
        relationCount: Array.isArray(mechanism.relations) ? mechanism.relations.length
          : Array.isArray(audit?.relations) ? audit.relations.length : 0,
        claimCount: Array.isArray(mechanism.claims) ? mechanism.claims.length
          : Array.isArray(audit?.placements) ? audit.placements.length : 0,
        placementCount: Array.isArray(audit?.placements) ? audit.placements.length : 0,
        unresolvedCount: Array.isArray(audit?.unresolvedEvidence)
          ? audit.unresolvedEvidence.length : 0,
        ledgerPanelCount: panelDispositions.length ||
          Number(mechanismAudit.ledgerPanelCount) || 0,
        distinctDispositionPanelCount: new Set(panelDispositions.map(item =>
          String(item?.panelKey || ''))).size,
        dispositionStatusCounts: panelDispositions.reduce((counts, item) => {
          const status = String(item?.status || '');
          counts[status] = (counts[status] || 0) + 1;
          return counts;
        }, {}),
        resolvedPanelCount: panelDispositions.length
          ? panelDispositions.filter(item =>
            !['unresolved', 'excluded_schematic'].includes(item?.status)).length
          : Number(mechanismAudit.resolvedPanelCount) || 0,
        excludedPanelCount: panelDispositions.length
          ? panelDispositions.filter(item => item?.status === 'excluded_schematic').length
          : Number(mechanismAudit.excludedPanelCount) || 0,
        unresolvedPanelCount: panelDispositions.length
          ? panelDispositions.filter(item => item?.status === 'unresolved').length
          : Array.isArray(mechanismAudit.unresolvedPanelKeys)
            ? mechanismAudit.unresolvedPanelKeys.length : 0
      }
    };
  });
}

async function waitForMechanismTerminal(panel, previousOperationId = '') {
  const deadline = Date.now() + uiTimeoutMs;
  let last = null;
  let observedOperationId = '';
  while (Date.now() < deadline) {
    last = await mechanismRuntimeState(panel);
    const operationId = last.presentation.operationId;
    if (operationId && operationId !== previousOperationId) observedOperationId = operationId;
    if (!observedOperationId) {
      await new Promise(resolve => setTimeout(resolve, 250));
      continue;
    }
    if (['complete', 'needs_review', 'failed', 'cancelled', 'revision_conflict']
      .includes(last.presentation.status)) return last;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw safeError('LIVE_MECHANISM_UI_TIMEOUT', { runtimeState: last });
}

async function waitForMechanismProjection(panel, expectedPanelTotal) {
  const deadline = Date.now() + uiTimeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await mechanismRuntimeState(panel);
    if (last.presentation.status === 'complete' && last.crossStatus === 'complete' &&
        last.chain.initialized && last.evidence.ledgerPanelCount === expectedPanelTotal &&
        /已保存|saved/iu.test(last.saveStatus)) return last;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw safeError('LIVE_MECHANISM_PROJECTION_TIMEOUT', { runtimeState: last });
}

async function waitForMechanismReviewProjection(panel, expectedPanelTotal) {
  const deadline = Date.now() + uiTimeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await mechanismRuntimeState(panel);
    if (last.crossStatus === 'needs_review' && last.pending.present &&
        last.pending.valid && last.pending.status === 'needs_review' &&
        last.pending.panelCount === expectedPanelTotal &&
        last.evidence.ledgerPanelCount === expectedPanelTotal &&
        /已保存|saved/iu.test(last.saveStatus)) return last;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw safeError('LIVE_MECHANISM_REVIEW_PROJECTION_TIMEOUT', { runtimeState: last });
}

async function visibleMechanismGeometry(panel) {
  await panel.locator('#mechanismChainList').waitFor({ state: 'visible' });
  await panel.waitForFunction(() => {
    const table = document.querySelector('.workspace-mechanism-matrix');
    const graph = document.querySelector('.workspace-mechanism-mermaid svg, .workspace-mechanism-network');
    return Boolean(table && graph);
  });
  const geometry = await panel.evaluate(() => {
    const visible = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width >= 20 && rect.height >= 8;
    };
    const host = document.getElementById('mechanismChainList');
    const table = host?.querySelector('.workspace-mechanism-matrix');
    const graph = host?.querySelector('.workspace-mechanism-mermaid svg') ||
      host?.querySelector('.workspace-mechanism-network');
    const evidence = [...(table?.querySelectorAll('.workspace-mechanism-matrix-evidence') || [])]
      .filter(visible);
    const rows = [...(table?.querySelectorAll('tbody tr') || [])].filter(visible);
    return {
      hostVisible: visible(host),
      graphVisible: visible(graph),
      graphWidth: Math.round(graph?.getBoundingClientRect().width || 0),
      graphHeight: Math.round(graph?.getBoundingClientRect().height || 0),
      tableVisible: visible(table),
      tableRows: rows.length,
      visibleEvidenceItems: evidence.length,
      visibleEvidenceChars: evidence.reduce((total, item) =>
        total + String(item.innerText || item.textContent || '').trim().length, 0),
      evidenceTextSample: evidence.slice(0, 8).map(item =>
        String(item.innerText || item.textContent || '').trim().slice(0, 160)),
      saveStatus: String(document.getElementById('mechanismChainSaveStatus')?.textContent || '')
    };
  });
  assert.ok(geometry.hostVisible && geometry.graphVisible && geometry.graphWidth >= 80 &&
    geometry.graphHeight >= 40, 'mechanism graph is visibly rendered');
  assert.ok(geometry.tableVisible && geometry.tableRows >= 2 &&
    geometry.visibleEvidenceItems >= 1 && geometry.visibleEvidenceChars >= 2,
  'mechanism evidence matrix is visibly rendered');
  assert.match(geometry.saveStatus, /已保存|saved/iu);
  return geometry;
}

async function visiblePendingMechanismGeometry(panel) {
  const preview = panel.locator('#mechanismChainIssues .mechanism-pending-preview');
  await preview.waitFor({ state: 'visible' });
  await panel.waitForFunction(() => {
    const host = document.querySelector('#mechanismChainIssues .mechanism-pending-preview');
    const diagram = host?.querySelector('[data-pending-preview-diagram]');
    const table = host?.querySelector('.mechanism-pending-preview-table');
    return Boolean(diagram?.querySelector('svg') && table);
  });
  const geometry = await panel.evaluate(() => {
    const visible = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
        Number(style.opacity) > 0 && rect.width >= 20 && rect.height >= 8;
    };
    const host = document.querySelector('#mechanismChainIssues .mechanism-pending-preview');
    const diagram = host?.querySelector('[data-pending-preview-diagram]');
    const graph = diagram?.querySelector('svg');
    const graphNodes = [...(graph?.querySelectorAll('g.node') || [])]
      .filter(node => visible(node) && String(node.textContent || '').trim());
    const graphEdges = [...(graph?.querySelectorAll('.edgePaths path, path.flowchart-link') || [])]
      .filter(edge => edge.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
        Number.isFinite(edge.getTotalLength()) && edge.getTotalLength() > 0);
    const viewBox = graph?.viewBox?.baseVal;
    const finiteGraphGeometry = Boolean(viewBox && Number.isFinite(viewBox.width) &&
      Number.isFinite(viewBox.height) && viewBox.width > 0 && viewBox.height > 0) &&
      [...graph.querySelectorAll('[d], [transform]')].every(element =>
        !/NaN|Infinity|undefined/u.test(`${element.getAttribute('d') || ''} ${element.getAttribute('transform') || ''}`));
    const table = host?.querySelector('.mechanism-pending-preview-table');
    const rows = [...(table?.querySelectorAll('tbody tr') || [])].filter(visible);
    const evidence = [...(table?.querySelectorAll('tbody tr td:nth-child(4) li') || [])]
      .filter(visible);
    const nodeItems = [...(host?.querySelectorAll(
      '.mechanism-pending-preview-nodes li'
    ) || [])].filter(visible);
    return {
      hostVisible: visible(host),
      previewStatus: String(host?.dataset.previewStatus || ''),
      canonicalDigest: String(host?.dataset.canonicalDigest || ''),
      graphVisible: visible(graph),
      graphWidth: Math.round(graph?.getBoundingClientRect().width || 0),
      graphHeight: Math.round(graph?.getBoundingClientRect().height || 0),
      graphNodeItems: graphNodes.length,
      graphEdgeItems: graphEdges.length,
      finiteGraphGeometry,
      disconnectedNodeItems: nodeItems.length,
      tableVisible: visible(table),
      tableRows: rows.length,
      visibleEvidenceItems: evidence.length,
      visibleEvidenceChars: evidence.reduce((total, item) =>
        total + String(item.innerText || item.textContent || '').trim().length, 0),
      saveStatus: String(document.getElementById('mechanismChainSaveStatus')?.textContent || '')
    };
  });
  assert.ok(geometry.hostVisible && geometry.previewStatus === 'needs_review',
    'needs-review pending preview is visibly mounted');
  assert.ok(geometry.graphVisible && geometry.graphWidth >= 80 &&
    geometry.graphHeight >= 40 && geometry.graphNodeItems >= 2 &&
    geometry.graphEdgeItems >= 1 && geometry.finiteGraphGeometry,
  'needs-review pending preview visibly renders nodes and graph');
  assert.ok(geometry.tableVisible && geometry.tableRows >= 1 &&
    geometry.visibleEvidenceItems >= 1 && geometry.visibleEvidenceChars >= 2,
  'needs-review pending preview visibly renders the evidence table');
  assert.match(geometry.saveStatus, /已保存|saved/iu);
  return geometry;
}

function summarizeProviderEvidence(calls) {
  const extraction = calls.filter(call => call.request.stage === 'panel_evidence_extraction');
  const mapping = calls.filter(call => call.request.stage === 'panel_relation_mapping');
  const extractionItems = extraction.flatMap(call => call.request.extractionSourceEvidence);
  const extractionKeys = extraction.flatMap(call => call.request.extractionPanelKeys);
  const mappingKeys = mapping.flatMap(call => call.request.mappingPanelKeys);
  const sourceEvidenceKeys = extractionItems.filter(item =>
    item.handlePresent && item.sourceAnalysisDigest && item.directObservationChars > 0 &&
    item.evidenceFieldCount > 0).map(item => item.panelKey);
  return {
    extractionRequestCount: extraction.length,
    canonicalRequestCount: calls.filter(call =>
      call.request.stage === 'canonical_node_proposal').length,
    mappingRequestCount: mapping.length,
    projectionCount: extractionKeys.length,
    distinctProjectionCount: new Set(extractionKeys).size,
    mappingProjectionCount: mappingKeys.length,
    distinctMappingProjectionCount: new Set(mappingKeys).size,
    panelsWithSourceEvidence: extractionItems.filter(item =>
      item.handlePresent && item.sourceAnalysisDigest && item.directObservationChars > 0 &&
      item.evidenceFieldCount > 0).length,
    distinctPanelsWithSourceEvidence: new Set(sourceEvidenceKeys).size,
    evidenceChars: extractionItems.reduce((total, item) => total + item.evidenceChars, 0)
  };
}

function safeTemporaryRemoval(target, prefix) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(target);
  if (!resolved.startsWith(temporaryRoot + path.sep) ||
      !path.basename(resolved).startsWith(prefix)) return;
  fs.rmSync(resolved, { recursive: true, force: true });
}

function redactedText(value, secret = '') {
  try {
    return String(JSON.parse(sanitizedArtifact(
      JSON.stringify({ value: String(value || '') }), secret
    )).value || '');
  } catch (_) {
    return 'REDACTION_FAILED';
  }
}

function reviewLedgerComplete(evidence, expectedTotal = legacyExpectedPanelTotal) {
  const counts = evidence?.dispositionStatusCounts || {};
  const allowed = new Set([
    'linked_causal', 'linked_correlative', 'node_evidence',
    'excluded_schematic', 'unresolved'
  ]);
  const keys = Object.keys(counts);
  const total = keys.reduce((sum, key) => sum + Number(counts[key] || 0), 0);
  return keys.every(key => allowed.has(key)) &&
    Number(evidence?.ledgerPanelCount) === expectedTotal &&
    Number(evidence?.distinctDispositionPanelCount) === expectedTotal &&
    total === expectedTotal &&
    Number(evidence?.resolvedPanelCount || 0) +
      Number(evidence?.excludedPanelCount || 0) +
      Number(evidence?.unresolvedPanelCount || 0) === expectedTotal;
}

function sameMechanismChain(left, right) {
  return Boolean(left && right) && left.digest === right.digest &&
    left.initialized === right.initialized && left.nodeCount === right.nodeCount &&
    left.edgeCount === right.edgeCount && left.evidenceCount === right.evidenceCount;
}

async function run() {
  const args = parseArguments(process.argv.slice(2));
  resolveRuntimeOptions(args); // Reject invalid runtime options before reading inputs/credentials.
  const { networkTransport } = resolveConnectionOptions(args);
  const skipEntryReload = args.noEntryReload === true || args.entryPeerEdit === true;
  const mechanismCallCap = Number(args.mechanismCallCap || defaultMechanismCallCap);
  if (!Number.isSafeInteger(mechanismCallCap) || mechanismCallCap < 1 || mechanismCallCap > 40) {
    throw safeError('LIVE_MECHANISM_ARGUMENT_INVALID');
  }
  const extensionRoot = path.resolve(args.extensionRoot || process.env.SCI_EXTENSION_ROOT || projectRoot);
  const outputDirectory = path.resolve(args.outputDir || process.env.SCI_QA_OUTPUT_DIR ||
    path.join(projectRoot, 'output/playwright/live-mechanism-extension'));
  const replayDirectory = path.resolve(args.figureReplayDir ||
    process.env.SCI_LIVE_FIGURE_REPLAY_DIR ||
    path.join(projectRoot, 'tmp/live-figure-text-round2-replay'));
  const mechanismReplayDirectory = args.mechanismReplayDir
    ? path.resolve(args.mechanismReplayDir) : '';
  const articlePath = path.resolve(args.article || process.env.SCI_LIVE_ARTICLE_PATH ||
    path.join(projectRoot, 'tmp/cell-live-acceptance/article.json'));
  if (!fs.existsSync(path.join(extensionRoot, 'manifest.json'))) {
    throw safeError('LIVE_MECHANISM_EXTENSION_ROOT_INVALID');
  }
  if (!fs.existsSync(articlePath)) throw safeError('LIVE_MECHANISM_ARTICLE_NOT_FOUND');
  if (replayDirectory === outputDirectory) throw safeError('LIVE_MECHANISM_REPLAY_OUTPUT_CONFLICT');
  if (mechanismReplayDirectory && mechanismReplayDirectory === outputDirectory) {
    throw safeError('LIVE_MECHANISM_REPLAY_OUTPUT_CONFLICT');
  }
  const article = loadMechanismArticle(articlePath, args.sourceManifest);
  const expectedPanelTotal = article.expectedPanelTotal;
  const replayEntries = loadReplayEntries(replayDirectory,
    args.sourceManifest ? {maxEntries:512} : undefined);
  if (!replayEntries.length || replayEntries.some(entry => entry.status !== 200)) {
    throw safeError('LIVE_MECHANISM_FIGURE_REPLAY_INVALID');
  }
  if (args.sourceManifest) assertFigureReplaySource(replayEntries, article);
  const mechanismReplayEntries = mechanismReplayDirectory
    ? loadMechanismReplayEntries(mechanismReplayDirectory,
      args.sourceManifest ? { maxEntries: 96 } : undefined) : null;
  const { model: configuredModel, figureReplayModel, deadlineMs } =
    resolveRuntimeOptions(args, replayEntries, mechanismReplayEntries);
  if (args.preflightOnly) {
    return {outcome:{status:'INPUT_READY', classification:'input-only; no browser or API validation'},
      configuredModel, figureReplayModel, deadlineMs, networkTransport,
      article:{sourceMode:article.sourceMode,figureCount:article.figures.length,expectedPanelTotal},
      figureReplayCalls:0,mechanismRealApiCalls:0,mechanismFixtureCalls:0,mechanismReplayCalls:0};
  }
  clearKnownArtifacts(outputDirectory);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-live-mechanism-profile-'));
  const temporaryExtension = fs.mkdtempSync(
    path.join(os.tmpdir(), 'brevess-live-mechanism-extension-')
  );
  const downloadedHashes = new Set(article.figures.map(figure => sha256(figure.imageBytes)));
  const report = {
    schemaVersion: 1,
    acceptance: args.liveMechanism
      ? 'real MV3 content/popup/background mechanism generation with real DeepSeek mechanism calls'
      : args.liveMechanismTail
        ? 'real MV3 mechanism generation with strict saved prefix replay followed by live DeepSeek tail calls'
      : mechanismReplayEntries
        ? 'real MV3 content/popup/background mechanism generation with saved mechanism response replay'
      : 'real MV3 content/popup/background mechanism generation with deterministic local mechanism fixture',
    figureEvidenceSource: 'saved sanitized Figure responses; strict request matching at each boundary',
    mechanismProvider: args.liveMechanism
      ? 'deepseek' : args.liveMechanismTail
        ? 'saved-replay+deepseek-tail'
        : mechanismReplayEntries ? 'saved-replay' : 'local-fixture',
    configuredModel,
    figureReplayModel,
    networkTransport,
    deadlineMs,
    deadlineScope: 'after-secret-prompt; browser/Figure/mechanism/save/reload; bounded cleanup separate',
    endpoint: providerPath,
    figureReplaySource: {
      directory: path.basename(replayDirectory),
      reportSha256: sha256(fs.readFileSync(path.join(replayDirectory, 'report.json'))),
      expectedCalls: replayEntries.length
    },
    ...(mechanismReplayEntries ? {
      mechanismReplaySource: {
        directory: path.basename(mechanismReplayDirectory),
        reportSha256: sha256(fs.readFileSync(
          path.join(mechanismReplayDirectory, 'report.json')
        )),
        expectedCalls: mechanismReplayEntries.length
      }
    } : {}),
    mechanismCallCap,
    mechanismCallCapScope: args.liveMechanismTail
      ? 'new-real-tail-calls-only' : mechanismReplayEntries
        ? 'saved-replay-only; bounded-by-loaded-entry-count'
        : 'all-mechanism-provider-boundary-calls',
    providerTimeoutMs,
    acceptNeedsReview: args.acceptNeedsReview === true,
    entryReload: skipEntryReload ? 'disabled' : 'enabled',
    entryPeerEdit: null,
    figureReplayCalls: 0,
    mechanismFixtureCalls: 0,
    mechanismRealApiCalls: 0,
    mechanismReplayCalls: 0,
    callCapRejected: false,
    boundaryErrorCode: '',
    article: {
      sourceMode: article.sourceMode,
      livePublisherDomValidated: false,
      figureCount: article.figures.length,
      sourceManifestSha256: args.sourceManifest ? sha256(fs.readFileSync(args.sourceManifest)) : '',
      titleSha256: sha256(article.title),
      urlOrigin: new URL(article.url).origin,
      paragraphCount: article.paragraphs.length,
      expectedPanelTotal
    },
    sourceHashes: {},
    verifierSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
    testInjections: [],
    figureReplay: [],
    mechanismProviderCalls: [],
    contentHandoff: null,
    contentBinding: null,
    popupBindingSent: null,
    popupBindingBeforeGenerate: null,
    preGenerateRuntime: null,
    rawMechanismResponse: null,
    backgroundResponse: null,
    receiptCheckpointDiagnostic: null,
    providerEvidence: null,
    outcome: {
      status: 'FAIL',
      classification: '',
      terminalStatus: '',
      terminalErrorCode: '',
      terminalErrorMessage: '',
      nodeCount: 0,
      edgeCount: 0,
      evidenceCount: 0,
      ledgerPanelCount: 0,
      projectionCount: 0,
      saved: false,
      reloaded: false,
      visible: null,
      reloadedVisible: null
    },
    screenshots: [],
    diagnostics: []
  };
  for (const relativeFile of [
    'manifest.json', 'content.js', 'popup.js', 'background.js',
    'core/background-router.js', 'core/evidence-first-mechanism.js',
    'core/mechanism-operation-coordinator.js',
    'core/mechanism-pending-preview.js',
    'core/figure-workspace.js', 'scripts/verify-live-mechanism-extension.mjs'
  ]) {
    const sourceFile = path.join(extensionRoot, ...relativeFile.split('/'));
    if (fs.existsSync(sourceFile) && fs.statSync(sourceFile).isFile()) {
      report.sourceHashes[relativeFile] = sha256(fs.readFileSync(sourceFile));
    }
  }
  const state = {
    boundaryCalls: 0,
    figureReplayCalls: 0,
    mechanismFixtureCalls: 0,
    mechanismRealApiCalls: 0,
    mechanismReplayCalls: 0,
    mechanismReplayUsedSequences: new Set(),
    callCapRejected: false,
    boundaryErrorCode: '',
    lastRequestBody: '',
    lastResponseBody: ''
  };
  let secret = '';
  let proxy = null;
  let context = null;
  let panel = null;
  let paper = null;
  let worker = null;
  let deadline = null;
  let launchInFlight = false;
  const startedAt = Date.now();
  const persist = () => {
    report.figureReplayCalls = state.figureReplayCalls;
    report.mechanismFixtureCalls = state.mechanismFixtureCalls;
    report.mechanismRealApiCalls = state.mechanismRealApiCalls;
    report.mechanismReplayCalls = state.mechanismReplayCalls;
    report.callCapRejected = state.callCapRejected;
    report.boundaryErrorCode = state.boundaryErrorCode;
    report.elapsedMs = Date.now() - startedAt;
    if (deadline?.signal.aborted) {
      report.errorCode = 'LIVE_MECHANISM_DEADLINE_EXCEEDED';
      report.outcome.status = 'FAIL';
      report.outcome.classification = 'TIMEOUT';
      report.outcome.terminalErrorCode = report.errorCode;
    }
    writeReport(report, outputDirectory, secret);
  };
  persist();
  try {
    if (args.liveMechanism || args.liveMechanismTail) {
      const credential = await loadMechanismCredential(args, configuredModel);
      secret = credential.secret;
      report.credentialInput = credential.metadata;
    }
    deadline = createRunDeadline(deadlineMs);
    deadline.signal.addEventListener('abort', () => {
      void context?.close().catch(() => {});
      proxy?.server?.closeAllConnections();
    }, { once: true });
    await deadline.run(async () => {
    const fetchImpl = networkTransport === 'curl'
      ? (await import('./lib/live-curl-fetch.mjs')).curlFetch : globalThis.fetch;
    proxy = await startCombinedProxy({
      secret,
      replayEntries,
      mechanismReplayEntries,
      liveMechanism: args.liveMechanism === true,
      liveMechanismTail: args.liveMechanismTail === true,
      mechanismCallCap, configuredModel, deadline,
      report,
      state,
      outputDirectory,
      downloadedHashes,
      strictFigureSource: Boolean(args.sourceManifest), fetchImpl
    });
    copyFigureExtension(extensionRoot, temporaryExtension, proxy.url, report);
    installReceiptCheckpointDiagnostic(temporaryExtension, report);
    installContentHandoffDiagnostic(temporaryExtension, report, proxy.url);
    report.testBoundary = args.liveMechanism
      ? 'saved Figure replay followed by transparent live mechanism proxy'
      : args.liveMechanismTail
        ? 'saved Figure replay, strict mechanism prefix replay, then transparent live mechanism tail proxy'
      : mechanismReplayEntries
        ? 'saved Figure replay followed by exact semantic mechanism response replay'
      : 'saved Figure replay followed by deterministic local mechanism provider fixture';
    persist();
    deadline.check(); // Synchronous extension copying can consume the entire budget.
    launchInFlight = true;
    context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge',
      timeout: Math.min(30_000, deadline.remainingMs()),
      headless: process.env.SCI_LIVE_HEADLESS !== '0',
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
      args: [
        `--disable-extensions-except=${temporaryExtension}`,
        `--load-extension=${temporaryExtension}`
      ]
    }).then(created => {
      if (deadline.signal.aborted) void created.close().catch(() => {});
      return created;
    }).finally(() => { launchInFlight = false; });
    deadline.check();
    attachDiagnostics(context, report, persist, secret);
    await context.route(/^https?:\/\//u, async route => {
      const url = route.request().url();
      if (url === article.url) {
        await route.fulfill({ contentType: 'text/html', body: articleHtml(article) });
        return;
      }
      const figure = article.figures.find(item => item.publicImageUrl === url);
      if (figure) {
        await route.fulfill({ contentType: 'image/jpeg', body: figure.imageBytes });
        return;
      }
      if (url.startsWith(`${proxy.url}/`)) {
        await route.continue();
        return;
      }
      await route.abort('blockedbyclient');
    });
    paper = context.pages()[0] || await context.newPage();
    await paper.goto(article.url, { waitUntil: 'domcontentloaded' });
    await paper.waitForFunction(count => [...document.images].length === count &&
      [...document.images].every(image => image.complete && image.naturalWidth > 0), article.figures.length);
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const tab = await worker.evaluate(async url =>
      (await chrome.tabs.query({})).find(item => item.url === url), article.url);
    assert.ok(tab?.id, 'mechanism acceptance article tab exists');
    await worker.evaluate(async activeTab => {
      const activation = await SciLLM.markTabActivated(chrome.storage.session, activeTab);
      await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
    }, tab);
    panel = await context.newPage();
    await panel.setViewportSize({ width: 560, height: 1050 });
    await panel.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded'
    });
    await paper.bringToFront();
    await panel.waitForFunction(expected =>
      document.getElementById('sidePanelPaperTitle')?.textContent === expected,
    article.title);
    await setupProfile(panel, figureReplayModel);
    await panel.waitForFunction(count =>
      document.querySelectorAll('.workspace-figure-card[data-figure-id]').length === count, article.figures.length);
    const figureIds = await discoveredFigureIds(panel, article.figures);
    let figuresComplete;
    for (const figure of article.figures) {
      figuresComplete = await clickFigureReplay(panel, figureIds[figure.sourceId], figure.expectedPanels);
    }
    assert.equal(state.figureReplayCalls, replayEntries.length, 'all selected Figure responses were replayed');
    const completedFigures = archiveFigures(figuresComplete.archive);
    for (const figure of article.figures) {
      assert.ok(completedFigure(completedFigures.find(item =>
        item.figureId === figureIds[figure.sourceId]), figure.expectedPanels),
      figure.label + ' retains all source-bound substantive Panels');
    }
    if (!skipEntryReload) {
      // The legacy scenario refreshes the popup onto the durable Figure revision before entry.
      await panel.reload({ waitUntil: 'domcontentloaded' });
      await paper.bringToFront();
      await panel.waitForFunction(expected =>
        document.getElementById('sidePanelPaperTitle')?.textContent === expected,
      article.title);
      await setupProfile(panel, figureReplayModel);
      await panel.waitForFunction(count =>
        document.querySelectorAll('.workspace-figure-card[data-figure-id]').length === count &&
        document.getElementById('mechanismChainSaveStatus')?.textContent?.trim() === '已保存', article.figures.length);
    }
    await setupProfile(panel, configuredModel);
    deadline.check();
    const beforeGenerateScreenshot = path.join(outputDirectory, 'live-mechanism-before-generate.png');
    await panel.screenshot({ path: beforeGenerateScreenshot, fullPage: true });
    report.screenshots.push(beforeGenerateScreenshot);
    report.popupBindingBeforeGenerate = await popupBindingSnapshot(panel);
    report.preGenerateRuntime = await mechanismRuntimeState(panel);
    persist();
    if (args.entryPeerEdit) {
      report.entryPeerEdit = await entryPeerEditAndClick(panel, figureIds[article.figures[0].sourceId]);
      assert.equal(report.entryPeerEdit.returnedRevision,
        report.entryPeerEdit.expectedRevision + 1,
      'peer edit commits exactly one legal Figure workspace revision');
      persist();
    } else {
      await panel.locator('#figureWorkspace .workspace-logic-map-open').click();
    }
    let terminal = await waitForMechanismTerminal(
      panel, report.preGenerateRuntime.presentation.operationId
    );
    if (terminal.presentation.status === 'complete') {
      terminal = await waitForMechanismProjection(panel, expectedPanelTotal);
    } else if (args.acceptNeedsReview && terminal.presentation.status === 'needs_review') {
      terminal = await waitForMechanismReviewProjection(panel, expectedPanelTotal);
    }
    await recordRawMechanismResponse(report, panel, outputDirectory, secret);
    await recordContentBackgroundData(report, panel, outputDirectory, secret);
    report.popupBindingSent ||= await panel.evaluate(() =>
      globalThis.__MECHANISM_QA_POPUP_BINDING_SENT__ || null).catch(() => null);
    report.contentBinding ||= await readStoredBindingDiagnostic(worker);
    report.providerEvidence = summarizeProviderEvidence(report.mechanismProviderCalls);
    if (mechanismReplayEntries &&
        (state.mechanismReplayCalls !== mechanismReplayEntries.length ||
          state.mechanismReplayUsedSequences.size !== mechanismReplayEntries.length)) {
      throw safeError('LIVE_MECHANISM_REPLAY_REQUEST_COUNT_MISMATCH');
    }
    const acceptedNeedsReview = args.acceptNeedsReview === true &&
      (terminal.presentation.status || terminal.crossStatus) === 'needs_review';
    Object.assign(report.outcome, {
      terminalStatus: terminal.presentation.status || terminal.crossStatus,
      terminalErrorCode: (terminal.presentation.status || terminal.crossStatus) === 'complete'
        ? '' : terminal.presentation.code || terminal.crossAuditCode,
      nodeCount: acceptedNeedsReview ? terminal.pending.nodeCount : terminal.chain.nodeCount,
      edgeCount: acceptedNeedsReview ? terminal.pending.relationCount : terminal.chain.edgeCount,
      evidenceCount: acceptedNeedsReview
        ? terminal.pending.evidenceCount : terminal.chain.evidenceCount,
      ledgerPanelCount: terminal.evidence.ledgerPanelCount,
      projectionCount: report.providerEvidence.projectionCount
    });
    const completedArchive = await currentArchive(panel);
    if (report.entryPeerEdit) {
      report.entryPeerEdit.completedValue = archivedPanelFieldValue(
        completedArchive, report.entryPeerEdit
      );
      report.entryPeerEdit.preservedOnComplete =
        report.entryPeerEdit.completedValue === report.entryPeerEdit.newValue;
      assert.ok(report.entryPeerEdit.preservedOnComplete,
        'mechanism completion preserves the peer-edited Panel field');
    }
    writeArtifact(outputDirectory, acceptedNeedsReview
      ? 'mechanism-archive-needs-review-redacted.json'
      : 'mechanism-archive-completed-redacted.json',
      JSON.stringify(completedArchive), secret);
    const completedScreenshot = path.join(outputDirectory, acceptedNeedsReview
      ? 'live-mechanism-needs-review.png' : 'live-mechanism-completed.png');
    await panel.screenshot({ path: completedScreenshot, fullPage: true });
    report.screenshots.push(completedScreenshot);
    persist();
    if (report.outcome.terminalStatus !== 'complete' && !acceptedNeedsReview) {
      throw safeError(report.outcome.terminalErrorCode || 'LIVE_MECHANISM_NOT_COMPLETE');
    }
    assert.ok(report.contentHandoff && !report.contentHandoff.parseError,
      'content handoff diagnostic was observed');
    const handoffFigures = report.contentHandoff.figureEvidence || [];
    assert.equal(handoffFigures.reduce((sum, item) => sum + item.panelCount, 0),
      expectedPanelTotal, 'content sends all selected source Panels');
    assert.equal(handoffFigures.reduce((sum, item) => sum + item.panelsWithEvidence, 0),
      expectedPanelTotal, 'content sends substantive evidence for all selected source Panels');
    assert.equal(report.providerEvidence.distinctProjectionCount, expectedPanelTotal,
      'background provider extraction observes all selected source projections');
    assert.equal(report.providerEvidence.distinctMappingProjectionCount, expectedPanelTotal,
      'background provider mapping observes all selected source projections');
    if (acceptedNeedsReview) {
      assert.equal(report.providerEvidence.distinctPanelsWithSourceEvidence,
        expectedPanelTotal,
      'every distinct provider projection retains source Panel evidence');
      assert.ok(terminal.pending.present && terminal.pending.valid &&
        terminal.pending.status === 'needs_review' && terminal.pending.bytes > 0 &&
        terminal.pending.nodeCount >= 2 && terminal.pending.relationCount >= 1 &&
        terminal.pending.evidenceCount >= 1 && terminal.pending.panelCoverageKnown,
      'needs-review result is a valid nonempty pending mechanism preview');
      assert.ok(reviewLedgerComplete(terminal.evidence, expectedPanelTotal),
        'needs-review ledger preserves all resolved, excluded and unresolved Panels');
      assert.ok(sameMechanismChain(report.preGenerateRuntime.chain, terminal.chain),
        'needs-review result does not overwrite the previously saved mechanism chain');
      report.outcome.visible = await visiblePendingMechanismGeometry(panel);
      assert.equal(report.outcome.visible.canonicalDigest,
        terminal.pending.canonicalDigest,
      'visible pending preview is bound to the validated canonical digest');
      report.outcome.saved = true;
      const mechanismCallsBeforeReload = state.mechanismFixtureCalls +
        state.mechanismRealApiCalls + state.mechanismReplayCalls;
      const beforeReload = terminal;
      const panelUrl = panel.url();
      await panel.close();
      panel = await context.newPage();
      await panel.setViewportSize({ width: 560, height: 1050 });
      await panel.goto(panelUrl, { waitUntil: 'domcontentloaded' });
      report.outcome.reopenMode = 'new-popup-page; same-isolated-browser-process';
      await paper.bringToFront();
      await panel.waitForFunction(expected =>
        document.getElementById('sidePanelPaperTitle')?.textContent === expected,
      article.title);
      await setupProfile(panel, configuredModel);
      await panel.waitForFunction(count =>
        document.querySelectorAll('.workspace-figure-card[data-figure-id]').length === count, article.figures.length);
      await panel.locator('#figureWorkspace .workspace-logic-map-open').click();
      await new Promise(resolve => setTimeout(resolve, 750));
      const reloaded = await waitForMechanismReviewProjection(panel, expectedPanelTotal);
      report.outcome.reloadedVisible = await visiblePendingMechanismGeometry(panel);
      const mechanismCallsAfterReload = state.mechanismFixtureCalls +
        state.mechanismRealApiCalls + state.mechanismReplayCalls;
      report.outcome.reloaded = reloaded.pending.digest === beforeReload.pending.digest &&
        reloaded.pending.bytes === beforeReload.pending.bytes &&
        reloaded.pending.canonicalDigest === beforeReload.pending.canonicalDigest &&
        reloaded.pending.nodeCount === beforeReload.pending.nodeCount &&
        reloaded.pending.relationCount === beforeReload.pending.relationCount &&
        reloaded.pending.evidenceCount === beforeReload.pending.evidenceCount &&
        reviewLedgerComplete(reloaded.evidence, expectedPanelTotal) &&
        sameMechanismChain(report.preGenerateRuntime.chain, reloaded.chain) &&
        mechanismCallsAfterReload === mechanismCallsBeforeReload;
      assert.ok(report.outcome.reloaded,
        'reload preserves pending bytes, graph, evidence, ledger and saved chain with zero calls');
      const reloadedArchive = await currentArchive(panel);
      writeArtifact(outputDirectory, 'mechanism-archive-needs-review-reloaded-redacted.json',
        JSON.stringify(reloadedArchive), secret);
      const reloadScreenshot = path.join(
        outputDirectory, 'live-mechanism-needs-review-reloaded.png'
      );
      await panel.screenshot({ path: reloadScreenshot, fullPage: true });
      report.screenshots.push(reloadScreenshot);
      deadline.check();
      report.outcome.status = 'PASS_REVIEW';
      report.outcome.classification = 'PARTIAL';
      persist();
      return report;
    }
    assert.equal(report.providerEvidence.panelsWithSourceEvidence, expectedPanelTotal,
      'every provider projection retains source Panel evidence');
    assert.equal(terminal.evidence.ledgerPanelCount, expectedPanelTotal,
      'mechanism ledger accounts for all selected source Panels');
    assert.equal(terminal.evidence.resolvedPanelCount, expectedPanelTotal,
      'mechanism resolves all selected source Panels');
    assert.equal(terminal.evidence.unresolvedPanelCount, 0,
      'mechanism has no unresolved Panels');
    assert.ok(terminal.chain.initialized && terminal.chain.nodeCount >= 2 &&
      terminal.chain.edgeCount >= 1 && terminal.chain.evidenceCount >= expectedPanelTotal,
    'saved mechanism chain contains graph and Panel evidence');
    report.outcome.visible = await visibleMechanismGeometry(panel);
    report.outcome.saved = true;
    const mechanismCallsBeforeReload = state.mechanismFixtureCalls +
      state.mechanismRealApiCalls + state.mechanismReplayCalls;
    const beforeReload = terminal;
    await panel.reload({ waitUntil: 'domcontentloaded' });
    await paper.bringToFront();
    await panel.waitForFunction(expected =>
      document.getElementById('sidePanelPaperTitle')?.textContent === expected,
    article.title);
    await setupProfile(panel, configuredModel);
    await panel.waitForFunction(count =>
      document.querySelectorAll('.workspace-figure-card[data-figure-id]').length === count, article.figures.length);
    await panel.locator('#figureWorkspace .workspace-logic-map-open').click();
    const reloaded = await mechanismRuntimeState(panel);
    report.outcome.reloadedVisible = await visibleMechanismGeometry(panel);
    const mechanismCallsAfterReload = state.mechanismFixtureCalls +
      state.mechanismRealApiCalls + state.mechanismReplayCalls;
    report.outcome.reloaded = reloaded.chain.digest === beforeReload.chain.digest &&
      reloaded.chain.nodeCount === beforeReload.chain.nodeCount &&
      reloaded.chain.edgeCount === beforeReload.chain.edgeCount &&
      reloaded.chain.evidenceCount === beforeReload.chain.evidenceCount &&
      reloaded.evidence.ledgerPanelCount === beforeReload.evidence.ledgerPanelCount &&
      mechanismCallsAfterReload === mechanismCallsBeforeReload;
    assert.ok(report.outcome.reloaded,
      'reload preserves mechanism graph, ledger and evidence without provider calls');
    const reloadedArchive = await currentArchive(panel);
    if (report.entryPeerEdit) {
      report.entryPeerEdit.reloadedValue = archivedPanelFieldValue(
        reloadedArchive, report.entryPeerEdit
      );
      report.entryPeerEdit.preservedOnReload =
        report.entryPeerEdit.reloadedValue === report.entryPeerEdit.newValue;
      assert.ok(report.entryPeerEdit.preservedOnReload,
        'reload preserves the peer-edited Panel field');
    }
    writeArtifact(outputDirectory, 'mechanism-archive-reloaded-redacted.json',
      JSON.stringify(reloadedArchive), secret);
    const reloadScreenshot = path.join(outputDirectory, 'live-mechanism-reloaded.png');
    await panel.screenshot({ path: reloadScreenshot, fullPage: true });
    report.screenshots.push(reloadScreenshot);
    deadline.check();
    report.outcome.status = 'PASS';
    report.outcome.classification = 'COMPLETE';
    persist();
    });
  } catch (error) {
    report.errorCode = safeErrorCode(error);
    report.outcome.terminalErrorCode = String(
      error?.terminalErrorCode || report.outcome.terminalErrorCode || report.errorCode
    ).slice(0, 100);
    report.outcome.terminalErrorMessage = redactedText(error?.message || '', secret).slice(0, 1000);
    if (error?.runtimeState) report.failureRuntimeState = error.runtimeState;
    if (panel && !deadline?.signal.aborted) {
      await deadline.run(async () => {
      if (!report.rawMechanismResponse) {
        await recordRawMechanismResponse(report, panel, outputDirectory, secret);
      }
      if (!report.backgroundDataArtifact) {
        await recordContentBackgroundData(report, panel, outputDirectory, secret);
      }
      report.popupBindingSent ||= await panel.evaluate(() =>
        globalThis.__MECHANISM_QA_POPUP_BINDING_SENT__ || null).catch(() => null);
      report.contentBinding ||= await readStoredBindingDiagnostic(worker);
      try {
        const runtime = await mechanismRuntimeState(panel);
        report.failureRuntimeState = runtime;
      } catch (_) {}
      try {
        const archive = await currentArchive(panel);
        if (report.entryPeerEdit) {
          report.entryPeerEdit.failureValue = archivedPanelFieldValue(
            archive, report.entryPeerEdit
          );
          report.entryPeerEdit.preservedAtFailure =
            report.entryPeerEdit.failureValue === report.entryPeerEdit.newValue;
        }
        report.failureArchive = writeArtifact(outputDirectory,
          'mechanism-archive-failure-redacted.json', JSON.stringify(archive), secret);
      } catch (_) {}
      const failureScreenshot = path.join(outputDirectory, 'live-mechanism-failure.png');
      await panel.screenshot({ path: failureScreenshot, fullPage: true }).catch(() => {});
      if (fs.existsSync(failureScreenshot)) report.screenshots.push(failureScreenshot);
      report.failureVisibleText = await panel.evaluate(() => [...document.querySelectorAll(
        '#statusMessage, #mechanismGenerationStatus, #mechanismChainIssues, [role="alert"]'
      )].filter(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          rect.width > 0 && rect.height > 0;
      }).map(element => String(element.innerText || '').trim()).filter(Boolean).slice(0, 40))
        .catch(() => []);
      }).catch(() => {});
    }
    report.providerEvidence = summarizeProviderEvidence(report.mechanismProviderCalls);
    persist();
    throw error;
  } finally {
    persist();
    deadline?.dispose();
    // A late browser launch must close itself; retain its temporary files if not yet closed.
    let cleanupTimer;
    const closed = await Promise.race([
      (async () => {
        if (context) await context.close();
        if (proxy?.server) {
          proxy.server.closeAllConnections();
          await new Promise(resolve => proxy.server.close(resolve));
        }
        return !launchInFlight;
      })().catch(() => false),
      new Promise(resolve => { cleanupTimer = setTimeout(() => resolve(false), 10_000); })
    ]);
    clearTimeout(cleanupTimer);
    finalizeRunCleanup(report, closed, profile, temporaryExtension);
    persist();
    secret = '';
  }
  return report;
}

const directExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directExecution) {
  run().then(report => {
    process.stdout.write(`${JSON.stringify({
      status: report.outcome.status,
      classification: report.outcome.classification,
      mechanismProvider: report.mechanismProvider,
      networkTransport: report.networkTransport,
      figureReplayCalls: report.figureReplayCalls,
      mechanismFixtureCalls: report.mechanismFixtureCalls,
      mechanismRealApiCalls: report.mechanismRealApiCalls,
      mechanismReplayCalls: report.mechanismReplayCalls,
      terminalStatus: report.outcome.terminalStatus,
      ledgerPanelCount: report.outcome.ledgerPanelCount,
      projectionCount: report.outcome.projectionCount,
      nodeCount: report.outcome.nodeCount,
      edgeCount: report.outcome.edgeCount,
      evidenceCount: report.outcome.evidenceCount,
      reloaded: report.outcome.reloaded
    })}\n`);
  }).catch(error => {
    process.stderr.write(`FAIL ${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  mechanismSourcePlan,
  loadMechanismArticle,
  matchMechanismFigureCards,
  captionFingerprint,
  assertFigureReplaySource,
  assertFigureReplaySemanticMatch,
  writeReport,
  run,
  parseArguments,
  resolveRuntimeOptions,
  resolveConnectionOptions,
  loadMechanismCredential,
  startCombinedProxy,
  createRunDeadline,
  finalizeRunCleanup,
  deepSeekUserPayload,
  mechanismRequestSummary,
  mechanismSemanticInput,
  mechanismReplayComparison,
  assertMechanismReplayMatch,
  selectMechanismReplayEntry,
  mechanismBoundaryMode,
  mechanismCallCapConsumed,
  reviewLedgerComplete,
  sameMechanismChain,
  loadMechanismReplayEntries,
  localMechanismProviderOutput,
  deepSeekFixtureEnvelope,
  summarizeProviderEvidence
};
