import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
require('../providers/provider-utils.js');
const {
  createFigurePanelBatchSchema,
  validateFigurePanelBatch
} = require('../core/figure-analysis.js');

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptRoot);
const fixtureRoot = join(projectRoot, 'tmp', 'figure-speed-r3-baseline-flash');
const outputRoot = join(projectRoot, 'tmp', 'native-figure-speed');
const hostPath = join(projectRoot, 'native-host', 'host.js');
const fixtureNames = [
  'provider-request-001-redacted.json',
  'provider-request-003-redacted.json'
];
const TURN_TIMEOUT_MS = 300000;
const MODEL = 'auto';
const REASONING_EFFORT = 'low';
const EVIDENCE_FIELDS = [
  'purpose_zh', 'design_zh', 'comparison_zh', 'direct_observation_zh',
  'observation_source', 'local_inference_zh', 'contribution_zh'
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function timestamp(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : '';
}

function cleanError(error) {
  return {
    code: String(error?.code || ''),
    message: String(error?.message || error || 'Unknown error').slice(0, 1000)
  };
}

function readFixture(name, index) {
  const filePath = join(fixtureRoot, name);
  if (!existsSync(filePath)) throw new Error(`Missing fixture: ${name}`);
  const body = JSON.parse(readFileSync(filePath, 'utf8'));
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemPrompt = String(messages.find(item => item?.role === 'system')?.content || '');
  const userPrompt = String(messages.find(item => item?.role === 'user')?.content || '');
  const input = JSON.parse(userPrompt);
  const analysisDepth = input.analysis_depth === 'deep' ? 'deep' : 'standard';
  const responseSchema = createFigurePanelBatchSchema(analysisDepth);
  const codexSystemPrompt = systemPrompt +
    '\nReturn only one JSON object that validates against this JSON Schema:\n' +
    JSON.stringify(responseSchema);
  const request = {
    conversationKey: '',
    conversationLabel: 'Brevess structured task',
    profileId: 'profile_codex_native_figure_speed',
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    systemPrompt: codexSystemPrompt,
    userPrompt,
    images: [],
    maxOutputTokens: Number(body.max_tokens) || 11776,
    ephemeral: true
  };
  const requestHash = sha256(JSON.stringify(request));
  return {
    id: String.fromCharCode(65 + index),
    name,
    filePath,
    input,
    request,
    requestHash,
    fixtureSha256: sha256(readFileSync(filePath)),
    schemaSha256: sha256(JSON.stringify(responseSchema)),
    promptSha256: sha256(`${codexSystemPrompt}\n${userPrompt}`),
    expectedPanels: Array.isArray(input.expected_panel_labels)
      ? input.expected_panel_labels.map(String) : []
  };
}

function nonEmpty(value) {
  if (Array.isArray(value)) return value.some(nonEmpty);
  if (value && typeof value === 'object') return Object.values(value).some(nonEmpty);
  return String(value ?? '').trim().length > 0;
}

function validateOutput(outputText, fixture) {
  let parsed;
  try {
    parsed = globalThis.SciLLM.parseJsonText(outputText);
  } catch (error) {
    return {
      validJson: false,
      productionValidationPassed: false,
      validationError: cleanError(error),
      receivedPanels: [],
      exactPanelCoverage: false,
      evidenceCompleteness: null,
      parsed: null
    };
  }
  const rawPanels = Array.isArray(parsed?.panels) ? parsed.panels : [];
  const receivedPanels = rawPanels.map(panel => String(panel?.panel || '')).filter(Boolean);
  const fieldCounts = Object.fromEntries(EVIDENCE_FIELDS.map(field => [
    field, rawPanels.filter(panel => nonEmpty(panel?.[field])).length
  ]));
  const evidenceCompleteness = {
    panelCount: rawPanels.length,
    allEvidenceFieldsPanelCount: rawPanels.filter(panel =>
      EVIDENCE_FIELDS.every(field => nonEmpty(panel?.[field]))
    ).length,
    substantivePanelCount: rawPanels.filter(panel => [
      'purpose_zh', 'design_zh', 'comparison_zh', 'direct_observation_zh',
      'local_inference_zh', 'contribution_zh', 'methods', 'experimental_methods'
    ].some(field => nonEmpty(panel?.[field]))).length,
    fieldCounts
  };
  let productionValidationPassed = false;
  let validationError = null;
  try {
    validateFigurePanelBatch(parsed, {
      figureId: String(fixture.input.figure_id || ''),
      panelHints: fixture.expectedPanels
    }, {
      visualInput: false,
      analysisDepth: fixture.input.analysis_depth
    });
    productionValidationPassed = true;
  } catch (error) {
    validationError = cleanError(error);
  }
  return {
    validJson: true,
    productionValidationPassed,
    validationError,
    receivedPanels,
    exactPanelCoverage: JSON.stringify(receivedPanels) ===
      JSON.stringify(fixture.expectedPanels),
    evidenceCompleteness,
    parsed
  };
}

mkdirSync(outputRoot, { recursive: true });
const fixtures = fixtureNames.map(readFixture);
const child = spawn(process.execPath, [hostPath, 'chrome-extension://test/'], {
  cwd: projectRoot,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true
});
let inputBuffer = Buffer.alloc(0);
let stderr = '';
const messages = [];
const waiters = [];

function encode(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function pushMessage(message) {
  const entry = { message, at: Date.now() };
  messages.push(entry);
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    const waiter = waiters[index];
    if (!waiter.predicate(message)) continue;
    waiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(entry);
  }
}

child.stdout.on('data', chunk => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  while (inputBuffer.length >= 4) {
    const length = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < length + 4) break;
    const body = inputBuffer.subarray(4, 4 + length);
    inputBuffer = inputBuffer.subarray(4 + length);
    pushMessage(JSON.parse(body.toString('utf8')));
  }
});
child.stderr.on('data', chunk => {
  stderr = (stderr + String(chunk || '')).slice(-8000);
});

