// Real TypeSafe Jev browser acceptance. This always uses the official API through a
// loopback credential boundary; there is deliberately no mock or replay mode.
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

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const officialOrigin = 'https://api.typesafe.ai';
const decisionPath = '/v1/systemone';
const modelsPath = '/v1/models';
const configuredModel = 'jev-1.13.0';
const dummySecret = 'typesafe-acceptance-dummy-key';
const defaultCallCap = 60;
const requestTimeoutMs = 120_000;
const uiTimeoutMs = 8 * 60_000;
const maximumPayloadBytes = 4 * 1024 * 1024;
const temporaryPrefix = 'brevess-typesafe-highlighting-';
const customCategoryId = 'custom_explicit_increase';

const sourceSentences = Object.freeze({
  question: 'The study asks whether compound Q improves signal recovery in cultured astrocytes.',
  method: 'We quantified signal recovery with blinded fluorescence imaging and a preregistered mixed-effects model.',
  positiveEnglish: 'The authors explicitly report that compound Q clearly increased signal recovery by 28 percent compared with the vehicle control.',
  positiveChinese: '作者明确报告增加了处理组的信号恢复率，而匹配的载体对照组保持稳定。',
  negative: 'Compound Q did not increase signal recovery in the confirmatory cohort.',
  boundary: 'These synthetic sentences are ground truth for software acceptance only and are not a scientific benchmark.'
});

function safeError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function safeErrorCode(error) {
  const value = String(error?.code || '');
  return /^[A-Z][A-Z0-9_]{2,100}$/u.test(value)
    ? value : 'TYPESAFE_HIGHLIGHTING_ACCEPTANCE_FAILED';
}

function parseArguments(argv) {
  const result = { headed: false };
  const valued = new Set(['--extension-root', '--output-dir', '--call-cap']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--headed') {
      result.headed = true;
      continue;
    }
    if (!valued.has(flag)) throw safeError('TYPESAFE_ACCEPTANCE_ARGUMENT_INVALID');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw safeError('TYPESAFE_ACCEPTANCE_ARGUMENT_INVALID');
    }
    result[flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  const callCap = Number(result.callCap || defaultCallCap);
  if (!Number.isSafeInteger(callCap) || callCap < 2 || callCap > defaultCallCap) {
    throw safeError('TYPESAFE_ACCEPTANCE_CALL_CAP_INVALID');
  }
  result.callCap = callCap;
  return result;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/gu, '-');
}

function createNewOutputDirectory(requested) {
  const directory = path.resolve(requested || path.join(
    repositoryRoot, 'output', 'playwright',
    `typesafe-highlighting-${timestampSlug()}-${crypto.randomBytes(3).toString('hex')}`
  ));
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  if (fs.existsSync(directory)) throw safeError('TYPESAFE_ACCEPTANCE_OUTPUT_EXISTS');
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  return directory;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600
  });
}

function redact(value, secret) {
  const text = String(value || '');
  return secret ? text.replaceAll(secret, '[REDACTED]') : text;
}

function readBoundedRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maximumPayloadBytes) {
        request.destroy();
        reject(safeError('TYPESAFE_ACCEPTANCE_REQUEST_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks, size).toString('utf8')));
    request.on('error', () => reject(safeError('TYPESAFE_ACCEPTANCE_PROXY_READ_FAILED')));
  });
}

async function readBoundedResponse(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const value = await response.text();
    if (byteLength(value) > maximumPayloadBytes) {
      throw safeError('TYPESAFE_ACCEPTANCE_RESPONSE_TOO_LARGE');
    }
    return value;
  }
  const chunks = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > maximumPayloadBytes) {
      await reader.cancel().catch(() => {});
      throw safeError('TYPESAFE_ACCEPTANCE_RESPONSE_TOO_LARGE');
    }
    chunks.push(Buffer.from(item.value));
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

