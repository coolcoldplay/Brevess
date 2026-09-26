import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as delivery from '../scripts/finalize-local-delivery.mjs';

const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-isolated-delivery-'));
  t.after(() => { assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert.match(path.basename(root), /^brevess-isolated-delivery-/u); fs.rmSync(root, { recursive: true }); });
  const build = path.join(root, 'output/lib010-synthetic-build');
  const put = (file, value) => { const p = path.join(root, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value)); return p; };
  const source = put('native-host/host.js', '// exact synthetic source\n');
  const config = { main: 'native-host/host.js', output: 'native-host/bin/brevess-codex-host.blob', disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: true };
  put('native-host/sea-config.json', config);
  put('native-host/bin/brevess-codex-host.exe', 'MZ-older-binary');
  put('native-host/bin/brevess-codex-host.blob', 'older blob');
  put('output/lib010-synthetic-build/host.js', fs.readFileSync(source, 'utf8'));
  const exe = put('output/lib010-synthetic-build/brevess-codex-host.exe', 'MZ-new-isolated-binary');
  const blob = put('output/lib010-synthetic-build/brevess-codex-host.blob', 'new isolated blob');
  const sea = put('output/lib010-synthetic-build/sea-config.json', { ...config, main: path.join(build, 'host.js'), output: blob });
  const manifest = { builtAt: '2026-09-25T00:00:00.000Z', nodeVersion: 'v24.15.0', nodeSha256: '1'.repeat(64), postjectVersion: '1.0.0-alpha.6', sourceSha256: hash(source), configSha256: hash(sea), exeSha256: hash(exe), blobSha256: hash(blob), exeBytes: fs.statSync(exe).size, installed: false, registered: false, published: false };
  const manifestPath = put('output/lib010-synthetic-build/build-manifest.json', manifest);
  const proofPath = put('output/lib010-synthetic-build/native-protocol-report-system-root.json', { status: 'PASS', actualExecutableProtocol: true, exeSha256: hash(exe), installed: false, registered: false, networkRequests: 0, modelCalls: 0, checks: [{ name: 'actual protocol fixture', passed: true }], newProcess: { exit: { code: 0 }, stderr: '' } });
  const buildName = 'Brevess-test-isolated', releaseRoot = path.join(root, 'dist', buildName);
  const stage = path.join(releaseRoot, 'native-companion');
  put(`dist/${buildName}/native-companion/bin/brevess-codex-host.exe`, 'MZ-older-binary');
  put(`dist/${buildName}/native-companion/host.js`, fs.readFileSync(source, 'utf8'));
  return { root, build, put, manifest, manifestPath, proofPath, exe, blob, sea, source, releaseRoot, buildName, stage };
}
const options = f => ({ root: f.root, manifestPath: f.manifestPath });

test('verified isolated source resolves only fixed artifacts and retains source/config/protocol hashes', t => {
  const f = fixture(t), value = delivery.validateIsolatedNativeBuild(options(f));
  assert.equal(value.executablePath, f.exe);
  assert.equal(value.provenance.sourceSha256, hash(f.source));
  assert.equal(value.provenance.manifestSha256, hash(f.manifestPath));
  assert.equal(value.provenance.protocolReportSha256, hash(f.proofPath));
  assert.equal(value.provenance.sourceSeaConfigSha256, hash(path.join(f.root, 'native-host/sea-config.json')));
});

