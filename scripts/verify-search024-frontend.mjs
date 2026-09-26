// Real cold J injection + production DOM corpus/controller/highlights. Only scoring
// transport is replaced inside the isolated extension world. No real provider/API.
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
const run = path.join(root, 'output/playwright/ui025-search024-frontend/search024', `run-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-search024-ui-'));
const extension = path.join(temporary, 'extension');
const report = { repositoryRoot: root, extensionSourceRoot, preCopySourceHashes: {}, copiedResourceHashes: {}, status: 'FAIL', checks: [], screenshots: [], hashes: {}, errors: [], realApiCalls: 0,
  boundary: 'Actual J cold injection, DOM extraction, controller and CSS Custom Highlights in isolated Edge. Local generic/PubMed-like fixtures, not live PubMed; deterministic scoring transport replaces provider only.' };
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
function fixture(kind) {
  return `<!doctype html><meta charset="utf-8"><title>SEARCH024 ${kind}</title><style>body{font:16px/1.65 system-ui;margin:32px;max-width:850px;color:#222}article{padding:18px;border-bottom:1px solid #ddd}h2{font-size:20px}a{color:#245c81}td{padding:8px}#offscreen{margin-top:1100px}</style>
  <header><h1>${kind === 'pubmed' ? 'PubMed-like search results (local test)' : 'Generic website (local test)'}</h1><label>原网页输入框 <input id="site-input"></label></header>
  <main><article class="docsum-content"><h2>LOWMATCH — earlier result with lower relevance.</h2><p>Author details and a short abstract.</p></article>
  <article class="docsum-content"><h2>HIGHMATCH — strongest matching result.</h2><a id="source-link" href="#destination">LINKMATCH — open original source.</a><span>2026 · Short visible metadata</span></article>
  <table><tr><td>TIEDMATCH — equally strong table text.</td><td>Independent cell</td></tr></table>
  <p class="sci-manual-highlight">Previously saved manual annotation stays intact.</p>
  <div hidden>Hidden content must not be sent.</div><div id="offscreen">OFFSCREENMATCH — loaded below the viewport.</div><p id="destination">Link destination.</p></main>
  <script>window.linkClicks=0;document.getElementById('source-link').addEventListener('click',e=>{window.linkClicks++;e.preventDefault()});</script>`;
}
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fixture(req.url.includes('pubmed') ? 'pubmed' : 'generic')); });
let context, page;
async function shot(name) { await page.screenshot({ path: path.join(run, `${name}.png`) }); report.screenshots.push(`${name}.png`); }
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  report.preCopySourceHashes = runtimeResourceHashes(extensionSourceRoot);
  fs.mkdirSync(extension);
  for (const dir of resourceDirectories) fs.cpSync(path.join(extensionSourceRoot, dir), path.join(extension, dir), { recursive: true });
  for (const file of fs.readdirSync(extensionSourceRoot)) if (/\.(js|mjs|html|css)$/.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(extensionSourceRoot, file), path.join(extension, file));
  report.copiedResourceHashes = runtimeResourceHashes(extension);
  if (JSON.stringify(report.preCopySourceHashes) !== JSON.stringify(report.copiedResourceHashes)) throw Error('VERIFIER_RESOURCE_COPY_MISMATCH');
  for (const file of ['semantic-find-controller.js', 'semantic-find.css', 'semantic-find-content.js', 'semantic-find-launcher.js', 'core/semantic-find-dom.js', 'core/tab-messenger.js', 'content.js']) report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, file))).digest('hex');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, viewport: { width: 1080, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost']
  });
  await context.route(/^https?:\/\//, route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(() => { globalThis.fetch = async () => { throw Error('NO_REAL_API_SEARCH024'); }; });
  for (const kind of ['generic', 'pubmed']) {
    page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    const cdp = await context.newCDPSession(page), worlds = [];
    cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
    await cdp.send('Runtime.enable');
    await page.goto(`${base}/${kind}`);
    await page.locator('#site-input').fill(''); await page.locator('#site-input').press('j');
    check(`${kind}: J types normally in the original website input`, await page.locator('#site-input').inputValue() === 'j' && await page.locator('.sci-semantic-find').count() === 0);
    await page.locator('h1').click(); await page.keyboard.press('j');
    await page.locator('.sci-semantic-find:not([hidden])').waitFor({ timeout: 20000 });
    const world = worlds.find(c => c.name === extensionId || c.origin === `chrome-extension://${extensionId}`);
    if (!world) throw Error('EXTENSION_WORLD_NOT_FOUND');
    async function isolated(expression) {
      const response = await cdp.send('Runtime.evaluate', { expression, contextId: world.id, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    }
    check(`${kind}: J opens without enabling the side panel`, await isolated(`!sidePanelShortcutScope.enabled`));
    await isolated(`(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.search024 = { requests: [], hold: false, release: null };
      chrome.runtime.sendMessage = async (...args) => {
        const message = args[0];
        if (message.type === 'LLM_SEMANTIC_FIND_CANCEL') { search024.cancelled = true; return { success: true }; }
        if (message.type !== 'LLM_SEMANTIC_FIND') return original(...args);
        search024.requests.push(message);
        if (search024.hold) await new Promise(resolve => { search024.release = resolve; });
        const sentences = SciLLM.createSemanticFindSentences(message.paragraphs);
        const score = text => /HIGHMATCH|TIEDMATCH/.test(text) ? .96 : /LINKMATCH/.test(text) ? .86 : /LOWMATCH/.test(text) ? .75 : /OFFSCREENMATCH/.test(text) ? .82 : .2;
        return { success: true, data: { operationId: message.operationId, sourceKey: message.sourceKey, total: sentences.length, processed: sentences.length, skipped: 0, complete: true, scores: sentences.map(s => ({ id: s.id, score: score(s.text) })) } };
      };
    })()`);
    const role = name => page.locator(`[data-semantic-find-role="${name}"]`);
    await role('query').fill('matching research results'); await role('query').press('Enter');
    await role('status').filter({ hasText: '找到' }).waitFor();
    const current = () => isolated(`Array.from(CSS.highlights.get('sci-semantic-search-current') || [], range => range.toString()).join(' ')`);
    check(`${kind}: highest score focuses before the earlier weaker result`, /HIGHMATCH/.test(await current()) && await role('position').innerText() === '1 / 5');
    await role('next').click();
    check(`${kind}: equal scores retain source order`, /TIEDMATCH/.test(await current()) && await role('score').innerText() === '当前分值 0.96');
    await role('next').click();
    check(`${kind}: next result follows descending score`, /LINKMATCH/.test(await current()));
    await role('previous').click();
    check(`${kind}: previous follows the same ranked order`, /TIEDMATCH/.test(await current()));
    check(`${kind}: scope text accurately includes offscreen loaded text`, /屏幕外|屏外/.test(await role('scope').innerText()) && /无需.*侧栏/.test(await role('scope').innerText()));
    const outbound = (await isolated(`search024.requests[0].paragraphs.map(p=>p.text)`)).join('\n');
    check(`${kind}: titles, links, metadata, table and offscreen text reach the scorer`, ['HIGHMATCH', 'LINKMATCH', 'Short visible metadata', 'TIEDMATCH', 'OFFSCREENMATCH'].every(text => outbound.includes(text)) && !outbound.includes('Hidden content must not be sent'));
    await role('threshold-number').fill('0.9'); await role('threshold-number').press('Tab');
    check(`${kind}: threshold filters without sending a second request`, /\/ 2$/.test(await role('position').innerText()) && await isolated('search024.requests.length') === 1);
    check(`${kind}: result status follows the changed threshold`, /找到 2 条/.test(await role('status').innerText()));
    await page.locator('#source-link').click();
    check(`${kind}: highlighted original links retain click handling`, await page.evaluate(() => linkClicks === 1));
    await page.locator('#source-link').focus(); await page.keyboard.press('Enter');
    check(`${kind}: original link Enter activation is not stolen`, await page.evaluate(() => linkClicks === 2));
    await role('query').focus(); await role('query').dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
    check(`${kind}: composition Enter does not submit again`, await isolated('search024.requests.length') === 1);
    for (const width of [320, 520, 1080]) {
      await page.setViewportSize({ width, height: 800 });
      check(`${kind}/${width}: compact search panel fits viewport`, await page.locator('.sci-semantic-find').evaluate(n => { const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && n.scrollWidth <= n.clientWidth + 1; }));
      check(`${kind}/${width}: threshold slider and value share one compact row`, await page.locator('.sci-semantic-find__threshold').evaluate(n => {
        const [range, number] = n.querySelectorAll('input');
        return Math.abs(range.getBoundingClientRect().top - number.getBoundingClientRect().top) < 3;
      }));
      if (kind === 'pubmed' || width === 320) await shot(`${kind}-${width}`);
    }
    await isolated(`search024.hold = true`);
    await role('query').fill('later query'); await role('query').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-semantic-find-role="status"]').textContent.includes('正在检查'));
    await role('query').fill('');
    await isolated(`search024.hold = false; search024.release?.();`);
    check(`${kind}: clearing query cancels in-flight scores`, await isolated('search024.cancelled === true') && await role('position').innerText() === '0 / 0');
    await role('close').click();
    check(`${kind}: close clears only temporary marks`, await isolated(`![...CSS.highlights.keys()].some(k=>k.startsWith('sci-semantic-search-'))`) && await page.locator('.sci-manual-highlight').count() === 1);
    await cdp.detach(); await page.close();
  }
  check('no page errors', report.errors.length === 0, report.errors);
  report.status = report.checks.every(item => item.pass) ? 'PASS' : 'FAIL';
} catch (error) {
  report.error = String(error.stack || error); console.error(report.error);
  if (page && !page.isClosed()) await shot('failure').catch(() => {});
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  console.log(run);
  if (report.status !== 'PASS') process.exitCode = 1;
}
