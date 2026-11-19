import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { releaseInventory } from './release-inventory.mjs';
import { auditReleaseHygiene } from './release-hygiene.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const forbidden = /(^|\/)(?:\.git|node_modules|tests?|scripts?|outputs?|dist|tmp|e2e|native-host)(\/|$)|\.(?:exe|zip|crx|log|map|pem|key|ps1|cmd)$|(^|\/)\.env(?:\.|$)/i;
export function safeName(name) {
  if (!name || name.includes('\\') || name.includes(':') || name.startsWith('/') ||
      name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Unsafe package path: ${name}`);
  return name;
}
export function chromeFiles(root) {
  // The browser uses this bridge only. The Node MCP service is a separate local integration.
  return releaseInventory(root, 'store').filter(f => !f.path.startsWith('mcp/') ||
    f.path === 'mcp/extension/workbench-mcp-bridge.js');
}
export function storeManifest(source) {
  const manifest = structuredClone(source);
  delete manifest.key; // Keep the development key only in the source tree.
  delete manifest.update_url;
  manifest.version_name = manifest.version;
  manifest.minimum_chrome_version = '116';
  manifest.host_permissions = manifest.host_permissions.filter(p => p !== 'https://api.typesafe.ai/*');
  return manifest;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
// Deterministic ZIP32: UTF-8 names, fixed DOS date, deflate, no platform-specific executables.
export function createZip(files) {
  const chunks = [], central = [], names = new Set();
  let offset = 0, centralSize = 0;
  for (const { name, bytes } of files) {
    safeName(name);
    if (names.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
    names.add(name);
    const encoded = Buffer.from(name), compressed = deflateRawSync(bytes, { level: 9 });
    if (encoded.length > 65535 || bytes.length > 0xffffffff || compressed.length > 0xffffffff)
      throw new Error('ZIP32 limit exceeded');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc32(bytes), 14); header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(encoded.length, 26);
    chunks.push(header, encoded, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4);
    header.copy(directory, 6, 4, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, encoded); centralSize += directory.length + encoded.length;
    offset += header.length + encoded.length + compressed.length;
  }
  if (names.size > 65535 || offset + centralSize > 0xffffffff) throw new Error('ZIP32 limit exceeded');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.size, 8); end.writeUInt16LE(names.size, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

// Reads our constrained ZIP format and verifies the directory, names, lengths and CRCs.
export function readZip(zip) {
  const end = zip.length - 22;
  if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50 || zip.readUInt16LE(end + 20) !== 0)
    throw new Error('Invalid ZIP end record');
  const count = zip.readUInt16LE(end + 10), centralStart = zip.readUInt32LE(end + 16);
  if (zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6) || zip.readUInt16LE(end + 8) !== count ||
      centralStart + zip.readUInt32LE(end + 12) !== end) throw new Error('Invalid ZIP directory');
  const files = new Map();
  let cursor = centralStart, nextOffset = 0;
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const size = zip.readUInt32LE(cursor + 20), plainSize = zip.readUInt32LE(cursor + 24);
    const nameSize = zip.readUInt16LE(cursor + 28), offset = zip.readUInt32LE(cursor + 42);
    const name = safeName(zip.subarray(cursor + 46, cursor + 46 + nameSize).toString('utf8'));
    if (files.has(name) || offset !== nextOffset || zip.readUInt32LE(offset) !== 0x04034b50 ||
        zip.readUInt16LE(cursor + 8) !== 0x800 || zip.readUInt16LE(cursor + 10) !== 8 ||
        zip.readUInt16LE(cursor + 30) || zip.readUInt16LE(cursor + 32) ||
        !zip.subarray(offset + 4, offset + 28).equals(zip.subarray(cursor + 6, cursor + 30)) ||
        zip.readUInt16LE(offset + 28) ||
        zip.subarray(offset + 30, offset + 30 + nameSize).toString('utf8') !== name)
      throw new Error(`Invalid ZIP metadata: ${name}`);
    nextOffset = offset + 30 + nameSize + size;
    if (nextOffset > centralStart || plainSize > 64 * 1024 * 1024) throw new Error(`Invalid ZIP size: ${name}`);
    const bytes = inflateRawSync(zip.subarray(offset + 30 + nameSize, nextOffset), { maxOutputLength: Math.max(1, plainSize) });
    if (bytes.length !== plainSize || crc32(bytes) !== zip.readUInt32LE(cursor + 16))
      throw new Error(`ZIP integrity mismatch: ${name}`);
    files.set(name, bytes);
    cursor += 46 + nameSize;
  }
  if (cursor !== end || nextOffset !== centralStart) throw new Error('Unexpected ZIP bytes');
  return files;
}

export function auditPackage(files) {
  const errors = auditReleaseHygiene(files).map(f => `Package hygiene: ${f.path}: ${f.rule}`), review = [];
  const requireFile = (name, owner) => { if (!files.has(name)) errors.push(`${owner}: missing ${name}`); };
  const manifest = JSON.parse(files.get('manifest.json') || '{}');
  if (manifest.manifest_version !== 3 || manifest.key || manifest.update_url) errors.push('Invalid store manifest');
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version || '') || manifest.version.split('.').some(n => Number(n) > 65535) ||
      !manifest.version.split('.').some(n => Number(n) > 0)) errors.push('Invalid extension version');
  if (!manifest.name || manifest.name.length > 75) errors.push('Invalid extension name');
  for (const name of [manifest.background?.service_worker, manifest.action?.default_popup,
    manifest.options_ui?.page, manifest.side_panel?.default_path, ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {})].filter(Boolean)) requireFile(name, 'manifest');
  for (const group of manifest.content_scripts || []) for (const name of [...group.js || [], ...group.css || []]) requireFile(name, 'content_scripts');
  for (const group of manifest.web_accessible_resources || []) for (const name of group.resources || [])
    if (!name.includes('*')) requireFile(name, 'web_accessible_resources');
  for (const locale of ['en', 'zh_CN']) {
    const name = `_locales/${locale}/messages.json`;
    requireFile(name, 'locales');
    const description = JSON.parse(files.get(name) || '{}').extensionDescription?.message;
    if (!description || description.length > 132) errors.push(`${name}: description must be 1–132 characters`);
  }
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'OPEN_SOURCE.md']) requireFile(name, 'license');
  function resource(ref, owner) {
    if (/^(?:data:|blob:|#)/.test(ref)) return;
    if (ref.startsWith('chrome-extension://__MSG_@@extension_id__/')) {
      requireFile(ref.slice('chrome-extension://__MSG_@@extension_id__/'.length), owner); return;
    }
    if (/^https?:\/\//.test(ref) || ref.startsWith('//')) { errors.push(`${owner}: remote executable/style resource`); return; }
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(owner), ref.split(/[?#]/)[0]));
    requireFile(resolved, owner);
  }
  for (const [name, bytes] of files) {
    safeName(name);
    if (forbidden.test(name) || (name.startsWith('mcp/') && name !== 'mcp/extension/workbench-mcp-bridge.js')) errors.push(`Not browser runtime: ${name}`);
    if (!/\.(?:[cm]?js|html|css|json|md|txt)$/.test(name)) continue;
    const source = bytes.toString('utf8');
    if (/\bsk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source)) errors.push(`Possible embedded secret: ${name}`);
    if (name.endsWith('.html')) {
      for (const m of source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) resource(m[1], name);
      for (const m of source.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css(?:[?#][^"']*)?)["']/gi)) resource(m[1], name);
    }
    if (/\.[cm]?js$/.test(name)) {
      for (const m of source.matchAll(/importScripts\s*\(([\s\S]*?)\)/g))
        for (const ref of m[1].matchAll(/["']([^"']+\.js)["']/g)) resource(ref[1], name);
      for (const m of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["']((?:https?:\/\/|\.\.\/|\.\/)[^"']+)["']/g)) resource(m[1], name);
      if (/\b(?:eval\s*\(|new\s+Function\s*\()/.test(source)) review.push({ path: name, reason: 'dynamic-code token: inspect reachability; vendor PDF.js is not by itself evidence of remote code' });
      if (/(?:importScripts|new\s+Worker)\s*\(\s*["']https?:\/\//.test(source)) errors.push(`${name}: remote code URL`);
    }
    if (name.endsWith('.css')) for (const m of source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) resource(m[1], name);
  }
  return { status: errors.length ? 'FAIL' : 'PASS', errors: [...new Set(errors)], review,
    fileCount: files.size, bytes: [...files.values()].reduce((sum, b) => sum + b.length, 0), manifest };
}
