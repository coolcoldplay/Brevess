// Acceptance transport only. No credential discovery, product dependency or logging.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const paths = new Set(['/models', '/chat/completions', '/responses', '/anthropic/v1/messages']);
const headerNames = new Map([['authorization', 'Authorization'], ['content-type', 'Content-Type'], ['accept', 'Accept'], ['x-api-key', 'x-api-key'], ['anthropic-version', 'anthropic-version']]);
const fixedCodes = new WeakMap();
const error = code => { const value = Object.assign(new Error(code), { code });
  fixedCodes.set(value, code); return value; };
const fail = code => { throw error(code); };

// curl's config parser recognizes these escapes. data-raw also keeps a leading @ literal.
function quote(value) {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/\v/g, '\\v') + '"';
}

function requestInput(input, options) {
  let url;
  try { url = new URL(input); } catch { fail('LIVE_CURL_REQUEST_INVALID'); }
  if (url.origin !== 'https://api.deepseek.com' || !paths.has(url.pathname) ||
      url.username || url.password || url.search || url.hash) fail('LIVE_CURL_REQUEST_INVALID');
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'POST'].includes(method)) fail('LIVE_CURL_REQUEST_INVALID');
  const headers = [];
  const secrets = [];
  let inputHeaders;
  try {
    inputHeaders = options.headers instanceof Headers ? [...options.headers] :
      Array.isArray(options.headers) ? options.headers : Object.entries(options.headers || {});
  } catch { fail('LIVE_CURL_REQUEST_INVALID'); }
  if (inputHeaders.length > 5) fail('LIVE_CURL_REQUEST_INVALID');
  const seen = new Set();
  for (const item of inputHeaders) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || typeof item[1] !== 'string') {
      fail('LIVE_CURL_REQUEST_INVALID');
    }
    const name = headerNames.get(item[0].toLowerCase());
    const value = item[1];
    if (!name || seen.has(name) || Buffer.byteLength(value) > 16384 || /[\x00-\x1f\x7f]/.test(value)) {
      fail('LIVE_CURL_REQUEST_INVALID');
    }
    seen.add(name); headers.push(`${name}: ${value}`);
    if (name === 'Authorization' || name === 'x-api-key') {
      const credential = name === 'x-api-key' ? value : /^(?:Bearer|Basic)\s+(.+)$/i.exec(value)?.[1] || value;
      if (!credential) fail('LIVE_CURL_REQUEST_INVALID');
      secrets.push(Buffer.from(credential));
    }
  }
  if (url.pathname === '/anthropic/v1/messages') {
    if (method !== 'POST' || !seen.has('x-api-key') || seen.has('Authorization') ||
        !headers.includes('anthropic-version: 2023-06-01')) fail('LIVE_CURL_REQUEST_INVALID');
  } else if (seen.has('x-api-key') || seen.has('anthropic-version')) fail('LIVE_CURL_REQUEST_INVALID');
  const body = options.body ?? null;
  if (body !== null && (method !== 'POST' || typeof body !== 'string' ||
      /[\x00-\x08\x0c\x0e-\x1f]/.test(body))) fail('LIVE_CURL_REQUEST_INVALID');
  if (body !== null && Buffer.byteLength(body) > MAX_BYTES) fail('LIVE_CURL_REQUEST_TOO_LARGE');
  return { url: url.href, method, headers, body, secrets };
}

function parseResponse(bytes, marker, method, secrets) {
  if (secrets.some(value => bytes.includes(value))) fail('LIVE_CURL_RESPONSE_SECRET');
  const endingLength = Buffer.byteLength(marker) + 5; // LF + marker + colon + three digits
  if (bytes.length <= endingLength) fail('LIVE_CURL_RESPONSE_INVALID');
  const ending = bytes.subarray(bytes.length - endingLength).toString('ascii');
  if (!ending.startsWith(`\n${marker}:`) || !/^[2-5][0-9]{2}$/.test(ending.slice(-3))) {
    fail('LIVE_CURL_RESPONSE_INVALID');
  }
  const status = Number(ending.slice(-3));
  const payload = bytes.subarray(0, bytes.length - endingLength);
  let offset = 0;
  while (offset < payload.length) {
    const end = payload.indexOf('\r\n\r\n', offset);
    if (end < 0 || end + 4 > MAX_HEADER_BYTES) fail('LIVE_CURL_RESPONSE_INVALID');
    const lines = payload.subarray(offset, end).toString('latin1').split('\r\n');
    const match = /^HTTP\/(?:1\.[01]|2|3) ([1-5][0-9]{2})(?: [^\r\n]*)?$/.exec(lines.shift());
    if (!match) fail('LIVE_CURL_RESPONSE_INVALID');
    const headerStatus = Number(match[1]);
    offset = end + 4;
    if (headerStatus < 200) continue;
    if (headerStatus !== status) fail('LIVE_CURL_RESPONSE_INVALID');
    const headers = new Headers();
    try {
      for (const line of lines) {
        const colon = line.indexOf(':');
        if (colon <= 0) fail('LIVE_CURL_RESPONSE_INVALID');
        headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
      }
      const body = payload.subarray(offset);
      const bodyless = method === 'HEAD' || [204, 205, 304].includes(status);
      if (bodyless && body.length) fail('LIVE_CURL_RESPONSE_INVALID');
      return new Response(bodyless ? null : body, { status, headers });
    } catch { fail('LIVE_CURL_RESPONSE_INVALID'); }
  }
  fail('LIVE_CURL_RESPONSE_INVALID');
}

