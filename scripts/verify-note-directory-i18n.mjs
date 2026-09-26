import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-i18n-regression');
fs.mkdirSync(output, { recursive: true });
const run = fs.mkdtempSync(path.join(output, 'run-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-note-directory-i18n-'));
const extension = path.join(temporary, 'extension');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = { status: 'FAIL', startedAt: new Date().toISOString(), checks: [], screenshots: [], errors: [],
  sourceHashes: {}, finalSourceHashes: {},
  boundary: 'Fresh isolated Edge extension profile; real options/popup HTML/CSS/events and i18n observer. Actual language preference changes. Synthetic notes/library rows and controlled native directory replies. Clipboard isolated; Markdown download saved in this evidence run. Network and native-host transports blocked. No model, actual host, picker or personal data.' };
const files = ['core/i18n.js', 'popup.html', 'popup.js', 'options.html', 'options.js', 'options-local-library.js'];
const check = (name, condition = true, detail) => {
  report.checks.push({ name, pass: Boolean(condition), ...(detail ? { detail } : {}) });
  assert.ok(condition, name); console.log(`PASS ${name}`);
};
let context, options, popup, worker;
async function shot(page, name) {
  const cdp = await context.newCDPSession(page);
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(run, `${name}.png`), Buffer.from(result.data, 'base64'));
  await cdp.detach(); report.screenshots.push(`${name}.png`);
}
async function textIs(page, selector, text) {
  await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.trim() === text,
    { selector, text });
}
async function language(value) {
  await options.locator('#globalLanguage').selectOption(value);
  await options.waitForFunction(value => document.documentElement.lang === value &&
    document.getElementById('globalLanguage').value === value, value);
  await options.waitForFunction(async value => {
    const reply = await chrome.runtime.sendMessage({ type: 'LLM_GET_SETTINGS' });
    return reply?.data?.settings?.language === value;
  }, value);
}