function waitFor(predicate, timeoutMs) {
  const existing = messages.find(entry => predicate(entry.message));
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = waiters.findIndex(item => item.resolve === resolve);
      if (index >= 0) waiters.splice(index, 1);
      const error = new Error('Timed out waiting for Native Host response');
      error.code = 'REQUEST_TIMEOUT';
      reject(error);
    }, timeoutMs);
    waiters.push({ predicate, resolve, reject, timer });
  });
}

function send(message) {
  child.stdin.write(encode(message));
}

async function runTurn(mode, fixture, sequence) {
  const requestId = `native-figure-speed-${mode}-${fixture.id.toLowerCase()}-${sequence}`;
  const dispatchedAt = Date.now();
  send({ type: 'turn.start', requestId, ...fixture.request });
  let timeoutTriggered = false;
  let terminalEntry;
  try {
    terminalEntry = await waitFor(message =>
      message.requestId === requestId &&
      ['turn.completed', 'turn.error', 'turn.cancelled'].includes(message.type),
    TURN_TIMEOUT_MS);
  } catch (error) {
    timeoutTriggered = true;
    send({ type: 'turn.cancel', requestId, reason: 'benchmark-timeout' });
    terminalEntry = { message: { type: 'benchmark.timeout', error: cleanError(error) }, at: Date.now() };
  }
  const ownMessages = messages.filter(entry => entry.message.requestId === requestId);
  const startedEntry = ownMessages.find(entry => entry.message.type === 'turn.started');
  const firstDeltaEntry = ownMessages.find(entry => entry.message.type === 'turn.delta');
  const usageEntries = ownMessages.filter(entry => entry.message.type === 'turn.usage');
  const outputText = ownMessages.filter(entry => entry.message.type === 'turn.delta')
    .map(entry => String(entry.message.text || '')).join('');
  const validation = validateOutput(outputText, fixture);
  const completedAt = terminalEntry.at;
  const outputArtifact = `${mode}-batch-${fixture.id.toLowerCase()}-output.json`;
  writeFileSync(join(outputRoot, outputArtifact), JSON.stringify({
    fixture: fixture.name,
    requestHash: fixture.requestHash,
    outputSha256: sha256(outputText),
    outputText,
    parsed: validation.parsed
  }, null, 2));
  return {
    fixture: fixture.name,
    fixtureSha256: fixture.fixtureSha256,
    requestId,
    requestHash: fixture.requestHash,
    promptSha256: fixture.promptSha256,
    schemaSha256: fixture.schemaSha256,
    expectedPanels: fixture.expectedPanels,
    dispatchedAt: timestamp(dispatchedAt),
    startedAt: timestamp(startedEntry?.at),
    firstDeltaAt: timestamp(firstDeltaEntry?.at),
    completedAt: timestamp(completedAt),
    startDelayMs: startedEntry ? startedEntry.at - dispatchedAt : null,
    firstDeltaMs: firstDeltaEntry ? firstDeltaEntry.at - dispatchedAt : null,
    elapsedMs: completedAt - dispatchedAt,
    activeTurnMs: startedEntry ? completedAt - startedEntry.at : null,
    terminalType: String(terminalEntry.message.type || ''),
    terminalError: terminalEntry.message.error || null,
    timeoutTriggered,
    threadId: String(startedEntry?.message.threadId || ''),
    turnId: String(startedEntry?.message.turnId || ''),
    usage: usageEntries.at(-1)?.message.usage || null,
    outputCharacters: outputText.length,
    outputSha256: sha256(outputText),
    outputArtifact,
    validJson: validation.validJson,
    productionValidationPassed: validation.productionValidationPassed,
    validationError: validation.validationError,
    receivedPanels: validation.receivedPanels,
    exactPanelCoverage: validation.exactPanelCoverage,
    evidenceCompleteness: validation.evidenceCompleteness
  };
}

