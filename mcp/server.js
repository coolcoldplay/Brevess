#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { URL } = require('node:url');

const { BridgeHub, BRIDGE_PROTOCOL_VERSION } = require('./lib/bridge-hub.js');
const { createRegistry, SERVER_NAME, SERVER_VERSION } = require('./lib/registry.js');
const { McpProtocol, ResultCache } = require('./lib/protocol.js');
const { BrevessMcpError, publicError, serializeError } = require('./lib/errors.js');

const MAX_HTTP_BODY_BYTES = 32 * 1024 * 1024;
const DEFAULT_PORT = 9537;
const DEFAULT_TOOL_TIMEOUT_MS = 300000;

function stateDirectory() {
  const root = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(root, 'BrevessMcp');
}

function sanitize(value, depth = 0) {
  if (depth > 20) return '[depth-limited]';
  if (Array.isArray(value)) return value.slice(0, 200).map(item => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(token|secret|password|authorization|cookie|api.?key|credential)/iu.test(key)) {
      output[key] = '[redacted]';
    } else {
      output[key] = sanitize(child, depth + 1);
    }
  }
  return output;
}

function createAuditWriter(file) {
  if (!file) return () => {};
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return record => {
    try {
      fs.appendFileSync(
        file,
        `${JSON.stringify({
          at: new Date().toISOString(),
          ...sanitize(record)
        })}\n`,
        { encoding: 'utf8', mode: 0o600 }
      );
    } catch (error) {
      process.stderr.write(`[${SERVER_NAME}] audit write failed: ${error.code || error.message}\n`);
    }
  };
}

function loadOrCreateToken({ explicitToken, tokenFile }) {
  if (explicitToken) {
    if (String(explicitToken).length < 24) {
      throw new BrevessMcpError('MCP_TOKEN_TOO_SHORT', 'The MCP bridge token must be at least 24 characters.');
    }
    return { token: String(explicitToken), source: 'argument_or_environment' };
  }
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  try {
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    if (token.length >= 24) return { token, source: tokenFile };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  try {
    fs.writeFileSync(tokenFile, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = fs.readFileSync(tokenFile, 'utf8').trim();
    if (existing.length < 24) {
      throw new BrevessMcpError('MCP_TOKEN_INVALID', 'The existing MCP bridge token file is invalid.');
    }
    return { token: existing, source: tokenFile };
  }
  return { token, source: tokenFile };
}

function extensionIdFromKey(key) {
  if (typeof key !== 'string' || !key) return '';
  try {
    const digest = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16);
    return [...digest.toString('hex')].map(char => String.fromCharCode(97 + Number.parseInt(char, 16))).join('');
  } catch {
    return '';
  }
}

function extensionIdFromManifest(manifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return extensionIdFromKey(manifest.key);
  } catch {
    return '';
  }
}

function parseArgs(argv = []) {
  const options = {
    host: '127.0.0.1',
    port: DEFAULT_PORT,
    transport: 'both',
    allowWrite: process.env.BREVESS_MCP_ALLOW_WRITE === '1',
    stateDir: process.env.BREVESS_MCP_STATE_DIR || stateDirectory(),
    tokenFile: '',
    token: process.env.BREVESS_MCP_TOKEN || '',
    auditFile: '',
    toolTimeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
    maxResultBytes: 700 * 1024
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--http-only') options.transport = 'http';
    else if (arg === '--stdio-only') options.transport = 'stdio';
    else if (arg === '--allow-write') options.allowWrite = true;
    else if (arg === '--no-write') options.allowWrite = false;
    else if (arg === '--host') options.host = next();
    else if (arg === '--port') options.port = Number(next());
    else if (arg === '--token') options.token = next();
    else if (arg === '--token-file') options.tokenFile = next();
    else if (arg === '--state-dir') options.stateDir = next();
    else if (arg === '--audit-file') options.auditFile = next();
    else if (arg === '--tool-timeout-ms') options.toolTimeoutMs = Number(next());
    else if (arg === '--max-result-bytes') options.maxResultBytes = Number(next());
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['both', 'http', 'stdio'].includes(options.transport)) {
    throw new Error('transport must be both, http or stdio');
  }
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error('port must be an integer between 0 and 65535');
  }
  if (options.host !== '127.0.0.1' && options.host !== 'localhost') {
    throw new Error('The MCP bridge only binds to 127.0.0.1 or localhost.');
  }
  if (!Number.isSafeInteger(options.toolTimeoutMs) || options.toolTimeoutMs < 1000) {
    throw new Error('tool-timeout-ms must be at least 1000');
  }
  if (!Number.isSafeInteger(options.maxResultBytes) || options.maxResultBytes < 16384) {
    throw new Error('max-result-bytes must be at least 16384');
  }
  options.tokenFile ||= path.join(options.stateDir, 'bridge-token');
  options.auditFile ||= path.join(options.stateDir, 'audit.ndjson');
  return options;
}