for (const [name, change] of [
  ['host source changed', f => fs.appendFileSync(f.source, '// changed')],
  ['copied source changed', f => fs.appendFileSync(path.join(f.build, 'host.js'), '// changed')],
  ['current SEA option changed', f => { const p = path.join(f.root, 'native-host/sea-config.json'); const v = JSON.parse(fs.readFileSync(p)); v.useCodeCache = false; fs.writeFileSync(p, JSON.stringify(v)); }],
  ['current SEA entry point changed', f => { const p = path.join(f.root, 'native-host/sea-config.json'); const v = JSON.parse(fs.readFileSync(p)); v.main = 'native-host/other.js'; fs.writeFileSync(p, JSON.stringify(v)); }],
  ['exe changed', f => fs.appendFileSync(f.exe, 'changed')],
  ['blob missing', f => fs.unlinkSync(f.blob)],
  ['manifest malformed', f => fs.writeFileSync(f.manifestPath, '{')],
  ['manifest source digest wrong', f => { f.manifest.sourceSha256 = 'f'.repeat(64); fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest)); }],
  ['configuration output escape', f => { const v = JSON.parse(fs.readFileSync(f.sea)); v.output = path.join(f.root, 'native-host/bin/brevess-codex-host.blob'); fs.writeFileSync(f.sea, JSON.stringify(v)); f.manifest.configSha256 = hash(f.sea); fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest)); }],
  ['protocol report failed', f => { const v = JSON.parse(fs.readFileSync(f.proofPath)); v.status = 'FAIL'; fs.writeFileSync(f.proofPath, JSON.stringify(v)); }],
  ['protocol report for another exe', f => { const v = JSON.parse(fs.readFileSync(f.proofPath)); v.exeSha256 = '2'.repeat(64); fs.writeFileSync(f.proofPath, JSON.stringify(v)); }]
]) test(`isolated build rejects ${name} before writing the stage`, t => {
  const f = fixture(t); change(f);
  const before = fs.readFileSync(path.join(f.stage, 'bin/brevess-codex-host.exe'));
  assert.throws(() => delivery.stageIsolatedNativeBuild({ ...options(f), releaseRoot: f.releaseRoot, buildName: f.buildName }));
  assert.deepEqual(fs.readFileSync(path.join(f.stage, 'bin/brevess-codex-host.exe')), before);
});

test('actual stage adopts verified binary and source validation rejects later stage tampering', t => {
  const f = fixture(t), old = fs.readFileSync(path.join(f.root, 'native-host/bin/brevess-codex-host.exe'));
  const selected = delivery.stageIsolatedNativeBuild({ ...options(f), releaseRoot: f.releaseRoot, buildName: f.buildName });
  assert.equal(hash(path.join(f.stage, 'bin/brevess-codex-host.exe')), hash(f.exe));
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'native-host/bin/brevess-codex-host.exe')), old);
  const specs = { companion: [{ source: 'native-host/bin/brevess-codex-host.exe', path: 'bin/brevess-codex-host.exe' }, { source: 'native-host/host.js', path: 'host.js' }] };
  const records = delivery.validateDeliveryStage({ root: f.root, releaseRoot: f.releaseRoot, specs, isolatedNativeBuild: selected });
  const record = records.companion.find(e => e.file === 'bin/brevess-codex-host.exe');
  assert.equal(record.source, 'native-host/bin/brevess-codex-host.exe');
  assert.equal(record.sourcePath, 'output/lib010-synthetic-build/brevess-codex-host.exe');
  assert.equal(record.sourceSha256, hash(f.exe)); assert.equal(record.sourceMatched, true);
  assert.equal(record.repositorySourceSha256, hash(path.join(f.root, 'native-host/bin/brevess-codex-host.exe')));
  assert.notEqual(record.sourceSha256, record.repositorySourceSha256, 'component baseline sees the actual replacement bytes');
  fs.appendFileSync(path.join(f.stage, 'bin/brevess-codex-host.exe'), 'tamper');
  assert.throws(() => delivery.validateDeliveryStage({ root: f.root, releaseRoot: f.releaseRoot, specs, isolatedNativeBuild: selected }), /STAGE_SOURCE_MISMATCH/);
  fs.copyFileSync(f.exe, path.join(f.stage, 'bin/brevess-codex-host.exe'));
  fs.appendFileSync(path.join(f.stage, 'host.js'), '// ordinary source tamper');
  assert.throws(() => delivery.validateDeliveryStage({ root: f.root, releaseRoot: f.releaseRoot, specs, isolatedNativeBuild: selected }), /STAGE_SOURCE_MISMATCH:host.js/);
});

test('isolated target cannot point to old source/bin or an already finalized candidate', t => {
  const f = fixture(t);
  assert.throws(() => delivery.stageIsolatedNativeBuild({ ...options(f), releaseRoot: f.root, buildName: f.buildName }), /INVALID_DELIVERY_ROOT/);
  f.put(`dist/${f.buildName}/release-manifest.json`, '{}');
  assert.throws(() => delivery.stageIsolatedNativeBuild({ ...options(f), releaseRoot: f.releaseRoot, buildName: f.buildName }), /ISOLATED_NATIVE_STAGE_NOT_FRESH/);
});

