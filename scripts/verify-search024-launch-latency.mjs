// Isolated Edge; public saved PubMed HTML/CSS, no user profile or model calls.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.argv[2] || repo);
const output = path.resolve(process.argv[3] || '');
assert.ok(process.argv[3] && !fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });
const extension = path.join(output, 'extension');
fs.mkdirSync(extension);
for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
  if ((entry.isDirectory() && ['core', 'providers', 'vendor', 'icons', '_locales'].includes(entry.name)) ||
      (entry.isFile() && (/\.(js|mjs|html|css)$/u.test(entry.name) || entry.name === 'manifest.json'))) {
    fs.cpSync(path.join(source, entry.name), path.join(extension, entry.name), { recursive: true });
  }
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = { startedAt: new Date().toISOString(), source, realApiCalls: 0,
  boundary: 'Public saved HTML/CSS replay, cloned result cards for load; no live site scripts or user extension profile.',
  sourceHashes: Object.fromEntries(['content.js', 'semantic-find-launcher.js', 'core/semantic-find-launcher.js',
    'core/tab-messenger.js', 'semantic-find-controller.js'].map(file => [file, hash(path.join(source, file))])),
  runs: [], errors: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const html = fs.readFileSync(path.join(repo, 'output/search024-pubmed-source-02/pubmed-replay.html'), 'utf8');
let context;
try {
  context = await chromium.launchPersistentContext(path.join(output, 'profile'), {
    channel: 'msedge', headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => {
    if (route.request().isNavigationRequest() && new URL(route.request().url()).hostname === 'pubmed.ncbi.nlm.nih.gov')
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    return route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  for (const count of [10, 200]) {
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(String(error)));
    await page.addInitScript(() => {
      window.launchTiming = { pressed: 0, shown: 0, longTasks: [] };
      document.addEventListener('keydown', event => {
        if (event.key.toLowerCase() === 'j' && !event.repeat) window.launchTiming.pressed = performance.now();
      }, true);
      new MutationObserver(() => {
        const query = document.querySelector('.sci-semantic-find [data-semantic-find-role="query"]');
        if (window.launchTiming.pressed && query?.getClientRects().length && !window.launchTiming.shown)
          window.launchTiming.shown = performance.now();
      }).observe(document, { subtree: true, childList: true, attributes: true });
      new PerformanceObserver(list => window.launchTiming.longTasks.push(...list.getEntries().map(e =>
        ({ start: e.startTime, duration: e.duration })))).observe({ entryTypes: ['longtask'] });
    });
    await page.goto(`https://pubmed.ncbi.nlm.nih.gov/?term=astrocyte&latency=${count}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(n => {
      const cards = [...document.querySelectorAll('article.full-docsum')];
      for (let index = cards.length; index < n; index++) {
        const copy = cards[index % cards.length].cloneNode(true);
        copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        cards[0].parentElement.append(copy);
      }
    }, count);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, page.url());
    for (let attempt = 0; attempt < 100; attempt++) {
      const ready = await worker.evaluate(async id => (await chrome.scripting.executeScript({ target: { tabId: id },
        func: () => globalThis.__brevessSemanticFindShortcut?.shortcutKey }))[0]?.result, tabId);
      if (ready === 'J') break;
      if (attempt === 99) throw Error('Shortcut listener did not become ready');
      await page.waitForTimeout(100);
    }
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('j');
    try {
      await page.locator('.sci-semantic-find [data-semantic-find-role="query"]').waitFor({ state: 'visible', timeout: 60000 });
    } catch (error) {
      report.runs.push({ count, failure: String(error), pageState: await page.evaluate(() => ({
        timing: window.launchTiming, activeElement: document.activeElement?.tagName,
        revision: document.documentElement.dataset.sciLlmContentRevision,
        notice: [...document.querySelectorAll('[data-sci-plugin-ui]')].map(e => e.textContent?.slice(0, 200))
      })) });
      throw error;
    }
    await page.waitForTimeout(100);
    const cold = await page.evaluate(() => structuredClone(window.launchTiming));
    const state = await worker.evaluate(async id => (await chrome.scripting.executeScript({ target: { tabId: id },
      func: () => ({ preindex: typeof articlePreindexScheduler === 'object' ? {
        leadingComplete: articlePreindexScheduler.leadingComplete, canonicalComplete: articlePreindexScheduler.canonicalComplete
      } : null, trace: typeof lastArticleExtractionTrace !== 'undefined' ? lastArticleExtractionTrace : null }) }))[0]?.result, tabId);
    await page.screenshot({ path: path.join(output, `pubmed-${count}.png`) });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.launchTiming.pressed = 0; window.launchTiming.shown = 0; window.launchTiming.longTasks = []; });
    await page.keyboard.press('j');
    await page.locator('.sci-semantic-find [data-semantic-find-role="query"]').waitFor({ state: 'visible' });
    const warm = await page.evaluate(() => structuredClone(window.launchTiming));
    report.runs.push({ count, coldMs: cold.shown - cold.pressed, warmMs: warm.shown - warm.pressed,
      cold, warm, state }); save();
    await page.close();
  }
  assert.equal(report.errors.length, 0);
  report.status = 'MEASURED';
} catch (error) { report.status = 'FAIL'; report.failure = String(error.stack || error); process.exitCode = 1; }
finally { await context?.close(); save(); }
console.log(JSON.stringify({ status: report.status, runs: report.runs.map(({ count, coldMs, warmMs, state }) =>
  ({ count, coldMs, warmMs, state })), output }));
