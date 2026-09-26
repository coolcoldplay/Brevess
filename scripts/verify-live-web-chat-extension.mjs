// Real-provider acceptance for the packaged extension. The browser uses an isolated
// profile and the extension runs its production content/background/offscreen/storage
// chain. A loopback proxy replaces a dummy bearer with a TTY-only in-memory secret;
// it never mocks or rewrites the provider response.
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
const projectRoot = path.resolve(scriptDirectory, '..');
const question = '联网检索一下这篇文献的通讯作者的既往研究工作，分析这篇论文与它们有什么联系';
const defaultFollowupQuestion = '查一下末尾通讯作者的代表性论文有哪些,列表格总结';
const providerEndpoint = 'https://api.deepseek.com/responses';
const providerModel = 'deepseek-v4-flash';
const dummySecret = 'live-proxy-dummy-not-a-real-key';
// Two user questions, each with at most one known search-result finalization.
const providerCallCap = 4;
const providerTimeoutMs = 180_000;
const maxRequestBytes = 4 * 1024 * 1024;
const maxResponseBytes = 12 * 1024 * 1024;
const maxArticleBytes = 8 * 1024 * 1024;
const terminalStatuses = new Set([
  'completed', 'failed', 'error', 'incomplete', 'truncated', 'cancelled', 'interrupted'
]);

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--direct-browser-network') {
      result.directBrowserNetwork = true;
      continue;
    }
    if (value === '--followup') {
      const next = argv[index + 1];
      result.followup = next && !next.startsWith('--') ? next : defaultFollowupQuestion;
      if (next && !next.startsWith('--')) index += 1;
      continue;
    }
    if (!['--article', '--extension-root', '--output-dir', '--replay-dir'].includes(value)) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw safeError('LIVE_ARGUMENT_INVALID');
    result[value.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = next;
    index += 1;
  }
  return result;
}

function exactProviderEndpoint(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' &&
      parsed.origin === 'https://api.deepseek.com' && parsed.pathname === '/responses' &&
      parsed.search === '' && parsed.hash === '';
  } catch (_) {
    return false;
  }
}

function safeError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^[A-Z][A-Z0-9_]{2,80}$/u.test(code) ? code : 'LIVE_ACCEPTANCE_FAILED';
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

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeParagraph(value, index) {
  const tuple = Array.isArray(value) ? value : null;
  const record = isPlainRecord(value) ? value : {};
  const id = String(tuple?.[0] ?? record.id ?? record.paragraphId ?? `p${index + 1}`)
    .trim().slice(0, 160) || `p${index + 1}`;
  const section = String(tuple?.[1] ?? record.section ?? record.sectionTitle ?? 'Article')
    .trim().slice(0, 500) || 'Article';
  const text = String(tuple?.[2] ?? record.text ?? '').trim();
  if (!text || byteLength(text) > 250_000) throw safeError('LIVE_ARTICLE_INVALID');
  return { id, section, text };
}

function imageDataUrl(image, articleDirectory) {
  const value = String(image || '').trim();
  if (!value) return '';
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/u.test(value)) {
    if (byteLength(value) > 8 * 1024 * 1024) throw safeError('LIVE_ARTICLE_INVALID');
    return value;
  }
  if (/^https:\/\//u.test(value)) return value;
  const resolved = path.resolve(articleDirectory, value);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size > 6 * 1024 * 1024) throw safeError('LIVE_ARTICLE_INVALID');
  const extension = path.extname(resolved).toLowerCase();
  const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif' })[extension];
  if (!mime) throw safeError('LIVE_ARTICLE_INVALID');
  return `data:${mime};base64,${fs.readFileSync(resolved).toString('base64')}`;
}

function loadArticle(articlePath) {
  const absolutePath = path.resolve(articlePath);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile() || stat.size < 2 || stat.size > maxArticleBytes) {
    throw safeError('LIVE_ARTICLE_INVALID');
  }
  const raw = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  if (!isPlainRecord(raw)) throw safeError('LIVE_ARTICLE_INVALID');
  const title = String(raw.title || '').trim().slice(0, 1000);
  const requestedUrl = String(raw.url || '').trim();
  let url = 'https://example.org/brevess-live-cell-article';
  if (/^https:\/\//u.test(requestedUrl)) {
    const parsed = new URL(requestedUrl);
    if (parsed.username || parsed.password) throw safeError('LIVE_ARTICLE_INVALID');
    parsed.hash = '';
    url = parsed.href;
  }
  const paragraphs = (Array.isArray(raw.paragraphs) ? raw.paragraphs : [])
    .map(normalizeParagraph);
  if (!title || paragraphs.length < 1 || paragraphs.length > 5000) {
    throw safeError('LIVE_ARTICLE_INVALID');
  }
  const articleDirectory = path.dirname(absolutePath);
  const figures = (Array.isArray(raw.figures) ? raw.figures : []).slice(0, 300)
    .map((figure, index) => {
      const tuple = Array.isArray(figure) ? figure : null;
      const record = isPlainRecord(figure) ? figure : {};
      return {
        id: String(tuple?.[0] ?? record.id ?? record.figureId ?? `figure-${index + 1}`)
          .trim().slice(0, 160) || `figure-${index + 1}`,
        title: String(tuple?.[1] ?? record.title ?? record.figureTitle ?? `Figure ${index + 1}`)
          .trim().slice(0, 500),
        caption: String(tuple?.[2] ?? record.caption ?? '').trim().slice(0, 100_000),
        image: imageDataUrl(tuple?.[3] ?? record.image ?? record.imageUrl ?? '', articleDirectory)
      };
    });
  const correspondingAuthors = (Array.isArray(raw.correspondingAuthors) ? raw.correspondingAuthors : [])
    .filter(value => typeof value === 'string').map(value => value.slice(0, 200));
  return { absolutePath, title, url, paragraphs, figures, correspondingAuthors };
}

