const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { WorkspaceDirectoryService, CodexBridgeHost, TurnImageStore } = require('../native-host/host.js');

const rootId = '31c5f603-5974-4cc1-af94-43a67a38c970';
const otherRootId = '3e2e33bf-0d7c-436f-b37e-4c58c095d804';
const challenge = '12'.repeat(32);
const now = 1_800_000_000_000;
const workspaceId = `workspace:${'a'.repeat(64)}`;
const directoryName = `Synthetic study--${'a'.repeat(16)}`;
const canonicalUrl = 'https://example.org/article';
const identity = { rootId, workspaceId, workspaceGeneration: 2, canonicalUrl, directoryName };
const expected = suffix => ({ code: `WORKSPACE_DIRECTORY_${suffix}` });
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data), 'utf8');

function fixture(t, options = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-native-directory-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.match(path.basename(temporary), /^brevess-native-directory-test-/u);
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const dataRoot = path.join(temporary, 'Brevess');
  const stateRoot = path.join(temporary, 'host-state');
  const target = path.join(dataRoot, 'workspaces', directoryName);
  fs.mkdirSync(target, { recursive: true });
  const proofPath = path.join(dataRoot, 'native-directory-binding.json');
  const manifestPath = path.join(target, 'manifest.json');
  const proof = { schemaVersion: 1, kind: 'brevess-native-directory-binding', rootId, challenge, expiresAt: now + 300_000 };
  const manifest = { schemaVersion: 1, kind: 'sci-logic-highlighter-workspace', workspaceId,
    workspaceGeneration: 2, canonicalUrl, directoryName, aliases: [], title: 'Synthetic study',
    contentHash: 'b'.repeat(64), revision: 2, createdAt: '', updatedAt: '', assets: [] };
  write(proofPath, proof); write(manifestPath, manifest);
  const launches = [];
  const serviceOptions = { stateRoot, platform: 'win32', systemRoot: 'C:\\Windows', now: () => now,
    spawnImpl(command, args, options) {
      launches.push({ command, args, options });
      const child = new EventEmitter(); child.unref = () => {};
      queueMicrotask(() => child.emit('spawn')); return child;
    }, ...options };
  assert.equal(typeof WorkspaceDirectoryService, 'function');
  const service = new WorkspaceDirectoryService(serviceOptions);
  return { temporary, dataRoot, stateRoot, target, proofPath, manifestPath, proof, manifest,
    launches, service, serviceOptions,
    bind: () => service.bind({ absolutePath: dataRoot, rootId, challenge }) };
}

test('capability probe and unbound status do not create or inspect configuration/root paths', t => {
  const f = fixture(t);
  const probeOnly = new WorkspaceDirectoryService(f.serviceOptions);
  probeOnly.readConfig = () => { throw Error('Capability probe must not read configuration'); };
  probeOnly.boundRoot = () => { throw Error('Capability probe must not inspect any root'); };
  assert.deepEqual(probeOnly.status({ rootId: '' }), { supported: true, bound: false, rootId: '' });
  assert.deepEqual(f.service.status({ rootId }), { supported: true, bound: false, rootId });
  assert.equal(fs.existsSync(f.stateRoot), false);
  assert.throws(() => f.service.open(identity), expected('NOT_BOUND'));
  assert.equal(fs.existsSync(f.stateRoot), false); assert.equal(f.launches.length, 0);
});

test('fresh exact proof binds only rootId to realRoot and survives service restart/proof expiry', async t => {
  const f = fixture(t);
  assert.deepEqual(f.bind(), { supported: true, bound: true, rootId });
  const config = JSON.parse(fs.readFileSync(path.join(f.stateRoot, 'workspace-directories.json'), 'utf8'));
  assert.deepEqual(config.bindings, { [rootId]: fs.realpathSync(f.dataRoot) });
  assert.ok(!JSON.stringify(config).includes(challenge));
  const restarted = new WorkspaceDirectoryService({ ...f.serviceOptions, now: () => now + 600_000 });
  assert.deepEqual(restarted.status({ rootId }), { supported: true, bound: true, rootId });
  assert.deepEqual(await restarted.open(identity), { opened: true, rootId, workspaceId });
  assert.equal(f.launches.length, 1);
  assert.equal(f.launches[0].command, 'C:\\Windows\\explorer.exe');
  assert.deepEqual(f.launches[0].args, [fs.realpathSync(f.target)]);
  assert.equal(f.launches[0].options.shell, false);
});

