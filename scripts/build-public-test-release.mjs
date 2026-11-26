import { projectFile } from './project-paths.cjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromeFiles, auditPackage, createZip, readZip, sha256 } from './chrome-store-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--name' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args[1])) {
  throw new Error('Usage: node scripts/build-public-test-release.mjs --name RELEASE_NAME');
}
const release = projectFile('dist', args[1]);
const manifest = JSON.parse(fs.readFileSync(projectFile('manifest.json')));
if (!manifest.key) throw new Error('Public unpacked builds require the existing public extension key');
delete manifest.update_url;
manifest.minimum_chrome_version = '116';
const files = new Map(chromeFiles(root).map(f => [f.path, fs.readFileSync(projectFile(f.source))]));
files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
// Reuse the strict browser/dependency/credential audit. Only the public identity
// key differs from the store manifest; it is not a private signing key.
const auditFiles = new Map(files);
const auditManifest = { ...manifest };
delete auditManifest.key;
auditFiles.set('manifest.json', Buffer.from(JSON.stringify(auditManifest)));
const audit = auditPackage(auditFiles);
if (audit.errors.length) throw new Error(audit.errors.join('\n'));
const zip = createZip([...files].map(([name, bytes]) => ({ name, bytes })));
const decoded = readZip(zip);
if (decoded.size !== files.size || [...files].some(([name, bytes]) => !decoded.get(name)?.equals(bytes))) {
  throw new Error('Archive round-trip failed');
}
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const revision = { sourceCommit: git(['rev-parse', 'HEAD']), sourceDirty: Boolean(git(['status', '--porcelain'])) };
const label = manifest.version_name?.match(/\br\d+(?:\.\d+)*\b/)?.[0];
const flavor = manifest.version_name?.match(/(Adaptive Figures|Workbench Evidence) (r\d+)$/);
const revisionLabel = flavor && (flavor[1] === 'Adaptive Figures' ? 'adaptive-' : 'workbench-') + flavor[2];
const name = ['Brevess-v' + manifest.version, label, revisionLabel, 'Chrome.zip'].filter(Boolean).join('-');
const keyHash = Buffer.from(sha256(Buffer.from(manifest.key, 'base64')), 'hex').subarray(0, 16);
const extensionId = [...keyHash].map(b => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join('');
fs.mkdirSync(path.dirname(release), { recursive: true });
fs.mkdirSync(release); // Never overwrite an already reviewed release.
for (const [name, bytes] of files) {
  const target = path.join(release, 'extension', name);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
}
fs.writeFileSync(path.join(release, name), zip);
const metadata = { kind: 'public-unpacked-preview', version: manifest.version,
  versionName: manifest.version_name, extensionId, ...revision,
  sourceRepository: 'https://github.com/coolcoldplay/Brevess',
  artifact: { file: name, bytes: zip.length, sha256: sha256(zip) },
  files: [...files].map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes) })) };
fs.writeFileSync(path.join(release, 'release-manifest.json'), JSON.stringify(metadata, null, 2) + '\n');
fs.writeFileSync(path.join(release, 'package-audit.json'), JSON.stringify({ ...audit, manifest, bytes: [...files.values()].reduce((sum, file) => sum + file.length, 0), extensionId,
  identityNote: 'The public manifest key is retained for unpacked-install continuity.' }, null, 2) + '\n');
fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), `${sha256(zip)}  ${name}\n`);
console.log(JSON.stringify({ ...revision, extensionId, file: name, files: files.size, bytes: zip.length, staticAudit: audit.status }));
