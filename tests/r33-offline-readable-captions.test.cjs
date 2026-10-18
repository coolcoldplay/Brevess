'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { material, sha } = require('../output/r33-figure-flow/acceptance/contract.cjs');
const { functionSource } = require('./helpers/r28-full07-source.js');

// Real captured Cell DOM + original hash-checked JPEGs. All extra boundary fixtures
// below are explicitly synthetic; no live publisher/profile/extension/model access.
const repo = path.resolve(__dirname, '..');
const owned = path.join(repo, 'output/r33-figure-flow/faithful-source/captions');
fs.mkdirSync(owned, { recursive: true });
const helperBytes = fs.readFileSync(path.join(repo, 'core/faithful-page-snapshot.js'));
const helperSha = sha(helperBytes);
const runDir = fs.mkdtempSync(path.join(owned, `run-${helperSha.slice(0, 8)}-`));
const save = (name, value) => fs.writeFileSync(path.join(runDir, name), JSON.stringify(value, null, 2) + '\n');
const captured = material();
const contentBytes = fs.readFileSync(path.join(repo, 'content.js'));
const content = contentBytes.toString('utf8').replace(/\r\n/g, '\n');
const adapters = fs.readFileSync(path.join(repo, 'core/publisher-adapters.js'), 'utf8');
const roots = ['snapshotArticleRootScore', 'resolveZoteroSnapshotArticleRoot'].map(n => functionSource(content, n)).join('\n');
const figureIds = ['fig1', 'figs1', 'fig2', 'figs2', 'fig3', 'figs3', 'fig4', 'figs4', 'fig5', 'figs5', 'fig6', 'figs6', 'figs7', 'fig7'];
const assets = [...captured.assets].map(([url, asset]) => ({ url, sha256: asset.sha256 }));
const browsers = [], events = [];
let source, cold, exported, coldPage;