function fixtureHtml() {
  const section = (heading, ids) => `<section><h2>${heading}</h2>${ids.map(id =>
    `<p id="${id}">${sourceSentences[id]}</p>`).join('\n')}</section>`;
  const paragraphs = [section('Introduction', ['question']), section('Methods', ['method']),
    section('Results', ['positiveEnglish', 'positiveChinese', 'negative']),
    section('Discussion', ['boundary'])].join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <title>TypeSafe Jev synthetic highlighting acceptance</title>
    <meta name="citation_title" content="TypeSafe Jev synthetic highlighting acceptance">
    <meta name="citation_doi" content="10.0000/brevess.typesafe.synthetic">
    <link rel="icon" href="data:,">
    <style>body{font:18px/1.72 Arial,sans-serif;margin:36px;color:#18212a}
      article{max-width:920px;margin:auto}h1{line-height:1.2}</style></head>
    <body><main><article><h1>TypeSafe Jev synthetic highlighting acceptance</h1>
    ${paragraphs}
    </article></main></body></html>`;
}

function safeRequestRecord(body, pathName) {
  if (pathName === modelsPath) return { endpoint: modelsPath, method: 'GET' };
  const questions = body?.questions && typeof body.questions === 'object'
    ? body.questions : {};
  return {
    endpoint: decisionPath,
    method: 'POST',
    model: String(body?.model || ''),
    state: body?.state ?? null,
    questions,
    questionCount: Object.keys(questions).length,
    questionTypes: [...new Set(Object.values(questions).map(question => question?.type || ''))]
  };
}

function safeResponseRecord(body, pathName) {
  let value;
  try { value = JSON.parse(body); } catch (_) { return { validJson: false }; }
  if (pathName === modelsPath) {
    const items = Array.isArray(value) ? value
      : Array.isArray(value?.data) ? value.data
        : Array.isArray(value?.models) ? value.models : [];
    return {
      validJson: true,
      modelIds: items.map(item => typeof item === 'string'
        ? item : String(item?.id || item?.name || '')).filter(Boolean).slice(0, 500)
    };
  }
  return {
    validJson: true,
    model: String(value?.model || ''),
    answers: value?.answers && typeof value.answers === 'object' ? value.answers : {},
    usage: value?.usage && typeof value.usage === 'object' ? value.usage : null
  };
}

async function startProxy({ getSecret, report, persist, callCap, sourceHtml }) {
  const server = http.createServer(async (request, reply) => {
    reply.setHeader('Access-Control-Allow-Origin', '*');
    reply.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,accept');
    if (request.method === 'OPTIONS') {
      reply.writeHead(204);
      reply.end();
      return;
    }
    if (request.method === 'GET' && request.url === '/fixture/article.html') {
      reply.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      reply.end(sourceHtml);
      return;
    }

    let record = null;
    try {
      const remoteAddress = String(request.socket.remoteAddress || '');
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress)) {
        throw safeError('TYPESAFE_ACCEPTANCE_PROXY_REMOTE_REJECTED');
      }
      const pathName = String(request.url || '').split('?')[0];
      if (![decisionPath, modelsPath].includes(pathName) ||
          (pathName === decisionPath && request.method !== 'POST') ||
          (pathName === modelsPath && request.method !== 'GET') ||
          request.headers.authorization !== `Bearer ${dummySecret}`) {
        throw safeError('TYPESAFE_ACCEPTANCE_PROXY_BOUNDARY_REJECTED');
      }
      if (report.api.calls.length >= callCap) {
        report.api.callCapRejected = true;
        persist();
        reply.writeHead(429, { 'Content-Type': 'application/json' });
        reply.end(JSON.stringify({ error: { code: 'TYPESAFE_ACCEPTANCE_CALL_CAP' } }));
        return;
      }
      const requestText = pathName === decisionPath ? await readBoundedRequest(request) : '';
      let requestBody = null;
      if (requestText) {
        try { requestBody = JSON.parse(requestText); }
        catch (_) { throw safeError('TYPESAFE_ACCEPTANCE_REQUEST_INVALID'); }
      }
      if (pathName === decisionPath && String(requestBody?.model || '') !== configuredModel) {
        throw safeError('TYPESAFE_ACCEPTANCE_MODEL_MISMATCH');
      }
      const safeRequest = safeRequestRecord(requestBody, pathName);
      record = {
        sequence: report.api.calls.length + 1,
        endpoint: `${officialOrigin}${pathName}`,
        request: safeRequest,
        requestBytes: byteLength(requestText),
        requestSha256: sha256(requestText),
        status: null,
        elapsedMs: null,
        responseBytes: null,
        responseSha256: ''
      };
      report.api.calls.push(record);
      persist();

      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      let providerResponse;
      let responseText;
      try {
        providerResponse = await fetch(`${officialOrigin}${pathName}`, {
          method: request.method,
          headers: {
            Accept: 'application/json',
            ...(pathName === decisionPath ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${getSecret()}`
          },
          ...(requestText ? { body: requestText } : {}),
          signal: controller.signal
        });
        responseText = await readBoundedResponse(providerResponse);
      } finally {
        clearTimeout(timer);
      }
      record.status = providerResponse.status;
      record.elapsedMs = Date.now() - startedAt;
      record.responseBytes = byteLength(responseText);
      record.responseSha256 = sha256(responseText);
      record.response = safeResponseRecord(responseText, pathName);
      report.api.realCalls += 1;
      if (pathName === modelsPath) report.api.modelCalls += 1;
      else report.api.decisionCalls += 1;
      persist();
      reply.writeHead(providerResponse.status, {
        'Content-Type': providerResponse.headers.get('Content-Type') || 'application/json'
      });
      reply.end(responseText);
    } catch (error) {
      const code = safeErrorCode(error);
      if (record) record.errorCode = code;
      report.errors.push(code);
      persist();
      if (!reply.headersSent) reply.writeHead(502, { 'Content-Type': 'application/json' });
      reply.end(JSON.stringify({ error: { code } }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

function copyExtension(extensionRoot, temporaryExtension, proxyPort) {
  fs.mkdirSync(temporaryExtension, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales',
    'cmaps', 'standard_fonts']) {
    const source = path.join(extensionRoot, directory);
    if (fs.existsSync(source)) {
      fs.cpSync(source, path.join(temporaryExtension, directory), { recursive: true });
    }
  }
  for (const file of fs.readdirSync(extensionRoot)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(extensionRoot, file), path.join(temporaryExtension, file));
    }
  }
  fs.writeFileSync(path.join(temporaryExtension, 'typesafe-acceptance-rpc.html'),
    '<!doctype html><meta charset="utf-8"><title>TypeSafe acceptance RPC</title>', 'utf8');
  const workerFile = path.join(temporaryExtension, 'offscreen-network-worker.js');
  const prefix = `const __typesafeAcceptanceFetch = globalThis.fetch.bind(globalThis);\n` +
    `const __typesafeAcceptanceOrigin = ${JSON.stringify(officialOrigin)};\n` +
    `const __typesafeAcceptancePaths = new Set(${JSON.stringify([decisionPath, modelsPath])});\n` +
    `globalThis.fetch = (input, init) => {\n` +
    `  const parsed = new URL(typeof input === 'string' ? input : input.url);\n` +
    `  if (parsed.origin !== __typesafeAcceptanceOrigin ||\n` +
    `      !__typesafeAcceptancePaths.has(parsed.pathname) || parsed.search || parsed.hash) {\n` +
    `    throw new Error('TYPESAFE_ACCEPTANCE_UNEXPECTED_NETWORK_TARGET');\n` +
    `  }\n` +
    `  return __typesafeAcceptanceFetch('http://127.0.0.1:${proxyPort}' + parsed.pathname, init);\n` +
    `};\n`;
  fs.writeFileSync(workerFile, prefix + fs.readFileSync(workerFile, 'utf8'), 'utf8');
}

