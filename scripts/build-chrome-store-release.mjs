import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromeFiles, storeManifest, createZip, readZip, auditPackage, sha256 } from './chrome-store-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let revision;
try { revision = { sourceCommit: git(['rev-parse', 'HEAD']), sourceDirty: Boolean(git(['status', '--porcelain'])) }; }
catch { revision = fs.existsSync(path.join(root, 'source-revision.json'))
  ? JSON.parse(fs.readFileSync(path.join(root, 'source-revision.json'))) : { sourceCommit: null, sourceDirty: null }; }
const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
if (sourceManifest.version !== pkg.version) throw new Error('manifest.json and package.json versions differ');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--name')) throw new Error('Usage: node scripts/build-chrome-store-release.mjs [--name RELEASE_NAME]');
const name = args[1] || `Brevess-Chrome-v${sourceManifest.version}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error('Invalid release name');
const release = path.join(root, 'dist', name);
const files = new Map(chromeFiles(root).map(f => [f.path, fs.readFileSync(path.join(root, f.source))]));
files.set('manifest.json', Buffer.from(JSON.stringify(storeManifest(sourceManifest), null, 2) + '\n'));
const audit = auditPackage(files);
if (audit.errors.length) throw new Error(audit.errors.join('\n'));
const zip = createZip([...files].map(([name, bytes]) => ({ name, bytes })));
const decoded = readZip(zip);
if (decoded.size !== files.size || [...files].some(([name, bytes]) => !decoded.get(name)?.equals(bytes))) throw new Error('ZIP round trip failed');
fs.mkdirSync(path.dirname(release), { recursive: true });
fs.mkdirSync(release); // Refuse to overwrite a reviewed release.
for (const [name, bytes] of files) {
  const target = path.join(release, 'extension', name);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
}
const zipName = `Brevess-v${sourceManifest.version}-Chrome-Web-Store.zip`;
fs.writeFileSync(path.join(release, zipName), zip);
// A source snapshot contains only the shipped browser source and explicitly named
// development/documentation trees. No user outputs, profiles or local config.
const sourceFiles = new Map(files);
sourceFiles.set('manifest.json', Buffer.from(JSON.stringify(sourceManifest, null, 2) + '\n'));
const sourceExtras = ['package.json', 'package-lock.json', '.gitignore', 'README.md', 'INSTALL.md',
  'CONTRIBUTING.md', 'SECURITY.md', 'docs/index.html', 'docs/privacy-policy.md',
  'docs/privacy-policy.html', 'docs/reviewer-demo.html'];
const excludedSource = /(^|\/)(?:node_modules|runtime|bin|__pycache__|\.git|tmp|outputs?|dist)(\/|$)|\.(?:exe|jar|zip|crx|pem|key|pyc|log)$|(^|\/)\.env(?:\.|$)|^scripts\/(?:local-|private-)/i;
function collectSource(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const name = `${dir}/${entry.name}`;
    if (excludedSource.test(name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Source snapshot refuses symlink: ${name}`);
    if (entry.isDirectory()) collectSource(name); else sourceExtras.push(name);
  }
}
for (const dir of ['scripts', 'tests', 'native-host', 'mcp', 'licenses', 'docs/chrome-store'])
  if (fs.existsSync(path.join(root, dir))) collectSource(dir);
for (const name of sourceExtras) {
  const full = path.join(root, name);
  if (fs.lstatSync(full).isSymbolicLink()) throw new Error(`Source snapshot refuses symlink: ${name}`);
  sourceFiles.set(name, fs.readFileSync(full));
}
sourceFiles.set('source-revision.json', Buffer.from(JSON.stringify(revision, null, 2) + '\n'));
sourceFiles.set('SOURCE-README.md', Buffer.from('# Chrome source snapshot\n\nThis snapshot corresponds to the browser archive in the same release directory.\nRun `node scripts/build-chrome-store-release.mjs` with Node.js 20+.\nThe optional native binaries are not included; they are not part of the Chrome ZIP.\nExisting test/fixture limitations are recorded in docs/chrome-store/RELEASE_READINESS.md.\nSee the matching source tag and release on the public repository.\n'));
const sourceZip = createZip([...sourceFiles].sort(([a],[b])=>a.localeCompare(b)).map(([name,bytes])=>({name,bytes})));
const sourceZipName = `Brevess-v${sourceManifest.version}-Chrome-source.zip`;
fs.writeFileSync(path.join(release, sourceZipName), sourceZip);
for (const name of ['index.html', 'privacy-policy.html', 'privacy-policy.md', 'reviewer-demo.html']) {
  fs.mkdirSync(path.join(release, 'public-site'), { recursive: true });
  fs.copyFileSync(path.join(root, 'docs', name), path.join(release, 'public-site', name));
}
if (fs.existsSync(path.join(root, 'docs/chrome-store'))) fs.cpSync(path.join(root, 'docs/chrome-store'), path.join(release, 'submission'), { recursive: true });
if (fs.existsSync(path.join(root, 'docs/assets'))) fs.cpSync(path.join(root, 'docs/assets'), path.join(release, 'public-site/assets'), { recursive: true });
const metadata = { product: 'Brevess', store: 'Chrome Web Store', version: sourceManifest.version,
  builtAt: new Date().toISOString(), ...revision,
  artifact: { file: zipName, bytes: zip.length, sha256: sha256(zip) },
  sourceArtifact: { file: sourceZipName, bytes: sourceZip.length, sha256: sha256(sourceZip), files: sourceFiles.size },
  transformations: ['omit development key and update_url', 'stable version_name', 'minimum Chrome 116',
    'remove redundant api.typesafe.ai host entry already covered by https://*/*', 'include only browser MCP bridge'],
  files: [...files].map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes) })) };
fs.writeFileSync(path.join(release, 'release-manifest.json'), JSON.stringify(metadata, null, 2) + '\n');
fs.writeFileSync(path.join(release, 'package-audit.json'), JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify({ release, zip: path.join(release, zipName), files: files.size, bytes: zip.length, sha256: metadata.artifact.sha256, staticAudit: audit.status, review: audit.review }, null, 2));
