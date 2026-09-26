const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { translateInterfaceText } = require('../core/i18n.js');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const reader = read('pdf-reader.js');

function remoteUrlNormalizer() {
  const start = reader.indexOf('  function normalizeRemotePdfReaderSource(');
  const end = reader.indexOf('\n  function openRemotePdfReader(', start);
  assert.ok(start >= 0 && end > start, 'remote PDF URL normalizer must be extractable');
  const context = vm.createContext({ URL });
  vm.runInContext(`${reader.slice(start, end)}\n` +
    'globalThis.normalize = normalizeRemotePdfReaderSource;', context);
  return context.normalize;
}

test('action popup and settings expose the no-source PDF reader', () => {
  const actionHtml = read('action-popup.html');
  const actionJs = read('action-popup.js');
  const optionsHtml = read('options.html');
  const optionsJs = read('options.js');
  assert.match(actionHtml, /id="openPdf"[\s\S]{0,220}>打开 PDF</u);
  assert.match(actionJs, /pdfButton\.addEventListener\('click'[\s\S]{0,260}chrome\.runtime\.getURL\('pdf-reader\.html'\)/u);
  assert.match(optionsHtml, /id="openPdfReader"[\s\S]{0,120}打开 PDF/u);
  assert.match(optionsJs, /getElementById\('openPdfReader'\)[\s\S]{0,180}chrome\.runtime\.getURL\('pdf-reader\.html'\)/u);
});

test('remote PDF entry accepts only credential-free HTTP(S) URLs', () => {
  const normalize = remoteUrlNormalizer();
  assert.equal(normalize('https://example.org/paper.pdf#page=3').url,
    'https://example.org/paper.pdf');
  assert.equal(normalize('http://127.0.0.1:8765/paper.pdf').url,
    'http://127.0.0.1:8765/paper.pdf');
  for (const value of ['', 'not a url', 'file:///private/paper.pdf',
    'javascript:alert(1)', 'https://user:secret@example.org/paper.pdf']) {
    const result = normalize(value);
    assert.equal(result.url, '', value);
    assert.ok(result.error, value);
    assert.match(result.code, /^PDF_REMOTE_URL_/u);
  }
});

test('remote PDF validation feedback remains usable in English mode', () => {
  const messages = [
    '请输入远程 PDF 的 HTTP(S) 地址。',
    '请输入有效的远程 PDF 地址。',
    '远程 PDF 地址必须使用 http:// 或 https://，且不能包含用户名或密码。',
    '无法打开这个远程 PDF 地址，请检查后重试。',
    '正在打开远程 PDF…'
  ];
  for (const message of messages) {
    const translated = translateInterfaceText(message, 'en');
    assert.notEqual(translated, message, message);
    assert.doesNotMatch(translated, /[\u3400-\u9fff]/u, message);
  }
});

test('no-source reader exposes local and remote inputs without a parsed-HTML switch', () => {
  const html = read('pdf-reader.html');
  assert.match(html, /id="pdfLocalFile"[^>]+type="file"/u);
  assert.match(html, /id="pdfRemoteUrl"[^>]+type="url"/u);
  assert.match(html, /id="pdfRemoteUrlOpen"[\s\S]{0,100}打开远程 PDF/u);
  assert.match(reader, /if \(!sourceUrl\)[\s\S]{0,700}showReaderActions\(\{ settings: true, localFallback: true \}\)/u);
  assert.match(reader, /function openRemotePdfReader[\s\S]{0,1200}createPdfReaderUrl/u);
  assert.doesNotMatch(reader.slice(
    reader.indexOf('  function openRemotePdfReader('),
    reader.indexOf('\n  const readerPreferenceKey', reader.indexOf('  function openRemotePdfReader('))
  ), /fetch\(|runParse|MinerU/u);
  assert.match(reader, /const next = 'original'/u);
  assert.match(reader, /toggle\.hidden = true/u);
  assert.doesNotMatch(html, /aria-label="解析后的 PDF 正文"/u);
});

test('PDF settings explain that MinerU enhancement is opt-in', () => {
  const html = read('options.html');
  assert.match(html, /原页阅读和本地文字索引无需 MinerU/u);
  assert.match(html, /只有主动点击“增强文本识别”时/u);
  assert.match(html, /未点击增强识别时，PDF 不会发送到 MinerU/u);
  assert.doesNotMatch(html, /激活 Brevess，即会按这里的配置自动解析/u);
});

test('isolated browser verifier clicks both entries and proves local original-page reading', () => {
  const source = read('scripts/verify-pdf-open-entry.mjs');
  assert.match(source, /#openPdf/u);
  assert.match(source, /#openPdfReader/u);
  assert.match(source, /#pdfLocalFile/u);
  assert.match(source, /#pdfRemoteUrlOpen/u);
  assert.match(source, /remoteNavigationOnly:\s*true/u);
  assert.match(source, /providerApiCalls/u);
  assert.match(source, /context\.route\(\/\^https\?:/u);
});
