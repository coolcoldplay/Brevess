const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { createArticleWorkspaceIdentity, createWorkspaceManifest,
  createWorkspaceIndex } = require('../core/article-workspace.js');
const { createDirectorySync, createMemoryDirectoryHandleStore,
  createMemorySyncQueue } = require('../core/directory-sync.js');

const PROOF = 'native-directory-binding.json';
const ROOT_ID = 'daf60e4a-cc11-42dd-a130-ae479cc45092';
const clock = 1800000000000;
const workspace = {
  workspaceId: `workspace:${'a'.repeat(64)}`,
  directoryName: `A paper--${'a'.repeat(16)}`,
  canonicalUrl: 'https://example.org/paper',
  contentHash: 'b'.repeat(64), workspaceGeneration: 3, storageRevision: 7,
  title: 'A paper'
};
function proof(overrides = {}) {
  return { schemaVersion: 1, kind: 'brevess-native-directory-binding',
    rootId: ROOT_ID, challenge: 'c'.repeat(64), expiresAt: clock - 1, ...overrides };
}
function fsError(name) { return Object.assign(new Error(name), { name }); }
function filesystem(rootName = 'Brevess') {
  const dirs = new Set(['']);
  const files = new Map();
  const handles = new Map();
  const operations = [];
  let permission = 'granted';
  let beforeRead = null;
  let readFailure = null;
  function seed(path, value) {
    const parts = path.split('/'); parts.pop();
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    files.set(path, typeof value === 'string' ? value : JSON.stringify(value));
  }
  function directory(path) {
    if (handles.has(path)) return handles.get(path);
    const handle = {
      kind: 'directory', name: path.split('/').at(-1) || 'Selected parent',
      async isSameEntry(other) { return other === handle; },
      async queryPermission() { return permission; },
      async requestPermission() { operations.push({ kind: 'permission' }); return permission; },
      async getDirectoryHandle(name, options = {}) {
        const child = [path, name].filter(Boolean).join('/');
        operations.push({ kind: 'directory', path: child, create: options.create === true });
        if (!dirs.has(child)) {
          if (!options.create) throw fsError('NotFoundError');
          dirs.add(child);
        }
        return directory(child);
      },
      async getFileHandle(name, options = {}) {
        const child = [path, name].filter(Boolean).join('/');
        operations.push({ kind: 'file', path: child, create: options.create === true });
        if (!files.has(child)) {
          if (!options.create) throw fsError('NotFoundError');
          files.set(child, '');
        }
        return {
          async getFile() {
            operations.push({ kind: 'read', path: child });
            if (beforeRead) await beforeRead(child);
            if (readFailure) throw readFailure;
            return { size: Buffer.byteLength(files.get(child)),
              async text() { return files.get(child); } };
          },
          async createWritable() {
            let value;
            return { async write(text) { value = String(text); },
              async close() { files.set(child, value); operations.push({ kind: 'write', path: child }); },
              async abort() {} };
          }
        };
      }
    };
    handles.set(path, handle); return handle;
  }
  if (rootName) dirs.add(rootName);
  return { handle: directory(''), rootName, dirs, files, operations, seed,
    setPermission(value) { permission = value; },
    onRead(fn) { beforeRead = fn; },
    failRead(error) { readFailure = error; } };
}
function setup({ fs = filesystem(), cryptoRef = webcrypto, now = () => clock } = {}) {
  const handleStore = createMemoryDirectoryHandleStore(fs.handle);
  const queueStore = createMemorySyncQueue();
  const sync = createDirectorySync({ handleStore, queueStore, cryptoRef, now });
  return { fs, handleStore, queueStore, sync };
}
function seedBound(fs, value = proof()) { fs.seed(`${fs.rootName}/${PROOF}`, value); }
function seedWorkspace(fs, value = workspace, { manifest = null, index = null } = {}) {
  const saved = manifest || createWorkspaceManifest(value);
  fs.seed(`${fs.rootName}/workspace-index.json`, index || createWorkspaceIndex([saved]));
  fs.seed(`${fs.rootName}/workspaces/${value.directoryName}/manifest.json`, saved);
  return saved;
}
function assertNoWrites(fs) {
  assert.deepEqual(fs.operations.filter(item => item.create || item.kind === 'write' ||
    item.kind === 'permission'), []);
}
async function rejectsCode(operation, code) { await assert.rejects(operation, { code }); }