function safeRemoveTemporary(directory) {
  const resolved = path.resolve(directory);
  const tempRoot = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith(temporaryPrefix)) {
    throw safeError('TYPESAFE_ACCEPTANCE_TEMP_CONTAINMENT_FAILED');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function closeBrowserContextBounded(context, timeoutMs = 10_000) {
  if (!context) return { attempted: false, timedOut: false };
  let timer;
  let closeError = '';
  const close = Promise.resolve()
    .then(() => context.close())
    .catch(error => { closeError = safeErrorCode(error); });
  const timedOut = await Promise.race([
    close.then(() => false),
    new Promise(resolve => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    })
  ]);
  clearTimeout(timer);
  if (timedOut) {
    // A stuck Playwright transport must not prevent the FAIL report from being returned.
    Promise.resolve(context.browser()?.close()).catch(() => {});
  }
  return { attempted: true, timedOut, ...(closeError ? { errorCode: closeError } : {}) };
}

async function captureFailureScreenshotBounded(page, report, timeoutMs = 7_500) {
  const artifact = 'settings-failure.png';
  const screenshotPath = path.join(report.outputDirectory, artifact);
  if (!page || page.isClosed()) {
    return { attempted: false, captured: false, reason: 'settings_page_unavailable' };
  }
  let timer;
  let screenshotError = '';
  const screenshot = page.screenshot({
    path: screenshotPath,
    fullPage: true,
    timeout: timeoutMs
  }).then(() => false).catch(error => {
    screenshotError = safeErrorCode(error);
    return false;
  });
  const timedOut = await Promise.race([
    screenshot,
    new Promise(resolve => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    })
  ]);
  clearTimeout(timer);
  const captured = !timedOut && !screenshotError && fs.existsSync(screenshotPath);
  return {
    attempted: true,
    captured,
    timedOut,
    artifact,
    credentialSafety: 'extension contains the fixed dummy credential only',
    ...(captured ? { sha256: sha256(fs.readFileSync(screenshotPath)) } : {}),
    ...(screenshotError ? { errorCode: screenshotError } : {})
  };
}

async function closeServerBounded(server, timeoutMs = 5_000) {
  if (!server) return { attempted: false, timedOut: false };
  server.unref?.();
  server.closeIdleConnections?.();
  let timer;
  let closeError = '';
  const close = new Promise(resolve => {
    try {
      server.close(error => {
        if (error) closeError = safeErrorCode(error);
        resolve(false);
      });
    } catch (error) {
      closeError = safeErrorCode(error);
      resolve(false);
    }
  });
  const timedOut = await Promise.race([
    close,
    new Promise(resolve => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    })
  ]);
  clearTimeout(timer);
  if (timedOut) server.closeAllConnections?.();
  return { attempted: true, timedOut, ...(closeError ? { errorCode: closeError } : {}) };
}

async function extensionRpc(page, message) {
  const response = await page.evaluate(async value => chrome.runtime.sendMessage(value), message);
  assert.equal(response?.success, true,
    `${message.type} failed: ${JSON.stringify(response?.error || {})}`);
  return response.data;
}

async function contentRpc(worker, tabId, message) {
  const response = await worker.evaluate(async ({ id, value }) =>
    chrome.tabs.sendMessage(id, value), { id: tabId, value: message });
  assert.equal(response?.success, true,
    `${message.action} failed: ${JSON.stringify(response || {})}`);
  return response;
}

async function waitForDiagnostics(worker, tabId, report, popup, callsBefore) {
  const deadline = Date.now() + uiTimeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await contentRpc(worker, tabId, { action: 'getLlmDiagnostics' });
    report.liveAnalysis = {
      diagnostics: last.diagnostics,
      popup: await popup.evaluate(() => ({
        targetTabId: activePanelTabContext.tabId, prepareState, analysisMode,
        hasPreparedDocument: Boolean(preparedDocumentState),
        button: document.getElementById('applyHighlight')?.textContent,
        notifications: sidePanelNotificationHistory.slice(0, 5)
      }))
    };
    writeJson(path.join(report.outputDirectory, 'report.json'), report);
    if (last?.diagnostics?.stage === 'complete') return last.diagnostics;
    if (last?.diagnostics?.stage === 'error') {
      throw safeError('TYPESAFE_ACCEPTANCE_ANALYSIS_ERROR');
    }
    if (Date.now() > deadline - uiTimeoutMs + 45_000 && report.api.decisionCalls === callsBefore) {
      throw safeError('TYPESAFE_ACCEPTANCE_NO_ANALYSIS_DISPATCH');
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw safeError('TYPESAFE_ACCEPTANCE_ANALYSIS_TIMEOUT', { last });
}

async function waitForCall(page, predicate, timeout = uiTimeoutMs) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await page.waitForTimeout(100);
  }
  throw safeError('TYPESAFE_ACCEPTANCE_API_CALL_TIMEOUT');
}

function customCategoryFrom(seed) {
  const includeWhen = [
    'The source sentence explicitly reports a measured increase, rise, gain, or improvement.',
    'The sentence states the increased outcome and the comparison or baseline.'
  ];
  const excludeWhen = [
    'Exclude negated increases, including did not increase, no increase, or failed to increase.',
    'Exclude plans, hypotheses, questions, and unsupported interpretations.'
  ];
  const positiveExamples = [
    sourceSentences.positiveEnglish,
    sourceSentences.positiveChinese
  ];
  const negativeExamples = [sourceSentences.negative];
  return {
    ...seed,
    categoryId: customCategoryId,
    name: '明确报告增加',
    definition: 'An explicit source statement that a measured outcome increased relative to a comparison or baseline.',
    decisionQuestion: 'Does this exact sentence explicitly report that a measured outcome increased?',
    includeAll: includeWhen,
    includeWhen,
    excludeAny: excludeWhen,
    excludeWhen,
    positiveExamples,
    negativeExamples,
    hardNegativeExamples: negativeExamples,
    allowedQuoteRoles: ['statement'],
    requiredSlots: [],
    spanPolicy: 'sentence',
    claimMode: 'explicit',
    relationRequired: false,
    minimumConfidence: 0.8,
    prompt: {
      ...(seed?.prompt || {}),
      definition: 'An explicit source statement that a measured outcome increased relative to a comparison or baseline.',
      decisionQuestion: 'Does this exact sentence explicitly report that a measured outcome increased?',
      includeWhen,
      excludeWhen,
      positiveExamples,
      negativeExamples,
      requiredSlots: [],
      allowedQuoteRoles: ['statement'],
      spanPolicy: 'sentence',
      claimMode: 'explicit',
      relationRequired: false,
      minimumConfidence: 0.8
    },
    enabledEngines: ['llm'],
    color: '#7C3AED',
    persistence: 'saved',
    builtIn: false
  };
}

