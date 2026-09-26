const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PdfTranslationPageServer } = require('../native-host/host.js');

test('translation-compatible PDF page is served only on loopback with semantic HTML', async t => {
  const server = new PdfTranslationPageServer();
  t.after(() => server.close());
  const published = await server.publish({
    title: 'A scientific paper',
    sourceUrl: 'https://example.org/paper.pdf',
    articleHtml: '<article><h1>Title</h1><h2>Results</h2><p>Evidence.</p></article>'
  });
  assert.match(published.url,
    /^http:\/\/127\.0\.0\.1:\d+\/brevess-pdf\/[a-f0-9]{48}$/);
  const response = await fetch(published.url);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'nonce-/);
  assert.match(html, /data-brevess-translation-page="true"/);
  assert.match(html, /data-brevess-pdf-source-url="https:\/\/example\.org\/paper\.pdf"/);
  assert.match(html, /id="brevessPdfZoomOut"/);
  assert.match(html, /h1 \.immersive-translate-target-wrapper/);
  assert.match(html, /<h2>Results<\/h2><p>Evidence\.<\/p>/);
  assert.match(html, /<script nonce="[^"]+">/);
});

test('PDF reader hands parsed content to the same tab for natural Immersive Translate use', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'pdf-reader.html'), 'utf8');
  const reader = fs.readFileSync(path.join(root, 'pdf-reader.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'core/pdf-figure-native-client.js'), 'utf8');
  assert.doesNotMatch(html, /id="pdfReaderTranslate"/);
  assert.doesNotMatch(html, /id="pdfReaderOutline"/);
  assert.match(reader, /handoffToInlineTranslationPage/);
  assert.match(reader, /publishTranslationPage/);
  assert.match(reader, /globalThis\.location\.replace\(result\.url\)/);
  assert.doesNotMatch(reader, /chrome\.tabs\.create\(\{ url: result\.url/);
  assert.match(client, /sourceUrl: String\(input\.sourceUrl/);
  assert.match(client, /pdf\.translation\.publish/);
});
