'use strict';
// Managed Node entry. The legacy Windows SEA remains self-contained in host.js.
// Chrome supplies the caller origin; never accept an extension ID from a message.
const path = require('node:path');
const fs = require('node:fs');
const { extensionIdsFromManifest } = require('../mcp/server.js');
const { control } = require('../mcp/connection-service.js');
const { CodexBridgeHost, createNativeMessageParser, encodeNativeMessage } = require('./host.js');
const root = path.resolve(__dirname, '..');
let origin;
try { origin = new URL(process.argv[2]); } catch { process.exit(1); }
if (origin.protocol !== 'chrome-extension:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password || origin.port ||
    !extensionIdsFromManifest(path.join(root, 'manifest.json')).includes(origin.hostname)) process.exit(1);
const active = JSON.parse(fs.readFileSync(path.resolve(root, '..', '..', 'active.json'), 'utf8'));
if (fs.realpathSync(active.payloadRoot) !== fs.realpathSync(root) || !path.isAbsolute(active.nativeStateDir)) process.exit(1);
process.env.BREVESS_NATIVE_STATE_DIR = active.nativeStateDir;
const send = message => process.stdout.write(encodeNativeMessage(message));
const host = new CodexBridgeHost({ send });
let closed = false;
const parse = createNativeMessageParser(message => {
  const type = String(message?.type || '');
  if (type.startsWith('agent.connection.')) {
    const action = type.slice('agent.connection.'.length);
    Promise.resolve().then(() => control({ action, extensionId: origin.hostname }, { payloadRoot: root }))
      .then(result => { if (!closed) send({ type: type + '.result', requestId: String(message.requestId || ''), ...result }); })
      .catch(error => { if (!closed) send({ type: 'agent.connection.error', requestId: String(message.requestId || ''),
        error: { code: /^AGENT_|^SERVICE_/u.test(error?.code) ? error.code : 'AGENT_CONNECTION_FAILED' } }); });
    return;
  }
  Promise.resolve(host.handle(message)).catch(() => { if (!closed) send({ type: 'host.error', requestId: String(message.requestId || ''), error: { code: 'BRIDGE_FAILURE' } }); });
});
process.stdin.on('data', parse);
process.stdin.on('end', () => { closed = true; host.close(); });
process.stdin.on('error', () => { closed = true; host.close(); });
