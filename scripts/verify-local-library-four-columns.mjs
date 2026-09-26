// LIB010 four-column display only: real options page, synthetic optional metadata query.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-lib010-table');
const phase = process.env.LIB010_TABLE_PHASE === 'before' ? 'before' : 'after';
const run = path.join(output, `${phase}-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(output, 'runtime-'));
const extension = path.join(temporary, 'extension');
const report = { status: 'FAIL', phase, checks: [], screenshots: [], hashes: {}, errors: [], realModelCalls: 0,
  boundary: 'Real options.html/script/CSS and browser interactions; optional metadata/query transport synthetic. Separate unchanged integration verifier checks production storage/search/abbreviation CRUD.' };
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
let context, page;
const shot = async name => { await page.screenshot({ path: path.join(run, `${name}.png`) }); report.screenshots.push(`${name}.png`); };
try {
  fs.mkdirSync(extension);
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  for (const name of fs.readdirSync(root)) if (/\.(js|mjs|html|css)$/.test(name) || name === 'manifest.json') fs.copyFileSync(path.join(root, name), path.join(extension, name));
  if (phase === 'before') for (const file of ['options-local-library.js', 'options-local-library.css']) fs.copyFileSync(path.join(output, 'before-snapshot', file), path.join(extension, file));
  for (const file of ['options-local-library.js', 'options-local-library.css', 'options.html', 'options.css', 'ui-swiss.css']) report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, file))).digest('hex');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking']
  });
  await context.route(/^https?:\/\//, route => route.request().url().startsWith('https://library.invalid/')
    ? route.fulfill({ contentType: 'text/html', body: '<title>Isolated article target</title><p>Local fixture</p>' }) : route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw new Error('LIB010_NO_NETWORK'); }; });
  page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(() => {
    window.libTableCalls = [];
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    const articles = Array.from({ length: 14 }, (_, index) => ({ workspaceId: `table-${index + 1}`,
      title: index < 2 ? 'Shared title · 同题不同论文' : index === 2 ? '关于复杂条件下单细胞转录状态、时间序列与组织特异性反应的长篇论文标题 ' + 'Long scientific title without loss of content '.repeat(4) : `论文 ${index + 1} · experimental evidence`,
      url: index === 3 ? 'https://library.invalid/paper.pdf' : index === 4 ? 'javascript:alert(1)' : `https://library.invalid/article/${index + 1}`,
      ...(index === 1 ? {} : { publicationDate: ['2023', '2023-07', '2023-07-21'][index % 3],
        journal: index === 2 ? 'Journal of Long Scientific Titles and Comprehensive Methodological Evidence' : 'Journal A', savedAt: '2026-09-22T09:17:23Z' }),
      updatedAt: '2030-01-01', createdAt: '2020-01-01', coverage: { notes: true, fulltext: true },
      tags: index === 0 ? ['应激', '细胞状态', '<img src=x onerror=alert(1)>'] : index === 2 ? Array.from({ length: 8 }, (_, n) => `标签${n + 1}`) : [],
      hitScopes: ['notes'], snippets: [{ scope: 'notes', label: '人工笔记', text: `note-marker-${index + 1} · <script>untrusted</script> 保留命中上下文。` }] }));
    chrome.runtime.sendMessage = async (message, ...rest) => {
      if (message.type !== 'LOCAL_READING_LIBRARY_QUERY') return original(message, ...rest);
      libTableCalls.push(structuredClone(message));
      let items;
      if (message.kind === 'articles') {
        items = articles.filter(item => !message.query || `${item.title} ${item.snippets[0].text}`.includes(message.query));
      } else items = [{ id: 'abbr-fixture', abbreviation: 'RNA', fullName: 'ribonucleic acid', meaningZh: '核糖核酸', firstImportedAt: '2024-07-04', documentCount: 2, totalCount: 6, hiddenFromReading: false }];
      const total = items.length, pageCount = Math.max(1, Math.ceil(total / message.pageSize));
      const page = Math.min(Math.max(1, message.page), pageCount);
      return { success: true, data: { items: items.slice((page - 1) * message.pageSize, page * message.pageSize), total, page, pageCount,
        totals: { articles: 14, abbreviations: 1, coverage: { notes: 14, fulltext: 14 } } } };
    };
  });
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#page=data`);
  const library = page.locator('#localReadingLibrary');
  await library.locator('.local-library__article').first().waitFor();
  const table = library.locator('.local-library__article-table');
  const wrap = library.locator('.local-library__article-table-wrap');
  const showTableStart = async () => {
    const target = phase === 'after' ? table : library;
    await target.evaluate(el => {
      const header = document.querySelector('.topbar')?.getBoundingClientRect().height || 0;
      window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - header - 16);
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  check('semantic table has requested four columns', await table.count() === 1 &&
    JSON.stringify(await table.locator('thead th').allTextContents()) === JSON.stringify(['论文标题', '发表日期', '杂志名称', '保存时间']));
  if (phase === 'after') {
    check('all column headers have scope=col', await table.locator('thead th[scope="col"]').count() === 4);
    const rows = table.locator('tbody tr');
    check('same-title distinct workspaces remain separate', await rows.nth(0).getAttribute('data-workspace-id') !== await rows.nth(1).getAttribute('data-workspace-id') &&
      await rows.nth(0).locator('h4').innerText() === await rows.nth(1).locator('h4').innerText());
    check('missing dates and journal do not borrow created/updated', JSON.stringify(await rows.nth(1).locator('td').allTextContents()).includes('未记录') &&
      (await rows.nth(1).innerText()).includes('2030') === false && await rows.nth(1).locator('td').nth(3).innerText() === '未记录');
    check('year and full-day precision remain exact', await rows.nth(0).locator('td').nth(1).innerText() === '2023' &&
      await rows.nth(2).locator('td').nth(1).innerText() === '2023-07-21');
    check('untrusted tags and metadata stay text only', (await rows.nth(0).innerText()).includes('<img src=x') && await table.locator('img,script').count() === 0);
    check('unsafe URL is inert and remote PDF uses existing reader', await rows.nth(4).locator('a').count() === 0 &&
      (await rows.nth(3).locator('h4 a').getAttribute('href')).includes('/pdf-reader.html?'));
  }
  for (const width of [320, 720, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await showTableStart();
    const metrics = await page.evaluate(() => {
      const el = document.querySelector('.local-library__article-table-wrap');
      return { viewport: innerWidth, page: document.documentElement.scrollWidth, wrapper: el?.clientWidth, table: el?.scrollWidth };
    });
    check(`${width}: local scrolling without page overflow`, metrics.page <= metrics.viewport + 1 &&
      !!metrics.wrapper && (width === 1440 || metrics.table > metrics.wrapper), metrics);
    if (phase === 'after') {
      await wrap.focus(); await page.keyboard.press('ArrowRight');
      check(`${width}: scroll region keyboard focus visible`, await wrap.evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none'));
      await wrap.evaluate(el => { el.scrollLeft = 0; });
      await showTableStart();
    }
    await shot(`${width}-table`);
  }
  if (phase === 'after') {
    const zoom = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({}); const tab = tabs.find(tab => tab.url?.includes('/options.html'));
      await chrome.tabs.setZoom(tab.id, 2); return chrome.tabs.getZoom(tab.id);
    });
    await page.reload(); await table.waitFor();
    await page.waitForFunction(() => window.innerWidth <= 720);
    await showTableStart();
    await page.waitForTimeout(150);
    const zoomMetrics = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth,
      wrapper: document.querySelector('.local-library__article-table-wrap').clientWidth, table: document.querySelector('.local-library__article-table-wrap').scrollWidth,
      headerTop: document.querySelector('.topbar').getBoundingClientRect().top,
      tableTop: document.querySelector('.local-library__article-table').getBoundingClientRect().top, scrollY, pixelRatio: devicePixelRatio }));
    check('actual browser zoom is 200% and page stays bounded', zoom === 2 && zoomMetrics.page <= zoomMetrics.viewport + 1 && zoomMetrics.table > zoomMetrics.wrapper, zoomMetrics);
    // Capture the composited viewport directly: Playwright's clip conversion at
    // a browser-level zoom otherwise offsets this sticky-header screenshot.
    const zoomCapture = await context.newCDPSession(page);
    const zoomImage = await zoomCapture.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.writeFileSync(path.join(run, '200-percent.png'), Buffer.from(zoomImage.data, 'base64'));
    report.screenshots.push('200-percent.png'); await zoomCapture.detach();
    await worker.evaluate(async () => { const tab = (await chrome.tabs.query({})).find(tab => tab.url?.includes('/options.html')); await chrome.tabs.setZoom(tab.id, 1); });
    await page.setViewportSize({ width: 720, height: 960 });
    await wrap.focus(); await wrap.evaluate(el => { el.scrollLeft = el.scrollWidth; }); await showTableStart(); await shot('720-last-columns');
    await wrap.evaluate(el => { el.scrollLeft = 0; });
    const details = table.locator('tbody tr').first().locator('details');
    await details.locator('summary').focus(); await page.keyboard.press('Enter');
    check('keyboard opens local coverage and literal snippet', await details.evaluate(el => el.open) && (await details.innerText()).includes('note-marker-1') &&
      (await details.innerText()).includes('<script>untrusted</script>'));
    await shot('720-row-details');
    await library.getByRole('button', { name: '下一页', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.local-library__article').length === 2);
    check('existing pagination still requests page 2 with 12 rows', await page.evaluate(() => libTableCalls.at(-1).page === 2 && libTableCalls.at(-1).pageSize === 12));
    await library.locator('[data-library-scope]').selectOption('notes');
    check('scope hint stays synchronized', (await library.locator('[data-library-scope-summary]').innerText()).includes('当前范围：笔记'));
    await library.locator('[data-library-search]').fill('note-marker-3');
    await page.waitForFunction(() => document.querySelectorAll('.local-library__article').length === 1);
    check('search resets pagination and preserves query/scope forwarding', await page.evaluate(() => {
      const call = libTableCalls.at(-1); return call.query === 'note-marker-3' && call.scope === 'notes' && call.page === 1;
    }));
    check('search snippets remain visible by default', await table.locator('details').evaluate(el => el.open));
    await library.locator('[data-library-kind="abbreviations"]').click();
    await library.locator('.local-library__table th').first().waitFor();
    check('glossary still has its independent nine columns', await library.locator('thead th').count() === 9 && await table.count() === 0);
    await library.locator('[data-library-kind="articles"]').click();
    await table.waitFor();
    check('switching tabs restores article query and four-column table', await library.locator('[data-library-search]').inputValue() === 'note-marker-3' && await table.locator('thead th').count() === 4);
    await library.locator('[data-library-search]').fill('no-match-xyz');
    await library.locator('.local-library__empty').waitFor();
    check('no-match state stays explicit', (await library.locator('.local-library__empty').innerText()).includes('没有匹配'));
    await library.locator('[data-library-search]').fill('note-marker-1');
    await table.waitFor();
    await page.waitForFunction(() => document.querySelector('.local-library__article')?.dataset.workspaceId === 'table-1');
    const link = table.locator('h4 a').first();
    await link.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    check('article link keyboard focus visible', await link.evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none'));
    const [target] = await Promise.all([context.waitForEvent('page'), link.click()]);
    await target.waitForURL('https://library.invalid/article/1'); await target.waitForLoadState('domcontentloaded');
    check('safe HTTP article opens separate tab with noopener', target.url() === 'https://library.invalid/article/1' && (await link.getAttribute('rel')) === 'noopener noreferrer');
    await target.close();
  }
  check('no page errors', report.errors.length === 0, report.errors);
  report.status = report.checks.every(item => item.pass) ? 'PASS' : 'FAIL';
} catch (error) { report.error = String(error.stack || error); console.error(report.error); if (page && !page.isClosed()) await shot('failure').catch(() => {}); }
finally {
  await context?.close();
  if (path.dirname(path.resolve(temporary)) === path.resolve(output) && /^runtime-/.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  fs.writeFileSync(path.join(run, 'report.html'), `<!doctype html><meta charset="utf-8"><title>LIB010 四列</title><h1>LIB010 ${phase} ${report.status}</h1><p>${escape(report.boundary)}</p>` +
    report.checks.map(item => `<p>${item.pass ? 'PASS' : 'FAIL'} ${escape(item.name)}</p>`).join('') +
    report.screenshots.map(file => `<h2>${file}</h2><img src="${file}" style="max-width:100%">`).join(''));
  console.log(`EVIDENCE ${run}`); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
