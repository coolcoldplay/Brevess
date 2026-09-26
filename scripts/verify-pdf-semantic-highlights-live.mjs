import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';

export const EXPECTED_ELIFE_SHA256 =
  '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1';
export const EXPECTED_ELIFE_PAGES = 23;
export const API_MODES = Object.freeze(['fixture', 'real-api']);

export function assertMultiPageOverlayCoverage(requested = [], observed = [],
  code = 'B4_MULTI_PAGE_OVERLAY_INCOMPLETE') {
  const normalize = values => [...new Set((Array.isArray(values) ? values : [])
    .map(Number).filter(value => Number.isSafeInteger(value) && value > 0))]
    .sort((left, right) => left - right);
  const requestPages = normalize(requested);
  const overlayPages = normalize(observed);
  assert.ok(requestPages.length >= 2, 'B4_MULTI_PAGE_TARGET_UNAVAILABLE');
  assert.deepEqual(overlayPages, requestPages, code);
  return true;
}

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const providerOrigin = 'https://api.deepseek.com';
const allowedProviderPaths = new Set(['/chat/completions', '/responses']);
const dummySecret = 'pdf-semantic-b4-loopback-dummy';

export function parseArguments(argv = []) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = String(argv[index] || '');
    if (!item.startsWith('--')) continue;
    const key = item.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next !== undefined && !String(next).startsWith('--')) {
      parsed[key] = String(next);
      index += 1;
    } else parsed[key] = true;
  }
  return parsed;
}

export function normalizeOptions(argv = process.argv.slice(2), overrides = {}) {
  const args = { ...parseArguments(argv), ...overrides };
  const apiMode = String(args.apiMode || 'fixture').toLowerCase();
  if (!API_MODES.includes(apiMode)) throw codedError('B4_API_MODE_INVALID');
  const pdfPath = path.resolve(args.pdf || path.join(repositoryRoot, 'tmp',
    'public-pdf-acceptance', 'elife-83176-v2.pdf'));
  const defaultOutput = path.join(repositoryRoot, 'output', 'playwright',
    `pdf-semantic-highlights-b4-${apiMode}`);
  return Object.freeze({
    apiMode,
    pdfPath,
    extensionRoot: path.resolve(args.extension || repositoryRoot),
    outputDirectory: path.resolve(args.output || defaultOutput),
    headed: args.headed === true,
    model: String(args.model || 'deepseek-chat')
  });
}

export function helpText() {
  return [
    'Usage: node scripts/verify-pdf-semantic-highlights-live.mjs [options]',
    '  --api-mode fixture|real-api   Default: fixture (zero provider calls)',
    '  --pdf <file>                  Default: public elife-83176-v2.pdf',
    '  --extension <dir>             Unpacked extension source; default: repository root',
    '  --output <dir>                Redacted report directory',
    '  --headed                     Show the isolated Edge window',
    '  --model <id>                  DeepSeek model for explicit real-api smoke',
    '',
    'fixture runs the production browser runtime with HTTP blocked and no saved model answer.',
    'real-api prompts for a masked key, keeps it in the Node proxy only, and requires a fresh',
    'provider response. The key is never written to the extension profile or report.'
  ].join('\n');
}

function flattenWorkspaceNodes(nodes, output = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    output.push(node);
    flattenWorkspaceNodes(node?.children, output);
  }
  return output;
}

export function buildMethodsSelectionMessages(snapshot = {}) {
  const nodes = flattenWorkspaceNodes(snapshot?.nodes);
  const methods = nodes.find(node =>
    String(node?.sectionKind || '').toLowerCase() === 'methods' ||
    /(?:^|\b)(?:materials?\s*(?:&|and)\s*)?methods?(?:\b|$)|star methods/iu
      .test(String(node?.title || node?.displayTitle || '')));
  assert.ok(methods, 'B4_CANONICAL_METHODS_NODE_MISSING');
  const allSectionIds = [...new Set(nodes.flatMap(node =>
    Array.isArray(node?.analysisSectionIds) ? node.analysisSectionIds.map(String) : []
  ).filter(Boolean))];
  const methodSectionIds = [...new Set(
    (Array.isArray(methods.analysisSectionIds) ? methods.analysisSectionIds : [])
      .map(String).filter(Boolean)
  )];
  assert.ok(allSectionIds.length > 0, 'B4_CANONICAL_ANALYSIS_SECTIONS_EMPTY');
  assert.ok(methodSectionIds.length > 0, 'B4_CANONICAL_METHODS_SECTIONS_EMPTY');
  return Object.freeze({
    methodRootId: String(methods.sectionId || ''),
    methodSectionIds: Object.freeze(methodSectionIds),
    messages: Object.freeze([
      Object.freeze({ action: 'setArticleAnalysisSectionSelection',
        sectionIds: Object.freeze(allSectionIds), selected: false }),
      Object.freeze({ action: 'setArticleAnalysisSectionSelection',
        sectionIds: Object.freeze(methodSectionIds), selected: true })
    ])
  });
}

// Executed in the reader context. Return only gate decisions, never PDF text or identities.
export function readPendingRestorePrerequisites(pageNumber) {
  const native = globalThis.__brevessNativePdfDocument;
  const documentHash = String(native?.structure?.documentHash || '');
  const documentGeneration = Number(native?.documentGeneration) || 0;
  const semanticContext = readPdfSemanticNavigationContext();
  const workspaceReady = document.documentElement.dataset.pdfWorkspaceReady === 'true';
  const workspaceIndexed = document.documentElement.dataset.pdfWorkspaceIndexed === 'true';
  const targetSelector = `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`;
  const targetProjection = globalThis.__brevessPdfReaderBridge.command(
    'getPageProjection', pageNumber);
  const projection = currentNativePdfRegexProjection(native);
  const hashMatches = value => Boolean(documentHash && value?.documentHash === documentHash);
  const generationMatches = value => Boolean(documentGeneration &&
    Number(value?.documentGeneration) === documentGeneration);
  return {
    workspaceReady, workspaceIndexed,
    nativePhaseReady: ['text-ready', 'partial-index'].includes(String(native?.phase || '')),
    targetPagePresent: Boolean(document.querySelector(targetSelector)),
    targetRenderedPagePresent: Boolean(document.querySelector(`${targetSelector}.is-rendered`)),
    targetTextLayerConnected: targetProjection?.textLayer?.isConnected === true,
    targetProjectionHashMatches: hashMatches(targetProjection),
    targetProjectionGenerationMatches: generationMatches(targetProjection),
    renderedPagePresent: Boolean(document.querySelector(
      '.pdf-native-page.is-rendered[data-pdf-page-number]')),
    projectionPresent: Boolean(projection),
    projectionHashMatches: hashMatches(projection),
    projectionGenerationMatches: generationMatches(projection),
    semanticIdentityMatches: hashMatches(semanticContext) && generationMatches(semanticContext) &&
      Number.isSafeInteger(Number(semanticContext?.revision)) &&
      Number(semanticContext?.revision) > 0 && Boolean(semanticContext?.semanticCacheKey) &&
      Boolean(semanticContext?.semanticProvenanceKey),
    readiness: nativePdfRegexRestoreReadiness({
      request: { categories: {} }, expectedDocumentHash: documentHash,
      workspaceLifecycle: articleWorkspaceLifecycleGeneration
    }, native, { workspaceLifecycle: articleWorkspaceLifecycleGeneration,
      workspaceReady, workspaceIndexed, projection, semanticContext })
  };
}

export function assertPendingRestorePrerequisites(evidence = {}) {
  const fields = ['workspaceReady', 'workspaceIndexed', 'nativePhaseReady',
    'targetPagePresent', 'targetRenderedPagePresent', 'targetTextLayerConnected',
    'targetProjectionHashMatches', 'targetProjectionGenerationMatches',
    'renderedPagePresent', 'projectionPresent', 'projectionHashMatches',
    'projectionGenerationMatches', 'semanticIdentityMatches', 'readiness'];
  for (const field of fields) {
    if (evidence[field] === (field === 'readiness' ? 'ready' : true)) continue;
    const code = field.replace(/[A-Z]/gu, letter => `_${letter}`).toUpperCase();
    const error = codedError(`B4_PENDING_PREREQUISITE_${code}`);
    error.prerequisites = evidence;
    throw error;
  }
  return true;
}

export async function preparePendingRestorePrerequisites(reader, pageNumber,
  { timeoutMs = 10_000 } = {}) {
  await reader.evaluate(async targetPage => {
    await globalThis.__b4ShowProjectedPage(targetPage);
  }, pageNumber);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const evidence = await reader.evaluate(readPendingRestorePrerequisites, pageNumber);
    try {
      assertPendingRestorePrerequisites(evidence);
      return evidence;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

export function assertSemanticReadyLifecycleEvidence(evidence = {}) {
  assert.ok(Number(evidence.revisionAfter) > Number(evidence.revisionBefore),
    'B4_SEMANTIC_REVISION_DID_NOT_ADVANCE');
  assert.equal(evidence.methodsOnlyBefore, true, 'B4_METHODS_SCOPE_NOT_ACTIVE_BEFORE_REVISION');
  assert.equal(evidence.methodsOnlyAfter, true, 'B4_METHODS_SCOPE_LOST_AFTER_REVISION');
  assert.equal(evidence.legacyParagraphBefore, true, 'B4_PENDING_LLM_NOT_LEGACY');
  assert.equal(evidence.semanticParagraphAfter, true, 'B4_PENDING_LLM_NOT_REBOUND');
  assert.equal(Number(evidence.restoreAppliedCount), 1, 'B4_PENDING_RESTORE_COUNT_INVALID');
  assert.equal(evidence.pendingAfter, false, 'B4_PENDING_RESTORE_NOT_CLEARED');
  assert.equal(Number(evidence.scrollCallCount), 0, 'B4_PENDING_RESTORE_SCROLLED');
  assert.equal(Number(evidence.layerCountAfterSecondReady),
    Number(evidence.layerCountAfterFirstReady), 'B4_PENDING_LAYER_GROWTH');
  assert.equal(Number(evidence.markCountAfterSecondReady),
    Number(evidence.markCountAfterFirstReady), 'B4_PENDING_MARK_GROWTH');
  assert.ok(Number(evidence.markCountAfterFirstReady) > 0, 'B4_PENDING_RESTORE_MARKS_EMPTY');
  assert.equal(evidence.regexMapRetained, true, 'B4_PENDING_REGEX_MAP_LOST');
  assert.equal(evidence.llmMapRetained, true, 'B4_PENDING_LLM_MAP_LOST');
  assert.ok(Number(evidence.regexMarkCountAfterSecondReady) > 0,
    'B4_PENDING_REGEX_MARKS_LOST');
  assert.ok(Number(evidence.llmMarkCountAfterSecondReady) > 0,
    'B4_PENDING_LLM_MARKS_LOST');
  return true;
}

export function redactDiagnosticText(value, maximumLength = 320) {
  return String(value || '')
    .replace(/(?:https?|file):\/\/\S+/giu, '[redacted-location]')
    .replace(/\bBearer\s+\S+/giu, '[redacted-secret]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, '[redacted-secret]')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, Math.max(0, Number(maximumLength) || 0));
}

export function redactRealApiTurnDiagnostic(turn = {}) {
  const route = turn?.route && typeof turn.route === 'object' ? turn.route : {};
  return {
    turnId: String(turn?.turnId || '').slice(0, 160),
    status: String(turn?.status || '').slice(0, 40),
    intent: String(turn?.intent || '').slice(0, 40),
    errorCode: String(turn?.errorCode || '').slice(0, 100),
    error: redactDiagnosticText(turn?.error),
    selectedProfileId: String(turn?.selectedProfileId || turn?.profileId || '').slice(0, 100),
    profileName: String(turn?.profileName || '').slice(0, 160),
    model: String(turn?.model || '').slice(0, 160),
    route: {
      taskType: String(route?.taskType || '').slice(0, 80),
      effectiveProfileId: String(route?.effectiveProfileId || '').slice(0, 100),
      providerId: String(route?.providerId || '').slice(0, 80),
      model: String(route?.model || '').slice(0, 160),
      capabilityMode: String(route?.capabilityMode || '').slice(0, 80),
      fallbackReason: String(route?.fallbackReason || '').slice(0, 100)
    },
    matchCount: Number(turn?.matchCount) || 0,
    degradedCount: Number(turn?.degradedCount) || 0,
    unresolvedCount: Number(turn?.unresolvedCount) || 0,
    highlightError: redactDiagnosticText(turn?.highlightError),
    highlightReasonCodes: [...new Set(Array.isArray(turn?.highlightReasonCodes)
      ? turn.highlightReasonCodes.map(value => String(value || '').slice(0, 100)).filter(Boolean)
      : [])].slice(0, 20)
  };
}

export function assertRealApiSmokeEvidence(evidence = {}) {
  assert.equal(evidence.profile?.stored, true, 'B4_REAL_API_PROFILE_NOT_STORED');
  assert.equal(evidence.profile?.credentialPresent, true,
    'B4_REAL_API_PROFILE_CREDENTIAL_MISSING');
  assert.equal(evidence.profile?.llmReady, true, 'B4_REAL_API_PROFILE_NOT_READY');
  assert.equal(evidence.profile?.effectiveMode, 'llm', 'B4_REAL_API_MODE_NOT_ACTIVE');
  assert.equal(evidence.profile?.providerId, 'deepseek', 'B4_REAL_API_PROVIDER_MISMATCH');
  assert.equal(evidence.profile?.routes?.documentHighlight?.effectiveProfileMatches, true,
    'B4_REAL_API_AUTO_ROUTE_MISMATCH');
  assert.equal(evidence.profile?.routes?.articleChat?.effectiveProfileMatches, true,
    'B4_REAL_API_CHAT_ROUTE_MISMATCH');
  assert.ok(Number(evidence.autoHighlight?.providerRequestDelta) > 0,
    'B4_REAL_API_AUTO_NO_FRESH_REQUEST');
  assert.equal(evidence.autoHighlight?.responseSuccess, true,
    'B4_REAL_API_AUTO_RESPONSE_FAILED');
  assert.ok(Number(evidence.autoHighlight?.mapItemCount) > 0 &&
    Number(evidence.autoHighlight?.markCount) > 0 &&
    Number(evidence.autoHighlight?.nonzeroRectCount) > 0,
  'B4_REAL_API_AUTO_SEMANTIC_HIGHLIGHT_EMPTY');
  assert.ok(Number(evidence.qaHighlight?.providerRequestDelta) > 0,
    'B4_REAL_API_QA_NO_FRESH_REQUEST');
  assert.equal(evidence.qaHighlight?.responseSuccess, true,
    'B4_REAL_API_QA_SUBMISSION_FAILED');
  assert.equal(evidence.qaHighlight?.turn?.intent, 'highlight',
    'B4_REAL_API_QA_INTENT_MISMATCH');
  assert.ok(['completed', 'truncated', 'incomplete']
    .includes(String(evidence.qaHighlight?.turn?.status || '')),
  'B4_REAL_API_QA_TURN_FAILED');
  assert.ok(Number(evidence.qaHighlight?.turn?.matchCount) > 0 &&
    Number(evidence.qaHighlight?.mapItemCount) > 0 &&
    Number(evidence.qaHighlight?.markCount) > 0 &&
    Number(evidence.qaHighlight?.nonzeroRectCount) > 0,
  'B4_REAL_API_QA_SEMANTIC_HIGHLIGHT_EMPTY');
  assert.ok(Number(evidence.totalProviderRequestDelta) >= 2,
    'B4_REAL_API_TWO_REQUEST_CLOSURES_MISSING');
  return true;
}

function codedError(code, cause = null) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filename) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    while ((read = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally { fs.closeSync(handle); }
  return hash.digest('hex');
}

function safeCode(error) {
  const explicit = String(error?.code || error?.message || '').toUpperCase()
    .match(/\bB4_[A-Z0-9_]+\b/u)?.[0];
  return explicit || 'B4_LIVE_ACCEPTANCE_FAILED';
}

export function assertRedactedReport(report) {
  const forbiddenKeys = new Set([
    'apiKey', 'authorization', 'rawText', 'providerBody', 'requestBody',
    'expectedNormalizedQuote', 'quote', 'ranges', 'url', 'signedUrl'
  ]);
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value === 'string') {
      assert.doesNotMatch(value, /(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+|https?:\/\/|file:)/iu,
        'B4_REPORT_SECRET_OR_LOCATION_LEAK');
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `B4_REPORT_FORBIDDEN_KEY_${key}`);
      visit(child);
    }
  };
  visit(report);
  return true;
}

