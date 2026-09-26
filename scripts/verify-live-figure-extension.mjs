// Live-provider Figure acceptance for an isolated unpacked Edge extension.
// This harness reconstructs the selected public article excerpts from a local JSON
// fixture and serves the downloaded original figures at their public URLs. It does
// not claim to exercise the publisher's complete live DOM.
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
import { prepareFigureInput, bundleFigureCaptures, createFigureDeadline } from './lib/figure-acceptance-input.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const dummySecret = 'live-figure-proxy-dummy-not-a-real-key';
const providerOrigin = 'https://api.deepseek.com';
const allowedProviderPaths = new Set(['/chat/completions', '/responses']);
const providerCallCap = 16;
const providerTimeoutMs = 180_000;
const maxRequestBytes = 16 * 1024 * 1024;
const maxResponseBytes = 16 * 1024 * 1024;
const maxArticleBytes = 8 * 1024 * 1024;
const expectedPanelsByNumber = Object.freeze({
  1: labels('A', 'Z'),
  2: labels('A', 'K')
});

function labels(first, last) {
  const result = [];
  for (let code = first.charCodeAt(0); code <= last.charCodeAt(0); code += 1) {
    result.push(String.fromCharCode(code));
  }
  return result;
}

function safeError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^[A-Z][A-Z0-9_]{2,100}$/u.test(code) ? code : 'LIVE_FIGURE_ACCEPTANCE_FAILED';
}

function parseArguments(argv) {
  const result = {};
  const accepted = new Set([
    '--article', '--extension-root', '--output-dir', '--model', '--replay-dir',
    '--replay-delay-ms', '--strict-replay', '--source-manifest', '--figure',
    '--provider', '--base-url', '--call-cap', '--provider-timeout-ms', '--deadline-ms',
    '--preflight-only', '--bundle-runs', '--portable-config', '--profile', '--transport',
    '--profile-model-override', '--serialize-provider'
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!accepted.has(flag)) throw safeError('LIVE_FIGURE_ARGUMENT_INVALID');
    const key = flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    if (Object.hasOwn(result, key)) throw safeError('LIVE_FIGURE_ARGUMENT_INVALID');
    if (flag === '--preflight-only' || flag === '--serialize-provider') { result[key] = true; continue; }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw safeError('LIVE_FIGURE_ARGUMENT_INVALID');
    result[key] = value;
    index += 1;
  }
  return result;
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
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

function normalizeParagraph(value, index) {
  const tuple = Array.isArray(value) ? value : null;
  const record = isPlainRecord(value) ? value : {};
  const id = String(tuple?.[0] ?? record.id ?? record.paragraphId ?? `p${index + 1}`)
    .trim().slice(0, 160) || `p${index + 1}`;
  const section = String(tuple?.[1] ?? record.section ?? record.sectionTitle ?? 'Article')
    .trim().slice(0, 500) || 'Article';
  const text = String(tuple?.[2] ?? record.text ?? '').trim();
  if (!text || byteLength(text) > 250_000) throw safeError('LIVE_FIGURE_ARTICLE_INVALID');
  return { id, section, text };
}

function loadArticle(articlePath) {
  const absolutePath = path.resolve(articlePath);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile() || stat.size < 2 || stat.size > maxArticleBytes) {
    throw safeError('LIVE_FIGURE_ARTICLE_INVALID');
  }
  const raw = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  if (!isPlainRecord(raw)) throw safeError('LIVE_FIGURE_ARTICLE_INVALID');
  const title = String(raw.title || '').trim().slice(0, 1000);
  const parsedUrl = new URL(String(raw.url || '').trim());
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw safeError('LIVE_FIGURE_ARTICLE_INVALID');
  }
  parsedUrl.hash = '';
  const paragraphs = (Array.isArray(raw.paragraphs) ? raw.paragraphs : [])
    .map(normalizeParagraph);
  const directory = path.dirname(absolutePath);
  const figures = (Array.isArray(raw.figures) ? raw.figures : []).map((value, index) => {
    const tuple = Array.isArray(value) ? value : null;
    const record = isPlainRecord(value) ? value : {};
    const publicImageUrl = String(tuple?.[3] ?? record.image ?? record.imageUrl ?? '').trim();
    const imageUrl = new URL(publicImageUrl);
    if (imageUrl.protocol !== 'https:' || imageUrl.username || imageUrl.password) {
      throw safeError('LIVE_FIGURE_ARTICLE_INVALID');
    }
    imageUrl.hash = '';
    const localImagePath = path.join(directory, `fig${index + 1}.jpg`);
    const imageStat = fs.statSync(localImagePath);
    if (!imageStat.isFile() || imageStat.size < 10_000 || imageStat.size > 12 * 1024 * 1024) {
      throw safeError('LIVE_FIGURE_ARTICLE_INVALID');
    }
    const caption = String(tuple?.[2] ?? record.caption ?? '').trim();
    return {
      sourceId: String(tuple?.[0] ?? record.id ?? `fig${index + 1}`).trim().slice(0, 160),
      number: index + 1,
      title: String(tuple?.[1] ?? record.title ?? `Figure ${index + 1}`).trim().slice(0, 1000),
      caption,
      publicImageUrl: imageUrl.href,
      localImagePath,
      imageBytes: fs.readFileSync(localImagePath)
    };
  });
  if (!title || paragraphs.length < 1 || figures.length !== 2 ||
      figures.some(figure => figure.caption.length < 100)) {
    throw safeError('LIVE_FIGURE_ARTICLE_INVALID');
  }
  return { absolutePath, title, url: parsedUrl.href, paragraphs, figures };
}

function articleHtml(article) {
  const paragraphs = article.paragraphs.map(item =>
    `<section data-section="${escapeHtml(item.section)}"><h2>${escapeHtml(item.section)}</h2>` +
    `<p id="${escapeHtml(item.id)}">${escapeHtml(item.text)}</p></section>`
  ).join('\n');
  const figures = article.figures.map(item =>
    `<figure id="${escapeHtml(item.sourceId)}"><img src="${escapeHtml(item.publicImageUrl)}" ` +
    `alt="${escapeHtml(item.title)}"><figcaption><span class="figure-label">` +
    `${escapeHtml(item.label || `Figure ${item.number}`)}</span>. <strong>${escapeHtml(item.title)}</strong> ` +
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
      if (size > maxRequestBytes) return fail('LIVE_FIGURE_REQUEST_TOO_LARGE');
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size).toString('utf8'));
    });
    request.on('error', () => fail('LIVE_FIGURE_PROXY_REQUEST_FAILED'));
  });
}

async function readBoundedResponse(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (byteLength(text) > maxResponseBytes) throw safeError('LIVE_FIGURE_RESPONSE_TOO_LARGE');
    return text;
  }
  const chunks = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxResponseBytes) {
      await reader.cancel().catch(() => {});
      throw safeError('LIVE_FIGURE_RESPONSE_TOO_LARGE');
    }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

function allStrings(value, output = [], depth = 0) {
  if (depth > 18 || output.length > 20_000) return output;
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach(item => allStrings(item, output, depth + 1));
  else if (isPlainRecord(value)) Object.values(value)
    .forEach(item => allStrings(item, output, depth + 1));
  return output;
}

function figurePayload(body) {
  for (const text of allStrings(body)) {
    if (!text.includes('figure_id') || text.length > 3_000_000) continue;
    try {
      const parsed = JSON.parse(text);
      if (isPlainRecord(parsed) && typeof parsed.figure_id === 'string') return parsed;
    } catch (_) {}
  }
  return null;
}

