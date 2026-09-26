// Bounded live acceptance for Figure-level evidence grouping.
//
// This harness performs fresh DeepSeek synthesis over previously captured,
// public-article Panel evidence. It deliberately never reads or replays any
// earlier provider response or completed Figure result.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';

const require = createRequire(import.meta.url);
require('../providers/provider-utils.js');
require('../core/figure-panel-planner.js');
const figureAnalysis = require('../core/figure-analysis.js');
require('../core/evidence-first-mechanism.js');
const figureWorkspace = require('../core/figure-workspace.js');
require('../providers/deepseek.js');
const { createProviderAdapter } = require('../providers/provider-registry.js');

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const defaultFixtureDirectory = path.join(projectRoot, 'tmp', 'figure-speed-r5-live-vision');
const defaultOutputDirectory = path.join(
  projectRoot, 'output', 'playwright', 'figure-group-synthesis-live'
);
const defaultModel = 'deepseek-v4-flash';
const providerEndpoint = 'https://api.deepseek.com/chat/completions';
const timeoutMs = 180_000;
const maxOutputTokens = 16_000;
const maxArtifactBytes = 12 * 1024 * 1024;
const fixtures = Object.freeze([
  {
    id: 'figure-1', requestFile: 'provider-request-006-redacted.json',
    expectedPanels: labels('A', 'Z')
  },
  {
    id: 'figure-2', requestFile: 'provider-request-009-redacted.json',
    expectedPanels: labels('A', 'K')
  }
]);

function labels(first, last) {
  const output = [];
  for (let value = first.charCodeAt(0); value <= last.charCodeAt(0); value += 1) {
    output.push(String.fromCharCode(value));
  }
  return output;
}

function parseArguments(argv) {
  const result = { live: false };
  const valueFlags = new Set(['--fixture-dir', '--output-dir', '--model']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--live') {
      result.live = true;
      continue;
    }
    if (flag === '--single-attempt') {
      result.singleAttempt = true;
      continue;
    }
    if (!valueFlags.has(flag) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw codedError('FIGURE_GROUP_ARGUMENT_INVALID');
    }
    const key = flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    result[key] = argv[index + 1];
    index += 1;
  }
  return result;
}

function codedError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function safeErrorCode(error) {
  const value = String(error?.code || error?.message || 'FIGURE_GROUP_SYNTHESIS_FAILED');
  return /^[A-Z][A-Z0-9_]{2,100}$/u.test(value)
    ? value : 'FIGURE_GROUP_SYNTHESIS_FAILED';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function allStrings(value, output = [], depth = 0) {
  if (depth > 16 || output.length > 10_000) return output;
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach(item => allStrings(item, output, depth + 1));
  else if (isPlainObject(value)) Object.values(value)
    .forEach(item => allStrings(item, output, depth + 1));
  return output;
}

function loadCapturedSynthesisInput(directory, fixture) {
  const file = path.join(directory, fixture.requestFile);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < 100 || stat.size > maxArtifactBytes) {
    throw codedError('FIGURE_GROUP_INPUT_FIXTURE_INVALID');
  }
  const boundaryRequest = JSON.parse(fs.readFileSync(file, 'utf8'));
  let payload = null;
  for (const text of allStrings(boundaryRequest)) {
    if (!text.includes('"figure_id"') || !text.includes('"panel_evidence"')) continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.pass === 'figure_synthesis') payload = parsed;
    } catch (_) {}
  }
  if (!isPlainObject(payload) || payload.figure_id !== fixture.id ||
      !Array.isArray(payload.panel_evidence)) {
    throw codedError('FIGURE_GROUP_INPUT_FIXTURE_INVALID');
  }
  const panelIds = payload.panel_evidence.map(panel => String(panel?.panel || '').trim());
  assert.deepEqual(panelIds, fixture.expectedPanels,
    `${fixture.id}: captured Panel evidence must be complete and ordered`);
  return {
    input: {
      figureId: String(payload.figure_id),
      figureLabel: String(payload.figure_label || ''),
      articleTitle: String(payload.article_title || ''),
      caption: String(payload.caption || ''),
      contextParagraphs: (Array.isArray(payload.related_body_context)
        ? payload.related_body_context : []).map(item => ({
        paragraphId: String(item?.paragraph_id || ''),
        sectionTitle: String(item?.section_title || ''),
        text: String(item?.text || '')
      }))
    },
    panelEvidence: payload.panel_evidence,
    sourceReceipt: {
      file: path.relative(projectRoot, file).replace(/\\/gu, '/'),
      sha256: sha256(fs.readFileSync(file)),
      boundary: 'previously captured public Panel evidence only; no earlier output loaded',
      panelCount: panelIds.length,
      panelIds
    }
  };
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
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(?:authorization|api.?key|secret|credential|access.?token|refresh.?token|^token$)/iu
      .test(key)) continue;
    output[key] = sanitize(child, secret, depth + 1);
  }
  return output;
}