test('real schema manifests preserve nonnegative generation zero and DOI-only empty canonical URL', async t => {
  const { createWorkspaceManifest } = require('../core/article-workspace.js');
  const f = fixture(t); f.bind();
  const manifest = createWorkspaceManifest({ ...f.manifest, workspaceGeneration: 0,
    canonicalUrl: '', aliases: [{ type: 'doi', value: '10.1000/synthetic' }] });
  write(f.manifestPath, manifest);
  assert.deepEqual(await f.service.open({ ...identity, workspaceGeneration: 0, canonicalUrl: '' }),
    { opened: true, rootId, workspaceId });
});

test('only the explicit empty-root capability probe accepts a missing UUID', t => {
  const f = fixture(t);
  for (const invalid of ['', undefined, 'not-a-uuid', '__proto__']) {
    if (invalid !== '') assert.throws(() => f.service.status({ rootId: invalid }), expected('INVALID_REQUEST'));
    assert.throws(() => f.service.bind({ rootId: invalid, challenge, absolutePath: f.dataRoot }), expected('INVALID_REQUEST'));
    assert.throws(() => f.service.open({ ...identity, rootId: invalid }), expected('INVALID_REQUEST'));
  }
  assert.equal(fs.existsSync(f.stateRoot), false);
});

for (const [name, change, error] of [
  ['root mismatch', { rootId: otherRootId }, 'ROOT_MISMATCH'],
  ['challenge mismatch', { challenge: '34'.repeat(32) }, 'PROOF_INVALID'],
  ['wrong proof kind', { kind: 'other' }, 'PROOF_INVALID'],
  ['wrong proof schema', { schemaVersion: 2 }, 'PROOF_INVALID'],
  ['expired proof', { expiresAt: now }, 'PROOF_EXPIRED'],
  ['excessive expiry', { expiresAt: now + 600_001 }, 'PROOF_EXPIRED'],
  ['string expiry', { expiresAt: String(now + 300_000) }, 'PROOF_INVALID']
]) test(`bind rejects ${name} before creating config`, t => {
  const f = fixture(t); write(f.proofPath, { ...f.proof, ...change });
  assert.throws(f.bind, expected(error)); assert.equal(fs.existsSync(f.stateRoot), false);
});

test('binding a missing root/marker or malformed and oversized JSON writes nothing', t => {
  const f = fixture(t);
  assert.throws(() => f.service.bind({ absolutePath: path.join(f.temporary, 'missing'), rootId, challenge }), expected('ROOT_MISSING'));
  fs.unlinkSync(f.proofPath); assert.throws(f.bind, expected('PROOF_INVALID'));
  fs.writeFileSync(f.proofPath, '{'); assert.throws(f.bind, expected('PROOF_INVALID'));
  fs.writeFileSync(f.proofPath, ' '.repeat(20_000)); assert.throws(f.bind, expected('PROOF_INVALID'));
  assert.equal(fs.existsSync(f.stateRoot), false);
});

for (const absolutePath of ['relative/Brevess', 'C:relative', '\\\\server\\share\\Brevess',
  '//server/share/Brevess', '\\\\?\\C:\\Brevess', 'C:\\Brevess:stream', 'C:\\one\\..\\Brevess']) {
  test(`bind rejects nonlocal/nonabsolute/ambiguous path ${JSON.stringify(absolutePath)}`, t => {
    const f = fixture(t);
    assert.throws(() => f.service.bind({ absolutePath, rootId, challenge }), expected('INVALID_PATH'));
    assert.equal(fs.existsSync(f.stateRoot), false);
  });
}

test('status/open recheck root marker and root existence without rewriting config', t => {
  const f = fixture(t); f.bind();
  const configPath = path.join(f.stateRoot, 'workspace-directories.json');
  const before = fs.readFileSync(configPath);
  write(f.proofPath, { ...f.proof, rootId: otherRootId });
  assert.throws(() => f.service.status({ rootId }), expected('ROOT_MISMATCH'));
  assert.throws(() => f.service.open(identity), expected('ROOT_MISMATCH'));
  fs.renameSync(f.dataRoot, path.join(f.temporary, 'moved'));
  assert.throws(() => f.service.status({ rootId }), expected('ROOT_MISSING'));
  assert.deepEqual(fs.readFileSync(configPath), before); assert.equal(f.launches.length, 0);
});

test('wrong root remains unbound without leaking the existing absolute path', t => {
  const f = fixture(t); f.bind();
  assert.deepEqual(f.service.status({ rootId: otherRootId }), { supported: true, bound: false, rootId: otherRootId });
  assert.throws(() => f.service.open({ ...identity, rootId: otherRootId }), expected('NOT_BOUND'));
});