async function browserPage(pass) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run', '--proxy-server=http://127.0.0.1:9'] });
  browsers.push(browser);
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.route(/^https?:\/\//, route => {
    const request = route.request(), url = request.url();
    if (pass === 'source' && url === captured.url && request.method() === 'GET')
      return route.fulfill({ contentType: 'text/html;charset=utf-8', body: captured.html });
    const asset = pass === 'source' ? captured.assets.get(url) : null;
    if (asset && request.method() === 'GET') return route.fulfill({ contentType: asset.contentType.split(';')[0], body: asset.data });
    // Counts/types only: captured non-scientific video URLs may carry opaque signatures.
    events.push({ pass, resourceType: request.resourceType(), blocked: true });
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  return { browser, page };
}
async function installRoots(page) {
  await page.evaluate(adapters + '\n' + roots + '\nglobalThis.__qaRoot = resolveZoteroSnapshotArticleRoot();');
}
async function settle(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 900) await page.evaluate(y => scrollTo(0, y), y);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => Promise.race([image.decode().catch(() => {}), new Promise(r => setTimeout(r, 2000))])));
    scrollTo(0, 0);
  });
}
async function record(page, pass) {
  const result = await page.evaluate(async ({ figureIds, assets, pass }) => {
    const norm = node => String(node.textContent || '').replace(/\s+/g, ' ').trim();
    const box = node => { const r = node.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; };
    const structure = node => node ? { tag: node.localName, id: node.id, className: node.className,
      style: node.getAttribute('style'), hidden: node.hasAttribute('hidden'),
      aria: Object.fromEntries([...node.attributes].filter(a => a.name.startsWith('aria-')).map(a => [a.name, a.value])) } : null;
    const blockedBy = node => {
      const blocked = [];
      for (let p = node; p && __qaRoot.contains(p); p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility) || p.hidden)
          blocked.push({ ...structure(p), display: s.display, visibility: s.visibility });
      }
      return blocked;
    };
    const captions = figureIds.map(id => {
      const figure = __qaRoot.querySelector(`figure#${id}`);
      const caption = figure.querySelector('.figure__caption__text__content');
      const accordion = caption.closest('.accordion');
      const button = accordion?.querySelector('button.accordion__control');
      return { figure: structure(figure), node: structure(caption), text: norm(caption), bounds: box(caption), blockedBy: blockedBy(caption),
        accordion: structure(accordion), sourceDisclosure: structure(button), sourceDisclosureLabel: button ? norm(button) : null,
        sourceDisclosureParentClass: button?.parentElement?.className || null,
        hiddenAncestor: structure(caption.closest('.accordion__content')) };
    });
    const images = [];
    for (const asset of assets) {
      let matching = null;
      for (const image of __qaRoot.querySelectorAll('img')) {
        let hash = '';
        if (pass === 'cold' && image.src.startsWith('data:image/')) {
          const raw = atob(image.src.slice(image.src.indexOf(',') + 1));
          const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(raw, c => c.charCodeAt(0)));
          hash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
        }
        if ((pass === 'source' && image.src === asset.url) || (pass === 'cold' && hash === asset.sha256)) {
          matching = { bounds: box(image), decoded: image.complete && image.naturalWidth > 0, sha256: hash || asset.sha256 };
          break;
        }
      }
      images.push({ expectedSha256: asset.sha256, image: matching });
    }
    const resourceAttributes = [...document.querySelectorAll('[src],[srcset],link[href],object[data],video[poster]')]
      .flatMap(n => ['src', 'srcset', 'href', 'data', 'poster'].filter(k => n.hasAttribute(k)).map(k => ({ tag: n.localName, attr: k, value: n.getAttribute(k) })))
      .filter(row => /^(?:https?:)?\/\//i.test(row.value));
    return { root: structure(__qaRoot), captions, images, resourceAttributes,
      scriptCount: document.querySelectorAll('script').length,
      eventAttributes: [...document.querySelectorAll('*')].flatMap(n => [...n.attributes].filter(a => /^on/i.test(a.name)).map(a => a.name)),
      sourceButtons: document.querySelectorAll('button').length,
      stylesWithRemoteUrls: [...document.querySelectorAll('style,[style]')].some(n => /url\(\s*['"]?(?:https?:)?\/\//i.test(n.getAttribute('style') || n.textContent)),
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '' };
  }, { figureIds, assets, pass });
  return result;
}

test.before(async () => {
  save('run.json', { helperSha256: helperSha, contentRawSha256: sha(contentBytes), publisherAdaptersSha256: sha(adapters),
    boundary: 'captured source replay + explicit synthetic boundary sentinels; fresh Edge cold; 0 model, no user profile', captured: captured.report });
  const handle = await browserPage('source');
  await handle.page.goto(captured.url, { waitUntil: 'load', timeout: 45000 });
  await settle(handle.page);
  await installRoots(handle.page);
  await handle.page.evaluate(() => {
    // Negative fixtures are siblings/descendants of the actual trusted article;
    // no actual scientific caption is altered, and none claims to be captured DOM.
    __qaRoot.insertAdjacentHTML('beforeend', '<section id="qa-ordinary" class="accordion"><button class="accordion__control" aria-expanded="false">Show full caption</button><div class="accordion__content" style="display:none"><p id="qa-ordinary-text">QA_ORDINARY_HIDDEN_TEXT</p></div></section><section class="account-panel" hidden><figure class="graphic" id="qa-private"><figcaption><div class="accordion"><button class="accordion__control">Show full caption</button><div class="accordion__content" style="display:none"><div class="figure__caption__text__content">QA_PRIVATE_TEXT</div></div></div></figcaption></figure></section><details id="qa-native"><summary>Native caption details</summary><p id="qa-native-text">QA_NATIVE_DETAILS_TEXT</p></details><p id="qa-event" onclick="window.QA_EVENT_RAN=true">QA_SAFE_SOURCE_TEXT</p>');
    __qaRoot.querySelector('figure#fig1').insertAdjacentHTML('beforeend', '<div id="qa-figure-unrelated" style="display:none">QA_FIGURE_UNRELATED_TEXT</div>');
    document.body.insertAdjacentHTML('beforeend', '<aside><figure class="graphic" id="qa-outside"><figcaption><div class="accordion"><button class="accordion__control">Show full caption</button><div class="accordion__content" style="display:none"><div class="figure__caption__text__content">QA_OUTSIDE_ARTICLE_TEXT</div></div></div></figcaption></figure></aside>');
  });
  source = await record(handle.page, 'source');
  save('source.json', source);
  await handle.page.locator('figure#fig1').screenshot({ path: path.join(runDir, 'source-fig1.png') });
  await handle.page.exposeFunction('__qaResource', ({ url }) => {
    const asset = captured.assets.get(url);
    return asset ? { contentType: asset.contentType.split(';')[0], dataUrl: `data:${asset.contentType.split(';')[0]};base64,${asset.data.toString('base64')}` } : null;
  });
  await handle.page.evaluate(helperBytes.toString('utf8'));
  const result = await handle.page.evaluate(async () => {
    const before = document.documentElement.outerHTML;
    const saved = await SciLLM.exportFaithfulPageSnapshot({ document, articleRoot: __qaRoot, documentUrl: location.href,
      fetchResource: async input => {
        const asset = await __qaResource({ url: input.url });
        if (!asset) throw Object.assign(Error('Captured resource unavailable'), { code: 'captured_asset_unavailable' });
        return asset;
      } });
    return { saved, sourceUnchanged: before === document.documentElement.outerHTML };
  });
  exported = result.saved;
  save('export-report.json', { report: exported.report, htmlSha256: sha(exported.html), sourceUnchanged: result.sourceUnchanged });
  fs.writeFileSync(path.join(runDir, 'exported.html'), exported.html);
  assert.equal(result.sourceUnchanged, true);
  await handle.browser.close();
  const reopened = await browserPage('cold');
  coldPage = reopened.page;
  await coldPage.goto(pathToFileURL(path.join(runDir, 'exported.html')).href, { waitUntil: 'load', timeout: 45000 });
  await settle(coldPage);
  await installRoots(coldPage);
  cold = await record(coldPage, 'cold');
  save('cold.json', cold);
  await coldPage.locator('figure#fig1').screenshot({ path: path.join(runDir, 'cold-fig1.png') });
  save('network.json', events);
  console.log(`Readable-caption evidence: ${path.relative(repo, runDir)}; helper=${helperSha}`);
});

test.after(async () => {
  for (const browser of browsers) await browser.close().catch(() => {});
  assert.equal(sha(fs.readFileSync(path.join(repo, 'core/faithful-page-snapshot.js'))), helperSha, 'Helper changed during browser run');
});

test('captured disclosure controls and caption ancestors are real Cell figure structure', () => {
  assert.equal(source.captions.length, 14);
  for (const row of source.captions) {
    assert.equal(row.figure.className, 'graphic');
    assert.equal(row.node.className, 'figure__caption__text__content');
    assert.equal(row.accordion.className, 'accordion');
    assert.equal(row.sourceDisclosure.className, 'accordion__control');
    assert.equal(row.sourceDisclosureLabel, 'Show full caption');
    assert.equal(row.sourceDisclosure.aria['aria-expanded'], 'false');
    assert.equal(row.sourceDisclosure.aria['aria-controls'], undefined, 'Do not fabricate an aria-controls relation absent from captured source');
    assert.equal(row.hiddenAncestor.id, `${row.figure.id}-content`);
    assert.equal(row.hiddenAncestor.className, 'accordion__content');
    assert.equal(row.bounds.height, 0);
  }
});

test('all 14 captured full scientific captions remain exact and are readable in static cold HTML', () => {
  assert.equal(cold.captions.length, 14);
  const unreadable = [];
  for (let index = 0; index < 14; index++) {
    const before = source.captions[index], after = cold.captions[index];
    assert.equal(after.text, before.text, `${before.figure.id}: full original caption changed`);
    if (after.bounds.width <= 0 || after.bounds.height <= 0 || after.blockedBy.length)
      unreadable.push({ figure: after.figure.id, bounds: after.bounds, blockedBy: after.blockedBy });
  }
  assert.deepEqual(unreadable, [], 'Dropped disclosure buttons must leave the original complete scientific caption statically visible');
});

test('ordinary disclosure and unrelated hidden contents inside a scientific figure stay hidden', async () => {
  const observed = await coldPage.evaluate(() => ['qa-ordinary-text', 'qa-figure-unrelated'].map(id => {
    const node = document.getElementById(id), rect = node.getBoundingClientRect();
    return { id, exists: Boolean(node), width: rect.width, height: rect.height };
  }));
  assert.ok(observed.every(row => row.exists && row.width === 0 && row.height === 0), JSON.stringify(observed));
});

test('private content and scientific-looking disclosure outside the trusted article are excluded', () => {
  assert.doesNotMatch(exported.html, /QA_PRIVATE_TEXT|QA_OUTSIDE_ARTICLE_TEXT/);
});

test('native details keeps local summary interaction without forced expansion', async () => {
  assert.equal(await coldPage.locator('#qa-native').getAttribute('open'), null);
  await coldPage.locator('#qa-native > summary').click();
  assert.equal(await coldPage.locator('#qa-native').evaluate(node => node.open), true);
  assert.equal(await coldPage.locator('#qa-native-text').isVisible(), true);
  await coldPage.locator('#qa-native > summary').click();
  assert.equal(await coldPage.locator('#qa-native').evaluate(node => node.open), false);
});

test('cold HTML has no scripts, event handlers or remote loading resources', () => {
  assert.equal(cold.scriptCount, 0);
  assert.deepEqual(cold.eventAttributes, []);
  assert.deepEqual(cold.resourceAttributes, []);
  assert.equal(cold.stylesWithRemoteUrls, false);
  assert.equal(cold.sourceButtons, 0);
  assert.match(cold.csp, /script-src 'none'/);
  assert.match(cold.csp, /connect-src 'none'/);
  assert.deepEqual(events.filter(row => row.pass === 'cold'), []);
});

test('14 original image bytes and horizontal geometry survive caption expansion', () => {
  assert.equal(cold.images.length, 14);
  for (let index = 0; index < 14; index++) {
    const before = source.images[index], after = cold.images[index];
    assert.ok(before.image?.decoded && after.image?.decoded, `Image ${index + 1} must decode`);
    assert.equal(after.image.sha256, before.expectedSha256);
    assert.equal(after.image.bounds.x, before.image.bounds.x);
    assert.equal(after.image.bounds.width, before.image.bounds.width);
    assert.equal(after.image.bounds.height, before.image.bounds.height);
    // Expanded full captions intentionally move later figures down the page.
  }
});
