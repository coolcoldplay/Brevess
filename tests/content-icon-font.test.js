const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../content.css'), 'utf8');
const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const start = content.indexOf('async function loadZoteroSnapshotPluginCss(');
const end = content.indexOf('\n}', start) + 2;
const loadSnapshotCss = Function('fetch', 'chrome', 'encodeSnapshotImageDataUrl',
  `return (${content.slice(start, end)});`);

test('the injected icon face resolves through the extension origin instead of the article host', () => {
  assert.match(css, /src:\s*url\("chrome-extension:\/\/__MSG_@@extension_id__\/vendor\/phosphor\/Phosphor\.woff2"\)/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  assert.ok(manifest.web_accessible_resources.some(entry =>
    entry.resources.includes('vendor/phosphor/Phosphor.woff2')));
});

for (const fontUrl of ['vendor/phosphor/Phosphor.woff2',
  'chrome-extension://__MSG_@@extension_id__/vendor/phosphor/Phosphor.woff2',
  'chrome-extension://abcdefghijklmnopabcdefghijklmnop/vendor/phosphor/Phosphor.woff2']) {
  test(`offline article export embeds the font for ${fontUrl}`, async () => {
    const input = `@font-face {font-family:Phosphor;src:url("${fontUrl}") format("woff2");}`;
    const requests = [];
    const load = loadSnapshotCss(async url => {
      requests.push(url);
      return url.endsWith('/content.css') ? { ok: true, text: async () => input } :
        { ok: true, headers: { get: () => 'font/woff2' },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }, { runtime: { getURL: name => `chrome-extension://fixture/${name}` } },
    (bytes, type) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`);
    const output = await load();
    assert.ok(output.includes('url("data:font/woff2;base64,AQID")'));
    assert.ok(!output.includes(fontUrl));
    assert.deepEqual(requests, ['chrome-extension://fixture/content.css',
      'chrome-extension://fixture/vendor/phosphor/Phosphor.woff2']);
  });
}
