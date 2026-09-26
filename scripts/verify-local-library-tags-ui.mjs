// LIB010: isolated real extension, production query/storage; only explicit transport-failure injection is synthetic.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-lib010-tags');
const run = path.join(output, `run-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-tags-ui-'));
const extension = path.join(temporary, 'extension');
const report = { status: 'FAIL', checks: [], screenshots: [], errors: [], hashes: {}, realModelCalls: 0,
  boundary: 'Isolated production options + RPC/store, 15 synthetic workspaces. No personal data or external network; synthetic failure is limited to one SAVE transport response.' };
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); assert.ok(pass, name); console.log(`PASS ${name}`); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const assetPath = 'annotations/library-tags.json';
let context, page, worker;
const rpc = async message => { const r = await page.evaluate(m => chrome.runtime.sendMessage(m), message); assert.equal(r?.success, true, JSON.stringify(r)); return r.data; };
const shot = async name => { const cdp = await context.newCDPSession(page); const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }); fs.writeFileSync(path.join(run, `${name}.png`), Buffer.from(image.data, 'base64')); await cdp.detach(); report.screenshots.push(`${name}.png`); };
const ids = Array.from({ length: 15 }, (_, i) => `workspace:${hash(`https://library.invalid/tags/${i}`)}`);
try {
  fs.mkdirSync(extension);
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  for (const file of fs.readdirSync(root)) if (/\.(js|mjs|html|css)$/.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(root, file), path.join(extension, file));
  for (const file of ['options-local-library.js', 'options-local-library.css', 'options.html', 'background.js', 'core/local-library-tags.js', 'core/local-reading-library.js', 'core/article-workspace-store.js']) report.hashes[file] = hash(fs.readFileSync(path.join(extension, file)));
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true,
    viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking'] });
  await context.route(/^https?:\/\//, route => route.abort());
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw new Error('LIB010_NO_NETWORK'); }; });
  page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(() => {
    window.tagUiCalls = [];
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (...args) => {
      tagUiCalls.push(structuredClone(args[0]));
      if (window.failNextTagSave && args[0]?.type === 'ARTICLE_WORKSPACE_SAVE_ASSET') {
        window.failNextTagSave = false;
        return { success: false, error: { code: 'TEST_SAVE_FAILURE', message: 'isolated transport failure' } };
      }
      const response = await original(...args);
      if (window.delayNextTagRead && args[0]?.type === 'ARTICLE_WORKSPACE_GET_ASSET') {
        window.delayNextTagRead = false; await new Promise(resolve => setTimeout(resolve, 500));
      }
      return response;
    };
  });
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#page=data`);
  for (let i = 0; i < ids.length; i++) {
    await rpc({ type: 'ARTICLE_WORKSPACE_ENSURE', workspace: { schemaVersion: 1, workspaceId: ids[i], canonicalUrl: `https://library.invalid/tags/${i}`,
      aliases: [], title: `Tag article ${String(i).padStart(2, '0')}`, directoryName: `Tag-article-${i}--${ids[i].slice(10, 26)}`, revision: hash('fixture'), contentHash: hash('fixture'), workspaceGeneration: 1 } });
    await rpc({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: ids[i], workspaceGeneration: 1, relativePath: 'annotations/literature-note.json',
      content: { schemaVersion: 1, valuesByTemplate: { summary: i % 2 === 0 ? 'even-marker' : 'odd-marker' } } });
    if (i !== 0) await rpc({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: ids[i], workspaceGeneration: 1, relativePath: assetPath,
      content: i === 14 ? { invalid: true } : { schemaVersion: 1, workspaceId: ids[i], tags: ['共同', ...(i % 2 === 0 ? ['偶数'] : []), ...(i === 13 ? ['末页标签'] : [])] } });
  }
  await page.reload();
  const library = page.locator('#localReadingLibrary');
  await library.locator('.local-library__article').first().waitFor();
  check('row tag editing and full-library filter are present', await library.locator('[data-library-edit-tags]').count() > 0 && await library.locator('[data-library-tag-filter]').count() === 1);
  const search = library.locator('[data-library-search]');
  const editor = library.locator('[data-library-tag-editor]');
  const input = editor.locator('[data-tag-input]');
  const status = editor.locator('[data-tag-status]');
  const row = id => library.locator(`.local-library__article[data-workspace-id="${id}"]`);
  const findArticle = async i => { await search.fill(`Tag article ${String(i).padStart(2, '0')}`); await row(ids[i]).waitFor(); };
  const add = async value => { await input.fill(value); await input.press('Enter'); };
  await findArticle(0); await row(ids[0]).locator('[data-library-edit-tags]').click(); await input.waitFor(); await input.fill('手工草稿');
  await library.getByRole('button', { name: '刷新', exact: true }).click();
  await library.locator('[data-library-kind="abbreviations"]').click();
  check('draft panel survives tab switch; tag filters are hidden on glossary', await input.inputValue() === '手工草稿' && await editor.isVisible() && !await library.locator('[data-library-tag-filter]').isVisible());
  await library.locator('[data-library-kind="articles"]').click(); await row(ids[0]).waitFor();
  await input.press('Enter'); await add(' e\u0301 '); await add('é'); await add('μM'); await add('µM');
  check('NFC duplicate collapses but scientific compatibility chars remain distinct', await editor.locator('[data-tag-remove]').count() === 4);
  await editor.getByRole('button', { name: '保存标签', exact: true }).click();
  await status.filter({ hasText: '已保存到本机' }).waitFor();
  const saved = await rpc({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: ids[0], relativePath: assetPath });
  check('UI saves new asset in real store with exact tags', JSON.stringify(saved.asset.content.tags) === JSON.stringify(['手工草稿', 'é', 'μM', 'µM']));
  check('directory not persisted is explicitly distinguished', (await status.innerText()).includes('目录') && !(await status.innerText()).includes('已同步到目录'));
  await add('未保存'); await search.fill('Tag article 01'); await row(ids[1]).waitFor(); await row(ids[1]).locator('[data-library-edit-tags]').click();
  check('opening another row cannot replace dirty editor', (await editor.innerText()).includes('Tag article 00') && (await editor.innerText()).includes('未保存'));
  await editor.locator('[data-tag-remove="未保存"]').click();
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await search.fill(''); await library.locator('.local-library__article').nth(1).waitFor();
  const filter = library.locator('[data-library-tag-choice]');
  check('filter choices include tags beyond current page', (await filter.locator('option').allTextContents()).includes('末页标签'));
  await filter.selectOption('共同'); await filter.selectOption('偶数');
  await library.locator('[data-library-tag-mode]').selectOption('all');
  await page.waitForFunction(() => document.querySelector('[data-library-pagination]').textContent.includes('共 6 项'));
  check('all-tag intersection is computed before paging', await library.locator('.local-library__article').count() === 6);
  await library.locator('[data-library-tag-mode]').selectOption('any');
  await page.waitForFunction(() => document.querySelector('[data-library-pagination]').textContent.includes('共 13 项'));
  check('any-tag union retains full matched count', await library.locator('.local-library__article').count() === 12);
  await library.getByRole('button', { name: '下一页', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.local-library__article').length === 1);
  await library.locator('[data-library-scope]').selectOption('notes'); await search.fill('even-marker');
  await page.waitForFunction(() => document.querySelector('[data-library-pagination]').textContent.includes('共 6 项'));
  check('combined scope/keyword/tag resets page and reports matched coverage', (await library.locator('[data-library-status]').innerText()).includes('6 / 6') && (await library.locator('[data-library-pagination]').innerText()).includes('第 1 /'));
  await library.getByRole('button', { name: '清除标签筛选', exact: true }).click();
  check('clearing tag filters leaves keyword and scope untouched', await search.inputValue() === 'even-marker' && await library.locator('[data-library-scope]').inputValue() === 'notes');
  await library.locator('[data-library-scope]').selectOption('all'); await findArticle(1);
  await row(ids[1]).locator('[data-library-edit-tags]').click(); await input.waitFor(); await add('我的冲突草稿');
  const original = await rpc({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: ids[1], relativePath: assetPath });
  await rpc({ type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId: ids[1], workspaceGeneration: 1, relativePath: assetPath,
    expectedRevision: original.asset.revision, expectedContentHash: original.asset.contentHash, content: { schemaVersion: 1, workspaceId: ids[1], tags: ['另一页面'] } });
  await editor.getByRole('button', { name: '保存标签', exact: true }).click(); await status.filter({ hasText: '冲突' }).waitFor();
  check('real CAS conflict preserves draft and blocks blind retry', (await editor.innerText()).includes('我的冲突草稿') && await editor.getByRole('button', { name: '保存标签', exact: true }).isDisabled());
  await editor.getByRole('button', { name: '读取最新标签', exact: true }).click();
  await editor.getByRole('button', { name: '采用最新标签，重新编辑', exact: true }).waitFor();
  check('reading latest does not silently replace draft', (await editor.innerText()).includes('我的冲突草稿'));
  await editor.getByRole('button', { name: '采用最新标签，重新编辑', exact: true }).click();
  check('explicit re-edit keeps old draft copy visible', (await editor.locator('[data-tag-backup]').inputValue()).includes('我的冲突草稿'));
  await add('合并后'); await editor.getByRole('button', { name: '保存标签', exact: true }).click(); await status.filter({ hasText: '已保存到本机' }).waitFor();
  check('explicit re-edit saves against fresh CAS', JSON.stringify((await rpc({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: ids[1], relativePath: assetPath })).asset.content.tags) === JSON.stringify(['另一页面', '合并后']));
  for (const width of [320, 720, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await input.focus();
    await editor.evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - (document.querySelector('.topbar')?.getBoundingClientRect().height || 0) - 12));
    await page.waitForTimeout(150);
    check(`${width} tag panel has no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await shot(`${width}-editor`);
  }
  await worker.evaluate(async () => { const tab = (await chrome.tabs.query({})).find(t => t.url?.includes('options.html')); await chrome.tabs.setZoom(tab.id, 2); });
  await page.waitForFunction(() => innerWidth <= 720); await input.focus(); await shot('200-percent-editor');
  check('200% browser zoom keeps input and page bounded', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await worker.evaluate(async () => { const tab = (await chrome.tabs.query({})).find(t => t.url?.includes('options.html')); await chrome.tabs.setZoom(tab.id, 1); });
  await editor.getByRole('button', { name: '关闭', exact: true }).click(); await findArticle(14);
  await row(ids[14]).locator('[data-library-edit-tags]').click(); await status.filter({ hasText: '无法校验' }).waitFor();
  check('invalid stored asset cannot be blindly overwritten', await editor.getByRole('button', { name: '保存标签', exact: true }).isDisabled());
  await shot('invalid-asset');
  await page.reload(); await findArticle(1); await row(ids[1]).locator('[data-library-edit-tags]').click(); await input.waitFor();
  check('reopened page reads tags from production persistent store', await editor.locator('[data-tag-remove="合并后"]').count() === 1);
  await add('失败草稿'); await input.fill('未提交输入');
  await page.evaluate(() => { window.failNextTagSave = true; });
  await editor.getByRole('button', { name: '保存标签', exact: true }).click(); await status.filter({ hasText: '保存未确认' }).waitFor();
  check('synthetic save failure preserves committed and pending draft tags', await editor.locator('[data-tag-remove="失败草稿"]').count() === 1 && await editor.locator('[data-tag-remove="未提交输入"]').count() === 1);
  check('failed save did not claim persistence or mutate real asset', !(await status.innerText()).includes('已保存到本机') && JSON.stringify((await rpc({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: ids[1], relativePath: assetPath })).asset.content.tags) === JSON.stringify(['另一页面', '合并后']));
  await shot('save-failure-draft');
  await editor.getByRole('button', { name: '读取最新标签', exact: true }).click();
  await editor.getByRole('button', { name: '采用最新标签，重新编辑', exact: true }).click();
  await editor.locator('[data-tag-remove="另一页面"]').click(); await editor.locator('[data-tag-remove="合并后"]').click();
  await editor.getByRole('button', { name: '保存标签', exact: true }).click(); await status.filter({ hasText: '已保存到本机' }).waitFor();
  check('removing final tags persists intentional empty asset', (await rpc({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: ids[1], relativePath: assetPath })).asset.content.tags.length === 0);
  check('per-document removal cannot remove other documents tags', (await rpc({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: ids[2], relativePath: assetPath })).asset.content.tags.includes('共同'));
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => { window.delayNextTagRead = true; });
  await row(ids[1]).locator('[data-library-edit-tags]').click(); await search.focus();
  await status.filter({ hasText: '已读取本机标签' }).waitFor();
  check('late tag read never steals focus moved to search', await search.evaluate(el => el === document.activeElement));
  await input.fill('a'.repeat(81)); await input.press('Enter');
  check('invalid long tag remains editable and unsaved', (await status.innerText()).includes('标签无效') && (await input.inputValue()).length === 81 && await editor.locator('[data-tag-remove]').count() === 0);
  await input.fill('未保存输入'); await input.press('Tab'); await page.keyboard.press('Shift+Tab');
  check('tag input has visible keyboard focus', await input.evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none'));
  await library.getByRole('button', { name: '刷新', exact: true }).click(); await input.focus(); await page.waitForTimeout(250);
  check('list refresh retains pending input and focused node', await input.inputValue() === '未保存输入' && await input.evaluate(el => el === document.activeElement));
  await library.locator('[data-library-kind="abbreviations"]').click(); await page.waitForTimeout(250);
  check('glossary query does not receive article tag conditions', await page.evaluate(() => { const call = tagUiCalls.findLast(m => m.type === 'LOCAL_READING_LIBRARY_QUERY' && m.kind === 'abbreviations'); return call && !('tags' in call) && !('tagMode' in call); }));
  await library.locator('[data-library-kind="articles"]').click(); await row(ids[1]).waitFor(); await input.fill('');
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await filter.selectOption('共同'); await filter.selectOption('手工草稿'); await library.locator('[data-library-tag-mode]').selectOption('all');
  await library.locator('.local-library__empty').waitFor();
  check('combined keyword/tag empty state is explicit', (await library.locator('.local-library__empty').innerText()).includes('关键词'));
  await search.fill(''); await page.waitForTimeout(250);
  check('tag-only empty state is distinct from empty library', (await library.locator('.local-library__empty').innerText()).includes('标签条件'));
  await shot('tag-filter-empty');
  await library.getByRole('button', { name: '清除标签筛选', exact: true }).click(); await search.fill('not-a-real-match'); await page.waitForTimeout(250);
  check('keyword-only empty state remains distinct', (await library.locator('.local-library__empty').innerText()).includes('关键词'));
  check('no page errors', report.errors.length === 0, report.errors);
  report.status = 'PASS';
} catch (error) { report.error = String(error.stack || error); console.error(report.error); if (page && !page.isClosed()) await shot('failure').catch(() => {}); }
finally {
  await context?.close();
  if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) && /^brevess-tags-ui-/.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  fs.writeFileSync(path.join(run, 'report.html'), `<!doctype html><meta charset="utf-8"><h1>LIB010 标签 ${report.status}</h1><p>${escape(report.boundary)}</p>` + report.checks.map(c => `<p>${c.pass ? 'PASS' : 'FAIL'} ${escape(c.name)}</p>`).join('') + report.screenshots.map(s => `<h2>${s}</h2><img src="${s}" style="max-width:100%">`).join(''));
  console.log(`EVIDENCE ${run}`); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