function imageDimensions(bytes, mediaType) {
  if (mediaType === 'image/png' && bytes.length >= 24 &&
      bytes.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if ((mediaType === 'image/jpeg' || mediaType === 'image/jpg') &&
      bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb,
        0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 ||
          (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return { width: null, height: null };
}

function requestImages(body, downloadedHashes) {
  const images = [];
  for (const value of allStrings(body)) {
    const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/u.exec(value);
    if (!match) continue;
    const bytes = Buffer.from(match[2], 'base64');
    const digest = sha256(bytes);
    images.push({
      mediaType: match[1],
      bytes: bytes.length,
      sha256: digest,
      matchesDownloadedSource: downloadedHashes.has(digest),
      ...imageDimensions(bytes, match[1])
    });
  }
  return images;
}

function safeUsage(value) {
  const usage = isPlainRecord(value?.usage) ? value.usage : {};
  const pick = (...keys) => {
    for (const key of keys) {
      if (Number.isSafeInteger(usage[key]) && usage[key] >= 0) return usage[key];
    }
    return null;
  };
  return {
    input: pick('input_tokens', 'prompt_tokens'),
    output: pick('output_tokens', 'completion_tokens'),
    total: pick('total_tokens')
  };
}

function responseUsage(text) {
  let last = null;
  try { last = JSON.parse(text); } catch (_) {
    for (const line of String(text).split(/\r?\n/u)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed?.usage) last = parsed;
      } catch (_) {}
    }
  }
  return safeUsage(last);
}

function responseErrorCode(text) {
  try {
    const value = JSON.parse(text);
    const candidate = value?.error?.code ?? value?.code;
    return typeof candidate === 'string' && /^[A-Za-z0-9._-]{1,100}$/u.test(candidate)
      ? candidate : '';
  } catch (_) { return ''; }
}

function safeRequestShape(body, providerPath, downloadedHashes) {
  const payload = figurePayload(body);
  const images = requestImages(body, downloadedHashes);
  const responseFormat = body?.response_format ?? body?.text?.format;
  const inputStrings = allStrings(body).filter(value => !value.startsWith('data:image/'));
  return {
    endpoint: providerPath,
    topLevelKeys: isPlainRecord(body) ? Object.keys(body).sort().slice(0, 50) : [],
    model: typeof body?.model === 'string' ? body.model.slice(0, 200) : '',
    stream: body?.stream === true,
    messageCount: Array.isArray(body?.messages) ? body.messages.length : null,
    inputKind: Array.isArray(body?.input) ? 'array' : typeof body?.input,
    inputChars: inputStrings.reduce((total, value) => total + value.length, 0),
    responseFormatType: typeof responseFormat?.type === 'string'
      ? responseFormat.type.slice(0, 100) : '',
    schemaSha256: responseFormat ? sha256(JSON.stringify(responseFormat)) : '',
    schemaName: typeof responseFormat?.json_schema?.name === 'string'
      ? responseFormat.json_schema.name.slice(0, 120)
      : typeof responseFormat?.name === 'string' ? responseFormat.name.slice(0, 120) : '',
    maxOutputTokens: Number.isSafeInteger(body?.max_output_tokens)
      ? body.max_output_tokens : Number.isSafeInteger(body?.max_tokens) ? body.max_tokens : null,
    figureId: String(payload?.figure_id || '').slice(0, 160),
    pass: String(payload?.pass || 'whole_figure').slice(0, 80),
    expectedPanels: Array.isArray(payload?.expected_panel_labels)
      ? payload.expected_panel_labels.map(String).slice(0, 30) : [],
    requestedPanels: Array.isArray(payload?.requested_panel_labels)
      ? payload.requested_panel_labels.map(String).slice(0, 30) : [],
    imageCount: images.length,
    images
  };
}

function redactString(value, forbiddenSecret = '') {
  let result = String(value || '')
    .replace(/\bsk-[A-Za-z0-9_-]{3,}\b/gu, '[REDACTED_SECRET]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{3,}/giu, 'Bearer [REDACTED_SECRET]');
  if (forbiddenSecret) result = result.split(forbiddenSecret).join('[REDACTED_SECRET]');
  return result;
}

function sanitizeArtifactValue(value, forbiddenSecret, depth = 0) {
  if (depth > 28) return '[TRUNCATED_DEPTH]';
  if (Array.isArray(value)) return value.slice(0, 10_000)
    .map(item => sanitizeArtifactValue(item, forbiddenSecret, depth + 1));
  if (!isPlainRecord(value)) {
    return typeof value === 'string' ? redactString(value, forbiddenSecret) : value;
  }
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(?:authorization|api.?key|secret|credential|access.?token|refresh.?token|bearer.?token|^token$)/iu
      .test(key)) continue;
    output[key] = sanitizeArtifactValue(child, forbiddenSecret, depth + 1);
  }
  return output;
}

function sanitizedArtifact(rawText, forbiddenSecret = '') {
  let value;
  try { value = sanitizeArtifactValue(JSON.parse(rawText), forbiddenSecret); }
  catch (_) {
    value = { redacted_non_json_body: redactString(rawText, forbiddenSecret)
      .slice(0, maxResponseBytes) };
  }
  const serialized = JSON.stringify(value, null, 2);
  if ((forbiddenSecret && serialized.includes(forbiddenSecret)) ||
      /\bsk-[A-Za-z0-9_-]{3,}\b|Bearer\s+(?!\[REDACTED_SECRET\])/iu.test(serialized)) {
    throw safeError('LIVE_FIGURE_REDACTION_FAILED');
  }
  return `${serialized}\n`;
}

function writeReportNow(report, outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function numberedArtifact(kind, sequence) {
  return `provider-${kind}-${String(sequence).padStart(3, '0')}-redacted.json`;
}

function writeBoundaryArtifact(outputDirectory, kind, sequence, rawBody, forbiddenSecret) {
  const file = numberedArtifact(kind, sequence);
  fs.writeFileSync(path.join(outputDirectory, file),
    sanitizedArtifact(rawBody, forbiddenSecret), { encoding: 'utf8', mode: 0o600 });
  return file;
}

function replayResponseBody(value) {
  if (isPlainRecord(value) && typeof value.redacted_non_json_body === 'string' &&
      Object.keys(value).length === 1) return value.redacted_non_json_body;
  return JSON.stringify(value);
}

function loadReplayEntries(replayDirectory, options = {}) {
  const directory = path.resolve(replayDirectory);
  const replayReport = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'));
  const calls = Array.isArray(replayReport?.providerCalls) ? replayReport.providerCalls : [];
  const maxEntries = options.maxEntries ?? providerCallCap;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 512 ||
      !calls.length || calls.length > maxEntries) {
    throw safeError('LIVE_FIGURE_REPLAY_INVALID');
  }
  return calls.map((call, index) => {
    const sequence = index + 1;
    const requestFile = String(call?.artifacts?.request || numberedArtifact('request', sequence));
    const responseFile = String(call?.artifacts?.response || numberedArtifact('response', sequence));
    if (path.basename(requestFile) !== requestFile || path.basename(responseFile) !== responseFile) {
      throw safeError('LIVE_FIGURE_REPLAY_INVALID');
    }
    const requestBody = JSON.parse(fs.readFileSync(path.join(directory, requestFile), 'utf8'));
    const responseValue = JSON.parse(fs.readFileSync(path.join(directory, responseFile), 'utf8'));
    const status = Number(call?.status);
    if (!isPlainRecord(requestBody) || !Number.isInteger(status) || status < 100 || status > 599) {
      throw safeError('LIVE_FIGURE_REPLAY_INVALID');
    }
    return {
      sequence,
      endpoint: String(call?.request?.endpoint || ''),
      expectedShape: call.request,
      requestBody,
      responseBody: replayResponseBody(responseValue),
      status,
      contentType: String(call?.contentType || 'application/json').slice(0, 120)
    };
  });
}

function assertReplayMatch(actualBody, actualShape, entry) {
  const savedFormat = entry.requestBody?.response_format ?? entry.requestBody?.text?.format;
  const actualFormat = actualBody?.response_format ?? actualBody?.text?.format;
  const equalArray = (left, right) => JSON.stringify(left || []) === JSON.stringify(right || []);
  if (actualShape.endpoint !== entry.endpoint ||
      actualShape.model !== entry.expectedShape?.model ||
      actualShape.figureId !== entry.expectedShape?.figureId ||
      actualShape.pass !== entry.expectedShape?.pass ||
      !equalArray(actualShape.expectedPanels, entry.expectedShape?.expectedPanels) ||
      !equalArray(actualShape.requestedPanels, entry.expectedShape?.requestedPanels) ||
      JSON.stringify(actualFormat ?? null) !== JSON.stringify(savedFormat ?? null)) {
    throw safeError('LIVE_FIGURE_REPLAY_MISMATCH');
  }
}

