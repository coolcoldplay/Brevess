#!/usr/bin/env node
// Agent-run setup. No downloads, API keys, browser profiles, or account tokens.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { runtimeFiles } = require('../extension/mcp/bootstrap.js');
const { extensionIdsFromManifest } = require('../extension/mcp/server.js');
const { getAgentSetupClients } = require('../extension/core/agent-setup-prompt.js');
const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
export const HOST = 'com.sci_reader.codex_bridge';
const BEGIN = '# BEGIN BREVESS MANAGED MCP';
const END = '# END BREVESS MANAGED MCP';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const json = value => JSON.stringify(value, null, 2) + '\n';
const exists = file => fs.existsSync(file);
const shellQuote = s => "'" + s.replaceAll("'", "'\\''") + "'";

export function readOptional(file) {
  if (!exists(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) fail('CONFIG_UNSAFE', 'Expected a regular, bounded configuration file: ' + file);
  return fs.readFileSync(file);
}

// Add one JSON member without reserializing any existing member or comments.
// JSONC parsing is strict except comments/trailing commas; duplicate keys fail closed.
export function parseJsonc(source) {
  let i = 0;
  const skip = () => {
    while (i < source.length) {
      if (/\s/u.test(source[i])) { i++; continue; }
      if (source.slice(i, i + 2) === '//') { const e = source.indexOf('\n', i); i = e < 0 ? source.length : e; continue; }
      if (source.slice(i, i + 2) === '/*') { const e = source.indexOf('*/', i + 2); if (e < 0) throw Error('comment'); i = e + 2; continue; }
      break;
    }
  };
  const string = () => {
    const start = i++;
    while (i < source.length) { if (source[i] === '\\') { i += 2; continue; } if (source[i++] === '"') return JSON.parse(source.slice(start, i)); }
    throw Error('string');
  };
  const value = () => {
    skip(); const start = i;
    if (source[i] === '{' || source[i] === '[') {
      const object = source[i++] === '{', endChar = object ? '}' : ']';
      const children = new Map(), output = object ? Object.create(null) : [];
      skip(); let trailing = false;
      while (source[i] !== endChar) {
        let key;
        if (object) { if (source[i] !== '"') throw Error('key'); key = string(); skip(); if (source[i++] !== ':') throw Error('colon'); }
        else key = String(output.length);
        if (children.has(key)) throw Error('duplicate');
        const child = value(); children.set(key, child); output[key] = child.value;
        skip(); trailing = source[i] === ',';
        if (trailing) { i++; skip(); } else if (source[i] !== endChar) throw Error('comma');
        if (i >= source.length) throw Error('end');
      }
      i++; return { start, end: i, children, object, trailing, value: output };
    }
    let v;
    if (source[i] === '"') v = string();
    else { const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(source.slice(i)); if (!match) throw Error('value'); i += match[0].length; v = JSON.parse(match[0]); }
    return { start, end: i, value: v };
  };
  try { const node = value(); skip(); if (i !== source.length || !node.object) throw Error('root'); return node; }
  catch { fail('CONFIG_PARSE_FAILED', 'Configuration is not an unambiguous JSON/JSONC object. Use the client official configuration UI; no file was changed.'); }
}

export function mergeJsonc(source, keys, entry, owns = () => false) {
  source ||= '{}\n';
  const root = parseJsonc(source); let node = root;
  for (let index = 0; index < keys.length; index++) {
    if (!node.object) fail('CONFIG_CONFLICT', 'MCP settings have an unexpected shape.');
    const key = keys[index], child = node.children.get(key), final = index === keys.length - 1;
    if (child && !final) { node = child; continue; }
    if (child) {
      if (JSON.stringify(child.value) === JSON.stringify(entry)) return source;
      if (!owns(child.value)) fail('CONFIG_CONFLICT', 'A different brevess entry already exists; review it in the client before replacing it.');
      return source.slice(0, child.start) + JSON.stringify(entry, null, 2) + source.slice(child.end);
    }
    let nested = entry;
    for (let j = keys.length - 1; j > index; j--) nested = { [keys[j]]: nested };
    // Insert the missing comma immediately after the previous value (before // comments).
    const children = [...node.children.values()], last = children.at(-1);
    let before = source.slice(0, node.end - 1);
    if (last && !node.trailing) before = source.slice(0, last.end) + ',' + source.slice(last.end, node.end - 1);
    return before + '\n  ' + JSON.stringify(key) + ': ' + JSON.stringify(nested, null, 2) + '\n' + source.slice(node.end - 1);
  }
}

export function mergeBlock(source, block, kind) {
  const text = source || '';
  const start = text.indexOf(BEGIN), end = text.indexOf(END);
  if ((start < 0) !== (end < 0) || (start >= 0 && (end < start || text.indexOf(BEGIN, start + BEGIN.length) >= 0))) fail('CONFIG_CONFLICT', 'An incomplete BREVESS block needs review.');
  const unmanaged = start < 0 ? text : text.slice(0, start) + text.slice(end + END.length);
  if (kind === 'toml' && /\[\s*mcp_servers\s*\.\s*["']?brevess["']?\s*[.\]]/u.test(unmanaged)) fail('CONFIG_CONFLICT', 'An unmanaged Codex brevess entry already exists.');
  if (kind === 'yaml') {
    if (/\b(?:serverName|id):\s*["']?brevess(?:["'\s]|-mcp)/u.test(unmanaged)) fail('CONFIG_CONFLICT', 'An unmanaged Harness brevess entry already exists.');
    const meaningful = unmanaged.split(/\r?\n/u).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (meaningful.length && (!meaningful[0].startsWith('- ') || meaningful.some(l => l === '---' || l === '...'))) fail('CONFIG_CONFLICT', 'Harness patch is not a single sequence; use official MCP settings.');
  }
  const managed = BEGIN + '\n' + block.trimEnd() + '\n' + END;
  return start < 0 ? text + (text.endsWith('\n') || !text ? '' : '\n') + managed + '\n'
    : text.slice(0, start) + managed + text.slice(end + END.length);
}

export function defaultPaths(platform = process.platform, home = os.homedir(), env = process.env) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const app = platform === 'darwin' ? p.join(home, 'Library', 'Application Support') : platform === 'win32' ? env.LOCALAPPDATA || p.join(home, 'AppData', 'Local') : env.XDG_DATA_HOME || p.join(home, '.local', 'share');
  return { root: p.join(app, 'BrevessCodexBridge'), stateDir: p.join(app, 'BrevessMcp') };
}

export function clientConfigPath(client, home, env = process.env) {
  const dir = (custom, fallback) => custom && path.isAbsolute(custom) ? custom : path.join(home, fallback);
  const codebuddy = dir(env.CODEBUDDY_CONFIG_DIR, '.codebuddy');
  const candidates = {
    codex: [path.join(dir(env.CODEX_HOME, '.codex'), 'config.toml')],
    dsh: [path.join(dir(env.DSH_HOME, '.dsh'), 'cordis.patch.yml')],
    claude: [path.join(home, '.claude.json')], gemini: [path.join(home, '.gemini', 'settings.json')],
    cursor: [path.join(home, '.cursor', 'mcp.json')], copilot: [path.join(home, '.copilot', 'mcp-config.json')],
    qwen: [path.join(home, '.qwen', 'settings.json')], kimi: [path.join(dir(env.KIMI_CODE_HOME, '.kimi-code'), 'mcp.json')],
    qoder: [path.join(dir(env.QODER_CONFIG_DIR, '.qoder'), 'settings.json')],
    codebuddy: [path.join(codebuddy, '.mcp.json'), path.join(codebuddy, 'mcp.json'), path.join(home, '.codebuddy.json')]
  }[client];
  return candidates?.find(exists) || candidates?.[0] || null;
}

export function nativeTargets(platform, home, root) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') return [p.join(root, HOST + '.json')];
  return (platform === 'darwin'
    ? ['Google/Chrome', 'Microsoft Edge'].map(x => p.join(home, 'Library/Application Support', x, 'NativeMessagingHosts'))
    : ['google-chrome', 'microsoft-edge'].map(x => p.join(home, '.config', x, 'NativeMessagingHosts'))).map(x => p.join(x, HOST + '.json'));
}

export function launcherText(platform, node, entry) {
  if ([node, entry].some(x => /[\r\n\0]/u.test(x))) fail('PATH_INVALID', 'Invalid launcher path.');
  if (platform !== 'win32') return '#!/bin/sh\nexec ' + shellQuote(node) + ' ' + shellQuote(entry) + ' "$@"\n';
  // Batch expansion remains active within double quotes. Reject such paths instead of guessing escaping.
  if ([node, entry].some(x => /[%!"^&|<>]/u.test(x))) fail('PATH_INVALID', 'Windows launcher path contains a command-expansion character.');
  return '@echo off\r\n"' + node + '" "' + entry + '" %*\r\n';
}

export function createPlan(options = {}) {
  const sourceRoot = options.sourceRoot || SOURCE, home = options.home || os.homedir();
  const platform = options.platform || process.platform, env = options.env || process.env;
  const defaults = defaultPaths(platform, home, env), root = options.root || defaults.root;
  const clients = [...new Set((options.clients || ['codex']).flatMap(x => x.split(',')))];
  if (clients.some(x => !getAgentSetupClients().some(c => c.id === x))) fail('CLIENT_INVALID', 'Choose a listed Agent client.');
  const extensionIds = extensionIdsFromManifest(path.join(sourceRoot, 'manifest.json'));
  const extensionId = options.extensionId;
  if (!/^[a-p]{32}$/u.test(extensionId || '') || !extensionIds.includes(extensionId)) fail('EXTENSION_MISMATCH', 'The extension ID does not match this source package. Use the installed extension version.');
  const files = [...new Set([...runtimeFiles(sourceRoot), 'native-host/host.js', 'native-host/entry.cjs'])].sort();
  const hash = crypto.createHash('sha256'); for (const f of files) hash.update(f).update(fs.readFileSync(path.join(sourceRoot, f)));
  const revision = hash.digest('hex').slice(0, 20), payloadRoot = path.join(root, 'agent', 'versions', revision);
  const activePath = path.join(root, 'agent', 'active.json'), beforeActive = readOptional(activePath);
  let active; try { active = beforeActive ? JSON.parse(beforeActive) : null; } catch { fail('CONFIG_PARSE_FAILED', 'Active companion descriptor is invalid.'); }
  const stateDir = active?.stateDir || options.stateDir || defaults.stateDir;
  const allowWrite = options.allowWrite === undefined ? active?.allowWrite === true : options.allowWrite === true;
  const port = active?.port || 9537, node = options.node || process.execPath;
  if (![root, stateDir, node].every(path.isAbsolute)) fail('PATH_INVALID', 'Runtime paths must be absolute.');
  const args = [path.join(payloadRoot, 'mcp/server.js'), '--stdio-only', '--state-dir', stateDir, '--port', String(port), allowWrite ? '--allow-write' : '--no-write'];
  const entry = { command: node, args };
  const changes = [], recipes = [];
  const add = (file, data, mode = 0o600) => {
    const before = readOptional(file), after = Buffer.from(data);
    if (!before || !before.equals(after)) changes.push({ file, before, after, mode, beforeMode: before ? fs.statSync(file).mode & 0o777 : null });
  };
  const owns = value => Array.isArray(value?.args) && value.args[0]?.startsWith(path.join(root, 'agent', 'versions') + path.sep) && value.args[0]?.endsWith(path.join('mcp', 'server.js'));
  for (const client of clients) {
    const file = clientConfigPath(client, home, env), old = file ? readOptional(file)?.toString('utf8') || '' : '';
    if (client === 'codex') add(file, mergeBlock(old, '[mcp_servers.brevess]\ncommand = ' + JSON.stringify(node) + '\nargs = ' + JSON.stringify(args) + '\nstartup_timeout_sec = 30\ntool_timeout_sec = 120', 'toml'));
    else if (client === 'dsh') add(file, mergeBlock(old, '- insert:\n    - id: brevess-mcp\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: brevess\n        transport: stdio\n        command: ' + JSON.stringify(node) + '\n        args: ' + JSON.stringify(args) + '\n        env: {}\n        cwd: ' + JSON.stringify(payloadRoot), 'yaml'));
    else if (file) add(file, mergeJsonc(old, ['mcpServers', 'brevess'], client === 'copilot' ? { type: 'local', ...entry, tools: ['*'] } : entry, owns));
    else {
      const file = path.join(root, 'agent', 'client-configs', client + '.json');
      add(file, json({ mcpServers: { brevess: entry } }));
      recipes.push({ client, state: 'client-setup-required', configurationFile: file,
        next: client === 'opencode' ? 'Detect installed OpenCode version. Use its official mcp add --global command; V1 and V2 config schemas differ. Pass command and args from this file without a shell.'
          : 'Add the generated stdio server in this client official MCP settings. Do not mark complete until actual tools/call succeeds.' });
    }
  }
  for (const f of files) add(path.join(payloadRoot, f), fs.readFileSync(path.join(sourceRoot, f)));
  add(activePath, json({ version: 1, payloadRoot, stateDir, nativeStateDir: root, port, allowWrite }));
  const launcher = path.join(root, 'agent', platform === 'win32' ? 'native-host.cmd' : 'native-host');
  add(launcher, launcherText(platform, node, path.join(payloadRoot, 'native-host/entry.cjs')), 0o700);
  const manifest = { name: HOST, description: 'BREVESS local Agent connection', path: launcher, type: 'stdio', allowed_origins: extensionIds.map(id => `chrome-extension://${id}/`) };
  const nativeFiles = nativeTargets(platform, home, root); for (const f of nativeFiles) add(f, json(manifest));
  const registry = platform === 'win32' ? ['Google\\Chrome', 'Microsoft\\Edge'].map(x => ({ key: 'HKCU\\Software\\' + x + '\\NativeMessagingHosts\\' + HOST, value: nativeFiles[0] })) : [];
  return { root, clients, platform, revision, payloadRoot, node, extensionId, stateDir, allowWrite, changes, recipes, registry };
}

function writeAtomic(file, bytes, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(tmp, bytes, { flag: 'wx', mode }); fs.renameSync(tmp, file); }
  finally { if (exists(tmp)) fs.unlinkSync(tmp); }
}
function reg(args) {
  const r = spawnSync('reg.exe', args, { encoding: 'utf8', windowsHide: true, shell: false });
  if (r.error) fail('REGISTRY_FAILED', 'Could not run Windows registry utility.');
  return r;
}
function regRead(key) {
  const r = reg(['query', key, '/ve']);
  if (r.status !== 0) return null;
  const match = /REG_SZ\s+([^\r\n]+)/u.exec(r.stdout);
  if (!match) fail('REGISTRY_CONFLICT', 'Existing native host registration is not REG_SZ.');
  return match[1].trim();
}
function regWrite(key, value) {
  const r = value === null ? reg(['delete', key, '/ve', '/f']) : reg(['add', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f']);
  if (r.status !== 0) fail('REGISTRY_FAILED', 'Could not update native host registration.');
}

export function applyPlan(plan) {
  const check = spawnSync(plan.node, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
  if (check.status !== 0 || !/^v(?:2[2-9]|[3-9]\d)\./u.test(check.stdout)) fail('NODE_REQUIRED', 'Use an installed Node.js 22 or newer runtime.');
  // Preflight all writes before the first mutation, including any concurrent edits.
  for (const c of plan.changes) {
    const now = readOptional(c.file);
    if ((now === null) !== (c.before === null) || (now && !now.equals(c.before))) fail('CONFIG_CHANGED', 'Configuration changed while preparing setup. Retry.');
  }
  const registry = plan.registry.map(r => ({ ...r, before: regRead(r.key) })).filter(r => r.before !== r.value);
  if (!plan.changes.length && !registry.length) return { status: plan.recipes.length ? 'client-setup-required' : 'already-configured', recipes: plan.recipes };
  const backupDir = path.join(plan.root, 'agent', 'backups', new Date().toISOString().replaceAll(':', '-') + '-' + crypto.randomUUID().slice(0, 8));
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const records = plan.changes.map((c, i) => {
    const backup = c.before ? path.join(backupDir, i + '.bak') : null;
    if (backup) fs.writeFileSync(backup, c.before, { mode: 0o600, flag: 'wx' });
    return { file: c.file, backup, beforeHash: c.before ? digest(c.before) : null, afterHash: digest(c.after), beforeMode: c.beforeMode };
  });
  const receiptFile = path.join(backupDir, 'receipt.json');
  const receipt = { version: 1, state: 'prepared', clients: plan.clients, files: records, registry };
  writeAtomic(receiptFile, json(receipt), 0o600);
  const applied = [], appliedRegistry = [];
  try {
    for (const c of plan.changes) { writeAtomic(c.file, c.after, c.mode); applied.push(c); }
    for (const r of registry) { regWrite(r.key, r.value); appliedRegistry.push(r); }
    receipt.state = 'applied'; writeAtomic(receiptFile, json(receipt), 0o600);
  } catch (error) {
    for (const r of appliedRegistry.reverse()) regWrite(r.key, r.before);
    for (const c of applied.reverse()) { if (c.before) writeAtomic(c.file, c.before, c.beforeMode); else fs.unlinkSync(c.file); }
    receipt.state = 'rolled-back'; writeAtomic(receiptFile, json(receipt), 0o600); throw error;
  }
  return { status: plan.recipes.length ? 'client-setup-required' : 'configured-not-tested', receipt: receiptFile, recipes: plan.recipes };
}

export function restoreReceipt(receiptFile) {
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  if (receipt.version !== 1 || receipt.state !== 'applied') fail('RESTORE_INVALID', 'This receipt is not an applied setup.');
  // Check everything first: never roll over later user edits or changed backups.
  for (const r of receipt.files) {
    const now = readOptional(r.file);
    if (!now || digest(now) !== r.afterHash) fail('RESTORE_CONFLICT', 'A file has changed after setup; no files restored: ' + r.file);
    if (r.backup && digest(fs.readFileSync(r.backup)) !== r.beforeHash) fail('RESTORE_INVALID', 'Backup checksum mismatch.');
  }
  for (const r of receipt.registry || []) if (regRead(r.key) !== r.value) fail('RESTORE_CONFLICT', 'Native host registration changed after setup.');
  for (const r of [...(receipt.registry || [])].reverse()) regWrite(r.key, r.before);
  for (const r of [...receipt.files].reverse()) { if (r.backup) writeAtomic(r.file, fs.readFileSync(r.backup), r.beforeMode); else fs.unlinkSync(r.file); }
  receipt.state = 'restored'; writeAtomic(receiptFile, json(receipt), 0o600);
  return { status: 'restored', files: receipt.files.length, researchDataRemoved: false };
}

export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--allow-write') options.allowWrite = true;
    else if (arg === '--read-only') options.allowWrite = false;
    else if (['--client', '--extension-id', '--restore'].includes(arg)) {
      const value = args[++i]; if (!value || value.startsWith('--')) fail('ARGUMENT_INVALID', 'Missing argument for ' + arg);
      if (arg === '--client') options.clients = value.split(','); else options[arg === '--restore' ? 'restore' : 'extensionId'] = value;
    } else fail('ARGUMENT_INVALID', 'Unknown setup argument: ' + arg);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.restore) {
      if (options.dryRun) fail('ARGUMENT_INVALID', '--restore and --dry-run cannot be combined.');
      console.log(json(restoreReceipt(options.restore)));
    } else {
      const plan = createPlan(options);
      console.log(json(options.dryRun ? { status: 'plan-only', clients: plan.clients, root: plan.root,
        files: plan.changes.map(c => c.file), registry: plan.registry.map(r => r.key), recipes: plan.recipes,
        officialLogin: 'unchanged', modelRoutes: 'unchanged', allowWrite: plan.allowWrite }
        : applyPlan(plan)));
    }
  } catch (error) { console.error(json({ error: error.code || 'SETUP_FAILED', message: error.code ? error.message : 'Setup failed; review file permissions and the configuration format.' })); process.exitCode = 1; }
}
