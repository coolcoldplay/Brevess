// Actual extension UI and browser-local note persistence. Only the model response,
// page binding and clipboard are controlled substitutes; no personal archive/API.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const resourceDirectories = ['core', 'providers', 'vendor', 'icons', '_locales'];
// Only runtime resources may come from a package; dependencies and evidence stay in root.
function resolveExtensionSourceRoot() {
  const configured = process.env.SCI_EXTENSION_ROOT;
  try {
    if (configured !== undefined && !configured.trim()) throw Error('SCI_EXTENSION_ROOT is empty');
    const selected = fs.realpathSync(path.resolve(configured ?? root));
    for (const dir of resourceDirectories) if (!fs.statSync(path.join(selected, dir)).isDirectory()) throw Error('Missing runtime directory: ' + dir);
    for (const file of ['manifest.json', 'background.js', 'popup.html', 'popup.js', 'popup.css', 'ui-swiss.css', 'content.js', 'content.css']) {
      if (!fs.statSync(path.join(selected, file)).isFile()) throw Error('Missing runtime file: ' + file);
    }
    if (JSON.parse(fs.readFileSync(path.join(selected, 'manifest.json'), 'utf8')).manifest_version !== 3) throw Error('Expected Manifest V3');
    return selected;
  } catch (error) {
    throw Error('VERIFIER_EXTENSION_ROOT_INVALID: ' + String(configured ?? root) + ': ' + error.message);
  }
}
function runtimeResourceHashes(source) {
  const files = fs.readdirSync(source).filter(file => /\.(js|mjs|html|css)$/.test(file) || file === 'manifest.json');
  const visit = relative => {
    for (const item of fs.readdirSync(path.join(source, relative), { withFileTypes: true })) {
      const file = path.join(relative, item.name);
      if (item.isDirectory()) visit(file); else files.push(file);
    }
  };
  for (const dir of resourceDirectories) visit(dir);
  return Object.fromEntries(files.map(file => file.replaceAll('\\', '/')).sort().map(file =>
    [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(source, file))).digest('hex')]));
}
const extensionSourceRoot = resolveExtensionSourceRoot();
const output = path.join(root, 'output/playwright/frontend-feedback-20260925/note015');
const run = path.join(output, `run-${Date.now()}`); fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-note015-'));
const extension = path.join(temporary, 'extension');
const report = { repositoryRoot: root, extensionSourceRoot, preCopySourceHashes: {}, copiedResourceHashes: {}, status: 'FAIL', checks: [], screenshots: [], errors: [], hashes: {}, realApiCalls: 0,
  boundary: 'Actual popup rendering/events/editor/source projection/isolated chrome.storage persistence. Model and target-tab responses controlled; clipboard/download captured, no external requests or personal data.' };
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); assert.ok(pass, name); console.log('PASS ' + name); };
let context, page;
const shot = async name => { const cdp = await context.newCDPSession(page); const img = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(run, name + '.png'), Buffer.from(img.data, 'base64')); await cdp.detach(); report.screenshots.push(name + '.png'); };
try {
  report.preCopySourceHashes = runtimeResourceHashes(extensionSourceRoot);
  fs.mkdirSync(extension);
  for (const dir of resourceDirectories) fs.cpSync(path.join(extensionSourceRoot, dir), path.join(extension, dir), { recursive: true });
  for (const f of fs.readdirSync(extensionSourceRoot)) if (/\.(js|mjs|html|css)$/.test(f) || f === 'manifest.json') fs.copyFileSync(path.join(extensionSourceRoot, f), path.join(extension, f));
  report.copiedResourceHashes = runtimeResourceHashes(extension);
  if (JSON.stringify(report.preCopySourceHashes) !== JSON.stringify(report.copiedResourceHashes)) throw Error('VERIFIER_RESOURCE_COPY_MISMATCH');
  for (const f of ['popup.js', 'popup.html', 'popup.css', 'ui-swiss.css', 'core/literature-note-editor.js', 'core/literature-note-source-editor.js', 'core/i18n.js']) report.hashes[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, f))).digest('hex');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true, reducedMotion: 'reduce', viewport: { width: 360, height: 950 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  await context.route(/^https?:\/\//, route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw Error('NO_NETWORK_NOTE015'); }; });
  page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await page.waitForFunction(() => panelUiReady === true);
  await page.evaluate(async () => {
    activePanelTabContext.activated = true; document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
    capturePanelContext = () => ({ tabId: 4 }); isCurrentPanelContext = () => true;
    queryPanelTargetTab = async () => ({ id: 4 }); literatureNoteWorkspaceTarget = () => null;
    literatureNoteDocumentKey = () => 'note015-fixture';
    currentWorkspaceSnapshot = { documentHash: 'a'.repeat(64), title: 'Markdown 笔记验收' };
    requireUsableLlm = () => true; renderLiteratureNoteModelStatus = () => {};
    window.note015 = { calls: [], clipboard: '', downloaded: '', saved: [], hold: false, release: null };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { note015.clipboard = text; } } });
    downloadBlob = async blob => { note015.downloaded = await blob.text(); };
    const template = { id: 'note015', name: '笔记展示验收', studyFamily: 'custom', fields: [
      { id: 'background', label: '研究背景' }, { id: 'question', label: '科学问题' }, { id: 'findings', label: '主要发现' }
    ] };
    llmSettingsState = { ...llmSettingsState, settings: { ...llmSettingsState.settings, literatureNoteTemplates: [template] } };
    const persist = persistLiteratureNoteDocumentState;
    persistLiteratureNoteDocumentState = async (...args) => { const result = await persist(...args); note015.saved.push(structuredClone(literatureNoteDocumentState)); return result; };
    sendTabMessage = async (_id, message) => {
      if (message.action !== 'autofillLiteratureNoteWithLLM') throw Error('Unexpected action ' + message.action);
      note015.calls.push(structuredClone(message));
      if (note015.hold) await new Promise(resolve => { note015.release = resolve; });
      const signature = SciLLM.stableHash(literatureNoteTemplateSignaturePayload(message.template));
      return { success: true, result: { templateId: message.template.id, documentHash: 'a'.repeat(64),
        values: Object.fromEntries(message.template.fields.map(f => [f.id, '**关键概念**\n\n- 第一项证据\n- 第二项证据'])),
        fieldStatus: Object.fromEntries(message.template.fields.map(f => [f.id, 'supported'])),
        sources: Object.fromEntries(message.template.fields.map(f => [f.id, ['fixture-paragraph']])),
        operationReceipt: { cacheIdentity: { templateSignature: signature } }, evidenceReceipt: { templateSignature: signature } } };
    };
    const state = { schemaVersion: 3, templateId: 'note015', valuesByTemplate: { note015: {
      background: '**人工保留**\n\n- 首条\n- <span data-brevess-color="red">红色内容</span>\n\n[安全链接](https://example.invalid/evidence)\n<img src=x onerror=alert(1)>\n（p-0123456789abcdef）'
    } }, fieldStatusByTemplate: {}, fieldEvidenceByTemplate: {}, fieldUpdatedAtByTemplate: {}, updatedAt: 10 };
    await chrome.storage.local.set({ [LITERATURE_NOTE_STORAGE_KEY]: { entries: { 'note015-fixture': state } } });
    literatureNoteDocumentState = null; await loadLiteratureNoteDocumentState(); renderLiteratureNoteDrawer();
    switchWorkspaceView('notes', { persist: false, loadNotes: false });
  });
  const fields = page.locator('.literature-note-field'), first = fields.first(), input = first.locator('textarea');
  const toggle = page.locator('#toggleLiteratureNoteMarkdown');
  const bars = page.locator('.literature-note-editor-toolbar');
  const visibleBars = () => bars.evaluateAll(nodes => nodes.filter(n => n.checkVisibility()).length);
  await shot('01-initial');
  check('one icon-only global mode button immediately follows export', await toggle.count() === 1 && await toggle.innerText() === '' && await toggle.locator('svg').count() === 1 && await toggle.evaluate(n => n.previousElementSibling.id === 'exportLiteratureNoteMarkdown'));
  check('notes open rendered with bold/list/color and no inactive toolbars', await first.locator('.literature-note-editor-preview strong').count() === 1 && await first.locator('.literature-note-editor-preview li').count() === 2 && await first.locator('.literature-note-editor-preview [data-brevess-color="red"]').count() === 1 && !await input.isVisible() && await visibleBars() === 0);
  check('rendering remains inert and links retain safe target', await first.locator('.literature-note-editor-preview img, .literature-note-editor-preview script').count() === 0 && await first.locator('.literature-note-editor-preview a').getAttribute('rel') === 'noopener noreferrer');
  const original = await page.evaluate(() => JSON.stringify(literatureNoteDocumentState));
  await toggle.click();
  check('global code mode shows every textarea with no per-field toggle', await fields.locator('textarea').evaluateAll(nodes => nodes.every(n => n.checkVisibility())) && await fields.locator('.literature-note-editor-toggle').count() === 0 && await toggle.getAttribute('aria-pressed') === 'false');
  check('view switching never rewrites canonical values or triggers persistence', await page.evaluate(before => JSON.stringify(literatureNoteDocumentState) === before && note015.saved.length === 0, original));
  check('source identity remains canonical while displayed projection stays readable', await page.evaluate(() => literatureNoteDocumentState.valuesByTemplate.note015.background.includes('p-0123456789abcdef')) && !/p-0123456789abcdef/.test(await input.inputValue()));
  await input.focus(); check('source editing exposes exactly one contextual format toolbar', await visibleBars() === 1);
  await input.press('Control+Home'); await input.press('ArrowRight'); await input.press('ArrowRight');
  for (let i = 0; i < 4; i++) await input.press('Shift+ArrowRight');
  await first.locator('.literature-note-editor-color').selectOption('green');
  await page.waitForFunction(() => !literatureNoteSaveTimer && literatureNoteDirtyRevisions.size === 0);
  check('manual color formatting persists via existing source-safe editor', /data-brevess-color="green"/.test(await input.inputValue()));
  await fields.nth(1).locator('textarea').focus(); check('moving focus keeps only the new field toolbar visible', await visibleBars() === 1 && !await first.locator('.literature-note-editor-toolbar').isVisible());
  await input.dispatchEvent('compositionstart'); await toggle.click();
  check('composition guards make whole-note switching atomic', await input.isVisible() && await fields.locator('textarea').evaluateAll(nodes => nodes.every(n => n.checkVisibility())));
  await input.dispatchEvent('compositionend'); await toggle.click();
  check('global rendered mode removes all repeated toolbar rows', !await input.isVisible() && await visibleBars() === 0);
  await page.locator('#copyLiteratureNote').click(); await page.locator('#exportLiteratureNoteMarkdown').click();
  await page.waitForFunction(() => note015.downloaded.length > 0);
  const exported = await page.evaluate(() => ({ plain: note015.clipboard, markdown: note015.downloaded, current: currentLiteratureNoteExport('markdown') }));
  check('copy/export preserve original canonical Markdown and color markers', exported.markdown === exported.current && exported.markdown.includes('data-brevess-color="green"') && exported.plain.includes('人工保留'));
  await toggle.click();
  const manual = await input.inputValue();
  await page.locator('#autofillLiteratureNote').click();
  await page.waitForFunction(() => note015.calls.length === 1 && !literatureNoteAutofillPromise);
  check('AI result automatically renders Markdown and keeps the manual sibling', !await input.isVisible() && await input.inputValue() === manual && await fields.nth(1).locator('.literature-note-editor-preview strong').innerText() === '关键概念' && await visibleBars() === 0);
  check('generated sources remain available outside preview', await fields.nth(1).locator('.literature-note-source-list').innerText() !== '');
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 950 }); await toggle.scrollIntoViewIfNeeded();
    check(`${width}: rendered note and global toggle remain bounded`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await shot(`02-rendered-${width}`);
    await toggle.click(); await input.focus();
    check(`${width}: single edit toolbar fits without overflow`, await visibleBars() === 1 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await shot(`03-source-${width}`); await toggle.click();
  }
  await page.evaluate(async () => { await loadLiteratureNoteDocumentState(); renderLiteratureNoteDrawer(); });
  check('local readback retains content and rendered preference', !await input.isVisible() && await input.inputValue() === manual && await first.locator('.literature-note-editor-preview [data-brevess-color="green"]').count() === 1);
  await page.evaluate(() => { note015.hold = true; });
  await fields.nth(1).locator('[data-generate-literature-note-field]').click();
  await page.waitForFunction(() => note015.release);
  await toggle.click();
  await page.evaluate(() => { note015.release(); note015.release = null; });
  await page.waitForFunction(() => !literatureNoteAutofillPromise);
  check('AI completion respects a source-view choice made during the request', await input.isVisible());
  await fields.nth(1).locator('[data-generate-literature-note-field]').click();
  await page.waitForFunction(() => note015.release);
  await input.focus(); await input.press('Control+End'); await input.press('End'); await input.press('Enter'); await input.pressSequentially('人工续写');
  await page.evaluate(() => { note015.release(); note015.release = null; });
  await page.waitForFunction(() => !literatureNoteAutofillPromise && !literatureNoteSaveTimer && literatureNoteDirtyRevisions.size === 0);
  check('AI completion never hides an active manual editor or loses its new text', await input.isVisible() && await input.evaluate(n => n === document.activeElement) && (await input.inputValue()).includes('人工续写'));
  check('manual source identity survives editing and persistence', await page.evaluate(async () => {
    const canonical = literatureNoteDocumentState.valuesByTemplate.note015.background;
    const stored = (await chrome.storage.local.get(LITERATURE_NOTE_STORAGE_KEY))[LITERATURE_NOTE_STORAGE_KEY].entries['note015-fixture'].valuesByTemplate.note015.background;
    return canonical === stored && canonical.includes('p-0123456789abcdef') && canonical.includes('人工续写');
  }));
  await toggle.click();
  await page.evaluate(() => { SciLLM.setInterfaceLanguage('en'); renderLiteratureNoteDrawer(); });
  check('global icon has a localized accessible action name', /Markdown source/i.test(await toggle.getAttribute('aria-label')) && await toggle.innerText() === '');
  check('no browser page errors', report.errors.length === 0, report.errors);
  report.status = 'PASS';
} catch (e) { report.error = String(e.stack || e); console.error(report.error); if (page && !page.isClosed()) await shot('failure').catch(() => {}); }
finally {
  await context?.close();
  if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) && /^brevess-note015-/.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  console.log('EVIDENCE ' + run); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