test('native methods reject unconfigured or ungranted handles without prompting', async () => {
  const { fs, handleStore, sync } = setup();
  for (const permission of ['prompt', 'denied', 'unknown']) {
    fs.setPermission(permission);
    for (const run of [() => sync.readNativeDirectoryBinding(),
      () => sync.prepareNativeDirectoryBinding(), () => sync.getWorkspaceDirectoryOpenTarget(workspace)]) {
      await rejectsCode(run, 'WORKSPACE_DIRECTORY_PERMISSION_REQUIRED');
    }
  }
  await handleStore.save(null);
  for (const run of [() => sync.readNativeDirectoryBinding(),
    () => sync.prepareNativeDirectoryBinding(), () => sync.getWorkspaceDirectoryOpenTarget(workspace)]) {
    await rejectsCode(run, 'WORKSPACE_DIRECTORY_UNCONFIGURED');
  }
  assertNoWrites(fs);
});

test('missing actual data root is never created, even by prepare', async () => {
  const { fs, sync } = setup({ fs: filesystem(null) });
  for (const run of [() => sync.readNativeDirectoryBinding(),
    () => sync.prepareNativeDirectoryBinding(), () => sync.getWorkspaceDirectoryOpenTarget(workspace)]) {
    await rejectsCode(run, 'WORKSPACE_DIRECTORY_ROOT_MISSING');
  }
  assertNoWrites(fs); assert.deepEqual([...fs.dirs], ['']);
});

