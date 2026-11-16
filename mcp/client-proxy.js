'use strict';
const readline = require('node:readline');
const crypto = require('node:crypto');
const { ensureService, verifyService, requestJson } = require('./bootstrap.js');

async function startProxy(options, streams = process) {
  const connection = await ensureService(options);
  const clientId = `proxy-${crypto.randomUUID()}`;
  const input = readline.createInterface({ input: streams.stdin, crlfDelay: Infinity, terminal: false });
  const pending = new Set();
  let closed = false;
  const output = value => { if (!closed && value !== null) streams.stdout.write(`${JSON.stringify(value)}\n`); };
  const keepAlive = setInterval(() => {
    verifyService(connection.port, connection).catch(() => {
      streams.stderr.write('[brevess] SERVICE_DISCONNECTED: Reconnect the Agent after the local service is repaired.\n');
      close();
    });
  }, 10000);
  keepAlive.unref();
  function close() { if (closed) return; closed = true; clearInterval(keepAlive); input.close(); }
  input.on('line', line => {
    if (!line.trim() || closed) return;
    let message;
    if (Buffer.byteLength(line) > 32 * 1024 * 1024) return output({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
    try { message = JSON.parse(line); }
    catch { return output({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const task = requestJson(connection.port, '/mcp', { token: connection.token, clientId, body: message, timeout: options.toolTimeoutMs + 3000 })
      .then(output).catch(error => {
        // Never log tokens, URLs, server response bodies or raw upstream errors.
        streams.stderr.write(`[brevess] ${/^[A-Z_]+$/.test(error.code || '') ? error.code : 'SERVICE_UNAVAILABLE'}: Local service request failed.\n`);
        if (message && Object.hasOwn(message, 'id')) output({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Local BREVESS service is unavailable. Reconnect after repair.' } });
      }).finally(() => pending.delete(task));
    pending.add(task);
  });
  input.on('close', () => { closed = true; clearInterval(keepAlive); });
  return { connection, close };
}
module.exports = { startProxy };