async function runMode(mode, concurrent, sequenceOffset) {
  const startedAt = Date.now();
  const turns = concurrent
    ? await Promise.all(fixtures.map((fixture, index) =>
      runTurn(mode, fixture, sequenceOffset + index)))
    : [];
  if (!concurrent) {
    for (let index = 0; index < fixtures.length; index += 1) {
      turns.push(await runTurn(mode, fixtures[index], sequenceOffset + index));
    }
  }
  const completedAt = Date.now();
  const startTimes = turns.map(turn => Date.parse(turn.startedAt)).filter(Number.isFinite);
  const completionTimes = turns.map(turn => Date.parse(turn.completedAt)).filter(Number.isFinite);
  const overlapMs = startTimes.length === 2 && completionTimes.length === 2
    ? Math.max(0, Math.min(...completionTimes) - Math.max(...startTimes)) : 0;
  return {
    mode,
    concurrent,
    startedAt: timestamp(startedAt),
    completedAt: timestamp(completedAt),
    elapsedMs: completedAt - startedAt,
    activeOverlapMs: overlapMs,
    allCompleted: turns.every(turn => turn.terminalType === 'turn.completed'),
    allValidJson: turns.every(turn => turn.validJson),
    allProductionValidated: turns.every(turn => turn.productionValidationPassed),
    allExactPanelCoverage: turns.every(turn => turn.exactPanelCoverage),
    turns
  };
}

const report = {
  schemaVersion: 1,
  status: 'RUNNING',
  scope: 'Actual Codex Native Host: two public Cell Figure Panel extraction requests, serial versus concurrent',
  publicSource: { doi: '10.1016/j.cell.2026.01.016' },
  configuration: {
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    ephemeral: true,
    visualInput: false,
    imageCount: 0,
    retries: 0,
    maximumModelTurns: 4,
    turnTimeoutMs: TURN_TIMEOUT_MS,
    disclaimer: 'This auto/low benchmark is not the user current model/reasoning configuration.'
  },
  fixtures: fixtures.map(fixture => ({
    name: fixture.name,
    fixtureSha256: fixture.fixtureSha256,
    requestHash: fixture.requestHash,
    promptSha256: fixture.promptSha256,
    schemaSha256: fixture.schemaSha256,
    expectedPanels: fixture.expectedPanels
  })),
  health: null,
  modes: [],
  comparison: null,
  error: null
};