function takeReplayEntry(body, shape, entries, used, strict = false) {
  for (const entry of entries) {
    if (used.has(entry.sequence)) continue;
    try {
      assertReplayMatch(body, shape, entry);
      if (strict) assert.deepEqual(JSON.parse(sanitizedArtifact(JSON.stringify(body))), entry.requestBody);
    } catch (_) { continue; }
    used.add(entry.sequence);
    return entry;
  }
  throw safeError('LIVE_FIGURE_REPLAY_MISMATCH');
}

async function startProxy({
  secret, report, state, downloadedHashes, outputDirectory, replayEntries = null,
  replayDelayMs = 0, strictReplay = false, callCap = providerCallCap,
  timeoutMs = providerTimeoutMs, deadline = null, selectedModel = '', selectedFigures = null,
  fetchImpl = globalThis.fetch
}) {
  const usedReplayEntries = new Set();
  const persist = () => {
    report.realApiCalls = state.providerCalls;
    report.replayedCalls = state.replayedCalls;
    report.callCapRejected = state.callCapRejected;
    writeReportNow(report, outputDirectory);
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
      const remote = String(request.socket.remoteAddress || '');
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) ||
          request.method !== 'POST' || !allowedProviderPaths.has(request.url) ||
          request.headers.authorization !== `Bearer ${dummySecret}`) {
        throw safeError('LIVE_FIGURE_PROXY_REQUEST_REJECTED');
      }
      deadline?.check();
      if (state.boundaryCalls >= callCap) {
        state.callCapRejected = true;
        persist();
        reply.writeHead(429, { 'Content-Type': 'application/json' });
        reply.end(JSON.stringify({ error: { code: 'LIVE_FIGURE_PROVIDER_CALL_CAP' } }));
        return;
      }
      const bodyText = await readBoundedRequest(request);
      const body = JSON.parse(bodyText);
      // Source captures are authorized only for the explicitly selected Figure/model.
      deadline?.check();
      if (state.boundaryCalls >= callCap) {
        state.callCapRejected = true;
        throw safeError('LIVE_FIGURE_PROVIDER_CALL_CAP');
      }
      if (selectedFigures) {
        const payload = figurePayload(body);
        if (body.model !== selectedModel || !payload ||
            !selectedFigures.some(f => f.label === payload.figure_label) ||
            sha256(String(payload.article_title || '')) !== report.article.titleSha256 || body.stream === true) {
          throw safeError('LIVE_FIGURE_REQUEST_OUTSIDE_SELECTION');
        }
      }
      state.boundaryCalls += 1;
      if (replayEntries) state.replayedCalls += 1;
      else state.providerCalls += 1;
      state.lastRequestBody = bodyText;
      const shape = safeRequestShape(body, request.url, downloadedHashes);
      record = {
        sequence: state.boundaryCalls,
        startedAtMs: Date.now(),
        request: shape,
        status: null,
        elapsedMs: null,
        responseBytes: null,
        usage: { input: null, output: null, total: null },
        providerErrorCode: '',
        contentType: '',
        artifacts: {}
      };
      report.providerCalls.push(record);
      record.artifacts.request = writeBoundaryArtifact(
        outputDirectory, 'request', record.sequence, bodyText, secret
      );
      persist();
      if (replayEntries) {
        const entry = takeReplayEntry(body, shape, replayEntries, usedReplayEntries, strictReplay);
        record.replaySourceSequence = entry.sequence;
        if (replayDelayMs) await new Promise(resolve => setTimeout(resolve, replayDelayMs));
        state.lastResponseBody = entry.responseBody;
        record.status = entry.status;
        record.elapsedMs = Date.now() - record.startedAtMs;
        record.responseBytes = byteLength(entry.responseBody);
        record.usage = responseUsage(entry.responseBody);
        record.providerErrorCode = responseErrorCode(entry.responseBody);
        record.contentType = entry.contentType;
        record.artifacts.response = writeBoundaryArtifact(
          outputDirectory, 'response', record.sequence, entry.responseBody, ''
        );
        persist();
        reply.writeHead(entry.status, { 'Content-Type': entry.contentType });
        reply.end(entry.responseBody);
        return;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const onDeadline = () => controller.abort();
      deadline?.signal.addEventListener('abort', onDeadline, { once: true });
      const startedAt = Date.now();
      try {
        deadline?.check();
        const providerResponse = await fetchImpl(`${providerOrigin}${request.url}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: bodyText,
          signal: controller.signal,
          redirect: 'error'
        });
        record.status = providerResponse.status;
        const responseText = await readBoundedResponse(providerResponse);
        state.lastResponseBody = responseText;
        record.elapsedMs = Date.now() - startedAt;
        record.responseBytes = byteLength(responseText);
        record.usage = responseUsage(responseText);
        record.providerErrorCode = responseErrorCode(responseText);
        record.contentType = providerResponse.headers.get('content-type') || 'application/json';
        record.artifacts.response = writeBoundaryArtifact(
          outputDirectory, 'response', record.sequence, responseText, secret
        );
        persist();
        reply.writeHead(providerResponse.status, {
          'Content-Type': record.contentType
        });
        reply.end(responseText);
      } catch (error) {
        record.elapsedMs = Date.now() - startedAt;
        if (Number.isInteger(error?.exitCode) && error.exitCode >= 0 && error.exitCode <= 255) {
          record.transportExitCode = error.exitCode;
        }
        record.transportErrorCode = error?.name === 'AbortError'
          ? 'LIVE_FIGURE_PROVIDER_TIMEOUT'
          : safeErrorCode(error) === 'LIVE_FIGURE_ACCEPTANCE_FAILED'
            ? 'LIVE_FIGURE_PROVIDER_FETCH_FAILED' : safeErrorCode(error);
        persist();
        throw safeError(record.transportErrorCode);
      } finally {
        clearTimeout(timeout);
        deadline?.signal.removeEventListener('abort', onDeadline);
      }
    } catch (error) {
      const code = safeErrorCode(error);
      state.boundaryErrorCode = code;
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

function copyExtension(extensionRoot, temporaryExtension, proxyUrl, report) {
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    const source = path.join(extensionRoot, directory);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(temporaryExtension, directory), {
      recursive: true
    });
  }
  for (const file of fs.readdirSync(extensionRoot)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(extensionRoot, file), path.join(temporaryExtension, file));
    }
  }
  for (const file of [
    'content.js', 'popup.js', 'background.js', 'offscreen-network-worker.js',
    'core/background-router.js', 'core/figure-analysis.js',
    'core/llm-task-catalog.js', 'core/task-profile-router.js', 'providers/deepseek.js'
  ]) {
    const source = path.join(temporaryExtension, file);
    if (fs.existsSync(source)) report.sourceHashes[file] = sha256(fs.readFileSync(source));
  }
  const contentFile = path.join(temporaryExtension, 'content.js');
  const contentSource = fs.readFileSync(contentFile, 'utf8');
  const diagnosticFailSource = `    const fail = code => {\n` +
    `        const error = new Error(code);\n` +
    `        error.code = code;\n` +
    `        try {\n` +
    `            const diagnosticEnvelope = targetEnvelope?.figureResult\n` +
    `                ? targetEnvelope : clearEnvelope?.figureResult ? clearEnvelope : discardEnvelope;\n` +
    `            console.error('FIGURE_QA_DIAG ' + JSON.stringify({\n` +
    `                source: 'persistFigureInventoryWithCas.fail',\n` +
    `                code, targetFigureId, targetDepth, checkpointWrite,\n` +
    `                checkpointClear, checkpointDiscard,\n` +
    `                panelIds: Array.isArray(diagnosticEnvelope?.figureResult?.panels)\n` +
    `                    ? diagnosticEnvelope.figureResult.panels.map(panel =>\n` +
    `                        String(panel?.panel || '')).slice(0, 30) : [],\n` +
    `                resultKeys: diagnosticEnvelope?.figureResult &&\n` +
    `                    typeof diagnosticEnvelope.figureResult === 'object'\n` +
    `                    ? Object.keys(diagnosticEnvelope.figureResult).sort() : [],\n` +
    `                stack: String(error.stack || '').split('\\n').slice(0, 8)\n` +
    `            }));\n` +
    `        } catch (_) {}\n` +
    `        throw error;\n` +
    `    };`;
  const casStart = contentSource.indexOf('async function persistFigureInventoryWithCas');
  const failStart = contentSource.indexOf('    const fail = code => {', casStart);
  const failEnd = contentSource.indexOf('    };', failStart) + '    };'.length;
  if (casStart < 0 || failStart <= casStart || failEnd <= failStart) {
    throw safeError('LIVE_FIGURE_CONTENT_DIAGNOSTIC_INSERT_FAILED');
  }
  fs.writeFileSync(contentFile,
    contentSource.slice(0, failStart) + diagnosticFailSource + contentSource.slice(failEnd));

  const routerFile = path.join(temporaryExtension, 'core/background-router.js');
  const routerSource = fs.readFileSync(routerFile, 'utf8');
  const checkpointStart = routerSource.indexOf('async function persistValidatedFigureCheckpoint');
  const catchNeedle = '        } catch (cause) {';
  const catchStart = routerSource.indexOf(catchNeedle, checkpointStart);
  const nextCauseCheck = routerSource.indexOf(
    `if (cause?.code === 'FIGURE_REQUEST_REPLAY_AMBIGUOUS')`, catchStart
  );
  if (checkpointStart < 0 || catchStart <= checkpointStart ||
      nextCauseCheck <= catchStart || nextCauseCheck - catchStart > 160) {
    throw safeError('LIVE_FIGURE_ROUTER_DIAGNOSTIC_INSERT_FAILED');
  }
  const diagnosticCatch = `\n          try {\n` +
    `            console.error('FIGURE_QA_DIAG ' + JSON.stringify({\n` +
    `              source: 'persistValidatedFigureCheckpoint.catch',\n` +
    `              code: String(cause?.code || ''),\n` +
    `              message: String(cause?.message || '').slice(0, 500),\n` +
    `              stack: String(cause?.stack || '').split('\\n').slice(0, 10),\n` +
    `              figureId: String(figure?.figureId || ''),\n` +
    `              operationId: String(progressDetails?.operationId || ''),\n` +
    `              validatedPanelCount: fields.validatedPanelCount,\n` +
    `              expectedPanels: Array.isArray(expectedPanels)\n` +
    `                ? expectedPanels.slice(0, 30) : []\n` +
    `            }));\n` +
    `          } catch (_) {}`;
  fs.writeFileSync(routerFile,
    routerSource.slice(0, catchStart + catchNeedle.length) + diagnosticCatch +
    routerSource.slice(catchStart + catchNeedle.length));
  report.testInjections = [
    'temporary content CAS fail diagnostics',
    'temporary background checkpoint catch diagnostics'
  ];
  const networkFile = path.join(temporaryExtension, 'offscreen-network-worker.js');
  const boundary = `const liveFigureNativeFetch = globalThis.fetch.bind(globalThis);\n` +
    `globalThis.fetch = (url, options = {}) => {\n` +
    `  const parsed = new URL(String(url));\n` +
    `  if (parsed.origin !== 'https://api.deepseek.com' ||\n` +
    `      !['/responses', '/chat/completions'].includes(parsed.pathname)) {\n` +
    `    throw new Error('LIVE_FIGURE_BLOCKED_REMOTE_FETCH');\n` +
    `  }\n` +
    `  return liveFigureNativeFetch(${JSON.stringify(proxyUrl)} + parsed.pathname, options);\n` +
    `};\n`;
  fs.writeFileSync(networkFile, boundary + fs.readFileSync(networkFile, 'utf8'));
  report.testBoundary = 'temporary offscreen fetch boundary -> loopback transparent live proxy';
}

async function setupProfile(panel, selectedModel, baseUrl = '') {
  return panel.evaluate(async ({ model, dummy, baseUrl }) => {
    const profileId = 'profile_live_figure_acceptance';
    for (const message of [
      {
        type: 'LLM_SAVE_PROFILE',
        profile: {
          id: profileId,
          name: 'Live DeepSeek Figure acceptance',
          providerId: 'deepseek',
          config: {
            apiKey: dummy,
            model,
            ...(baseUrl ? { baseUrl } : {}),
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
      if (response?.success !== true) throw new Error('LIVE_FIGURE_PROFILE_SETUP_FAILED');
    }
    await loadLlmSettings();
    await refreshArticleWorkspace();
    switchWorkspaceView('figures');
  }, { model: selectedModel, dummy: dummySecret, baseUrl });
}

async function currentArchive(panel) {
  return panel.evaluate(async () => (await getCurrentArticleArchiveFromTab()).archive);
}

function archiveFigures(archive) {
  return Array.isArray(archive?.workspace?.figures) ? archive.workspace.figures : [];
}

function figureResult(figure) {
  return figure?.modelStandard || figure?.standard || figure?.result || null;
}

function pendingStandardCheckpoint(figure) {
  return Boolean(
    figure?.pendingStandard || figure?.pendingStandardCheckpointEnvelope ||
    figure?.pendingResumeCheckpoints?.standard || figure?.pendingResults?.standard
  );
}

function normalizedPanelId(panel) {
  return String(panel?.panel || panel?.panelId || '').trim().toUpperCase();
}

function panelsAreSubstantive(panels) {
  return panels.every(panel => {
    const fields = [
      panel?.purpose, panel?.design, panel?.comparison, panel?.directObservation,
      panel?.localInference, panel?.contribution
    ].map(value => String(value || '').trim());
    const schematicWithoutInference = panel?.methodCategory === 'schematic' &&
      panel?.role === 'model_setup' && fields[1].length >= 12 &&
      /^(?:无|不适用|无需推论|n\/?a|none|not applicable)[。.]?$/iu.test(fields[4]);
    return fields[3].length >= 6 && (fields[4].length >= 6 || schematicWithoutInference) && fields[5].length >= 6 &&
      fields.reduce((total, value) => total + value.length, 0) >= 60;
  });
}

function completedFigure(figure, expectedPanels) {
  const result = figureResult(figure);
  const actual = Array.isArray(result?.panels) ? result.panels.map(normalizedPanelId) : [];
  return result && JSON.stringify(actual) === JSON.stringify(expectedPanels) &&
    panelsAreSubstantive(result.panels) && !String(figure?.standardError || '') &&
    !String(figure?.deepError || '') && !pendingStandardCheckpoint(figure);
}

function terminalCodeFrom(value) {
  const match = String(value || '').match(/\b[A-Z][A-Z0-9_]{2,100}\b/u);
  return match?.[0] || '';
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

async function waitForFigureTerminal(panel, figureId, expectedPanels, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let archive = null;
    try { archive = await currentArchive(panel); }
    catch (error) {
      if (!/ARTICLE_ARCHIVE_DOCUMENT_NOT_READY/u.test(String(error?.message || ''))) throw error;
    }
    const figure = archiveFigures(archive).find(item => item?.figureId === figureId);
    if (figure && completedFigure(figure, expectedPanels)) return { archive, figure };
    const archiveError = String(figure?.standardError || figure?.deepError || '');
    const progress = await runtimeFigureProgress(panel, figureId);
    if (archiveError || progress?.failed) {
      throw safeError('LIVE_FIGURE_TERMINAL_ERROR', {
        terminalErrorCode: terminalCodeFrom(archiveError) || terminalCodeFrom(progress?.code),
        terminalErrorMessage: archiveError || String(progress?.code || '')
      });
    }
    if (figureResult(figure)?.panels?.length && !pendingStandardCheckpoint(figure) &&
        progress?.running === false) {
      throw safeError('LIVE_FIGURE_SUBSTANTIVE_CHECK_FAILED', {
        terminalErrorCode: 'LIVE_FIGURE_SUBSTANTIVE_CHECK_FAILED',
        terminalErrorMessage: 'Completed Figure did not pass the Panel coverage and evidence-content checks'
      });
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw safeError('LIVE_FIGURE_UI_TIMEOUT');
}

async function clickSingleFigure(panel, figureId, expectedPanels, timeoutMs = providerTimeoutMs * providerCallCap + 60_000) {
  const card = panel.locator(`.workspace-figure-card[data-figure-id="${figureId}"]`);
  if (!await card.evaluate(element => element.open)) {
    await card.locator(':scope > summary').click();
  }
  await card.locator('.workspace-figure-analyze-action').click();
  return waitForFigureTerminal(
    panel, figureId, expectedPanels, timeoutMs
  );
}

async function discoveredFigureCards(panel) {
  return panel.locator('.workspace-figure-card[data-figure-id]').evaluateAll(cards =>
    cards.map(card => ({
      figureId: String(card.dataset.figureId || ''),
      label: String(card.querySelector(':scope > summary')?.textContent || '')
    }))
  );
}

function mapFigureIds(cards) {
  if (cards.length !== 2) throw safeError('LIVE_FIGURE_CARD_COUNT_INVALID');
  const result = {};
  for (const card of cards) {
    const match = card.label.match(/Figure\s*([12])\b/iu);
    if (match) result[Number(match[1])] = card.figureId;
  }
  if (!result[1] || !result[2] || result[1] === result[2]) {
    result[1] = cards[0]?.figureId;
    result[2] = cards[1]?.figureId;
  }
  if (!result[1] || !result[2] || result[1] === result[2]) {
    throw safeError('LIVE_FIGURE_CARD_ID_INVALID');
  }
  return result;
}

async function openFigureCards(panel, ids) {
  for (const id of ids) {
    const card = panel.locator(`.workspace-figure-card[data-figure-id="${id}"]`);
    if (!await card.evaluate(element => element.open)) {
      await card.locator(':scope > summary').click();
    }
  }
}

async function visibleFigureGeometry(panel, ids, expectedCounts) {
  const result = {};
  for (let index = 0; index < ids.length; index += 1) {
    const figureId = ids[index];
    const expectedCount = expectedCounts[index];
    const card = panel.locator(`.workspace-figure-card[data-figure-id="${figureId}"]`);
    await card.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    // Current UI nests Panels inside collapsed evidence blocks and collapses the overview.
    // Open their real summary controls before checking descendant geometry.
    const overview = card.locator('details.workspace-figure-overview');
    if (!await overview.evaluate(element => element.open)) {
      await overview.locator(':scope > summary').click();
    }
    const evidenceBlocks = card.locator('details.workspace-evidence-block');
    for (let blockIndex = 0; blockIndex < await evidenceBlocks.count(); blockIndex += 1) {
      const block = evidenceBlocks.nth(blockIndex);
      if (!await block.evaluate(element => element.open)) {
        await block.locator(':scope > summary').click();
      }
    }
    const panelCards = card.locator('.workspace-figure-panel-card[data-panel-id]');
    assert.equal(await panelCards.count(), expectedCount,
      `Figure ${index + 1} renders every Panel card`);
    for (const itemIndex of [0, expectedCount - 1]) {
      const item = panelCards.nth(itemIndex);
      if (!await item.evaluate(element => element.open)) {
        await item.locator(':scope > summary').click();
      }
      await item.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    }
    await card.locator('.workspace-figure-overview').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
    const geometry = await card.evaluate(element => {
      const effectivelyVisible = node => {
        if (!node) return false;
        let current = node;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
          const style = getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden' ||
              Number(style.opacity) === 0) return false;
          current = current.parentElement;
        }
        const rect = node.getBoundingClientRect();
        return rect.width >= 40 && rect.height >= 8;
      };
      const overview = element.querySelector('.workspace-figure-overview');
      const panels = [...element.querySelectorAll(
        '.workspace-figure-panel-card[data-panel-id]'
      )];
      const expandedFields = [...element.querySelectorAll(
        '.workspace-figure-panel-card[open] .workspace-figure-field'
      )].filter(effectivelyVisible);
      return {
        cardVisible: effectivelyVisible(element),
        overviewVisible: effectivelyVisible(overview),
        overviewChars: String(overview?.innerText || '').trim().length,
        visiblePanelSummaries: panels.filter(item =>
          effectivelyVisible(item.querySelector(':scope > summary')) &&
          String(item.querySelector(':scope > summary')?.innerText || '').trim().length >= 2
        ).length,
        expandedFieldCount: expandedFields.length,
        expandedFieldChars: expandedFields.reduce((total, item) =>
          total + String(item.innerText || '').trim().length, 0)
      };
    });
    assert.ok(geometry.cardVisible && geometry.overviewVisible &&
      geometry.overviewChars >= 40 && geometry.visiblePanelSummaries === expectedCount &&
      geometry.expandedFieldCount > 0 && geometry.expandedFieldChars >= 40,
    `Figure ${index + 1} has visible overview and substantive Panel geometry`);
    result[`figure${index + 1}`] = geometry;
  }
  return result;
}

function figureSummary(figure, expectedPanels) {
  const result = figureResult(figure);
  return {
    panelCount: result?.panels?.length || 0,
    panelIdsSha256: sha256(JSON.stringify((result?.panels || []).map(normalizedPanelId))),
    resultSha256: sha256(JSON.stringify(result || null)),
    operationIdPresent: Boolean(result?.operationId),
    substantivePanelCount: (result?.panels || []).filter(panel => panelsAreSubstantive([panel])).length,
    expectedPanelCount: expectedPanels.length,
    inputMode: String(result?.inputMode || ''),
    basis: String(result?.basis || '')
  };
}

function safeTemporaryRemoval(target, prefix) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(target);
  if (!resolved.startsWith(temporaryRoot + path.sep) ||
      !path.basename(resolved).startsWith(prefix)) return;
  fs.rmSync(resolved, { recursive: true, force: true });
}

function writeFailureEvidence(outputDirectory, state, forbiddenSecret, report) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  if (state.lastRequestBody) {
    const requestFile = 'provider-request-failure-redacted.json';
    fs.writeFileSync(path.join(outputDirectory, requestFile),
      sanitizedArtifact(state.lastRequestBody, forbiddenSecret), { encoding: 'utf8', mode: 0o600 });
    report.failureRequest = requestFile;
  }
  if (state.lastResponseBody) {
    const responseFile = 'provider-response-failure-redacted.json';
    fs.writeFileSync(path.join(outputDirectory, responseFile),
      sanitizedArtifact(state.lastResponseBody, forbiddenSecret), { encoding: 'utf8', mode: 0o600 });
    report.failureResponse = responseFile;
  }
}

async function writeFailureUiState(panel, outputDirectory, forbiddenSecret, report) {
  let archive = null;
  try { archive = await currentArchive(panel); } catch (_) {}
  if (archive) {
    const file = 'current-archive-failure-redacted.json';
    fs.writeFileSync(path.join(outputDirectory, file),
      sanitizedArtifact(JSON.stringify(archive), forbiddenSecret), {
        encoding: 'utf8', mode: 0o600
      });
    report.failureArchive = file;
  }
  const visible = await panel.evaluate(() => {
    const selectors = [
      '#statusMessage', '#sidePanelNotificationHistory .side-panel-notification-item',
      '.workspace-figure-error', '.workspace-figure-progress',
      '.workspace-figure-summary-heading', '[role="alert"]'
    ];
    const values = [];
    for (const element of document.querySelectorAll(selectors.join(','))) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' ||
          Number(style.opacity) === 0 || rect.width < 1 || rect.height < 1) continue;
      const text = String(element.innerText || element.textContent || '').trim();
      if (!text) continue;
      values.push({
        selectorHint: element.id ? `#${element.id}` :
          [...element.classList].slice(0, 3).map(value => `.${value}`).join(''),
        text: text.slice(0, 4000)
      });
    }
    return values.slice(0, 100);
  }).catch(() => []);
  const file = 'visible-notifications-failure-redacted.json';
  fs.writeFileSync(path.join(outputDirectory, file),
    sanitizedArtifact(JSON.stringify({ visible }), forbiddenSecret), {
      encoding: 'utf8', mode: 0o600
    });
  report.failureVisibleNotifications = file;
}