for (const [name, change] of [
  ['owner', { workspaceId: `workspace:${'c'.repeat(64)}` }],
  ['generation', { workspaceGeneration: 3 }],
  ['URL', { canonicalUrl: 'https://example.org/other' }],
  ['directory name', { directoryName: `Other--${'a'.repeat(16)}` }]
]) test(`open rejects manifest/request ${name} mismatch with zero spawn`, t => {
  const f = fixture(t); f.bind(); write(f.manifestPath, { ...f.manifest, ...change });
  assert.throws(() => f.service.open(identity), expected('IDENTITY_MISMATCH'));
  assert.equal(f.launches.length, 0);
});

for (const manifest of [{ schemaVersion: 2 }, { kind: 'wrong' }, { workspaceGeneration: '2' }]) {
  test(`open rejects malformed manifest ${JSON.stringify(manifest)}`, t => {
    const f = fixture(t); f.bind(); write(f.manifestPath, { ...f.manifest, ...manifest });
    assert.throws(() => f.service.open(identity), expected('MANIFEST_INVALID'));
  });
}

test('missing workspace/manifest never creates a directory or invokes explorer', t => {
  const f = fixture(t); f.bind(); fs.unlinkSync(f.manifestPath);
  assert.throws(() => f.service.open(identity), expected('MANIFEST_INVALID'));
  fs.rmdirSync(f.target);
  assert.throws(() => f.service.open(identity), expected('MISSING'));
  assert.equal(fs.existsSync(f.target), false); assert.equal(f.launches.length, 0);
});

for (const name of ['../escape', '..\\escape', '/absolute', 'C:\\absolute', 'x:ads',
  '\\\\server\\share', 'CON', 'has-trailing-space ', 'has-trailing-dot.', 'x\\y', 'x/y']) {
  test(`open rejects unsafe directory component ${JSON.stringify(name)}`, t => {
    const f = fixture(t); f.bind();
    assert.throws(() => f.service.open({ ...identity, directoryName: name }), expected('INVALID_PATH'));
    assert.equal(f.launches.length, 0);
  });
}