function writeReport(filename, report) {
  assertRedactedReport(report);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600
  });
  fs.renameSync(temporary, filename);
}

function copyExtension(source, destination, proxyUrl = '') {
  fs.mkdirSync(destination, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(source, directory), path.join(destination, directory), {
      recursive: true
    });
  }
  for (const file of fs.readdirSync(source)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(source, file), path.join(destination, file));
    }
  }
  if (!proxyUrl) return;
  const networkWorker = path.join(destination, 'offscreen-network-worker.js');
  const boundary = `const b4NativeFetch = globalThis.fetch.bind(globalThis);\n` +
    `globalThis.fetch = (url, options = {}) => {\n` +
    `  const parsed = new URL(String(url));\n` +
    `  if (parsed.origin !== ${JSON.stringify(providerOrigin)} || ` +
    `!${JSON.stringify([...allowedProviderPaths])}.includes(parsed.pathname)) {\n` +
    `    throw new Error('B4_REMOTE_FETCH_BLOCKED');\n` +
    `  }\n` +
    `  return b4NativeFetch(${JSON.stringify(proxyUrl)} + parsed.pathname, options);\n` +
    `};\n`;
  fs.writeFileSync(networkWorker, boundary + fs.readFileSync(networkWorker, 'utf8'));
}

function removeTemporary(target, prefix) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${temporaryRoot}${path.sep}`) ||
      !path.basename(resolved).startsWith(prefix)) return;
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function readBounded(stream, cap = 16 * 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > cap) throw codedError('B4_PROVIDER_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function startRealApiProxy(secret, report) {
  const state = { calls: 0 };
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    try {
      assert.equal(request.method, 'POST', 'B4_PROVIDER_METHOD_REJECTED');
      assert.equal(allowedProviderPaths.has(request.url), true, 'B4_PROVIDER_PATH_REJECTED');
      assert.equal(request.headers.authorization, `Bearer ${dummySecret}`,
        'B4_PROVIDER_BOUNDARY_REJECTED');
      const body = await readBounded(request);
      state.calls += 1;
      report.network.requestDigests.push({
        path: request.url,
        bytes: body.length,
        sha256: sha256(body)
      });
      const upstream = await fetch(`${providerOrigin}${request.url}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(200_000)
      });
      const reply = Buffer.from(await upstream.arrayBuffer());
      if (reply.length > 24 * 1024 * 1024) throw codedError('B4_PROVIDER_REPLY_TOO_LARGE');
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json'
      });
      response.end(reply);
    } catch (error) {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: safeCode(error) } }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, state, url: `http://127.0.0.1:${server.address().port}` };
}

async function selectNativeText(page) {
  const spans = page.locator(
    '.pdf-native-page[data-pdf-page-number="1"] .pdf-native-text-layer span'
  );
  const index = await spans.evaluateAll(nodes => nodes.findIndex(node => {
    const text = String(node.textContent || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const rect = node.getBoundingClientRect();
    return text.length >= 40 && rect.width >= 80 && rect.height > 5 &&
      !/(?:https?:\/\/|doi\b|@)/iu.test(text);
  }));
  assert.ok(index >= 0, 'B4_MANUAL_SELECTION_TARGET_MISSING');
  const target = spans.nth(index);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  assert.ok(box?.width > 20 && box?.height > 5, 'B4_MANUAL_SELECTION_TARGET_HIDDEN');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 3, y, { steps: 18 });
  await page.mouse.up();
  return page.evaluate(() => ({
    characterCount: String(getSelection() || '').normalize('NFKC').replace(/\s+/gu, ' ').trim().length,
    rangeCount: getSelection()?.rangeCount || 0
  }));
}

async function setupRealApiProfile(reader, model) {
  return reader.evaluate(async ({ model: selectedModel, dummy }) => {
    const profileId = 'profile_pdf_semantic_b4_real_api';
    const responses = [];
    const messages = [
      { label: 'save', payload: { type: 'LLM_SAVE_PROFILE', profile: {
        id: profileId, name: 'PDF semantic B4 real API', providerId: 'deepseek',
        capabilities: { vision: false },
        config: { apiKey: dummy, model: selectedModel, maxOutputTokens: 4096,
          reasoningEnabled: false, reasoningEffort: 'auto' }
      } } },
      { label: 'routing', payload: { type: 'LLM_UPDATE_PROFILE_ROUTING',
        globalProfileId: profileId, taskRoutes: {} } },
      { label: 'preferences', payload: { type: 'LLM_UPDATE_PREFERENCES',
        preferences: { mode: 'llm', consentGranted: true } } }
    ];
    for (const message of messages) {
      try {
        const response = await chrome.runtime.sendMessage(message.payload);
        responses.push({ label: message.label, accepted: response?.success === true,
          errorCode: String(response?.error?.code || '').slice(0, 100) });
        if (response?.success !== true) break;
      } catch (error) {
        responses.push({ label: message.label, accepted: false,
          errorCode: String(error?.code || 'MESSAGE_REJECTED').slice(0, 100) });
        break;
      }
    }
    let settingsResponse = null;
    try {
      settingsResponse = await chrome.runtime.sendMessage({ type: 'LLM_GET_SETTINGS' });
    } catch (_) {
      settingsResponse = null;
    }
    const state = settingsResponse?.success === true ? settingsResponse.data : {};
    const settings = state?.settings && typeof state.settings === 'object'
      ? state.settings : {};
    const profile = settings?.profiles?.[profileId] || null;
    const routeFor = taskId => {
      const policy = settings?.taskPolicies?.[taskId] || {};
      const explicitProfile = policy?.mode === 'profile' ? String(policy.profileId || '') : '';
      const effectiveProfileId = explicitProfile || String(settings.globalProfileId || '');
      return {
        taskId,
        policyMode: String(policy?.mode || 'inherit'),
        requestedProfileId: explicitProfile,
        effectiveProfileId,
        effectiveProfileMatches: effectiveProfileId === profileId
      };
    };
    return {
      profileId,
      diagnostic: {
        setupSteps: responses,
        settingsReadAccepted: settingsResponse?.success === true,
        stored: Boolean(profile),
        profileId: String(profile?.id || profileId),
        providerId: String(profile?.providerId || ''),
        model: String(profile?.config?.model || ''),
        credentialPresent: profile?.config?.hasApiKey === true,
        globalProfileMatches: String(settings.globalProfileId || '') === profileId,
        llmReady: state?.llmReady === true,
        effectiveMode: String(state?.effectiveMode || ''),
        routes: {
          documentHighlight: routeFor('document_highlight'),
          evidenceLedger: routeFor('evidence_ledger_review'),
          articleChat: routeFor('article_chat')
        }
      }
    };
  }, { model, dummy: dummySecret });
}

async function activeExtensionTabId(worker, expectedUrl) {
  return worker.evaluate(async url => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs.find(item => item.url === url) || tabs[0];
    if (!Number.isSafeInteger(tab?.id)) throw new Error('B4_ACTIVE_READER_TAB_MISSING');
    return tab.id;
  }, expectedUrl);
}

async function sendTabMessage(worker, tabId, message) {
  return worker.evaluate(async ({ id, payload }) => {
    try {
      return await chrome.tabs.sendMessage(id, payload);
    } catch (error) {
      return { success: false, error: String(error?.message || error || '') };
    }
  }, { id: tabId, payload: message });
}

