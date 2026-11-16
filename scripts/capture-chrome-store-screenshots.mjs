import { projectFile } from './project-paths.cjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.BREVESS_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Usage: node scripts/capture-chrome-store-screenshots.mjs dist/RELEASE_NAME');
const release = path.resolve(process.argv[2]);
const output = projectFile('docs/chrome-store/assets');
const diagnostics = projectFile('tmp/chrome-store/browser');
fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(diagnostics, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-chrome-store-'));
const report = { package: JSON.parse(fs.readFileSync(path.join(release, 'release-manifest.json'))).artifact,
  browserPath: 'Playwright Chromium; Browser plugin unavailable; Ego Extensions.loadUnpacked unavailable',
  viewport: { width: 1280, height: 800 }, checks: [], errors: [], warnings: [], externalRequests: [], screenshots: [] };
const fixture = fs.readFileSync(projectFile('docs/reviewer-demo.html'));
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(fixture); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const demoUrl = `http://127.0.0.1:${server.address().port}/reviewer-demo.html`;
const extension = path.join(release, 'extension');
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
  viewport: report.viewport, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
const compositorBrowser = await chromium.launch({channel:'chromium',headless:true});
let current;
const track = page => {
  page.on('pageerror', error => report.errors.push({ page: page.url(), message: error.message }));
  page.on('console', message => { if (['warning', 'error'].includes(message.type()))
    report.warnings.push({ page: page.url(), level: message.type(), message: message.text().slice(0, 500) }); });
};
context.pages().forEach(track); context.on('page', track);
context.on('request', req => { if (/^https?:/.test(req.url()) && !req.url().startsWith(demoUrl.replace('/reviewer-demo.html','/')))
  report.externalRequests.push({ origin: new URL(req.url()).origin, type: req.resourceType() }); });
const check = (name, evidence) => { report.checks.push({ name, status: 'PASS', evidence }); console.log(`PASS ${name}`); };
async function shot(page, name) {
  await page.screenshot({ path: path.join(output, name), fullPage: false }); report.screenshots.push(name);
}
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  report.extensionId = id;
  report.browser = await (await context.newCDPSession(context.pages()[0])).send('Browser.getVersion');
  check('MV3 worker loaded', worker.url());
  current = await context.newPage();
  await current.goto(`chrome-extension://${id}/options.html`);
  await current.locator('[data-settings-nav="shortcuts"]').click();
  await current.locator('#globalLanguage').waitFor();
  await current.waitForFunction(() => document.querySelectorAll('[data-settings-nav]').length > 5);
  check('Settings page identity/nonblank', { url: current.url(), title: await current.title() });
  await current.selectOption('#globalLanguage', 'en');
  await current.waitForFunction(() => document.documentElement.lang.startsWith('en'));
  check('English language control', await current.locator('body').innerText().then(s=>s.slice(0,300)));
  await current.selectOption('#globalLanguage', 'zh-CN');
  await current.locator('[data-settings-nav="models"]').click();
  await current.waitForFunction(() => document.querySelector('[data-settings-nav="models"]').getAttribute('aria-selected') === 'true');
  check('Settings model navigation', 'Models settings selected via visible button');
  await shot(current, 'screenshot-3-model-settings-1280x800.png');

  const workbench = current = await context.newPage();
  workbench.on('dialog', d => d.accept());
  await workbench.goto(`chrome-extension://${id}/workbench/index.html`);
  await workbench.locator('.workbench-more summary').click();
  await workbench.locator('.workbench-more [data-action="demo"]').click();
  await workbench.locator('#modal[open] [data-close]').click();
  await workbench.waitForFunction(() => document.querySelectorAll('#stage [data-object]').length > 0, undefined, {timeout:15000});
  await workbench.locator('[data-action="fit"]').click();
  check('Workbench built-in demo', { title: await workbench.title(), objects: await workbench.locator('#stage [data-object]').count() });
  await shot(workbench, 'screenshot-4-hypothesis-1280x800.png');
  await workbench.locator('[data-action="mode-figure"]').click();
  await workbench.waitForFunction(() => document.querySelector('[data-action="mode-figure"]').classList.contains('active'));
  await workbench.locator('[data-action="fit"]').click();
  check('Workbench figure module switch', 'Figure-planning tab selected via visible button');
  await shot(workbench, 'screenshot-5-figure-planning-1280x800.png');

  const article = current = await context.newPage();
  await article.setViewportSize({ width: 860, height: 800 });
  await article.goto(demoUrl);
  const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t=>t.url === url), demoUrl);
  if (!tab?.id) throw new Error('Fixture tab not found');
  // Capture the real panel application at its normal width. This is not proof of native panel opening.
  await worker.evaluate(async tab => {
    const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(()=>{});
  }, tab);
  const panel = current = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 800 });
  await panel.goto(`chrome-extension://${id}/popup.html`);
  await worker.evaluate(tab => chrome.tabs.update(tab.id, { active: true }), tab);
  await panel.evaluate(async () => { await synchronizeActiveTabContext({ force: true }); });
  await panel.waitForFunction(() => /Brevess Reviewer Demo/.test(document.getElementById('sidePanelPaperTitle')?.textContent || ''));
  await panel.evaluate(() => switchWorkspaceView('navigation'));
  await panel.waitForFunction(() => document.querySelectorAll('details.workspace-tree-node').length >= 3);
  check('Reading panel parses demo paper', await panel.locator('#sidePanelPaperTitle').innerText());
  const compose = async name => {
    const [a,p] = await Promise.all([article.screenshot(), panel.screenshot()]);
    const compositor = await compositorBrowser.newPage();
    await compositor.setViewportSize({ width: 1280, height: 800 });
    await compositor.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;display:flex;width:1280px;height:800px}img{display:block;height:800px}img:last-child{border-left:1px solid #c8d6df;width:420px}</style></head><body><img width="860" src="data:image/png;base64,${a.toString('base64')}"><img src="data:image/png;base64,${p.toString('base64')}"></body></html>`);
    await shot(compositor, name); await compositor.close();
  };
  await compose('screenshot-1-navigation-1280x800.png');
  await panel.evaluate(async () => {
    switchWorkspaceView('analysis');
    if (analysisMode !== 'regex') await queueAnalysisModeMutation('regex');
    selectedCategories = new Set(getCategoryEntriesForEngine('regex').map(([id])=>id));
    renderCategories(); updateApplyButton();
  });
  await panel.locator('#applyHighlight').click();
  await article.waitForFunction(() => document.querySelectorAll('.sci-highlight').length >= 3);
  check('Offline rule highlighting', { highlights: await article.locator('.sci-highlight').count() });
  await article.evaluate(() => document.getElementById('results')?.scrollIntoView());
  await compose('screenshot-2-rule-highlights-1280x800.png');
  report.status = report.errors.length ? 'FAIL' : 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = error.stack;
  if (current) {
    await current.screenshot({ path: path.join(diagnostics, 'failure.png') }).catch(()=>{});
    fs.writeFileSync(path.join(diagnostics, 'failure.txt'), await current.locator('body').innerText().catch(()=>''));
  }
  console.error(error); process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(diagnostics,'smoke.json'), JSON.stringify(report,null,2));
  await context.close(); await compositorBrowser.close(); server.close(); fs.rmSync(profile,{recursive:true,force:true});
}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,errors:report.errors,screenshots:report.screenshots},null,2));