test('manifest outside output and a redirected isolated build are rejected', t => {
  const f = fixture(t);
  const outside = f.put('native-host/build-manifest.json', f.manifest);
  assert.throws(() => delivery.validateIsolatedNativeBuild({ root: f.root, manifestPath: outside }), /ISOLATED_NATIVE_PATH/);
  const link = path.join(f.root, 'output/linked-build');
  fs.symlinkSync(f.build, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => delivery.validateIsolatedNativeBuild({ root: f.root, manifestPath: path.join(link, 'build-manifest.json') }), /ISOLATED_NATIVE_LINK/);
});

test('a staging junction cannot redirect the selected binary into repository bin', t => {
  const f = fixture(t), bin = path.join(f.stage, 'bin'), renamed = path.join(f.stage, 'original-bin');
  assert.ok(bin.startsWith(f.root + path.sep) && renamed.startsWith(f.root + path.sep));
  fs.renameSync(bin, renamed);
  fs.symlinkSync(path.join(f.root, 'native-host/bin'), bin, process.platform === 'win32' ? 'junction' : 'dir');
  const original = hash(path.join(f.root, 'native-host/bin/brevess-codex-host.exe'));
  assert.throws(() => delivery.stageIsolatedNativeBuild({ ...options(f), releaseRoot: f.releaseRoot, buildName: f.buildName }), /ISOLATED_NATIVE_LINK/);
  assert.equal(hash(path.join(f.root, 'native-host/bin/brevess-codex-host.exe')), original);
});

test('a staged hardlink cannot mutate the old repository binary', t => {
  const f = fixture(t), target = path.join(f.stage, 'bin/brevess-codex-host.exe');
  const original = path.join(f.root, 'native-host/bin/brevess-codex-host.exe'), before = hash(original);
  assert.ok(target.startsWith(f.root + path.sep)); fs.unlinkSync(target); fs.linkSync(original, target);
  assert.throws(() => delivery.stageIsolatedNativeBuild({ ...options(f), releaseRoot: f.releaseRoot, buildName: f.buildName }), /ISOLATED_NATIVE_STAGE_LINK/);
  assert.equal(hash(original), before);
});

test('default source checks still require the repository binary and all ordinary files', t => {
  const f = fixture(t), specs = { companion: [{ source: 'native-host/bin/brevess-codex-host.exe', path: 'bin/brevess-codex-host.exe' }, { source: 'native-host/host.js', path: 'host.js' }] };
  assert.ok(delivery.validateDeliveryStage({ root: f.root, releaseRoot: f.releaseRoot, specs }).companion.every(e => e.sourceMatched));
  fs.copyFileSync(f.exe, path.join(f.stage, 'bin/brevess-codex-host.exe'));
  assert.throws(() => delivery.validateDeliveryStage({ root: f.root, releaseRoot: f.releaseRoot, specs }), /STAGE_SOURCE_MISMATCH/);
});

test('unsupported finalizer modes or missing isolated manifest/reason fail before touching staging', t => {
  const f = fixture(t);
  for (const extra of [ { nativeBuildMode: 'anything' }, { nativeBuildMode: 'verified-isolated' },
    { nativeBuildMode: 'verified-prebuilt', isolatedNativeBuildManifest: f.manifestPath },
    { nativeBuildMode: 'verified-isolated', isolatedNativeBuildManifest: f.manifestPath } ]) {
    assert.throws(() => delivery.finalizeLocalDelivery({ root: f.root, releaseRoot: f.releaseRoot, buildName: f.buildName, ...extra }), /INVALID_NATIVE_BUILD_OPTIONS/);
  }
});

test('PowerShell rejects the incompatible flags before creating any staging or building native host', t => {
  const f = fixture(t), project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  f.put('scripts/build-local-delivery.ps1', fs.readFileSync(path.join(project, 'scripts/build-local-delivery.ps1'), 'utf8'));
  const result = spawnSync('pwsh.exe', ['-NoProfile', '-File', path.join(f.root, 'scripts/build-local-delivery.ps1'),
    '-BuildName', 'Brevess-refused', '-SkipNativeHostBuild', '-IsolatedNativeBuildManifest', f.manifestPath,
    '-ComponentChangeReason', 'explicit test'], { cwd: f.root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot combine with SkipNativeHostBuild/);
  assert.equal(fs.existsSync(path.join(f.root, 'dist/Brevess-refused')), false);
});
