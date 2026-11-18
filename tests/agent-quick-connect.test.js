const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildAgentSetupPrompt, getAgentSetupClients } = require('../extension/core/agent-setup-prompt.js');
const { encodeNativeMessage } = require('../extension/native-host/host.js');
const { extensionIdsFromManifest } = require('../extension/mcp/server.js');
const installer = import('../scripts/setup-agent-connection.mjs');
const extensionId = extensionIdsFromManifest(path.join(__dirname, '../extension/manifest.json'))[0];
function sandbox(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-agent-setup-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function options(home, clients) { return { home, clients, root: path.join(home, 'internal'), stateDir: path.join(home, 'state'), env: {}, extensionId }; }

test('domestic and international prompts describe actual support and include no credentials', () => {
  const clients = getAgentSetupClients();
  for (const id of ['dsh', 'qwen', 'kimi', 'qoder', 'codebuddy', 'trae', 'codex', 'claude', 'gemini', 'cursor', 'copilot', 'opencode']) assert.ok(clients.some(c => c.id === id));
  for (const c of clients) {
    const text = buildAgentSetupPrompt(c.id, { extensionId, version: '1.0.2', os: 'mac', apiKey: 'PRIVATE_KEY_MUST_NOT_APPEAR' });
    assert.ok(text.includes('--client ' + c.id)); assert.ok(text.includes('--dry-run'));
    assert.ok(text.includes('library.query_global_library')); assert.ok(!text.includes('PRIVATE_KEY_MUST_NOT_APPEAR'));
    if (!c.modelAdapter) assert.ok(text.includes('尚待适配') || text.includes('待适配'));
  }
  assert.throws(() => buildAgentSetupPrompt('invented'));
});

test('JSONC insertion preserves unrelated bytes, comments, trailing commas and nested services', async () => {
  const { mergeJsonc, parseJsonc } = await installer;
  const source = '{\n // preserve me\n "api": "https://localhost/",\n "mcpServers": {"other": {"command":"other"} // preserve this too\n },\n}\n';
  const entry = { command: '/path with spaces/node', args: ['server.js'] };
  const output = mergeJsonc(source, ['mcpServers', 'brevess'], entry);
  const parsed = parseJsonc(output).value;
  assert.equal(parsed.api, 'https://localhost/'); assert.equal(parsed.mcpServers.other.command, 'other');
  assert.equal(parsed.mcpServers.brevess.command, entry.command);
  assert.ok(output.includes('// preserve this too')); assert.equal(mergeJsonc(output, ['mcpServers', 'brevess'], entry), output);
  assert.equal(parseJsonc(mergeJsonc('{}', ['mcpServers', 'brevess'], entry)).value.mcpServers.brevess.command, entry.command);
  assert.throws(() => mergeJsonc(output, ['mcpServers', 'brevess'], { command: 'replacement' }), { code: 'CONFIG_CONFLICT' });
  assert.throws(() => parseJsonc('{"x":1,"x":2}'), { code: 'CONFIG_PARSE_FAILED' });
  assert.throws(() => parseJsonc('{ /* broken'), { code: 'CONFIG_PARSE_FAILED' });
});

test('managed TOML/YAML blocks preserve other settings and reject collisions', async () => {
  const { mergeBlock } = await installer;
  const original = 'model = "existing"\n[mcp_servers.other]\ncommand = "other"\n';
  const first = mergeBlock(original, '[mcp_servers.brevess]\ncommand = "first"', 'toml');
  const second = mergeBlock(first, '[mcp_servers.brevess]\ncommand = "second"', 'toml');
  assert.ok(second.startsWith(original)); assert.ok(!second.includes('first')); assert.equal(second.split('BEGIN BREVESS').length, 2);
  assert.throws(() => mergeBlock('[mcp_servers."brevess"]\ncommand="other"', 'x', 'toml'), { code: 'CONFIG_CONFLICT' });
  assert.throws(() => mergeBlock('plugins: {}', 'x', 'yaml'), { code: 'CONFIG_CONFLICT' });
  assert.ok(mergeBlock('- insert:\n  - id: other\n', '- insert:\n  - id: brevess-mcp', 'yaml').startsWith('- insert:\n  - id: other\n'));
});

test('all client plans are incremental, accurate about pending client steps, and dry', async t => {
  const { createPlan, parseJsonc } = await installer; const home = sandbox(t);
  const clients = getAgentSetupClients().map(c => c.id); const plan = createPlan(options(home, clients));
  assert.equal(fs.readdirSync(home).length, 0); assert.equal(plan.allowWrite, false);
  assert.deepEqual(plan.recipes.map(x => x.client), ['trae', 'opencode', 'generic']);
  for (const suffix of ['.qwen/settings.json', '.kimi-code/mcp.json', '.qoder/settings.json', '.codebuddy/.mcp.json', '.cursor/mcp.json']) {
    const change = plan.changes.find(c => c.file.endsWith(suffix)); assert.ok(change, suffix);
    assert.ok(parseJsonc(change.after.toString()).value.mcpServers.brevess.command);
  }
  const copilot = plan.changes.find(c => c.file.endsWith('.copilot/mcp-config.json'));
  assert.equal(parseJsonc(copilot.after.toString()).value.mcpServers.brevess.type, 'local');
  const dsh = plan.changes.find(c => c.file.endsWith('.dsh/cordis.patch.yml')).after.toString();
  assert.ok(dsh.includes('- insert:')); assert.ok(dsh.includes('@deepseek-ai/dsh-mcp-client'));
  assert.throws(() => createPlan({ ...options(home, ['qwen']), extensionId: 'a'.repeat(32) }), { code: 'EXTENSION_MISMATCH' });
});

test('setup is idempotent, backed up, reversible and refuses concurrent user edits', async t => {
  const { createPlan, applyPlan, restoreReceipt } = await installer; const home = sandbox(t);
  fs.mkdirSync(path.join(home, '.qwen')); const config = path.join(home, '.qwen/settings.json');
  const original = '{"theme":"mine","mcpServers":{"existing":{"command":"keep"}}}\n'; fs.writeFileSync(config, original);
  const opts = options(home, ['qwen']); const result = applyPlan(createPlan(opts));
  assert.equal(result.status, 'configured-not-tested'); assert.ok(fs.existsSync(result.receipt));
  assert.equal(applyPlan(createPlan(opts)).status, 'already-configured');
  const installed = fs.readFileSync(config, 'utf8'); fs.appendFileSync(config, '// user edit\n');
  assert.throws(() => restoreReceipt(result.receipt), { code: 'RESTORE_CONFLICT' });
  assert.ok(fs.readFileSync(config, 'utf8').endsWith('// user edit\n'));
  fs.writeFileSync(config, installed); assert.equal(restoreReceipt(result.receipt).status, 'restored');
  assert.equal(fs.readFileSync(config, 'utf8'), original);
  const plan = createPlan(opts); fs.writeFileSync(config, '{}');
  assert.throws(() => applyPlan(plan), { code: 'CONFIG_CHANGED' });
});

test('Windows uses user registry targets and launcher paths preserve spaces without expansion', async () => {
  const { nativeTargets, launcherText, defaultPaths } = await installer;
  const home = 'C:\\Users\\Test User', root = defaultPaths('win32', home, {}).root;
  assert.ok(root.startsWith(home)); assert.equal(nativeTargets('win32', home, root).length, 1);
  const text = launcherText('win32', 'C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\Test User\\entry.cjs');
  assert.ok(text.includes('"C:\\Program Files\\nodejs\\node.exe"')); assert.ok(text.endsWith(' %*\r\n'));
  assert.throws(() => launcherText('win32', 'C:\\%BAD%\\node.exe', 'C:\\entry.cjs'), { code: 'PATH_INVALID' });
  assert.ok(launcherText('darwin', "/tmp/owner's path/node", '/tmp/entry.cjs').includes("'\\''"));
});

test('native entry validates Chrome origin and status is a real framed response with no token', async t => {
  const { createPlan, applyPlan } = await installer; const home = sandbox(t);
  const plan = createPlan(options(home, ['generic'])); applyPlan(plan);
  async function invoke(origin, message) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(plan.payloadRoot, 'native-host/entry.cjs'), origin], { stdio: ['pipe', 'pipe', 'pipe'] });
      let bytes = Buffer.alloc(0), stderr = ''; const timer = setTimeout(() => { child.kill(); reject(Error('timeout')); }, 8000);
      child.stderr.on('data', b => { stderr += b.toString(); });
      child.stdout.on('data', b => { bytes = Buffer.concat([bytes, b]); if (bytes.length >= 4 && bytes.length >= bytes.readUInt32LE(0) + 4) child.stdin.end(); });
      child.on('error', reject); child.on('exit', code => { clearTimeout(timer); resolve({ code, bytes, stderr }); });
      child.stdin.on('error', () => {}); child.stdin.write(encodeNativeMessage(message));
    });
  }
  const response = await invoke(`chrome-extension://${extensionId}/`, { type: 'agent.connection.status', requestId: 'test', extensionId: 'a'.repeat(32) });
  assert.equal(response.code, 0, response.stderr); const data = JSON.parse(response.bytes.subarray(4).toString());
  assert.equal(data.requestId, 'test'); assert.equal(data.phase, 'component-ready'); assert.equal(data.extensionId, extensionId);
  assert.equal(data.pairing, undefined); assert.ok(!response.bytes.includes('bridge-token'));
  for (const origin of [`https://${extensionId}/`, `chrome-extension://${extensionId}/?fake=1`, 'chrome-extension://' + 'a'.repeat(32) + '/']) {
    const rejected = await invoke(origin, { type: 'agent.connection.status' }); assert.equal(rejected.code, 1); assert.equal(rejected.bytes.length, 0);
  }
});

test('Harness health handles a missing version without turning a successful check into an exception', async () => {
  const { HarnessBridgeService } = require('../extension/native-host/host.js');
  const messages = [];
  const service = new HarnessBridgeService({ send: message => messages.push(message), processFactory: () => ({
    start: async () => {}, request: async () => ({ accountStatus: 'credential-stored' }), close() {}
  }) });
  await service.handle({ type: 'harness.health.check', requestId: 'version-fallback' }); service.close();
  assert.equal(messages[0].type, 'harness.health.result'); assert.equal(messages[0].version, 'unknown');
  assert.equal(messages[0].credentialStored, true);
});