async function run(options = {}) {
  const normalized = options?.pdfPath && options?.extensionRoot && options?.outputDirectory
    ? Object.freeze({ ...options }) : normalizeOptions([], options);
  if (options.help) return { help: helpText() };
  const reportFilename = path.join(normalized.outputDirectory, 'report.json');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-semantic-b4-'));
  const extensionDirectory = path.join(temporaryRoot, 'extension');
  const profileDirectory = path.join(temporaryRoot, 'profile');
  const report = {
    schemaVersion: 1,
    status: 'RUNNING',
    acceptance: 'P2-B4 native PDF semantic highlight live acceptance',
    execution: {
      realBrowser: true,
      isolatedExtension: true,
      isolatedProfile: true,
      browser: 'msedge',
      apiMode: normalized.apiMode,
      fixedSavedAnswer: false,
      productionApiValidated: false
    },
    source: {},
    network: { browserHttpRequests: 0, providerCalls: 0, requestDigests: [] },
    diagnostics: { pageErrors: 0, consoleErrors: 0, workerErrors: 0 },
    checks: {},
    failureStage: '',
    failureCode: ''
  };
  let context = null;
  let proxy = null;
  let secret = '';
  let stage = 'SOURCE';
  const persist = () => writeReport(reportFilename, report);
  persist();
  try {
    assert.ok(fs.existsSync(normalized.pdfPath), 'B4_PUBLIC_PDF_MISSING');
    assert.ok(fs.existsSync(path.join(normalized.extensionRoot, 'manifest.json')),
      'B4_EXTENSION_ROOT_INVALID');
    const digest = sha256File(normalized.pdfPath);
    const isDefaultElife = digest === EXPECTED_ELIFE_SHA256;
    report.source = {
      pdfSha256: digest,
      expectedPageCount: isDefaultElife ? EXPECTED_ELIFE_PAGES : 0,
      publicFixture: path.basename(normalized.pdfPath),
      extensionContentSha256: sha256File(path.join(normalized.extensionRoot, 'content.js')),
      extensionReaderSha256: sha256File(path.join(normalized.extensionRoot, 'pdf-native-reader.mjs'))
    };
    if (normalized.apiMode === 'real-api') {
      stage = 'REAL_API_SECRET';
      secret = await readSecretFromTty({
        prompt: 'Authorized DeepSeek key for B4 smoke (masked, memory only): '
      });
      assert.ok(secret, 'B4_REAL_API_KEY_REQUIRED');
      proxy = await startRealApiProxy(secret, report);
    }
    copyExtension(normalized.extensionRoot, extensionDirectory, proxy?.url || '');
    fs.mkdirSync(normalized.outputDirectory, { recursive: true });

    stage = 'BROWSER_LAUNCH';
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'msedge', headless: !normalized.headed, reducedMotion: 'reduce',
      viewport: { width: 1320, height: 960 },
      args: [`--disable-extensions-except=${extensionDirectory}`,
        `--load-extension=${extensionDirectory}`]
    });
    await context.route(/^https?:\/\//u, route => {
      const requestUrl = route.request().url();
      if (proxy && requestUrl.startsWith(`${proxy.url}/`)) return route.continue();
      return route.abort('blockedbyclient');
    });
    context.on('request', request => {
      if (/^https?:\/\//u.test(request.url())) report.network.browserHttpRequests += 1;
    });
    const worker = context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', { timeout: 15_000 });
    worker.on('console', message => {
      if (message.type() === 'error') report.diagnostics.workerErrors += 1;
    });
    const extensionId = new URL(worker.url()).host;
    const reader = await context.newPage();
    reader.on('pageerror', () => { report.diagnostics.pageErrors += 1; });
    reader.on('console', message => {
      if (message.type() === 'error') report.diagnostics.consoleErrors += 1;
    });
    await reader.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
      waitUntil: 'domcontentloaded'
    });
    await reader.bringToFront();
    const readerTabId = await activeExtensionTabId(worker, reader.url());
    await reader.evaluate(() => {
      globalThis.__b4SemanticHistory = [];
      document.addEventListener('brevess:pdf-semantic-ready', () => {
        const navigation = globalThis.__brevessNativePdfDocument?.getSemanticNavigation?.();
        if (!navigation || globalThis.__b4SemanticHistory.some(item =>
          item.revision === Number(navigation.revision))) return;
        globalThis.__b4SemanticHistory.push({
          revision: Number(navigation.revision) || 0,
          context: Object.freeze({
            schemaVersion: 1,
            type: 'pdf-semantic-navigation-context',
            documentId: navigation.documentId,
            documentHash: navigation.documentHash,
            documentGeneration: navigation.documentGeneration,
            revision: navigation.revision,
            semanticCacheKey: navigation.semanticCacheKey,
            semanticProvenanceKey: navigation.semanticProvenanceKey,
            navigation
          })
        });
      });
    });
    await reader.locator('#pdfLocalFile').setInputFiles(normalized.pdfPath);

    stage = 'SEMANTIC_READY';
    await reader.waitForFunction(({ hash, pages }) => {
      const native = globalThis.__brevessNativePdfDocument;
      const semantic = globalThis.__brevessPdfSemanticDocument;
      return native?.phase === 'text-ready' && native?.structure?.documentHash === hash &&
        semantic?.phase === 'text-ready' && semantic?.documentHash === hash &&
        (!pages || semantic.indexedPageCount === pages) &&
        typeof native?.resolveSemanticHighlight === 'function' &&
        native?.getSemanticNavigation?.()?.sections?.length > 0;
    }, { hash: digest, pages: report.source.expectedPageCount }, { timeout: 120_000 });

    stage = 'WORKSPACE_READY';
    await reader.waitForFunction(() =>
      document.documentElement.dataset.pdfWorkspaceReady === 'true' &&
      document.documentElement.dataset.pdfWorkspaceIndexed === 'true',
    null, { timeout: 20_000 }).catch(error => {
      if (error.name !== 'TimeoutError') throw error;
    });
    const workspaceState = await sendTabMessage(worker, readerTabId,
      { action: 'getPdfWorkspaceState' });
    report.checks.workspacePrerequisites = {
      responseSuccess: workspaceState?.success === true,
      workspaceReady: workspaceState?.ready === true,
      workspaceIndexed: workspaceState?.indexed === true
    };
    persist();
    assert.equal(report.checks.workspacePrerequisites.responseSuccess, true,
      'B4_WORKSPACE_STATE_UNAVAILABLE');
    assert.equal(report.checks.workspacePrerequisites.workspaceReady, true,
      'B4_WORKSPACE_NOT_READY');
    assert.equal(report.checks.workspacePrerequisites.workspaceIndexed, true,
      'B4_WORKSPACE_NOT_INDEXED');

    stage = 'DYNAMIC_TARGETS';
    const discovery = await reader.evaluate(() => {
      const native = globalThis.__brevessNativePdfDocument;
      const navigation = native.getSemanticNavigation();
      const compatibility = globalThis.__brevessPdfSemanticCompatibility;
      const sections = [];
      const visit = (items, ancestors = []) => (items || []).forEach(section => {
        const record = { section, ancestors: [...ancestors, section] };
        sections.push(record);
        visit(section.children, record.ancestors);
      });
      visit(navigation.sections);
      const allTargets = sections.flatMap(record =>
        (record.section.paragraphTargets || []).map(target => ({ ...record, target })));
      const locatorFor = (target, start, end) => createPdfSemanticHighlightLocator(target, {
        normalizedStart: start,
        normalizedEnd: end,
        expectedNormalizedQuote: target.expectedNormalizedQuote.slice(
          start - target.normalizedStart, end - target.normalizedStart
        )
      });
      let multi = null;
      const multiDiagnostics = { locators: 0, resolved: 0, degraded: 0,
        unresolved: 0, stale: 0, maximumRawRanges: 0, reasonCodes: [],
        invalidSamples: [], successControl: null };
      const diagnoseRequest = (locator, request, result) => {
        const identityFields = [
          'documentId', 'documentHash', 'documentGeneration', 'revision',
          'semanticCacheKey', 'semanticProvenanceKey', 'paragraphId'
        ];
        const valuesEqual = Object.fromEntries(identityFields.map(field => [
          field, request?.[field] === locator?.[field]
        ]));
        const requestRanges = Array.isArray(request?.ranges) ? request.ranges : [];
        const distinctPages = new Set(requestRanges.map(range => range?.pageNumber));
        const computedPrecision = requestRanges.some(range =>
          range?.precision === 'normalized-equivalent')
          ? 'normalized-equivalent' : requestRanges.length ? 'exact-raw' : 'none';
        let firstViolatedPredicate = '';
        let previous = null;
        for (const range of requestRanges) {
          if (!Number.isSafeInteger(range?.pageNumber) || range.pageNumber < 1) {
            firstViolatedPredicate = 'page-number-invalid'; break;
          }
          if (!Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end) ||
              range.start < 0 || range.end <= range.start) {
            firstViolatedPredicate = 'offset-invalid'; break;
          }
          if (typeof range?.quote !== 'string' || !range.quote.length) {
            firstViolatedPredicate = 'quote-empty-or-not-string'; break;
          }
          if (range.quote.length !== range.end - range.start) {
            firstViolatedPredicate = 'quote-length-mismatch'; break;
          }
          if (!['exact-raw', 'normalized-equivalent'].includes(range.precision)) {
            firstViolatedPredicate = 'precision-invalid'; break;
          }
          if (previous && range.pageNumber < previous.pageNumber) {
            firstViolatedPredicate = 'page-order-descending'; break;
          }
          if (previous && range.pageNumber === previous.pageNumber &&
              range.start < previous.end) {
            firstViolatedPredicate = 'same-page-start-before-previous-end'; break;
          }
          previous = range;
        }
        if (!firstViolatedPredicate && distinctPages.size > 4) {
          firstViolatedPredicate = 'distinct-page-limit';
        }
        if (!firstViolatedPredicate && request?.mode !== 'ranges') {
          firstViolatedPredicate = 'mode-not-ranges';
        }
        if (!firstViolatedPredicate &&
            (requestRanges.length < 1 || requestRanges.length > 16)) {
          firstViolatedPredicate = 'range-count-limit';
        }
        if (!firstViolatedPredicate && Object.hasOwn(request || {}, 'pageNumbers')) {
          firstViolatedPredicate = 'page-numbers-present';
        }
        if (!firstViolatedPredicate && request?.pageNumber !== requestRanges[0]?.pageNumber) {
          firstViolatedPredicate = 'primary-page-mismatch';
        }
        if (!firstViolatedPredicate && request?.precision !== computedPrecision) {
          firstViolatedPredicate = 'aggregate-precision-mismatch';
        }
        return {
          resolverStatus: String(result?.status || ''),
          resolverReasonCode: String(result?.reasonCode || ''),
          identityValuesEqual: valuesEqual,
          mode: String(request?.mode || ''),
          rangeCount: requestRanges.length,
          pageNumbersPresent: Object.hasOwn(request || {}, 'pageNumbers'),
          primaryPageNumber: Number(request?.pageNumber) || 0,
          declaredPrecision: String(request?.precision || ''),
          computedPrecision,
          distinctPageCount: distinctPages.size,
          maximumPageNumber: Math.max(0, ...distinctPages),
          firstViolatedPredicate: firstViolatedPredicate || 'none-observed'
        };
      };
      for (const record of allTargets) {
        const target = record.target;
        const text = String(target.expectedNormalizedQuote || '');
        if (text.length < 40 || text.length > 1800) continue;
        const locator = locatorFor(target, target.normalizedStart, target.normalizedEnd);
        const request = locator ? compatibility?.createNativeFocusRequest?.(
          locator.paragraphId, locator.normalizedStart, locator.normalizedEnd,
          locator.expectedNormalizedQuote
        ) : null;
        const result = locator ? native.resolveSemanticHighlight(locator) : null;
        if (locator) multiDiagnostics.locators += 1;
        if (Object.hasOwn(multiDiagnostics, String(result?.status || ''))) {
          multiDiagnostics[result.status] += 1;
        }
        multiDiagnostics.maximumRawRanges = Math.max(
          multiDiagnostics.maximumRawRanges, result?.ranges?.length || 0
        );
        const reasonCode = String(result?.reasonCode || '');
        if (reasonCode && !multiDiagnostics.reasonCodes.includes(reasonCode)) {
          multiDiagnostics.reasonCodes.push(reasonCode);
        }
        if (result?.reasonCode === 'PDF_HIGHLIGHT_RANGE_INVALID' &&
            multiDiagnostics.invalidSamples.length < 3) {
          multiDiagnostics.invalidSamples.push(diagnoseRequest(locator, request, result));
        }
        if (result?.status === 'resolved' && !multiDiagnostics.successControl) {
          multiDiagnostics.successControl = diagnoseRequest(locator, request, result);
        }
        if (!multi && Number(target?.normalizedStart) > 0 &&
            request?.mode === 'ranges' && request.ranges?.length >= 2 &&
            request.ranges.length <= 16 &&
            new Set(request.ranges.map(range => range.pageNumber)).size >= 2) {
          multi = { target: structuredClone(target), locator: structuredClone(locator),
            resolverStatus: String(result?.status || ''),
            resolverReasonCode: String(result?.reasonCode || ''),
            rawRangeCount: request.ranges.length,
            pageNumbers: [...new Set(request.ranges.map(range => range.pageNumber))],
            rawPrecisions: [...new Set(request.ranges.map(range => range.precision))] };
        }
        if (multi && multiDiagnostics.invalidSamples.length >= 3 &&
            multiDiagnostics.successControl) break;
      }
      let pageOnly = null;
      let scanned = 0;
      for (const record of allTargets) {
        const target = record.target;
        const text = String(target.expectedNormalizedQuote || '');
        const offsets = new Set([0, Math.max(0, text.length - 1)]);
        for (let index = 1; index < text.length && offsets.size < 80; index += 1) {
          if (/\s|[.,;:()\[\]{}-]/u.test(text[index]) ||
              /\s|[.,;:()\[\]{}-]/u.test(text[index - 1])) offsets.add(index);
        }
        for (const offset of offsets) {
          if (offset >= text.length || scanned >= 7000) break;
          scanned += 1;
          const locator = locatorFor(target, target.normalizedStart + offset,
            target.normalizedStart + offset + 1);
          const request = locator ? compatibility?.createNativeFocusRequest?.(
            locator.paragraphId, locator.normalizedStart, locator.normalizedEnd,
            locator.expectedNormalizedQuote
          ) : null;
          const result = locator ? native.resolveSemanticHighlight(locator) : null;
          if (request?.mode === 'page-only') {
            pageOnly = { locator: structuredClone(locator),
              compatibilityMode: String(request.mode || ''),
              compatibilityPrecision: String(request.precision || ''),
              status: String(result?.status || ''), precision: String(result?.precision || ''),
              reasonCode: String(result?.reasonCode || ''),
              pageNumber: Number(request.pageNumber || request.pageNumbers?.[0]) ||
                Number(target.pageNumber) || 1 };
            break;
          }
        }
        if (pageOnly || scanned >= 7000) break;
      }
      const methodsRoot = sections.find(record =>
        /(?:^|\b)(?:materials?\s*(?:&|and)\s*)?methods?(?:\b|$)|star methods/iu
          .test(String(record.section.title || '')));
      const descendants = methodsRoot ? sections.filter(record =>
        record.ancestors.some(item => item.sectionId === methodsRoot.section.sectionId)) : [];
      const methodSectionIds = descendants.map(record => String(record.section.sectionId || ''));
      const methodTargets = descendants.flatMap(record => record.section.paragraphTargets || []);
      const methodIds = methodTargets.map(target => target.paragraphId);
      const outsideTargets = allTargets.map(record => record.target)
        .filter(target => !methodIds.includes(target.paragraphId));
      const outsideCorpus = outsideTargets.map(target => target.expectedNormalizedQuote).join(' ')
        .toLocaleLowerCase();
      const frequencies = new Map();
      for (const target of methodTargets) {
        for (const token of String(target.expectedNormalizedQuote || '').match(/[A-Za-z]{6,}/gu) || []) {
          const key = token.toLocaleLowerCase();
          frequencies.set(key, (frequencies.get(key) || 0) + 1);
        }
      }
      const tokenCandidates = [...frequencies]
        .sort((left, right) => Number(outsideCorpus.includes(right[0])) -
          Number(outsideCorpus.includes(left[0])) || right[1] - left[1] ||
          right[0].length - left[0].length);
      let methodToken = '';
      for (const [candidate] of tokenCandidates) {
        for (const target of methodTargets) {
          const text = String(target.expectedNormalizedQuote || '');
          const localStart = text.toLocaleLowerCase().indexOf(candidate);
          if (localStart < 0) continue;
          const locator = locatorFor(target, target.normalizedStart + localStart,
            target.normalizedStart + localStart + candidate.length);
          if (locator && native.resolveSemanticHighlight(locator)?.status === 'resolved') {
            methodToken = text.slice(localStart, localStart + candidate.length);
            break;
          }
        }
        if (methodToken) break;
      }
      const defaultRecord = allTargets.find(record => {
        const titles = record.ancestors.map(item => String(item?.title || '')).join(' ');
        const text = String(record.target?.expectedNormalizedQuote || '');
        if (text.length < 40 || text.length > 500 ||
            /(?:^|\b)(?:materials?\s*(?:&|and)\s*)?methods?(?:\b|$)|star methods/iu
              .test(titles)) return false;
        if (!/\b(?:abstract|introduction|results?|discussion|conclusions?)\b|摘要|引言|结果|讨论|结论/iu
          .test(titles)) return false;
        const locator = locatorFor(record.target, record.target.normalizedStart,
          record.target.normalizedEnd);
        return locator && native.resolveSemanticHighlight(locator)?.status === 'resolved';
      });
      globalThis.__b4Multi = multi;
      globalThis.__b4PageOnly = pageOnly;
      globalThis.__b4Default = defaultRecord ? {
        target: structuredClone(defaultRecord.target),
        sectionIds: defaultRecord.ancestors.map(item => String(item.sectionId || ''))
      } : null;
      globalThis.__b4Methods = {
        rootId: String(methodsRoot?.section?.sectionId || ''),
        rootTitle: String(methodsRoot?.section?.title || ''),
        sectionIds: methodSectionIds,
        paragraphIds: methodIds,
        targets: methodTargets.map(target => structuredClone(target)),
        token: methodToken
      };
      return {
        semanticSectionCount: sections.length,
        semanticParagraphCount: allTargets.length,
        multiAvailable: Boolean(multi),
        multiDiagnostics,
        multiRawRangeCount: multi?.rawRangeCount || 0,
        multiPageCount: multi?.pageNumbers?.length || 0,
        pageOnlyAvailable: Boolean(pageOnly),
        pageOnlyScanned: scanned,
        methodsRootPresent: Boolean(methodsRoot),
        methodSectionCount: methodSectionIds.length,
        methodParagraphCount: methodIds.length,
        methodTokenPresent: Boolean(methodToken),
        defaultTargetAvailable: Boolean(defaultRecord),
        semanticRevision: Number(navigation.revision) || 0
      };
    });
    report.checks.dynamicDiscovery = discovery;
    persist();
    assert.equal(discovery.multiAvailable, true, 'B4_MULTI_RANGE_TARGET_UNAVAILABLE');
    assert.ok(discovery.multiPageCount >= 2, 'B4_MULTI_PAGE_TARGET_UNAVAILABLE');
    assert.equal(discovery.pageOnlyAvailable, true, 'B4_PAGE_ONLY_TARGET_UNAVAILABLE');
    assert.equal(discovery.methodsRootPresent, true, 'B4_METHODS_SCOPE_UNAVAILABLE');
    assert.ok(discovery.methodParagraphCount > 0, 'B4_METHODS_PARAGRAPHS_EMPTY');
    assert.equal(discovery.methodTokenPresent, true, 'B4_METHODS_TOKEN_UNAVAILABLE');
    assert.equal(discovery.defaultTargetAvailable, true, 'B4_DEFAULT_SCOPE_TARGET_UNAVAILABLE');

    await reader.evaluate(() => {
      globalThis.__b4ShowProjectedPage = async pageNumber => {
        document.querySelector(`.pdf-native-page[data-pdf-page-number="${pageNumber}"]`)
          ?.scrollIntoView({ block: 'start' });
        await globalThis.__brevessPdfReaderBridge.command('updatePageWindow', pageNumber, pageNumber);
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const projection = globalThis.__brevessPdfReaderBridge.command('getPageProjection', pageNumber);
          if (projection?.textLayer) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('B4_PAGE_PROJECTION_NOT_MATERIALIZED');
      };
    });

    stage = 'REGEX_MULTI_RANGE';
    const regex = await reader.evaluate(async () => {
      const selected = globalThis.__b4Multi;
      const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const modeId = 'b4-semantic-regex';
      const counts = highlighter.applyHighlight({ b4_multi: {
        isRegex: true,
        patterns: [escapeRegex(selected.target.expectedNormalizedQuote)],
        color: '#FFD166', name: 'B4 multi range'
      } }, 'word', { analysisModeId: modeId,
        allowedParagraphIds: new Set([selected.target.paragraphId]) });
      const entry = highlighter.nativePdfModes.get(modeId);
      const overlayPageNumbers = [];
      const projectionDiagnostics = [];
      for (const pageNumber of selected.pageNumbers) {
        await globalThis.__b4ShowProjectedPage(pageNumber);
        highlighter.paintNativePage(entry, pageNumber);
        const page = document.querySelector(
          `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`);
        const marks = [...(page?.querySelectorAll(
          `.pdf-native-regex-hit[data-analysis-mode-id="${modeId}"]`) || [])];
        if (marks.some(mark => {
          const rect = mark.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })) overlayPageNumbers.push(pageNumber);
        const projection = globalThis.__brevessPdfReaderBridge.command('getPageProjection', pageNumber);
        const resolved = entry?.items?.[0]?.locator
          ? resolvePdfSemanticHighlightLocator(entry.items[0].locator) : null;
        const current = currentNativePdfSemanticHighlightState();
        projectionDiagnostics.push({ pageNumber, pagePresent: Boolean(page),
          projectionPresent: Boolean(projection),
          projectionHashMatches: projection?.documentHash === entry?.documentHash,
          projectionGenerationMatches: projection?.documentGeneration === entry?.documentGeneration,
          resolvedStatus: resolved?.status, reasonCode: resolved?.reasonCode,
          resolvedPages: [...new Set((resolved?.ranges || []).map(range => range.pageNumber))],
          currentReady: current.ready, revision: current.context?.revision,
          locatorRevision: entry?.items?.[0]?.locator?.revision,
          currentHashMatches: current.context?.documentHash === entry?.documentHash,
          pageRect: page ? { width: page.getBoundingClientRect().width,
            height: page.getBoundingClientRect().height } : null });
      }
      globalThis.__b4RegexModeId = modeId;
      const entryLocator = entry?.items?.[0]?.locator;
      return {
        logicalCount: Number(counts.b4_multi) || 0,
        entryItemCount: entry?.items?.length || 0,
        locatorGlobalOffsetsMatch: entryLocator?.paragraphId === selected.target.paragraphId &&
          entryLocator?.normalizedStart === selected.target.normalizedStart &&
          entryLocator?.normalizedEnd === selected.target.normalizedEnd &&
          entryLocator?.expectedNormalizedQuote === selected.target.expectedNormalizedQuote &&
          entryLocator.normalizedStart > 0,
        rawRangeCount: selected.rawRangeCount,
        targetPageNumbers: selected.pageNumbers,
        overlayPageNumbers, projectionDiagnostics
      };
    });
    report.checks.regexSemanticMultiRange = { ...regex,
      layerCount: 0, markCount: 0, nonzeroRectCount: 0, rectMetric: 0 };
    persist();
    assert.equal(regex.logicalCount, 1, 'B4_REGEX_LOGICAL_COUNT_NOT_ONE');
    assert.equal(regex.entryItemCount, 1, 'B4_REGEX_ENTRY_COUNT_NOT_ONE');
    assert.equal(regex.locatorGlobalOffsetsMatch, true,
      'B4_REGEX_LOCATOR_NOT_GLOBAL_TARGET');
    assert.ok(regex.rawRangeCount > 1, 'B4_REGEX_RAW_RANGE_NOT_MULTILINE');
    assertMultiPageOverlayCoverage(regex.targetPageNumbers, regex.overlayPageNumbers,
      'B4_REGEX_MULTI_PAGE_OVERLAY_INCOMPLETE');
    const regexDomHandle = await reader.waitForFunction(modeId => {
      const marks = [...document.querySelectorAll(
        `.pdf-native-regex-hit[data-analysis-mode-id="${modeId}"]`
      )];
      const layers = [...document.querySelectorAll(
        `.pdf-native-regex-layer[data-analysis-mode-id="${modeId}"]`
      )];
      const rects = marks.map(mark => mark.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0);
      return marks.length > 0 && rects.length === marks.length ? {
        layerCount: layers.length, markCount: marks.length,
        nonzeroRectCount: rects.length,
        rectMetric: rects.reduce((sum, rect) => sum + rect.width + rect.height, 0)
      } : false;
    }, 'b4-semantic-regex', { timeout: 20_000 });
    const regexDom = await regexDomHandle.jsonValue();
    assert.ok(regexDom.markCount > 0 && regexDom.nonzeroRectCount > 0,
      'B4_REGEX_REAL_RECTS_EMPTY');
    report.checks.regexSemanticMultiRange = { ...regex, ...regexDom };

    stage = 'LLM_SEMANTIC_FIXTURE';
    const llmFixture = await reader.evaluate(async () => {
      const selected = globalThis.__b4Multi;
      const modeId = 'b4-llm-semantic-fixture';
      const text = selected.target.expectedNormalizedQuote;
      const result = applyNativePdfLlmHighlights([{
        paragraphId: selected.target.paragraphId,
        start: 0,
        end: text.length,
        quote: text,
        visibleMode: 'inline_highlight',
        categories: [{ categoryId: 'b4_llm', categoryName: 'B4 LLM fixture',
          color: '#80ED99', confidence: 1 }],
        primary: { categoryId: 'b4_llm', categoryName: 'B4 LLM fixture',
          color: '#80ED99', confidence: 1 }
      }], {
        readingViewId: modeId,
        documentHash: globalThis.__brevessNativePdfDocument.structure.documentHash,
        categories: [{ categoryId: 'b4_llm', name: 'B4 LLM fixture', color: '#80ED99' }]
      });
      const entry = nativePdfLlmHighlightsByMode.get(modeId);
      const overlayPageNumbers = [];
      for (const pageNumber of selected.pageNumbers) {
        await globalThis.__b4ShowProjectedPage(pageNumber);
        paintNativePdfLlmPage(entry, pageNumber);
        const page = document.querySelector(
          `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`);
        const pageMarks = [...(page?.querySelectorAll(
          `.pdf-native-automatic-hit[data-analysis-mode-id="${modeId}"]`) || [])];
        if (pageMarks.some(mark => {
          const rect = mark.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })) overlayPageNumbers.push(pageNumber);
      }
      const marks = [...document.querySelectorAll(
        `.pdf-native-automatic-hit[data-analysis-mode-id="${modeId}"]`
      )];
      const entryLocator = entry?.items?.[0]?.locator;
      return {
        dynamicallyBound: entry?.items?.[0]?.locatorKind === 'pdf-semantic',
        locatorGlobalOffsetsMatch: entryLocator?.paragraphId === selected.target.paragraphId &&
          entryLocator?.normalizedStart === selected.target.normalizedStart &&
          entryLocator?.normalizedEnd === selected.target.normalizedEnd &&
          entryLocator?.expectedNormalizedQuote === selected.target.expectedNormalizedQuote &&
          entryLocator.normalizedStart > 0,
        logicalCount: Number(result?.highlightedCount) || 0,
        degradedCount: Number(result?.degradedCount) || 0,
        unresolvedCount: Number(result?.unresolvedCount) || 0,
        rawRangeCount: selected.rawRangeCount,
        targetPageNumbers: selected.pageNumbers,
        overlayPageNumbers,
        markCount: marks.length,
        nonzeroRectCount: marks.filter(mark => {
          const rect = mark.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length
      };
    });
    assert.equal(llmFixture.dynamicallyBound, true, 'B4_LLM_NOT_SEMANTIC');
    assert.equal(llmFixture.locatorGlobalOffsetsMatch, true,
      'B4_LLM_LOCATOR_NOT_GLOBAL_TARGET');
    assert.equal(llmFixture.logicalCount, 1, 'B4_LLM_LOGICAL_COUNT_NOT_ONE');
    assert.ok(llmFixture.markCount > 0 && llmFixture.nonzeroRectCount > 0,
      'B4_LLM_REAL_RECTS_EMPTY');
    assertMultiPageOverlayCoverage(llmFixture.targetPageNumbers,
      llmFixture.overlayPageNumbers, 'B4_LLM_MULTI_PAGE_OVERLAY_INCOMPLETE');
    report.checks.llmSemanticFixture = llmFixture;

    stage = 'QA_SEMANTIC_FIXTURE';
    const qaFixture = await reader.evaluate(async () => {
      const selected = globalThis.__b4Multi;
      const turnId = 'b4-dynamic-qa-fixture';
      const turn = {
        turnId,
        intent: 'highlight',
        highlightCategoryId: 'b4_qa',
        highlightCategoryName: 'B4 Q&A fixture',
        highlightColor: '#5DADE2',
        answerBlocks: [{ blockId: 'dynamic-browser-fixture', evidence: [{
          paragraphId: selected.target.paragraphId,
          start: 0,
          end: selected.target.expectedNormalizedQuote.length,
          quote: selected.target.expectedNormalizedQuote
        }] }]
      };
      const logicalCount = await createSemanticAnnotationsFromTurn(turn);
      const entry = nativePdfSemanticChatHighlightsByTurn.get(turnId);
      const overlayPageNumbers = [];
      for (const pageNumber of selected.pageNumbers) {
        await globalThis.__b4ShowProjectedPage(pageNumber);
        paintNativePdfSemanticChatPage(entry, pageNumber);
        const page = document.querySelector(
          `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`);
        const pageMarks = [...(page?.querySelectorAll(
          `.pdf-native-semantic-chat-hit[data-analysis-mode-id="${turnId}"]`) || [])];
        if (pageMarks.some(mark => {
          const rect = mark.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })) overlayPageNumbers.push(pageNumber);
      }
      const marks = [...document.querySelectorAll(
        `.pdf-native-semantic-chat-hit[data-analysis-mode-id="${turnId}"]`
      )];
      const entryLocator = entry?.items?.[0]?.locator;
      return {
        dynamicallyBound: entry?.items?.[0]?.locatorKind === 'pdf-semantic',
        locatorGlobalOffsetsMatch: entryLocator?.paragraphId === selected.target.paragraphId &&
          entryLocator?.normalizedStart === selected.target.normalizedStart &&
          entryLocator?.normalizedEnd === selected.target.normalizedEnd &&
          entryLocator?.expectedNormalizedQuote === selected.target.expectedNormalizedQuote &&
          entryLocator.normalizedStart > 0,
        logicalCount: Number(logicalCount) || 0,
        turnMatchCount: Number(turn.matchCount) || 0,
        degradedCount: Number(turn.degradedCount) || 0,
        unresolvedCount: Number(turn.unresolvedCount) || 0,
        rawRangeCount: selected.rawRangeCount,
        targetPageNumbers: selected.pageNumbers,
        overlayPageNumbers,
        markCount: marks.length,
        nonzeroRectCount: marks.filter(mark => {
          const rect = mark.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length,
        fixedSavedAnswerUsed: false
      };
    });
    assert.equal(qaFixture.dynamicallyBound, true, 'B4_QA_NOT_SEMANTIC');
    assert.equal(qaFixture.locatorGlobalOffsetsMatch, true,
      'B4_QA_LOCATOR_NOT_GLOBAL_TARGET');
    assert.equal(qaFixture.logicalCount, 1, 'B4_QA_LOGICAL_COUNT_NOT_ONE');
    assert.ok(qaFixture.markCount > 0 && qaFixture.nonzeroRectCount > 0,
      'B4_QA_REAL_RECTS_EMPTY');
    assertMultiPageOverlayCoverage(qaFixture.targetPageNumbers,
      qaFixture.overlayPageNumbers, 'B4_QA_MULTI_PAGE_OVERLAY_INCOMPLETE');
    report.checks.qaSemanticFixture = qaFixture;

    stage = 'COMMITTED_TURN_PROJECTION';
    const restoredSemantic = await reader.evaluate(async () => {
      const selected = globalThis.__b4Multi;
      const previousChat = articleChatState;
      const turnId = 'arch009-restored-semantic-fixture';
      const documentHash = globalThis.__brevessNativePdfDocument.structure.documentHash;
      const turn = { turnId, intent: 'highlight', status: 'completed',
        question: 'Restore the saved quote display without regenerating annotations',
        answerBlocks: [{ blockId: 'restored-evidence', markdown: 'Saved evidence',
          evidence: [{ paragraphId: selected.target.paragraphId,
            quote: selected.target.expectedNormalizedQuote }] }] };
      const manualBefore = JSON.stringify(currentManualDocument?.record || null);
      try {
        const result = await applyArticleWorkspaceAssetsUnsafe({
          assets: [{ relativePath: 'chat/index.json', content: { turns: [turn] } }],
          match: 'exact', persistRestored: false, deferManualSideEffects: true,
          committedDocumentRequired: true,
          committedDocumentTarget: { documentHash }
        });
        const entry = nativePdfSemanticChatHighlightsByTurn.get(turnId);
        const overlayPages = [];
        for (const pageNumber of selected.pageNumbers) {
          await globalThis.__b4ShowProjectedPage(pageNumber);
          paintNativePdfSemanticChatPage(entry, pageNumber);
          const page = document.querySelector(
            `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`);
          if ([...(page?.querySelectorAll(
            `.pdf-native-semantic-chat-hit[data-analysis-mode-id="${turnId}"]`) || [])]
            .some(mark => { const rect = mark.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })) {
            overlayPages.push(pageNumber);
          }
        }
        return { success: result.success, restored: result.semanticHighlightsRestored,
          deferred: result.manualRebuildDeferred === true,
          manualRecordUnchanged: JSON.stringify(currentManualDocument?.record || null) === manualBefore,
          targetPages: selected.pageNumbers, overlayPages,
          boundary: 'Projection stage only on real PDF geometry and production apply; does not impersonate a directory CAS commit.' };
      } finally {
        articleChatState = previousChat;
      }
    });
    assert.equal(restoredSemantic.success, true);
    assert.equal(restoredSemantic.restored, 1);
    assert.equal(restoredSemantic.deferred, false);
    assert.equal(restoredSemantic.manualRecordUnchanged, true);
    assertMultiPageOverlayCoverage(restoredSemantic.targetPages, restoredSemantic.overlayPages,
      'ARCH009_RESTORED_SEMANTIC_OVERLAY_MISSING');
    report.checks.committedTurnProjection = restoredSemantic;
    await reader.screenshot({ path: path.join(normalized.outputDirectory,
      'arch009-restored-semantic.png') });
    await reader.evaluate(() => clearNativePdfSemanticChatHighlights('arch009-restored-semantic-fixture'));

    stage = 'FAIL_CLOSED_RESOLUTION';
    const failClosed = await reader.evaluate(async () => {
      const modeId = 'b4-fail-closed';
      const pageOnly = globalThis.__b4PageOnly;
      const native = globalThis.__brevessNativePdfDocument;
      const pageOnlyResult = resolvePdfSemanticHighlightLocator(pageOnly.locator);
      const unresolvedLocator = { ...globalThis.__b4Multi.locator,
        documentGeneration: globalThis.__b4Multi.locator.documentGeneration + 1 };
      const unresolvedResult = resolvePdfSemanticHighlightLocator(unresolvedLocator);
      const pageNumber = pageOnly.pageNumber;
      await globalThis.__b4ShowProjectedPage(pageNumber);
      const page = document.querySelector(
        `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`
      );
      const before = page?.querySelectorAll(
        `.pdf-native-regex-layer[data-analysis-mode-id="${modeId}"],` +
        `.pdf-native-regex-layer[data-analysis-mode-id="${modeId}"] .pdf-native-regex-hit`
      ).length || 0;
      const entry = { modeId, documentHash: native.structure.documentHash,
        documentGeneration: native.documentGeneration,
        items: [{ locator: pageOnly.locator }, { locator: unresolvedLocator }] };
      const painted = paintPdfSemanticHighlightPage(entry, pageNumber, {
        layerClass: 'pdf-native-regex-layer', modeId,
        createMark: () => {
          const mark = document.createElement('span');
          mark.className = 'pdf-native-regex-hit';
          mark.dataset.analysisModeId = modeId;
          return mark;
        }
      });
      const layers = page?.querySelectorAll(
        `.pdf-native-regex-layer[data-analysis-mode-id="${modeId}"]`
      ).length || 0;
      const marks = page?.querySelectorAll(
        `.pdf-native-regex-hit[data-analysis-mode-id="${modeId}"]`
      ).length || 0;
      return {
        compatibilityMode: pageOnly.compatibilityMode,
        compatibilityPrecision: pageOnly.compatibilityPrecision,
        pageOnlyStatus: pageOnlyResult.status,
        pageOnlyPrecision: pageOnlyResult.precision,
        pageOnlyReasonCode: pageOnlyResult.reasonCode,
        unresolvedStatus: unresolvedResult.status,
        unresolvedReasonCode: unresolvedResult.reasonCode,
        admittedLogicalCount: painted > 0 ? 1 : 0,
        paintedMarkCount: painted,
        layerGrowth: layers + marks - before,
        layerCount: layers,
        markCount: marks
      };
    });
    assert.equal(failClosed.compatibilityMode, 'page-only',
      'B4_PAGE_ONLY_COMPATIBILITY_MODE_MISSING');
    assert.notEqual(failClosed.pageOnlyStatus, 'resolved', 'B4_PAGE_ONLY_REPORTED_RESOLVED');
    assert.notEqual(failClosed.unresolvedStatus, 'resolved', 'B4_STALE_REPORTED_RESOLVED');
    assert.equal(failClosed.admittedLogicalCount, 0, 'B4_FAIL_CLOSED_COUNTED_SUCCESS');
    assert.equal(failClosed.paintedMarkCount, 0, 'B4_FAIL_CLOSED_PAINTED_MARK');
    assert.equal(failClosed.layerGrowth, 0, 'B4_FAIL_CLOSED_LAYER_GROWTH');
    report.checks.pageOnlyAndUnresolved = failClosed;

    stage = 'ZOOM_FIT_REMOUNT';
    const geometry = await reader.evaluate(async () => {
      const selected = globalThis.__b4Multi;
      const targetPage = selected.pageNumbers[0];
      const modeId = globalThis.__b4RegexModeId;
      const bridge = globalThis.__brevessPdfReaderBridge;
      const native = globalThis.__brevessNativePdfDocument;
      const sample = () => {
        const page = document.querySelector(
          `.pdf-native-page[data-pdf-page-number="${targetPage}"]`
        );
        const layers = page?.querySelectorAll(
          `.pdf-native-regex-layer[data-analysis-mode-id="${modeId}"]`
        ) || [];
        const marks = page?.querySelectorAll(
          `.pdf-native-regex-hit[data-analysis-mode-id="${modeId}"]`
        ) || [];
        const rects = [...marks].map(mark => mark.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0);
        const pageRect = page?.getBoundingClientRect();
        return { layers: layers.length, marks: marks.length, nonzeroRects: rects.length,
          metric: rects.reduce((sum, rect) => sum + rect.width + rect.height, 0),
          styleMetric: [...marks].reduce((sum, mark) => sum +
            ['left', 'top', 'width', 'height'].reduce((inner, name) =>
              inner + (Number.parseFloat(mark.style[name]) || 0), 0), 0),
          pageWidth: pageRect?.width || 0,
          pageHeight: pageRect?.height || 0,
          inlinePageWidth: Number.parseFloat(page?.style?.width) || 0,
          inlinePageHeight: Number.parseFloat(page?.style?.height) || 0,
          mounted: Boolean(page?.classList.contains('is-rendered') &&
            page.querySelector('.pdf-native-text-layer')) };
      };
      await globalThis.__b4ShowProjectedPage(targetPage);
      highlighter.paintNativePage(highlighter.nativePdfModes.get(modeId), targetPage);
      const baseline = sample();
      const baselineMarks = [...document.querySelectorAll(
        `.pdf-native-regex-hit[data-analysis-mode-id="${modeId}"]`
      )];
      const oldScale = Number(bridge.command('getState')?.scale) || 1.35;
      bridge.command('setScale', Math.min(2.6, oldScale + 0.31), { preservePage: targetPage });
      await new Promise(resolve => setTimeout(resolve, 1100));
      await globalThis.__b4ShowProjectedPage(targetPage);
      highlighter.paintNativePage(highlighter.nativePdfModes.get(modeId), targetPage);
      const zoom = sample();
      const zoomMarks = [...document.querySelectorAll(
        `.pdf-native-regex-hit[data-analysis-mode-id="${modeId}"]`
      )];
      zoom.reusedBaselineMark = zoomMarks.some(mark => baselineMarks.includes(mark));
      const zoomScale = Number(bridge.command('getState')?.scale) || 0;
      bridge.command('fitWidth');
      await new Promise(resolve => setTimeout(resolve, 1100));
      await globalThis.__b4ShowProjectedPage(targetPage);
      highlighter.paintNativePage(highlighter.nativePdfModes.get(modeId), targetPage);
      const fit = sample();
      const fitScale = Number(bridge.command('getState')?.scale) || 0;
      const otherPage = targetPage > 8 ? 1 : Math.min(23, targetPage + 12);
      native.focusPage(otherPage);
      await globalThis.__b4ShowProjectedPage(otherPage);
      await new Promise(resolve => setTimeout(resolve, 300));
      const unloaded = sample();
      await globalThis.__b4ShowProjectedPage(targetPage);
      await new Promise(resolve => setTimeout(resolve, 1000));
      highlighter.paintNativePage(highlighter.nativePdfModes.get(modeId), targetPage);
      const remounted = sample();
      highlighter.paintNativePage(highlighter.nativePdfModes.get(modeId), targetPage);
      const repainted = sample();
      return { targetPage, otherPage, oldScale, zoomScale, fitScale,
        baseline, zoom, fit, unloaded, remounted, repainted };
    });
    report.checks.zoomFitVirtualization = geometry;
    persist();
    assert.ok(geometry.baseline.marks > 0, 'B4_GEOMETRY_BASELINE_EMPTY');
    assert.notEqual(geometry.zoomScale, geometry.oldScale, 'B4_ZOOM_SCALE_UNCHANGED');
    assert.equal(geometry.zoom.reusedBaselineMark, false, 'B4_ZOOM_MARK_NOT_REPROJECTED');
    assert.ok(Math.abs(geometry.zoom.styleMetric - geometry.baseline.styleMetric) > 0.5 ||
        Math.abs(geometry.zoom.inlinePageWidth - geometry.baseline.inlinePageWidth) > 0.5,
      'B4_ZOOM_RECTS_NOT_RECOMPUTED');
    assert.ok(geometry.fitScale > 0 && geometry.fit.nonzeroRects > 0,
      'B4_FIT_RECTS_EMPTY');
    assert.equal(geometry.unloaded.mounted, false, 'B4_TARGET_PAGE_NOT_UNMOUNTED');
    assert.equal(geometry.unloaded.layers, 0, 'B4_UNMOUNT_LEFT_LAYER');
    assert.equal(geometry.remounted.layers, 1, 'B4_REMOUNT_LAYER_COUNT_INVALID');
    assert.equal(geometry.repainted.layers, 1, 'B4_REPAINT_LAYER_GROWTH');
    assert.equal(geometry.repainted.marks, geometry.remounted.marks, 'B4_REPAINT_MARK_GROWTH');

    stage = 'DEFAULT_SCOPE_MESSAGE';
    const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const defaultPhrase = await reader.evaluate(() =>
      String(globalThis.__b4Default?.target?.expectedNormalizedQuote || ''));
    const workspaceResponse = await sendTabMessage(worker, readerTabId,
      { action: 'showArticleNavigator', tab: 'outline' });
    assert.equal(workspaceResponse?.success, true, 'B4_WORKSPACE_MESSAGE_FAILED');
    assert.equal(workspaceResponse?.snapshot?.analysisSelectionCustomized, false,
      'B4_DEFAULT_SCOPE_ALREADY_CUSTOMIZED');
    const defaultModeId = 'b4-default-message-regex';
    const defaultResponse = await sendTabMessage(worker, readerTabId, {
      action: 'applyHighlight', mode: 'word', analysisModeId: defaultModeId,
      categories: { b4_default: { isRegex: true, patterns: [escapeRegex(defaultPhrase)],
        color: '#9B5DE5', name: 'B4 default message scope' } }
    });
    assert.equal(defaultResponse?.success, true, 'B4_DEFAULT_APPLY_MESSAGE_FAILED');
    const defaultScope = await reader.evaluate(modeId => {
      const selected = selectedArticleAnalysisParagraphIds();
      const scope = currentNativePdfSemanticAnalysisScope();
      const entry = highlighter.nativePdfModes.get(modeId);
      return {
        messageAction: 'applyHighlight',
        selectedEntryUsed: true,
        selectionCustomized: articleNavigatorState.analysisSectionSelection.size > 0,
        canonicalSelectedCount: selected.size,
        semanticSelectedCount: scope.semanticParagraphIds.size,
        logicalCount: Number(highlighter.matchCounts?.b4_default) || 0,
        highlightedParagraphCount: new Set((entry?.items || [])
          .map(item => item.locator?.paragraphId)).size,
        allHitsInsideSelectedScope: (entry?.items || []).every(item =>
          scope.semanticParagraphIds.has(String(item.locator?.paragraphId || ''))),
        legacyFallbackUsed: (entry?.items || []).some(item =>
          String(item.locator?.paragraphId || '').startsWith('pdf-page-'))
      };
    }, defaultModeId);
    assert.equal(defaultScope.selectionCustomized, false, 'B4_DEFAULT_SCOPE_MUTATED');
    assert.ok(defaultScope.logicalCount > 0, 'B4_DEFAULT_SCOPE_REGEX_EMPTY');
    assert.equal(defaultScope.allHitsInsideSelectedScope, true, 'B4_DEFAULT_SCOPE_LEAK');
    assert.equal(defaultScope.legacyFallbackUsed, false, 'B4_DEFAULT_SCOPE_LEGACY_FALLBACK');
    report.checks.defaultScopeMessage = defaultScope;

    stage = 'METHODS_SCOPE_MESSAGE';
    const methodProviderCallsBefore = proxy?.state.calls || 0;
    const methodPlan = buildMethodsSelectionMessages(workspaceResponse.snapshot);
    for (const message of methodPlan.messages) {
      const response = await sendTabMessage(worker, readerTabId, message);
      assert.equal(response?.success, true, 'B4_METHODS_SELECTION_MESSAGE_FAILED');
    }
    const scopeMappingDiagnostic = await reader.evaluate(methodCanonicalIds => {
      const normalizeTitle = value => String(value || '').normalize('NFKC')
        .toLowerCase().replace(/&/gu, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const snapshot = getCanonicalArticleSnapshot();
      const selectedIds = selectedArticleAnalysisParagraphIds(snapshot);
      const scope = currentNativePdfSemanticAnalysisScope();
      const canonical = [];
      const flattenCanonical = (nodes, ancestors = []) => (nodes || []).forEach(node => {
        const id = String(node.sectionId || '');
        const paragraphs = (snapshot.paragraphs || []).filter(item =>
          String(item.sectionId || '') === id);
        canonical.push({
          sectionId: id,
          title: String(node.title || '').slice(0, 160),
          normalizedTitle: normalizeTitle(node.title),
          kind: String(paragraphs[0]?.sectionKind || node.sectionKind || ''),
          level: Number(node.level) || 0,
          ancestorTitles: ancestors.map(item => normalizeTitle(item.title)).filter(Boolean),
          paragraphCount: paragraphs.length,
          pageNumbers: [...new Set(paragraphs.map(item => Number(item.pageNumber))
            .filter(Number.isSafeInteger))]
        });
        flattenCanonical(node.children, [...ancestors, node]);
      });
      flattenCanonical(snapshot.structure?.nodes || []);
      const titleSelection = new Map();
      for (const paragraph of snapshot.paragraphs || []) {
        const title = normalizeTitle(paragraph.sectionTitle || paragraph.displaySectionTitle);
        if (!titleSelection.has(title)) titleSelection.set(title, []);
        titleSelection.get(title).push(selectedIds.has(String(paragraph.paragraphId || '')) ||
          selectedIds.has(String(paragraph.sourceKey || '')));
      }
      const canonicalTitleSelection = [...titleSelection].map(([normalizedTitle, values]) => ({
        normalizedTitle,
        paragraphCount: values.length,
        unanimous: values.every(value => value === values[0]),
        selected: values.length > 0 && values.every(Boolean)
      }));
      const navigation = currentNativePdfSemanticHighlightState()?.context?.navigation;
      const semantic = [];
      const flattenSemantic = (sections, ancestors = []) => (sections || []).forEach(section => {
        const targets = section.paragraphTargets || [];
        const pages = [...new Set(targets.map(item => Number(item.pageNumber))
          .filter(Number.isSafeInteger))];
        semantic.push({
          sectionId: String(section.sectionId || ''),
          title: String(section.title || '').slice(0, 160),
          normalizedTitle: normalizeTitle(section.title),
          level: Number(section.level) || 0,
          ancestorTitles: ancestors.map(item => normalizeTitle(item.title)).filter(Boolean),
          targetCount: targets.length,
          pageStart: pages.length ? Math.min(...pages) : 0,
          pageEnd: pages.length ? Math.max(...pages) : 0
        });
        flattenSemantic(section.children, [...ancestors, section]);
      });
      flattenSemantic(navigation?.sections || []);
      const semanticMethods = semantic.filter(item =>
        item.ancestorTitles.some(title => /\bmethods?\b/u.test(title)) ||
        /\bmethods?\b/u.test(item.normalizedTitle));
      const methodMapping = semanticMethods.map(section => {
        const titleCandidates = canonical.filter(item =>
          item.normalizedTitle && item.normalizedTitle === section.normalizedTitle);
        const levelCandidates = titleCandidates.filter(item => item.level === section.level);
        const ancestorCandidates = levelCandidates.filter(item =>
          section.ancestorTitles.every((title, index) =>
            !title || item.ancestorTitles[index] === title));
        return {
          title: section.title,
          level: section.level,
          targetCount: section.targetCount,
          titleCandidateCount: titleCandidates.length,
          titleLevelCandidateCount: levelCandidates.length,
          titleLevelAncestorCandidateCount: ancestorCandidates.length,
          uniquelyMappable: ancestorCandidates.length === 1
        };
      });
      return {
        scopeStatus: String(scope?.status || ''),
        scopeReasonCode: String(scope?.reasonCode || ''),
        canonicalSelectedCount: scope?.canonicalParagraphIds?.size || 0,
        semanticSelectedCount: scope?.semanticParagraphIds?.size || 0,
        methodsCanonicalIds: methodCanonicalIds,
        canonical,
        canonicalTitleSelection,
        semantic,
        methodMapping,
        allMethodSectionsUniquelyMappable: methodMapping.length > 0 &&
          methodMapping.every(item => item.uniquelyMappable)
      };
    }, [...methodPlan.methodSectionIds]);
    report.checks.scopeMappingDiagnostic = scopeMappingDiagnostic;
    persist();
    const methodTokenProbe = await reader.evaluate(() => {
      const scope = currentNativePdfSemanticAnalysisScope();
      const native = globalThis.__brevessNativePdfDocument;
      const targets = [];
      const visit = sections => (sections || []).forEach(section => {
        targets.push(...(section.paragraphTargets || []).filter(target =>
          scope.semanticParagraphIds.has(String(target?.paragraphId || ''))));
        visit(section.children);
      });
      visit(currentNativePdfSemanticHighlightState()?.context?.navigation?.sections || []);
      const diagnostics = { selectedTargetCount: targets.length, wordCandidateCount: 0,
        locatorCreatedCount: 0, resolverStatuses: {}, resolverReasonCodes: {} };
      for (const target of targets) {
        const text = String(target.expectedNormalizedQuote || '');
        if (text.length < 20 || text.length > 1800) continue;
        diagnostics.wordCandidateCount += (text.match(/[A-Za-z]{6,}/gu) || []).length;
        const locator = createPdfSemanticHighlightLocator(target, target);
        if (locator) diagnostics.locatorCreatedCount += 1;
        const result = locator ? native.resolveSemanticHighlight(locator) : null;
        const status = String(result?.status || 'locator-null');
        const reason = String(result?.reasonCode || 'none');
        diagnostics.resolverStatuses[status] =
          (diagnostics.resolverStatuses[status] || 0) + 1;
        diagnostics.resolverReasonCodes[reason] =
          (diagnostics.resolverReasonCodes[reason] || 0) + 1;
        if (locator && result?.status === 'resolved') {
          globalThis.__b4MethodMessageTarget = structuredClone(target);
          return { token: text, diagnostics };
        }
      }
      return { token: '', diagnostics };
    });
    report.checks.methodTokenResolutionDiagnostic = methodTokenProbe.diagnostics;
    persist();
    const methodToken = methodTokenProbe.token;
    assert.ok(methodToken, 'B4_METHODS_SELECTED_TOKEN_UNAVAILABLE');
    const methodsResponse = await sendTabMessage(worker, readerTabId, {
      action: 'applyHighlight', mode: 'word', analysisModeId: 'b4-methods-message-regex',
      categories: { b4_methods: { isRegex: true, patterns: [escapeRegex(methodToken)],
        color: '#7BDFF2', name: 'B4 Methods message scope' } }
    });
    const methodsCountResponse = await sendTabMessage(worker, readerTabId, {
      action: 'getMatchCounts', rules: { b4_methods: { isRegex: true,
        patterns: [escapeRegex(methodToken)] } }
    });
    assert.equal(methodsResponse?.success, true, 'B4_METHODS_APPLY_MESSAGE_FAILED');
    assert.equal(methodsCountResponse?.success, true, 'B4_METHODS_COUNT_MESSAGE_FAILED');
    const methods = await reader.evaluate(modeId => {
      const selected = globalThis.__b4Methods;
      const methodIds = new Set(selected.paragraphIds);
      const canonicalSelected = selectedArticleAnalysisParagraphIds();
      const scope = currentNativePdfSemanticAnalysisScope();
      const entry = highlighter.nativePdfModes.get(modeId);
      const sectionDistribution = [];
      const visit = items => (items || []).forEach(section => {
        const ids = (section.paragraphTargets || []).map(item => String(item.paragraphId || ''));
        const selectedCount = ids.filter(id => scope.semanticParagraphIds.has(id)).length;
        if (selectedCount) sectionDistribution.push({
          title: String(section.title || '').slice(0, 160),
          targetCount: ids.length,
          selectedCount,
          methodsDescendant: ids.every(id => !scope.semanticParagraphIds.has(id) || methodIds.has(id))
        });
        visit(section.children);
      });
      visit(scope?.navigation?.sections || currentNativePdfSemanticHighlightState()
        ?.context?.navigation?.sections || []);
      return {
        messageActions: ['setArticleAnalysisSectionSelection', 'applyHighlight',
          'getMatchCounts'],
        selectedEntryUsed: true,
        descendantSectionCount: selected.sectionIds.length,
        descendantParagraphCount: methodIds.size,
        canonicalSelectedCount: canonicalSelected.size,
        semanticSelectedCount: scope.semanticParagraphIds.size,
        logicalCount: Number(highlighter.matchCounts?.b4_methods) || 0,
        highlightedParagraphCount: new Set((entry?.items || [])
          .map(item => item.locator?.paragraphId)).size,
        allHitsAreDescendants: (entry?.items || []).every(item =>
          methodIds.has(String(item.locator?.paragraphId || ''))),
        semanticScopeOnlyMethods: [...scope.semanticParagraphIds].every(id => methodIds.has(id)),
        semanticScopeOutsideMethodsCount: [...scope.semanticParagraphIds]
          .filter(id => !methodIds.has(id)).length,
        semanticSectionDistribution: sectionDistribution,
        legacyFallbackUsed: (entry?.items || []).some(item =>
          String(item.locator?.paragraphId || '').startsWith('pdf-page-'))
      };
    }, 'b4-methods-message-regex');
    methods.applyResponseCount = Number(methodsResponse?.counts?.b4_methods) || 0;
    methods.countResponseCount = Number(methodsCountResponse?.counts?.b4_methods) || 0;

    const beforeTurns = await reader.evaluate(() => articleChatState.turns.length);
    const deselectResponse = await sendTabMessage(worker, readerTabId, methodPlan.messages[0]);
    assert.equal(deselectResponse?.success, true, 'B4_EMPTY_SCOPE_SELECTION_FAILED');
    const emptyResponse = await sendTabMessage(worker, readerTabId, {
      action: 'highlightArticleMatchesWithLLM', question: 'B4 empty scope',
      profileId: 'fixture-profile', contextScope: { scopes: [{
        scopeId: 'b4-missing', name: 'Missing Methods',
        sectionIds: ['b4-missing'], sourceKeys: ['b4-missing']
      }] }
    });
    methods.emptyScopeCode = String(emptyResponse?.code || emptyResponse?.error || '');
    methods.emptyScopeTurnDelta = await reader.evaluate(value =>
      articleChatState.turns.length - value, beforeTurns);
    methods.providerRequestDelta = (proxy?.state.calls || 0) - methodProviderCallsBefore;
    const reselectResponse = await sendTabMessage(worker, readerTabId, methodPlan.messages[1]);
    assert.equal(reselectResponse?.success, true, 'B4_METHODS_RESELECT_FAILED');

    stage = 'SEMANTIC_READY_PENDING_REBIND';
    const pendingTargetPage = await reader.evaluate(async () => {
      const currentContext = readPdfSemanticNavigationContext();
      const semanticDocument = globalThis.__brevessPdfSemanticDocument;
      const currentIndex = semanticDocument?.index;
      const native = globalThis.__brevessNativePdfDocument;
      if (!currentContext || !currentIndex) {
        throw new Error('B4_CURRENT_SEMANTIC_REVISION_MISSING');
      }
      const nextRevision = Number(currentContext.revision) + 1;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= Number(native.pageCount); pageNumber += 1) {
        await globalThis.__b4ShowProjectedPage(pageNumber);
        const projection = globalThis.__brevessPdfReaderBridge.command(
          'getPageProjection', pageNumber);
        const source = await globalThis.__brevessPdfReaderBridge.command(
          'readPageTextContent', pageNumber);
        const view = projection?.viewport?.viewBox;
        const rotation = Number(projection?.viewport?.rotation) || 0;
        if (!Array.isArray(view) || view.length !== 4 || !source?.textContent) {
          throw new Error('B4_CANONICAL_PAGE_SOURCE_UNAVAILABLE');
        }
        pages.push(globalThis.SciLLM.createCanonicalPdfPageRecord({
          documentHash: currentContext.documentHash,
          documentGeneration: currentContext.documentGeneration,
          revision: 1,
          pageNumber,
          view,
          rotation,
          textContent: source.textContent,
          textContentOrder: 'reading-order',
          readingOrderContract: 'pdf-reading-order-v1'
        }));
      }
      const nextIndex = globalThis.SciLLM.buildPdfSemanticIndex({
        documentHash: currentContext.documentHash,
        revision: nextRevision,
        pages,
        outline: (currentIndex.headings || []).map(heading => ({
          title: String(heading.normalizedText || heading.rawText || ''),
          pageNumber: Number(heading.pageNumber),
          level: Number(heading.level) || 1
        }))
      });
      if (Number(nextIndex?.document?.revision) !== nextRevision ||
          nextIndex?.document?.pageCount !== currentIndex?.document?.pageCount) {
        throw new Error('B4_FIXTURE_SEMANTIC_REVISION_BUILD_FAILED');
      }
      const target = globalThis.__b4MethodMessageTarget;
      const pageNumber = Number(target?.pageNumber) || 0;
      if (!target || !pageNumber) throw new Error('B4_PENDING_TARGET_MISSING');
      const legacyParagraph = native.structure.paragraphs.find(paragraph =>
        Number(paragraph.pageNumber) === pageNumber);
      if (!legacyParagraph) throw new Error('B4_PENDING_LEGACY_PARAGRAPH_MISSING');
      const scopeBefore = currentNativePdfSemanticAnalysisScope(currentContext);
      const semanticMethodIds = context => {
        const flattened = [];
        const visit = sections => (sections || []).forEach(section => {
          flattened.push(section);
          visit(section.children);
        });
        visit(context?.navigation?.sections || []);
        const root = flattened.find(section =>
          /(?:^|\b)(?:materials?\s*(?:&|and)\s*)?methods?(?:\b|$)|star methods/iu
            .test(String(section.title || '')));
        const ids = new Set();
        const collect = section => {
          (section?.paragraphTargets || []).forEach(item => ids.add(String(item.paragraphId)));
          (section?.children || []).forEach(collect);
        };
        collect(root);
        return ids;
      };
      const methodIdsBefore = semanticMethodIds(currentContext);
      const modeId = 'b4-pending-legacy-llm';
      const category = { categoryId: 'b4_pending', name: 'B4 pending legacy LLM',
        categoryName: 'B4 pending legacy LLM', color: '#F15BB5', confidence: 1 };
      const legacyAnnotation = {
        paragraphId: String(legacyParagraph.paragraphId || `pdf-page-${pageNumber}`),
        start: 0,
        end: String(target.expectedNormalizedQuote || '').length,
        quote: String(target.expectedNormalizedQuote || ''),
        visibleMode: 'inline_highlight', categories: [category], primary: category
      };
      const savedLlm = {
        rawAnalysis: {
          annotations: [legacyAnnotation], rejected: [], readingViewId: modeId,
          documentHash: native.structure.documentHash,
          categories: [category]
        },
        paragraphs: [{ paragraphId: legacyParagraph.paragraphId,
          text: legacyParagraph.text }],
        confidenceThreshold: 0.8
      };
      globalThis.__b4PendingRebindFixture = { currentContext, semanticDocument,
        nextRevision, nextIndex, native, pageNumber, scopeBefore, methodIdsBefore,
        semanticMethodIds, modeId, savedLlm };
      return pageNumber;
    });
    report.checks.pendingRebindPrerequisites = await preparePendingRestorePrerequisites(
      reader, pendingTargetPage);
    persist();
    const semanticReadyLifecycle = await reader.evaluate(async () => {
      const { currentContext, semanticDocument, nextRevision, nextIndex, native,
        pageNumber, scopeBefore, methodIdsBefore, semanticMethodIds, modeId, savedLlm } =
        globalThis.__b4PendingRebindFixture;
      const monitor = { wasPending: true, restoreAppliedCount: 0,
        scrollCallCount: 0, renderCallCount: 0, renderWaitingCount: 0 };
      const originalRenderLlmAnalysis = renderLlmAnalysis;
      const originalScrollIntoView = Element.prototype.scrollIntoView;
      const originalWindowScrollTo = globalThis.scrollTo;
      renderLlmAnalysis = function(...args) {
        const matchesPending = args[0]?.readingViewId === modeId;
        if (matchesPending) monitor.renderCallCount += 1;
        const result = originalRenderLlmAnalysis.apply(this, args);
        if (matchesPending && result?.waitingForSemantic === true) {
          monitor.renderWaitingCount += 1;
        }
        return result;
      };
      Element.prototype.scrollIntoView = function(...args) {
        monitor.scrollCallCount += 1;
        return originalScrollIntoView?.apply(this, args);
      };
      globalThis.scrollTo = function(...args) {
        monitor.scrollCallCount += 1;
        return originalWindowScrollTo?.apply(this, args);
      };
      const observeRestore = () => queueMicrotask(() => {
        const entry = nativePdfLlmHighlightsByMode.get(modeId);
        const pending = Boolean(pendingNativePdfLlmRestore);
        if (monitor.wasPending && !pending && entry?.items?.some(item =>
          item?.locatorKind === 'pdf-semantic' &&
          !String(item?.paragraphId || '').startsWith('pdf-page-'))) {
          monitor.restoreAppliedCount += 1;
        }
        monitor.wasPending = pending;
      });
      document.addEventListener('brevess:pdf-semantic-ready', observeRestore);
      try {
        stageNativePdfLlmRestore(savedLlm, native.structure.documentHash);
        const legacyParagraphBefore = Boolean(pendingNativePdfLlmRestore?.savedLlm
          ?.rawAnalysis?.annotations?.some(item =>
            String(item?.paragraphId || '').startsWith('pdf-page-')));
        const nextSemanticDocument = Object.freeze({
          ...semanticDocument,
          revision: nextRevision,
          index: nextIndex
        });
        let nextCompatibility = null;
        const nextNativeDocument = {
          ...native,
          getSemanticNavigation: () => nextCompatibility?.semanticNavigation || null,
          resolveSemanticHighlight(locator) {
            if (!nextCompatibility ||
                locator?.documentHash !== nextCompatibility.documentHash ||
                locator?.documentGeneration !== nextCompatibility.documentGeneration ||
                locator?.revision !== nextCompatibility.revision ||
                locator?.semanticCacheKey !== nextCompatibility.semanticCacheKey ||
                locator?.semanticProvenanceKey !== nextCompatibility.semanticProvenanceKey) {
              return { status: 'stale', verified: false, precision: 'none',
                ranges: [], fallbackPageAnchors: [], reasonCode: 'PDF_HIGHLIGHT_STALE' };
            }
            return nextCompatibility.resolvePdfSemanticRange(
              locator.paragraphId, locator.normalizedStart, locator.normalizedEnd,
              locator.expectedNormalizedQuote);
          }
        };
        nextCompatibility = globalThis.SciLLM.createPdfSemanticCompatibilityAdapter({
          semanticDocument: nextSemanticDocument,
          nativeDocument: nextNativeDocument,
          getCurrentSemanticDocument: () => globalThis.__brevessPdfSemanticDocument,
          getCurrentNativeDocument: () => globalThis.__brevessNativePdfDocument
        });
        if (!nextCompatibility) {
          throw new Error('B4_FIXTURE_SEMANTIC_REVISION_PUBLISH_FAILED');
        }
        Object.freeze(nextNativeDocument);
        globalThis.__brevessPdfSemanticDocument = nextSemanticDocument;
        globalThis.__brevessNativePdfDocument = nextNativeDocument;
        globalThis.__brevessPdfSemanticCompatibility = nextCompatibility;
        document.dispatchEvent(new CustomEvent('brevess:pdf-semantic-ready', {
          detail: { phase: 'text-ready', revision: nextRevision,
            documentGeneration: currentContext.documentGeneration }
        }));
        await Promise.resolve();
        await new Promise(resolve => requestAnimationFrame(() => resolve()));
        const sample = () => {
          const regexEntry = highlighter.nativePdfModes.get('b4-methods-message-regex');
          const llmEntry = nativePdfLlmHighlightsByMode.get(modeId);
          const page = document.querySelector(
            `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`);
          const regexMarks = page?.querySelectorAll(
            '.pdf-native-regex-hit[data-analysis-mode-id="b4-methods-message-regex"]'
          ).length || 0;
          const llmMarks = page?.querySelectorAll(
            `.pdf-native-automatic-hit[data-analysis-mode-id="${modeId}"]`
          ).length || 0;
          const layers = page?.querySelectorAll(
            `.pdf-native-regex-layer[data-analysis-mode-id="b4-methods-message-regex"],` +
            `.pdf-native-automatic-layer[data-analysis-mode-id="${modeId}"]`
          ).length || 0;
          return { regexEntry, llmEntry, regexMarks, llmMarks, layers,
            totalMarks: regexMarks + llmMarks };
        };
        const first = sample();
        document.dispatchEvent(new CustomEvent('brevess:pdf-semantic-ready', {
          detail: { phase: 'text-ready', revision: nextRevision,
            documentGeneration: currentContext.documentGeneration }
        }));
        await Promise.resolve();
        await new Promise(resolve => requestAnimationFrame(() => resolve()));
        const second = sample();
        const scopeAfter = currentNativePdfSemanticAnalysisScope();
        const nextContext = readPdfSemanticNavigationContext();
        const methodIdsAfter = semanticMethodIds(nextContext);
        const rebound = second.llmEntry?.items?.[0];
        return {
          revisionBefore: Number(currentContext.revision) || 0,
          revisionAfter: Number(nextContext?.revision) || 0,
          methodsOnlyBefore: scopeBefore.semanticParagraphIds.size > 0 &&
            [...scopeBefore.semanticParagraphIds].every(id => methodIdsBefore.has(id)),
          methodsOnlyAfter: scopeAfter.semanticParagraphIds.size > 0 &&
            [...scopeAfter.semanticParagraphIds].every(id => methodIdsAfter.has(id)),
          semanticSelectedBefore: scopeBefore.semanticParagraphIds.size,
          semanticSelectedAfter: scopeAfter.semanticParagraphIds.size,
          scopeStatusAfter: String(scopeAfter?.status || ''),
          scopeReasonAfter: String(scopeAfter?.reasonCode || ''),
          rebuiltHeadingCount: nextIndex.headings?.length || 0,
          rebuiltSectionCount: nextIndex.sections?.length || 0,
          rebuiltMethodTargetCount: methodIdsAfter.size,
          legacyParagraphBefore,
          semanticParagraphAfter: rebound?.locatorKind === 'pdf-semantic' &&
            !String(rebound?.paragraphId || '').startsWith('pdf-page-'),
          restoreAppliedCount: monitor.restoreAppliedCount,
          restoreEnteredRender: monitor.renderCallCount > 0,
          renderCallCount: monitor.renderCallCount,
          renderWaitingCount: monitor.renderWaitingCount,
          pendingAfter: Boolean(pendingNativePdfLlmRestore),
          scrollCallCount: monitor.scrollCallCount,
          layerCountAfterFirstReady: first.layers,
          layerCountAfterSecondReady: second.layers,
          markCountAfterFirstReady: first.totalMarks,
          markCountAfterSecondReady: second.totalMarks,
          regexMapRetained: Boolean(second.regexEntry?.semantic &&
            second.regexEntry?.items?.length),
          llmMapRetained: Boolean(second.llmEntry?.items?.length),
          regexMarkCountAfterSecondReady: second.regexMarks,
          llmMarkCountAfterSecondReady: second.llmMarks,
          revisionTransitionSource: 'production-semantic-builder-fixture'
        };
      } finally {
        document.removeEventListener('brevess:pdf-semantic-ready', observeRestore);
        renderLlmAnalysis = originalRenderLlmAnalysis;
        Element.prototype.scrollIntoView = originalScrollIntoView;
        globalThis.scrollTo = originalWindowScrollTo;
        delete globalThis.__b4PendingRebindFixture;
      }
    });
    semanticReadyLifecycle.prerequisitesAfter = await reader.evaluate(
      readPendingRestorePrerequisites, pendingTargetPage);
    report.checks.semanticReadyPendingRebind = semanticReadyLifecycle;
    report.checks.methodsScope = methods;
    persist();
    assertSemanticReadyLifecycleEvidence(semanticReadyLifecycle);
    assert.equal(methods.semanticSelectedCount, methods.descendantParagraphCount,
      'B4_METHODS_SCOPE_INCOMPLETE');
    assert.equal(semanticReadyLifecycle.semanticSelectedBefore,
      methods.descendantParagraphCount, 'B4_METHODS_SCOPE_INCOMPLETE_BEFORE_REVISION');
    assert.equal(semanticReadyLifecycle.semanticSelectedAfter,
      methods.descendantParagraphCount, 'B4_METHODS_SCOPE_INCOMPLETE_AFTER_REVISION');
    assert.ok(methods.logicalCount > 0 && methods.applyResponseCount > 0 &&
      methods.countResponseCount > 0, 'B4_METHODS_REGEX_EMPTY');
    assert.equal(methods.allHitsAreDescendants, true, 'B4_METHODS_SCOPE_LEAK');
    assert.equal(methods.semanticScopeOnlyMethods, true, 'B4_METHODS_SCOPE_MAPPING_LEAK');
    assert.equal(methods.legacyFallbackUsed, false, 'B4_METHODS_LEGACY_FALLBACK');
    assert.equal(methods.emptyScopeCode, 'ARTICLE_CHAT_SCOPE_EMPTY',
      'B4_EMPTY_SCOPE_NOT_REJECTED');
    assert.equal(methods.emptyScopeTurnDelta, 0, 'B4_EMPTY_SCOPE_CREATED_TURN');
    assert.equal(methods.providerRequestDelta, 0, 'B4_EMPTY_SCOPE_SENT_REQUEST');

    stage = 'LEGACY_PAGE';
    const legacy = await reader.evaluate(async () => {
      const native = globalThis.__brevessNativePdfDocument;
      const pageNumber = 1;
      await globalThis.__b4ShowProjectedPage(pageNumber);
      const paragraph = native.structure.paragraphs.find(item =>
        item.paragraphId === `pdf-page-${pageNumber}` || item.pageNumber === pageNumber);
      const match = /[A-Za-z]{8,}/u.exec(String(paragraph?.text || ''));
      if (!paragraph || !match) return null;
      const modeId = 'b4-legacy-page';
      const item = {
        paragraphId: paragraph.paragraphId,
        pageNumber,
        start: match.index,
        end: match.index + match[0].length,
        quote: match[0],
        visibleMode: 'inline_highlight',
        categories: [{ categoryId: 'b4_legacy', categoryName: 'B4 legacy',
          color: '#F4A261', confidence: 1 }],
        primary: { categoryId: 'b4_legacy', categoryName: 'B4 legacy',
          color: '#F4A261', confidence: 1 }
      };
      const entry = {
        analysisMeta: { readingViewId: modeId, documentHash: native.structure.documentHash },
        categoryMap: { b4_legacy: { categoryId: 'b4_legacy', color: '#F4A261' } },
        documentHash: native.structure.documentHash,
        documentGeneration: native.documentGeneration,
        items: [item]
      };
      const painted = paintNativePdfLlmPage(entry, pageNumber);
      const marks = [...document.querySelectorAll(
        `.pdf-native-automatic-hit[data-analysis-mode-id="${modeId}"]`
      )];
      return { paragraphIdIsLegacy: String(paragraph.paragraphId).startsWith('pdf-page-'),
        painted, markCount: marks.length,
        nonzeroRectCount: marks.filter(mark => {
          const rect = mark.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length };
    });
    assert.ok(legacy?.paragraphIdIsLegacy, 'B4_LEGACY_PARAGRAPH_MISSING');
    assert.ok(legacy.painted > 0 && legacy.nonzeroRectCount > 0,
      'B4_LEGACY_PAGE_NOT_PAINTED');
    report.checks.legacyPdfPage = legacy;

    stage = 'MANUAL_QUAD';
    await reader.evaluate(async () => {
      globalThis.__brevessNativePdfDocument.focusPage(1);
      await globalThis.__brevessPdfReaderBridge.command('updatePageWindow', 1, 1);
    });
    const selection = await selectNativeText(reader);
    assert.ok(selection.characterCount > 0 && selection.rangeCount === 1,
      'B4_MANUAL_SELECTION_EMPTY');
    await reader.locator('#sci-manual-toolbar').waitFor({ state: 'visible', timeout: 10_000 });
    const beforeIds = await reader.evaluate(() =>
      (currentManualDocument?.record?.annotations || [])
        .map(item => String(item.annotationId || '')).filter(Boolean));
    await reader.locator('#sci-manual-toolbar .sci-manual-category').first().click();
    await reader.waitForFunction(prior =>
      (currentManualDocument?.record?.annotations || []).some(item =>
        item?.annotationId && !prior.includes(String(item.annotationId))),
    beforeIds, { timeout: 15_000 });
    const manual = await reader.evaluate(prior => {
      const annotation = (currentManualDocument?.record?.annotations || []).find(item =>
        item?.annotationId && !prior.includes(String(item.annotationId)));
      const serialized = annotation ? SciLLM.serializePdfHighlight(annotation) : null;
      const marks = annotation ? [...document.querySelectorAll(
        `.pdf-native-annotation-hit[data-annotation-id="${CSS.escape(annotation.annotationId)}"]`
      )] : [];
      return {
        anchorKind: String(annotation?.pdfAnchor?.anchorKind || annotation?.anchorKind || ''),
        pageNumber: Number(serialized?.pageIndex) + 1 || 0,
        quadPointCount: Array.from(serialized?.quadPoints || []).length,
        quadCount: Math.floor(Array.from(serialized?.quadPoints || []).length / 8),
        markCount: marks.length,
        nonzeroRectCount: marks.filter(mark => {
          const rect = mark.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length
      };
    }, beforeIds);
    assert.equal(manual.anchorKind, 'pdf_quad', 'B4_MANUAL_ANCHOR_NOT_QUAD');
    assert.ok(manual.quadPointCount >= 8 && manual.quadPointCount % 8 === 0,
      'B4_MANUAL_QUAD_POINTS_INVALID');
    assert.ok(manual.markCount > 0 && manual.nonzeroRectCount > 0,
      'B4_MANUAL_QUAD_MARK_EMPTY');
    report.checks.manualQuad = manual;

    if (normalized.apiMode === 'real-api') {
      const realApiBaseline = proxy.state.calls;
      const realApiSmoke = {
        profile: {},
        autoHighlight: { responseSuccess: false, providerRequestDelta: 0,
          browserHttpRequestDelta: 0, mapItemCount: 0, markCount: 0,
          nonzeroRectCount: 0 },
        qaHighlight: { responseSuccess: false, providerRequestDelta: 0,
          browserHttpRequestDelta: 0, mapItemCount: 0, markCount: 0,
          nonzeroRectCount: 0, turn: redactRealApiTurnDiagnostic() },
        totalProviderRequestDelta: 0
      };
      report.checks.realApiSmoke = realApiSmoke;

      stage = 'REAL_API_PROFILE';
      const profileSetup = await setupRealApiProfile(reader, normalized.model);
      const profileId = String(profileSetup?.profileId || '');
      realApiSmoke.profile = profileSetup?.diagnostic || {};
      persist();
      assert.equal(realApiSmoke.profile.stored, true, 'B4_REAL_API_PROFILE_NOT_STORED');
      assert.equal(realApiSmoke.profile.credentialPresent, true,
        'B4_REAL_API_PROFILE_CREDENTIAL_MISSING');
      assert.equal(realApiSmoke.profile.llmReady, true, 'B4_REAL_API_PROFILE_NOT_READY');
      assert.equal(realApiSmoke.profile.effectiveMode, 'llm', 'B4_REAL_API_MODE_NOT_ACTIVE');
      assert.equal(realApiSmoke.profile.routes?.documentHighlight?.effectiveProfileMatches,
        true, 'B4_REAL_API_AUTO_ROUTE_MISMATCH');
      assert.equal(realApiSmoke.profile.routes?.articleChat?.effectiveProfileMatches,
        true, 'B4_REAL_API_CHAT_ROUTE_MISMATCH');

      stage = 'REAL_API_AUTO_HIGHLIGHT';
      const autoProviderBefore = proxy.state.calls;
      const autoHttpBefore = report.network.browserHttpRequests;
      const autoResponse = await sendTabMessage(worker, readerTabId, {
        action: 'analyzeArticleWithLLM'
      });
      const autoRoute = autoResponse?.analysis?.route || {};
      const autoRendering = await reader.evaluate(async () => {
        const modeId = String(lastLlmAnalysis?.rawAnalysis?.readingViewId || '');
        const entry = nativePdfLlmHighlightsByMode.get(modeId);
        const pageNumber = Number((entry?.items || []).flatMap(item =>
          Array.isArray(item?.pageNumbers) ? item.pageNumbers : [item?.pageNumber]
        ).find(Number.isSafeInteger)) || 0;
        if (pageNumber > 0) {
          await globalThis.__brevessPdfReaderBridge.command(
            'updatePageWindow', pageNumber, pageNumber);
          paintNativePdfLlmPage(entry, pageNumber);
          await new Promise(resolve => requestAnimationFrame(() => resolve()));
        }
        const selector = modeId
          ? `.pdf-native-automatic-hit[data-analysis-mode-id="${CSS.escape(modeId)}"]`
          : '.b4-real-api-mode-missing';
        const marks = [...document.querySelectorAll(selector)];
        return {
          modePresent: Boolean(modeId),
          mapItemCount: entry?.items?.length || 0,
          mapAnnotationCount: entry?.annotations?.length || 0,
          renderedPageNumber: pageNumber,
          markCount: marks.length,
          nonzeroRectCount: marks.filter(mark => {
            const rect = mark.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }).length
        };
      });
      Object.assign(realApiSmoke.autoHighlight, autoRendering, {
        responseSuccess: autoResponse?.success === true,
        responseCode: String(autoResponse?.code || autoResponse?.error?.code || '').slice(0, 100),
        responseError: redactDiagnosticText(
          typeof autoResponse?.error === 'string'
            ? autoResponse.error : autoResponse?.error?.message
        ),
        responseHighlightedCount: Number(autoResponse?.highlightedCount) || 0,
        providerRequestDelta: proxy.state.calls - autoProviderBefore,
        browserHttpRequestDelta: report.network.browserHttpRequests - autoHttpBefore,
        route: {
          taskType: String(autoRoute?.taskType || '').slice(0, 80),
          effectiveProfileId: String(autoRoute?.effectiveProfileId || '').slice(0, 100),
          providerId: String(autoRoute?.providerId || '').slice(0, 80),
          model: String(autoRoute?.model || '').slice(0, 160),
          capabilityMode: String(autoRoute?.capabilityMode || '').slice(0, 80)
        }
      });
      report.network.providerCalls = proxy.state.calls;
      persist();

      stage = 'REAL_API_QA_SCOPE';
      const realMethodsSelection = await sendTabMessage(
        worker, readerTabId, methodPlan.messages[1]);
      assert.equal(realMethodsSelection?.success, true,
        'B4_REAL_API_METHODS_RESELECT_FAILED');
      const qaScope = await reader.evaluate(() => {
        const context = readPdfSemanticNavigationContext();
        const scope = currentNativePdfSemanticAnalysisScope();
        const flattened = [];
        const visit = (sections, ancestorMethods = false) => (sections || []).forEach(section => {
          const title = String(section?.title || '');
          const isMethods = ancestorMethods ||
            /(?:^|\b)(?:materials?\s*(?:&|and)\s*)?methods?(?:\b|$)|star methods/iu
              .test(title);
          flattened.push({ section, isMethods });
          visit(section?.children, isMethods);
        });
        visit(context?.navigation?.sections || []);
        const methodIds = new Set(flattened.filter(item => item.isMethods)
          .flatMap(item => item.section?.paragraphTargets || [])
          .map(target => String(target?.paragraphId || '')).filter(Boolean));
        const selectedTargets = flattened.flatMap(item => item.section?.paragraphTargets || [])
          .filter(target => scope?.semanticParagraphIds?.has(String(target?.paragraphId || '')));
        let phrase = '';
        for (const target of selectedTargets) {
          const words = String(target?.expectedNormalizedQuote || '')
            .match(/[A-Za-z][A-Za-z0-9'-]*/gu) || [];
          if (words.length < 7) continue;
          phrase = words.slice(0, Math.min(10, words.length)).join(' ');
          if (phrase.length >= 35) break;
        }
        return {
          phrase,
          diagnostic: {
            revision: Number(context?.revision) || 0,
            status: String(scope?.status || ''),
            reasonCode: String(scope?.reasonCode || ''),
            canonicalSelectedCount: scope?.canonicalParagraphIds?.size || 0,
            semanticSelectedCount: scope?.semanticParagraphIds?.size || 0,
            methodsParagraphCount: methodIds.size,
            selectedTargetCount: selectedTargets.length,
            methodsOnly: scope?.semanticParagraphIds?.size > 0 &&
              [...scope.semanticParagraphIds].every(id => methodIds.has(String(id))),
            phraseAvailable: Boolean(phrase)
          }
        };
      });
      realApiSmoke.qaHighlight.scope = qaScope.diagnostic;
      persist();
      assert.equal(qaScope.diagnostic.status, 'ready', 'B4_REAL_API_QA_SCOPE_NOT_READY');
      assert.equal(qaScope.diagnostic.methodsOnly, true, 'B4_REAL_API_QA_SCOPE_LEAK');
      assert.equal(qaScope.diagnostic.phraseAvailable, true,
        'B4_REAL_API_QA_PHRASE_UNAVAILABLE');

      stage = 'REAL_API_QA_SUBMIT';
      const qaProviderBefore = proxy.state.calls;
      const qaHttpBefore = report.network.browserHttpRequests;
      const submission = await sendTabMessage(worker, readerTabId, {
        action: 'highlightArticleMatchesWithLLM',
        question: `Find and highlight direct evidence containing this exact phrase: ${qaScope.phrase}`,
        profileId,
        categoryId: 'semantic_match',
        categoryName: 'B4 real API match',
        highlightColor: '#2F80ED'
      });
      const turnId = String(submission?.turn?.turnId || '');
      realApiSmoke.qaHighlight.responseSuccess = submission?.success === true;
      realApiSmoke.qaHighlight.queued = submission?.queued === true;
      realApiSmoke.qaHighlight.turn = redactRealApiTurnDiagnostic(submission?.turn);
      realApiSmoke.qaHighlight.submissionCode = String(
        submission?.code || submission?.error?.code || '').slice(0, 100);
      realApiSmoke.qaHighlight.submissionError = redactDiagnosticText(
        typeof submission?.error === 'string' ? submission.error : submission?.error?.message
      );
      persist();
      assert.ok(turnId, 'B4_REAL_API_TURN_NOT_CREATED');

      stage = 'REAL_API_QA_WAIT';
      try {
        await reader.waitForFunction(targetTurnId => {
          const turn = articleChatState.turns.find(item => item.turnId === targetTurnId);
          return ['completed', 'truncated', 'incomplete', 'error', 'unanswered', 'cancelled']
            .includes(String(turn?.status || ''));
        }, turnId, { timeout: 300_000 });
      } finally {
        const turnSnapshot = await reader.evaluate(targetTurnId => {
          const turn = articleChatState.turns.find(item => item.turnId === targetTurnId);
          return turn ? {
            turnId: turn.turnId, status: turn.status, intent: turn.intent,
            errorCode: turn.errorCode, error: turn.error,
            selectedProfileId: turn.selectedProfileId, profileName: turn.profileName,
            model: turn.model, route: turn.route, matchCount: turn.matchCount,
            degradedCount: turn.degradedCount, unresolvedCount: turn.unresolvedCount,
            highlightError: turn.highlightError,
            highlightReasonCodes: turn.highlightReasonCodes
          } : null;
        }, turnId).catch(() => null);
        realApiSmoke.qaHighlight.turn = redactRealApiTurnDiagnostic(turnSnapshot || {
          turnId, status: 'unavailable', intent: 'highlight'
        });
        realApiSmoke.qaHighlight.providerRequestDelta = proxy.state.calls - qaProviderBefore;
        realApiSmoke.qaHighlight.browserHttpRequestDelta =
          report.network.browserHttpRequests - qaHttpBefore;
        report.network.providerCalls = proxy.state.calls;
        persist();
      }

      stage = 'REAL_API_QA_RENDER';
      const qaRendering = await reader.evaluate(async targetTurnId => {
        const entry = nativePdfSemanticChatHighlightsByTurn.get(targetTurnId);
        const pageNumber = Number((entry?.items || []).flatMap(item => item?.pageNumbers || [])
          .find(Number.isSafeInteger)) || 0;
        if (pageNumber > 0) {
          await globalThis.__brevessPdfReaderBridge.command(
            'updatePageWindow', pageNumber, pageNumber);
          paintNativePdfSemanticChatPage(entry, pageNumber);
          await new Promise(resolve => requestAnimationFrame(() => resolve()));
        }
        const selector = `.pdf-native-semantic-chat-hit[data-analysis-mode-id="${
          CSS.escape(targetTurnId)}"]`;
        const marks = [...document.querySelectorAll(selector)];
        return {
          mapItemCount: entry?.items?.length || 0,
          renderedPageNumber: pageNumber,
          markCount: marks.length,
          nonzeroRectCount: marks.filter(mark => {
            const rect = mark.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }).length
        };
      }, turnId);
      Object.assign(realApiSmoke.qaHighlight, qaRendering);
      realApiSmoke.totalProviderRequestDelta = proxy.state.calls - realApiBaseline;
      report.network.providerCalls = proxy.state.calls;
      persist();
      stage = 'REAL_API_ASSERT';
      assertRealApiSmokeEvidence(realApiSmoke);
      report.execution.productionApiValidated = true;
      persist();
    } else {
      assert.equal(report.network.browserHttpRequests, 0, 'B4_FIXTURE_NETWORK_DETECTED');
      report.checks.offlineFixtureBoundary = {
        providerCalls: 0,
        savedAnswerUsed: false,
        productionApiValidated: false
      };
    }

    stage = 'FINAL';
    assert.equal(report.diagnostics.pageErrors, 0, 'B4_PAGE_ERROR');
    assert.equal(report.diagnostics.consoleErrors, 0, 'B4_CONSOLE_ERROR');
    assert.equal(report.diagnostics.workerErrors, 0, 'B4_WORKER_ERROR');
    report.status = 'PASS';
    persist();
    return report;
  } catch (error) {
    report.status = 'FAIL';
    report.failureStage = stage;
    report.failureCode = safeCode(error);
    if (error.prerequisites) report.checks.pendingRebindPrerequisites = error.prerequisites;
    persist();
    throw error;
  } finally {
    secret = '';
    await context?.close().catch(() => undefined);
    if (proxy?.server) await new Promise(resolve => proxy.server.close(resolve));
    removeTemporary(temporaryRoot, 'brevess-pdf-semantic-b4-');
  }
}

const directExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directExecution) {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${helpText()}\n`);
  } else {
    run(normalizeOptions(process.argv.slice(2))).then(report => {
      process.stdout.write(`${JSON.stringify({
        status: report.status,
        apiMode: report.execution.apiMode,
        productionApiValidated: report.execution.productionApiValidated,
        pdfSha256: report.source.pdfSha256,
        checks: Object.keys(report.checks)
      }, null, 2)}\n`);
    }).catch(error => {
      process.stderr.write(`FAIL ${safeCode(error)}\n`);
      if (args.debug === true || process.env.SCI_PDF_SEMANTIC_B4_DEBUG === '1') {
        process.stderr.write(`${String(error?.stack || error)}\n`);
      }
      process.exitCode = 1;
    });
  }
}

export { run, safeCode };
