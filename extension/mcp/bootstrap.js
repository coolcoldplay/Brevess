'use strict';

// Local lifecycle only. This module neither starts a model nor grants write scopes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');

const IDENTITY = 'brevess-mcp-bridge-v1';
const BOOTSTRAP_VERSION = 2;
const failure = (code, message) => Object.assign(new Error(message), { code });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function runtimeFiles(root = path.join(__dirname, '..')) {
  const files = new Set(['manifest.json', 'native-host/catalog-extension-ids.txt']);
  function visit(relative) {
    const resolved = path.resolve(root, relative);
    const local = path.relative(root, resolved);
    if (local.startsWith('..') || path.isAbsolute(local)) throw failure('AGENT_PAYLOAD_INVALID', 'Runtime import escaped the payload root.');
    if (files.has(local)) return;
    files.add(local);
    const source = fs.readFileSync(resolved, 'utf8');
    for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/gu)) {
      let target = path.resolve(path.dirname(resolved), match[1]);
      if (!path.extname(target)) target += '.js';
      visit(path.relative(root, target));
    }
  }
  visit('mcp/server.js');
  visit('mcp/connection-service.js');
  return [...files].sort();
}

function runtimeRevision(root = path.join(__dirname, '..')) {
  const hash = crypto.createHash('sha256');
  for (const file of runtimeFiles(root)) hash.update(file.replaceAll('\\', '/')).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
  return hash.digest('hex');
}

function proofFor(token, nonce, status) {
  return crypto.createHmac('sha256', token).update(JSON.stringify({ nonce, ...status })).digest('hex');
}

function requestJson(port, pathname, { token, body, clientId, timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = http.request({ hostname: '127.0.0.1', port, path: pathname,
      method: payload === null ? 'GET' : 'POST', headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(clientId ? { 'x-brevess-client-id': clientId } : {}),
        ...(payload === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
      } }, response => {
      let bytes = 0;
      const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 32 * 1024 * 1024) response.destroy(failure('SERVICE_RESPONSE_TOO_LARGE', 'Local service response exceeded its limit.'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode === 202) return resolve(null);
        if (response.statusCode !== 200) return reject(failure('SERVICE_UNAVAILABLE', `Local service returned HTTP ${response.statusCode}.`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(failure('SERVICE_IDENTITY_MISMATCH', 'The local port does not speak the expected BREVESS protocol.')); }
      });
    });
    request.setTimeout(timeout, () => request.destroy(failure('SERVICE_TIMEOUT', 'Local service did not respond in time.')));
    request.on('error', reject);
    request.end(payload);
  });
}

function statusFields(options) {
  return { identity: IDENTITY, bootstrapVersion: BOOTSTRAP_VERSION, revision: options.revision,
    extensionId: options.extensionId, extensionIds: [...new Set(options.extensionIds || [options.extensionId].filter(Boolean))].sort(),
    allowWrite: options.allowWrite === true };
}

async function verifyService(port, options) {
  const nonce = crypto.randomBytes(24).toString('hex');
  const response = await requestJson(port, `/bootstrap/status?nonce=${nonce}`);
  const status = statusFields(response || {});
  const expected = proofFor(options.token, nonce, status);
  const provided = typeof response?.proof === 'string' ? response.proof : '';
  if (response?.identity !== IDENTITY || response?.bootstrapVersion !== BOOTSTRAP_VERSION ||
      provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    throw failure('SERVICE_IDENTITY_MISMATCH', 'The local port is not the paired BREVESS service. Close the conflicting service or choose another port.');
  }
  if (status.revision !== options.revision || status.extensionId !== options.extensionId || status.allowWrite !== options.allowWrite ||
      (options.extensionIds && JSON.stringify(status.extensionIds) !== JSON.stringify([...new Set(options.extensionIds)].sort()))) {
    throw failure('SERVICE_RESTART_REQUIRED', 'An older or differently configured BREVESS service is running. Close its Agent/Workbench connections and retry after it exits; no running process was replaced.');
  }
  return { ...status, port };
}

function writeDescriptor(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
}

