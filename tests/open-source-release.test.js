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
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /Phosphor Icons/);
  assert.match(notices, /yilewang\/llm-for-zotero/);
  assert.match(notices, /f8dbbd863b021368c07efe0f61c67f3503d79bc9/);
  assert.match(notices, /Yile Wang/);
  assert.match(notices, /AGPL-3\.0-or-later/);
  for (const filename of [
    'core/article-chat-tokenizer.js',
    'core/article-chat-citations.js',
    'core/article-chat-stream.js',
    'core/article-chat-queue.js'
  ]) assert.match(notices, new RegExp(filename.replace(/[./]/g, '\\$&')));
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

test('1.0.0 release metadata and scale benchmark stay consistent', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(manifest.version, '1.0.0');
  assert.equal(packageJson.version, '1.0.0');
  assert.equal(packageJson.scripts['benchmark:article-chat'],
    'node scripts/benchmark-article-chat.mjs');
  assert.match(read('background.js'), /version:\s*'1\.0\.0'/);
  assert.match(read('core/background-router.js'), /1\.0\.0-build1-store-release/);
  assert.match(read('content.js'), /1\.0\.0-build1-store-release/);
  assert.match(
    read('scripts/build-unpacked-extension.ps1'),
    /v1\.0\.0-build1-store-release/
  );
  assert.match(read('README.md'), /1\.0\.0-build1-store-release/);
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'benchmark-article-chat.mjs')), true);
  assert.equal(fs.existsSync(
    path.join(root, 'scripts', 'benchmark-zotero-mineru-regex.mjs')
  ), true);
});
