const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

test('public preview preserves the existing extension identity and ships only audited browser files', async () => {
  const { readZip, sha256 } = await import('../scripts/chrome-store-package.mjs');
  const root = path.join(__dirname, '..'), name = 'public-build-test-' + randomUUID();
  const destination = path.join(root, 'dist', name);
  try {
    execFileSync(process.execPath, ['scripts/build-public-test-release.mjs', '--name', name], { cwd: root });
    const metadata = JSON.parse(fs.readFileSync(path.join(destination, 'release-manifest.json')));
    const bytes = fs.readFileSync(path.join(destination, metadata.artifact.file));
    const files = readZip(bytes), shipped = JSON.parse(files.get('manifest.json'));
    const source = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
    assert.equal(shipped.key, source.key, 'manual updates must retain the public extension identity');
    assert.equal(shipped.version, source.version);
    assert.equal(shipped.update_url, undefined);
    assert.equal(metadata.extensionId, 'finhfnjbpidfakpmkghkfjlfcfpoandh');
    assert.equal(metadata.artifact.sha256, sha256(bytes));
    assert.equal(files.size, metadata.files.length);
    assert.equal(files.has('mcp/server.js'), false);
    assert.equal(files.has('mcp/extension/workbench-mcp-bridge.js'), true);
    assert.equal([...files.keys()].some(f => /^(?:tests|outputs|tmp|native-host|scripts)\//.test(f)), false);
    for (const f of metadata.files) assert.equal(sha256(files.get(f.path)), f.sha256);
    assert.throws(() => execFileSync(process.execPath, ['scripts/build-public-test-release.mjs', '--name', name], { cwd: root, stdio: 'pipe' }), /EEXIST/);
    assert.equal(sha256(fs.readFileSync(path.join(destination, metadata.artifact.file))), metadata.artifact.sha256);
  } finally { fs.rmSync(destination, { recursive: true, force: true }); }
});
