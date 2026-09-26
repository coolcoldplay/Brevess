const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('library opens cached local PDF bytes in the original reader and keeps arbitrary file links inert', () => {
  const script = fs.readFileSync(path.join(root, 'options-local-library.js'), 'utf8');
  const body = script.slice(script.indexOf('function safeArticleLink('), script.indexOf('function date('));
  const pdf = require('../core/pdf-workspace.js');
  const runtime = { getURL: value => `chrome-extension://test-extension/${value}` };
  const link = Function('element', 'SciLLM', 'chrome', `${body}; return safeArticleLink;`)(
    (tag, className, textContent) => ({ tag, className, textContent }), pdf, { runtime }
  );
  const source = pdf.buildLocalPdfWorkspaceUrl('readable.pdf', 'a'.repeat(64));
  const local = link(source, '打开原文');
  assert.equal(local.tag, 'a');
  assert.equal(new URL(local.href).searchParams.get('source'), source);
  assert.equal(new URL(local.href).pathname, '/pdf-reader.html');
  assert.equal(link('file:///C:/private/document.txt', 'unsafe').tag, 'span');
  assert.equal(link('javascript:alert(1)', 'unsafe').tag, 'span');
  assert.equal(link('https://example.test/article', 'article').href, 'https://example.test/article');
  const remote = link('https://example.test/paper.pdf', 'paper');
  assert.equal(new URL(remote.href).searchParams.get('source'), 'https://example.test/paper.pdf');
  assert.equal(local.rel, 'noopener noreferrer');
});

test('local-library UI is independent, paged, and renders untrusted text safely', () => {
  const script = fs.readFileSync(path.join(root, 'options-local-library.js'), 'utf8');
  assert.match(script, /LOCAL_READING_LIBRARY_QUERY/);
  assert.match(script, /ABBREVIATION_MEMORY_MUTATE/);
  assert.match(script, /mountLocalReadingLibrary/);
  assert.match(script, /pageSize: state\.kind === 'articles' \? 12 : 25/);
  assert.match(script, /\.textContent = String\(content\)/);
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(script, /\['https:', 'http:'\]\.includes\(parsed\.protocol\)/);
  assert.match(script, /noopener noreferrer/);
  assert.match(script, /不调用模型，也不上传正文/);
  assert.match(script, /action: 'set-visibility'/);
  assert.match(script, /action: 'delete'/);
  assert.match(script, /openAbbreviationEditor/);
});

test('background exposes the read-only derived-library RPC and imports its core', () => {
  const script = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  assert.match(script, /'core\/local-reading-library\.js'/);
  assert.match(script, /message\?\.type === 'LOCAL_READING_LIBRARY_QUERY'/);
  assert.match(script, /message\?\.type === 'ABBREVIATION_MEMORY_MUTATE'/);
  assert.match(script, /articleWorkspaceStore\.listWorkspaces\(\)/);
  assert.match(script, /articleWorkspaceStore\.listAssets\(workspace\.workspaceId\)/);
  assert.match(script, /importedAt: new Date\(\)\.toISOString\(\)/);
});
