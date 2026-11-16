const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { repositoryRoot, extensionRoot, projectFile, sourceRelative } = require('../scripts/project-paths.cjs');

test('direct source installs retain every packaged browser resource and license', async () => {
  const { chromeFiles, auditPackage, storeManifest } = await import('../scripts/chrome-store-package.mjs');
  const files = new Map(chromeFiles(repositoryRoot).map(entry => {
    const source = path.join(repositoryRoot, entry.source);
    assert.equal(source, path.join(extensionRoot, entry.path), entry.path);
    return [entry.path, fs.readFileSync(source)];
  }));
  files.set('manifest.json', Buffer.from(JSON.stringify(storeManifest(JSON.parse(files.get('manifest.json'))))));
  assert.deepEqual(auditPackage(files).errors, []);
  assert.deepEqual(fs.readFileSync(path.join(repositoryRoot, 'LICENSE')), fs.readFileSync(projectFile('LICENSE')));
  assert.equal(fs.existsSync(path.join(repositoryRoot, 'manifest.json')), false);
  assert.equal(projectFile('INSTALL.md'), path.join(repositoryRoot, 'docs', 'INSTALL.md'));
  for (const name of ['../private', '/absolute', 'core/../private', 'C:/private']) {
    assert.throws(() => sourceRelative(name), /INVALID_RELEASE_PATH/);
  }
});

test('the downloadable source archive rebuilds the same installable Chrome ZIP', async t => {
  const { readZip } = await import('../scripts/chrome-store-package.mjs');
  const name = `layout-test-${randomUUID()}`;
  const destination = path.join(repositoryRoot, 'dist', name);
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-source-rebuild-'));
  t.after(() => {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(extracted, { recursive: true, force: true });
  });
  const run = (cwd, script, ...args) => execFileSync(process.execPath, [script, ...args], { cwd, stdio: 'pipe' });
  run(repositoryRoot, 'scripts/build-chrome-store-release.mjs', '--name', name);
  run(repositoryRoot, 'scripts/verify-chrome-store-release.mjs', destination);
  const metadata = JSON.parse(fs.readFileSync(path.join(destination, 'release-manifest.json')));
  const source = readZip(fs.readFileSync(path.join(destination, metadata.sourceArtifact.file)));
  assert.ok(source.has('extension/manifest.json'));
  assert.ok(source.has('scripts/project-paths.cjs'));
  assert.equal(source.has('manifest.json'), false);
  for (const [name, bytes] of source) {
    const file = path.join(extracted, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  run(extracted, 'scripts/build-chrome-store-release.mjs', '--name', 'rebuilt');
  run(extracted, 'scripts/verify-chrome-store-release.mjs', 'dist/rebuilt');
  assert.deepEqual(fs.readFileSync(path.join(extracted, 'dist/rebuilt', metadata.artifact.file)),
    fs.readFileSync(path.join(destination, metadata.artifact.file)));
});