async function configureCategories(rpcPage, report) {
  const settingsState = await extensionRpc(rpcPage, { type: 'LLM_GET_SETTINGS' });
  const seed = await extensionRpc(rpcPage, { type: 'CATEGORY_GET', categoryId: 'method' });
  const custom = customCategoryFrom(seed.category);
  await extensionRpc(rpcPage, { type: 'LLM_SAVE_CUSTOM_CATEGORY', category: custom });
  const categoryIds = ['scientific_question', 'method', customCategoryId];
  const analysisModes = settingsState.settings.analysisModes.map(mode =>
    mode.id === 'quick_story' ? { ...mode, categoryIds } : mode);
  await extensionRpc(rpcPage, {
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: {
      mode: 'llm',
      consentGranted: true,
      readingViewId: 'quick_story',
      selectedCategoryIds: categoryIds,
      analysisModes
    }
  });
  report.categoryGroundTruth = {
    categoryIds,
    custom: {
      categoryId: custom.categoryId,
      name: custom.name,
      definition: custom.definition,
      decisionQuestion: custom.decisionQuestion,
      positiveExamples: custom.positiveExamples,
      hardNegativeExamples: custom.hardNegativeExamples
    }
  };
}

async function configureThroughSettingsUi(page, report, markStage) {
  markStage('settings_onboarding_api_entry');
  await page.locator('#overviewConfigureApi').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.body.classList.contains('is-onboarding'));
  await page.locator('#overviewConfigureApi').click();
  await page.waitForFunction(() =>
    document.body.dataset.activeSettingsPage === 'models' &&
    document.body.dataset.onboardingStep === 'api');

  markStage('settings_onboarding_back_to_overview');
  await page.locator('#onboardingBack').click();
  await page.waitForFunction(() => document.body.dataset.activeSettingsPage === 'overview');

  markStage('settings_normal_models_navigation');
  await page.locator('[data-settings-nav="models"]').click();
  await page.waitForFunction(() =>
    document.body.dataset.activeSettingsPage === 'models' &&
    document.body.classList.contains('is-onboarding'));
  report.settingsNavigation = {
    openedFirstRunOnboarding: true,
    usedOnboardingBack: true,
    usedNormalModelsNavigation: true
  };

  markStage('settings_ui_ready');
  await page.locator('#addApiProfile').waitFor({ timeout: 30_000 });
  const previousProfiles = await page.locator('[data-profile-id]').count();
  markStage('settings_profile_create');
  await page.locator('#addApiProfile').click();
  await page.waitForFunction(count =>
    document.querySelectorAll('[data-profile-id]').length > count, previousProfiles);
  const profileId = await page.locator('[data-profile-id][aria-selected="true"]')
    .getAttribute('data-profile-id');
  assert.match(profileId, /^profile_[a-z0-9_]{3,80}$/u);

  await page.locator('#profileName').fill('TypeSafe Jev synthetic acceptance');
  await page.locator('#providerId').selectOption('typesafe');
  await page.waitForFunction(() => document.getElementById('typesafeScopeHint')?.hidden === false);
  const scopeHint = (await page.locator('#typesafeScopeHint').innerText()).trim();
  assert.match(scopeHint, /文本类别识别/u);
  assert.match(scopeHint, /不支持生成问答、笔记或解图/u);
  await page.locator('#apiKey').fill(dummySecret);

  markStage('settings_model_discovery');
  await page.waitForFunction(() => document.getElementById('refreshModels')?.disabled === false);
  const modelCallsBefore = report.api.modelCalls;
  await page.locator('#refreshModels').click();
  await page.waitForFunction(() =>
    document.getElementById('modelDiscoveryStatus')?.dataset.state === 'success',
  null, { timeout: requestTimeoutMs + 30_000 });
  await waitForCall(page, () => report.api.modelCalls > modelCallsBefore);
  const discoveredModels = await page.locator('#modelSuggestionsSelect option')
    .evaluateAll(options => options.map(option => option.value).filter(Boolean));
  assert.ok(discoveredModels.length > 0, 'official model discovery returned no models');
  assert.ok(discoveredModels.every(model => /^jev(?:[-_.]|$)/u.test(model)),
    'official model discovery returned a non-Jev model');
  assert.ok(discoveredModels.some(model => ['jev-latest', 'jev-preview'].includes(model)),
    'official model discovery did not return a documented Jev alias');

  markStage('settings_custom_model_entry');
  await page.locator('#model').fill(configuredModel);

  markStage('settings_open_typesafe_routing_shortcut');
  const wasOnboardingBeforeShortcut = await page.locator('body')
    .evaluate(body => body.classList.contains('is-onboarding'));
  assert.equal(wasOnboardingBeforeShortcut, true,
    'TypeSafe routing shortcut was not exercised from first-run onboarding');
  await page.locator('#typesafeTaskRoutingLink').click();
  const advancedRouting = page.locator('#advancedTaskRouting');
  await page.waitForFunction(() =>
    !document.body.classList.contains('is-onboarding'));
  await page.locator('[data-task-policy-profile="semantic_find"]')
    .waitFor({ state: 'visible' });
  if (!await advancedRouting.evaluate(details => details.open)) {
    await page.locator('#advancedTaskRouting > summary').click();
  }
  await page.waitForFunction(() =>
    document.getElementById('advancedTaskRouting')?.open === true);
  if (!await page.locator('#modelBehaviorAdvanced').evaluate(details => details.open)) {
    await page.locator('#modelBehaviorAdvanced > summary').click();
  }
  await page.locator('#analysisBehaviorSettings').waitFor({ state: 'visible' });

  markStage('settings_route_document_highlight');
  const highlightRoute = page.locator('[data-task-policy-profile="document_highlight"]');
  await highlightRoute.waitFor({ state: 'visible' });
  await highlightRoute.selectOption(profileId);
  const unsupported = await page.locator('[data-task-policy-profile]')
    .evaluateAll((selects, id) => selects.filter(select =>
      !['document_highlight', 'semantic_find'].includes(select.dataset.taskPolicyProfile)).map(select => {
      const option = [...select.options].find(item => item.value === id);
      return {
        taskId: select.dataset.taskPolicyProfile,
        exists: Boolean(option),
        disabled: Boolean(option?.disabled),
        label: option?.textContent || ''
      };
    }), profileId);
  assert.ok(unsupported.length > 0);
  assert.ok(unsupported.every(item => item.exists && item.disabled && /仅支持文献高亮与语义查找/u.test(item.label)));
  const semanticOption = await page.locator('[data-task-policy-profile="semantic_find"]')
    .evaluate((select, id) => {
      const option = [...select.options].find(item => item.value === id);
      return { exists: Boolean(option), disabled: Boolean(option?.disabled) };
    }, profileId);
  assert.ok(semanticOption.exists && !semanticOption.disabled);
  const globalOption = await page.locator('#globalProfileId').evaluate((select, id) => {
    const option = [...select.options].find(item => item.value === id);
    return { disabled: Boolean(option?.disabled), label: option?.textContent || '' };
  }, profileId);
  assert.equal(globalOption.disabled, true);
  assert.match(globalOption.label, /仅支持文献高亮与语义查找/u);

  if (await page.locator('#consentGranted').count()) {
    await page.locator('#consentGranted').check();
  }
  markStage('settings_analysis_mode');
  await page.locator('#analysisMode').selectOption('llm');
  markStage('settings_save');
  await page.locator('#saveSettings').click();
  await page.waitForFunction(() =>
    document.getElementById('status')?.classList.contains('success') &&
    !document.getElementById('saveSettings')?.disabled);
  assert.equal(await page.locator('#apiKey').inputValue(), '');
  const placeholder = await page.locator('#apiKey').getAttribute('placeholder');
  assert.match(placeholder, /已保存/u);
  assert.equal(placeholder.includes(dummySecret), false);

  markStage('settings_reload');
  await page.reload();
  await page.locator(`[data-profile-id="${profileId}"]`).waitFor({ timeout: 30_000 });
  await page.locator(`[data-profile-id="${profileId}"]`).click();
  assert.equal(await page.locator('#model').inputValue(), configuredModel);
  assert.equal(await page.locator('#apiKey').inputValue(), '');
  assert.equal((await page.locator('#apiKey').getAttribute('placeholder')).includes(dummySecret), false);

  markStage('settings_test_provider');
  const decisionsBefore = report.api.decisionCalls;
  await page.locator('#testProvider').click();
  await page.waitForFunction(() =>
    !document.getElementById('testProvider')?.hasAttribute('aria-busy') &&
    document.getElementById('status')?.classList.contains('success'),
  null, { timeout: requestTimeoutMs + 30_000 });
  await waitForCall(page, () => report.api.decisionCalls > decisionsBefore);
  const probeCalls = report.api.calls.slice().reverse().filter(call => call.request?.questions)
    .find(call => Object.values(call.request.questions).some(question => question?.type === 'noul'));
  assert.ok(probeCalls, 'testProvider did not issue an official typed Noul decision');
  assert.equal(probeCalls.request.model, configuredModel);
  assert.ok(Object.values(probeCalls.response?.answers || {})
    .some(answer => answer?.type === 'noul' && Number(answer.noul) >= 0.5));

  report.settings = {
    profileId,
    providerId: 'typesafe',
    configuredModel,
    discoveredModels,
    discoveryReturnedAliases: true,
    configuredModelWasManuallyEntered: true,
    scopeHint,
    onboardingShortcutExitedLayout: true,
    onboardingDraftPreserved: true,
    keyInputAfterReload: '',
    keyPlaceholderMasked: true,
    documentHighlightProfileSelected: true,
    unsupportedTaskOptions: unsupported,
    globalOptionDisabled: globalOption.disabled,
    testProviderTypedNoul: true
  };
  return profileId;
}