async function ensureService(parsed) {
  const { loadOrCreateToken, extensionIdsFromManifest } = require('./server.js');
  const root = path.join(__dirname, '..');
  const extensionIds = extensionIdsFromManifest(path.join(root, 'manifest.json'));
  const extensionId = extensionIds[0] || '';
  if (!extensionId) throw failure('EXTENSION_ID_REQUIRED', 'The installed extension identity is missing. Repair the companion payload.');
  if (parsed.host !== '127.0.0.1') throw failure('SERVICE_HOST_INVALID', 'Shared Agent connections require the IPv4 loopback host 127.0.0.1.');
  const tokenState = loadOrCreateToken({ explicitToken: parsed.token, tokenFile: parsed.tokenFile });
  const options = { token: tokenState.token, revision: runtimeRevision(root), extensionId, extensionIds, allowWrite: parsed.allowWrite === true };
  const descriptorPath = path.join(parsed.stateDir, 'service.json');
  const lockPath = path.join(parsed.stateDir, 'service-start.lock');
  let ownedLock = false;
  let child = null;
  fs.mkdirSync(parsed.stateDir, { recursive: true });
  const deadline = Date.now() + 12000;
  try {
    while (Date.now() < deadline) {
      let descriptor;
      try { descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      const port = parsed.port || descriptor?.port;
      if (Number.isInteger(port) && port > 0 && port <= 65535) {
        try { return { ...await verifyService(port, options), token: options.token, stateDir: parsed.stateDir, created: !!child }; }
        catch (error) {
          if (error.code !== 'ECONNREFUSED') throw error;
        }
      }
      if (!ownedLock) {
        try {
          const fd = fs.openSync(lockPath, 'wx', 0o600);
          fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fs.closeSync(fd); ownedLock = true;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          // Never delete a lock owned by a live process, nor guess ownership from age.
          let owner;
          try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* incomplete lock: wait */ }
          if (Number.isInteger(owner?.pid) && owner.pid > 0) {
            try { process.kill(owner.pid, 0); }
            catch (probe) { if (probe.code === 'ESRCH') throw failure('SERVICE_LOCK_STALE', 'A previous startup was interrupted. Close other companion installers, then remove only service-start.lock from the BREVESS MCP state directory and retry.'); }
          }
        }
      }
      if (ownedLock && !child) {
        const args = [path.join(__dirname, 'server.js'), '--http-only', '--managed-service', '--host', '127.0.0.1',
          '--port', String(parsed.port), '--state-dir', parsed.stateDir, '--token-file', parsed.tokenFile,
          '--audit-file', parsed.auditFile, parsed.allowWrite ? '--allow-write' : '--no-write',
          '--tool-timeout-ms', String(parsed.toolTimeoutMs), '--max-result-bytes', String(parsed.maxResultBytes)];
        child = spawn(process.execPath, args, { cwd: root, detached: true, windowsHide: true, stdio: 'ignore',
          env: { ...process.env, BREVESS_MCP_TOKEN: options.token } });
        let launchError;
        child.once('error', error => { launchError = error; });
        child.unref();
        await sleep(60);
        if (launchError) throw failure('SERVICE_START_FAILED', 'The local Agent service could not start. Repair the installed Node runtime.');
      }
      if (child?.exitCode !== null && child?.exitCode !== undefined) throw failure('SERVICE_START_FAILED', 'The local Agent service exited during startup. Check the port and installed payload.');
      await sleep(100);
    }
    throw failure('SERVICE_START_TIMEOUT', 'The local Agent service did not start. Another installer may be active; retry after it finishes.');
  } finally {
    if (ownedLock) { try { fs.unlinkSync(lockPath); } catch {} }
  }
}

async function selfCheck(connection) {
  const initialized = await requestJson(connection.port, '/mcp', { token: connection.token,
    body: { jsonrpc: '2.0', id: 'check-init', method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'brevess-local-self-check', version: '1' } } } });
  const listed = await requestJson(connection.port, '/mcp', { token: connection.token,
    body: { jsonrpc: '2.0', id: 'check-tools', method: 'tools/list', params: {} } });
  const health = await requestJson(connection.port, '/health');
  return { service: 'ready', protocolVersion: initialized?.result?.protocolVersion || null,
    toolDiscovery: Array.isArray(listed?.result?.tools) ? 'ready' : 'failed', toolCount: listed?.result?.tools?.length || 0,
    extension: health?.bridge?.online ? 'paired' : 'not-paired', clientToolRead: 'not-tested',
    extensionId: connection.extensionId, modelInvoked: false, researchWritten: false };
}

module.exports = { IDENTITY, BOOTSTRAP_VERSION, runtimeFiles, runtimeRevision, proofFor, statusFields,
  requestJson, verifyService, ensureService, selfCheck, writeDescriptor };