test('read requires a binding; prepare writes only the fixed proof with secure fresh values', async () => {
  const { fs, sync } = setup();
  await rejectsCode(() => sync.readNativeDirectoryBinding(), 'WORKSPACE_DIRECTORY_BINDING_MISSING');
  assertNoWrites(fs);
  const binding = await sync.prepareNativeDirectoryBinding();
  assert.match(binding.rootId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.match(binding.challenge, /^[a-f0-9]{64}$/);
  assert.equal(binding.expiresAt, clock + 300000); assert.equal(binding.rootName, 'Brevess');
  const saved = JSON.parse(fs.files.get(`Brevess/${PROOF}`));
  assert.deepEqual(saved, { schemaVersion: 1, kind: 'brevess-native-directory-binding',
    rootId: binding.rootId, challenge: binding.challenge, expiresAt: binding.expiresAt });
  assert.deepEqual(await sync.readNativeDirectoryBinding(), { rootId: binding.rootId, rootName: 'Brevess' });
  assert.deepEqual(fs.operations.filter(item => item.kind === 'write').map(item => item.path), [`Brevess/${PROOF}`]);
  assert.equal(fs.operations.some(item => item.kind === 'directory' && item.create), false);
});

test('legacy root works and valid expired proof renews while retaining its root ID', async () => {
  const { fs, sync } = setup({ fs: filesystem('SCI-Highlighter') });
  seedBound(fs);
  assert.deepEqual(await sync.readNativeDirectoryBinding(), { rootId: ROOT_ID, rootName: 'SCI-Highlighter' });
  assertNoWrites(fs);
  const first = await sync.prepareNativeDirectoryBinding();
  const second = await sync.prepareNativeDirectoryBinding();
  assert.equal(first.rootId, ROOT_ID); assert.equal(second.rootId, ROOT_ID);
  assert.notEqual(first.challenge, proof().challenge); assert.notEqual(second.challenge, first.challenge);
  assert.equal(second.expiresAt, clock + 300000);
});

test('invalid existing proof fails closed and is never overwritten', async () => {
  for (const value of ['broken{', proof({ schemaVersion: 2 }), proof({ kind: 'other' }),
    proof({ rootId: 'old-root' }), proof({ challenge: 'short' }), proof({ expiresAt: 0 }),
    proof({ unexpected: 'value' }), proof({ rootId: [ROOT_ID] }), proof({ challenge: ['c'.repeat(64)] })]) {
    const { fs, sync } = setup(); seedBound(fs, value);
    const before = fs.files.get(`Brevess/${PROOF}`);
    await rejectsCode(() => sync.readNativeDirectoryBinding(), 'WORKSPACE_DIRECTORY_BINDING_INVALID');
    await rejectsCode(() => sync.prepareNativeDirectoryBinding(), 'WORKSPACE_DIRECTORY_BINDING_INVALID');
    assert.equal(fs.files.get(`Brevess/${PROOF}`), before); assertNoWrites(fs);
  }
});

test('no crypto means no proof creation or weak random fallback', async () => {
  const { fs, sync } = setup({ cryptoRef: null });
  await rejectsCode(() => sync.prepareNativeDirectoryBinding(), 'WORKSPACE_DIRECTORY_CRYPTO_UNAVAILABLE');
  assertNoWrites(fs);
});

test('switching roots does not reuse a prior root ID, and a mid-read switch fails closed', async () => {
  const { fs, handleStore, sync } = setup(); seedBound(fs);
  assert.equal((await sync.readNativeDirectoryBinding()).rootId, ROOT_ID);
  const next = filesystem(); await handleStore.save(next.handle);
  await rejectsCode(() => sync.readNativeDirectoryBinding(), 'WORKSPACE_DIRECTORY_BINDING_MISSING');
  const created = await sync.prepareNativeDirectoryBinding(); assert.notEqual(created.rootId, ROOT_ID);
  await handleStore.save(fs.handle);
  fs.onRead(async () => { await handleStore.save(next.handle); });
  await rejectsCode(() => sync.prepareNativeDirectoryBinding(), 'WORKSPACE_DIRECTORY_ROOT_CHANGED');
  assert.equal(JSON.parse(fs.files.get(`Brevess/${PROOF}`)).challenge, proof().challenge);
});

test('open target is minimal, exact and read-only; no paper assets are read', async () => {
  const { fs, sync } = setup(); seedBound(fs); seedWorkspace(fs);
  fs.seed(`Brevess/workspaces/${workspace.directoryName}/private.json`, 'Do not read');
  const result = await sync.getWorkspaceDirectoryOpenTarget(workspace);
  assert.deepEqual(result, { rootId: ROOT_ID, rootName: 'Brevess',
    workspaceId: workspace.workspaceId, workspaceGeneration: 3,
    canonicalUrl: workspace.canonicalUrl, directoryName: workspace.directoryName });
  assertNoWrites(fs);
  assert.deepEqual([...new Set(fs.operations.filter(item => item.kind === 'read').map(item => item.path))].sort(),
    [`Brevess/${PROOF}`, 'Brevess/workspace-index.json',
      `Brevess/workspaces/${workspace.directoryName}/manifest.json`].sort());
});

test('missing workspace index, entry, directory or manifest is NOT_SYNCED and never created', async () => {
  for (const missing of ['index', 'entry', 'directory', 'manifest']) {
    const { fs, sync } = setup(); seedBound(fs); seedWorkspace(fs);
    if (missing === 'index') fs.files.delete('Brevess/workspace-index.json');
    if (missing === 'entry') fs.seed('Brevess/workspace-index.json', createWorkspaceIndex([]));
    if (missing === 'directory') fs.dirs.delete(`Brevess/workspaces/${workspace.directoryName}`);
    if (missing === 'manifest') fs.files.delete(`Brevess/workspaces/${workspace.directoryName}/manifest.json`);
    await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget(workspace), 'WORKSPACE_DIRECTORY_NOT_SYNCED');
    assertNoWrites(fs);
  }
});

test('old generation or changed identity in disk manifest is rejected', async () => {
  for (const changed of [{ workspaceGeneration: 2 }, { canonicalUrl: 'https://example.org/other' },
    { directoryName: `Other--${'a'.repeat(16)}` }, { contentHash: 'd'.repeat(64) },
    { workspaceId: `workspace:${'e'.repeat(64)}`, directoryName: `Other--${'e'.repeat(16)}` }]) {
    const { fs, sync } = setup(); seedBound(fs); seedWorkspace(fs);
    fs.seed(`Brevess/workspaces/${workspace.directoryName}/manifest.json`, createWorkspaceManifest({ ...workspace, ...changed }));
    await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget(workspace), 'WORKSPACE_DIRECTORY_IDENTITY_MISMATCH');
    assertNoWrites(fs);
  }
});