async function collectDomAnnotations(page) {
  return page.evaluate(() => [...document.querySelectorAll('mark.sci-llm-highlight')].map(mark => ({
    quote: String(mark.textContent || '').trim(),
    paragraphId: mark.closest('[data-sci-llm-paragraph-id]')?.dataset.sciLlmParagraphId || '',
    sourceElementId: mark.closest('p')?.id || '',
    categoryId: mark.dataset.categoryId || '',
    categoryIds: String(mark.dataset.categories || mark.dataset.categoryId || '')
      .split(',').filter(Boolean),
    annotationIds: String(mark.dataset.annotationIds || '').split(',').filter(Boolean),
    relationIds: String(mark.dataset.relationIds || '').split(',').filter(Boolean),
    presentationMode: mark.dataset.presentationMode || '',
    title: mark.title || ''
  })));
}

async function runBrowserAcceptance({ extensionRoot, temporaryExtension, profileDirectory,
  server, report, headed, markStage }) {
  markStage('temporary_extension_copy');
  copyExtension(extensionRoot, temporaryExtension, server.address().port);
  report.source.productionHashes = Object.fromEntries([
    'manifest.json', 'options.html', 'options.js', 'popup.html', 'popup.js',
    'content.js', 'background.js', 'providers/typesafe.js',
    'core/jev-highlight.js', 'core/task-profile-router.js',
    'core/background-router.js', 'providers/provider-registry.js',
    'core/settings-store.js', 'core/provider-probes.js'
  ].map(file => [file, sha256(fs.readFileSync(path.join(extensionRoot, file)))]));
  report.source.temporaryNetworkWorkerSha256 =
    sha256(fs.readFileSync(path.join(temporaryExtension, 'offscreen-network-worker.js')));

  const serverOrigin = `http://127.0.0.1:${server.address().port}`;
  const fixtureUrl = `${serverOrigin}/fixture/article.html`;
  report.source.url = fixtureUrl;
  let context;
  let options;
  let popup;
  try {
    markStage('browser_launch');
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'msedge',
      headless: !headed,
      reducedMotion: 'reduce',
      viewport: { width: 1400, height: 1000 },
      args: [
        `--disable-extensions-except=${temporaryExtension}`,
        `--load-extension=${temporaryExtension}`
      ]
    });
    const pageErrors = [];
    const consoleErrors = [];
    context.on('page', page => {
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
    });
    await context.route(/^https?:\/\//u, route => {
      const parsed = new URL(route.request().url());
      if (parsed.origin === serverOrigin) return route.continue();
      report.browser.blockedUrls.push(`${parsed.origin}${parsed.pathname}`);
      return route.abort('blockedbyclient');
    });

    const worker = context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', { timeout: 30_000 });
    worker.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const extensionId = new URL(worker.url()).host;
    const algorithm = await worker.evaluate(() => {
      const version = String(SciLLM.JEV_HIGHLIGHT_ALGORITHM_VERSION || '');
      const registered = String(
        SciLLM.getProviderDefinitions?.().typesafe?.taskAlgorithmVersions?.document_highlight || ''
      );
      return { version, registered };
    });
    assert.match(algorithm.version, /^jev-highlight-v\d+$/u);
    assert.equal(algorithm.registered, algorithm.version);
    report.algorithm = {
      name: 'TypeSafe Jev document highlighting',
      version: algorithm.version,
      registeredTaskVersion: algorithm.registered,
      source: 'production service-worker SciLLM runtime'
    };
    options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#onboarding`);
    await configureThroughSettingsUi(options, report, markStage);

    markStage('category_configuration');
    const rpcPage = await context.newPage();
    await rpcPage.goto(`chrome-extension://${extensionId}/typesafe-acceptance-rpc.html`);
    await configureCategories(rpcPage, report);
    const publicSettings = await extensionRpc(rpcPage, { type: 'LLM_GET_SETTINGS' });
    const savedProfile = publicSettings.settings.profiles[report.settings.profileId];
    assert.equal(savedProfile.providerId, 'typesafe');
    assert.equal(savedProfile.config.model, configuredModel);
    assert.equal(savedProfile.config.hasApiKey, true);
    assert.equal(Object.hasOwn(savedProfile.config, 'apiKey'), false);
    assert.equal(publicSettings.settings.taskPolicies.document_highlight.profileId,
      report.settings.profileId);

    markStage('synthetic_fixture_open');
    const fixture = await context.newPage();
    await fixture.goto(fixtureUrl, { waitUntil: 'load' });
    const fixtureTab = await worker.evaluate(async url =>
      (await chrome.tabs.query({})).find(tab => tab.url === url), fixtureUrl);
    assert.ok(fixtureTab?.id, 'synthetic fixture tab missing');
    // Production deliberately injects on activation, not on every page load.
    await worker.evaluate(async tab => {
      for (let attempt = 0; ; attempt += 1) {
        const live = await chrome.tabs.get(tab.id);
        if (live.url !== tab.url) throw new Error('ACCEPTANCE_FIXTURE_NAVIGATED');
        try {
          await SciLLM.ensureContentScriptForActivation(chrome, tab.id, { expectedUrl: tab.url });
          break;
        } catch (error) {
          // A just-completed navigation can invalidate the injection epoch.
          // Re-enter the guarded production helper, never suppress its checks.
          if (attempt >= 2 || !String(error?.message).includes('TAB_MESSAGE_NAVIGATION_STALE')) throw error;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      await SciLLM.markTabActivated(chrome.storage.session, tab);
    }, fixtureTab);
    await fixture.waitForFunction(() =>
      Boolean(document.documentElement.dataset.sciLlmContentRevision), null, { timeout: 30_000 });

    markStage('popup_open');
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    // A side-panel page normally leaves the article active. Preserve that
    // relationship while hosting the same production page in a test tab.
    await fixture.bringToFront();
    await popup.waitForFunction(tabId =>
      activePanelTabContext.tabId === tabId && activePanelTabContext.activated,
    fixtureTab.id, { timeout: 30_000 });
    await popup.locator('[data-workspace-target="highlights"]').waitFor({ timeout: 30_000 });
    await popup.evaluate(() => {
      globalThis.__typesafeAcceptanceProgress = [];
      chrome.runtime.onMessage.addListener(message => {
        if (message?.type === 'LLM_OPERATION_PROGRESS') {
          globalThis.__typesafeAcceptanceProgress.push(structuredClone(message.progress));
        }
      });
    });
    await worker.evaluate(async tab => SciLLM.markTabActivated(chrome.storage.session, tab), fixtureTab);
    markStage('select_methods_analysis_scope');
    await popup.locator('[data-workspace-target="navigation"]').click();
    const methodsScope = popup.getByRole('checkbox', { name: 'Methods参与规则和 LLM 分析', exact: true });
    await methodsScope.check();
    await popup.waitForFunction(() =>
      [...document.querySelectorAll('.workspace-section-analysis-toggle')].some(input =>
        input.getAttribute('aria-label') === 'Methods参与规则和 LLM 分析' &&
        input.checked && !input.disabled), null, { timeout: 30_000 });
    await popup.locator('[data-workspace-target="highlights"]').click();
    if (!await popup.locator('#highlightControls').evaluate(node => node.open)) {
      await popup.locator('#highlightControls > summary').click();
    }
    await popup.locator('input[name="analysisMode"][value="llm"]').check();
    await popup.locator('#categoriesContainer input[type="checkbox"]').first()
      .waitFor({ timeout: 30_000 });
    const visibleCategoryIds = await popup.locator('#categoriesContainer input[type="checkbox"]')
      .evaluateAll(inputs => inputs.map(input => input.id.replace(/^cat-/, '')));
    assert.deepEqual(visibleCategoryIds,
      ['scientific_question', 'method', customCategoryId]);

    await fixture.bringToFront();
    await worker.evaluate(async tab => SciLLM.markTabActivated(chrome.storage.session, tab), fixtureTab);
    markStage('popup_prepare_document');
    await popup.waitForFunction(() => {
      const button = document.getElementById('applyHighlight');
      return button && !button.disabled &&
        /^(准备正文并分析|分析全文|重新分析全文)$/u.test(
          (button.getAttribute('aria-label') || button.textContent).trim());
    }, null, { timeout: 60_000 });
    const initialApplyText = await popup.locator('#applyHighlight').evaluate(button =>
      (button.getAttribute('aria-label') || button.textContent).trim());
    if (/准备正文/u.test(initialApplyText)) {
      await popup.locator('#applyHighlight').click();
      await popup.waitForFunction(() => {
        const button = document.getElementById('applyHighlight');
        return button && !button.disabled && /分析全文|重新分析全文/u.test(
          button.getAttribute('aria-label') || button.textContent || '');
      }, null, { timeout: 60_000 });
    }
    markStage('popup_analyze_document');
    const analysisCallsBefore = report.api.decisionCalls;
    await popup.locator('#applyHighlight').click();

    const diagnostics = await waitForDiagnostics(worker, fixtureTab.id, report, popup, analysisCallsBefore);
    await fixture.locator('mark.sci-llm-highlight').first()
      .waitFor({ timeout: 10_000 });
    await popup.waitForFunction(() =>
      document.getElementById('applyHighlight')?.getAttribute('aria-busy') === 'false',
    null, { timeout: 60_000 });
    assert.equal(diagnostics.stage, 'complete');
    assert.ok(report.api.decisionCalls > analysisCallsBefore,
      'highlight click did not issue official typed decisions');
    const analysisRequests = report.api.calls.filter(call =>
      call.request?.state?.phase === 'candidate_screen');
    assert.ok(analysisRequests.some(call => JSON.stringify(call.request.state)
      .includes(sourceSentences.method)), 'explicitly selected Methods never reached the model');

    markStage('dom_grounding_assertions');
    const annotations = await collectDomAnnotations(fixture);
    assert.ok(annotations.length > 0, 'main highlight chain produced no DOM annotations');
    const byCategory = categoryId => annotations.filter(annotation =>
      annotation.categoryIds.includes(categoryId));
    assert.ok(byCategory('scientific_question').some(annotation =>
      annotation.quote === sourceSentences.question));
    assert.ok(byCategory('method').some(annotation =>
      annotation.quote === sourceSentences.method));
    assert.ok(byCategory(customCategoryId).some(annotation =>
      annotation.quote === sourceSentences.positiveEnglish));
    assert.ok(byCategory(customCategoryId).some(annotation =>
      annotation.quote === sourceSentences.positiveChinese));
    assert.equal(byCategory(customCategoryId).some(annotation =>
      annotation.quote.includes(sourceSentences.negative)), false);
    assert.ok(annotations.every(annotation =>
      Object.values(sourceSentences).includes(annotation.quote)),
    'DOM contains a highlight quote that is not an exact synthetic source sentence');

    const progressEvents = await popup.evaluate(() =>
      globalThis.__typesafeAcceptanceProgress || []);
    assert.ok(progressEvents.length > 0, 'no production progress events were observed');
    assert.ok(progressEvents.some(event => event.phase === 'complete'));
    report.highlight = {
      trigger: /准备正文/u.test(initialApplyText)
        ? 'two real popup #applyHighlight clicks (prepare, then analyze)'
        : 'one real popup #applyHighlight analysis click after automatic preparation',
      mainChainNonEmpty: annotations.length > 0,
      diagnostics,
      progressEvents,
      terminalProgress: {
        diagnosticsStage: diagnostics.stage,
        applyButtonBusy: await popup.locator('#applyHighlight').getAttribute('aria-busy')
      },
      annotations
    };
    writeJson(path.join(report.outputDirectory, 'generated-annotations.json'), annotations);
    await fixture.screenshot({
      path: path.join(report.outputDirectory, 'highlighted-synthetic-article.png'),
      fullPage: true
    });

    markStage('persistence_reload_assertions');
    const marksBeforePopupReload = annotations.length;
    await popup.reload();
    await fixture.bringToFront();
    await popup.locator('[data-workspace-target="highlights"]').waitFor({ timeout: 30_000 });
    assert.equal((await collectDomAnnotations(fixture)).length, marksBeforePopupReload);
    const reloadedSettings = await extensionRpc(rpcPage, { type: 'LLM_GET_SETTINGS' });
    assert.equal(reloadedSettings.settings.profiles[report.settings.profileId].config.model,
      configuredModel);
    assert.equal(reloadedSettings.settings.taskPolicies.document_highlight.profileId,
      report.settings.profileId);
    report.persistence = {
      optionsReloadKeptModelAndMaskedKey: true,
      popupReloadKeptDocumentHighlights: true,
      runtimeReloadKeptDocumentRoute: true
    };

    report.browser.pageErrors = pageErrors;
    report.browser.consoleErrors = consoleErrors.filter(message =>
      !/favicon|ERR_BLOCKED_BY_CLIENT/u.test(message));
    assert.deepEqual(report.browser.pageErrors, []);
    assert.deepEqual(report.browser.consoleErrors, []);
  } catch (error) {
    if (popup && !popup.isClosed()) {
      report.popupFailure = await popup.evaluate(() => ({
        activePanelTabContext, prepareState, analysisMode,
        preparedDocumentState, highlightTaskState,
        applyText: document.getElementById('applyHighlight')?.textContent,
        selectedCategories: [...llmSelectedCategories],
        notifications: sidePanelNotificationHistory
      })).catch(() => null);
      await popup.screenshot({ path: path.join(report.outputDirectory, 'popup-failure.png') })
        .catch(() => {});
    }
    report.failureScreenshot = await captureFailureScreenshotBounded(options, report);
    throw error;
  } finally {
    report.cleanup ||= {};
    report.cleanup.browser = await closeBrowserContextBounded(context);
  }
}