test('workspace symlink/junction escape and workspaces root replacement are rejected', t => {
  const f = fixture(t); f.bind();
  const outside = path.join(f.temporary, 'outside'); fs.mkdirSync(outside);
  write(path.join(outside, 'manifest.json'), f.manifest);
  fs.unlinkSync(f.manifestPath); fs.rmdirSync(f.target);
  fs.symlinkSync(outside, f.target, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.service.open(identity), expected('PATH_ESCAPE'));
  fs.unlinkSync(f.target); fs.rmdirSync(path.join(f.dataRoot, 'workspaces'));
  fs.symlinkSync(outside, path.join(f.dataRoot, 'workspaces'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.service.open(identity), expected('PATH_ESCAPE'));
  assert.equal(f.launches.length, 0);
});

test('corrupt existing configuration fails closed and is not replaced by bind', t => {
  const f = fixture(t); fs.mkdirSync(f.stateRoot); const file = path.join(f.stateRoot, 'workspace-directories.json');
  fs.writeFileSync(file, '{bad');
  assert.throws(() => f.service.status({ rootId }), expected('CONFIG_INVALID'));
  assert.throws(f.bind, expected('CONFIG_INVALID')); assert.equal(fs.readFileSync(file, 'utf8'), '{bad');
});

test('explorer spawn errors are explicit and no arbitrary message path reaches spawn', async t => {
  const f = fixture(t, { spawnImpl() { const child = new EventEmitter(); queueMicrotask(() => child.emit('error', Error('denied'))); return child; } });
  f.bind(); await assert.rejects(f.service.open({ ...identity, absolutePath: 'C:\\arbitrary.exe' }), expected('OPEN_FAILED'));
});

test('non-Windows capability is accurate and cannot bind/open', t => {
  const f = fixture(t, { platform: 'linux' });
  assert.deepEqual(f.service.status({ rootId: '' }), { supported: false, bound: false, rootId: '' });
  assert.throws(f.bind, expected('UNSUPPORTED')); assert.throws(() => f.service.open(identity), expected('UNSUPPORTED'));
});

function hostImageFixture(t) {
  const f = fixture(t);
  const turnImageRoot = path.join(f.temporary, 'real-turn-images');
  const stale = path.join(turnImageRoot, 'stale-synthetic-lease');
  const fresh = path.join(turnImageRoot, 'fresh-synthetic-lease');
  fs.mkdirSync(stale, { recursive: true }); fs.mkdirSync(fresh);
  fs.writeFileSync(path.join(stale, 'existing-image.txt'), 'synthetic stale image');
  fs.writeFileSync(path.join(fresh, 'existing-image.txt'), 'synthetic active image');
  const expired = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(stale, expired, expired);
  const sent = [];
  const host = new CodexBridgeHost({
    server: {
      onNotification() { return () => {}; }, close() {},
      start() { assert.fail('Directory status must not start the model server'); },
      request() { assert.fail('Directory status must not request model or auth services'); }
    },
    turnImageRoot, threadMapPath: path.join(f.temporary, 'threads.json'),
    readerEventRoot: path.join(f.temporary, 'reader-events'),
    pdfFigureTaskRoot: path.join(f.temporary, 'pdf-figure-tasks'),
    workspaceDirectoryOptions: f.serviceOptions, send: message => sent.push(message)
  });
  t.after(() => host.close());
  assert.ok(host.imageStore instanceof TurnImageStore);
  return { ...f, host, sent, stale, fresh };
}

test('real host construction and directory status preserve stale and active image files', async t => {
  const f = hostImageFixture(t);
  assert.equal(fs.readFileSync(path.join(f.stale, 'existing-image.txt'), 'utf8'), 'synthetic stale image');
  for (const probeRoot of ['', rootId]) {
    await f.host.handle({ type: 'workspace.directory.status', rootId: probeRoot, requestId: 'read-only' });
    assert.deepEqual(f.sent.pop(), { type: 'workspace.directory.status.result', requestId: 'read-only',
      supported: true, bound: false, rootId: probeRoot });
  }
  assert.equal(fs.readFileSync(path.join(f.stale, 'existing-image.txt'), 'utf8'), 'synthetic stale image');
  assert.equal(fs.readFileSync(path.join(f.fresh, 'existing-image.txt'), 'utf8'), 'synthetic active image');
  assert.equal(fs.existsSync(f.stateRoot), false);
});

test('real image materialize still cleans stale leases and releases only its own valid PNG lease', t => {
  const f = hostImageFixture(t);
  assert.deepEqual(f.host.imageStore.materialize('no-images', []), { directory: '', inputs: [], imageCount: 0 });
  assert.equal(fs.existsSync(f.stale), true);
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const lease = f.host.imageStore.materialize('real-synthetic-png', [{ dataUrl: `data:image/png;base64,${base64}` }]);
  assert.equal(fs.existsSync(f.stale), false);
  assert.equal(fs.readFileSync(path.join(f.fresh, 'existing-image.txt'), 'utf8'), 'synthetic active image');
  assert.equal(lease.imageCount, 1); assert.equal(lease.inputs[0].type, 'localImage');
  assert.deepEqual(fs.readFileSync(lease.inputs[0].path), Buffer.from(base64, 'base64'));
  f.host.imageStore.cleanup(lease);
  assert.equal(fs.existsSync(lease.directory), false);
  assert.equal(fs.existsSync(f.fresh), true);
});

test('native dispatch preserves envelope/error and routes old commands independently of directory capability', async t => {
  const f = fixture(t); const sent = []; const samples = [];
  const host = new CodexBridgeHost({
    server: { onNotification() { return () => {}; }, close() {} }, threadMap: {}, imageStore: {},
    eventStore: {}, pdfFigureStore: { close() {} }, pdfTranslationPages: { close() {} },
    workspaceDirectoryService: f.service, send: message => { sent.push(message); samples.push(message); }
  });
  t.after(() => host.close());
  await host.handle({ type: 'workspace.directory.status', rootId: '', requestId: 'probe' });
  assert.deepEqual(sent.pop(), { type: 'workspace.directory.status.result', requestId: 'probe', supported: true, bound: false, rootId: '' });
  await host.handle({ type: 'workspace.directory.bind', absolutePath: f.dataRoot, rootId, challenge, requestId: 'bind' });
  assert.equal(sent.pop().type, 'workspace.directory.bind.result');
  await host.handle({ type: 'workspace.directory.open', ...identity, requestId: 'open' });
  assert.deepEqual(sent.pop(), { type: 'workspace.directory.open.result', requestId: 'open', opened: true, rootId, workspaceId });
  await host.handle({ type: 'workspace.directory.open', ...identity, rootId: otherRootId, requestId: 'error' });
  const error = sent.pop(); assert.equal(error.type, 'workspace.directory.error'); assert.equal(error.requestId, 'error');
  assert.equal(error.error.code, 'WORKSPACE_DIRECTORY_NOT_BOUND'); assert.equal(error.error.retryable, false);
  const routed = [];
  host.health = async id => routed.push(['health', id]); host.handlePdfFigure = async message => routed.push(['pdf', message.requestId]);
  host.startLogin = async id => routed.push(['auth', id]);
  await host.handle({ type: 'health.check', requestId: 'h' }); await host.handle({ type: 'pdf.figure.health', requestId: 'p' });
  await host.handle({ type: 'auth.login.start', requestId: 'a' });
  assert.deepEqual(routed, [['health', 'h'], ['pdf', 'p'], ['auth', 'a']]);
  t.diagnostic(`LIB010_INTERFACE_SAMPLES ${JSON.stringify(samples)}`);
});
