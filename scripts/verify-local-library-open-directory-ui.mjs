// UI contract acceptance only. Native RPC replies are controlled substitutes;
// this never launches Explorer, binds a real root, or opens a directory picker.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-lib010-open-directory');
const run = path.join(output, `run-${Date.now()}`); fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-directory-ui-'));
const extension = path.join(temporary, 'extension');
const report = { status: 'FAIL', checks: [], screenshots: [], errors: [], hashes: {}, realApiCalls: 0,
  boundary: 'Real options DOM/CSS/events; 13 synthetic article query rows and controlled native STATUS/BIND/OPEN responses. No actual OS folder opened, no real directory bound, no picker, no personal profile/network.' };
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); assert.ok(pass, name); console.log(`PASS ${name}`); };
let context, page, worker;
const shot = async name => { const cdp = await context.newCDPSession(page); const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }); fs.writeFileSync(path.join(run, `${name}.png`), Buffer.from(result.data, 'base64')); await cdp.detach(); report.screenshots.push(`${name}.png`); };
const waitStatus = async (selector, text) => page.locator(selector).filter({ hasText: text }).waitFor();
try {
  fs.mkdirSync(extension);
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  for (const name of fs.readdirSync(root)) if (/\.(js|mjs|html|css)$/.test(name) || name === 'manifest.json') fs.copyFileSync(path.join(root, name), path.join(extension, name));
  for (const file of ['options-local-library.js', 'options-local-library.css', 'options.js', 'options.html', 'background.js']) report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, file))).digest('hex');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true,
    viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking'] });
  await context.route(/^https?:\/\//, route => route.abort());
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw new Error('NO_NETWORK_UI_TEST'); }; });
  page = await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.directoryCalls = []; window.pickerCalls = 0; window.nativeDelay = 0;
    window.openReply = { success: true, data: { opened: true } };
    window.bindReply = { success: true, data: { bound: true, rootName: '论文资料' } };
    window.statusReply = { success: true, data: { available: true, bound: false, rootName: '' } };
    window.showDirectoryPicker = async () => { window.pickerCalls++; throw new Error('Unexpected directory picker'); };
    const articles = Array.from({ length: 13 }, (_, i) => ({ workspaceId: 'workspace:' + String(i).padStart(64, '0'), title: `文献 ${i + 1} · Long scientific title`, url: `https://example.invalid/article/${i}`,
      coverage: { notes: true }, tags: ['应激', '免疫'], tagState: 'ready', tagRevision: 1, tagContentHash: 'fixture', workspaceGeneration: 1 }));
    chrome.runtime.sendMessage = async (message, ...rest) => {
      const native = { LOCAL_READING_LIBRARY_OPEN_DIRECTORY: 'openReply', USER_DATA_DIRECTORY_NATIVE_BIND: 'bindReply', USER_DATA_DIRECTORY_NATIVE_STATUS: 'statusReply' }[message.type];
      if (native) { directoryCalls.push(structuredClone(message)); const reply = structuredClone(window[native]); if (nativeDelay) await new Promise(resolve => setTimeout(resolve, nativeDelay)); return reply; }
      if (message.type === 'LOCAL_READING_LIBRARY_QUERY') {
        const items = message.kind === 'articles' ? articles.filter(a => !message.query || a.title.includes(message.query)) : [];
        const pageCount = Math.max(1, Math.ceil(items.length / message.pageSize)), page = Math.min(pageCount, Math.max(1, message.page));
        return { success: true, data: { items: items.slice((page - 1) * message.pageSize, page * message.pageSize), page, pageCount, total: items.length, matchedCount: items.length,
          matchedCoverage: { notes: items.length }, availableTags: ['应激', '免疫'], totals: { articles: 13, abbreviations: 0, coverage: { notes: 13 } } } };
      }
      return original(message, ...rest);
    };
  });
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#page=data`);
  const library = page.locator('#localReadingLibrary'); await library.locator('.local-library__article').first().waitFor();
  check('every article has an independent open-folder button', await library.locator('[data-library-open-directory]').count() === 12);
  check('page load does not invoke native directory operations', await page.evaluate(() => directoryCalls.length === 0));
  const open = () => library.locator('[data-library-open-directory]').first();
  const notice = library.locator('[data-library-directory-notice]');
  const status = library.locator('[data-library-directory-status]');
  await page.evaluate(() => { nativeDelay = 800; });
  await open().click(); await library.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForTimeout(100);
  check('pending open remains disabled after list rerender', await open().isDisabled());
  await waitStatus('[data-library-directory-status]', '已请求系统打开');
  check('open sends only workspace ID and never path/URL/picker', await page.evaluate(() => directoryCalls.length === 1 && JSON.stringify(Object.keys(directoryCalls[0]).sort()) === JSON.stringify(['type', 'workspaceId']) && pickerCalls === 0));
  check('success re-enables button and keeps article identity in notice', !await open().isDisabled() && (await status.innerText()).includes('文献 1'));
  await page.evaluate(() => { nativeDelay = 0; });
  const failures = [
    ['WORKSPACE_DIRECTORY_UNCONFIGURED', '尚未选择保存目录，请前往本地保存设置。'],
    ['WORKSPACE_DIRECTORY_NOT_BOUND', '当前保存目录尚未绑定本机路径。'],
    ['WORKSPACE_DIRECTORY_NOT_SYNCED', '这篇文献尚未同步到目录，请先完成同步。'],
    ['WORKSPACE_DIRECTORY_PERMISSION_REQUIRED', '保存目录权限不足，请重新授权。'],
    ['WORKSPACE_DIRECTORY_HOST_UNAVAILABLE', '无法连接本机助手，请安装或更新本机助手。'],
    ['WORKSPACE_DIRECTORY_HOST_UPDATE_REQUIRED', '本机助手版本过旧，请更新后重试。'],
    ['WORKSPACE_DIRECTORY_ROOT_MISMATCH', '绑定路径与当前保存目录不匹配，请重新绑定。'],
    ['WORKSPACE_DIRECTORY_MISSING', '文献目录不存在或已经移动。'],
    ['WORKSPACE_DIRECTORY_OPEN_FAILED', '系统打开失败，请检查文件管理器后重试。'],
    ['WORKSPACE_DIRECTORY_TIMEOUT', '未获系统打开确认，请先查看文件管理器，避免盲目重试。'],
    ['UNTRUSTED', '<img src=x onerror=alert(1)> 原样错误内容']
  ];
  for (const [code, message] of failures) {
    await page.evaluate(({ code, message }) => { openReply = { success: false, error: { code, message, retryable: true } }; }, { code, message });
    await open().click(); await waitStatus('[data-library-directory-status]', message);
    check(`${code}: accurate failure and actionable settings entry`, (await status.innerText()).includes(message) && !/已请求系统打开|已打开/.test(await status.innerText()) && await library.locator('[data-library-directory-settings]').isVisible() && !await open().isDisabled());
  }
  check('untrusted backend text creates no HTML', await notice.locator('img,script').count() === 0);
  await library.locator('[data-library-directory-settings]').click();
  const panel = page.locator('#nativeDirectorySettings'), input = page.locator('#nativeDirectoryPath'), bind = page.locator('#bindNativeDirectory');
  check('settings entry navigates to real storage panel without launching picker', await panel.isVisible() && await page.evaluate(() => document.body.dataset.activeSettingsPage === 'storage' && pickerCalls === 0));
  check('native status remains explicitly user-triggered', await page.evaluate(() => directoryCalls.every(call => call.type === 'LOCAL_READING_LIBRARY_OPEN_DIRECTORY')));
  await bind.click(); check('empty path makes no bind call', await page.evaluate(() => !directoryCalls.some(call => call.type === 'USER_DATA_DIRECTORY_NATIVE_BIND')));
  const absolutePath = 'D:\\本机合成目录\\论文 资料'; await input.fill(absolutePath);
  await page.evaluate(() => { nativeDelay = 600; bindReply = { success: false, error: { code: 'DIRECTORY_ROOT_MISMATCH', message: '输入路径与所选目录不同，未绑定。', retryable: false } }; });
  await bind.click(); check('binding disables input and duplicate actions', await bind.isDisabled() && await input.isDisabled() && await page.locator('#checkNativeDirectory').isDisabled());
  await waitStatus('#nativeDirectoryStatus', '输入路径与所选目录不同');
  check('binding failure preserves exact path and never claims success', await input.inputValue() === absolutePath && !(await page.locator('#nativeDirectoryStatus').innerText()).includes('绑定成功'));
  await page.evaluate(() => { nativeDelay = 0; bindReply = { success: true, data: { bound: true, rootName: '<b>论文资料</b>' } }; });
  await bind.click(); await waitStatus('#nativeDirectoryStatus', '绑定成功');
  check('binding sends explicit path unchanged and displays basename only as text', await page.evaluate(expected => directoryCalls.findLast(c => c.type === 'USER_DATA_DIRECTORY_NATIVE_BIND').absolutePath === expected, absolutePath) && await page.locator('#nativeDirectoryStatus b').count() === 0 && await input.inputValue() === absolutePath);
  for (const [code, message] of [
    ['WORKSPACE_DIRECTORY_HOST_UNAVAILABLE', '无法连接本机助手，请确认已安装。'],
    ['WORKSPACE_DIRECTORY_HOST_UPDATE_REQUIRED', '本机助手版本过旧，请更新后重试。']
  ]) {
    await page.evaluate(({ code, message }) => { statusReply = { success: true, data: { available: false, bound: false, rootName: '', code, message } }; }, { code, message });
    await page.locator('#checkNativeDirectory').click(); await waitStatus('#nativeDirectoryStatus', message);
    check(`${code}: status preserves backend guidance without claiming availability`, (await page.locator('#nativeDirectoryStatus').innerText()).includes(code) && await page.locator('#nativeDirectoryStatus').getAttribute('data-state') !== 'success' && await input.inputValue() === absolutePath);
  }
  await page.evaluate(() => { statusReply = { success: false, error: { code: 'WORKSPACE_DIRECTORY_TIMEOUT', message: '助手状态查询超时。', retryable: true } }; });
  const beforeTimeout = await page.evaluate(() => directoryCalls.length);
  await page.locator('#checkNativeDirectory').click(); await waitStatus('#nativeDirectoryStatus', '助手状态查询超时'); await page.waitForTimeout(300);
  check('status timeout has no automatic retry and leaves controls usable', await page.evaluate(before => directoryCalls.length === before + 1, beforeTimeout) && !await bind.isDisabled() && !await input.isDisabled());
  await page.evaluate(() => { statusReply = { success: true, data: { available: true, bound: true, rootName: 'Brevess' } }; });
  await page.locator('#checkNativeDirectory').click(); await waitStatus('#nativeDirectoryStatus', 'Brevess');
  check('status check cannot replace draft with basename', await input.inputValue() === absolutePath);
  for (const width of [320, 720, 1440]) {
    await page.setViewportSize({ width, height: 1050 }); await input.focus(); await input.press('Tab'); await page.keyboard.press('Shift+Tab');
    await panel.evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - (document.querySelector('.topbar')?.getBoundingClientRect().height || 0) - 12)); await page.waitForTimeout(150);
    check(`${width}: binding controls bounded and keyboard focus visible`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && await input.evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none'));
    await shot(`${width}-binding`);
  }
  await worker.evaluate(async () => { const t = (await chrome.tabs.query({})).find(t => t.url?.includes('options.html')); await chrome.tabs.setZoom(t.id, 2); });
  await page.waitForFunction(() => innerWidth <= 720); await input.focus();
  check('200% actual browser zoom retains bounded binding UI', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await shot('200-percent-binding');
  await worker.evaluate(async () => { const t = (await chrome.tabs.query({})).find(t => t.url?.includes('options.html')); await chrome.tabs.setZoom(t.id, 1); });
  await page.locator('.settings-sidebar [data-settings-nav="data"]').click();
  for (const width of [320, 720, 1440]) {
    await page.setViewportSize({ width, height: 1050 }); await notice.scrollIntoViewIfNeeded(); await shot(`${width}-library-failure`);
    check(`${width}: library has four columns and no page overflow`, await library.locator('.local-library__article-table thead th').count() === 4 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await page.setViewportSize({ width: 320, height: 1050 }); await open().focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  await library.locator('.local-library__article-table').evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - (document.querySelector('.topbar')?.getBoundingClientRect().height || 0) - 12));
  await shot('320-library-row-actions');
  check('320: folder action stays visible and keyboard focus is discernible', await open().isVisible() && await open().evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none'));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await worker.evaluate(async () => { const t = (await chrome.tabs.query({})).find(t => t.url?.includes('options.html')); await chrome.tabs.setZoom(t.id, 2); });
  await page.waitForFunction(() => innerWidth <= 720); await open().focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); await shot('200-percent-library-row-actions');
  check('200%: folder row actions remain bounded', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await worker.evaluate(async () => { const t = (await chrome.tabs.query({})).find(t => t.url?.includes('options.html')); await chrome.tabs.setZoom(t.id, 1); });
  await library.getByRole('button', { name: '下一页', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('[data-library-open-directory]').length === 1);
  check('last page retains correct row folder action', (await library.locator('.local-library__article h4').innerText()).includes('文献 13'));
  await library.locator('[data-library-kind="abbreviations"]').click();
  check('glossary does not acquire folder buttons', await library.locator('[data-library-open-directory]').count() === 0);
  check('no picker or page errors', await page.evaluate(() => pickerCalls === 0) && report.errors.length === 0, report.errors);
  report.status = 'PASS';
} catch (error) { report.error = String(error.stack || error); console.error(report.error); if (page && !page.isClosed()) await shot('failure').catch(() => {}); }
finally {
  await context?.close();
  if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) && /^brevess-directory-ui-/.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  fs.writeFileSync(path.join(run, 'report.html'), `<!doctype html><meta charset="utf-8"><h1>LIB010 打开目录 UI ${report.status}</h1><p>${esc(report.boundary)}</p>` + report.checks.map(c => `<p>${c.pass ? 'PASS' : 'FAIL'} ${esc(c.name)}</p>`).join('') + report.screenshots.map(s => `<h2>${s}</h2><img src="${s}" style="max-width:100%">`).join(''));
  console.log(`EVIDENCE ${run}`); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
