// LIB-010: real content activation -> baseline save -> background/native IDB -> options.
// Only synthetic intercepted articles and a disposable Edge profile are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-lib010-bibliography');
fs.mkdirSync(output, { recursive: true });
const run = fs.mkdtempSync(path.join(output, 'run-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-biblio-'));
const extension = path.join(temporary, 'extension');
const bibliographyPath = 'article/bibliography.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const report = { status: 'FAIL', startedAt: new Date().toISOString(), checks: [], stages: [],
  screenshots: [], errors: [], sourceHashes: {}, realApiCalls: 0, personalDataAccessed: false,
  boundary: 'Real isolated Edge content scripts, runtime RPC, native IndexedDB and options UI. Four initial synthetic head-meta papers plus a legitimate generation-2 paper use real extraction and baseline save. Eleven RPC-only fixtures exercise paging/tag/scope and invalid ownership. No provider, directory permission, PDF metadata, publication inference, or saved-time implementation claim.' };
let context, worker, driver, page;
const pages = [];
const fixtureDefs = [
  { name: 'year', title: 'Bibliography year study', journal: 'Journal of α-synuclein Studies', rawDate: '2021', date: '2021', precision: 'year' },
  { name: 'month', title: 'Bibliography month study', journal: 'Journal of Cellular Evidence', rawDate: '2022/07', date: '2022-07', precision: 'month' },
  { name: 'day', title: 'Bibliography day study', journal: 'Journal of Scientific Controls', rawDate: '2024/02/29', date: '2024-02-29', precision: 'day' },
  { name: 'missing', title: 'Bibliography no metadata study', journal: '', rawDate: '', date: '', precision: '' }
].map(value => ({ ...value, url: `https://library.invalid/bibliography/${value.name}` }));
const stage = name => { report.stages.push({ name, at: new Date().toISOString() }); console.log(name); };
function check(name, details) { report.checks.push({ name, pass: true, ...(details ? { details } : {}) }); console.log(`PASS ${name}`); }
const raw = message => driver.evaluate(value => chrome.runtime.sendMessage(value), message);
async function rpc(message) { const result = await raw(message); assert.equal(result?.success, true, JSON.stringify(result)); return result.data; }
async function content(tabId, message) {
  const result = await driver.evaluate(({ tabId, message }) => chrome.tabs.sendMessage(tabId, message), { tabId, message });
  assert.equal(result?.success, true, JSON.stringify(result)); return result;
}
async function nativeAsset(workspaceId) {
  return driver.evaluate(async ({ workspaceId, bibliographyPath }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('sci-logic-highlighter-user-data', 4);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise((resolve, reject) => {
      const transaction = db.transaction(['workspaceAssets'], 'readonly');
      const request = transaction.objectStore('workspaceAssets').get(`${workspaceId}\u0000${bibliographyPath}`);
      request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
    }); } finally { db.close(); }
  }, { workspaceId, bibliographyPath });
}
async function saveBaseline(article) {
  const snapshot = await content(article.tabId, { action: 'getArticleWorkspaceSnapshot', forceRefresh: true });
  assert.ok(snapshot.snapshot.paragraphs.length >= 4, 'real full article extraction');
  const ensured = await content(article.tabId, { action: 'ensureArticleWorkspace' });
  const saved = await content(article.tabId, { action: 'saveArticleWorkspaceBaseline' });
  assert.equal(saved.saved, true, JSON.stringify(saved));
  assert.deepEqual(saved.warnings, []);
  return { ensured, snapshot: snapshot.snapshot, saved };
}
async function query(extra = {}) { return rpc({ type: 'LOCAL_READING_LIBRARY_QUERY', kind: 'articles', page: 1, pageSize: 30, ...extra }); }
async function screenshot(name) {
  const library = page.locator('#localReadingLibrary');
  await library.locator('.local-library__article-table').waitFor();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#localReadingLibrary')).opacity) > 0.99);
  await library.locator('.local-library__article-table').evaluate(el => window.scrollTo(0,
    window.scrollY + el.getBoundingClientRect().top - (document.querySelector('.topbar')?.getBoundingClientRect().height || 0) - 16));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const cdp = await context.newCDPSession(page);
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(run, `${name}.png`), Buffer.from(image.data, 'base64'));
  await cdp.detach(); report.screenshots.push(`${name}.png`);
}
async function waitTotal(total) {
  await page.waitForFunction(total => document.querySelector('[data-library-pagination]')?.textContent.includes(`共 ${total} 项`), total);
}
try {
  stage('copy-frozen-production-and-launch');
  fs.mkdirSync(extension);
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
  for (const file of fs.readdirSync(root)) if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(root, file), path.join(extension, file));
  fs.writeFileSync(path.join(extension, 'bibliography-driver.html'), '<!doctype html><meta charset="utf-8"><title>Isolated bibliography verification</title>LIB-010 isolated verifier');
  for (const file of ['content.js', 'background.js', 'core/background-router.js', 'core/tab-messenger.js',
    'core/article-bibliography.js', 'core/local-reading-library.js', 'core/article-workspace-store.js',
    'core/local-library-tags.js', 'options.html', 'options-local-library.js', 'options-local-library.css']) {
    report.sourceHashes[file] = sha(fs.readFileSync(path.join(extension, file)));
  }
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true,
    viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking'] });
  await context.route(/^https?:\/\//u, route => {
    const definition = fixtureDefs.find(item => item.url === route.request().url());
    if (!definition) return route.abort('blockedbyclient');
    const metadata = definition.journal ? `<meta name="citation_journal_title" content="${definition.journal}"><meta name="citation_publication_date" content="${definition.rawDate}">` : '';
    const paragraphs = Array.from({ length: 8 }, (_, index) => `<p>Experiment ${index + 1} measured the controlled neuronal response in an isolated synthetic article. The response did not increase significantly (p = 0.12). Independent observations and negative controls were retained. Bibliography regression fulltext-marker is a fixture phrase, and these paragraphs exercise production scientific article extraction without contacting a publisher or model.</p>`).join('');
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="canonical" href="${definition.url}"><meta name="citation_title" content="${definition.title}">${metadata}<title>${definition.title}</title></head><body><main><article><h1>${definition.title}</h1><h2>Results</h2>${paragraphs}</article></main></body></html>` });
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw new Error('LIB010_BIBLIOGRAPHY_NO_NETWORK'); }; });
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  driver = await context.newPage(); await driver.goto(`${origin}/bibliography-driver.html`);
  stage('real-content-extraction-and-baseline');
  for (const definition of fixtureDefs) {
    const articlePage = await context.newPage(); articlePage.on('pageerror', error => report.errors.push(error.message));
    await articlePage.goto(definition.url);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, definition.url);
    assert.ok(Number.isInteger(tabId));
    await worker.evaluate(tabId => SciLLM.ensureContentScriptForActivation(chrome, tabId), tabId);
    const article = { ...definition, page: articlePage, tabId, workspaceId: `workspace:${sha(definition.url)}` };
    const saved = await saveBaseline(article);
    article.workspace = saved.ensured.workspace;
    const asset = await nativeAsset(article.workspaceId);
    if (definition.journal) {
      assert.ok(asset, 'bibliography asset must exist in native IndexedDB');
      assert.equal(asset.content.workspaceId, article.workspaceId);
      assert.equal(asset.content.canonicalUrl, definition.url);
      assert.equal(asset.content.journal.value, definition.journal);
      assert.equal(asset.content.publicationDate.value, definition.date);
      assert.equal(asset.content.publicationDate.precision, definition.precision);
      assert.equal(asset.content.publicationDate.raw, definition.rawDate);
    } else assert.equal(asset, null, 'no head evidence creates no bibliography asset');
    pages.push(article);
    check(`${definition.name}: real activation/extraction/baseline stores exact explicit metadata`, { workspaceId: article.workspaceId, paragraphCount: saved.snapshot.paragraphs.length, date: definition.date });
  }
  const initial = await query(); assert.equal(initial.total, 4);
  for (const article of pages) {
    const item = initial.items.find(item => item.workspaceId === article.workspaceId);
    assert.equal(item.journal, article.journal); assert.equal(item.publicationDate, article.date);
    assert.equal(item.publicationDatePrecision, article.precision);
    assert.ok(!item.savedAt, 'createdAt is not a recorded save event');
  }
  check('production query projects dates without invented month/day or saved event');
  stage('real-options-four-columns');
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${origin}/options.html#page=data`);
  const library = page.locator('#localReadingLibrary');
  const table = library.locator('.local-library__article-table');
  await table.waitFor(); await waitTotal(4);
  assert.deepEqual(await table.locator('thead th').allTextContents(), ['论文标题', '发表日期', '杂志名称', '保存时间']);
  for (const article of pages) {
    const row = library.locator(`[data-workspace-id="${article.workspaceId}"].local-library__article`);
    assert.equal(await row.locator('td').nth(1).innerText(), article.date || '未记录');
    assert.equal(await row.locator('td').nth(2).innerText(), article.journal || '未记录');
    assert.equal(await row.locator('td').nth(3).innerText(), '未记录');
  }
  check('real options shows year/month/day/journal and unknowns in exact four columns');
  await screenshot('1440-publication-columns');
  await page.setViewportSize({ width: 390, height: 1000 });
  await screenshot('390-title');
  const wrap = library.locator('.local-library__article-table-wrap');
  await wrap.evaluate(el => { el.scrollLeft = el.querySelector('thead th:nth-child(2)').offsetLeft; });
  await screenshot('390-date-and-journal');
  await wrap.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await screenshot('390-journal-and-save');
  const narrow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    wrap: document.querySelector('.local-library__article-table-wrap').clientWidth,
    table: document.querySelector('.local-library__article-table-wrap').scrollWidth }));
  assert.ok(narrow.scroll <= narrow.width + 1 && narrow.table > narrow.wrap);
  check('narrow view keeps page bounded and all publication columns locally scrollable', narrow);
  await page.setViewportSize({ width: 1440, height: 1000 });
  stage('real-reextraction-retains-missing-field');
  const month = pages[1], original = await nativeAsset(month.workspaceId);
  await month.page.evaluate(() => { document.querySelector('meta[name="citation_journal_title"]').remove();
    document.querySelector('meta[name="citation_publication_date"]').content = '2023/08'; });
  await saveBaseline(month);
  const afterMissingJournal = await nativeAsset(month.workspaceId);
  assert.deepEqual(afterMissingJournal.content.journal, original.content.journal);
  assert.equal(afterMissingJournal.content.publicationDate.value, '2023-08');
  assert.ok(afterMissingJournal.revision > original.revision);
  await month.page.evaluate(() => { document.querySelector('meta[name="citation_publication_date"]').remove();
    const meta = document.createElement('meta'); meta.name = 'citation_journal_title'; meta.content = 'Updated Journal of Evidence'; document.head.append(meta); });
  await saveBaseline(month);
  const afterMissingDate = await nativeAsset(month.workspaceId);
  assert.deepEqual(afterMissingDate.content.publicationDate, afterMissingJournal.content.publicationDate);
  assert.equal(afterMissingDate.content.journal.value, 'Updated Journal of Evidence');
  check('two real head reextractions preserve missing counterpart and update only available evidence');
  await page.reload(); await waitTotal(4);
  const monthRow = library.locator(`[data-workspace-id="${month.workspaceId}"].local-library__article`);
  assert.equal(await monthRow.locator('td').nth(1).innerText(), '2023-08');
  assert.equal(await monthRow.locator('td').nth(2).innerText(), 'Updated Journal of Evidence');
  check('reopened options reads merged bibliography from native storage');
  stage('production-fixtures-for-tags-paging-and-ownership');
  const fillers = [];
  for (let index = 0; index < 11; index++) {
    const url = `https://library.invalid/bibliography/paging-${index}`, hash = sha(url);
    const workspace = { schemaVersion: 1, workspaceId: `workspace:${hash}`, canonicalUrl: url,
      title: `Paging bibliography ${String(index).padStart(2, '0')}`, aliases: [],
      directoryName: `Bibliography-${index}--${hash.slice(0, 16)}`, contentHash: sha('pagination fixture'),
      revision: sha('pagination fixture'), workspaceGeneration: 1 };
    await rpc({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace }); fillers.push(workspace);
    await rpc({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: workspace.workspaceId, workspaceGeneration: 1,
      relativePath: 'annotations/literature-note.json', content: { schemaVersion: 1, valuesByTemplate: { summary: index < 8 ? 'scope-needle note' : 'different note' } } });
  }
  const allWorkspaces = [...pages.map(article => ({ workspaceId: article.workspaceId })), ...fillers];
  for (let index = 0; index < allWorkspaces.length; index++) {
    const workspaceId = allWorkspaces[index].workspaceId;
    await rpc({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId, workspaceGeneration: 1,
      relativePath: 'annotations/library-tags.json', content: { schemaVersion: 1, workspaceId,
        tags: index < 14 ? ['共同', ...(index % 2 === 0 ? ['偶数'] : [])] : ['末页专用'] } });
  }
  // These intentionally malformed/obsolete assets use the ordinary persistence
  // API. Neither response projection nor query is replaced with a test adapter.
  const validSource = (await nativeAsset(pages[0].workspaceId)).content;
  const wrongOwner = fillers[9], staleGeneration = fillers[10];
  await rpc({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: wrongOwner.workspaceId, workspaceGeneration: 1,
    relativePath: bibliographyPath, content: validSource });
  await rpc({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: staleGeneration.workspaceId, workspaceGeneration: 1,
    relativePath: bibliographyPath, content: { ...validSource, workspaceId: staleGeneration.workspaceId, canonicalUrl: staleGeneration.canonicalUrl } });
  await rpc({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace: { ...staleGeneration, workspaceGeneration: 2 } });
  const obsolete = await raw({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: staleGeneration.workspaceId, relativePath: bibliographyPath });
  assert.equal(obsolete.success, false); assert.equal(obsolete.error.code, 'WORKSPACE_GENERATION_CONFLICT');
  const ownership = await query(); assert.equal(ownership.total, 15);
  for (const item of ownership.items.filter(item => [wrongOwner.workspaceId, staleGeneration.workspaceId].includes(item.workspaceId))) {
    assert.equal(item.journal, ''); assert.equal(item.publicationDate, '');
  }
  check('wrong-owner content and old-generation metadata do not leak into production query');
  const wrongSave = await raw({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: staleGeneration.workspaceId,
    workspaceGeneration: 1, relativePath: bibliographyPath, content: validSource });
  assert.equal(wrongSave.success, false);
  check('old-generation metadata cannot become a save baseline');
  // Give the new generation an explicit tag so full-library options include it.
  await rpc({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: staleGeneration.workspaceId, workspaceGeneration: 2,
    relativePath: 'annotations/library-tags.json', content: { schemaVersion: 1, workspaceId: staleGeneration.workspaceId, tags: ['末页专用'] } });
  await page.reload(); await waitTotal(15);
  assert.equal(await library.locator('.local-library__article').count(), 12);
  await library.getByRole('button', { name: '下一页', exact: true }).click(); await waitTotal(15);
  await page.waitForFunction(() => document.querySelectorAll('.local-library__article').length === 3);
  check('real options retains 12-per-page pagination over 15 native workspaces');
  const filter = library.locator('[data-library-tag-choice]');
  assert.ok((await filter.locator('option').allTextContents()).includes('末页专用'));
  await filter.selectOption('共同'); await waitTotal(14);
  await filter.selectOption('偶数');
  await library.locator('[data-library-tag-mode]').selectOption('all'); await waitTotal(7);
  check('tag choices cover whole library and ALL still filters before pagination');
  await library.locator('[data-library-scope]').selectOption('notes');
  await library.locator('[data-library-search]').fill('scope-needle'); await waitTotal(4);
  assert.equal(await library.locator('.local-library__article').count(), 4);
  await library.getByRole('button', { name: '清除标签筛选', exact: true }).click(); await waitTotal(8);
  assert.equal(await library.locator('[data-library-search]').inputValue(), 'scope-needle');
  assert.equal(await library.locator('[data-library-scope]').inputValue(), 'notes');
  check('tags combine with notes query and clearing tags preserves query/scope');
  await library.locator('[data-library-kind="abbreviations"]').click();
  assert.equal(await library.locator('[data-library-tag-filter]').isVisible(), false);
  await library.locator('[data-library-kind="articles"]').click(); await waitTotal(8);
  assert.deepEqual(await table.locator('thead th').allTextContents(), ['论文标题', '发表日期', '杂志名称', '保存时间']);
  check('abbreviation tab remains independent and returning restores article filters/four columns');
  await library.locator('[data-library-search]').fill(''); await library.locator('[data-library-scope]').selectOption('all');
  await waitTotal(15);
  for (const article of [wrongOwner, staleGeneration]) {
    await library.locator('[data-library-search]').fill(article.title); await waitTotal(1);
    const row = library.locator('.local-library__article');
    assert.equal(await row.locator('td').nth(1).innerText(), '未记录');
    assert.equal(await row.locator('td').nth(2).innerText(), '未记录');
    assert.equal(await row.locator('td').nth(3).innerText(), '未记录');
  }
  check('real options also renders invalid-owner/old-generation fields as unknown');
  stage('legitimate-generation2-repeated-content-extraction');
  const generation2 = { name: 'generation2', title: 'Bibliography generation two study',
    url: 'https://library.invalid/bibliography/generation2', journal: 'Generation Two Journal',
    rawDate: '2020/11', date: '2020-11', precision: 'month' };
  fixtureDefs.push(generation2);
  const digest = sha(generation2.url);
  const gen2Workspace = { schemaVersion: 1, workspaceId: `workspace:${digest}`,
    canonicalUrl: generation2.url, title: generation2.title, aliases: [],
    directoryName: `Generation-two--${digest.slice(0, 16)}`, contentHash: sha('generation-two-fixture'),
    revision: sha('generation-two-fixture'), workspaceGeneration: 2 };
  await rpc({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace: gen2Workspace });
  const gen2Page = await context.newPage(); gen2Page.on('pageerror', error => report.errors.push(error.message));
  await gen2Page.goto(generation2.url);
  const gen2TabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, generation2.url);
  await worker.evaluate(tabId => SciLLM.ensureContentScriptForActivation(chrome, tabId), gen2TabId);
  const gen2Article = { ...generation2, page: gen2Page, tabId: gen2TabId, workspaceId: gen2Workspace.workspaceId };
  const gen2Initial = await saveBaseline(gen2Article);
  assert.equal(gen2Initial.ensured.workspace.workspaceGeneration, 2);
  const gen2First = await nativeAsset(gen2Article.workspaceId);
  assert.equal(gen2First.workspaceGeneration, 2);
  assert.equal(gen2First.content.publicationDate.value, '2020-11');
  const gen2Public = await rpc({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: gen2Article.workspaceId, relativePath: bibliographyPath });
  assert.equal(gen2Public.workspaceGeneration, 2);
  check('legitimate generation-2 article first extraction creates correctly owned native metadata');
  await saveBaseline(gen2Article);
  const gen2Second = await nativeAsset(gen2Article.workspaceId);
  assert.deepEqual(gen2Second.content, gen2First.content);
  assert.equal(gen2Second.workspaceGeneration, 2);
  await gen2Page.evaluate(() => { document.querySelector('meta[name="citation_publication_date"]').remove();
    document.querySelector('meta[name="citation_journal_title"]').content = 'Generation Two Updated Journal'; });
  await saveBaseline(gen2Article);
  const gen2Third = await nativeAsset(gen2Article.workspaceId);
  assert.equal(gen2Third.workspaceGeneration, 2);
  assert.equal(gen2Third.content.journal.value, 'Generation Two Updated Journal');
  assert.deepEqual(gen2Third.content.publicationDate, gen2First.content.publicationDate);
  assert.ok(gen2Third.revision > gen2Second.revision);
  const gen2Projected = (await query({ query: generation2.title, scope: 'title' })).items;
  assert.equal(gen2Projected.length, 1);
  assert.equal(gen2Projected[0].publicationDate, '2020-11');
  assert.equal(gen2Projected[0].journal, 'Generation Two Updated Journal');
  check('generation-2 repeated full extraction/baseline and missing-field merge stay valid');
  assert.deepEqual(report.errors, []); check('no page errors');
  report.status = 'PASS';
} catch (error) {
  report.failure = String(error.stack || error); console.error(report.failure);
  if (page && !page.isClosed()) await screenshot('failure').catch(() => {});
} finally {
  await context?.close();
  report.completedAt = new Date().toISOString();
  report.runDirectory = run;
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  fs.writeFileSync(path.join(run, 'report.html'), `<!doctype html><meta charset="utf-8"><title>LIB010 bibliography</title><h1>${report.status}</h1><p>${escape(report.boundary)}</p>` +
    report.checks.map(item => `<p>PASS ${escape(item.name)}</p>`).join('') + report.screenshots.map(file => `<h2>${file}</h2><img src="${file}" style="max-width:100%">`).join(''));
  if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) && /^brevess-biblio-/u.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, report: path.join(run, 'report.json'), failure: report.failure || null }));
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