function helpText() {
  return [
    `${SERVER_NAME} ${SERVER_VERSION}`,
    '',
    'Usage: node mcp/server.js [options]',
    '',
    'Options:',
    '  --stdio-only             Serve MCP over stdio only (HTTP bridge still starts).',
    '  --http-only              Serve MCP over localhost HTTP only.',
    '  --allow-write            Enable mutating tools. Default is read-only.',
    '  --port <number>          Localhost bridge/MCP port. Default 9537.',
    '  --host <host>            127.0.0.1 or localhost only.',
    '  --token <token>          Override the generated bridge token.',
    '  --state-dir <dir>        State/audit/token directory.',
    '  --tool-timeout-ms <ms>   End-to-end tool timeout. Default 300000.',
    '  --max-result-bytes <n>   Inline result limit before cursor paging.',
    '  --help                   Show this help.',
    '',
    'Environment:',
    '  BREVESS_MCP_ALLOW_WRITE=1',
    '  BREVESS_MCP_TOKEN=<token>',
    '  BREVESS_MCP_STATE_DIR=<dir>',
    ''
  ].join('\n');
}

function corsOrigin(request, extensionId) {
  const origin = request.headers.origin;
  if (!origin) return null;
  if (origin === `chrome-extension://${extensionId}`) return origin;
  if (/^chrome-extension:\/\/[a-p]{32}$/u.test(origin) && !extensionId) return origin;
  return false;
}

function applyCors(request, response, extensionId) {
  const origin = corsOrigin(request, extensionId);
  if (origin === false) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'origin_forbidden' }));
    return false;
  }
  if (origin) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
  }
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.setHeader('access-control-allow-headers', 'authorization,content-type,mcp-protocol-version');
  response.setHeader('access-control-max-age', '600');
  return true;
}

