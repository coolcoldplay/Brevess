'use strict';
// Fixed, one-request stdio seam for the packaged native host. Pairing credentials
// are returned only by the explicit pair action, never by status or diagnostics.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, extensionIdsFromManifest } = require('./server.js');
const { ensureService, verifyInstalledService, selfCheck, runtimeRevision } = require('./bootstrap.js');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

async function control(request, options = {}) {
  if (!request || !['status', 'pair'].includes(request.action)) fail('AGENT_ACTION_INVALID', 'Choose status or pair.');
  const payloadRoot = options.payloadRoot || path.join(__dirname, '..');
  const activePath = path.resolve(payloadRoot, '..', '..', 'active.json');
  let active;
  try { active = JSON.parse(fs.readFileSync(activePath, 'utf8')); }
  catch { fail('AGENT_NOT_INSTALLED', 'The Agent connection component is not installed. Run its setup.'); }
  if (active.version !== 1 || fs.realpathSync(active.payloadRoot) !== fs.realpathSync(payloadRoot) || !path.isAbsolute(active.stateDir)) fail('AGENT_INSTALLATION_MISMATCH', 'The active Agent payload does not match. Re-run companion setup.');
  const extensionIds = extensionIdsFromManifest(path.join(payloadRoot, 'manifest.json'));
  const extensionId = request.extensionId;
  if (!extensionIds.includes(extensionId)) fail('AGENT_ORIGIN_MISMATCH', 'This extension does not match the installed companion.');
  const parsed = parseArgs(['--state-dir', active.stateDir, '--port', String(active.port ?? 9537), active.allowWrite ? '--allow-write' : '--no-write']);
  let connection;
  if (request.action === 'pair') connection = await ensureService(parsed);
  else {
    let descriptor, token;
    try { descriptor = JSON.parse(fs.readFileSync(path.join(active.stateDir, 'service.json'), 'utf8')); token = fs.readFileSync(parsed.tokenFile, 'utf8').trim(); }
    catch { return { ok: true, phase: 'component-ready', service: 'not-started', clientToolRead: 'not-tested', extensionId }; }
    try { connection = { ...await verifyInstalledService(descriptor.port, { token, revision: runtimeRevision(payloadRoot), extensionId: extensionIds[0], extensionIds, allowWrite: active.allowWrite },payloadRoot,descriptor), token }; }
    catch (error) {
      if (error.code === 'ECONNREFUSED') return { ok: true, phase: 'component-ready', service: 'not-started', clientToolRead: 'not-tested', extensionId };
      throw error;
    }
  }
  const check = await selfCheck(connection);
  return { ok: true, phase: check.extension === 'paired' ? 'paired' : 'awaiting-extension-pair', ...check,
    serverUrl: `http://127.0.0.1:${connection.port}`, extensionId,
    ...(request.action === 'pair' ? { pairing: { token: connection.token, protocol: 'brevess-mcp-bridge-v1' } } : {}) };
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; if (Buffer.byteLength(input) > 4096) process.exit(1); });
  process.stdin.on('end', async () => {
    try { process.stdout.write(JSON.stringify(await control(JSON.parse(input))) + '\n'); }
    catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: { code: error.code || 'AGENT_CONNECTION_FAILED', message: error.message } }) + '\n'); process.exitCode = 1; }
  });
}
module.exports = { control };
