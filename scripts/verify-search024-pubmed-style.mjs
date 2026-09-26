// Real captured PubMed HTML + its embedded official CSS. Only the standalone
// search-controller data adapter is synthetic; no network or live provider.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'output/search024-pubmed-source-02/pubmed-replay.html');
const run = path.join(root, 'output/playwright/ui025-search024-frontend/pubmed-style', `run-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const report = { status: 'FAIL', checks: [], screenshots: [], hashes: {}, realApiCalls: 0,
  boundary: 'Captured official PubMed HTML and CSS replay, real production controller/CSS; synthetic result data. No live PubMed network/provider.' };
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
let browser, page;
try {
  for (const file of ['semantic-find-controller.js', 'semantic-find.css', 'output/search024-pubmed-source-02/pubmed-replay.html']) report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1080, height: 800 } });
  await context.route('**/*', route => route.abort());
  page = await context.newPage();
  await page.setContent(fs.readFileSync(source, 'utf8'), { waitUntil: 'domcontentloaded' });
  const original = await page.locator('.docsum-title').first().evaluate(n => ({ color: getComputedStyle(n).color, size: getComputedStyle(n).fontSize }));
  await page.addStyleTag({ path: path.join(root, 'semantic-find.css') });
  await page.addScriptTag({ path: path.join(root, 'semantic-find-controller.js') });
  await page.evaluate(() => {
    window.styleController = SciLLM.createSemanticFindController({ document, window,
      adapter: { buildCorpus: async () => ({ identity: { kind: 'html' }, sourceKey: 'pubmed-style', coverage: 'full', coverageMessage: '本页已加载且渲染可见的文本（含屏外）；不自动翻页。', paragraphs: [{ paragraphId: 'p', text: 'Astrocyte calcium signaling.' }], sentences: [{ id: 's', paragraphId: 'p', text: 'Astrocyte calcium signaling.', start: 0, end: 27 }] }),
        isCurrent: () => true, paint() {}, focus: async () => true, clear() {}, confirm: async () => false },
      sendMessage: async m => ({ success: true, data: { operationId: m.operationId, sourceKey: m.sourceKey, processed: 1, total: 1, skipped: 0, scores: [{ id: 's', score: .95 }] } }) });
    styleController.open();
    document.addEventListener('keydown', e => styleController.handleKeydown(e));
  });
  await page.locator('[data-semantic-find-role="query"]').fill('astrocyte calcium signaling');
  await page.locator('[data-semantic-find-role="submit"]').click();
  await page.locator('[data-semantic-find-role="status"]').filter({ hasText: '找到 1 条' }).waitFor();
  await page.locator('[data-semantic-find-role="submit"]').hover();
  check('site hover colors do not replace the neutral search action', await page.locator('[data-semantic-find-role="submit"]').evaluate(n => getComputedStyle(n).backgroundColor !== 'rgb(0, 113, 188)'));
  for (const width of [320, 1080]) {
    await page.setViewportSize({ width, height: 800 });
    const metrics = await page.locator('.sci-semantic-find').evaluate(panel => {
      const pick = name => panel.querySelector(`[data-semantic-find-role="${name}"]`);
      const nav = panel.querySelector('.sci-semantic-find__navigation');
      const threshold = panel.querySelector('.sci-semantic-find__threshold');
      const range = pick('threshold-range'), number = pick('threshold-number'), query = pick('query');
      const style = n => { const s = getComputedStyle(n), r = n.getBoundingClientRect(); return { height: r.height, marginTop: s.marginTop, marginBottom: s.marginBottom, padding: s.padding, border: s.borderWidth, font: s.fontSize, background: s.backgroundColor, appearance: s.appearance }; };
      return { gap: threshold.getBoundingClientRect().top - nav.getBoundingClientRect().bottom,
        range: style(range), number: style(number), query: style(query), label: style(threshold),
        track: { appearance: getComputedStyle(range, '::-webkit-slider-runnable-track').appearance, height: getComputedStyle(range, '::-webkit-slider-runnable-track').height },
        panelWidth: panel.getBoundingClientRect().width, overflow: panel.scrollWidth > panel.clientWidth + 1 };
    });
    check(`${width}: original website spacing does not add a blank row`, metrics.gap >= 0 && metrics.gap <= 12, metrics);
    check(`${width}: inputs keep compact 32px hit areas`, metrics.range.height === 32 && metrics.number.height === 32 && metrics.query.height === 32, metrics);
    check(`${width}: range has no site-imposed input frame`, metrics.range.border === '0px' && metrics.range.background === 'rgba(0, 0, 0, 0)', metrics.range);
    check(`${width}: panel stays bounded`, !metrics.overflow && metrics.panelWidth <= width, metrics);
    await page.screenshot({ path: path.join(run, `pubmed-style-${width}.png`) }); report.screenshots.push(`pubmed-style-${width}.png`);
  }
  const after = await page.locator('.docsum-title').first().evaluate(n => ({ color: getComputedStyle(n).color, size: getComputedStyle(n).fontSize }));
  check('styles are limited to the extension panel and leave PubMed links untouched', JSON.stringify(original) === JSON.stringify(after), { original, after });
  await page.locator('[data-semantic-find-role="threshold-number"]').fill('0.99');
  await page.locator('[data-semantic-find-role="threshold-number"]').press('Tab');
  check('number input still changes threshold', /没有匹配/.test(await page.locator('[data-semantic-find-role="status"]').innerText()));
  report.status = report.checks.every(c => c.pass) ? 'PASS' : 'FAIL';
} catch (error) { report.error = String(error.stack || error); console.error(report.error); }
finally { await browser?.close(); fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2)); console.log(run); if (report.status !== 'PASS') process.exitCode = 1; }