function attachDiagnosticCapture(context, report, persistReport, forbiddenSecret = '') {
  const attached = new WeakSet();
  const attach = (surface, surfaceKind) => {
    if (!surface || attached.has(surface)) return;
    attached.add(surface);
    surface.on('console', message => {
      const text = String(message.text() || '');
      if (!text.startsWith('FIGURE_QA_DIAG ')) return;
      let detail;
      try { detail = JSON.parse(text.slice('FIGURE_QA_DIAG '.length)); }
      catch (_) { detail = { parseError: true }; }
      report.diagnostics.push({
        sequence: report.diagnostics.length + 1,
        surface: surfaceKind,
        detail: sanitizeArtifactValue(detail, forbiddenSecret)
      });
      persistReport();
    });
  };
  context.pages().forEach(page => attach(page, 'page'));
  context.serviceWorkers().forEach(worker => attach(worker, 'serviceworker'));
  context.on('page', page => attach(page, 'page'));
  context.on('serviceworker', worker => attach(worker, 'serviceworker'));
}

function clearKnownArtifacts(outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const file of [
    'report.json', 'live-figure-completed.png', 'live-figure-reloaded.png',
    'live-figure-failure.png', 'provider-request-failure-redacted.json',
    'provider-response-failure-redacted.json', 'current-archive-failure-redacted.json',
    'visible-notifications-failure-redacted.json'
  ]) {
    const target = path.join(outputDirectory, file);
    if (fs.existsSync(target) && fs.statSync(target).isFile()) fs.rmSync(target, { force: true });
  }
  for (const file of fs.readdirSync(outputDirectory)) {
    if (/^provider-(?:request|response)-\d{3}-redacted\.json$/u.test(file)) {
      fs.rmSync(path.join(outputDirectory, file), { force: true });
    }
  }
}