function readBody(request, maximum = MAX_HTTP_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on('data', chunk => {
      length += chunk.length;
      if (length > maximum) {
        reject(new BrevessMcpError('HTTP_BODY_TOO_LARGE', 'Request body is too large.', undefined, {
          status: 413
        }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!chunks.length) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new BrevessMcpError('PARSE_ERROR', 'Request body is not valid JSON.', {
          cause: error.message
        }, { status: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function bearerToken(request) {
  const value = String(request.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/iu.exec(value);
  return match ? match[1] : '';
}

function sendJson(response, status, value, headers = {}) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers
  });
  response.end(body);
}

function sendError(response, error) {
  const value = publicError(error);
  sendJson(response, Number(error?.status) || 500, { ok: false, error: value });
}

function connectPage({ url, extensionId, scopes, bridge, tokenSource, language = 'zh-CN' }) {
  const english = String(language).startsWith('en');
  const ui = (zh, en) => english ? en : zh;
  const languageLink = value => { const target = new URL(url); target.searchParams.set('lang', value); return target.href; };
  const workbench = extensionId
    ? `chrome-extension://${extensionId}/workbench/index.html?mcpServer=${encodeURIComponent(url)}&mcpToken=${encodeURIComponent(new URL(url).searchParams.get('token') || '')}`
    : '';
  const escaped = value => String(value).replace(/[&<>"']/gu, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
  const json = JSON.stringify({ url, extensionId, scopes, bridge, tokenSource }, null, 2);
  return `<!doctype html>
<html lang="${english ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ui('BREVESS MCP 连接', 'BREVESS MCP connection')}</title>
<style>
body{font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:880px;margin:40px auto;padding:0 24px;color:#17202a;background:#f7f9fb}
main{background:#fff;border:1px solid #dbe3ea;border-radius:14px;padding:28px 30px;box-shadow:0 12px 40px rgba(35,52,70,.08)}
code,pre{background:#f1f4f7;border-radius:6px}code{padding:2px 5px}pre{padding:14px;overflow:auto;font-size:13px}
a.button{display:inline-block;background:#174d66;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;margin:8px 0}
.muted{color:#62717f}.warn{background:#fff7e5;border-left:4px solid #d89a20;padding:10px 14px}
</style>
</head>
<body><main>
<h1>BREVESS MCP</h1>
<nav aria-label="${ui('语言', 'Language')}"><a href="${escaped(languageLink('en'))}" lang="en">English</a> · <a href="${escaped(languageLink('zh-CN'))}" lang="zh-CN">简体中文</a></nav>
<p>${ui('本机 MCP endpoint：', 'Local MCP endpoint:')}<code>${escaped(url.replace(/\/connect.*$/u, ''))}</code></p>
<p>Scope：<strong>${escaped(scopes.join(', '))}</strong></p>
${workbench ? `<p><a class="button" href="${escaped(workbench)}">${ui('打开课题工作台并配对 MCP', 'Open the workbench and pair MCP')}</a></p>` : `<p class="warn">${ui('未能从 manifest 推导扩展 ID。安装扩展后，从 Workbench 页面使用下方参数手动连接。', 'The extension ID could not be derived from the manifest. Install the extension, then connect manually from the workbench using the parameters below.')}</p>`}
<p class="muted">${ui('连接页含短时本机 token，不会上传。请勿把此 URL 发给其他设备。Workbench 页需要保持打开；关闭后，写操作会返回', 'This page contains a temporary local token that is not uploaded. Do not send this URL to other devices. Keep the workbench open; when it closes, write operations return')} <code>BRIDGE_UNAVAILABLE</code>${ui('，不会静默重试。', ' without retrying silently.')}</p>
<h2>${ui('当前状态', 'Current status')}</h2><pre>${escaped(json)}</pre>
<h2>${ui('Bridge 参数', 'Bridge parameters')}</h2>
<pre>mcpServer=${escaped(url.replace(/\/connect.*$/u, ''))}
mcpToken=${escaped(new URL(url).searchParams.get('token') || '')}</pre>
<p class="muted">${ui('Token 文件：', 'Token file:')}<code>${escaped(tokenSource)}</code></p>
</main></body></html>`;
}

function createHttpServer(options) {
  const {
    hub,
    protocol,
    token,
    extensionId,
    allowWrite,
    connectPagePath
  } = options;
  const sessions = new Map();

  const server = http.createServer(async (request, response) => {
    if (process.env.BREVESS_MCP_DEBUG === '1') {
      process.stderr.write(`[mcp-http] ${request.method} ${request.url || '/'} accept=${String(request.headers.accept || '')} content_length=${String(request.headers['content-length'] || '')}\n`);
    }
    if (!applyCors(request, response, extensionId)) return;
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    const base = `http://${request.headers.host || `${options.host}:${options.port}`}`;
    const requestUrl = new URL(request.url || '/', base);
    try {
      if (request.method === 'GET' && requestUrl.pathname === '/') {
        sendJson(response, 200, {
          name: SERVER_NAME,
          version: SERVER_VERSION,
          health: '/health',
          mcp: '/mcp',
          sse: '/sse',
          connect: '/connect',
          bridgeProtocol: BRIDGE_PROTOCOL_VERSION,
          scopes: allowWrite ? ['read', 'write'] : ['read']
        });
        return;
      }
      if ((request.method === 'GET' || request.method === 'POST') && requestUrl.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          server: { name: SERVER_NAME, version: SERVER_VERSION },
          scopes: allowWrite ? ['read', 'write'] : ['read'],
          bridge: hub.status(),
          writeScope: protocol.registry?.scopeManager?.status?.() || null,
          extensionId: extensionId || null
        });
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname === '/connect') {
        const supplied = requestUrl.searchParams.get('token') || '';
        try {
          hub.authorize(supplied);
        } catch (error) {
          sendJson(response, 401, { ok: false, error: publicError(error) });
          return;
        }
        const html = connectPage({
          url: `${base}/connect?token=${encodeURIComponent(token)}`,
          extensionId,
          scopes: allowWrite ? ['read', 'write'] : ['read'],
          bridge: hub.status(),
          tokenSource: connectPagePath,
          language: requestUrl.searchParams.get('lang') || (/^en\b/i.test(String(request.headers['accept-language'] || '')) ? 'en' : 'zh-CN')
        });
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff'
        });
        response.end(html);
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/bridge/poll') {
        hub.authorize(bearerToken(request));
        const body = await readBody(request);
        const job = await hub.poll(body || {});
        if (!response.writableEnded) sendJson(response, 200, job);
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/bridge/control/poll') {
        hub.authorize(bearerToken(request));
        const body = await readBody(request);
        const job = await hub.controlPoll(body || {});
        if (!response.writableEnded) sendJson(response, 200, job);
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/bridge/result') {
        hub.authorize(bearerToken(request));
        const body = await readBody(request);
        if (!body || typeof body !== 'object') {
          throw new BrevessMcpError('HTTP_INVALID_BODY', 'A bridge result object is required.', undefined, {
            status: 400
          });
        }
        sendJson(response, 200, hub.result(body.requestId, body));
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/bridge/disconnect') {
        hub.authorize(bearerToken(request));
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/mcp') {
        hub.authorize(bearerToken(request));
        const body = await readBody(request);
        if (process.env.BREVESS_MCP_DEBUG === '1') {
          const messages = Array.isArray(body) ? body : [body];
          process.stderr.write(`[mcp-http] rpc ${messages.map(message =>
            `${message?.method || 'invalid'}#${String(message?.id ?? 'notification')}`).join(',')}\n`);
        }
        const sessionId = requestUrl.searchParams.get('sessionId') || '';
        const context = { sessionId: sessionId || 'http', transport: 'http' };
        const result = await protocol.handle(body, context);
        if (sessionId) {
          const session = sessions.get(sessionId);
          if (!session) {
            throw new BrevessMcpError('MCP_SESSION_NOT_FOUND', 'The SSE session is missing or expired.', {
              field: 'sessionId'
            }, { status: 404 });
          }
          if (result !== null) {
            session.res.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
          }
          response.writeHead(202, { 'cache-control': 'no-store' });
          response.end();
          return;
        }
        if (result === null) {
          response.writeHead(202, { 'cache-control': 'no-store' });
          response.end();
          return;
        }
        const accept = String(request.headers.accept || '');
        if (accept.includes('text/event-stream') && !accept.includes('application/json')) {
          const payload = JSON.stringify(result);
          response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'keep-alive'
          });
          response.write(`event: message\ndata: ${payload}\n\n`);
          response.end();
          return;
        }
        sendJson(response, 200, result);
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname === '/sse') {
        const supplied = requestUrl.searchParams.get('token') || bearerToken(request);
        hub.authorize(supplied);
        const sessionId = crypto.randomUUID();
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no'
        });
        response.write(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`);
        const session = { id: sessionId, res: response, keepAlive: null };
        session.keepAlive = setInterval(() => {
          if (!response.writableEnded) response.write(`: keepalive ${Date.now()}\n\n`);
        }, 15000);
        session.keepAlive.unref?.();
        sessions.set(sessionId, session);
        request.on('close', () => {
          clearInterval(session.keepAlive);
          sessions.delete(sessionId);
        });
        return;
      }
      sendJson(response, 404, { ok: false, error: { code: 'HTTP_NOT_FOUND', message: 'Not found' } });
    } catch (error) {
      if (!response.writableEnded) sendError(response, error);
    }
  });

  server.on('close', () => {
    for (const session of sessions.values()) {
      clearInterval(session.keepAlive);
      try {
        session.res.end();
      } catch {
        // Already closed.
      }
    }
    sessions.clear();
  });
  return server;
}

function createStdioTransport(protocol, context = {}) {
  const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false
  });
  let closed = false;
  input.on('line', line => {
    if (closed || !line.trim()) return;
    if (Buffer.byteLength(line, 'utf8') > MAX_HTTP_BODY_BYTES) {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Request too large' }
      })}\n`);
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' }
      })}\n`);
      return;
    }
    Promise.resolve(protocol.handle(message, { ...context, sessionId: 'stdio', transport: 'stdio' }))
      .then(result => {
        if (result !== null) process.stdout.write(`${JSON.stringify(result)}\n`);
      })
      .catch(error => {
        process.stderr.write(`[${SERVER_NAME}] stdio handler failed: ${serializeError(error).message}\n`);
        if (message && Object.hasOwn(message, 'id')) {
          process.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32603, message: 'Internal error' }
          })}\n`);
        }
      });
  });
  input.on('close', () => {
    closed = true;
  });
  return {
    close() {
      closed = true;
      input.close();
    }
  };
}

