import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

const repository = path.resolve(import.meta.dirname, '..');
const scripts = ['verify-ui014-contextual-note-toolbar.mjs', 'verify-ui013-status-strip.mjs',
  'verify-archive-history-card-browser.mjs'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const runtimeFiles = ['background.js', 'content.js', 'popup.js', 'popup.html', 'popup.css', 'ui-swiss.css',
  'core/article-extractor.js', 'core/article-workspace.js', 'core/article-workspace-store.js',
  'core/article-workspace-save.js', 'core/article-archive.js', 'core/background-router.js',
  'core/document-store.js', 'core/manual-annotations.js', 'core/directory-sync.js',
  'core/tab-messenger.js', 'core/tab-activation.js', 'core/user-data-database.js',
  'providers/nested/provider.js', 'vendor/nested/data.wasm', 'icons/icon.png', '_locales/en/messages.json'];

function populate(root, marker) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ manifest_version: 3,
    name: marker, version: '1.0.0', background: { service_worker: 'background.js' } }));
  for (const file of runtimeFiles) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), Buffer.from(`${marker}:${file}\n\u0000`));
  }
}

function fileHashes(root) {
  const hashes = {};
  const visit = dir => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) visit(file);
      else hashes[path.relative(root, file).replaceAll('\\', '/')] = sha(fs.readFileSync(file));
    }
  };
  visit(root); return hashes;
}

async function entry(name, { envRoot = 'package', argv = [], mutate } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-verifier-entry-test-'));
  const repo = path.join(temporary, 'runner-repository');
  const packaged = path.join(temporary, 'extracted-package');
  const source = fs.readFileSync(path.join(repository, 'scripts', name), 'utf8');
  populate(repo, 'DEFAULT_REPOSITORY'); populate(packaged, 'SELECTED_ZIP');
  const expected = fileHashes(packaged);
  fs.mkdirSync(path.join(repo, 'scripts'));
  fs.writeFileSync(path.join(repo, 'scripts', name), source);
  const env = {};
  if (envRoot !== 'default') env.SCI_EXTENSION_ROOT = envRoot === 'package' ? packaged : envRoot === 'missing' ? path.join(temporary, 'absent') : envRoot;
  mutate?.({ packaged, repo });
  let copied, launchCount = 0, thrown;
  const runner = source.replace(/^import .*;\r?\n/gmu, '')
    .replaceAll('import.meta.dirname', JSON.stringify(path.join(repo, 'scripts')))
    .replaceAll('import.meta.filename', JSON.stringify(path.join(repo, 'scripts', name)));
  const context = vm.createContext({ assert, fs, os, path, crypto, createHash: crypto.createHash,
    process: { env, argv: ['node', path.join(repo, 'scripts', name), ...argv], exitCode: 0 },
    console: { log() {}, error() {} }, Buffer, setTimeout, clearTimeout,
    chromium: { async launchPersistentContext(_profile, options) {
      launchCount++;
      const extension = options.args.find(arg => arg.startsWith('--load-extension=')).slice('--load-extension='.length);
      copied = fileHashes(extension);
      // Deliberately stop at the browser boundary; this test does not claim UI acceptance.
      throw Error('ENTRY_TEST_BROWSER_BOUNDARY');
    } } });
  try {
    try { await vm.runInContext(`(async () => {\n${runner}\n})()`, context); }
    catch (error) { thrown = error; }
    const reports = [];
    const outputs = path.join(repo, 'output');
    const find = dir => {
      if (!fs.existsSync(dir)) return;
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isDirectory() && item.name !== 'extension' && item.name !== 'profile') find(file);
        else if (item.name === 'report.json') reports.push(JSON.parse(fs.readFileSync(file, 'utf8')));
      }
    };
    find(outputs);
    return { copied, expected, reports, launchCount, thrown, repo, packaged,
      packageOutputCreated: fs.existsSync(path.join(packaged, 'output')) };
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.match(path.basename(temporary), /^brevess-verifier-entry-test-/u);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

for (const script of scripts) {
  test(`${script}: copies selected ZIP bytes and reports complete pre-browser fingerprints`, async () => {
    const result = await entry(script);
    assert.equal(result.thrown, undefined);
    assert.equal(result.launchCount, 1);
    assert.equal(result.packageOutputCreated, false, 'selected source root must remain read-only');
    for (const [file, hash] of Object.entries(result.expected)) assert.equal(result.copied[file], hash, file);
    assert.equal(result.reports.length, 1, 'report remains in runner repository output');
    assert.equal(result.reports[0].extensionRoot, result.packaged);
    assert.equal(result.reports[0].repositoryRoot, result.repo);
    assert.deepEqual(result.reports[0].copiedSourceHashes, result.expected);
  });
  test(`${script}: default repository behavior remains available`, async () => {
    const result = await entry(script, { envRoot: 'default' });
    assert.equal(result.thrown, undefined);
    assert.equal(result.launchCount, 1);
    assert.equal(result.reports[0].extensionRoot, result.repo);
    assert.equal(result.copied['popup.js'], sha(Buffer.from('DEFAULT_REPOSITORY:popup.js\n\u0000')));
  });
  test(`${script}: missing or empty explicit root refuses before browser or evidence output`, async () => {
    for (const envRoot of ['missing', '']) {
      const result = await entry(script, { envRoot });
      assert.match(result.thrown?.message || '', /VERIFIER_EXTENSION_ROOT_INVALID/u);
      assert.equal(result.launchCount, 0); assert.equal(result.reports.length, 0);
    }
  });
  test(`${script}: malformed manifest or missing runtime directory cannot fall back to repository`, async () => {
    for (const mutate of [
      ({ packaged }) => fs.writeFileSync(path.join(packaged, 'manifest.json'), '{invalid'),
      ({ packaged }) => fs.renameSync(path.join(packaged, 'core'), path.join(packaged, 'missing-core')),
      ({ packaged }) => fs.renameSync(path.join(packaged, 'popup.html'), path.join(packaged, 'missing-popup.html'))
    ]) {
      const result = await entry(script, { mutate });
      assert.match(result.thrown?.message || '', /VERIFIER_EXTENSION_ROOT_INVALID/u);
      assert.equal(result.launchCount, 0); assert.equal(result.reports.length, 0);
    }
  });
  test(`${script}: unknown CLI flags including unsupported --extension-root cannot be ignored`, async () => {
    for (const argv of [['--unknown'], ['--extension-root', 'another-root']]) {
      const result = await entry(script, { argv });
      assert.match(result.thrown?.message || '', /VERIFIER_ARGUMENT_INVALID/u);
      assert.equal(result.launchCount, 0); assert.equal(result.reports.length, 0);
    }
  });
}

test('archive history entry preserves both existing CLI modes', async () => {
  const result = await entry('verify-archive-history-card-browser.mjs', {
    argv: ['--old-auto-decision', '--diagnose-commit'] });
  assert.equal(result.thrown, undefined); assert.equal(result.launchCount, 1);
  assert.equal(result.reports[0].scenario, 'prior-empty-workspace-auto-restored-decision');
});
