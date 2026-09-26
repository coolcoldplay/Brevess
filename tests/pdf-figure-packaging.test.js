const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('PDF Figure engine and runtime are pinned by version and SHA-256', () => {
  const engine = JSON.parse(read('native-host/pdffigures2/VERSION.json'));
  const runtime = JSON.parse(read('native-host/runtime-version.json'));
  assert.equal(engine.version, '0.1.0');
  assert.equal(engine.commit, '3d7ad46753d4a315cccd1c2bcab398380e88c534');
  assert.match(engine.jarSha256, /^[a-f0-9]{64}$/);
  assert.equal(engine.imageIo.version, '1.4.0');
  assert.match(engine.imageIo.coreSha256, /^[a-f0-9]{64}$/);
  assert.match(engine.imageIo.jpeg2000Sha256, /^[a-f0-9]{64}$/);
  assert.equal(runtime.version, '8u492-b09');
  assert.match(runtime.archiveSha256, /^[a-f0-9]{64}$/);
});

test('Edge release keeps PDF reader in the store ZIP and native binaries only in companion ZIP', async () => {
  const release = read('scripts/build-edge-store-release.ps1');
  const { releaseInventory } = await import('../scripts/release-inventory.mjs');
  const store = releaseInventory(root, 'store').map(file => file.path);
  const companion = releaseInventory(root, 'companion').map(file => file.path);
  for (const filename of [
    'pdf-reader.html',
    'pdf-reader.js',
    'pdf-reader-ui.js',
    'pdf-reader-notices.js',
    'pdf-reader.css',
    'pdf-native-reader.mjs'
  ]) {
    assert.ok(store.includes(filename), filename);
  }
  assert.match(release, /Copy-BrevessReleaseFiles[^\r\n]*-Target \$extensionStage -Profile store/);
  assert.match(release, /Copy-BrevessReleaseFiles[^\r\n]*-Target \$bridgeStage -Profile companion/);
  assert.equal(store.some(file => file.startsWith('native-host/') || /\.(exe|jar)$/i.test(file)), false);
  for (const file of ['bin/brevess-codex-host.exe', 'runtime/bin/java.exe',
    'pdffigures2/pdffigures2.jar', 'pdffigures2/brevess-pdf-fallback.jar']) {
    assert.ok(companion.includes(file), file);
  }
});

test('local companion installer copies PDF engine and bundled Java beside native host', () => {
  const installer = read('native-host/install.ps1');
  assert.match(installer, /@\{ Name = 'pdffigures2'; Required = \$true \}/);
  assert.match(installer, /@\{ Name = 'runtime'; Required = \$true \}/);
  assert.match(installer, /pdffigures2\\pdffigures2\.jar/);
  assert.match(installer, /pdffigures2\\brevess-pdf-fallback\.jar/);
  assert.match(installer, /runtime\\bin\\java\.exe/);
});

test('cross-page PDF recovery helper is compiled and bundled beside PDFFigures2', () => {
  const buildHost = read('scripts/build-codex-native-host.ps1');
  const buildFallback = read('scripts/build-pdf-figure-fallback.ps1');
  assert.match(buildHost, /build-pdf-figure-fallback\.ps1/);
  assert.match(buildFallback, /BrevessPdfFallback\.java/);
  assert.equal(fs.existsSync(path.join(
    root, 'native-host/pdffigures2/brevess-pdf-fallback.jar'
  )), true);
});

test('JPEG2000 decoder jars are pinned and loaded beside PDFFigures2', () => {
  const buildEngine = read('scripts/build-pdffigures2.ps1');
  const host = read('native-host/host.js');
  for (const name of [
    'jai-imageio-core-1.4.0.jar',
    'jai-imageio-jpeg2000-1.4.0.jar'
  ]) {
    assert.equal(fs.existsSync(path.join(root, 'native-host/pdffigures2', name)), true);
    assert.match(buildEngine, new RegExp(name.replaceAll('.', '\\.')));
    assert.match(host, new RegExp(name.replaceAll('.', '\\.')));
  }
  assert.match(host, /jpeg2000Available/);
});

test('third-party notices preserve PDFFigures2 and Temurin licenses', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /PDFFigures2[\s\S]*Apache License 2\.0/);
  assert.match(notices, /JAI Image I\/O[\s\S]*jai-imageio-jpeg2000/);
  assert.match(notices, /Eclipse Temurin JRE[\s\S]*GPL-2\.0 with the Classpath Exception/);
  assert.equal(fs.existsSync(path.join(root, 'native-host/pdffigures2/LICENSE.txt')), true);
});
