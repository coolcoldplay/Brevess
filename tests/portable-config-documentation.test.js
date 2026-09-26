const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const repositoryRoot = join(__dirname, '..');
const primaryPath = 'Brevess/settings/portable-config.enc.json';
const previousPath = 'Brevess/backups/settings/portable-config.enc.previous.json';

function read(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), 'utf8');
}

test('all public privacy documents disclose the primary and single rolling encrypted backup', () => {
  const documents = [
    'README.md',
    'docs/privacy-policy.md',
    'docs/privacy-policy.html',
    'docs/edge-store/PRIVACY_AND_PERMISSIONS.md'
  ];

  for (const relativePath of documents) {
    const source = read(relativePath);
    assert.match(source, new RegExp(primaryPath.replaceAll('.', '\\.')),
      `${relativePath} should disclose the primary encrypted file`);
    assert.match(source, new RegExp(previousPath.replaceAll('.', '\\.')),
      `${relativePath} should disclose the rolling encrypted previous file`);
    assert.match(source, /(?:at most one|最多(?:只)?保留一个|最多一个)/iu,
      `${relativePath} should disclose the one-copy limit`);
  }
});

test('manual verification checks both encrypted portable configuration paths', () => {
  const plan = read('docs/superpowers/plans/2026-08-03-portable-config-backup.md');
  assert.match(plan, new RegExp(primaryPath.replaceAll('.', '\\.')));
  assert.match(plan, new RegExp(previousPath.replaceAll('.', '\\.')));
  assert.doesNotMatch(plan, /confirm only `Brevess\/settings\/portable-config\.enc\.json` exists/iu);
});