export function createCurlFetch({ spawnImpl = spawn, timeoutMs = 180000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000) fail('LIVE_CURL_TIMEOUT_INVALID');
  return async function curlFetch(input, options = {}) {
    let request, signal;
    try {
      if (!options || typeof options !== 'object') fail('LIVE_CURL_REQUEST_INVALID');
      request = requestInput(input, options);
      signal = options.signal;
      if (signal?.aborted) fail('LIVE_CURL_ABORTED');
      if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
        fail('LIVE_CURL_REQUEST_INVALID');
      }
    } catch (failure) { throw error(fixedCodes.get(failure) || 'LIVE_CURL_REQUEST_INVALID'); }
    const marker = `SCI_LIVE_CURL_${randomBytes(16).toString('hex').toUpperCase()}`;
    const config = [
      'url = ' + quote(request.url), 'request = ' + quote(request.method),
      'silent', 'show-error', 'include', 'suppress-connect-headers', 'no-location', 'globoff',
      'proto = "=https"', 'max-time = ' + quote(String(timeoutMs / 1000)),
      'connect-timeout = ' + quote(String(Math.min(30000, timeoutMs) / 1000)),
      'max-filesize = ' + quote(String(MAX_BYTES)),
      'write-out = ' + quote(`\n${marker}:%{http_code}`),
      ...(request.method === 'HEAD' ? ['head'] : []),
      ...request.headers.map(value => 'header = ' + quote(value)),
      'header = "Accept-Encoding: identity"',
      ...(request.body === null ? [] : ['data-raw = ' + quote(request.body)])
    ].join('\n') + '\n';
    return new Promise((resolve, reject) => {
      let child, timer, settled = false, total = 0;
      let chunks = [];
      const configBytes = Buffer.from(config);
      const finish = (code, response, kill = false, exitCode = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (kill) { try { child?.kill('SIGKILL'); } catch {} }
        configBytes.fill(0);
        request.secrets.forEach(value => value.fill(0));
        chunks = [];
        if (code) {
          const failure = error(code);
          if (Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255) failure.exitCode = exitCode;
          reject(failure);
        } else resolve(response);
      };
      const abort = () => finish('LIVE_CURL_ABORTED', null, true);
      try {
        child = spawnImpl(process.platform === 'win32' ? 'C:\\Windows\\System32\\curl.exe' : '/usr/bin/curl',
          ['--disable', '--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'], shell: false,
            windowsHide: true, env: {} });
      } catch { finish('LIVE_CURL_SPAWN_FAILED'); return; }
      timer = setTimeout(() => finish('LIVE_CURL_TIMEOUT', null, true), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => finish('LIVE_CURL_PROCESS_FAILED', null, true));
      child.stdin.on('error', () => finish('LIVE_CURL_STDIN_FAILED', null, true));
      child.stdout.on('error', () => finish('LIVE_CURL_RESPONSE_FAILED', null, true));
      child.stderr.on('error', () => finish('LIVE_CURL_PROCESS_FAILED', null, true));
      child.stderr.on('data', () => {}); // Never retain or relay curl diagnostics.
      child.stdout.on('data', chunk => {
        if (settled) return;
        total += chunk.length;
        if (total > MAX_BYTES) { finish('LIVE_CURL_RESPONSE_TOO_LARGE', null, true); return; }
        chunks.push(Buffer.from(chunk));
      });
      child.on('close', code => {
        if (settled) return;
        if (code !== 0) { finish(code === 28 ? 'LIVE_CURL_TIMEOUT' :
          code === 63 ? 'LIVE_CURL_RESPONSE_TOO_LARGE' : 'LIVE_CURL_EXIT_FAILED', null, false, code); return; }
        try { finish('', parseResponse(Buffer.concat(chunks, total), marker, request.method, request.secrets)); }
        catch (failure) { finish(failure.code === 'LIVE_CURL_RESPONSE_SECRET' ?
          failure.code : 'LIVE_CURL_RESPONSE_INVALID'); }
      });
      if (signal?.aborted) { abort(); return; }
      try { child.stdin.end(configBytes, () => configBytes.fill(0)); }
      catch { finish('LIVE_CURL_STDIN_FAILED', null, true); }
    });
  };
}

export const curlFetch = createCurlFetch();
