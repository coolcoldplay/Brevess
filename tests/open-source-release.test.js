const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(filename) {
  return fs.readFileSync(path.join(root, filename), 'utf8');
}

test('repository contains the complete AGPL release documentation', () => {
  for (const filename of [
    'LICENSE', 'OPEN_SOURCE.md', 'THIRD_PARTY_NOTICES.md',
    'CONTRIBUTING.md', 'SECURITY.md'
  ]) {
    assert.equal(fs.existsSync(path.join(root, filename)), true, filename);
  }
  assert.match(read('LICENSE'), /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(read('LICENSE'), /Version 3, 19 November 2007/);
  assert.match(read('OPEN_SOURCE.md'), /Corresponding source/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /Phosphor Icons/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /no source code from `yilewang\/llm-for-zotero`/);
});

test('unpacked build carries license, notices, and source instructions', () => {
  const buildScript = read('scripts/build-unpacked-extension.ps1');
  for (const filename of [
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'OPEN_SOURCE.md', 'README.md', 'INSTALL.md'
  ]) {
    assert.match(buildScript, new RegExp(`'${filename.replace('.', '\\.')}'`));
  }
});

test('gitignore excludes credentials, browser profiles, and generated archives', () => {
  const gitignore = read('.gitignore');
  for (const pattern of [
    'node_modules/', 'dist/', 'output/', 'qa-artifacts/', '.playwright-cli/',
    '.env', '*.pem', '*.key', '*.zip'
  ]) {
    assert.match(gitignore, new RegExp(pattern.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')));
  }
});
