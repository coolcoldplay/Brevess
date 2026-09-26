import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
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
const run = path.join(root, 'output/playwright/frontend-feedback-20260925/ui020', `run-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-ui020-'));
const extension = path.join(temporary, 'extension');
const report = { repositoryRoot: root, extensionSourceRoot, preCopySourceHashes: {}, copiedResourceHashes: {}, checks: [], screenshots: [], errors: [], hashes: {}, boundary: 'Isolated Edge with production popup, content runtime and CSS. Controlled article/image fixture and captured import/PDF transport; no real model/MinerU/network/personal data.' };
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>Isolated Figure UI</title><article><h1>Figure fixture</h1><p>Local controlled content.</p></article>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let context, page;
async function shot(target, name) { const cdp = await context.newCDPSession(target); const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(run, name + '.png'), Buffer.from(r.data, 'base64')); await cdp.detach(); report.screenshots.push(name + '.png'); }
try {
  report.preCopySourceHashes = runtimeResourceHashes(extensionSourceRoot);
  fs.mkdirSync(extension);
  for (const dir of resourceDirectories) fs.cpSync(path.join(extensionSourceRoot, dir), path.join(extension, dir), { recursive: true });
  for (const f of fs.readdirSync(extensionSourceRoot)) if (/\.(js|mjs|html|css)$/.test(f) || f === 'manifest.json') fs.copyFileSync(path.join(extensionSourceRoot, f), path.join(extension, f));
  report.copiedResourceHashes = runtimeResourceHashes(extension);
  if (JSON.stringify(report.preCopySourceHashes) !== JSON.stringify(report.copiedResourceHashes)) throw Error('VERIFIER_RESOURCE_COPY_MISMATCH');
  for (const f of ['popup.js', 'popup.css', 'ui-swiss.css', 'content.css']) report.hashes[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, f))).digest('hex');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true, reducedMotion: 'reduce', viewport: { width: 420, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  await context.route(/^https?:\/\//, route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => { globalThis.fetch = async () => { throw Error('NO_NETWORK_UI020'); }; });
  const article = await context.newPage(); await article.goto(url);
  article.on('pageerror', e => report.errors.push(e.message));
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
  await worker.evaluate(async tabId => {
    await chrome.scripting.insertCSS({ target: { tabId }, files: SciLLM.CONTENT_STYLE_FILES });
    await chrome.scripting.executeScript({ target: { tabId }, files: SciLLM.CONTENT_SCRIPT_FILES });
    await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650"><rect width="1000" height="650" fill="white"/><text x="40" y="55" font-size="25">A  Controlled image fixture — not research data</text><path d="M70 540V110M70 540H930M120 450L310 350L520 390L720 230L900 140" fill="none" stroke="#333" stroke-width="7"/></svg>';
      const image = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      const fixtures = [1, 2].map(n => ({ figureId: `figure-${n}`, figureNumber: n, figureLabel: `Figure ${n}`, caption: `Figure ${n}. Controlled caption.`, imageSource: image }));
      findFigureAnalysisTarget = id => fixtures.find(f => f.figureId === id);
      getFigureViewerInventory = () => fixtures;
      resolveFigureImageSources = async () => [image];
      selectBestFigureImageResource = async () => null;
      figureImageCacheMode = async () => 'none';
      await showFigureImageViewer('figure-1');
    } });
  }, tabId);
  const viewer = article.locator('#sci-figure-image-viewer');
  await viewer.locator('img').waitFor();
  for (const width of [360, 1100]) {
    await article.setViewportSize({ width, height: 850 });
    const metrics = await viewer.evaluate(n => ({ background: getComputedStyle(n).backgroundColor, radius: getComputedStyle(n.querySelector('button')).borderRadius, overflow: n.scrollWidth > n.clientWidth + 1, bounds: [...n.querySelectorAll('button')].every(b => { const r=b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }) }));
    check(`${width}: viewer uses neutral square controls and fits`, metrics.background === 'rgb(245, 245, 245)' && metrics.radius === '0px' && !metrics.overflow && metrics.bounds, metrics);
    await shot(article, `viewer-${width}`);
  }
  await viewer.getByRole('button', { name: '放大原图', exact: true }).click();
  check('zoom increases to 125%', (await viewer.innerText()).includes('125%'));
  await viewer.getByRole('button', { name: '缩小原图', exact: true }).click();
  check('zoom decreases to 100%', (await viewer.innerText()).includes('100%'));
  await viewer.getByRole('button', { name: '放大原图', exact: true }).click();
  await viewer.getByRole('button', { name: '使原图适配窗口' }).click();
  check('fit resets scale', (await viewer.innerText()).includes('100%'));
  await viewer.getByRole('button', { name: '查看当前 Figure 图注' }).click();
  check('caption state toggles through the existing event', await viewer.getAttribute('data-caption-visible') === 'true');
  await article.keyboard.press('ArrowRight'); await article.waitForFunction(() => document.getElementById('sci-figure-image-viewer')?.dataset.figureId === 'figure-2');
  check('adjacent figure keyboard navigation keeps caption state', await viewer.getAttribute('data-caption-visible') === 'true');
  await article.keyboard.press('1'); await article.waitForFunction(() => document.getElementById('sci-figure-image-viewer')?.dataset.figureId === 'figure-1');
  await article.keyboard.press('Escape'); check('Escape closes viewer', await viewer.count() === 0);

  page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(`chrome-extension://${id}/popup.html`); await page.waitForFunction(() => panelUiReady === true);
  await page.evaluate(() => {
    currentWorkspaceSnapshot = { url: 'https://fixture.invalid/a', documentHash: 'a'.repeat(64), title: 'UI020', figures: { figures: [] }, localWorkspace: { workspaceId: 'workspace:' + 'a'.repeat(64), workspaceGeneration: 1, canonicalUrl: 'https://fixture.invalid/a', contentHash: 'a'.repeat(64) } };
    activePanelTabContext.tabId = 4; activePanelTabContext.activated = true;
    document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
    window.ui020 = { imports: [], pdf: [] };
    supplementalFigureImportTools.deliverImport = async (target, request) => { ui020.imports.push({ target, request }); return { figureLabel: 'Figure S2', panelHints: ['A', 'B'] }; };
    openSupplementalMaterialPdf = async (material, target, file) => { ui020.pdf.push({ material, target, name: file.name }); return { message: '受控 PDF 入口已接收' }; };
    refreshArticleWorkspace = async () => {};
    openSupplementalFigureImportDialog();
  });
  const dialog = page.locator('#supplementalFigureImportDialog');
  await dialog.waitFor({ state: 'visible' });
  for (const width of [320, 420, 640]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await dialog.evaluate(n => ({ radius: getComputedStyle(n.querySelector('[data-supplemental-source-pane="manual"]')).borderRadius, text: getComputedStyle(n.querySelector('h2')).color, background: getComputedStyle(n.querySelector('form')).backgroundColor, overflow: n.scrollWidth > n.clientWidth + 1, footer: n.querySelector('footer').getBoundingClientRect().bottom <= innerHeight }));
    check(`${width}: supplemental form uses neutral grid and fixed visible footer`, metrics.radius === '0px' && metrics.text === 'rgb(32, 32, 32)' && metrics.background === 'rgb(255, 255, 255)' && !metrics.overflow && metrics.footer, metrics);
    await shot(page, `manual-${width}`);
  }
  await dialog.getByRole('button', { name: '继续', exact: true }).click();
  check('empty manual submission retains validation', await page.locator('#supplementalFigureImportStatus').getAttribute('class').then(x => x.includes('is-error')) && await dialog.isVisible());
  await page.locator('#supplementalFigureLabel').fill('Figure S2');
  await page.locator('#supplementalFigureSourcePage').fill('8');
  await page.locator('#supplementalFigureImageCaption').fill('Figure S2. (A) Design. (B) Quantification.');
  await page.locator('#submitSupplementalFigureImport').click();
  await dialog.waitFor({ state: 'hidden' });
  check('caption-only import preserves page and figure metadata', await page.evaluate(() => ui020.imports.length === 1 && JSON.stringify(ui020.imports[0]).includes('Figure S2') && JSON.stringify(ui020.imports[0]).includes('8')));
  await page.evaluate(() => openSupplementalFigureImportDialog());
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
  await page.locator('#supplementalFigureImageFile').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
  check('image picker displays chosen filename', (await page.locator('#supplementalFigureSelectedImage').innerText()).includes('fixture.png'));
  await page.locator('#supplementalFigurePasteTarget').evaluate((n, data) => { const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(data)], 'pasted.png', { type: 'image/png' })); n.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer })); }, [...png]);
  check('image paste retains existing clipboard path', await page.evaluate(() => supplementalFigureImportSession.clipboardFile?.name === 'pasted.png'));
  await page.locator('[name="supplementalFigureSourceMode"][value="pdf"]').check();
  await shot(page, 'pdf-mode');
  await page.locator('#supplementalFigurePdfFile').setInputFiles({ name: 'supplement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\ncontrolled fixture\n%%EOF') });
  await page.locator('#submitSupplementalFigureImport').click(); await dialog.waitFor({ state: 'hidden' });
  check('PDF selection reaches existing parser entry with chosen file', await page.evaluate(() => ui020.pdf.length === 1 && ui020.pdf[0].name === 'supplement.pdf'));
  await page.evaluate(() => openSupplementalFigureImportDialog()); await page.locator('#cancelSupplementalFigureImport').click();
  check('cancel closes without further import', !await dialog.isVisible() && await page.evaluate(() => ui020.imports.length === 1));
  check('no browser page errors', report.errors.length === 0, report.errors);
} catch (error) { report.error = String(error.stack || error); console.error(report.error); if (page) await shot(page, 'failure').catch(() => {}); }
finally {
  await context?.close(); await new Promise(resolve => server.close(resolve));
  if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) && /^brevess-ui020-/.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  report.status = !report.error && report.checks.every(c => c.pass) ? 'PASS' : 'FAIL';
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2)); console.log('EVIDENCE ' + run); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