try {
  const healthStartedAt = Date.now();
  send({ type: 'health.check', requestId: 'native-figure-speed-health' });
  const healthEntry = await waitFor(message =>
    message.requestId === 'native-figure-speed-health' &&
    ['health.result', 'host.error'].includes(message.type), 120000);
  if (healthEntry.message.type !== 'health.result') {
    const error = new Error(healthEntry.message.error?.message || 'Native Codex health check failed');
    error.code = healthEntry.message.error?.code || 'CODEX_BRIDGE_UNAVAILABLE';
    throw error;
  }
  report.health = {
    connected: true,
    hostVersion: String(healthEntry.message.hostVersion || ''),
    elapsedMs: healthEntry.at - healthStartedAt
  };
  const serial = await runMode('serial', false, 1);
  report.modes.push(serial);
  const concurrent = await runMode('concurrent', true, 3);
  report.modes.push(concurrent);
  const sameRequestHashes = fixtures.every(fixture => {
    const serialTurn = serial.turns.find(turn => turn.fixture === fixture.name);
    const concurrentTurn = concurrent.turns.find(turn => turn.fixture === fixture.name);
    return serialTurn?.requestHash === concurrentTurn?.requestHash &&
      serialTurn?.requestHash === fixture.requestHash;
  });
  const speedup = concurrent.elapsedMs > 0 ? serial.elapsedMs / concurrent.elapsedMs : null;
  const effectiveBackendParallelism = concurrent.activeOverlapMs > 0 &&
    Number.isFinite(speedup) && speedup > 1.15;
  report.comparison = {
    sameRequestHashes,
    serialElapsedMs: serial.elapsedMs,
    concurrentElapsedMs: concurrent.elapsedMs,
    elapsedSavedMs: serial.elapsedMs - concurrent.elapsedMs,
    speedupRatio: Number.isFinite(speedup) ? Number(speedup.toFixed(3)) : null,
    concurrentActiveOverlapMs: concurrent.activeOverlapMs,
    bridgeAcceptedConcurrentTurns: concurrent.activeOverlapMs > 0,
    effectiveBackendParallelismObserved: effectiveBackendParallelism,
    qualityGateParity: serial.allValidJson && concurrent.allValidJson &&
      serial.allProductionValidated && concurrent.allProductionValidated &&
      serial.allExactPanelCoverage && concurrent.allExactPanelCoverage,
    caveat: 'One ordered run cannot separate provider variance or cache/order effects; the result proves only this observed run.'
  };
  report.status = report.modes.every(mode =>
    mode.allCompleted && mode.allValidJson && mode.allProductionValidated &&
    mode.allExactPanelCoverage
  ) && sameRequestHashes ? 'PASS' : 'FAIL';
} catch (error) {
  report.status = 'BLOCKED';
  report.error = cleanError(error);
  if (stderr.trim()) report.nativeHostStderrTail = stderr.trim().slice(-2000);
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  writeFileSync(join(outputRoot, 'report.json'), JSON.stringify(report, null, 2));
  try { child.stdin.end(); } catch {}
  setTimeout(() => {
    try { child.kill(); } catch {}
  }, 1000).unref();
}

console.log(JSON.stringify({
  status: report.status,
  output: join(outputRoot, 'report.json'),
  health: report.health,
  modes: report.modes.map(mode => ({
    mode: mode.mode,
    elapsedMs: mode.elapsedMs,
    activeOverlapMs: mode.activeOverlapMs,
    turns: mode.turns.map(turn => ({
      fixture: turn.fixture,
      elapsedMs: turn.elapsedMs,
      terminalType: turn.terminalType,
      validJson: turn.validJson,
      productionValidationPassed: turn.productionValidationPassed,
      exactPanelCoverage: turn.exactPanelCoverage
    }))
  })),
  comparison: report.comparison,
  error: report.error
}, null, 2));