function writeJson(file, value, secret = '') {
  const serialized = `${JSON.stringify(sanitize(value, secret), null, 2)}\n`;
  if ((secret && serialized.includes(secret)) ||
      /\bsk-[A-Za-z0-9_-]{3,}\b|Bearer\s+(?!\[REDACTED_SECRET\])/iu.test(serialized)) {
    throw codedError('FIGURE_GROUP_REDACTION_FAILED');
  }
  fs.writeFileSync(file, serialized, { encoding: 'utf8', mode: 0o600 });
}

function oneConciseSentence(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 160 || /[\r\n]|(?:^|\s)[-•]\s|[①②③④⑤⑥⑦⑧⑨]/u.test(text)) return false;
  const terminalMarks = [...text.matchAll(/[。！？!?]/gu)].map(match => match.index);
  return terminalMarks.length <= 1 &&
    (terminalMarks.length === 0 || terminalMarks[0] === text.length - 1);
}

function normalizedText(value) {
  return String(value || '').normalize('NFKC').trim();
}

function assertExactPartition(raw, fixture) {
  const groups = raw?.panel_groups;
  assert.ok(Array.isArray(groups), `${fixture.id}: panel_groups must be an array`);
  assert.ok(groups.length > 0 && groups.length <= 30,
    `${fixture.id}: panel_groups count must be 1..30`);
  const expected = new Set(fixture.expectedPanels);
  const seen = new Set();
  const memberships = [];
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    assert.ok(Array.isArray(group?.panels) && group.panels.length > 0,
      `${fixture.id}: group ${index + 1} is empty`);
    const ids = group.panels.map(value => String(value || '').trim().toUpperCase());
    assert.equal(new Set(ids).size, ids.length,
      `${fixture.id}: group ${index + 1} repeats a Panel`);
    for (const panelId of ids) {
      assert.ok(expected.has(panelId), `${fixture.id}: nonexistent Panel ${panelId}`);
      assert.ok(!seen.has(panelId), `${fixture.id}: duplicate ownership for Panel ${panelId}`);
      seen.add(panelId);
    }
    assert.ok(oneConciseSentence(group.upstream_context_zh),
      `${fixture.id}: group ${index + 1} upstream must be one concise sentence`);
    memberships.push({
      group: index + 1,
      panels: ids,
      rawUpstreamContextZh: String(group.upstream_context_zh).trim(),
      normalizedUpstreamContextZh: normalizedText(group.upstream_context_zh)
    });
  }
  assert.deepEqual([...seen].sort(), [...expected].sort(),
    `${fixture.id}: every expected Panel must be owned exactly once`);
  if (groups.length > 1) {
    assert.equal(groups.some(group => group.panels.length === expected.size), false,
      `${fixture.id}: an additional whole-Figure umbrella group is forbidden`);
  }
  assert.equal(raw.argument_chain?.length, groups.length,
    `${fixture.id}: argument_chain must align one-to-one with panel_groups`);
  raw.argument_chain.forEach((step, index) => {
    assert.deepEqual(step.panels, groups[index].panels,
      `${fixture.id}: argument step ${index + 1} membership diverges from its group`);
  });
  return memberships;
}

