// Independent SEARCH024 follow-up: frozen runtime bytes, real captured PubMed
// HTML/CSS, production cold-J/DOM/controller/highlights, deterministic scorer only.
// Website dynamic behaviours below are labelled controlled replays, not live JS.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
assert.ok(process.env.SCI_EXTENSION_ROOT?.trim(), 'Explicit frozen SCI_EXTENSION_ROOT is required');
const extensionSourceRoot = fs.realpathSync(path.resolve(process.env.SCI_EXTENSION_ROOT));
const resourceDirectories = ['core', 'providers', 'vendor', 'icons', '_locales'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function runtimeHashes(source) {
  const files = fs.readdirSync(source).filter(file => /\.(js|mjs|html|css)$/.test(file) || file === 'manifest.json');
  const visit = relative => {
    for (const item of fs.readdirSync(path.join(source, relative), { withFileTypes: true })) {
      const file = path.join(relative, item.name);
      if (item.isDirectory()) visit(file); else files.push(file);
    }
  };
  for (const dir of resourceDirectories) visit(dir);
  return Object.fromEntries(files.map(f => f.replaceAll('\\', '/')).sort().map(f => [f, sha(fs.readFileSync(path.join(source, f)))]));
}
const sourceDir = path.join(root, 'output/search024-pubmed-source-02');
const replay = fs.readFileSync(path.join(sourceDir, 'pubmed-replay.html'), 'utf8');
const provenance = JSON.parse(fs.readFileSync(path.join(sourceDir, 'source.json'), 'utf8'));
assert.equal(sha(Buffer.from(replay)), provenance.replaySha256, 'Captured replay must remain byte-identical');
const run = path.join(root, 'output/playwright/search024-pubmed-followup-frontend', `run-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-search-followup-'));
const extension = path.join(temporary, 'extension');
const report = { status: 'FAIL', repositoryRoot: root, extensionSourceRoot, preCopySourceHashes: {}, copiedResourceHashes: {},
  scenarioFilter: process.env.SCI_SCENARIO_FILTER || null,
  scriptSha256: sha(fs.readFileSync(import.meta.filename)), source: provenance, realApiCalls: 0,
  boundary: 'Official captured PubMed HTML/CSS served by local Playwright route at PubMed origin; original remote scripts removed. Explicit controlled scroll/summary toggles plus synthetic generic dynamic feed. Real cold J and production corpus/controller/painting; only scorer transport is substituted. No live PubMed/Bilibili, remote pagination, personal profile or real API.',
  contract: '2026-09-25 updated dynamic-page requirement: preserve unaffected results, retire changed/deleted source paragraphs only, and automatically score replacements/new text in delta-only single-flight batches. Whole navigation identity changes invalidate strictly. Failures retain old successful scores and never auto-retry.',
  checks: [], scenarios: [], screenshots: [], errors: [], blockedExternalRequests: 0 };
let context, page, sequence = 0;
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
const genericHTML = `<!doctype html><meta charset="utf-8"><title>Controlled dynamic feed — not live Bilibili</title>
<style>body{font:16px/1.6 system-ui;margin:30px}article{min-height:180px;border-bottom:1px solid #ddd;padding:16px}header{position:sticky;top:0;background:white}h2{font-size:20px}.decoration{position:fixed;bottom:10px;right:10px}</style>
<header>Controlled feed <span id="views">0</span></header><main>${Array.from({ length: 8 }, (_, i) => `<article class="feed-card"><h2 class="feed-title">Loaded feed entry ${i + 1} has stable source text.</h2><p>Previously loaded content ${i + 1} remains searchable.</p></article>`).join('')}</main>
<div hidden>PRIVATE_HIDDEN_EXCLUDED</div><input type="password" value="PASSWORD_EXCLUDED"><div contenteditable>EDITABLE_EXCLUDED</div>`;

async function shot(name) {
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(run, filename) });
  report.screenshots.push(filename);
}
// Allow render/observer callbacks and the captured site's 300 ms visibility transition.
async function settle() { await page.waitForTimeout(420); }
async function runScenario(name, options, work) {
  if (report.scenarioFilter && !new RegExp(report.scenarioFilter).test(name)) return;
  console.log('SCENARIO ' + name);
  const start = report.checks.length;
  const scenario = { name, options, checks: 0, status: 'FAIL', mutations: [] };
  report.scenarios.push(scenario);
  let cdp;
  try {
    page = await context.newPage();
    await page.setViewportSize({ width: options.width || 1080, height: 850 });
    page.on('pageerror', error => report.errors.push({ scenario: name, error: error.message }));
    const worlds = [];
    cdp = await context.newCDPSession(page);
    cdp.on('Runtime.executionContextCreated', ({ context: world }) => worlds.push(world));
    await cdp.send('Runtime.enable');
    const url = options.generic ? `https://dynamic-fixture.invalid/feed?case=${++sequence}` : `${provenance.url}&brevess_followup=${++sequence}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const fixture = await page.evaluate(({ generic, decorations, toggle }) => {
      const normalize = value => String(value || '').replace(/\s+/gu, ' ').trim();
      const titleSelector = generic ? '.feed-title' : '.docsum-title';
      const titles = [...document.querySelectorAll(titleSelector)].map(n => normalize(n.textContent));
      const long = [...document.querySelectorAll('.full-view-snippet')].map(n => normalize(n.textContent));
      const short = [...document.querySelectorAll('.short-view-snippet')].map(n => normalize(n.textContent));
      const probe = long[0]?.slice(-90) || '';
      window.__followup = { mutations: [], armed: false, scrolls: 0 };
      if (decorations) {
        const style = document.createElement('style');
        // Undo no-script.css solely for the captured website's existing back-to-top widget.
        style.textContent = '.back-to-top{display:block!important}';
        document.head.append(style);
        const top = document.querySelector('.back-to-top');
        top?.classList.remove('visible');
        addEventListener('scroll', () => {
          window.__followup.scrolls++;
          if (window.__followup.armed) top?.classList.toggle('visible', scrollY > 300);
        });
      }
      if (toggle) {
        const wrapper = document.querySelector('.docsum-snippet');
        const button = document.createElement('button');
        button.id = 'fixture-summary-toggle'; button.textContent = '展开/收起已加载摘要（受控回放）';
        button.type = 'button';
        button.addEventListener('click', () => {
          const full = wrapper.querySelector('.full-view-snippet');
          const collapsed = getComputedStyle(full).display === 'none';
          full.style.display = collapsed ? 'block' : 'none';
          wrapper.querySelector('.short-view-snippet').style.display = collapsed ? 'none' : 'block';
        });
        wrapper.prepend(button);
      }
      const observer = new MutationObserver(records => {
        for (const record of records) {
          const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
          if (target?.closest?.('[data-sci-plugin-ui]') || record.target.matches?.('style') ||
              [...record.addedNodes].every(n => n.nodeType === 1 && n.matches?.('[data-sci-plugin-ui],style')) && record.addedNodes.length) continue;
          if (window.__followup.mutations.length >= 150) break;
          window.__followup.mutations.push({ type: record.type, target: target?.tagName + '#' + (target?.id || '') + '.' + (target?.className || ''),
            attribute: record.attributeName, oldValue: record.oldValue?.slice(0, 100), value: record.attributeName ? target?.getAttribute(record.attributeName)?.slice(0, 100) : null,
            added: [...record.addedNodes].map(n => normalize(n.textContent).slice(0, 80)), removed: [...record.removedNodes].map(n => normalize(n.textContent).slice(0, 80)), scrollY });
        }
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
      const fullNode = document.querySelector('.full-view-snippet');
      return { titles, long, short, probe, fullInitiallyHidden: !!fullNode && getComputedStyle(fullNode).display === 'none', titleSelector,
        cardSelector: generic ? '.feed-card' : '.full-docsum' };
    }, options);
    scenario.fixture = fixture;
    assert.ok(fixture.titles.length >= 8, 'Actual fixture result titles must exist');
    let world;
    let shortcutReady = false;
    const readyDeadline = Date.now() + 15000;
    while (!shortcutReady && Date.now() < readyDeadline) {
      world = worlds.find(w => w.name === report.extensionId || w.origin === `chrome-extension://${report.extensionId}`);
      if (world) {
        const ready = await cdp.send('Runtime.evaluate', { expression: 'globalThis.__brevessSemanticFindShortcut?.shortcutKey === "J"', contextId: world.id, returnByValue: true });
        shortcutReady = ready.result.value === true;
      }
      if (!shortcutReady) await page.waitForTimeout(80);
    }
    assert.ok(shortcutReady, 'document_idle launcher and its asynchronous J setting must be ready');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('j');
    await page.locator('.sci-semantic-find:not([hidden])').waitFor({ timeout: 20000 });
    const isolated = async expression => {
      const response = await cdp.send('Runtime.evaluate', { expression, contextId: world.id, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    await isolated(`(() => {
      const normalize = value => SciLLM.normalizeTextWithOffsets(String(value)).text;
      const source = ${JSON.stringify(fixture)};
      const titles = source.titles.map(normalize), probe = normalize(source.probe);
      globalThis.frontendFollowup = { requests: [], pending: [], hold: false, failNext: false, mode: 'titles', cancelled: 0, responses: [] };
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (...args) => {
        const message = args[0];
        if (message.type === 'LLM_SEMANTIC_FIND_CANCEL') { frontendFollowup.cancelled++; return { success: true }; }
        if (message.type !== 'LLM_SEMANTIC_FIND') return original(...args);
        const mode = frontendFollowup.mode;
        frontendFollowup.requests.push(structuredClone(message));
        if (frontendFollowup.hold) await new Promise(resolve => frontendFollowup.pending.push(resolve));
        if (frontendFollowup.failNext) {
          frontendFollowup.failNext = false;
          frontendFollowup.responses.push({ operationId: message.operationId, failed: true });
          return { success: false, error: { code: 'CONTROLLED_FAILURE', message: 'Controlled delta failure; no real API.' } };
        }
        const sentences = SciLLM.createSemanticFindSentences(message.paragraphs);
        const paragraphs = new Map(message.paragraphs.map(p => [p.paragraphId, normalize(p.text)]));
        const scores = sentences.map(s => {
          const text = paragraphs.get(s.paragraphId) || '';
          const index = titles.findIndex(title => text.includes(title));
          const score = mode === 'abstract' && probe && text.includes(probe) ? .999 : /Newly loaded entry|Independent new entry|Failed new entry|Later successful entry|Rewritten source/.test(text) ? .999 : index >= 0 ? .98 - index * .015 : .1;
          return { id: s.id, score };
        });
        frontendFollowup.responses.push({ operationId: message.operationId, sourceKey: message.sourceKey });
        return { success: true, data: { operationId: message.operationId, sourceKey: message.sourceKey,
          total: sentences.length, processed: sentences.length, skipped: 0, complete: true, scores } };
      };
    })()`);
    const role = key => page.locator(`[data-semantic-find-role="${key}"]`);
    const state = async () => ({ ...(await page.locator('.sci-semantic-find').evaluate(n => {
      const text = key => n.querySelector(`[data-semantic-find-role="${key}"]`)?.textContent;
      return { position: text('position'), score: text('score'), status: text('status'), scope: text('scope'), progress: text('progress'), scrollY };
    })), ...(await isolated(`({ requests: frontendFollowup.requests.length, responses: frontendFollowup.responses.length,
      ranges: [...CSS.highlights.entries()].filter(([name]) => name.startsWith('sci-semantic-search-')).flatMap(([name, values]) => [...values].map(range => ({ name, text: range.toString(), connected: range.startContainer.isConnected && range.endContainer.isConnected,
        card: range.startContainer.parentElement?.closest('.full-docsum,.feed-card')?.querySelector('.docsum-title,.feed-title')?.textContent.trim(),
        visible: [...range.getClientRects()].some(r => r.width > 0 && r.height > 0),
        inViewport: [...range.getClientRects()].some(r => r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0),
        inFullSnippet: !!range.startContainer.parentElement?.closest('.full-view-snippet') }))) })`)) });
    const search = async (mode = 'titles') => {
      await isolated(`frontendFollowup.mode=${JSON.stringify(mode)}`);
      await role('query').fill(mode === 'abstract' ? 'loaded collapsed abstract' : 'loaded result titles');
      await role('query').press('Enter');
      await page.waitForFunction(() => /找到|变化|没有匹配|失败/.test(document.querySelector('[data-semantic-find-role="status"]')?.textContent || ''), undefined, { timeout: 15000 });
      await settle();
      if (options.generic && !scenario.initialCorpus) scenario.initialCorpus = await isolated('frontendFollowup.requests[0]?.paragraphs');
      return state();
    };
    const stable = (baseline, value) => value.requests === baseline.requests &&
      Number(value.position?.split('/')[1]) === Number(baseline.position?.split('/')[1]) &&
      Number(value.position?.split('/')[1]) > 0 && value.ranges.length > 0 && !/变化|重新搜索/.test(value.status || '');
    const preserved = (baseline, value) => Number(value.position?.split('/')[1]) >= Number(baseline.position?.split('/')[1]) &&
      baseline.ranges.every(old => value.ranges.some(r => r.text === old.text && r.card === old.card && r.connected)) &&
      value.ranges.length > 0 && !/网页文字或可见范围已变化/.test(value.status || '');
    const waitState = async predicate => {
      const deadline = Date.now() + 6000; let value = await state();
      while (Date.now() < deadline) {
        if (predicate(value)) {
          // A render/observer callback may enqueue work during settle. Recheck
          // the same condition instead of returning a newly non-settled state.
          await settle(); value = await state();
          if (predicate(value)) return value;
        } else {
          await page.waitForTimeout(80); value = await state();
        }
      }
      return value;
    };
    const api = { fixture, isolated, role, state, search, stable, preserved, waitState, scenario };
    await work(api);
    scenario.mutations = await page.evaluate(() => window.__followup.mutations);
    scenario.final = await state();
    await shot(name);
    scenario.checks = report.checks.length - start;
    scenario.status = report.checks.slice(start).every(c => c.pass) ? 'PASS' : 'FAIL';
  } catch (error) {
    scenario.error = String(error.stack || error);
    check(`${name}: scenario completes`, false, scenario.error);
    if (page && !page.isClosed()) {
      scenario.mutations = await page.evaluate(() => window.__followup?.mutations || []).catch(() => []);
      await shot(`${name}-failure`).catch(() => {});
    }
  } finally {
    await cdp?.detach().catch(() => {});
    await page?.close(); page = null;
  }
}

try {
  report.preCopySourceHashes = runtimeHashes(extensionSourceRoot);
  const infoPath = path.join(extensionSourceRoot, 'PACKAGE_INFO.json');
  if (fs.existsSync(infoPath)) {
    const info = JSON.parse(fs.readFileSync(infoPath));
    report.package = { build: info.build, sha256: sha(fs.readFileSync(infoPath)) };
    const manifest = new Map(info.files.map(f => [f.file, f.sha256]));
    for (const [file, hash] of Object.entries(report.preCopySourceHashes)) assert.equal(hash, manifest.get(file), file);
  }
  fs.mkdirSync(extension);
  for (const dir of resourceDirectories) fs.cpSync(path.join(extensionSourceRoot, dir), path.join(extension, dir), { recursive: true });
  for (const f of fs.readdirSync(extensionSourceRoot)) if (/\.(js|mjs|html|css)$/.test(f) || f === 'manifest.json') fs.copyFileSync(path.join(extensionSourceRoot, f), path.join(extension, f));
  report.copiedResourceHashes = runtimeHashes(extension);
  assert.deepEqual(report.copiedResourceHashes, report.preCopySourceHashes);
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true,
    viewport: { width: 1080, height: 850 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'] });
  await context.route(/^https?:\/\//, route => {
    const request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest() && url.hostname === 'pubmed.ncbi.nlm.nih.gov') return route.fulfill({ status: 200, contentType: 'text/html', body: replay });
    if (request.isNavigationRequest() && url.hostname === 'dynamic-fixture.invalid') return route.fulfill({ status: 200, contentType: 'text/html', body: genericHTML });
    report.blockedExternalRequests++; return route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  report.extensionId = new URL(worker.url()).host;
  await worker.evaluate(() => { globalThis.fetch = async () => { throw Error('NO_REAL_API_PUBMED_FOLLOWUP'); }; });

  await runScenario('01-pubmed-pure-scroll-navigation', {}, async ({ search, state, role, stable }) => {
    const before = await search();
    check('pure replay: initial title results exist', before.ranges.length > 0 && Number(before.position.split('/')[1]) >= 10, before);
    await page.mouse.move(400, 550); await page.mouse.wheel(0, 700); await settle();
    check('pure replay: ordinary scroll preserves results without another request', stable(before, await state()));
    const states = [];
    for (const direction of ['next', 'next', 'next', 'previous', 'next', 'previous']) { await role(direction).click(); await settle(); states.push(await state()); }
    check('pure replay: repeated previous/next preserves ranked results', states.every(s => stable(before, s)), states);
  });
  for (const action of ['scroll', 'next']) await runScenario(`02-pubmed-backtop-${action}`, { decorations: true }, async ({ search, state, role, preserved, waitState }) => {
    const before = await search();
    await page.evaluate(() => { scrollTo(0, 0); }); await settle();
    await page.evaluate(() => { window.__followup.armed = true; });
    if (action === 'scroll') { await page.mouse.move(400, 550); await page.mouse.wheel(0, 900); }
    else await role('next').click();
    await settle();
    const after = await state();
    check(`captured back-to-top: ${action} reveals actual widget`, await page.locator('.back-to-top').evaluate(n => n.classList.contains('visible')));
    check(`captured back-to-top: ${action} keeps results/scores/highlights`, preserved(before, after), { before, after });
    const settled = await waitState(value => !/排队|正在补充/.test(value.scope));
    check(`captured back-to-top: ${action} supplemental scan settles without result loss`, preserved(before, settled) && !/排队|正在补充/.test(settled.scope) && settled.requests <= before.requests + 1, settled);
  });
  await runScenario('03-pubmed-collapsed-loaded-snippets', { width: 320, toggle: true }, async ({ fixture, isolated, search, state, role, stable }) => {
    check('captured mobile PubMed has a loaded hidden longer snippet', fixture.fullInitiallyHidden && !!fixture.probe && !fixture.short[0].includes(fixture.probe), fixture);
    const before = await search('abstract');
    const coverage = await isolated(`(() => { const text=frontendFollowup.requests[0].paragraphs.map(p=>p.text).join(' '); return ${JSON.stringify(fixture.long)}.map(s=>({text:SciLLM.normalizeTextWithOffsets(s).text, included:text.includes(SciLLM.normalizeTextWithOffsets(s).text)})); })()`);
    check('all 10 loaded full snippets participate while collapsed', coverage.length === 10 && coverage.every(s => s.included), coverage);
    check('highest hidden-snippet match is revealed and located visibly', before.ranges.some(r => r.name === 'sci-semantic-search-current' && r.inFullSnippet && r.visible && r.inViewport), before);
    await page.locator('#fixture-summary-toggle').click(); await settle();
    const afterToggle = await state();
    check('explicit summary expand/collapse preserves prior results and request count', stable(before, afterToggle), afterToggle);
    const navigable = await role('next').isEnabled() && await role('previous').isEnabled();
    if (navigable) { await role('next').click(); await settle(); await role('previous').click(); await settle(); }
    const afterReturn = await state();
    check('returning to folded abstract restores visible focus without losing results', navigable && stable(before, afterReturn) && afterReturn.ranges.some(r => r.name === 'sci-semantic-search-current' && r.visible && r.inViewport), afterReturn);
  });
  await runScenario('04-unrelated-extension-decoration', {}, async ({ search, state, preserved }) => {
    const before = await search();
    await page.evaluate(() => { const n = document.createElement('aside'); n.className = 'other-extension-decoration'; n.style.cssText = 'position:fixed;bottom:20px;left:10px;background:white'; n.textContent = 'Other extension helper'; document.body.append(n); });
    await settle(); const after = await state();
    check('another extension decoration does not clear existing result bindings', preserved(before, after), { before, after });
  });
  await runScenario('05-generic-dynamic-feed', { generic: true }, async ({ search, state, isolated, role, preserved, waitState }) => {
    const before = await search();
    const outbound = await isolated(`frontendFollowup.requests[0].paragraphs.map(p=>p.text).join(' ')`);
    check('generic hidden/password/editable contents remain excluded', !/PRIVATE_HIDDEN_EXCLUDED|PASSWORD_EXCLUDED|EDITABLE_EXCLUDED/.test(outbound));
    await page.evaluate(() => { document.getElementById('views').textContent = '23'; const card = document.createElement('article'); card.className = 'feed-card'; card.innerHTML = '<h2 class="feed-title">Newly loaded entry awaits a new search.</h2><p>New content was not in the old model request.</p>'; document.querySelector('main').append(card); });
    const after = await waitState(value => value.responses > before.responses);
    check('generic dynamic count/new card preserves existing scored results', preserved(before, after), { before, after });
    check('newly appended matching text is automatically highlighted by one additional request', after.requests === before.requests + 1 && after.ranges.some(r => /Newly loaded entry/.test(r.text)), after);
    const navigable = await role('next').isEnabled();
    if (navigable) { await role('next').click(); await settle(); }
    const afterNext = await state();
    check('generic dynamic feed remains navigable without rescoring old text', navigable && preserved(before, afterNext) && afterNext.requests === after.requests, afterNext);
  });
  await runScenario('05b-independent-append-incremental', { generic: true, width: 320 }, async ({ search, state, role, isolated, preserved, waitState }) => {
    const before = await search();
    await isolated('frontendFollowup.hold = true');
    await page.evaluate(() => {
      const card = document.createElement('article'); card.className = 'feed-card';
      card.innerHTML = '<h2 class="feed-title">Independent new entry awaits a new search.</h2><p>This appended source has no prior score.</p>';
      document.querySelector('main').append(card);
    });
    const after = await waitState(value => value.requests > before.requests);
    check('independent append preserves indexed results while its delta request is pending', preserved(before, after) && /补充检索/.test(after.scope) && after.requests === before.requests + 1, { before, after });
    check('independent appended source has no stale score', !after.ranges.some(r => /Independent new entry|appended source/.test(r.text)));
    const requests = await isolated('frontendFollowup.requests');
    check('incremental request contains only new source paragraphs and an independent source key', requests.length === 2 && requests[1].sourceKey !== requests[0].sourceKey && requests[1].paragraphs.some(p => /Independent new entry/.test(p.text)) && requests[1].paragraphs.every(p => !/Loaded feed entry|Previously loaded content/.test(p.text)), requests.map(r => ({ sourceKey: r.sourceKey, paragraphs: r.paragraphs })));
    const navigable = await role('next').isEnabled();
    if (navigable) { await role('next').click(); await settle(); }
    const afterNext = await state();
    check('old results remain navigable during supplemental search', navigable && preserved(before, afterNext) && afterNext.requests === after.requests, afterNext);
    await role('threshold-number').fill('0.90'); await role('threshold-number').press('Tab'); await settle();
    const afterThreshold = await state();
    check('pending supplemental search survives threshold filtering without extra requests', afterThreshold.requests === after.requests && Number(afterThreshold.position.split('/')[1]) > 0 && /补充检索/.test(afterThreshold.scope), afterThreshold);
    const layout = await page.locator('.sci-semantic-find').evaluate(n => ({ width: n.getBoundingClientRect().width, viewport: innerWidth, overflow: n.scrollWidth > n.clientWidth, height: n.getBoundingClientRect().height }));
    check('scope notice remains inside the existing narrow panel', layout.width <= layout.viewport && !layout.overflow, layout);
    await shot('05b-incremental-pending-320');
    await isolated('frontendFollowup.hold = false; frontendFollowup.pending.splice(0).forEach(release=>release())');
    const merged = await waitState(value => value.responses > before.responses);
    check('supplemental completion paints new matches without replacing filtered old matches', preserved(afterThreshold, merged) && merged.ranges.some(r => /Independent new entry/.test(r.text)), merged);
    const selected = value => value.ranges.filter(r => r.name === 'sci-semantic-search-current').map(r => r.text);
    check('higher-scoring appended matches do not steal the selected result or scroll position', JSON.stringify(selected(merged)) === JSON.stringify(selected(afterThreshold)) && Math.abs(merged.scrollY - afterThreshold.scrollY) < 2 && merged.score === afterThreshold.score, { before: afterThreshold, after: merged });
    await shot('05b-incremental-merged-320');
    await role('query').fill('new search covers appended source'); await settle();
    check('editing a new query clears supplemental scope notice without a model request', !/排队|正在补充/.test((await state()).scope) && (await state()).requests === merged.requests);
    await role('query').press('Enter');
    await page.waitForFunction(() => /找到/.test(document.querySelector('[data-semantic-find-role="status"]')?.textContent || ''), undefined, { timeout: 15000 });
    await settle(); const renewed = await state();
    check('explicit new search starts one fresh request', renewed.requests === merged.requests + 1 && !/排队|正在补充/.test(renewed.scope), renewed);
  });
  await runScenario('05c-incremental-failure-next-batch', { generic: true }, async ({ search, isolated, state, preserved, waitState }) => {
    const before = await search();
    await isolated('frontendFollowup.failNext = true');
    await page.evaluate(() => { const node = document.createElement('article'); node.className = 'feed-card'; node.innerHTML = '<h2 class="feed-title">Failed new entry is not silently retried.</h2>'; document.querySelector('main').append(node); });
    const failed = await waitState(value => value.responses > before.responses);
    check('failed supplemental batch keeps successful original highlights and reports failure', preserved(before, failed) && /失败/.test(failed.status) && !failed.ranges.some(r => /Failed new entry/.test(r.text)), failed);
    await page.waitForTimeout(1100);
    check('failed supplemental batch makes no automatic retry request', (await state()).requests === before.requests + 1);
    await shot('05c-incremental-failure-preserved');
    await page.evaluate(() => { const node = document.createElement('article'); node.className = 'feed-card'; node.innerHTML = '<h2 class="feed-title">Later successful entry can still be scored.</h2>'; document.querySelector('main').append(node); });
    const later = await waitState(value => value.responses > failed.responses);
    check('a different later batch can complete while failed batch remains unscored', preserved(before, later) && later.requests === before.requests + 2 && later.ranges.some(r => /Later successful entry/.test(r.text)) && !later.ranges.some(r => /Failed new entry/.test(r.text)), later);
  });
  for (const action of ['rewrite', 'remove']) await runScenario(`06-real-source-${action}`, { generic: true }, async ({ search, state, isolated, waitState }) => {
    const before = await search();
    if (action === 'rewrite') await isolated('frontendFollowup.hold = true');
    await page.evaluate(action => { const card = document.querySelector('.feed-card'); if (action === 'remove') card.remove(); else card.querySelector('.feed-title').textContent = 'Rewritten source must never inherit the prior score.'; }, action);
    await settle(); const after = await state();
    check(`${action}: changed/deleted source never receives an old score`, after.ranges.every(r => r.connected && !/Rewritten source|Loaded feed entry 1 /.test(r.text)), after);
    const unaffected = before.ranges.filter(r => /Loaded feed entry [2-8]/.test(r.text));
    check(`${action}: unrelated source paragraphs retain their original highlights`, unaffected.every(old => after.ranges.some(r => r.text === old.text && r.card === old.card && r.connected)) && Number(after.position.split('/')[1]) >= 7, after);
    if (action === 'rewrite') {
      const pending = await waitState(value => value.requests > before.requests);
      check('rewritten paragraph queues exactly one supplemental request without scoring its replacement from stale results', pending.requests === before.requests + 1 && !pending.ranges.some(r => /Rewritten source/.test(r.text)), pending);
      await isolated('frontendFollowup.hold = false; frontendFollowup.pending.splice(0).forEach(release=>release())');
      const merged = await waitState(value => value.responses > before.responses);
      check('rewritten paragraph gets a fresh matching highlight while unchanged paragraphs remain', merged.ranges.some(r => /Rewritten source/.test(r.text)) && unaffected.every(old => merged.ranges.some(r => r.text === old.text && r.connected)), merged);
    } else {
      await page.waitForTimeout(700);
      check('deleting a paragraph does not trigger a new scoring request', (await state()).requests === before.requests);
    }
  });
  await runScenario('07-delayed-old-response', { generic: true }, async ({ isolated, role, state }) => {
    await isolated('frontendFollowup.hold = true');
    await role('query').fill('delayed scoring'); await role('query').press('Enter');
    await page.waitForFunction(() => /正在检查/.test(document.querySelector('[data-semantic-find-role="status"]')?.textContent || ''));
    await page.evaluate(() => { document.querySelector('.feed-title').textContent = 'Replacement while old model operation is pending.'; });
    await settle();
    await isolated('frontendFollowup.hold = false; frontendFollowup.pending.splice(0).forEach(release=>release())');
    await settle(); const after = await state();
    check('delayed old response cannot mark changed text or disconnected source', after.ranges.every(r => r.connected && !/Replacement while|Loaded feed entry 1 /.test(r.text)), after);
    check('delayed old response still supplies valid scores for unchanged paragraphs', after.ranges.filter(r => /Loaded feed entry [2-8]/.test(r.text)).length >= 7, after);
  });
  await runScenario('08-navigation-identity', { generic: true }, async ({ search, role, state }) => {
    const before = await search();
    await page.evaluate(() => history.pushState({}, '', '/different-document'));
    await role('next').click(); await settle(); const after = await state();
    check('whole navigation identity change still clears stale document results without rescoring', after.ranges.length === 0 && Number(after.position.split('/')[1]) === 0 && /变化|重新/.test(after.status) && after.requests === before.requests, after);
  });
  await runScenario('09-close-pending-delta', { generic: true }, async ({ search, role, isolated, state, waitState }) => {
    const before = await search(); await isolated('frontendFollowup.hold = true');
    await page.evaluate(() => { const node = document.createElement('article'); node.className = 'feed-card'; node.innerHTML = '<h2 class="feed-title">Independent new entry cancelled before its response.</h2>'; document.querySelector('main').append(node); });
    const pending = await waitState(value => value.requests > before.requests);
    check('close test starts a supplemental request against an existing result set', pending.requests === before.requests + 1);
    await role('close').click();
    await isolated('frontendFollowup.hold = false; frontendFollowup.pending.splice(0).forEach(release=>release())');
    await page.waitForTimeout(900); const after = await state();
    check('closing a pending supplemental search prevents late repaint or extra requests', after.ranges.length === 0 && after.requests === pending.requests && await page.locator('.sci-semantic-find').isHidden(), after);
  });
  check('no browser page errors', report.errors.length === 0, report.errors);
  assert.deepEqual(runtimeHashes(extensionSourceRoot), report.preCopySourceHashes, 'Source resources remain unchanged');
  report.sourceResourcesUnchanged = true;
  report.status = report.checks.every(c => c.pass) ? 'PASS' : 'FAIL';
} catch (error) { report.error = String(error.stack || error); console.error(report.error); }
finally {
  await context?.close();
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  console.log('EVIDENCE ' + run);
  if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) && /^brevess-search-followup-/.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  if (report.status !== 'PASS') process.exitCode = 1;
}