try {
  fs.mkdirSync(extension);
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(root, file), path.join(extension, file));
  }
  for (const file of files) {
    report.sourceHashes[file] = sha(path.join(root, file));
    assert.equal(sha(path.join(extension, file)), report.sourceHashes[file]);
  }
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, timeout: 30_000, reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1050 }, acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking']
  });
  context.setDefaultTimeout(12_000); context.setDefaultNavigationTimeout(20_000);
  await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    globalThis.__i18nForbidden = { network: 0, native: 0 };
    globalThis.fetch = async () => { __i18nForbidden.network++; throw Error('NO_NETWORK_I18N_TEST'); };
    chrome.runtime.connectNative = () => { __i18nForbidden.native++; throw Error('NO_NATIVE_I18N_TEST'); };
  });
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  options = await context.newPage();
  options.on('pageerror', error => report.errors.push(`options: ${error.message}`));
  await options.addInitScript(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.i18nDirectoryCalls = []; window.i18nDirectoryDelay = 400;
    window.i18nStatusReply = { success: true, data: { available: true, bound: true, rootName: 'SCI-Highlighter' } };
    window.i18nBindReply = { success: true, data: { bound: true, rootName: 'Brevess' } };
    window.i18nOpenReply = { success: false, error: { code: 'WORKSPACE_DIRECTORY_NOT_SYNCED',
      message: '这篇文献的目录尚未同步完成，请先完成保存与目录同步。', retryable: false } };
    window.i18nForbidden = { native: 0, picker: 0 };
    chrome.runtime.connectNative = () => { i18nForbidden.native++; throw Error('NO_NATIVE_I18N_TEST'); };
    window.showDirectoryPicker = async () => { i18nForbidden.picker++; throw Error('NO_PICKER_I18N_TEST'); };
    const item = { workspaceId: `workspace:${'a'.repeat(64)}`, title: '复制笔记 · Synthetic title',
      url: 'https://example.invalid/i18n', coverage: { notes: true }, tags: [], tagState: 'ready',
      tagRevision: 1, tagContentHash: 'synthetic', workspaceGeneration: 1 };
    chrome.runtime.sendMessage = async (message, ...rest) => {
      const key = { USER_DATA_DIRECTORY_NATIVE_STATUS: 'i18nStatusReply', USER_DATA_DIRECTORY_NATIVE_BIND: 'i18nBindReply',
        LOCAL_READING_LIBRARY_OPEN_DIRECTORY: 'i18nOpenReply' }[message.type];
      if (key) {
        i18nDirectoryCalls.push(structuredClone(message)); const reply = structuredClone(window[key]);
        await new Promise(resolve => setTimeout(resolve, i18nDirectoryDelay)); return reply;
      }
      if (message.type === 'LOCAL_READING_LIBRARY_QUERY') {
        const items = message.kind === 'articles' ? [item] : [];
        return { success: true, data: { items, page: 1, pageCount: 1, total: items.length, matchedCount: items.length,
          matchedCoverage: { notes: items.length }, availableTags: [], totals: { articles: 1, abbreviations: 0, coverage: { notes: 1 } } } };
      }
      return original(message, ...rest);
    };
  });
  await options.goto(`${origin}/options.html#page=storage`);
  await options.locator('#nativeDirectorySettings').waitFor({ state: 'visible' });
  await textIs(options, '#bindNativeDirectory', '绑定本机目录路径');
  await language('en');
  await textIs(options, '#nativeDirectoryHeading', 'Open article folders in File Explorer');
  check('real settings selector saves English and translates directory controls',
    await options.locator('#bindNativeDirectory').innerText() === 'Bind local folder path' &&
    await options.locator('#nativeDirectoryPath').getAttribute('placeholder') === 'For example: D:\\Papers\\Brevess');
  check('new directory helper paragraphs are entirely translated', !/[\u3400-\u9fff]/u.test(await options.locator('#nativeDirectorySettings').innerText()));
  await options.locator('#bindNativeDirectory').click();
  await textIs(options, '#nativeDirectoryStatus', 'Enter the full absolute path of the actual data root. A folder name is not a local path.');
  check('empty-path validation changes language without a native request', await options.evaluate(() => i18nDirectoryCalls.length === 0));
  const draft = 'D:\\用户输入保留\\SCI-Highlighter';
  await options.locator('#nativeDirectoryPath').fill(draft);
  await options.locator('#bindNativeDirectory').click();
  await textIs(options, '#nativeDirectoryStatus', 'Verifying and binding the local folder…');
  check('binding pending message is English and controls are locked', await options.locator('#bindNativeDirectory').isDisabled());
  await textIs(options, '#nativeDirectoryStatus', 'Bound: Brevess. Only synced article folders with verified identity can be opened; binding does not mean an article has been synced.');
  check('binding result translates without changing user path', await options.locator('#nativeDirectoryPath').inputValue() === draft);
  await options.locator('#checkNativeDirectory').click();
  await textIs(options, '#nativeDirectoryStatus', 'Checking the local helper and folder binding…');
  await textIs(options, '#nativeDirectoryStatus', 'Local helper available. Last verified bound folder: SCI-Highlighter.');
  check('dynamic bound status preserves the legacy root name');
  await options.evaluate(() => { i18nStatusReply = { success: true, data: { available: false, bound: false,
    code: 'WORKSPACE_DIRECTORY_HOST_UPDATE_REQUIRED', message: '当前本机助手不支持打开文献目录，请更新本机助手后重试。' } }; });
  await options.locator('#checkNativeDirectory').click();
  await textIs(options, '#nativeDirectoryStatus', 'This local helper does not support opening article folders. Update it and retry. (WORKSPACE_DIRECTORY_HOST_UPDATE_REQUIRED)');
  check('dynamic helper failure translates its message and preserves the code');
  for (const width of [320, 1440]) {
    await options.setViewportSize({ width, height: 1050 });
    await options.locator('#nativeDirectorySettings').scrollIntoViewIfNeeded();
    check(`English directory controls stay within ${width}px viewport`, await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await shot(options, `${width}-directory-en`);
  }
  await options.locator('#settingsMobilePage').selectOption('data').catch(async () => {
    await options.locator('.settings-sidebar [data-settings-nav="data"]').click();
  });
  const open = options.locator('[data-library-open-directory]').first(); await open.waitFor({ state: 'visible' });
  check('dynamic library folder button has English label, tooltip and literal title',
    await open.innerText() === 'Open folder' &&
    await open.getAttribute('aria-label') === 'Open folder for 复制笔记 · Synthetic title' &&
    await open.getAttribute('title') === 'Use the local helper to open a synced article folder with verified identity');
  await open.click();
  await textIs(options, '[data-library-directory-status]', 'Verifying the article folder for “复制笔记 · Synthetic title”…');
  await textIs(options, '[data-library-directory-status]', '“复制笔记 · Synthetic title”: This article folder has not finished syncing. Finish saving and syncing it first. (WORKSPACE_DIRECTORY_NOT_SYNCED)');
  check('library failure observer translates new result text but preserves the article title');
  await shot(options, 'library-directory-failure-en');

  popup = await context.newPage(); popup.on('pageerror', error => report.errors.push(`popup: ${error.message}`));
  await popup.setViewportSize({ width: 360, height: 844 });
  await popup.goto(`${origin}/popup.html`); await popup.waitForFunction(() => panelUiReady === true);
  await popup.evaluate(() => synchronizeActiveTabContext());
  await popup.evaluate(async () => {
    activePanelTabContext.activated = true;
    document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
    capturePanelContext = () => ({ tabId: 4 }); isCurrentPanelContext = () => true;
    queryPanelTargetTab = async () => ({ id: 4 });
    literatureNoteWorkspaceTarget = () => null;
    literatureNoteDocumentKey = () => 'i18n-synthetic-note';
    currentWorkspaceSnapshot = { documentHash: 'a'.repeat(64), title: 'Synthetic i18n article' };
    const template = { id: 'i18n_fixture', name: '用户模板保持中文', studyFamily: 'custom',
      fields: [{ id: 'observation', label: '用户字段保持中文' }] };
    llmSettingsState = { ...llmSettingsState, settings: { ...llmSettingsState.settings, literatureNoteTemplates: [template] } };
    await chrome.storage.local.set({ [LITERATURE_NOTE_STORAGE_KEY]: { entries: { 'i18n-synthetic-note': {
      schemaVersion: 3, templateId: 'i18n_fixture', valuesByTemplate: { i18n_fixture: { observation: '用户笔记正文及原始引文' } },
      fieldStatusByTemplate: {}, fieldEvidenceByTemplate: {}, fieldUpdatedAtByTemplate: {}, updatedAt: 10
    } } } });
    literatureNoteDocumentState = null; await loadLiteratureNoteDocumentState(); renderLiteratureNoteDrawer();
    switchWorkspaceView('notes', { persist: false, loadNotes: false });
    window.i18nCopiedNote = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { i18nCopiedNote = text; } } });
  });
  await textIs(popup, '#copyLiteratureNote', 'Copy notes');
  check('new popup bootstraps saved English and translates copy/export accessible group',
    await popup.locator('#exportLiteratureNoteMarkdown').innerText() === 'Export Markdown' &&
    await popup.locator('.literature-note-export-actions').getAttribute('aria-label') === 'Copy and export notes');
  await popup.locator('#copyLiteratureNote').click();
  await textIs(popup, '#statusMessage', 'Copied the current template notes with their source status.');
  await textIs(popup, '#sidePanelNotificationLatest', 'Copied the current template notes with their source status.');
  check('copy success also translates normalized notification text and tooltip',
    await popup.locator('#sidePanelNotificationLatest').getAttribute('title') === 'Copied the current template notes with their source status.');
  check('copy success localizes only chrome, preserving Chinese note text',
    (await popup.evaluate(() => i18nCopiedNote)).includes('用户笔记正文及原始引文'));
  const downloadPromise = popup.waitForEvent('download'); await popup.locator('#exportLiteratureNoteMarkdown').click();
  const download = await downloadPromise; const downloaded = path.join(run, 'synthetic-note.md'); await download.saveAs(downloaded);
  await textIs(popup, '#statusMessage', 'Markdown file created; colors use the note format markers.');
  await textIs(popup, '#sidePanelNotificationLatest', 'Markdown file created; colors use the note format markers.');
  check('export success notification translates after punctuation normalization',
    await popup.locator('#sidePanelNotificationLatest').getAttribute('title') === 'Markdown file created; colors use the note format markers.');
  check('real Markdown download retains user note while export result is English', fs.readFileSync(downloaded, 'utf8').includes('用户笔记正文及原始引文'));
  await popup.evaluate(() => { navigator.clipboard.writeText = async () => { throw Error('isolated clipboard denied'); }; });
  await popup.locator('#copyLiteratureNote').click(); await textIs(popup, '#statusMessage', 'Copy failed: isolated clipboard denied');
  await textIs(popup, '#sidePanelNotificationLatest', 'Copy failed: isolated clipboard denied');
  check('copy failure notification translates text and tooltip',
    await popup.locator('#sidePanelNotificationLatest').getAttribute('title') === 'Copy failed: isolated clipboard denied');
  check('copy failure is translated and the note remains unchanged', await popup.locator('#literatureNoteFields textarea').inputValue() === '用户笔记正文及原始引文');
  await shot(popup, '360-note-controls-en');
  await language('zh-CN');
  await popup.evaluate(() => SciLLM.bootstrapInterfaceLanguage());
  await textIs(popup, '#copyLiteratureNote', '复制笔记');
  check('actual language preference round-trip restores Chinese control and accessible label',
    await popup.locator('.literature-note-export-actions').getAttribute('aria-label') === '笔记复制与导出' &&
    await options.locator('#nativeDirectoryPath').getAttribute('placeholder') === '例如 D:\\论文资料\\Brevess');
  await shot(popup, '360-note-controls-zh');
  await language('en'); await popup.evaluate(() => SciLLM.bootstrapInterfaceLanguage());
  await textIs(popup, '#copyLiteratureNote', 'Copy notes');
  check('second English switch retains exact note and user directory draft',
    await popup.locator('#literatureNoteFields textarea').inputValue() === '用户笔记正文及原始引文' &&
    await options.locator('#nativeDirectoryPath').inputValue() === draft);
  const forbidden = await worker.evaluate(() => __i18nForbidden);
  const pageForbidden = await options.evaluate(() => i18nForbidden);
  check('no real model/network/native-host/picker calls or page errors',
    forbidden.network === 0 && forbidden.native === 0 && pageForbidden.native === 0 && pageForbidden.picker === 0 && report.errors.length === 0,
    { forbidden, pageForbidden, errors: report.errors });
  report.status = 'PASS';
} catch (error) {
  report.error = String(error.stack || error); console.error(report.error);
  const page = popup || options;
  if (page && !page.isClosed()) await shot(page, 'failure').catch(() => {});
} finally {
  await context?.close();
  for (const file of files) report.finalSourceHashes[file] = sha(path.join(root, file));
  if (report.sourceHashes['core/i18n.js'] && report.sourceHashes['core/i18n.js'] !== report.finalSourceHashes['core/i18n.js']) {
    report.status = 'FAIL'; report.sourceChanged = true;
  }
  report.finishedAt = new Date().toISOString(); report.temporary = temporary;
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`EVIDENCE ${run}`); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