test('index identity mismatch and malformed index or manifest fail closed', async () => {
  const { fs, sync } = setup(); seedBound(fs);
  seedWorkspace(fs, workspace, { index: createWorkspaceIndex([createWorkspaceManifest({ ...workspace, workspaceGeneration: 2 })]) });
  await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget(workspace), 'WORKSPACE_DIRECTORY_IDENTITY_MISMATCH');
  fs.seed('Brevess/workspace-index.json', '{');
  await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget(workspace), 'WORKSPACE_DIRECTORY_MANIFEST_INVALID');
  seedWorkspace(fs);
  fs.seed(`Brevess/workspaces/${workspace.directoryName}/manifest.json`, '{');
  await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget(workspace), 'WORKSPACE_DIRECTORY_MANIFEST_INVALID');
  assertNoWrites(fs);
});

test('unsafe or normalized-away path spellings are refused before traversing a workspace', async () => {
  for (const name of [`../A--${'a'.repeat(16)}`, `nested/A--${'a'.repeat(16)}`,
    `nested\\A--${'a'.repeat(16)}`, `${workspace.directoryName} `,
    `C:A--${'a'.repeat(16)}`, `A：--${'a'.repeat(16)}`]) {
    const { fs, sync } = setup(); seedBound(fs); seedWorkspace(fs);
    await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget({ ...workspace, directoryName: name }),
      'WORKSPACE_DIRECTORY_PATH_INVALID');
    assert.equal(fs.operations.some(item => item.path.includes('/workspaces/')), false); assertNoWrites(fs);
  }
});

test('pending updates for this workspace reject while another workspace pending does not', async () => {
  const { fs, sync, queueStore } = setup(); seedBound(fs); const saved = seedWorkspace(fs);
  const other = createWorkspaceManifest({ ...workspace, workspaceId: `workspace:${'e'.repeat(64)}`,
    directoryName: `Other--${'e'.repeat(16)}`, canonicalUrl: 'https://example.org/other' });
  await queueStore.put({ relativePath: `workspaces/${other.directoryName}/chat/turn.json`, content: '{}' });
  await queueStore.put({ relativePath: 'workspace-index.json', content: JSON.stringify(createWorkspaceIndex([saved, other])) });
  assert.equal((await sync.getWorkspaceDirectoryOpenTarget(workspace)).workspaceId, workspace.workspaceId);
  await queueStore.put({ relativePath: `workspaces/${workspace.directoryName}/annotations.json`, content: '{}' });
  await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget(workspace), 'WORKSPACE_DIRECTORY_NOT_SYNCED');
  assertNoWrites(fs);
});

test('a pending global index only blocks when this workspace entry changes or disappears', async () => {
  for (const missing of [false, true]) {
    const { fs, sync, queueStore } = setup(); seedBound(fs); seedWorkspace(fs);
    const changed = createWorkspaceManifest({ ...workspace, storageRevision: 8 });
    await queueStore.put({ relativePath: 'workspace-index.json', content: JSON.stringify(createWorkspaceIndex(missing ? [] : [changed])) });
    await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget(workspace), 'WORKSPACE_DIRECTORY_NOT_SYNCED');
    assertNoWrites(fs);
  }
});

test('a target update arriving during disk reads is rejected by the final queue check', async () => {
  const { fs, sync, queueStore } = setup(); seedBound(fs); seedWorkspace(fs);
  fs.onRead(async path => {
    if (path.endsWith('/manifest.json')) await queueStore.put({ relativePath:
      `workspaces/${workspace.directoryName}/chat/turn.json`, content: '{}' });
  });
  await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget(workspace), 'WORKSPACE_DIRECTORY_NOT_SYNCED');
  assertNoWrites(fs);
});

test('I/O failures return a stable error without retrying or writing', async () => {
  const { fs, sync } = setup(); seedBound(fs); fs.failRead(fsError('NotReadableError'));
  await rejectsCode(() => sync.readNativeDirectoryBinding(), 'WORKSPACE_DIRECTORY_IO_ERROR');
  assert.equal(fs.operations.filter(item => item.kind === 'read').length, 1); assertNoWrites(fs);
});

