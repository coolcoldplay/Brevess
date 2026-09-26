// Real content/full-save -> runtime -> native IDB -> options. Only synthetic pages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'output/playwright/r16-feedback-lib010-save-events');
fs.mkdirSync(out, { recursive: true }); const run = fs.mkdtempSync(path.join(out, 'run-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-save-events-'));
const extension = path.join(temporary, 'extension');
const eventPath = 'annotations/library-save-events.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const files = ['content.js', 'background.js', 'core/background-router.js', 'core/article-workspace-save.js',
  'core/article-workspace-store.js', 'core/local-reading-library.js', 'core/local-library-tags.js',
  'core/tab-messenger.js', 'options.html', 'options-local-library.js', 'options-local-library.css'];
const report = { status: 'FAIL', startedAt: new Date().toISOString(), checks: [], stages: [], errors: [],
  screenshots: [], sourceHashes: {}, endSourceHashes: {}, realApiCalls: 0, personalDataAccessed: false,
  boundary: 'Real isolated Edge content saveArticleWorkspaceNow message, production background/native IndexedDB/options. Synthetic papers only. Failure injection replaces only the content offline-snapshot function with a throw; event persistence, query and IDB are never replaced. Saved time means complete explicit browser-local save, not directory flush.' };
let context, worker, driver, page;
const definitions = ['baseline', 'complete', 'partial', 'generation2'].map(name => ({ name,
  title: `Save event ${name} paper`, url: `https://library.invalid/save-events/${name}` }));
const stage = name => { console.log(name); report.stages.push({ name, at: new Date().toISOString() }); };
const check = (name, details) => { console.log(`PASS ${name}`); report.checks.push({ name, pass: true, ...(details ? { details } : {}) }); };
const raw = message => driver.evaluate(value => chrome.runtime.sendMessage(value), message);
async function rpc(message) { const result = await raw(message); assert.equal(result?.success, true, JSON.stringify(result)); return result.data; }
async function content(article, message) {
  const result = await driver.evaluate(({ tabId, message }) => chrome.tabs.sendMessage(tabId, message), { tabId: article.tabId, message });
  assert.equal(result?.success, true, JSON.stringify(result)); return result;
}
async function nativeAsset(workspaceId, relativePath = eventPath) {
  return driver.evaluate(async ({ workspaceId, relativePath }) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('sci-logic-highlighter-user-data', 4); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise((resolve, reject) => { const r = db.transaction(['workspaceAssets'], 'readonly').objectStore('workspaceAssets').get(`${workspaceId}\u0000${relativePath}`); r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error); }); }
    finally { db.close(); }
  }, { workspaceId, relativePath });
}
async function query(extra = {}) { return rpc({ type: 'LOCAL_READING_LIBRARY_QUERY', kind: 'articles', page: 1, pageSize: 30, ...extra }); }
function workspace(definition, generation = 1) { const digest = hash(definition.url); return {
  schemaVersion: 1, workspaceId: `workspace:${digest}`, canonicalUrl: definition.url, title: definition.title,
  aliases: [], directoryName: `${definition.name}--${digest.slice(0, 16)}`, contentHash: hash('fixture content'),
  revision: hash('fixture content'), workspaceGeneration: generation }; }
