'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { chromium } = require('playwright');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
async function snapshot(css) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true,
    args: ['--disable-background-networking', '--proxy-server=http://127.0.0.1:9'] });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.request().url() === 'https://r33-resource.qa.test/paper'
      ? route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>${css}</style><div><nav class="removed-navigation-0">Not article</nav><article id="paper"><p data-component=":hover">All article source text remains available.</p><img src="${PNG}" alt="Available local figure"></article></div>` }) : route.abort());
    await context.addInitScript({ path: path.resolve(__dirname, '../core/faithful-page-snapshot.js') });
    const page = await context.newPage(); await page.goto('https://r33-resource.qa.test/paper');
    return await page.evaluate(async () => {
      const before = document.documentElement.outerHTML, calls = [];
      const result = await SciLLM.exportFaithfulPageSnapshot({ document, articleRoot: document.querySelector('#paper'),
        fetchResource: async request => { calls.push({ url: request.url, kind: request.kind });
          throw Object.assign(Error('controlled unavailable resource'), { code: 'HTTP_403' }); } });
      return { result, calls, sourceUnchanged: before === document.documentElement.outerHTML };
    });
  } finally { await browser.close(); }
}
test('CSS resources used only by excluded navigation do not make a complete article snapshot partial', async () => {
  const { result, calls, sourceUnchanged } = await snapshot(Array.from({ length: 27 }, (_, i) =>
    `.removed-navigation-${i}{background-image:url("https://publisher.test/unrelated-${i}.png")}`).join('\n'));
  assert.equal(result.report.missingResources.length, 0);
  assert.equal(calls.length, 0, 'Resources used only by absent reading nodes must not be fetched.');
  assert.match(result.html, /All article source text remains available/);
  assert.match(result.html, /data:image\/png;base64,/);
  assert.equal(result.report.embeddedImages, 1); assert.equal(sourceUnchanged, true);
});
for (const [name, css] of [
  ['quoted attribute', '#paper [data-component=":hover"]{background-image:url(https://publisher.test/required.png)}'],
  ['scoped relative selector', '@scope (#paper){:scope > p{background-image:url(https://publisher.test/required.png)}}'],
  ['forgiving is selector', '#paper:is(:hover,.not-present){background-image:url(https://publisher.test/required.png)}'],
  ['forgiving where selector', '#paper:where(:hover,.not-present){background-image:url(https://publisher.test/required.png)}']
]) test(`required reading resources survive ${name} CSS`, async () => {
  const { result, calls } = await snapshot(css);
  assert.deepEqual(calls.map(row => row.url), ['https://publisher.test/required.png']);
  assert.equal(result.report.missingResources.length, 1);
});
test('matching article resources remain required, including hover pseudo-elements inside conditional rules', async () => {
  const { result, calls } = await snapshot('@media(min-width:1px){#paper:hover::before{content:"";background:url(https://publisher.test/required.png)}.removed-navigation-3{background:url(https://publisher.test/unused.png)}}');
  assert.deepEqual(calls.map(row => row.url), ['https://publisher.test/required.png']);
  assert.equal(result.report.missingResources.length, 1);
  assert.equal(result.report.missingResources[0].url, 'https://publisher.test/required.png');
  assert.match(result.html, /background:\s*none/);
});