export function serializeProviderFetch(fetchImpl) {
  let previous = Promise.resolve();
  return (...args) => {
    const pending = previous.then(() => fetchImpl(...args));
    previous = pending.then(() => {}, () => {});
    return pending;
  };
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const transport = args.transport || 'node';
  if (!['node', 'curl'].includes(transport)) throw safeError('LIVE_FIGURE_TRANSPORT_INVALID');
  if (args.profileModelOverride && (!args.portableConfig || !args.profile ||
      args.profileModelOverride !== args.model)) throw safeError('LIVE_FIGURE_PROFILE_OVERRIDE_INVALID');
  const sourceInput = args.sourceManifest ? await prepareFigureInput(args) : null;
  if (!sourceInput && ['figure', 'provider', 'baseUrl', 'callCap', 'providerTimeoutMs',
    'deadlineMs', 'preflightOnly', 'bundleRuns', 'portableConfig', 'profile', 'transport',
    'profileModelOverride', 'serializeProvider'].some(key => Object.hasOwn(args, key))) {
    throw safeError('LIVE_FIGURE_SOURCE_REQUIRED');
  }
  const modelMode = sourceInput?.modelMode || String(args.model || process.env.SCI_LIVE_FIGURE_MODEL || 'text')
    .trim().toLowerCase();
  if (!sourceInput && !['text', 'pro', 'vision'].includes(modelMode)) {
    throw safeError('LIVE_FIGURE_MODEL_INVALID');
  }
  const selectedModel = sourceInput?.selectedModel || (modelMode === 'vision'
    ? 'deepseek-v4-flash-vision-exp'
    : modelMode === 'pro' ? 'deepseek-v4-pro' : 'deepseek-v4-flash');
  const extensionRoot = path.resolve(args.extensionRoot || (sourceInput ? '' : process.env.SCI_EXTENSION_ROOT) || projectRoot);
  const outputDirectory = path.resolve(args.outputDir || (sourceInput ? '' : process.env.SCI_QA_OUTPUT_DIR) ||
    path.join(projectRoot, `output/playwright/live-figure-extension-${modelMode}`));
  const replayDirectory = args.replayDir || (sourceInput ? '' : process.env.SCI_LIVE_FIGURE_REPLAY_DIR) || '';
  if (replayDirectory && path.resolve(replayDirectory) === outputDirectory) {
    throw safeError('LIVE_FIGURE_REPLAY_OUTPUT_CONFLICT');
  }
  const replayEntries = replayDirectory ? loadReplayEntries(replayDirectory) : null;
  const replayDelayMs = Number(args.replayDelayMs || 0);
  if (!Number.isInteger(replayDelayMs) || replayDelayMs < 0 || replayDelayMs > 5000) {
    throw safeError('LIVE_FIGURE_ARGUMENT_INVALID');
  }
  const strictReplay = args.strictReplay === 'true';
  const articlePath = args.article || (sourceInput ? '' : process.env.SCI_LIVE_ARTICLE_PATH) ||
    path.join(projectRoot, 'tmp/cell-live-acceptance/article.json');
  if (!fs.existsSync(path.join(extensionRoot, 'manifest.json'))) {
    throw safeError('LIVE_FIGURE_EXTENSION_ROOT_INVALID');
  }
  if (!fs.existsSync(articlePath)) throw safeError('LIVE_FIGURE_ARTICLE_NOT_FOUND');
  const article = sourceInput?.article || loadArticle(articlePath);
  const selectedFigures = sourceInput?.selectedFigures || article.figures.map(f => ({
    ...f, label: `Figure ${f.number}`, expectedPanels: expectedPanelsByNumber[f.number]
  }));
  if (sourceInput && args.bundleRuns) {
    if (args.preflightOnly) throw safeError('LIVE_FIGURE_MODE_CONFLICT');
    if (!args.outputDir) throw safeError('LIVE_FIGURE_OUTPUT_REQUIRED');
    return bundleFigureCaptures(sourceInput, args.bundleRuns.split(','), outputDirectory);
  }
  if (sourceInput && args.preflightOnly) return {
    outcome: { status: 'INPUT_READY' }, realApiCalls: 0, replayedCalls: 0,
    configuredModel: selectedModel, providerBaseUrl: sourceInput.baseUrl,
    networkTransport: transport,
    serializedProviderRequests: Boolean(args.serializeProvider),
    providerCallCap: sourceInput.callCap, providerTimeoutMs: sourceInput.timeoutMs,
    deadlineMs: sourceInput.deadlineMs, selectedFigureIds: selectedFigures.map(f => f.sourceId),
    sourceBinding: sourceInput.sourceBinding,
    article: { sourceMode: article.sourceMode, figureCount: article.figures.length,
      expectedPanelTotal: article.expectedPanelTotal }
  };
  if (sourceInput && (!args.outputDir || (fs.existsSync(outputDirectory) && fs.readdirSync(outputDirectory).length))) {
    throw safeError('LIVE_FIGURE_OUTPUT_NOT_EMPTY');
  }
  clearKnownArtifacts(outputDirectory);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-live-figure-profile-'));
  const temporaryExtension = fs.mkdtempSync(
    path.join(os.tmpdir(), 'brevess-live-figure-extension-')
  );
  const downloadedHashes = new Set(article.figures.map(figure => sha256(figure.imageBytes)));
  const report = {
    schemaVersion: 1,
    acceptance: replayEntries
      ? 'real Edge extension UI with saved sanitized provider-response replay'
      : 'real Edge extension UI and real DeepSeek API using selected Cell excerpts',
    fixtureBoundary: 'selected public paragraphs and full captions reconstructed locally; not full publisher DOM',
    provider: replayEntries ? 'replay' : 'deepseek',
    requestedModelMode: modelMode,
    configuredModel: selectedModel,
    networkTransport: transport,
    serializedProviderRequests: Boolean(args.serializeProvider),
    allowedEndpoints: [...allowedProviderPaths],
    providerCallCap: sourceInput?.callCap || providerCallCap,
    providerTimeoutMs: sourceInput?.timeoutMs || providerTimeoutMs,
    ...(sourceInput ? { sourceBinding: sourceInput.sourceBinding, providerBaseUrl: sourceInput.baseUrl,
      selectedFigureIds: selectedFigures.map(f => f.sourceId), deadlineMs: sourceInput.deadlineMs } : {}),
    replayDelayMs,
    strictReplay,
    realApiCalls: 0,
    replayedCalls: 0,
    callCapRejected: false,
    ...(replayEntries ? {
      replaySourceReportSha256: sha256(fs.readFileSync(
        path.join(path.resolve(replayDirectory), 'report.json')
      ))
    } : {}),
    article: {
      titleSha256: sha256(article.title),
      urlOrigin: new URL(article.url).origin,
      paragraphCount: article.paragraphs.length,
      ...(sourceInput ? { sourceMode: article.sourceMode, expectedPanelTotal: article.expectedPanelTotal } : {}),
      figures: article.figures.map(figure => ({
        number: figure.number,
        ...(sourceInput ? { sourceId: figure.sourceId, label: figure.label } : {}),
        captionChars: figure.caption.length,
        imageBytes: figure.imageBytes.length,
        imageSha256: sha256(figure.imageBytes)
      }))
    },
    sourceHashes: {},
    providerCalls: [],
    imageRouteLoads: Object.fromEntries(article.figures.map((_, i) => [`figure${i + 1}`, 0])),
    outcome: {
      status: 'FAIL',
      terminalErrorCode: '',
      terminalErrorMessage: '',
      figure1: null,
      figure2: null,
      distinctOperationReceipts: false,
      noPendingOrErrors: false,
      reloaded: false,
      visibleGeometry: null,
      reloadedVisibleGeometry: null
    },
    screenshots: [],
    diagnostics: [],
    settingsPageProfileRouting: 'not exercised by this Figure execution harness'
  };
  const state = {
    boundaryCalls: 0,
    providerCalls: 0,
    replayedCalls: 0,
    callCapRejected: false,
    boundaryErrorCode: '',
    lastRequestBody: '',
    lastResponseBody: ''
  };
  let secret = '';
  let proxy;
  let context;
  let panel;
  let deadline;
  let executionSettled = true;
  const startedAt = Date.now();
  const persistReport = () => writeReportNow(report, outputDirectory);
  persistReport();
  try {
    if (!replayEntries) {
      if (sourceInput && args.portableConfig) {
        const { loadLivePortableProfile } = await import('./lib/live-portable-profile.mjs');
        const selectedProfile = await loadLivePortableProfile(args.portableConfig, args.profile,
          { expectedModel: args.profileModelOverride ? undefined : selectedModel });
        const confirmed = await prepareFigureInput({ ...args,
          provider: selectedProfile.providerId, baseUrl: selectedProfile.baseUrl });
        if (confirmed.baseUrl !== sourceInput.baseUrl ||
            (!args.profileModelOverride && selectedProfile.model !== selectedModel)) {
          throw safeError('LIVE_FIGURE_PROFILE_MISMATCH');
        }
        secret = selectedProfile.apiKey;
        report.credentialInput = { mode: 'authorized portable config; memory-only key',
          sourceSha256: selectedProfile.sourceSha256, profileName: selectedProfile.name,
          savedModel: selectedProfile.model, requestedModel: selectedModel,
          explicitModelOverride: args.profileModelOverride || null };
      } else {
        secret = await readSecretFromTty({ prompt: `DeepSeek API key for live Figure ${modelMode}: ` });
      }
    }
    deadline = sourceInput ? createFigureDeadline(sourceInput.deadlineMs) : null;
    const directFetch = transport === 'curl'
      ? (await import('./lib/live-curl-fetch.mjs')).curlFetch : globalThis.fetch;
    const fetchImpl = args.serializeProvider ? serializeProviderFetch(directFetch) : directFetch;
    const execute = async () => {
    proxy = await startProxy({
      secret, report, state, downloadedHashes, outputDirectory, replayEntries,
      replayDelayMs, strictReplay, callCap: report.providerCallCap,
      timeoutMs: report.providerTimeoutMs, deadline,
      selectedModel, selectedFigures: sourceInput ? selectedFigures : null, fetchImpl
    });
    copyExtension(extensionRoot, temporaryExtension, proxy.url, report);
    persistReport();
    context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge',
      headless: sourceInput ? true : process.env.SCI_LIVE_HEADLESS !== '0',
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
      args: [
        `--disable-extensions-except=${temporaryExtension}`,
        `--load-extension=${temporaryExtension}`
      ]
    });
    if (deadline?.signal.aborted) {
      await context.close().catch(() => {});
      deadline.check();
    }
    attachDiagnosticCapture(context, report, persistReport, secret);
    await context.route(/^https?:\/\//u, async route => {
      const url = route.request().url();
      if (url === article.url) {
        await route.fulfill({ contentType: 'text/html', body: articleHtml(article) });
        return;
      }
      const imageIndex = article.figures.findIndex(figure => figure.publicImageUrl === url);
      if (imageIndex >= 0) {
        report.imageRouteLoads[`figure${imageIndex + 1}`] += 1;
        await route.fulfill({ contentType: 'image/jpeg', body: article.figures[imageIndex].imageBytes });
        return;
      }
      if (url.startsWith(proxy.url + '/')) {
        await route.continue();
        return;
      }
      await route.abort('blockedbyclient');
    });
    const paper = context.pages()[0] || await context.newPage();
    await paper.goto(article.url, { waitUntil: 'domcontentloaded' });
    await paper.waitForFunction(count => [...document.images].length === count &&
      [...document.images].every(image => image.complete && image.naturalWidth > 0 &&
        image.naturalHeight > 0), article.figures.length);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const tab = await worker.evaluate(async url =>
      (await chrome.tabs.query({})).find(item => item.url === url), article.url);
    assert.ok(tab?.id, 'live Figure article tab exists');
    await worker.evaluate(async activeTab => {
      const activation = await SciLLM.markTabActivated(chrome.storage.session, activeTab);
      await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
    }, tab);
    panel = await context.newPage();
    await panel.setViewportSize({ width: 480, height: 1000 });
    await panel.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded'
    });
    await paper.bringToFront();
    await panel.waitForFunction(expected =>
      document.getElementById('sidePanelPaperTitle')?.textContent === expected,
    article.title);
    await setupProfile(panel, selectedModel, sourceInput?.baseUrl);
    await panel.waitForFunction(count =>
      document.querySelectorAll('.workspace-figure-card[data-figure-id]').length === count, article.figures.length);
    const cards = await discoveredFigureCards(panel);
    const ids = sourceInput ? (await import('./lib/mechanism-acceptance-input.mjs')).matchMechanismFigureCards(
      cards.map(c => ({ id: c.figureId, label: c.label })), article.figures) :
      Object.fromEntries(selectedFigures.map(f => [f.sourceId, mapFigureIds(cards)[f.number]]));

    report.figureTimings = [];
    let completed;
    for (const figure of selectedFigures) {
      deadline?.check();
      const figureStartedAt = Date.now();
      completed = await clickSingleFigure(panel, ids[figure.sourceId], figure.expectedPanels,
        deadline?.remainingMs());
      report.figureTimings.push({ number: figure.number, sourceId: figure.sourceId,
        panelCount: figure.expectedPanels.length, elapsedMs: Date.now() - figureStartedAt });
    }
    const figures = archiveFigures(completed.archive);
    const selectedRecords = selectedFigures.map(f => figures.find(record => record.figureId === ids[f.sourceId]));
    const results = Object.fromEntries(selectedFigures.map((f, i) => {
      assert.ok(completedFigure(selectedRecords[i], f.expectedPanels), `${f.label} complete and substantive`);
      return [sourceInput ? f.sourceId : `figure${f.number}`, figureResult(selectedRecords[i])];
    }));
    fs.writeFileSync(path.join(outputDirectory, 'figure-results-redacted.json'),
      sanitizedArtifact(JSON.stringify(results), secret));
    report.outcome.figures = Object.fromEntries(selectedFigures.map((f, i) =>
      [f.sourceId, figureSummary(selectedRecords[i], f.expectedPanels)]));
    if (!sourceInput) {
      report.outcome.figure1 = report.outcome.figures[selectedFigures[0].sourceId];
      report.outcome.figure2 = report.outcome.figures[selectedFigures[1].sourceId];
    }
    const operationIds = selectedRecords.map(f => figureResult(f)?.operationId);
    report.outcome.distinctOperationReceipts = operationIds.every(Boolean) &&
      new Set(operationIds).size === operationIds.length;
    assert.ok(report.outcome.distinctOperationReceipts, 'sequential Figure receipts stay distinct');
    report.outcome.noPendingOrErrors = selectedRecords.every(figure =>
      !pendingStandardCheckpoint(figure) && !String(figure?.standardError || '') &&
      !String(figure?.deepError || '')
    );
    assert.ok(report.outcome.noPendingOrErrors, 'completed Figures clear errors and pending state');

    const figureRequests = report.providerCalls.map(call => call.request)
      .filter(request => request.figureId);
    assert.ok(figureRequests.length > 0, 'Figure provider requests were observed');
    assert.ok(figureRequests.every(request => request.model === selectedModel),
      'actual requests use selected model');
    if (modelMode !== 'vision') {
      assert.ok(report.providerCalls.every(call => call.request.imageCount === 0),
        'text model requests never contain images');
    } else {
      for (const figure of selectedFigures) {
        const id = ids[figure.sourceId];
        assert.ok(figureRequests.some(request => request.figureId === id &&
          request.imageCount > 0 && request.images.every(image =>
            image.bytes >= 10_000 && Number(image.width) > 0 && Number(image.height) > 0)),
        `vision ${figure.label} carries decoded real pixels`);
      }
    }
    assert.ok(Object.values(report.imageRouteLoads).every(count => count > 0),
      'all downloaded article images were served through their public URLs');
    if (replayEntries) {
      assert.equal(state.replayedCalls, replayEntries.length,
        'replay consumed the complete saved provider sequence');
    }

    const selectedIds = selectedFigures.map(f => ids[f.sourceId]);
    const selectedPanelCounts = selectedFigures.map(f => f.expectedPanels.length);
    await openFigureCards(panel, selectedIds);
    const workspaceText = await panel.locator('#figureWorkspace').innerText();
    assert.ok(!/FIGURE_[A-Z0-9_]+|解读失败|精读失败|重试失败/u.test(workspaceText),
      'completed Figure UI has no failure state');
    report.outcome.visibleGeometry = await visibleFigureGeometry(
      panel,
      selectedIds,
      selectedPanelCounts
    );
    const completedScreenshot = path.join(outputDirectory, 'live-figure-completed.png');
    await panel.screenshot({ path: completedScreenshot, fullPage: true });
    report.screenshots.push(completedScreenshot);

    const beforeReload = report.outcome.figures;
    await panel.reload({ waitUntil: 'domcontentloaded' });
    await paper.bringToFront();
    await panel.waitForFunction(expected =>
      document.getElementById('sidePanelPaperTitle')?.textContent === expected,
    article.title);
    await setupProfile(panel, selectedModel, sourceInput?.baseUrl);
    await panel.waitForFunction(count =>
      document.querySelectorAll('.workspace-figure-card[data-figure-id]').length === count, article.figures.length);
    const reloadedArchive = await currentArchive(panel);
    const reloadedFigures = archiveFigures(reloadedArchive);
    report.outcome.reloaded = selectedFigures.every((f, i) => {
      const record = reloadedFigures.find(item => item.figureId === ids[f.sourceId]);
      assert.ok(completedFigure(record, f.expectedPanels), `reloaded ${f.label} remains complete`);
      return figureSummary(record, f.expectedPanels).resultSha256 === beforeReload[f.sourceId].resultSha256 &&
        figureResult(record)?.operationId === operationIds[i] && !pendingStandardCheckpoint(record);
    });
    assert.ok(report.outcome.reloaded, 'reload preserves all selected complete Figure results');
    await openFigureCards(panel, selectedIds);
    const reloadedText = await panel.locator('#figureWorkspace').innerText();
    assert.ok(!/FIGURE_[A-Z0-9_]+|解读失败|精读失败|重试失败/u.test(reloadedText),
      'reloaded Figure UI has no failure state');
    report.outcome.reloadedVisibleGeometry = await visibleFigureGeometry(
      panel,
      selectedIds,
      selectedPanelCounts
    );
    const reloadScreenshot = path.join(outputDirectory, 'live-figure-reloaded.png');
    await panel.screenshot({ path: reloadScreenshot, fullPage: true });
    report.screenshots.push(reloadScreenshot);
    deadline?.check();
    report.outcome.status = 'PASS';
    };
    executionSettled = false;
    const executeTracked = () => execute().finally(() => { executionSettled = true; });
    if (deadline) await deadline.run(executeTracked);
    else await executeTracked();
  } catch (error) {
    report.errorCode = safeErrorCode(error);
    report.outcome.terminalErrorCode = String(error?.terminalErrorCode || '').slice(0, 100);
    report.outcome.terminalErrorMessage = redactString(
      String(error?.terminalErrorMessage || error?.message || ''), secret
    ).slice(0, 1000);
    if (panel) {
      await panel.waitForTimeout(250).catch(() => {});
      const failureScreenshot = path.join(outputDirectory, 'live-figure-failure.png');
      await panel.screenshot({ path: failureScreenshot, fullPage: true }).catch(() => {});
      if (fs.existsSync(failureScreenshot)) report.screenshots.push(failureScreenshot);
      await writeFailureUiState(panel, outputDirectory, secret, report);
    }
    writeFailureEvidence(outputDirectory, state, secret, report);
    persistReport();
    throw error;
  } finally {
    deadline?.dispose();
    report.realApiCalls = state.providerCalls;
    report.replayedCalls = state.replayedCalls;
    report.callCapRejected = state.callCapRejected;
    report.boundaryErrorCode = state.boundaryErrorCode;
    report.elapsedMs = Date.now() - startedAt;
    secret = '';
    await context?.close().catch(() => {});
    if (proxy?.server) await new Promise(resolve => proxy.server.close(resolve));
    report.cleanupStatus = executionSettled ? 'closed' : 'temporary-files-retained-pending-close';
    writeReportNow(report, outputDirectory);
    if (executionSettled) {
      safeTemporaryRemoval(profile, 'brevess-live-figure-profile-');
      safeTemporaryRemoval(temporaryExtension, 'brevess-live-figure-extension-');
    }
  }
  return report;
}

const directExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directExecution) {
  run().then(report => {
    process.stdout.write(`${JSON.stringify({
      status: report.outcome.status,
      modelMode: report.requestedModelMode,
      configuredModel: report.configuredModel,
      realApiCalls: report.realApiCalls,
      replayedCalls: report.replayedCalls,
      callCapRejected: report.callCapRejected,
      figure1Panels: report.outcome.figure1?.panelCount || 0,
      figure2Panels: report.outcome.figure2?.panelCount || 0,
      reloaded: report.outcome.reloaded,
      ...(report.selectedFigureIds ? { selectedFigureIds: report.selectedFigureIds,
        selectedPanels: Object.values(report.outcome.figures || {}).reduce((sum, f) => sum + f.panelCount, 0),
        sourcePanelTotal: report.article?.expectedPanelTotal } : {})
    })}\n`);
  }).catch(error => {
    process.stderr.write(`FAIL ${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  run,
  parseArguments,
  prepareFigureInput,
  bundleFigureCaptures,
  articleHtml,
  escapeHtml,
  startProxy,
  loadArticle,
  safeRequestShape,
  sanitizedArtifact,
  imageDimensions,
  panelsAreSubstantive,
  copyExtension,
  loadReplayEntries,
  assertReplayMatch,
  takeReplayEntry
};
