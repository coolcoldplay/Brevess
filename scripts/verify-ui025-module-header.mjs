// Isolated production popup; refresh transport is controlled, not a real article/API.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
const run = path.join(root, 'output/playwright/ui025-search024-frontend/ui025', `run-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-ui025-'));
const extension = path.join(temporary, 'extension');
const report = { repositoryRoot: root, extensionSourceRoot, preCopySourceHashes: {}, copiedResourceHashes: {}, status: 'FAIL', checks: [], screenshots: [], hashes: {}, errors: [], realApiCalls: 0,
  boundary: 'Production popup and actual DOM events in isolated Edge; controlled local workspace refresh replies, synthetic state, no personal profile or real API.' };
let context, page;
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
async function shot(name) {
  await page.screenshot({ path: path.join(run, `${name}.png`) });
  report.screenshots.push(`${name}.png`);
}
try {
  report.preCopySourceHashes = runtimeResourceHashes(extensionSourceRoot);
  fs.mkdirSync(extension);
  for (const dir of resourceDirectories) fs.cpSync(path.join(extensionSourceRoot, dir), path.join(extension, dir), { recursive: true });
  for (const file of fs.readdirSync(extensionSourceRoot)) if (/\.(js|mjs|html|css)$/.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(extensionSourceRoot, file), path.join(extension, file));
  report.copiedResourceHashes = runtimeResourceHashes(extension);
  if (JSON.stringify(report.preCopySourceHashes) !== JSON.stringify(report.copiedResourceHashes)) throw Error('VERIFIER_RESOURCE_COPY_MISMATCH');
  for (const file of ['popup.js', 'popup.html', 'popup.css', 'ui-swiss.css', 'core/i18n.js']) report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, file))).digest('hex');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce', viewport: { width: 360, height: 850 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost']
  });
  await context.route(/^https?:\/\//, route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw Error('NO_NETWORK_UI025'); }; });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await page.waitForFunction(() => panelUiReady === true);
  await page.evaluate(() => {
    tabContextRequestSequence += 1; clearTimeout(tabContextSyncTimer);
    synchronizeActiveTabContext = async () => false;
    activePanelTabContext = { tabId: 905, url: 'https://fixture.invalid/ui025', key: 'ui025', activated: true, pdfMode: false, tabContextSequence: 1 };
    document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
    document.getElementById('sidePanelDocumentStatusText').textContent = '已激活 · 验收文献';
    document.getElementById('sidePanelPaperTitle').textContent = 'UI025 模块布局验收';
    currentWorkspaceSnapshot = { title: 'UI025', documentHash: 'b'.repeat(64), figures: { figures: [] } };
    window.ui025 = { refreshes: [], hold: false, release: null };
    refreshArticleWorkspace = async options => {
      ui025.refreshes.push(options || {});
      if (ui025.hold) await new Promise(resolve => { ui025.release = resolve; });
      return currentWorkspaceSnapshot;
    };
    refreshManualAnnotationSummary = async () => {};
    literatureNoteDocumentState = { schemaVersion: 3, templateId: 'basic', valuesByTemplate: { basic: {} }, fieldStatusByTemplate: {}, fieldEvidenceByTemplate: {}, fieldUpdatedAtByTemplate: {} };
    document.getElementById('articleNavigationStatus').textContent = '读取完成 · 68 个标题 · 277 段正文';
    document.getElementById('figureWorkspaceSummary').textContent = '已发现 7 张图';
  });
  const viewIds = { navigation: 'workspace-navigation', highlights: 'workspace-highlights', figures: 'workspace-figures', chat: 'workspace-chat', notes: 'literatureNoteDrawer' };
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 850 });
    for (const [view, id] of Object.entries(viewIds)) {
      await page.locator(`[data-workspace-target="${view}"]`).click();
      const panel = page.locator('#' + id);
      check(`${width}/${view}: real tab opens without duplicate heading`, await panel.isVisible() && await panel.locator(':scope > .workspace-view-heading, :scope > .literature-note-heading').count() === 0);
      const geometry = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('.side-panel-global-tools button, .side-panel-global-tools > details > summary')].filter(n => n.checkVisibility());
        const escaped = nodes.filter(n => { const r = n.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 1; }).map(n => n.id);
        return { escaped, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      check(`${width}/${view}: top actions stay inside viewport`, !geometry.overflow && !geometry.escaped.length, geometry);
      const refreshId = view === 'navigation' ? 'refreshArticleNavigation' : view === 'figures' ? 'refreshFigureInventory' : null;
      const visibleRefresh = await page.locator('[data-workspace-refresh]').evaluateAll(nodes => nodes.filter(n => n.checkVisibility()).map(n => n.id));
      check(`${width}/${view}: refresh appears only for original supported modules`, JSON.stringify(visibleRefresh) === JSON.stringify(refreshId ? [refreshId] : []));
      if (refreshId) {
        const geometry = await page.locator('#' + refreshId).evaluate(n => {
          const save = document.getElementById('saveCurrentArticleWorkspace').getBoundingClientRect();
          const r = n.getBoundingClientRect();
          return { correct: r.left >= save.right && Math.abs(save.top - r.top) < 2, svg: !!n.querySelector('svg'), text: n.textContent.trim(), label: n.getAttribute('aria-label'), title: n.title };
        });
        check(`${width}/${view}: SVG refresh is directly right of save with accessible name`, geometry.correct && geometry.svg && !geometry.text && geometry.label && geometry.title, geometry);
      }
      if (width === 360 || (width === 320 && ['figures', 'notes'].includes(view))) await shot(`${width}-${view}`);
    }
  }
  for (const view of ['navigation', 'figures']) {
    await page.locator(`[data-workspace-target="${view}"]`).click();
    await page.evaluate(() => { ui025.refreshes = []; ui025.hold = true; ui025.release = null; });
    const refresh = page.locator(view === 'navigation' ? '#refreshArticleNavigation' : '#refreshFigureInventory');
    await refresh.click();
    await page.waitForFunction(() => ui025.release !== null);
    check(`${view}: refreshing is disabled/busy and uses the same local route`, await refresh.isDisabled() && await refresh.getAttribute('aria-busy') === 'true' && await page.evaluate(() => ui025.refreshes.length === 1 && ui025.refreshes[0].announce === true));
    await refresh.evaluate(n => n.click());
    check(`${view}: repeated click does not duplicate refresh`, await page.evaluate(() => ui025.refreshes.length === 1));
    await page.evaluate(() => { ui025.hold = false; ui025.release(); });
    await page.waitForFunction(id => !document.getElementById(id).disabled, await refresh.getAttribute('id'));
    check(`${view}: completed refresh restores interaction`, await refresh.getAttribute('aria-busy') === null);
  }
  await page.locator('[data-workspace-target="notes"]').click();
  await page.evaluate(() => { document.getElementById('literatureNoteStatus').textContent = '保存失败：请检查本地目录访问权限。'; });
  check('notes: dynamic save error survives header removal and stays visible', await page.locator('#literatureNoteStatus').isVisible());
  await shot('note-save-error');
  await page.locator('[data-workspace-target="chat"]').click();
  check('chat: existing clear action is retained in the active module toolbar', await page.locator('.side-panel-global-tools #clearArticleChat').isVisible());
  check('no browser errors', report.errors.length === 0, report.errors);
  report.status = report.checks.every(item => item.pass) ? 'PASS' : 'FAIL';
} catch (error) {
  report.error = String(error.stack || error); console.error(report.error);
  if (page && !page.isClosed()) await shot('failure').catch(() => {});
} finally {
  await context?.close();
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  console.log(run);
  if (report.status !== 'PASS') process.exitCode = 1;
}