function assertWorkspaceProjection(fixture, input, validated, memberships) {
  const figure = {
    figureId: fixture.id,
    figureLabel: input.figureLabel,
    isSupplemental: false,
    panels: validated.panels
  };
  const seeded = figureWorkspace.createFigureWorkspaceDraft([figure]);
  const merged = figureWorkspace.mergeModelIntoFigureWorkspaceDraft(
    seeded, figure, validated
  );
  const saved = figureWorkspace.publicFigureWorkspaceDraft(merged);
  const serialized = JSON.stringify(saved);
  const reloaded = figureWorkspace.normalizeFigureWorkspaceDraft(JSON.parse(serialized));
  const reloadedPublic = figureWorkspace.publicFigureWorkspaceDraft(reloaded);
  const view = figureWorkspace.createFigureWorkspaceView({
    figure, modelResult: validated, draft: reloadedPublic
  });
  const layout = figureWorkspace.buildFigureEvidenceDisplayLayout(
    view.evidenceBlocks, view.panels
  );
  const visibleGroups = layout.filter(block =>
    block.kind === 'evidence' && block.sourceType === 'group'
  );
  const visibleEvidenceCards = layout.filter(block => block.kind === 'evidence');
  assert.equal(visibleEvidenceCards.some(block => block.sourceType === 'bridge'), false,
    `${fixture.id}: display must not expose standalone bridge evidence cards`);
  assert.equal(visibleEvidenceCards.length, visibleGroups.length,
    `${fixture.id}: display must expose only the exact experiment-group evidence cards`);
  assert.equal(visibleGroups.length, memberships.length,
    `${fixture.id}: display group count changed`);
  const displayed = visibleGroups.flatMap(block => block.panelIds);
  assert.equal(new Set(displayed).size, displayed.length,
    `${fixture.id}: display must assign each Panel to only one group`);
  assert.deepEqual([...displayed].sort(), [...fixture.expectedPanels].sort(),
    `${fixture.id}: display ownership must preserve every Panel exactly once`);
  for (const block of visibleGroups) {
    assert.deepEqual(block.panelIds, fixture.expectedPanels.filter(id => block.panelIds.includes(id)),
      `${fixture.id}: each experiment group must preserve canonical internal Panel order`);
  }
  assert.deepEqual(
    visibleGroups.map(block => block.panelIds.join('\u0000')).sort(),
    memberships.map(item => item.panels.join('\u0000')).sort(),
    `${fixture.id}: display must preserve each experiment group's exact membership`
  );
  const savedGroups = reloadedPublic.figures[fixture.id].evidenceBlocks
    .filter(block => block.kind === 'evidence' && block.sourceType === 'group');
  assert.deepEqual(savedGroups.map(block => block.upstreamContext.value),
    memberships.map(item => item.normalizedUpstreamContextZh),
    `${fixture.id}: normalized upstream context did not survive reload`);
  assert.deepEqual(visibleGroups.map(block => block.upstreamContext),
    memberships.map(item => item.normalizedUpstreamContextZh),
    `${fixture.id}: display upstream context did not survive reload`);
  return {
    serializedChars: serialized.length,
    savedGroupCount: savedGroups.length,
    displayGroupCount: visibleGroups.length,
    displayPanelIds: displayed,
    transitionCount: layout.filter(block => block.kind === 'transition').length,
    standaloneBridgeEvidenceCardCount: 0,
    upstreamSurvivedReload: true
  };
}

function repairRequest(compiled, invalidValue, error) {
  return {
    ...compiled,
    systemPrompt: `${compiled.systemPrompt}\nREPAIR_PASS: Correct the invalid response once. ` +
      'Return the complete synthesis JSON only, obeying the same schema and all grouping rules.',
    userPrompt: JSON.stringify({
      original_request: JSON.parse(compiled.userPrompt),
      invalid_response: invalidValue,
      validation_error_code: safeErrorCode(error),
      validation_error_message: redactText(error?.message || '').slice(0, 1000)
    })
  };
}

