// UI013: production popup HTML/CSS/JS in isolated Edge. Synthetic Figure state;
// cancellation transport only is substituted. No publisher/provider/OS interaction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
const repositoryRoot = path.resolve(import.meta.dirname, '..');
// Select only runtime bytes; the runner, dependencies and evidence stay in this repository.
function resolveExtensionRoot() {
  const allowed = new Set([]);
  if (process.argv.slice(2).some(arg => !allowed.has(arg))) throw Error('VERIFIER_ARGUMENT_INVALID');
  const configured = process.env.SCI_EXTENSION_ROOT;
  if (configured !== undefined && !configured.trim()) throw Error('VERIFIER_EXTENSION_ROOT_INVALID');
  const selected = path.resolve(configured === undefined ? repositoryRoot : configured);
  try {
    if (!fs.statSync(selected).isDirectory()) throw Error('not a directory');
    for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) {
      if (!fs.statSync(path.join(selected, dir)).isDirectory()) throw Error('missing runtime directory');
    }
    for (const file of ['manifest.json', 'background.js', 'content.js', 'popup.js', 'popup.html', 'popup.css', 'ui-swiss.css']) {
      if (!fs.statSync(path.join(selected, file)).isFile()) throw Error('missing runtime file');
    }
    if (JSON.parse(fs.readFileSync(path.join(selected, 'manifest.json'), 'utf8')).manifest_version !== 3) {
      throw Error('invalid extension manifest');
    }
  } catch { throw Error('VERIFIER_EXTENSION_ROOT_INVALID'); }
  return selected;
}
const root = resolveExtensionRoot();
function fingerprintCopiedExtension(directory) {
  const hashes = {};
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else {
        const relative = path.relative(directory, file).split(path.sep).join('/');
        const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        assert.equal(digest, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex'),
          'VERIFIER_EXTENSION_COPY_CHANGED: ' + relative);
        hashes[relative] = digest;
      }
    }
  };
  visit(directory); return hashes;
}
const run = path.join(repositoryRoot, 'output/playwright/ui013-status-strip', `run-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-ui013-'));
const extension = path.join(temporary, 'extension');
const report = { status: 'FAIL', checks: [], screenshots: [], hashes: {}, errors: [], requests: [],
  repositoryRoot, extensionRoot: root, copiedSourceHashes: {},
  boundary: 'Real popup DOM/styles/status/controller; synthetic Figure progress and a controlled cancellation transport reply. No real model task cancelled, no personal profile, no network or installed extension changed.' };
const check = (name, pass, detail) => { report.checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
let context, page;
const shot = async name => { const cdp = await context.newCDPSession(page); const img = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(run, `${name}.png`), Buffer.from(img.data, 'base64')); await cdp.detach(); report.screenshots.push(`${name}.png`); };
const style = () => page.locator('#statusMessage').evaluate(el => { const s = getComputedStyle(el), b = el.getBoundingClientRect(); return { radius: s.borderRadius, background: s.backgroundColor, color: s.color, shadow: s.boxShadow, edge: s.borderInlineStartColor, edgeWidth: s.borderInlineStartWidth, align: s.textAlign, overflowWrap: s.overflowWrap, display: s.display, width: b.width, height: b.height, left: b.left, right: b.right, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 }; });
const show = (message, type, running = false) => page.evaluate(({ message, type, running }) => {
  figureAnalysisState = { running, phase: running ? 'analyzing' : 'completed', currentFigure: 5, totalFigures: 13, completedFigures: running ? 4 : 13, failedFigures: 0, figureProgress: [] };
  updateFigureButton(); showStatus(message, type);
}, { message, type, running });
try {
  fs.mkdirSync(extension);
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  for (const file of fs.readdirSync(root)) if (/\.(?:js|mjs|html|css)$/.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(root, file), path.join(extension, file));
  for (const file of ['ui-swiss.css', 'popup.css', 'popup.html', 'popup.js']) report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, file))).digest('hex');
  report.copiedSourceHashes = fingerprintCopiedExtension(extension);
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true, reducedMotion: 'reduce', viewport: { width: 520, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  await context.route(/^https?:\/\//, route => { report.requests.push(route.request().url()); return route.abort(); });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw new Error('NO_NETWORK_UI013'); }; });
  page = await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await page.waitForFunction(() => panelUiReady === true);
  await page.evaluate(() => { activePanelTabContext.activated = true; document.getElementById('sidePanelApp').classList.remove('is-tab-inactive'); document.getElementById('sidePanelPaperTitle').textContent = 'Intestinal macrophages modulate synucleinopathy'; });
  await page.locator('[data-workspace-target="figures"]').click();
  await page.locator('[data-workspace-view="figures"]').waitFor({ state: 'visible' });
  const sideEffectsBefore = await page.locator('#cancelFigureAnalysis').evaluate(el => { const s = getComputedStyle(el); return { radius: s.borderRadius, color: s.color, background: s.backgroundColor }; });
  await show('Figure 5：正在处理 Figure', 'success', true);
  await page.waitForTimeout(350); await shot('01-processing-520');
  const processing = await style();
  check('top notification is square, shadow-free and neutral', processing.radius === '0px' && processing.shadow === 'none' && processing.background === 'rgb(244, 244, 244)' && processing.color === 'rgb(32, 32, 32)', processing);
  check('short notice is compact and left-aligned', processing.height <= 40 && processing.align === 'left', processing);
  await show('逐图解读完成：13 张 Figure', 'success'); await page.waitForTimeout(350); const success = await style(); await shot('02-success-520');
  await show('部分 Figure 尚未完成，已保留成功结果', 'warning'); await page.waitForTimeout(350); const warning = await style(); await shot('03-warning-520');
  await show('逐图解读失败：连接暂时中断，请稍后重试', 'error'); await page.waitForTimeout(350); const error = await style(); await shot('04-error-520');
  check('processing/success/warning/error have distinct edge accents and unchanged readable text', new Set([processing.edge, success.edge, warning.edge, error.edge]).size === 4 && [success, warning, error].every(s => s.background === processing.background && s.color === processing.color && s.edgeWidth === '3px'), { processing, success, warning, error });
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 900 });
    const long = 'Figure 5：正在处理 Figure。已保存的 Panel 结果会保留；当前正在核验正文引用与图注。' + 'LongUnbrokenScientificIdentifier'.repeat(8) + ' — 完整末尾';
    await show(long, 'success', true); await page.waitForTimeout(350); const s = await style();
    check(`${width}px: long Chinese/Latin content wraps without horizontal overflow or truncation`, !s.pageOverflow && s.scrollWidth <= s.clientWidth + 1 && s.left >= 0 && s.right <= width && await page.locator('#statusMessage').innerText() === long, s);
    await shot(`05-long-${width}`);
  }
  const semantics = await page.locator('#statusMessage').evaluate(el => ({ role: el.getAttribute('role'), live: el.getAttribute('aria-live'), atomic: el.getAttribute('aria-atomic') }));
  check('existing polite atomic status semantics are retained', semantics.role === 'status' && semantics.live === 'polite' && semantics.atomic === 'true', semantics);
  await page.setViewportSize({ width: 360, height: 900 });
  await show('第一条提示', 'success'); await page.waitForTimeout(1700); await show('后到的提示应重新计时', 'warning'); await page.waitForTimeout(1700);
  check('updating notice resets original 3-second dismissal timer', await page.locator('#statusMessage').isVisible() && (await page.locator('#statusMessage').innerText()) === '后到的提示应重新计时');
  await page.locator('#statusMessage').waitFor({ state: 'hidden', timeout: 2500 });
  check('notice still auto-dismisses with no residual block', (await style()).display === 'none' && (await style()).height === 0); await shot('06-dismissed-360');
  await show('Figure 5：正在处理 Figure', 'success', true);
  await page.evaluate(() => { window.ui013ControlCalls = []; queryPanelTargetTab = async () => ({ id: 123456 }); sendTabMessage = async (id, message) => { ui013ControlCalls.push({ id, message }); return { success: true }; }; });
  await page.locator('#cancelFigureAnalysis').click();
  await page.waitForFunction(() => document.getElementById('statusMessage').textContent.includes('已取消 Figure 解读'));
  const cancellation = await page.evaluate(() => ({ calls: ui013ControlCalls, phase: figureAnalysisState.phase, running: figureAnalysisState.running, hidden: document.getElementById('figureTaskControls').hidden, text: document.getElementById('statusMessage').textContent }));
  check('real cancel button and control handler retain transport and terminal notice behavior', cancellation.calls.length === 1 && cancellation.calls[0].message.action === 'controlLlmOperation' && cancellation.calls[0].message.command === 'cancel' && !cancellation.running && cancellation.hidden && cancellation.phase === 'cancelled', cancellation);
  await page.waitForTimeout(350); await shot('07-cancelled-360');
  const sideEffectsAfter = await page.locator('#cancelFigureAnalysis').evaluate(el => { const s = getComputedStyle(el); return { radius: s.borderRadius, color: s.color, background: s.backgroundColor }; });
  check('unrelated cancel-button styling is unchanged', JSON.stringify(sideEffectsBefore) === JSON.stringify(sideEffectsAfter), { sideEffectsBefore, sideEffectsAfter });
  check('no page errors or external requests', report.errors.length === 0 && report.requests.length === 0, { errors: report.errors, requests: report.requests });
  report.status = report.checks.every(c => c.pass) ? 'PASS' : 'FAIL';
} catch (error) { report.error = String(error.stack || error); console.error(report.error); if (page && !page.isClosed()) await shot('failure').catch(() => {}); }
finally {
  await context?.close();
  if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) && /^brevess-ui013-/.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  fs.writeFileSync(path.join(run, 'report.html'), '<!doctype html><meta charset="utf-8"><h1>UI013 ' + report.status + '</h1><p>' + esc(report.boundary) + '</p>' + report.checks.map(c => `<p>${c.pass ? 'PASS' : 'FAIL'} ${esc(c.name)}</p>`).join('') + report.screenshots.map(s => `<h2>${s}</h2><img src="${s}" style="max-width:100%">`).join(''));
  console.log('EVIDENCE ' + run); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