async function start(options = {}) {
  const parsed = options.argv ? parseArgs(options.argv) : {
    ...parseArgs([]),
    ...options,
    tokenFile: options.tokenFile || path.join(options.stateDir || stateDirectory(), 'bridge-token'),
    auditFile: options.auditFile || path.join(options.stateDir || stateDirectory(), 'audit.ndjson')
  };
  const tokenState = loadOrCreateToken({
    explicitToken: parsed.token,
    tokenFile: parsed.tokenFile
  });
  const audit = createAuditWriter(parsed.auditFile);
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const extensionId = extensionIdFromManifest(manifestPath);
  let port = parsed.port;
  let baseUrl = `http://${parsed.host}:${port || DEFAULT_PORT}`;
  const hub = new BridgeHub({
    token: tokenState.token,
    allowWrite: parsed.allowWrite,
    toolTimeoutMs: parsed.toolTimeoutMs,
    connectUrl: '',
    audit
  });
  const registry = createRegistry({ hub, allowWrite: parsed.allowWrite });
  const resultCache = new ResultCache({ maxBytes: parsed.maxResultBytes });
  const protocol = new McpProtocol({
    registry,
    hub,
    allowWrite: parsed.allowWrite,
    maxBytes: parsed.maxResultBytes,
    toolTimeoutMs: parsed.toolTimeoutMs,
    audit,
    resultCache
  });
  const httpServer = createHttpServer({
    hub,
    protocol,
    token: tokenState.token,
    extensionId,
    allowWrite: parsed.allowWrite,
    connectPagePath: tokenState.source,
    host: parsed.host,
    port
  });
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, parsed.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const address = httpServer.address();
  port = typeof address === 'object' && address ? address.port : port;
  baseUrl = `http://${parsed.host}:${port}`;
  const tokenlessConnectUrl = `${baseUrl}/connect`;
  const connectUrl = `${tokenlessConnectUrl}?token=${encodeURIComponent(tokenState.token)}`;
  hub.connectUrl = tokenlessConnectUrl;
  protocol.connectUrl = tokenlessConnectUrl;
  process.stderr.write([
    `[${SERVER_NAME}] listening ${baseUrl}`,
    `[${SERVER_NAME}] scopes ${parsed.allowWrite ? 'read,write' : 'read'}`,
    `[${SERVER_NAME}] bridge protocol ${BRIDGE_PROTOCOL_VERSION}`,
    `[${SERVER_NAME}] token file ${tokenState.source}`,
    `[${SERVER_NAME}] connect ${connectUrl}`,
    parsed.transport === 'http' ? '' : `[${SERVER_NAME}] stdio ready`,
    ''
  ].filter(Boolean).join('\n'));
  const stdio = parsed.transport === 'http' ? null : createStdioTransport(protocol, {
    allowWrite: parsed.allowWrite
  });
  let closing = false;
  async function close(exitCode = 0) {
    if (closing) return;
    closing = true;
    stdio?.close();
    hub.close();
    await new Promise(resolve => httpServer.close(() => resolve()));
    if (exitCode !== null) process.exitCode = exitCode;
  }
  return {
    hub,
    registry,
    protocol,
    httpServer,
    connectUrl: tokenlessConnectUrl,
    token: tokenState.token,
    port,
    baseUrl,
    close,
    stdio
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const instance = await start({ ...options, argv: null });
  const shutdown = () => {
    instance.close(0).catch(error => {
      process.stderr.write(`[${SERVER_NAME}] shutdown failed: ${error.message}\n`);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  if (options.transport === 'http') process.stderr.write(`[${SERVER_NAME}] http-only mode\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[${SERVER_NAME}] ${serializeError(error).code}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  loadOrCreateToken,
  extensionIdFromKey,
  extensionIdFromManifest,
  createHttpServer,
  createStdioTransport,
  start,
  helpText
};