function articleHtml(article) {
  const paragraphs = article.paragraphs.map(item =>
    `<section data-section="${escapeHtml(item.section)}"><h2>${escapeHtml(item.section)}</h2>` +
    `<p id="${escapeHtml(item.id)}">${escapeHtml(item.text)}</p></section>`
  ).join('\n');
  const figures = article.figures.map(item =>
    `<figure id="${escapeHtml(item.id)}">` +
    (item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}">` : '') +
    `<figcaption><strong>${escapeHtml(item.title)}</strong> ${escapeHtml(item.caption)}</figcaption>` +
    '</figure>'
  ).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(article.title)}</title>` +
    `<link rel="canonical" href="${escapeHtml(article.url)}"></head><body><main><article>` +
    `<h1>${escapeHtml(article.title)}</h1>` +
    (article.correspondingAuthors.length ? `<p>Corresponding authors: ${article.correspondingAuthors.map(escapeHtml).join('; ')}</p>` : '') +
    `${paragraphs}${figures}</article></main></body></html>`;
}

function safeUsage(raw) {
  const usage = isPlainRecord(raw?.usage) ? raw.usage : {};
  const number = (...keys) => {
    for (const key of keys) {
      const value = usage[key];
      if (Number.isSafeInteger(value) && value >= 0) return value;
    }
    return null;
  };
  const details = isPlainRecord(usage.output_tokens_details)
    ? usage.output_tokens_details : isPlainRecord(usage.completion_tokens_details)
      ? usage.completion_tokens_details : {};
  const reasoning = Number.isSafeInteger(details.reasoning_tokens) && details.reasoning_tokens >= 0
    ? details.reasoning_tokens : null;
  return {
    input: number('input_tokens', 'prompt_tokens'),
    output: number('output_tokens', 'completion_tokens'),
    reasoning
  };
}

function safeRequestShape(body) {
  const input = body?.input;
  const inputChars = typeof input === 'string' ? input.length : JSON.stringify(input ?? '').length;
  return {
    topLevelKeys: isPlainRecord(body) ? Object.keys(body).sort().slice(0, 40) : [],
    model: typeof body?.model === 'string' ? body.model.slice(0, 200) : '',
    toolTypes: Array.isArray(body?.tools)
      ? body.tools.map(tool => String(tool?.type || '')).slice(0, 8) : [],
    toolChoice: typeof body?.tool_choice === 'string'
      ? body.tool_choice : String(body?.tool_choice?.type || ''),
    stream: body?.stream === true,
    store: body?.store === true,
    inputKind: Array.isArray(input) ? 'array' : typeof input,
    inputChars,
    instructionsChars: typeof body?.instructions === 'string' ? body.instructions.length : 0,
    maxOutputTokens: Number.isSafeInteger(body?.max_output_tokens)
      ? body.max_output_tokens : null
  };
}

function redactSecretPatterns(value) {
  return String(value || '')
    .replace(/\bsk-[A-Za-z0-9_-]{3,}\b/gu, '[REDACTED_SECRET]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{3,}/giu, 'Bearer [REDACTED_SECRET]');
}

function sanitizeReplayValue(value, depth = 0) {
  if (depth > 24) return '[TRUNCATED_DEPTH]';
  if (Array.isArray(value)) return value.slice(0, 2000)
    .map(item => sanitizeReplayValue(item, depth + 1));
  if (!isPlainRecord(value)) {
    return typeof value === 'string' ? redactSecretPatterns(value) : value;
  }
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(?:authorization|api.?key|secret|credential|(?:^|_)tokens?(?:_|$))/iu.test(key)) continue;
    output[key] = sanitizeReplayValue(child, depth + 1);
  }
  return output;
}

function sanitizedReplay(text) {
  let value;
  try { value = sanitizeReplayValue(JSON.parse(text)); }
  catch (_) { value = { redacted_non_json_response: redactSecretPatterns(text).slice(0, maxResponseBytes) }; }
  const serialized = JSON.stringify(value, null, 2);
  if (/\bsk-[A-Za-z0-9_-]{3,}\b|Bearer\s+(?!\[REDACTED_SECRET\])/iu.test(serialized)) {
    throw safeError('LIVE_REDACTION_FAILED');
  }
  return `${serialized}\n`;
}

function readBoundedRequest(request, maximumBytes = maxRequestBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maximumBytes) {
        reject(safeError('LIVE_REQUEST_TOO_LARGE'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks, size).toString('utf8')));
    request.on('error', () => reject(safeError('LIVE_PROXY_REQUEST_FAILED')));
  });
}

async function readBoundedResponse(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (byteLength(text) > maxResponseBytes) throw safeError('LIVE_RESPONSE_TOO_LARGE');
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
      throw safeError('LIVE_RESPONSE_TOO_LARGE');
    }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

function redactKnownSecret(value, secret) {
  const text = redactSecretPatterns(value);
  return secret && text.includes(secret) ? text.split(secret).join('[REDACTED_SECRET]') : text;
}

function sanitizeDiagnosticValue(value, secret, depth = 0) {
  if (depth > 16) return '[TRUNCATED_DEPTH]';
  if (Array.isArray(value)) return value.slice(0, 200)
    .map(item => sanitizeDiagnosticValue(item, secret, depth + 1));
  if (!isPlainRecord(value)) {
    return typeof value === 'string' ? redactKnownSecret(value, secret).slice(0, maxResponseBytes) : value;
  }
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(?:authorization|headers?|api.?key|secret|credential)/iu.test(key)) continue;
    output[key] = sanitizeDiagnosticValue(child, secret, depth + 1);
  }
  return output;
}

function directBrowserNetworkBootstrap(config) {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const officialEndpoint = String(config.providerEndpoint);
  const brokerBase = String(config.brokerUrl);
  const brokerToken = String(config.brokerToken);
  const dummy = String(config.dummySecret);
  const callCap = Number(config.callCap) || 2;
  const maxBodyBytes = Number(config.maxResponseBytes) || (12 * 1024 * 1024);
  let secretPromise = null;
  let actualCalls = 0;

  const redact = value => String(value || '')
    .replace(/\bsk-[A-Za-z0-9_-]{3,}\b/gu, '[REDACTED_SECRET]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{3,}/giu, 'Bearer [REDACTED_SECRET]');
  const errorRecord = error => ({
    name: redact(error?.name || 'TypeError').slice(0, 120),
    message: redact(error?.message || 'Failed to fetch').slice(0, 2000),
    causeName: redact(error?.cause?.name || '').slice(0, 120),
    causeMessage: redact(error?.cause?.message || '').slice(0, 2000)
  });
  const brokerFetch = async (pathname, options = {}) => nativeFetch(`${brokerBase}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Live-Broker-Token': brokerToken }
  });
  const postDiagnostic = async payload => {
    try {
      await brokerFetch('/diagnostic', { method: 'POST', body: JSON.stringify(payload) });
    } catch (_) {
      // Diagnostics must never replace or synthesize the production fetch result.
    }
  };
  const readSecret = async () => {
    const response = await brokerFetch('/secret', { method: 'GET' });
    if (!response.ok) throw new Error('LIVE_DIRECT_SECRET_BROKER_FAILED');
    const payload = await response.json();
    const value = String(payload?.secret || '');
    if (!value) throw new Error('LIVE_DIRECT_SECRET_BROKER_FAILED');
    return value;
  };
  const boundedCloneText = async response => {
    const reader = response.clone().body?.getReader?.();
    if (!reader) {
      const text = await response.clone().text();
      if (new TextEncoder().encode(text).length > maxBodyBytes) {
        throw new Error('LIVE_DIRECT_RESPONSE_TOO_LARGE');
      }
      return text;
    }
    const chunks = [];
    let size = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maxBodyBytes) {
        try { await reader.cancel(); } catch (_) {}
        throw new Error('LIVE_DIRECT_RESPONSE_TOO_LARGE');
      }
      chunks.push(item.value);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(joined);
  };

  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url));
    if (parsed.href !== officialEndpoint) throw new Error('LIVE_QA_BLOCKED_REMOTE_FETCH');
    actualCalls += 1;
    const sequence = actualCalls;
    if (sequence > callCap) {
      await postDiagnostic({ phase: 'call-cap-rejected', sequence, elapsedMs: 0 });
      throw new Error('LIVE_PROVIDER_CALL_CAP');
    }
    const startedAt = Date.now();
    const body = typeof options.body === 'string' ? options.body : '';
    await postDiagnostic({
      phase: 'request-start', sequence, elapsedMs: 0,
      endpoint: officialEndpoint, requestBody: body
    });
    try {
      secretPromise ||= readSecret();
      const secret = await secretPromise;
      const headers = new Headers(options.headers || {});
      if (headers.get('Authorization') !== `Bearer ${dummy}`) {
        throw new Error('LIVE_DIRECT_DUMMY_KEY_MISMATCH');
      }
      headers.set('Authorization', `Bearer ${secret}`);
      await postDiagnostic({
        phase: 'provider-fetch-start', sequence,
        elapsedMs: Math.max(0, Date.now() - startedAt)
      });
      const response = await nativeFetch(officialEndpoint, { ...options, headers });
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      await postDiagnostic({
        phase: 'response-headers', sequence, elapsedMs,
        status: response.status, ok: response.ok,
        contentType: response.headers.get('Content-Type') || ''
      });
      try {
        const responseBody = await boundedCloneText(response);
        await postDiagnostic({
          phase: 'response-complete', sequence,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          status: response.status, ok: response.ok, responseBody
        });
      } catch (error) {
        await postDiagnostic({
          phase: 'response-body-error', sequence,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          status: response.status, error: errorRecord(error)
        });
      }
      return response;
    } catch (error) {
      await postDiagnostic({
        phase: 'request-error', sequence,
        elapsedMs: Math.max(0, Date.now() - startedAt), status: 0,
        error: errorRecord(error)
      });
      throw error;
    }
  };
}