test('concurrent explicit prepares serialize without minting two root IDs', async () => {
  const { fs, sync } = setup();
  const [first, second] = await Promise.all([
    sync.prepareNativeDirectoryBinding(), sync.prepareNativeDirectoryBinding()
  ]);
  assert.equal(first.rootId, second.rootId); assert.notEqual(first.challenge, second.challenge);
  const saved = JSON.parse(fs.files.get(`Brevess/${PROOF}`));
  assert.equal(saved.rootId, first.rootId); assert.equal(saved.challenge, second.challenge);
  assert.equal(fs.operations.filter(item => item.kind === 'write').length, 2);
});

test('root changes and permission revocation during target reads reject the returned target', async () => {
  for (const revoke of [false, true]) {
    const { fs, sync, handleStore } = setup(); seedBound(fs); seedWorkspace(fs);
    fs.onRead(async path => {
      if (!path.endsWith('/manifest.json')) return;
      if (revoke) fs.setPermission('denied');
      else await handleStore.save(filesystem().handle);
    });
    await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget(workspace), revoke
      ? 'WORKSPACE_DIRECTORY_PERMISSION_REQUIRED' : 'WORKSPACE_DIRECTORY_ROOT_CHANGED');
    assertNoWrites(fs);
  }
});

test('wrong manifest paths and raw identity aliases are refused without following them', async () => {
  const { fs, sync } = setup(); seedBound(fs); const saved = seedWorkspace(fs);
  const index = createWorkspaceIndex([saved]);
  index.workspaces[0].manifestPath = `other/${workspace.directoryName}/manifest.json`;
  fs.seed('Brevess/workspace-index.json', index);
  await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget(workspace), 'WORKSPACE_DIRECTORY_MANIFEST_INVALID');
  assert.equal(fs.operations.some(item => item.path.includes('/other/')), false);
  seedWorkspace(fs);
  fs.seed(`Brevess/workspaces/${workspace.directoryName}/manifest.json`, { ...saved,
    directoryName: `${workspace.directoryName} ` });
  await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget(workspace), 'WORKSPACE_DIRECTORY_IDENTITY_MISMATCH');
  assertNoWrites(fs);
});

test('real workspace schema generation zero opens and still requires exact generation and no target pending', async () => {
  const { fs, sync, queueStore } = setup(); seedBound(fs);
  const identity = await createArticleWorkspaceIdentity({ canonicalUrl: 'https://example.org/schema-zero',
    title: 'Schema zero', content: 'Original scientific text.' });
  const current = { ...identity, workspaceGeneration: 0 };
  const manifest = seedWorkspace(fs, current);
  assert.equal(manifest.workspaceGeneration, 0);
  const target = await sync.getWorkspaceDirectoryOpenTarget(current);
  assert.equal(target.workspaceGeneration, 0); assert.equal(target.workspaceId, current.workspaceId);
  await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget({ ...current, workspaceGeneration: 1 }),
    'WORKSPACE_DIRECTORY_IDENTITY_MISMATCH');
  await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget({ ...current, workspaceGeneration: -1 }),
    'WORKSPACE_DIRECTORY_IDENTITY_MISMATCH');
  await queueStore.put({ relativePath: `workspaces/${current.directoryName}/annotations.json`, content: '{}' });
  await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget(current), 'WORKSPACE_DIRECTORY_NOT_SYNCED');
  assertNoWrites(fs);
});

test('real DOI-only identity with empty canonical URL opens without treating empty as a wildcard', async () => {
  const identity = await createArticleWorkspaceIdentity({ doi: '10.1234/directory-only',
    title: 'DOI-only paper', content: 'Original DOI-only scientific text.' });
  assert.equal(identity.canonicalUrl, ''); assert.equal(identity.aliases[0].type, 'doi');
  for (const generation of [1, 0]) {
    const { fs, sync } = setup(); seedBound(fs);
    const current = { ...identity, workspaceGeneration: generation };
    seedWorkspace(fs, current);
    const target = await sync.getWorkspaceDirectoryOpenTarget(current);
    assert.equal(target.canonicalUrl, ''); assert.equal(target.workspaceGeneration, generation);
    await rejectsCode(() => sync.getWorkspaceDirectoryOpenTarget({ ...current, canonicalUrl: 'https://example.org/other' }),
      'WORKSPACE_DIRECTORY_IDENTITY_MISMATCH');
    assertNoWrites(fs);
  }
});