async function injectOfflineFailure(article, enabled) {
  await worker.evaluate(async ({ tabId, enabled }) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: enabled => {
      if (enabled) {
        if (globalThis.libSaveOriginalOffline) throw Error('ALREADY_INJECTED');
        globalThis.libSaveOriginalOffline = persistOfflineArticleSnapshot;
        persistOfflineArticleSnapshot = async () => { throw Error('LIB010_TEST_OFFLINE_STAGE_FAILURE'); };
      } else {
        if (!globalThis.libSaveOriginalOffline) throw Error('NOT_INJECTED');
        persistOfflineArticleSnapshot = globalThis.libSaveOriginalOffline;
        delete globalThis.libSaveOriginalOffline;
      }
    }, args: [enabled] });
  }, { tabId: article.tabId, enabled });
}
async function shot(name) {
  const table = page.locator('.local-library__article-table'); await table.waitFor();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#localReadingLibrary')).opacity) > .99);
  await table.evaluate(el => window.scrollTo(0, scrollY + el.getBoundingClientRect().top - (document.querySelector('.topbar')?.getBoundingClientRect().height || 0) - 14));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const cdp = await context.newCDPSession(page); const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(run, `${name}.png`), Buffer.from(result.data, 'base64')); await cdp.detach(); report.screenshots.push(`${name}.png`);
}
try {
  stage('copy-and-hash-before-browser'); fs.mkdirSync(extension);
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
  for (const file of fs.readdirSync(root)) if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(root, file), path.join(extension, file));
  for (const file of files) report.sourceHashes[file] = hash(fs.readFileSync(path.join(extension, file)));
  fs.writeFileSync(path.join(extension, 'save-events-driver.html'), '<!doctype html><meta charset="utf-8"><title>Isolated save event verification</title>LIB010 save events');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true,
    viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking'] });
  await context.route(/^https?:\/\//u, route => {
    const def = definitions.find(def => def.url === route.request().url()); if (!def) return route.abort('blockedbyclient');
    const paragraphs = Array.from({ length: 8 }, (_, index) => `<p>Experiment ${index + 1} measured a controlled response in a synthetic paper. The prespecified comparison showed no increase (p = 0.12). Independent observations, negative controls and all recorded measurements were retained. This paragraph exercises the production article extraction and save pipeline without invoking a model or contacting a real publisher. Local save-marker belongs only to this isolated fixture.</p>`).join('');
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${def.title}</title><link rel="canonical" href="${def.url}"><meta name="citation_title" content="${def.title}"><meta name="citation_journal_title" content="Synthetic Save Journal"><meta name="citation_publication_date" content="2021/07"></head><body><main><article><h1>${def.title}</h1><h2>Results</h2>${paragraphs}</article></main></body></html>` });
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw Error('LIB010_NO_NETWORK'); }; });
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  driver = await context.newPage(); await driver.goto(`${origin}/save-events-driver.html`);
  const articles = [];
  stage('real-extraction-and-baseline-without-explicit-save');
  for (const def of definitions) {
    const target = workspace(def, def.name === 'generation2' ? 2 : 1);
    if (def.name === 'generation2') await rpc({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace: target });
    const articlePage = await context.newPage(); articlePage.on('pageerror', error => report.errors.push(error.message)); await articlePage.goto(def.url);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, def.url);
    await worker.evaluate(tabId => SciLLM.ensureContentScriptForActivation(chrome, tabId), tabId);
    const article = { ...def, page: articlePage, tabId, workspaceId: target.workspaceId };
    const extracted = await content(article, { action: 'getArticleWorkspaceSnapshot', forceRefresh: true }); assert.equal(extracted.snapshot.paragraphs.length, 8);
    article.paragraph = extracted.snapshot.paragraphs[0];
    article.workspace = (await content(article, { action: 'ensureArticleWorkspace' })).workspace;
    const baseline = await content(article, { action: 'saveArticleWorkspaceBaseline' }); assert.equal(baseline.saved, true);
    assert.equal(await nativeAsset(article.workspaceId), null); articles.push(article);
  }
  assert.ok((await query()).items.every(item => item.savedAt === ''));
  check('ordinary extraction and baseline saves leave all four articles without invented savedAt');
  const [baseline, complete, partial, gen2] = articles;
  stage('complete-explicit-save-through-real-message');
  const first = await content(complete, { action: 'saveArticleWorkspaceNow', operationId: 'save-events:complete-one' });
  report.firstExplicitSave = first;
  assert.equal(first.saveStatus, 'complete', JSON.stringify(first)); assert.equal(first.saveEvent.recorded, true);
  assert.deepEqual(first.warnings, []); assert.equal(first.offlineSnapshot.saved, true);
  const offlineAsset = await nativeAsset(complete.workspaceId, 'article/offline-snapshot.html');
  assert.ok(offlineAsset && typeof offlineAsset.content === 'string');
  assert.ok(offlineAsset.content.includes(complete.title));
  assert.ok(offlineAsset.content.includes('Local save-marker'));
  assert.equal(Buffer.byteLength(offlineAsset.content, 'utf8'), first.offlineSnapshot.byteSize);
  report.nativeOffline = { relativePath: offlineAsset.relativePath, byteSize: Buffer.byteLength(offlineAsset.content, 'utf8'),
    htmlSha256: hash(offlineAsset.content), directoryPersisted: first.offlineSnapshot.asset.directoryPersisted,
    directoryPermission: first.offlineSnapshot.asset.directoryPermission };
  check('real generated offline HTML exists in native IndexedDB with exact byte count and article text');
  const firstEvent = await nativeAsset(complete.workspaceId); assert.equal(firstEvent.content.lastAttempt.status, 'complete');
  assert.equal(firstEvent.content.lastSavedAt, first.saveEvent.asset.lastSavedAt);
  assert.equal(firstEvent.content.firstRecordedAt, firstEvent.content.lastSavedAt);
  assert.equal((await query()).items.find(item => item.workspaceId === complete.workspaceId).savedAt, firstEvent.content.lastSavedAt);
  check('complete explicit message saves actual offline/content/figure assets and exposes exactly recorded time');
  await content(complete, { action: 'updateArticleParagraphNote', paragraphId: complete.paragraph.paragraphId,
    sourceKey: complete.paragraph.sourceKey, note: 'autosave-marker note must not advance explicit save time' });
  await content(complete, { action: 'saveArticleWorkspaceBaseline' });
  assert.deepEqual(await nativeAsset(complete.workspaceId), firstEvent);
  check('real paragraph-note mutation plus ordinary baseline autosave does not advance savedAt or event revision');
  const duplicate = await content(complete, { action: 'saveArticleWorkspaceNow', operationId: 'save-events:complete-one' });
  assert.equal(duplicate.saveEvent.recorded, false); assert.equal(duplicate.saveEvent.reason, 'duplicate-operation');
  assert.deepEqual(await nativeAsset(complete.workspaceId), firstEvent);
  check('same operationId performs no second event write or savedAt advance');
  stage('offline-stage-failure-with-real-event-persistence');
  await injectOfflineFailure(complete, true);
  const failedAfterSuccess = await content(complete, { action: 'saveArticleWorkspaceNow', operationId: 'save-events:partial-after-success' });
  await injectOfflineFailure(complete, false);
  assert.equal(failedAfterSuccess.saveStatus, 'partial');
  assert.equal(failedAfterSuccess.offlineSnapshot.error, 'LIB010_TEST_OFFLINE_STAGE_FAILURE');
  const partialEvent = await nativeAsset(complete.workspaceId);
  assert.equal(partialEvent.content.lastSavedAt, firstEvent.content.lastSavedAt);
  assert.equal(partialEvent.content.operationId, firstEvent.content.operationId);
  assert.equal(partialEvent.content.lastAttempt.status, 'partial');
  assert.equal(partialEvent.content.lastAttempt.operationId, 'save-events:partial-after-success');
  assert.ok(partialEvent.revision > firstEvent.revision);
  assert.equal((await query()).items.find(item => item.workspaceId === complete.workspaceId).savedAt, firstEvent.content.lastSavedAt);
  check('actual offline-stage exception records partial attempt while preserving last successful timestamp');
  await injectOfflineFailure(partial, true);
  const partialOnly = await content(partial, { action: 'saveArticleWorkspaceNow', operationId: 'save-events:partial-only' });
  await injectOfflineFailure(partial, false);
  assert.equal(partialOnly.saveStatus, 'partial'); const only = await nativeAsset(partial.workspaceId);
  assert.equal(only.content.lastSavedAt, ''); assert.equal(only.content.firstRecordedAt, '');
  assert.equal((await query()).items.find(item => item.workspaceId === partial.workspaceId).savedAt, '');
  check('partial-only history cannot manufacture a successful save time');
  const recovered = await content(complete, { action: 'saveArticleWorkspaceNow', operationId: 'save-events:complete-two' });
  assert.equal(recovered.saveStatus, 'complete'); const latest = await nativeAsset(complete.workspaceId);
  assert.ok(Date.parse(latest.content.lastSavedAt) > Date.parse(firstEvent.content.lastSavedAt));
  assert.equal(latest.content.firstRecordedAt, firstEvent.content.firstRecordedAt);
  check('next complete explicit save advances successful time and preserves first recorded completion');
  for (const operationId of ['save-events:gen2-first', 'save-events:gen2-second']) {
    const result = await content(gen2, { action: 'saveArticleWorkspaceNow', operationId });
    assert.equal(result.saveStatus, 'complete'); assert.equal(result.saveEvent.recorded, true);
    const asset = await nativeAsset(gen2.workspaceId); assert.equal(asset.workspaceGeneration, 2); assert.equal(asset.content.workspaceGeneration, 2);
  }
  check('legitimate generation-2 full saves retain ownership across repeated event GET/CAS');
  stage('wrong-owner-and-old-generation-isolation');
  const invalid = ['wrongowner', 'oldgeneration'].map(name => workspace({ name, title: `Save event ${name} fixture`, url: `https://library.invalid/save-events/${name}` }));
  for (const value of invalid) await rpc({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace: value });
  await rpc({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: invalid[0].workspaceId, workspaceGeneration: 1, relativePath: eventPath, content: latest.content });
  await rpc({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: invalid[1].workspaceId, workspaceGeneration: 1, relativePath: eventPath,
    content: { ...latest.content, workspaceId: invalid[1].workspaceId, canonicalUrl: invalid[1].canonicalUrl } });
  await rpc({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace: { ...invalid[1], workspaceGeneration: 2 } });
  const stale = await raw({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: invalid[1].workspaceId, relativePath: eventPath });
  assert.equal(stale.success, false); assert.equal(stale.error.code, 'WORKSPACE_GENERATION_CONFLICT');
  const all = await query(); assert.equal(all.total, 6);
  for (const target of invalid) assert.equal(all.items.find(item => item.workspaceId === target.workspaceId).savedAt, '');
  check('wrong-owner event content and obsolete generation project no savedAt; stale GET fails closed');
  for (const article of articles) await rpc({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: article.workspaceId,
    workspaceGeneration: article.workspace.workspaceGeneration, relativePath: 'annotations/library-tags.json',
    content: { schemaVersion: 1, workspaceId: article.workspaceId, tags: ['合成文献', ...(article === complete ? ['完整保存'] : [])] } });
  stage('real-options-time-and-unknowns');
  page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${origin}/options.html#page=data`);
  const library = page.locator('#localReadingLibrary'); const table = library.locator('.local-library__article-table'); await table.waitFor();
  const expected = (await query()).items;
  for (const item of expected) {
    const row = library.locator(`.local-library__article[data-workspace-id="${item.workspaceId}"]`); await row.waitFor();
    assert.equal(await row.locator('td').nth(3).innerText(), item.savedAt || '未记录');
  }
  assert.deepEqual(await table.locator('thead th').allTextContents(), ['论文标题', '发表日期', '杂志名称', '保存时间']);
  assert.match(await table.locator('thead th').nth(3).getAttribute('title'), /不代表目录同步完成/u);
  check('actual four-column UI distinguishes complete save times from baseline/partial/invalid unknowns');
  await shot('1440-save-time-columns'); await page.setViewportSize({ width: 390, height: 1000 });
  await library.locator('.local-library__article-table-wrap').evaluate(el => { el.scrollLeft = el.scrollWidth; }); await shot('390-save-time');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  check('390px table scroll exposes real timestamps without page overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload(); await table.waitFor();
  assert.equal(await library.locator(`.local-library__article[data-workspace-id="${complete.workspaceId}"] td`).nth(3).innerText(), latest.content.lastSavedAt);
  check('options reload reads persisted exact savedAt from native storage');
  await library.locator('[data-library-tag-choice]').selectOption('完整保存');
  await page.waitForFunction(() => document.querySelectorAll('.local-library__article').length === 1);
  assert.equal(await library.locator('.local-library__article').getAttribute('data-workspace-id'), complete.workspaceId);
  await library.locator('[data-library-scope]').selectOption('notes');
  await library.locator('[data-library-search]').fill('autosave-marker');
  await page.waitForFunction(() => document.querySelector('[data-library-pagination]')?.textContent.includes('共 1 项'));
  await library.getByRole('button', { name: '清除标签筛选', exact: true }).click();
  assert.equal(await library.locator('[data-library-search]').inputValue(), 'autosave-marker');
  assert.equal(await library.locator('[data-library-scope]').inputValue(), 'notes');
  assert.equal(await library.locator('.local-library__article td').nth(3).innerText(), latest.content.lastSavedAt);
  check('existing tag and notes filters retain the saved-time projection and clear independently');
  assert.deepEqual(report.errors, []); check('no page errors');
  for (const file of files) report.endSourceHashes[file] = hash(fs.readFileSync(path.join(root, file)));
  assert.deepEqual(report.endSourceHashes, report.sourceHashes, 'production changed during run: snapshot must be reverified');
  check('all 11 production source hashes remain identical before and after the actual run'); report.status = 'PASS';
} catch (error) { report.failure = String(error.stack || error); console.error(report.failure); if (page && !page.isClosed()) await shot('failure').catch(() => {}); }
finally {
  await context?.close(); report.completedAt = new Date().toISOString(); report.runDirectory = run;
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  fs.writeFileSync(path.join(run, 'report.html'), `<!doctype html><meta charset="utf-8"><title>Save event verification</title><h1>${report.status}</h1><p>${escape(report.boundary)}</p>` + report.checks.map(item => `<p>PASS ${escape(item.name)}</p>`).join('') + report.screenshots.map(file => `<h2>${file}</h2><img src="${file}" style="max-width:100%">`).join(''));
  if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) && /^brevess-save-events-/u.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, report: path.join(run, 'report.json'), failure: report.failure || null })); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
