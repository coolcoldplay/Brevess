// UI-001 only. Real, unmodified popup HTML/JS in a disposable Edge extension.
// Article RPC and provider replies are synthetic; memory import/export uses the
// real extension background in an empty profile. No publisher or user data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/playwright/r16-feedback-ui001');
const phase = process.env.UI001_PHASE === 'before' ? 'before' : 'after';
const run = path.join(output, `${phase}-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(output, 'runtime-'));
const extension = path.join(temporary, 'extension');
const report = { phase, status: 'FAIL', checks: [], screenshots: [],
  boundary: 'real popup + background memory; synthetic article transport and provider',
  realApiCalls: 0, blockedNetwork: [], pageErrors: [], sourceHashes: {}, observations: [], cleanup: false };
let context;
let page;
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function check(name, pass, details) {
  report.checks.push({ name, pass: Boolean(pass), ...(details === undefined ? {} : { details }) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
}
async function shot(page, name) {
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(run, filename) });
  report.screenshots.push(filename);
}
const neutral = color => {
  const parts = String(color).match(/[\d.]+/g)?.map(Number);
  return parts?.length >= 3 && Math.max(...parts.slice(0, 3)) - Math.min(...parts.slice(0, 3)) <= 2;
};
async function style(locator) {
  return locator.evaluate(el => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor, border: s.borderTopColor,
      radius: s.borderRadius, outline: s.outlineColor, outlineWidth: s.outlineWidth,
      outlineStyle: s.outlineStyle, disabled: el.disabled, animation: s.animationName };
  });
}
async function neutralStyle(name, locator, focus = false) {
  const s = await style(locator);
  check(name, neutral(s.color) && neutral(s.background) && neutral(s.border) &&
    s.radius === '0px' && (!focus || (neutral(s.outline) && parseFloat(s.outlineWidth) >= 2 && s.outlineStyle !== 'none')), s);
}
try {
  // Preserve before bytes once; never overwrite the task's baseline snapshot.
  const before = path.join(output, 'before-snapshot');
  fs.mkdirSync(before, { recursive: true });
  for (const file of ['ui-swiss.css', 'popup.css', 'popup.html', 'popup.js']) {
    if (!fs.existsSync(path.join(before, file))) fs.copyFileSync(path.join(root, file), path.join(before, file));
    report.sourceHashes[file] = hash(path.join(root, file));
  }
  fs.mkdirSync(extension, { recursive: true });
  for (const folder of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, folder), path.join(extension, folder), { recursive: true });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(js|mjs|html|css)$/.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(extension, file));
    }
  }
  // Stable source fixture, not a replacement popup or content implementation.
  fs.writeFileSync(path.join(extension, 'ui001-source.html'), '<!doctype html><meta charset="utf-8"><title>UI001 isolated article</title>' +
    Array.from({ length: 22 }, (_, i) => `<p id="paragraph-${i}" style="min-height:100px">${String.fromCharCode(65 + i)}AA — isolated definition ${i}</p>`).join(''));
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, acceptDownloads: true,
    viewport: { width: 520, height: 800 }, reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking']
  });
  await context.route(/^https?:\/\//, route => {
    report.blockedNetwork.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw new Error('UI001_NETWORK_FORBIDDEN'); }; });
  const id = new URL(worker.url()).host;
  const article = await context.newPage();
  await article.goto(`chrome-extension://${id}/ui001-source.html`);
  page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => report.pageErrors.push(e.message));
  await page.exposeFunction('ui001Focus', async target => article.evaluate(target => {
    const node = document.getElementById(target.paragraphId);
    if (!node) return false;
    node.scrollIntoView();
    node.dataset.focused = 'true';
    return node.textContent.includes(target.quote);
  }, target));
  await page.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof renderArticleAbbreviationTable === 'function' && typeof setupWorkspaceNavigation === 'function');
  await page.waitForFunction(() => panelUiReady === true);
  await page.evaluate(() => {
    panelUiReady = false; // unrelated inactive-tab capture gate, no UI handlers replaced
    tabContextRequestSequence += 1; // invalidate startup's in-flight inactive-tab reply
    clearTimeout(tabContextSyncTimer);
    activePanelTabContext = { tabId: 901, url: 'https://ui001.invalid/article',
      key: 'ui001-fixture', activated: true, pdfMode: false, tabContextSequence: 1 };
    const entries = Array.from({ length: 22 }, (_, i) => ({
      abbreviation: `${String.fromCharCode(65 + i)}AA`,
      fullName: i === 0 ? 'adenosine triphosphate dependent transmembrane signal transduction regulatory complex' : `biological regulatory marker ${i}`,
      meaningZh: i === 0 ? '' : `隔离数据中文 ${i}`,
      meaningSource: i === 1 ? 'llm' : 'manual',
      sourceType: ['automatic', 'manual', 'global', 'automatic+global'][i % 4],
      paragraphId: `paragraph-${i}`, sourceKey: `source-${i}`, navigationRevision: 1
    }));
    const fixture = window.ui001 = { entries, calls: [], saveMode: 'normal', providerMode: 'hold' };
    const snapshot = () => ({ entries: structuredClone(entries), automaticCount: 6,
      manualCount: 6, globalCount: 10, translatedCount: entries.filter(x => x.meaningZh).length });
    fixture.snapshot = snapshot;
    queryPanelTargetTab = async () => ({ id: 901, url: 'https://ui001.invalid/article', title: 'UI001' });
    hasUsableLlm = () => true; // credentials deliberately absent; transport below cannot use a provider
    sendTabMessage = async (_id, message) => {
      fixture.calls.push(structuredClone(message));
      if (message.action === 'getArticleAbbreviations') return { success: true, abbreviations: snapshot() };
      if (message.action === 'focusArticleWorkspaceSource') {
        return { success: true, focused: await window.ui001Focus(message.target) };
      }
      if (message.action === 'updateArticleAbbreviationTranslations') {
        if (fixture.saveMode === 'error') return { success: false, error: 'UI001 simulated storage failure' };
        if (fixture.saveMode === 'hold') await new Promise(resolve => { fixture.releaseSave = resolve; });
        for (const update of message.translations) {
          const entry = entries.find(x => x.abbreviation === update.abbreviation);
          if (entry) Object.assign(entry, { meaningZh: update.meaningZh, meaningSource: update.origin });
        }
        return { success: true, abbreviations: snapshot() };
      }
      if (message.action === 'removeArticleAbbreviation') {
        const index = entries.findIndex(x => x.abbreviation === message.abbreviation);
        if (index >= 0) entries.splice(index, 1);
        return { success: true, abbreviations: snapshot() };
      }
      throw new Error(`UI001 unexpected article RPC: ${message.action}`);
    };
    sendLlmMessage = async message => {
      fixture.calls.push(structuredClone(message));
      if (message.type !== 'LLM_TRANSLATE_ABBREVIATIONS') throw new Error('UI001_PROVIDER_FORBIDDEN');
      if (fixture.providerMode === 'error') throw new Error('UI001 simulated provider failure');
      if (fixture.providerMode === 'hold') await new Promise(resolve => { fixture.releaseProvider = resolve; });
      return { translations: message.entries.map(x => ({ ...x, meaningZh: '模拟模型中文', origin: 'llm' })) };
    };
  });
  await page.locator('#showArticleAbbreviations').click();
  const dialog = page.locator('#articleAbbreviationDialog');
  await dialog.waitFor({ state: 'visible' });
  await page.locator('.abbreviation-table-row').first().waitFor();
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 800 });
    await page.mouse.move(width - 4, 4);
    await shot(page, `${width}-default`);
    const boxes = await dialog.evaluate(el => {
      const w = el.querySelector('.abbreviation-table-wrap');
      return { dialog: el.getBoundingClientRect().width, viewport: innerWidth,
        scrollWidth: w.scrollWidth, clientWidth: w.clientWidth,
        tableHeight: el.querySelector('table').getBoundingClientRect().height };
    });
    check(`${width}: dialog contained`, boxes.dialog <= width + 1, boxes);
    const readability = await dialog.evaluate(el => ({
      fullNameWidth: el.querySelector('tbody td:nth-child(2)').getBoundingClientRect().width,
      inputWidth: el.querySelector('.abbreviation-meaning-input').getBoundingClientRect().width,
      outsideOverflow: document.documentElement.scrollWidth > innerWidth,
      sourceLabelsComplete: [...el.querySelectorAll('.abbreviation-source-badge')]
        .every(badge => badge.scrollWidth <= badge.clientWidth + 2)
    }));
    check(`${width}: readable columns and complete source labels`, readability.fullNameWidth >= 120 &&
      readability.inputWidth >= 95 && !readability.outsideOverflow && readability.sourceLabelsComplete, readability);
    for (const source of ['automatic', 'manual', 'global', 'automatic+global']) {
      await neutralStyle(`${width}: ${source} source badge`, page.locator(`.abbreviation-source-badge[data-source="${source}"]`).first());
    }
    await neutralStyle(`${width}: action button`, page.locator('#exportGlobalAbbreviationMemory'));
    await neutralStyle(`${width}: input`, page.locator('.abbreviation-meaning-input').first());
    await neutralStyle(`${width}: LLM input`, page.locator('.abbreviation-meaning-input[data-origin="llm"]').first());
    await neutralStyle(`${width}: alphabet disabled`, page.getByRole('button', { name: '没有以 Z 开头的缩写', exact: true }));
    await neutralStyle(`${width}: table heading`, page.locator('.abbreviation-table th').first());
    const wrap = page.locator('.abbreviation-table-wrap');
    if (boxes.scrollWidth > boxes.clientWidth) {
      await wrap.hover({ position: { x: 100, y: 180 } });
      await page.mouse.wheel(800, 0);
      await page.waitForFunction(() => {
        const w = document.querySelector('.abbreviation-table-wrap');
        return w.scrollLeft >= w.scrollWidth - w.clientWidth - 2;
      });
      check(`${width}: real horizontal scroll reveals input and source controls`, await wrap.evaluate(el => {
        const bounds = el.getBoundingClientRect();
        return ['.abbreviation-meaning-input', '.abbreviation-source-badge', '.abbreviation-row-delete'].every(selector => {
          const rect = el.querySelector(selector).getBoundingClientRect();
          return rect.left >= bounds.left && rect.right <= bounds.right;
        });
      }));
      await shot(page, `${width}-right-columns`);
      await page.mouse.wheel(-800, 0);
      await page.waitForFunction(() => document.querySelector('.abbreviation-table-wrap').scrollLeft === 0);
    }
  }
  await page.setViewportSize({ width: 520, height: 800 });
  await page.locator('#exportGlobalAbbreviationMemory').hover();
  await neutralStyle('action hover', page.locator('#exportGlobalAbbreviationMemory'));
  await shot(page, '520-action-hover');
  await page.keyboard.press('Tab');
  await neutralStyle('keyboard focus', page.locator(':focus'), true);
  await shot(page, '520-keyboard-focus');
  await page.getByRole('button', { name: '跳转到以 T 开头的缩写', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.is-alphabet-target')?.dataset.abbreviationInitial === 'T');
  await page.waitForFunction(() => {
    const el = document.querySelector('.abbreviation-table-wrap');
    const row = document.querySelector('[data-abbreviation-initial="T"]');
    const target = Math.min(el.scrollHeight - el.clientHeight, row.offsetTop - 36);
    return Math.abs(el.scrollTop - target) < 3;
  });
  const sticky = await page.locator('.abbreviation-table-wrap').evaluate(el => {
    const rect = el.getBoundingClientRect();
    const th = el.querySelector('th').getBoundingClientRect();
    return { top: th.top, viewportTop: rect.top, scrollTop: el.scrollTop };
  });
  check('letter jump scrolls and keeps sticky heading', sticky.scrollTop > 0 && Math.abs(sticky.top - sticky.viewportTop) < 3, sticky);
  await neutralStyle('letter target neutral', page.locator('.is-alphabet-target .abbreviation-table-jump').first());
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await neutralStyle('letter target keyboard focus', page.locator(':focus'), true);
  await shot(page, '520-letter-jump');
  await page.getByRole('button', { name: '缩写 TAA；跳转到正文首次出现位置', exact: true }).click();
  await article.waitForFunction(() => document.querySelector('#paragraph-19')?.dataset.focused === 'true');
  check('body jump actually scrolls isolated article', await article.evaluate(() => scrollY > 0 && document.querySelector('#paragraph-19')?.dataset.focused === 'true'));
  check('body jump keeps dialog open', await dialog.evaluate(el => el.open));
  await shot(article, 'article-source-jump');
  await page.getByRole('button', { name: '跳转到以 A 开头的缩写', exact: true }).click();
  await page.waitForFunction(() => {
    const el = document.querySelector('.abbreviation-table-wrap');
    const row = document.querySelector('[data-abbreviation-initial="A"]');
    return Math.abs(el.scrollTop - Math.max(0, row.offsetTop - 36)) < 3;
  });
  const input = page.getByRole('textbox', { name: 'AAA 的中文含义', exact: true });
  await input.fill('待保存中文');
  await neutralStyle('input focus', input, true);
  await neutralStyle('save action', page.getByRole('button', { name: '保存 AAA 的中文含义', exact: true }));
  await shot(page, '520-edit-focus');
  await page.evaluate(() => { ui001.saveMode = 'hold'; });
  await input.press('Enter');
  await page.waitForFunction(() => typeof ui001.releaseSave === 'function');
  check('Enter save disables field during pending write', await input.isDisabled());
  await neutralStyle('saving disabled input', input);
  await shot(page, '520-saving');
  await page.evaluate(() => { ui001.saveMode = 'normal'; ui001.releaseSave(); });
  await page.waitForFunction(() => document.querySelector('.abbreviation-meaning-input')?.value === '待保存中文' && !document.querySelector('.abbreviation-meaning-input')?.disabled);
  check('Enter saved through actual popup handler', await input.inputValue() === '待保存中文');
  await input.fill('取消的草稿');
  await input.press('Escape');
  check('Escape restores original field value', await page.locator('.abbreviation-meaning-input').first().inputValue() === '待保存中文');
  // Native dialog Escape may close it; reopen via the actual toolbar if needed.
  if (!await dialog.evaluate(el => el.open)) await page.locator('#showArticleAbbreviations').click();
  await input.fill('保存失败的草稿');
  await page.evaluate(() => { ui001.saveMode = 'error'; });
  await input.press('Enter');
  await page.waitForFunction(() => document.getElementById('statusMessage').textContent.includes('UI001 simulated storage failure'));
  check('save error retains draft and editable state', await input.inputValue() === '保存失败的草稿' && !await input.isDisabled());
  // The modal owns its visible error. The top strip uses a semantic edge
  // accent after UI-013; its text color no longer describes this feedback.
  const errorColor = await page.locator('#articleAbbreviationFeedback').evaluate(el => getComputedStyle(el).color);
  check('visible modal error retains functional red', !neutral(errorColor), errorColor);
  const globalErrorAccent = await page.locator('#statusMessage').evaluate(el => getComputedStyle(el).borderInlineStartColor);
  check('global error strip retains semantic red accent', !neutral(globalErrorAccent), globalErrorAccent);
  const errorVisibility = await page.evaluate(() => {
    const status = document.getElementById('articleAbbreviationFeedback') || document.getElementById('statusMessage');
    const dialog = document.getElementById('articleAbbreviationDialog');
    const rect = status.getBoundingClientRect();
    const top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, rect.left + 1)),
      Math.min(innerHeight - 1, Math.max(0, rect.top + 1)));
    return { name: 'save error is visible inside the open abbreviation modal',
      dialogOpen: dialog.open, notificationInsideDialog: dialog.contains(status),
      notificationColor: getComputedStyle(status).color,
      topmostIsFeedback: top === status || status.contains(top) };
  });
  check(errorVisibility.name, errorVisibility.notificationInsideDialog &&
    errorVisibility.topmostIsFeedback, errorVisibility);
  await shot(page, '520-save-error-draft');
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const visible = await page.locator('#articleAbbreviationFeedback').evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth + 1 &&
        document.elementFromPoint(rect.left + 2, rect.top + 2) === el &&
        document.documentElement.scrollWidth <= innerWidth + 1;
    });
    check(`${width}px save failure stays readable inside modal without page overflow`, visible);
    await shot(page, `${width}-save-error-draft`);
  }
  await page.setViewportSize({ width: 520, height: 800 });
  await input.press('Escape');
  if (!await dialog.evaluate(el => el.open)) await page.locator('#showArticleAbbreviations').click();
  await page.evaluate(() => { ui001.saveMode = 'normal'; });
  await input.fill('');
  await input.press('Enter');
  await page.waitForFunction(() => ui001.entries[0].meaningZh === '');
  await page.evaluate(() => { ui001.providerMode = 'error'; });
  await page.locator('#translateArticleAbbreviations').click();
  await page.waitForFunction(() => document.getElementById('statusMessage').textContent.includes('UI001 simulated provider failure'));
  check('provider failure resets pending button without fabricating translation',
    !await page.locator('#translateArticleAbbreviations').isDisabled() && await input.inputValue() === '');
  check('provider failure is visible inside the open modal', await page.evaluate(() => {
    const feedback = document.getElementById('articleAbbreviationFeedback');
    return Boolean(feedback && document.getElementById('articleAbbreviationDialog').contains(feedback) &&
      feedback.textContent.includes('UI001 simulated provider failure'));
  }));
  await page.evaluate(() => { ui001.providerMode = 'hold'; });
  await page.locator('#translateArticleAbbreviations').click();
  await page.waitForFunction(() => typeof ui001.releaseProvider === 'function');
  check('one-click acquisition exposes busy disabled state', await page.locator('#translateArticleAbbreviations').isDisabled());
  await neutralStyle('LLM pending', page.locator('#translateArticleAbbreviations'));
  await shot(page, '520-llm-pending');
  await page.evaluate(() => ui001.releaseProvider());
  await page.waitForFunction(() => ui001.entries[0].meaningZh === '模拟模型中文' && !abbreviationTranslationPending);
  check('synthetic provider result saved without real API', await input.inputValue() === '模拟模型中文');
  check('acquisition preserves existing manual translation', await page.getByRole('textbox', { name: 'CAA 的中文含义', exact: true }).inputValue() === '隔离数据中文 2');
  await neutralStyle('acquired LLM input', input);
  await shot(page, '520-acquired');
  await page.locator('#importArticleAbbreviationsToGlobal').click();
  await page.waitForFunction(() => document.getElementById('statusMessage').textContent.includes('已导入全局记忆'));
  const memory = await page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'ABBREVIATION_MEMORY_GET' })).data.memory);
  check('article import uses real isolated background memory', memory.entries.length === 22, memory.entries.length);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportGlobalAbbreviationMemory').click();
  const download = await downloadPromise;
  const exported = path.join(run, 'exported-fixture.json');
  await download.saveAs(exported);
  check('export downloads parseable actual memory', JSON.parse(fs.readFileSync(exported, 'utf8')).entryCount === 22);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#importGlobalAbbreviationMemoryButton').click();
  await (await chooserPromise).setFiles(exported);
  await page.waitForFunction(() => document.getElementById('statusMessage').textContent.includes('词库导入完成'));
  check('file chooser import completes', true);
  const remove = page.getByRole('button', { name: '从本文缩略词表移除 AAA', exact: true });
  await remove.hover();
  const danger = await style(remove);
  check('delete remains red on hover', !neutral(danger.color), danger);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  // Keyboard focus is checked directly on the actual delete control below.
  await remove.focus();
  const dangerFocus = await style(remove);
  check('delete has visible red keyboard focus', !neutral(dangerFocus.color) && !neutral(dangerFocus.outline) && parseFloat(dangerFocus.outlineWidth) >= 2 && dangerFocus.outlineStyle === 'solid', dangerFocus);
  await shot(page, '520-delete-focus');
  page.once('dialog', d => d.dismiss());
  await remove.click();
  check('delete cancellation retains row', await page.locator('.abbreviation-table-row').count() === 22);
  page.once('dialog', d => d.accept());
  await remove.click();
  await page.waitForFunction(() => document.querySelectorAll('.abbreviation-table-row').length === 21);
  check('confirmed deletion removes only chosen row', await page.getByRole('textbox', { name: 'BAA 的中文含义', exact: true }).count() === 1);
  await page.getByRole('button', { name: '关闭缩写表', exact: true }).click();
  check('close button closes real dialog', !await dialog.evaluate(el => el.open));
  await shot(page, 'closed');
  report.rpcCalls = await page.evaluate(() => ui001.calls);
  check('no browser page exceptions', report.pageErrors.length === 0, report.pageErrors);
  for (const file of Object.keys(report.sourceHashes)) {
    report.sourceHashes[`${file}:staged`] = hash(path.join(extension, file));
  }
  report.status = report.checks.every(c => c.pass) ? 'PASS' : 'FAIL';
} catch (error) {
  report.error = error.stack || String(error);
  console.error(report.error);
  if (page && !page.isClosed()) await shot(page, 'failure').catch(() => {});
} finally {
  await context?.close();
  const validated = path.resolve(temporary);
  if (path.dirname(validated) === path.resolve(output) && /^runtime-/.test(path.basename(validated))) {
    fs.rmSync(validated, { recursive: true, force: true });
    report.cleanup = true;
  }
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  const safe = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  fs.writeFileSync(path.join(run, 'report.html'), '<!doctype html><meta charset="utf-8"><title>UI-001 evidence</title>' +
    `<h1>UI-001 ${phase}: ${report.status}</h1><p>${safe(report.boundary)}</p>` +
    `<p>Real API calls: ${report.realApiCalls}. Temporary profile removed: ${report.cleanup}.</p>` +
    report.observations.map(o => `<p>Observation (outside CSS scope): ${safe(o.name)}</p>`).join('') +
    report.checks.map(c => `<p>${c.pass ? 'PASS' : 'FAIL'} ${safe(c.name)}</p>`).join('') +
    report.screenshots.map(file => `<h2>${safe(file)}</h2><img style="max-width:100%;border:1px solid #ccc" src="${safe(file)}">`).join(''));
  console.log(`EVIDENCE ${run}`);
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
