const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let api;
test.before(async () => { api = await import('../scripts/chrome-store-package.mjs'); });
test('Chrome ZIP preserves file bytes and Unicode paths deterministically and rejects corruption', () => {
  const entries = [{name:'manifest.json',bytes:Buffer.from('{"manifest_version":3}')},
    {name:'_locales/zh_CN/说明.txt',bytes:Buffer.from('科研阅读')}, {name:'empty',bytes:Buffer.alloc(0)}];
  const zip = api.createZip(entries), decoded = api.readZip(zip);
  assert.deepEqual(zip, api.createZip(entries));
  for (const entry of entries) assert.deepEqual(decoded.get(entry.name), entry.bytes);
  const corrupt = Buffer.from(zip); corrupt[45] ^= 1;
  assert.throws(() => api.readZip(corrupt));
  assert.throws(() => api.createZip([...entries, entries[0]]), /Duplicate/);
  assert.throws(() => api.createZip([{name:'../secret',bytes:Buffer.from('x')}]), /Unsafe/);
});
test('Chrome staging keeps source manifest untouched and includes every runtime dependency', () => {
  const root = path.join(__dirname, '..');
  const source = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  const staged = api.storeManifest(source);
  assert.ok(source.key); assert.equal(staged.key, undefined);
  assert.equal(staged.version, source.version);
  assert.deepEqual(staged.permissions, source.permissions);
  assert.ok(staged.host_permissions.includes('https://*/*'));
  const files = new Map(api.chromeFiles(root).map(f => [f.path, fs.readFileSync(path.join(root, f.path))]));
  files.set('manifest.json', Buffer.from(JSON.stringify(staged)));
  assert.equal(files.has('mcp/server.js'), false);
  assert.equal(files.has('mcp/extension/workbench-mcp-bridge.js'), true);
  const audit = api.auditPackage(files);
  assert.deepEqual(audit.errors, []);
  files.delete('core/credential-boundary.js');
  assert.ok(api.auditPackage(files).errors.some(e => e.includes('missing core/credential-boundary.js')));
});