async function run() {
  const args = parseArguments(process.argv.slice(2));
  const extensionRoot = path.resolve(args.extensionRoot ||
    process.env.SCI_EXTENSION_ROOT || repositoryRoot);
  const outputDirectory = createNewOutputDirectory(args.outputDir ||
    process.env.SCI_TYPESAFE_QA_OUTPUT_DIR);
  const sourceHtml = fixtureHtml();
  fs.writeFileSync(path.join(outputDirectory, 'synthetic-source.html'), sourceHtml, {
    encoding: 'utf8', mode: 0o600
  });
  const report = {
    schemaVersion: 1,
    status: 'FAIL',
    purpose: 'Real TypeSafe Jev settings-to-DOM highlighting acceptance',
    scientificValidity: 'synthetic_ground_truth_only_not_a_scientific_benchmark',
    outputDirectory,
    startedAt: new Date().toISOString(),
    source: {
      kind: 'local synthetic HTML',
      sha256: sha256(sourceHtml),
      sentences: sourceSentences,
      artifact: 'synthetic-source.html'
    },
    isolation: {
      temporaryExtension: true,
      temporaryProfile: true,
      extensionCredential: 'fixed dummy only',
      realCredentialLocation: 'Node proxy memory only',
      mockOrReplayAllowed: false
    },
    api: {
      allowedEndpoints: [
        `${officialOrigin}${decisionPath}`,
        `${officialOrigin}${modelsPath}`
      ],
      callCap: args.callCap,
      realCalls: 0,
      decisionCalls: 0,
      modelCalls: 0,
      callCapRejected: false,
      calls: []
    },
    browser: { blockedUrls: [], pageErrors: [], consoleErrors: [] },
    stage: 'report_initialized',
    stageHistory: [{ stage: 'report_initialized', at: new Date().toISOString() }],
    cleanup: {},
    checks: [],
    errors: []
  };
  const reportFile = path.join(outputDirectory, 'report.json');
  const transcriptFile = path.join(outputDirectory, 'api-transcript-synthetic.json');
  let realSecret = '';
  let proxy;
  let temporaryRoot = '';
  const persist = () => {
    writeJson(reportFile, report);
    writeJson(transcriptFile, {
      scientificValidity: report.scientificValidity,
      allowedEndpoints: report.api.allowedEndpoints,
      calls: report.api.calls
    });
  };
  const markStage = stage => {
    report.stage = stage;
    report.stageHistory.push({ stage, at: new Date().toISOString() });
    persist();
  };
  persist();
  try {
    markStage('credential_prompt');
    realSecret = await readSecretFromTty({ prompt: 'TypeSafe API key (masked, memory only): ' });
    if (!realSecret) throw safeError('TTY_REQUIRED');
    markStage('proxy_start');
    proxy = await startProxy({
      getSecret: () => realSecret,
      report,
      persist,
      callCap: args.callCap,
      sourceHtml
    });
    markStage('proxy_ready');
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), temporaryPrefix));
    await runBrowserAcceptance({
      extensionRoot,
      temporaryExtension: path.join(temporaryRoot, 'extension'),
      profileDirectory: path.join(temporaryRoot, 'profile'),
      server: proxy,
      report,
      headed: args.headed,
      markStage
    });
    assert.ok(report.api.realCalls >= 3,
      'expected model discovery, typed provider test, and highlight API calls');
    assert.ok(report.api.modelCalls >= 1);
    assert.ok(report.api.decisionCalls >= 2);
    assert.ok(report.api.realCalls <= args.callCap);
    assert.equal(report.api.callCapRejected, false);
    assert.ok(report.api.calls.every(call =>
      report.api.allowedEndpoints.includes(call.endpoint)));
    assert.ok(report.api.calls.every(call => call.status >= 200 && call.status < 300));
    report.checks.push(
      'actual settings UI saved TypeSafe jev-1.13.0 with a non-echoed credential',
      'actual model discovery and testProvider used official endpoints and typed Noul',
      'only document_highlight accepted the TypeSafe profile; generative task options were disabled',
      'actual popup clicks drove the production adapter, Jev algorithm, validator, and DOM renderer',
      'English and Chinese positive sentences were highlighted while the negated hard negative was not',
      'the non-empty highlight chain reached a complete terminal progress state and survived popup reload',
      'all retained source, questions, answers, annotations, hashes, and timings are synthetic and credential-free'
    );
    report.status = 'PASS';
    markStage('complete');
  } catch (error) {
    report.failedStage = report.stage;
    report.stage = 'failed';
    report.stageHistory.push({
      stage: 'failed', failedStage: report.failedStage, at: new Date().toISOString()
    });
    report.error = {
      code: safeErrorCode(error),
      message: redact(error?.message || error, realSecret),
      stack: redact(error?.stack || '', realSecret)
    };
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
    realSecret = '';
    report.cleanup.proxy = await closeServerBounded(proxy);
    if (temporaryRoot) {
      try {
        safeRemoveTemporary(temporaryRoot);
        report.cleanup.temporaryRoot = { attempted: true, removed: true };
      } catch (error) {
        report.cleanup.temporaryRoot = {
          attempted: true, removed: false, errorCode: safeErrorCode(error)
        };
      }
    } else {
      report.cleanup.temporaryRoot = { attempted: false, removed: false };
    }
    persist();
  }
  const summary = JSON.stringify({
    status: report.status,
    outputDirectory,
    realApiCalls: report.api.realCalls,
    decisionCalls: report.api.decisionCalls,
    modelCalls: report.api.modelCalls,
    errorCode: report.error?.code || ''
  });
  await new Promise(resolve => process.stdout.write(`${summary}\n`, resolve));
  // Playwright occasionally leaves a Windows transport handle alive after a failed launch or
  // close. All reports and bounded cleanup receipts are durable before this explicit exit.
  process.exit(process.exitCode || 0);
}

await run();
