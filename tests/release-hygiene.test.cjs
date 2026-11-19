const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let api, inventory;
test.before(async () => {
  api = await import('../scripts/release-hygiene.mjs');
  inventory = await import('../scripts/release-inventory.mjs');
});

test('private and development files cannot hide inside an allowed runtime directory', () => {
  for (const name of ['core/fixtures/paper.json', 'vendor/outputs/capture.html',
    'icons/.DS_Store', 'icons/__MACOSX/icon', 'core/settings.test.js', 'core/auth.json',
    'core/.env.local', 'core/cookies.json', 'core/cache.sqlite', 'icons/screenshots/qa.png']) {
    assert.ok(api.auditReleaseFile(name, Buffer.from('data')).length, name);
  }
});

test('embedded credentials, local paths and synthetic evidence fail without echoing values', () => {
  const samples = [
    ['LOCAL_USER_PATH', '"/Users/private-person/Documents/paper.pdf"'],
    ['LOCAL_USER_PATH', '"/home/private-person/secret"'],
    ['LOCAL_USER_PATH', '"C:\\\\Users\\\\private-person\\\\notes"'],
    ['LOCAL_USER_PATH', '"/var/folders/ab/private-image.png"'],
    ['PRIVATE_KEY', '-----BEGIN PRIVATE KEY-----'],
    ['UNREVIEWED_EMAIL_ADDRESS', 'private.person@example.invalid'],
    ['PROVIDER_OR_ACCESS_TOKEN', 'sk-' + 'z'.repeat(40)],
    ['PROVIDER_OR_ACCESS_TOKEN', 'github_pat_' + 'z'.repeat(40)],
    ['PROVIDER_OR_ACCESS_TOKEN', 'AIza' + 'z'.repeat(35)],
    ['JWT_CREDENTIAL', 'eyJ' + 'a'.repeat(15) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(20)],
    ['SYNTHETIC_TEST_RESIDUE', 'https://fixture.invalid/paper'],
    ['SYNTHETIC_TEST_RESIDUE', 'SYNTHETIC_PRIVATE_TEST_RESPONSE']
  ];
  for (const [rule, sample] of samples) {
    const hits = api.auditReleaseFile('core/runtime.js', Buffer.from(sample));
    assert.ok(hits.some(hit => hit.rule === rule), rule);
    assert.ok(!JSON.stringify(hits).includes(sample), 'findings must not echo secrets');
  }
  // Binary assets are scanned too, not just source extensions.
  assert.ok(api.auditReleaseFile('icons/logo.png', Buffer.from('\0/Users/private-person/data\0'))
    .some(hit => hit.rule === 'LOCAL_USER_PATH'));
});

test('public documentation URLs, runtime API fields and public extension identity are retained', () => {
  const source = JSON.stringify({ docs: 'https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/',
    origin: 'http://127.0.0.1:8880/v1/audio/speech', apiKey: '', key: 'public-extension-identity',
    support: 'https://github.com/coolcoldplay/Brevess' });
  assert.deepEqual(api.auditReleaseFile('core/providers.js', Buffer.from(source)), []);
});

test('the inventory stops staging for contaminated source but ignores unrelated development trees', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-hygiene-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'core')); fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'core', 'main.js'), 'const apiKey = "";');
  fs.writeFileSync(path.join(root, 'tests', 'secret.txt'), 'sk-' + 'z'.repeat(40));
  const spec = { browserRootFiles: [], browserDirectories: ['core'] };
  assert.deepEqual(inventory.releaseInventory(root, 'store', spec).map(f => f.path), ['core/main.js']);
  fs.writeFileSync(path.join(root, 'core', 'main.js'), 'const source = "/Users/private-person/paper";');
  assert.throws(() => inventory.releaseInventory(root, 'store', spec), /RELEASE_HYGIENE_FAILED.*LOCAL_USER_PATH/);
});

test('developer recoloring examples in shipped filters block the build, generic color tools remain usable', () => {
  for (const file of ['web-filters-general/schema.js', 'extension/web-filters-general/reading-modules.js']) {
    const sample = JSON.stringify({from:[32,85,138,1],to:[255,192,203,1]});
    assert.ok(api.auditReleaseFile(file, Buffer.from(sample)).some(hit => hit.rule === 'PERSONAL_DISPLAY_EXAMPLE'));
    assert.deepEqual(api.auditReleaseFile(file, Buffer.from('replaceColor(operation.from, operation.to)')), []);
  }
});
