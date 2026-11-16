import fs from 'node:fs';
import path from 'node:path';
import { readZip, auditPackage, sha256, storeManifest } from './chrome-store-package.mjs';

if (process.argv.length !== 3) throw new Error('Usage: node scripts/verify-chrome-store-release.mjs dist/RELEASE_NAME');
const release = path.resolve(process.argv[2]);
const metadata = JSON.parse(fs.readFileSync(path.join(release, 'release-manifest.json')));
if (path.basename(metadata.artifact.file) !== metadata.artifact.file) throw new Error('Invalid artifact path');
const zip = fs.readFileSync(path.join(release, metadata.artifact.file));
if (sha256(zip) !== metadata.artifact.sha256 || zip.length !== metadata.artifact.bytes) throw new Error('Archive hash/size mismatch');
const files = readZip(zip);
if (files.size !== metadata.files.length) throw new Error('Package inventory mismatch');
for (const entry of metadata.files) {
  const bytes = files.get(entry.path);
  if (!bytes || bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`ZIP mismatch: ${entry.path}`);
  const staged = fs.readFileSync(path.join(release, 'extension', entry.path));
  if (!staged.equals(bytes)) throw new Error(`Staging mismatch: ${entry.path}`);
}
const audit = auditPackage(files);
if (metadata.sourceArtifact) {
  const artifact = metadata.sourceArtifact;
  if (path.basename(artifact.file) !== artifact.file) throw new Error('Invalid source artifact path');
  const bytes = fs.readFileSync(path.join(release, artifact.file));
  if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) throw new Error('Source archive hash mismatch');
  const source = readZip(bytes);
  if (source.size !== artifact.files) throw new Error('Source archive file count mismatch');
  for (const [name, contents] of files) {
    if (name === 'manifest.json') {
      if (JSON.stringify(storeManifest(JSON.parse(source.get(name)))) !== JSON.stringify(audit.manifest))
        throw new Error('Source manifest does not produce store manifest');
    } else if (!source.get(name)?.equals(contents)) throw new Error(`Source differs from package: ${name}`);
  }
}
if (audit.manifest.version !== metadata.version) throw new Error('Version mismatch');
if (audit.errors.length) throw new Error(audit.errors.join('\n'));
console.log(JSON.stringify({ status: 'PASS', release, version: metadata.version, files: files.size, bytes: zip.length, sha256: sha256(zip), review: audit.review }, null, 2));