function extractAssistantContent(responseText) {
  try {
    const parsed = JSON.parse(responseText);
    return typeof parsed?.choices?.[0]?.message?.content === 'string'
      ? parsed.choices[0].message.content : '';
  } catch (_) { return ''; }
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const maxRequestsPerFigure = options.singleAttempt ? 1 : 2;
  const maxFreshRequests = maxRequestsPerFigure * fixtures.length;
  const fixtureDirectory = path.resolve(options.fixtureDir || defaultFixtureDirectory);
  const outputDirectory = path.resolve(options.outputDir || defaultOutputDirectory);
  if (fs.existsSync(outputDirectory) && fs.readdirSync(outputDirectory).length > 0) {
    throw codedError('FIGURE_GROUP_OUTPUT_ALREADY_EXISTS');
  }
  const model = String(options.model || defaultModel).trim();
  if (!/^deepseek-v4-flash(?:[-_.A-Za-z0-9]*)$/u.test(model) || /vision/iu.test(model)) {
    throw codedError('FIGURE_GROUP_TEXT_FLASH_MODEL_REQUIRED');
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: options.live ? 'FAIL' : 'READY_BLOCKED_APPROVAL',
    classification: options.live
      ? 'LIVE_SCIENTIFIC_REVIEW_PENDING'
      : 'PREPARE_ONLY_AUTO_REVIEW_BLOCKED_LIVE_EXECUTION',
    scope: 'fresh Figure-level synthesis over previously captured public Panel evidence',
    explicitExclusions: [
      'no earlier provider response loaded or replayed',
      'no new Panel extraction',
      'no whole-extension or broad scientific-correctness PASS claim'
    ],
    model,
    providerEndpoint,
    providerCallCap: maxFreshRequests,
    perFigureCallCap: maxRequestsPerFigure,
    realApiCalls: 0,
    liveExecutionStatus: options.live ? 'STARTED' : 'BLOCKED_APPROVAL_AUTO_REVIEW',
    sourceHashes: Object.fromEntries([
      'core/figure-analysis.js', 'core/figure-workspace.js', 'providers/deepseek.js',
      'providers/provider-utils.js'
    ].map(file => [file, sha256(fs.readFileSync(path.join(projectRoot, file)))])),
    startedAt: new Date().toISOString(),
    figures: [],
    humanScientificReview: {
      required: true,
      scope: 'group boundaries, experiment-question coherence, and wording of each upstream sentence',
      items: [
        'Confirm the first group genuinely connects to the article-level scientific question.',
        'Confirm later upstream sentences identify the prior evidence gap and the experiment that tests it.',
        'Confirm group boundaries follow independent experimental questions rather than cosmetic or equal-sized grouping.'
      ]
    }
  };
  const persist = secret => writeJson(path.join(outputDirectory, 'report.json'), report, secret);
  const materials = fixtures.map(fixture => ({
    fixture,
    ...loadCapturedSynthesisInput(fixtureDirectory, fixture)
  }));
  for (const material of materials) {
    const compiled = figureAnalysis.compileFigureSynthesisPrompt(
      material.input, material.panelEvidence,
      { analysisDepth: 'standard', visualInput: true }
    );
    assert.equal(compiled.schemaName, 'figure_synthesis_standard');
    assert.ok(compiled.responseSchema.required.includes('panel_groups'));
    assert.ok(compiled.responseSchema.properties.panel_groups.items.required
      .includes('upstream_context_zh'));
    report.figures.push({
      figureId: material.fixture.id,
      source: material.sourceReceipt,
      compiledPrompt: {
        schemaName: compiled.schemaName,
        systemPromptSha256: sha256(compiled.systemPrompt),
        userPromptSha256: sha256(compiled.userPrompt),
        responseSchemaSha256: sha256(JSON.stringify(compiled.responseSchema)),
        userPromptChars: compiled.userPrompt.length
      },
      expectedPanelCount: material.fixture.expectedPanels.length,
      expectedPanelIds: material.fixture.expectedPanels,
      requests: []
    });
    material.compiled = compiled;
  }
  persist('');
  if (!options.live) return report;

  let secret = '';
  const rawResponses = new Map();
  try {
    secret = await readSecretFromTty({
      prompt: 'Authorized DeepSeek key for 2 bounded fresh Figure syntheses (masked): '
    });
    const adapter = createProviderAdapter({
      providerId: 'deepseek',
      config: { model, apiKey: secret, reasoningEnabled: false, thinking: false },
      fetchImpl: async (url, requestOptions) => {
        assert.equal(String(url), providerEndpoint, 'unexpected provider endpoint');
        assert.equal(requestOptions.method, 'POST');
        if (report.realApiCalls >= maxFreshRequests) {
          throw codedError('FIGURE_GROUP_GLOBAL_CALL_CAP');
        }
        const requestBody = JSON.parse(String(requestOptions.body || '{}'));
        const figureId = String(requestBody.messages?.[1]?.content || '').match(
          /"figure_id"\s*:\s*"([^"]+)"/u
        )?.[1] || 'unknown';
        const figureReport = report.figures.find(item => item.figureId === figureId);
        if (!figureReport || figureReport.requests.length >= maxRequestsPerFigure) {
          throw codedError('FIGURE_GROUP_PER_FIGURE_CALL_CAP');
        }
        report.realApiCalls += 1;
        const sequence = report.realApiCalls;
        const requestReceipt = {
          sequence,
          attempt: figureReport.requests.length + 1,
          requestKind: figureReport.requests.length ? 'bounded_repair' : 'fresh_synthesis',
          model: requestBody.model,
          stream: requestBody.stream,
          responseFormat: requestBody.response_format?.type || '',
          messageCount: requestBody.messages?.length || 0,
          requestBodySha256: sha256(String(requestOptions.body || '')),
          requestChars: String(requestOptions.body || '').length,
          startedAt: new Date().toISOString()
        };
        figureReport.requests.push(requestReceipt);
        persist(secret);
        const startedAt = Date.now();
        const response = await fetch(url, {
          ...requestOptions,
          signal: AbortSignal.timeout(timeoutMs)
        });
        const responseText = await response.text();
        if (Buffer.byteLength(responseText, 'utf8') > maxArtifactBytes) {
          throw codedError('FIGURE_GROUP_RESPONSE_TOO_LARGE');
        }
        rawResponses.set(figureId, responseText);
        let envelope = null;
        try { envelope = JSON.parse(responseText); } catch (_) {}
        Object.assign(requestReceipt, {
          status: response.status,
          elapsedMs: Date.now() - startedAt,
          finishReason: envelope?.choices?.[0]?.finish_reason || '',
          usage: envelope?.usage || null,
          responseSha256: sha256(responseText),
          responseArtifact: `provider-response-${String(sequence).padStart(3, '0')}-redacted.json`
        });
        writeJson(path.join(outputDirectory, requestReceipt.responseArtifact),
          envelope || { redacted_non_json_body: responseText }, secret);
        persist(secret);
        return new Response(responseText, {
          status: response.status,
          headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' }
        });
      }
    });

    for (let index = 0; index < materials.length; index += 1) {
      const material = materials[index];
      const figureReport = report.figures[index];
      let currentRequest = material.compiled;
      let validated = null;
      let rawValue = null;
      let lastError = null;
      for (let attempt = 1; attempt <= maxRequestsPerFigure; attempt += 1) {
        try {
          rawValue = await adapter.generateJson({
            systemPrompt: currentRequest.systemPrompt,
            userPrompt: currentRequest.userPrompt,
            responseSchema: currentRequest.responseSchema,
            schemaName: currentRequest.schemaName,
            maxOutputTokens,
            timeoutMs,
            reasoningEnabled: false
          });
          const memberships = assertExactPartition(rawValue, material.fixture);
          validated = figureAnalysis.validateFigureSynthesis(
            rawValue, material.input, material.panelEvidence,
            {
              analysisDepth: 'standard', visualInput: true,
              repairResponse: false, requireCompletePanels: true
            }
          );
          assert.deepEqual(validated.panelGroups.map(group => group.panels),
            memberships.map(item => item.panels));
          assert.deepEqual(validated.panelGroups.map(group => group.upstreamContext),
            memberships.map(item => item.normalizedUpstreamContextZh));
          const workspace = assertWorkspaceProjection(
            material.fixture, material.input, validated, memberships
          );
          figureReport.status = 'STRUCTURAL_PASS_SCIENTIFIC_REVIEW_REQUIRED';
          figureReport.distinctGroupCount = memberships.length;
          figureReport.panelGroups = memberships;
          figureReport.workspace = workspace;
          figureReport.validation = {
            productionValidator: 'PASS',
            exactPanelPartition: 'PASS',
            upstreamSentenceShape: 'PASS',
            firstGroupArticleQuestionLinkage: 'HUMAN_REVIEW_REQUIRED',
            noUmbrellaOverlap: 'PASS',
            argumentGroupAlignment: 'PASS',
            noStandaloneBridgeEvidenceCards: 'PASS',
            internalHandoffAndBridgeMetadata: 'ALLOWED_IF_GROUNDED'
          };
          writeJson(path.join(outputDirectory,
            `${material.fixture.id}-synthesis-normalized-redacted.json`), validated, secret);
          break;
        } catch (error) {
          lastError = error;
          figureReport.requests.at(-1).validationErrorCode = safeErrorCode(error);
          figureReport.requests.at(-1).validationErrorMessage = redactText(
            error?.message || '', secret
          ).slice(0, 1000);
          persist(secret);
          if (attempt >= maxRequestsPerFigure) break;
          let invalid = rawValue;
          if (invalid === null) {
            const assistantContent = extractAssistantContent(
              rawResponses.get(material.fixture.id) || ''
            );
            try { invalid = JSON.parse(assistantContent); }
            catch (_) { invalid = assistantContent.slice(0, 200_000); }
          }
          currentRequest = repairRequest(material.compiled, invalid, error);
        }
      }
      if (!validated) {
        figureReport.status = 'STRUCTURAL_FAIL';
        figureReport.errorCode = safeErrorCode(
          lastError || codedError('FIGURE_GROUP_VALIDATION_FAILED')
        );
        figureReport.errorMessage = redactText(lastError?.message || '', secret).slice(0, 1000);
        persist(secret);
      }
    }
    assert.ok(report.realApiCalls >= 2 && report.realApiCalls <= maxFreshRequests);
    assert.ok(report.figures.every(item => item.requests.length >= 1 &&
      item.requests.length <= maxRequestsPerFigure));
    if (report.figures.some(item => item.status !==
      'STRUCTURAL_PASS_SCIENTIFIC_REVIEW_REQUIRED')) {
      throw codedError('FIGURE_GROUP_VALIDATION_FAILED');
    }
    report.status = 'STRUCTURAL_PASS';
    report.liveExecutionStatus = 'COMPLETED';
    report.classification = 'STRUCTURAL_ACCEPTANCE_SCIENTIFIC_REVIEW_REQUIRED';
    report.completedAt = new Date().toISOString();
    persist(secret);
    return report;
  } catch (error) {
    report.errorCode = safeErrorCode(error);
    report.errorMessage = redactText(error?.message || '', secret).slice(0, 1000);
    report.completedAt = new Date().toISOString();
    persist(secret);
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
      classification: report.classification,
      realApiCalls: report.realApiCalls,
      figures: report.figures.map(item => ({
        figureId: item.figureId,
        distinctGroupCount: item.distinctGroupCount || 0,
        panelIds: item.panelGroups?.map(group => group.panels) || []
      }))
    })}\n`);
  }).catch(error => {
    process.stderr.write(`FAIL ${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  run,
  parseArguments,
  loadCapturedSynthesisInput,
  oneConciseSentence,
  assertExactPartition,
  assertWorkspaceProjection
};