function directNetworkBoundarySource(config) {
  return `;(${directBrowserNetworkBootstrap.toString()})(${JSON.stringify(config)});\n`;
}

async function startDirectBroker(secret, report, liveState, outputDirectory, flushReport) {
  const brokerToken = crypto.randomBytes(24).toString('hex');
  let availableSecret = secret;
  const knownSecret = secret;
  const callsBySequence = new Map();
  const server = http.createServer(async (request, reply) => {
    reply.setHeader('Access-Control-Allow-Origin', '*');
    reply.setHeader('Access-Control-Allow-Headers', 'content-type,x-live-broker-token');
    reply.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (request.headers['access-control-request-private-network'] === 'true') {
      reply.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (request.method === 'OPTIONS') {
      reply.writeHead(204);
      reply.end();
      return;
    }
    try {
      const remote = String(request.socket.remoteAddress || '');
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) ||
          request.headers['x-live-broker-token'] !== brokerToken) {
        throw safeError('LIVE_BROKER_REQUEST_REJECTED');
      }
      if (request.method === 'GET' && request.url === '/secret') {
        if (liveState.keyReads !== 0 || !availableSecret) throw safeError('LIVE_BROKER_SECRET_CONSUMED');
        liveState.keyReads += 1;
        const payload = JSON.stringify({ secret: availableSecret });
        reply.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        reply.end(payload);
        availableSecret = '';
        await flushReport();
        return;
      }
      if (request.method !== 'POST' || request.url !== '/diagnostic') {
        throw safeError('LIVE_BROKER_REQUEST_REJECTED');
      }
      const raw = await readBoundedRequest(request, maxRequestBytes + maxResponseBytes + 256 * 1024);
      const diagnostic = sanitizeDiagnosticValue(JSON.parse(raw), knownSecret);
      const sequence = Number(diagnostic.sequence);
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > providerCallCap + 1) {
        throw safeError('LIVE_DIAGNOSTIC_INVALID');
      }
      if (diagnostic.phase === 'call-cap-rejected') {
        liveState.callCapRejected = true;
      } else {
        let record = callsBySequence.get(sequence);
        if (diagnostic.phase === 'request-start') {
          if (record || callsBySequence.size >= providerCallCap ||
              !exactProviderEndpoint(diagnostic.endpoint)) {
            throw safeError('LIVE_DIAGNOSTIC_INVALID');
          }
          let body;
          try { body = JSON.parse(String(diagnostic.requestBody || '')); } catch (_) {
            throw safeError('LIVE_REQUEST_SHAPE_INVALID');
          }
          const shape = safeRequestShape(body);
          if (shape.model !== providerModel || !shape.toolTypes.includes('web_search') ||
              shape.stream || shape.inputChars < 1) throw safeError('LIVE_REQUEST_SHAPE_INVALID');
          record = {
            sequence, transport: 'chromium-fetch', request: shape, status: null,
            elapsedMs: null, responseBytes: null,
            usage: { input: null, output: null, reasoning: null },
            diagnostics: [{ phase: 'request', status: 0, elapsedMs: 0 }]
          };
          callsBySequence.set(sequence, record);
          report.providerCalls.push(record);
          liveState.lastProviderRequestBody = String(diagnostic.requestBody || '');
          fs.mkdirSync(outputDirectory, { recursive: true });
          fs.writeFileSync(path.join(outputDirectory, `provider-request-turn-${sequence}-redacted.json`),
            sanitizedReplay(liveState.lastProviderRequestBody), { encoding: 'utf8', mode: 0o600 });
        } else {
          if (!record) throw safeError('LIVE_DIAGNOSTIC_INVALID');
          const status = Number.isInteger(diagnostic.status) ? diagnostic.status : 0;
          record.elapsedMs = Number.isFinite(diagnostic.elapsedMs)
            ? Math.max(0, Math.round(diagnostic.elapsedMs)) : record.elapsedMs;
          if (status) record.status = status;
          if (diagnostic.phase === 'provider-fetch-start') {
            if (record.actualProviderCall === true || liveState.providerCalls >= providerCallCap) {
              throw safeError('LIVE_DIAGNOSTIC_INVALID');
            }
            record.actualProviderCall = true;
            liveState.providerCalls += 1;
            record.diagnostics.push({ phase: 'provider-fetch-start', status: 0,
              elapsedMs: record.elapsedMs });
          } else if (diagnostic.phase === 'response-headers') {
            record.diagnostics.push({ phase: 'response-headers', status, elapsedMs: record.elapsedMs });
          } else if (diagnostic.phase === 'response-complete') {
            const responseBody = String(diagnostic.responseBody || '');
            liveState.lastProviderResponseBody = responseBody;
            record.responseBytes = byteLength(responseBody);
            record.diagnostics.push({ phase: 'response-complete', status, elapsedMs: record.elapsedMs });
            record.transportOutcome = status >= 200 && status < 300 ? 'http-success' : 'provider-http-error';
            try { record.usage = safeUsage(JSON.parse(responseBody)); } catch (_) {}
            fs.mkdirSync(outputDirectory, { recursive: true });
            fs.writeFileSync(path.join(outputDirectory, `provider-response-turn-${sequence}-redacted.json`),
              sanitizedReplay(responseBody), { encoding: 'utf8', mode: 0o600 });
          } else if (diagnostic.phase === 'request-error') {
            record.status = 0;
            record.transportOutcome = 'request-before-response-failure';
            record.diagnostics.push({
              phase: 'request', status: 0, elapsedMs: record.elapsedMs,
              error: sanitizeDiagnosticValue(diagnostic.error, knownSecret)
            });
          } else if (diagnostic.phase === 'response-body-error') {
            record.transportOutcome = 'response-body-failure';
            record.diagnostics.push({
              phase: 'response-body', status, elapsedMs: record.elapsedMs,
              error: sanitizeDiagnosticValue(diagnostic.error, knownSecret)
            });
          } else {
            throw safeError('LIVE_DIAGNOSTIC_INVALID');
          }
        }
      }
      reply.writeHead(204);
      reply.end();
      await flushReport();
    } catch (error) {
      const code = safeErrorCode(error);
      reply.writeHead(502, { 'Content-Type': 'application/json' });
      reply.end(JSON.stringify({ error: { code } }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    brokerToken,
    url: `http://127.0.0.1:${server.address().port}`,
    clearSecret() { availableSecret = ''; }
  };
}

async function startProxy(secret, report, liveState) {
  const server = http.createServer(async (request, reply) => {
    reply.setHeader('Access-Control-Allow-Origin', '*');
    reply.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
    if (request.method === 'OPTIONS') {
      reply.writeHead(204);
      reply.end();
      return;
    }
    try {
      const remote = String(request.socket.remoteAddress || '');
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) ||
          request.method !== 'POST' || request.url !== '/responses' ||
          request.headers.authorization !== `Bearer ${dummySecret}`) {
        throw safeError('LIVE_PROXY_REQUEST_REJECTED');
      }
      if (liveState.providerCalls >= providerCallCap) {
        liveState.callCapRejected = true;
        reply.writeHead(429, { 'Content-Type': 'application/json' });
        reply.end(JSON.stringify({ error: { code: 'LIVE_PROVIDER_CALL_CAP' } }));
        return;
      }
      const bodyText = await readBoundedRequest(request);
      const body = JSON.parse(bodyText);
      liveState.lastProviderRequestBody = bodyText;
      const shape = safeRequestShape(body);
      if (shape.model !== providerModel || !shape.toolTypes.includes('web_search') ||
          shape.stream || shape.inputChars < 1) {
        throw safeError('LIVE_REQUEST_SHAPE_INVALID');
      }
      liveState.providerCalls += 1;
      const record = {
        sequence: liveState.providerCalls,
        request: shape,
        status: null,
        elapsedMs: null,
        responseBytes: null,
        usage: { input: null, output: null, reasoning: null }
      };
      report.providerCalls.push(record);
      if (liveState.replay) {
        // Reuse exactly the saved provider body and match the recorded request
        // contract. Older captures record shape, not the full article payload.
        const replay = liveState.replay;
        if (liveState.providerCalls !== 1 || body.model !== replay.body.model ||
            body.instructions !== replay.body.instructions ||
            (replay.originalRequest && body.input !== replay.originalRequest.input) ||
            JSON.stringify(shape) !== JSON.stringify(replay.request)) {
          throw safeError('LIVE_REPLAY_REQUEST_MISMATCH');
        }
        Object.assign(record, { status: replay.status, elapsedMs: 0,
          responseBytes: byteLength(replay.text), replayed: true });
        liveState.lastProviderResponseBody = replay.text;
        reply.writeHead(replay.status, { 'Content-Type': 'application/json' });
        reply.end(replay.text);
        return;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
      const startedAt = Date.now();
      let providerResponse;
      try {
        providerResponse = await fetch(providerEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: bodyText,
          signal: controller.signal
        });
        record.status = providerResponse.status;
        const responseText = await readBoundedResponse(providerResponse);
        liveState.lastProviderResponseBody = responseText;
        record.elapsedMs = Date.now() - startedAt;
        record.responseBytes = byteLength(responseText);
        try { record.usage = safeUsage(JSON.parse(responseText)); } catch (_) {}
        reply.writeHead(providerResponse.status, {
          'Content-Type': providerResponse.headers.get('content-type') || 'application/json'
        });
        reply.end(responseText);
      } catch (error) {
        record.elapsedMs = Date.now() - startedAt;
        record.errorCode = error?.name === 'AbortError'
          ? 'LIVE_PROVIDER_TIMEOUT'
          : safeErrorCode(error) === 'LIVE_ACCEPTANCE_FAILED'
            ? 'LIVE_PROVIDER_FETCH_FAILED' : safeErrorCode(error);
        throw safeError(record.errorCode);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const code = safeErrorCode(error);
      if (!reply.headersSent) reply.writeHead(code === 'LIVE_PROVIDER_CALL_CAP' ? 429 : 502, {
        'Content-Type': 'application/json'
      });
      if (!reply.writableEnded) reply.end(JSON.stringify({ error: { code } }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function copyExtension(extensionRoot, temporaryExtension, networkOptions, report) {
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
  const sourceFiles = [
    'content.js', 'popup.js', 'background.js', 'offscreen-network-worker.js',
    'core/article-chat-web-sources.js', 'core/article-chat.js', 'core/article-archive.js',
    'core/background-router.js', 'providers/deepseek.js'
  ];
  for (const file of sourceFiles) {
    const source = path.join(temporaryExtension, file);
    if (fs.existsSync(source)) report.sourceHashes[file] = sha256(fs.readFileSync(source));
  }
  const networkFile = path.join(temporaryExtension, 'offscreen-network-worker.js');
  const boundary = networkOptions.mode === 'direct'
    ? directNetworkBoundarySource({
        providerEndpoint,
        brokerUrl: networkOptions.url,
        brokerToken: networkOptions.brokerToken,
        dummySecret,
        callCap: providerCallCap,
        maxResponseBytes
      })
    : `const liveQaNativeFetch = globalThis.fetch.bind(globalThis);\n` +
      `globalThis.fetch = (url, options = {}) => {\n` +
      `  const parsed = new URL(String(url));\n` +
      `  if (parsed.origin !== 'https://api.deepseek.com' || parsed.pathname !== '/responses') {\n` +
      `    throw new Error('LIVE_QA_BLOCKED_REMOTE_FETCH');\n` +
      `  }\n` +
      `  return liveQaNativeFetch(${JSON.stringify(networkOptions.url)} + '/responses', options);\n` +
      `};\n`;
  fs.writeFileSync(networkFile, boundary + fs.readFileSync(networkFile, 'utf8'));
  report.testBoundary = networkOptions.mode === 'direct'
    ? 'temporary offscreen worker -> native Chromium fetch -> official DeepSeek endpoint'
    : 'temporary offscreen fetch boundary -> loopback transparent live proxy';
}

async function setupProfile(panel) {
  return panel.evaluate(async ({ model, dummy }) => {
    for (const message of [
      {
        type: 'LLM_SAVE_PROFILE',
        profile: {
          id: 'profile_live_web_acceptance',
          name: 'Live DeepSeek web acceptance',
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
        globalProfileId: 'profile_live_web_acceptance',
        taskRoutes: {}
      },
      {
        type: 'LLM_UPDATE_PREFERENCES',
        preferences: { mode: 'llm', consentGranted: true }
      }
    ]) {
      const response = await chrome.runtime.sendMessage(message);
      if (response?.success !== true) throw new Error('LIVE_PROFILE_SETUP_FAILED');
    }
    await loadLlmSettings();
    await refreshArticleWorkspace();
    switchWorkspaceView('chat');
    const select = document.getElementById('articleChatProfile');
    select.value = 'profile_live_web_acceptance';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, { model: providerModel, dummy: dummySecret });
}

async function currentArchive(panel) {
  return panel.evaluate(async () => (await getCurrentArticleArchiveFromTab()).archive);
}

async function verifyVisibleAnswer(panel, turnId) {
  // A popup opened as a background test tab may freeze entry animations at
  // opacity zero. The context requests the application's supported reduced-
  // motion setting; do not activate this tab and change its article context.
  const selector = `.article-chat-turn[data-turn-id="${String(turnId).replace(/["\\]/gu, '\\$&')}"]`;
  await panel.locator(selector).locator('.article-chat-answer-block').first().waitFor();
  await panel.locator(selector).scrollIntoViewIfNeeded();
  await panel.waitForFunction(targetSelector => {
    const block = document.querySelector(targetSelector)?.querySelector('.article-chat-answer-block');
    const container = document.getElementById('articleChatMessages');
    if (!block || !container) return false;
    const rect = block.getBoundingClientRect();
    const bounds = container.getBoundingClientRect();
    return rect.width > 100 && rect.height > 20 && rect.top < bounds.bottom &&
      rect.bottom > bounds.top && Number(getComputedStyle(block).opacity) > 0.9;
  }, selector);
  return panel.evaluate(targetSelector => ({
    visibleBlockCount: [...document.querySelectorAll(`${targetSelector} .article-chat-answer-block`)]
      .filter(el => Number(getComputedStyle(el).opacity) > 0.9 && el.getBoundingClientRect().height > 20).length,
    firstBlockTextChars: document.querySelector(`${targetSelector} .article-chat-answer-block`)?.innerText.length || 0,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
  }), selector);
}

async function waitForTerminalTurn(panel, expectedTurnCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastArchive = null;
  while (Date.now() < deadline) {
    try {
      lastArchive = await currentArchive(panel);
      const turns = lastArchive?.workspace?.chat?.turns || [];
      if (turns.length === expectedTurnCount && terminalStatuses.has(turns.at(-1)?.status)) {
        return { archive: lastArchive, turn: turns.at(-1) };
      }
    } catch (error) {
      if (!/ARTICLE_ARCHIVE_DOCUMENT_NOT_READY/u.test(String(error?.message || ''))) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw safeError('LIVE_UI_TIMEOUT', {
    turnStatus: lastArchive?.workspace?.chat?.turns?.at(-1)?.status || ''
  });
}

function classifyTurn(turn) {
  const trusted = Boolean(turn?.webGrounding?.receiptId) &&
    turn?.webSearch?.enabled === true && turn?.webSearch?.searched === true;
  const unverified = turn?.answerProvenance?.origin === 'provider_unverified' &&
    turn?.answerProvenance?.verification === 'unverified' &&
    turn?.webSearch?.enabled === true && turn?.webSearch?.searched === false &&
    !turn?.webGrounding;
  return trusted ? 'trusted' : unverified ? 'provider_unverified' : 'unclassified';
}

function safeTurnErrorCode(turn) {
  for (const candidate of [turn?.errorCode, turn?.error?.code, turn?.lastError?.code]) {
    if (typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{2,80}$/u.test(candidate)) {
      return candidate;
    }
  }
  return '';
}

function summarizeTurn(turn, submittedQuestion, index) {
  const blocks = Array.isArray(turn?.answerBlocks) ? turn.answerBlocks : [];
  const answerChars = blocks.reduce((total, block) =>
    total + String(block?.markdown || '').length, 0);
  const classification = classifyTurn(turn);
  return {
    index,
    turnId: String(turn?.turnId || '').slice(0, 200),
    question: String(submittedQuestion || '').slice(0, 4000),
    turnStatus: String(turn?.status || '').slice(0, 40),
    classification,
    answerBlockCount: blocks.length,
    answerChars,
    saved: turn?.status === 'completed' && blocks.length > 0 && answerChars > 100,
    reloaded: false,
    turnErrorCode: safeTurnErrorCode(turn),
    sourceProvenance: {
      webSearchEnabled: turn?.webSearch?.enabled === true,
      webSearchSearched: turn?.webSearch?.searched === true,
      groundingReceiptPresent: Boolean(turn?.webGrounding?.receiptId),
      origin: String(turn?.answerProvenance?.origin || '').slice(0, 80),
      verification: String(turn?.answerProvenance?.verification || '').slice(0, 80)
    }
  };
}

function turnAccepted(summary) {
  return summary.saved && summary.classification !== 'unclassified';
}

function diagnoseProviderCall(call, turn) {
  if (!call) return 'no-provider-call-observed';
  if (call.transportOutcome === 'request-before-response-failure' || !call.status) {
    return 'request-before-response-failure';
  }
  if (call.transportOutcome === 'response-body-failure') return 'response-body-failure';
  if (call.status < 200 || call.status >= 300) return 'provider-http-error';
  if (turn?.turnStatus !== 'completed' &&
      /(?:INVALID_RESPONSE|WEB_SEARCH_RESPONSE_INCOMPLETE|OUTPUT_TRUNCATED)/u
        .test(String(turn?.turnErrorCode || ''))) {
    return 'protocol-parse-error-after-http-success';
  }
  if (turn?.turnStatus !== 'completed') return 'post-http-production-error';
  return 'completed';
}

function acceptanceCallCounts(liveState) {
  return liveState.replay
    ? { realApiCalls: 0, replayedCalls: liveState.providerCalls }
    : { realApiCalls: liveState.providerCalls, replayedCalls: 0 };
}

async function assertTurnPresentation(panel, turn, summary) {
  const element = panel.locator(`.article-chat-turn[data-turn-id="${summary.turnId}"]`);
  if (!turnAccepted(summary)) {
    await element.waitFor();
    summary.visible = { turnVisible: await element.isVisible(), visibleBlockCount: 0 };
    return;
  }
  const turnText = await element.innerText();
  if (summary.classification === 'provider_unverified') {
    assert.match(turnText, /联网回答\s*·\s*来源未验证|web answer\s*·\s*source unverified/iu);
    assert.equal(await element.locator('.article-chat-web-source-dot').count(), 0);
  } else {
    assert.ok(await element.locator('.article-chat-web-source-dot').count() > 0);
  }
  summary.visible = await verifyVisibleAnswer(panel, summary.turnId);
}

function safeTemporaryRemoval(target, prefix) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(target);
  if (!resolved.startsWith(temporaryRoot + path.sep) ||
      !path.basename(resolved).startsWith(prefix)) return;
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function writeReport(report, outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function run() {
  const args = parseArguments(process.argv.slice(2));
  if (args.directBrowserNetwork && args.replayDir) throw safeError('LIVE_ARGUMENT_INVALID');
  if (args.followup && args.replayDir) throw safeError('LIVE_ARGUMENT_INVALID');
  const questions = [question, ...(args.followup ? [String(args.followup).trim()] : [])];
  if (questions.some(value => !value || value.length > 4000)) throw safeError('LIVE_ARGUMENT_INVALID');
  const extensionRoot = path.resolve(args.extensionRoot || process.env.SCI_EXTENSION_ROOT || projectRoot);
  const outputDirectory = path.resolve(args.outputDir || process.env.SCI_QA_OUTPUT_DIR ||
    path.join(projectRoot, 'output/playwright/live-web-chat-extension'));
  const articlePath = args.article || process.env.SCI_LIVE_ARTICLE_PATH ||
    path.join(projectRoot, 'tmp/cell-live-acceptance/article.json');
  if (!fs.existsSync(path.join(extensionRoot, 'manifest.json'))) {
    throw safeError('LIVE_EXTENSION_ROOT_INVALID');
  }
  if (!fs.existsSync(articlePath)) throw safeError('LIVE_ARTICLE_NOT_FOUND');
  const article = loadArticle(articlePath);
  let replay = null;
  if (args.replayDir) {
    const directory = path.resolve(args.replayDir);
    const previous = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'));
    const text = fs.readFileSync(path.join(directory, 'provider-response-redacted.json'), 'utf8');
    if (previous.outcome?.status !== 'PASS' || previous.realApiCalls !== 1 ||
        previous.providerCalls?.length !== 1 || previous.providerCalls[0].status !== 200 ||
        byteLength(text) > maxResponseBytes) throw safeError('LIVE_REPLAY_FIXTURE_INVALID');
    replay = { text, body: JSON.parse(text), request: previous.providerCalls[0].request,
      status: previous.providerCalls[0].status,
      originalRequest: fs.existsSync(path.join(directory, 'provider-request-redacted.json'))
        ? JSON.parse(fs.readFileSync(path.join(directory, 'provider-request-redacted.json'), 'utf8')) : null };
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-live-web-profile-'));
  const temporaryExtension = fs.mkdtempSync(
    path.join(os.tmpdir(), 'brevess-live-web-extension-')
  );
  const report = {
    schemaVersion: 2,
    acceptance: replay ? 'real Edge extension UI replaying one saved real DeepSeek response' :
      args.directBrowserNetwork
        ? 'real Edge extension UI and direct Chromium TLS to DeepSeek Responses API'
        : 'real Edge extension UI and real DeepSeek Responses API through transparent Node proxy',
    provider: replay ? 'replay' : 'deepseek',
    model: providerModel,
    endpoint: '/responses',
    endpointMetadata: {
      origin: new URL(providerEndpoint).origin,
      pathname: new URL(providerEndpoint).pathname,
      transport: args.directBrowserNetwork ? 'chromium-fetch' : replay ? 'replay' : 'node-fetch'
    },
    realApiCalls: 0,
    replayedCalls: 0,
    callCapRejected: false,
    providerCallCap,
    providerTimeoutMs,
    article: {
      titleSha256: sha256(article.title),
      urlOrigin: new URL(article.url).origin,
      paragraphCount: article.paragraphs.length,
      figureCount: article.figures.length
    },
    sourceHashes: {},
    providerCalls: [],
    turns: [],
    outcome: {
      status: 'FAIL',
      turnStatus: '',
      classification: 'unclassified',
      answerBlockCount: 0,
      answerChars: 0,
      saved: false,
      reloaded: false,
      turnErrorCode: '',
      webSearchEnabled: false,
      webSearchSearched: false,
      groundingReceiptPresent: false,
      provenanceOrigin: '',
      provenanceVerification: ''
    },
    screenshots: []
  };
  const liveState = {
    replay,
    providerCalls: 0,
    keyReads: 0,
    callCapRejected: false,
    lastProviderResponseBody: '',
    lastProviderRequestBody: ''
  };
  let secret = '';
  let network;
  let context;
  let panel;
  const startedAt = Date.now();
  const flushReport = async () => {
    Object.assign(report, acceptanceCallCounts(liveState));
    report.callCapRejected = liveState.callCapRejected;
    report.elapsedMs = Date.now() - startedAt;
    await writeReport(report, outputDirectory);
  };
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'article-input-redacted.json'),
      sanitizedReplay(JSON.stringify({
        title: article.title,
        url: article.url,
        paragraphs: article.paragraphs,
        figures: article.figures,
        correspondingAuthors: article.correspondingAuthors
      })), { encoding: 'utf8', mode: 0o600 });
    await flushReport();
    if (!replay) secret = await readSecretFromTty({ prompt: 'DeepSeek API key for isolated live web acceptance: ' });
    network = args.directBrowserNetwork
      ? await startDirectBroker(secret, report, liveState, outputDirectory, flushReport)
      : await startProxy(secret, report, liveState);
    copyExtension(extensionRoot, temporaryExtension, {
      mode: args.directBrowserNetwork ? 'direct' : 'proxy',
      url: network.url,
      brokerToken: network.brokerToken
    }, report);
    if (replay) report.testBoundary = 'temporary offscreen fetch boundary -> exact saved response replay; no external network';
    context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge',
      headless: process.env.SCI_LIVE_HEADLESS !== '0',
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
      args: [
        `--disable-extensions-except=${temporaryExtension}`,
        `--load-extension=${temporaryExtension}`
      ]
    });
    await context.route(/^https?:\/\//u, async route => {
      const url = route.request().url();
      if (url === article.url) {
        await route.fulfill({ contentType: 'text/html', body: articleHtml(article) });
        return;
      }
      if (url.startsWith(network.url + '/') ||
          (args.directBrowserNetwork && url === providerEndpoint)) {
        await route.continue();
        return;
      }
      await route.abort('blockedbyclient');
    });
    const paper = context.pages()[0] || await context.newPage();
    await paper.goto(article.url, { waitUntil: 'domcontentloaded' });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const tab = await worker.evaluate(async url =>
      (await chrome.tabs.query({})).find(item => item.url === url), article.url);
    assert.ok(tab?.id, 'live article tab exists');
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
    await setupProfile(panel);
    const toggle = panel.locator('#articleChatWebSearch');
    if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
    fs.mkdirSync(outputDirectory, { recursive: true });
    let latestArchive = null;
    for (let index = 0; index < questions.length; index += 1) {
      const beforeCalls = liveState.providerCalls;
      report.turns.push({
        index: index + 1,
        question: questions[index],
        turnStatus: 'submitting',
        saved: false,
        reloaded: false,
        sourceProvenance: {}
      });
      await flushReport();
      await panel.locator('#articleChatQuestion').fill(questions[index]);
      await panel.locator('#sendArticleChat').click();
      const completed = await waitForTerminalTurn(
        panel, index + 1, providerTimeoutMs + 45_000
      );
      latestArchive = completed.archive;
      const summary = summarizeTurn(completed.turn, questions[index], index + 1);
      const turnCalls = report.providerCalls.slice(beforeCalls);
      summary.providerSequences = turnCalls.map(call => call.sequence);
      summary.networkDiagnosis = diagnoseProviderCall(turnCalls.at(-1), summary);
      report.turns[index] = summary;
      if (turnCalls.length < 1 || turnCalls.length > 2 ||
          (turnCalls.length === 2 && (turnCalls[1].request.toolChoice !== 'none' ||
            turnCalls[1].request.inputKind !== 'array'))) {
        throw safeError('LIVE_PROVIDER_CALL_COUNT_INVALID');
      }
      await assertTurnPresentation(panel, completed.turn, summary);
      fs.writeFileSync(path.join(outputDirectory, `article-archive-turn-${index + 1}-redacted.json`),
        sanitizedReplay(JSON.stringify(completed.archive)), { encoding: 'utf8', mode: 0o600 });
      const screenshot = path.join(outputDirectory, `live-turn-${index + 1}.png`);
      await panel.screenshot({ path: screenshot, fullPage: true });
      report.screenshots.push(screenshot);
      await flushReport();
      if (!turnAccepted(summary)) break;
    }
    if (latestArchive) {
      fs.writeFileSync(path.join(outputDirectory, 'article-archive-redacted.json'),
        sanitizedReplay(JSON.stringify(latestArchive)), { encoding: 'utf8', mode: 0o600 });
    }
    const first = report.turns[0];
    if (first) Object.assign(report.outcome, {
      turnStatus: first.turnStatus,
      classification: first.classification,
      answerBlockCount: first.answerBlockCount,
      answerChars: first.answerChars,
      saved: first.saved,
      turnErrorCode: first.turnErrorCode,
      webSearchEnabled: first.sourceProvenance.webSearchEnabled,
      webSearchSearched: first.sourceProvenance.webSearchSearched,
      groundingReceiptPresent: first.sourceProvenance.groundingReceiptPresent,
      provenanceOrigin: first.sourceProvenance.origin,
      provenanceVerification: first.sourceProvenance.verification,
      visible: first.visible
    });
    await panel.reload({ waitUntil: 'domcontentloaded' });
    await paper.bringToFront();
    await panel.waitForFunction(expected =>
      document.getElementById('sidePanelPaperTitle')?.textContent === expected,
    article.title);
    await setupProfile(panel);
    const reloaded = await waitForTerminalTurn(panel, report.turns.length, 30_000);
    const reloadedTurns = reloaded.archive?.workspace?.chat?.turns || [];
    for (let index = 0; index < report.turns.length; index += 1) {
      const observed = summarizeTurn(reloadedTurns[index], questions[index], index + 1);
      const original = report.turns[index];
      original.reloaded = observed.turnId === original.turnId &&
        observed.turnStatus === original.turnStatus &&
        observed.classification === original.classification &&
        observed.answerChars === original.answerChars && observed.saved === original.saved;
      if (original.reloaded) await assertTurnPresentation(panel, reloadedTurns[index], original);
    }
    report.outcome.reloaded = report.turns.length > 0 && report.turns.every(turn => turn.reloaded);
    report.outcome.reloadedVisible = report.turns[0]?.visible || null;
    const reloadedScreenshot = path.join(outputDirectory, 'live-reloaded.png');
    await panel.screenshot({ path: reloadedScreenshot, fullPage: true });
    report.screenshots.push(reloadedScreenshot);
    await flushReport();
    if (!report.outcome.reloaded) throw safeError('LIVE_WEB_RELOAD_FAILED');
    if (report.turns.length !== questions.length || !report.turns.every(turnAccepted)) {
      throw safeError('LIVE_WEB_ANSWER_NOT_ACCEPTED');
    }
    if (liveState.providerCalls !== questions.length) throw safeError('LIVE_PROVIDER_CALL_COUNT_INVALID');
    report.outcome.status = 'PASS';
  } catch (error) {
    report.errorCode = safeErrorCode(error);
    if (error?.turnStatus) report.outcome.turnStatus = String(error.turnStatus).slice(0, 40);
    if (panel) {
      try {
        const failureArchive = await currentArchive(panel);
        fs.mkdirSync(outputDirectory, { recursive: true });
        fs.writeFileSync(path.join(outputDirectory, 'article-archive-failure-redacted.json'),
          sanitizedReplay(JSON.stringify(failureArchive)), { encoding: 'utf8', mode: 0o600 });
        const archivedTurns = failureArchive?.workspace?.chat?.turns || [];
        for (let index = 0; index < Math.min(archivedTurns.length, report.turns.length); index += 1) {
          if (report.turns[index]?.turnStatus !== 'submitting') continue;
          const summary = summarizeTurn(archivedTurns[index], questions[index], index + 1);
          summary.networkDiagnosis = diagnoseProviderCall(report.providerCalls[index], summary);
          report.turns[index] = summary;
        }
      } catch (_) {
        // The screenshot and transport diagnostics remain useful if archive access failed.
      }
      const failureScreenshot = path.join(outputDirectory, 'live-failure.png');
      fs.mkdirSync(outputDirectory, { recursive: true });
      await panel.screenshot({ path: failureScreenshot, fullPage: true }).catch(() => {});
      if (fs.existsSync(failureScreenshot)) report.screenshots.push(failureScreenshot);
    }
    if (liveState.lastProviderResponseBody) {
      const replayPath = path.join(outputDirectory, 'provider-response-failure-redacted.json');
      fs.mkdirSync(outputDirectory, { recursive: true });
      fs.writeFileSync(replayPath, sanitizedReplay(liveState.lastProviderResponseBody), {
        encoding: 'utf8', mode: 0o600
      });
      report.failureReplay = path.basename(replayPath);
    }
    if (liveState.lastProviderRequestBody) {
      fs.mkdirSync(outputDirectory, { recursive: true });
      fs.writeFileSync(path.join(outputDirectory, 'provider-request-redacted.json'),
        sanitizedReplay(liveState.lastProviderRequestBody), { encoding: 'utf8', mode: 0o600 });
    }
    throw error;
  } finally {
    Object.assign(report, acceptanceCallCounts(liveState));
    report.callCapRejected = liveState.callCapRejected;
    report.secretBrokerReads = args.directBrowserNetwork ? liveState.keyReads : 0;
    report.elapsedMs = Date.now() - startedAt;
    if (liveState.lastProviderResponseBody) {
      fs.mkdirSync(outputDirectory, { recursive: true });
      fs.writeFileSync(path.join(outputDirectory, 'provider-response-redacted.json'),
        sanitizedReplay(liveState.lastProviderResponseBody), { encoding: 'utf8', mode: 0o600 });
    }
    secret = '';
    network?.clearSecret?.();
    await context?.close().catch(() => {});
    if (network?.server) await new Promise(resolve => network.server.close(resolve));
    await writeReport(report, outputDirectory);
    safeTemporaryRemoval(profile, 'brevess-live-web-profile-');
    safeTemporaryRemoval(temporaryExtension, 'brevess-live-web-extension-');
  }
  return report;
}

const directExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directExecution) {
  run().then(report => {
    process.stdout.write(`${JSON.stringify({
      status: report.outcome.status,
      realApiCalls: report.realApiCalls,
      turnStatus: report.outcome.turnStatus,
      classification: report.outcome.classification,
      answerBlockCount: report.outcome.answerBlockCount,
      answerChars: report.outcome.answerChars,
      reloaded: report.outcome.reloaded,
      turns: report.turns.map(turn => ({
        index: turn.index,
        status: turn.turnStatus,
        saved: turn.saved,
        reloaded: turn.reloaded,
        networkDiagnosis: turn.networkDiagnosis
      }))
    })}\n`);
  }).catch(error => {
    process.stderr.write(`FAIL ${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  run,
  loadArticle,
  safeRequestShape,
  sanitizedReplay,
  directBrowserNetworkBootstrap,
  directNetworkBoundarySource,
  startDirectBroker,
  diagnoseProviderCall,
  acceptanceCallCounts,
  parseArguments
};
