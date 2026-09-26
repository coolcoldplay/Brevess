// SEARCH-024: isolated browser, real DOM and full J/provider path. Provider is
// deterministic loopback only; no configured user profile or real AI is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { validateSemanticFindRequest, fixtureHtml } from './verify-semantic-find.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = path.resolve(option('--output-dir', path.join(repository, 'output', `search024-${Date.now()}`)));
assert.ok(!fs.existsSync(output), 'evidence directory must be new');
fs.mkdirSync(output, { recursive: true });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const report = { startedAt: new Date().toISOString(), realModelCalls: 0, checks: {}, requests: [], errors: [] };
const persist = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const checks = (name, value = true) => { report.checks[name] = value; persist(); };
const actualPubmedPath = option('--pubmed-html', '');
const actualPubmed = actualPubmedPath ? fs.readFileSync(path.resolve(actualPubmedPath), 'utf8') : '';
const html = `<!doctype html><meta charset="utf-8"><title>SEARCH024 generic fixture</title>
<style>body{font:18px Arial;margin:30px} .gone{display:none} .contents{display:contents} td{padding:8px} #offscreen{margin-top:1400px} .clip{position:absolute;clip:rect(0px,0px,0px,0px)} </style>
<h1 id="heading">High heading visible.</h1><nav><a id="link" href="#destination">Independent link visible.</a></nav>
<main><div class="card"><h2>Result card one visible.</h2><p id="inline">Inline <b>nested</b><br>exact range visible.</p></div>
<div class="card"><h2>Result card two visible.</h2><span id="short">Short span visible.</span><ul><li>List item visible.</li></ul></div>
<table><tr><td>Cell one visible.</td><td>Cell two visible.</td></tr></table>
<button id="button">Button label visible.</button><div class="contents"><span>Contents child visible.</span></div>
<p id="duplicate1">Duplicate visible.</p><p id="duplicate2">Duplicate visible.</p><p id="low">Low score visible.</p>
<div hidden>EXCLUDED hidden.</div><div style="display:none">EXCLUDED display.</div>
<div style="visibility:hidden"><span>EXCLUDED visibility.</span></div><div style="opacity:0">EXCLUDED opacity.</div>
<p style="color:transparent">EXCLUDED transparent text.</p><p style="-webkit-text-fill-color:transparent">EXCLUDED transparent fill.</p>
<div style="content-visibility:hidden">EXCLUDED content visibility.</div><div class="clip">EXCLUDED clipping.</div>
<input value="EXCLUDED input"><input type="password" value="EXCLUDED password"><textarea>EXCLUDED textarea.</textarea>
<select><option>EXCLUDED select.</option></select><div contenteditable>EXCLUDED editor.</div>
<details id="details"><summary>Details summary visible.</summary><p>Revealed detail visible.</p></details>
<div data-sci-plugin-ui>EXCLUDED plugin UI.</div><p id="annotated">Annotated <mark class="sci-llm-highlight">source visible.</mark><sup class="sci-manual-note-marker">EXCLUDED note.</sup></p>
<p id="gap">Before gap <span contenteditable>EXCLUDED inline editor.</span>after gap visible.</p>
<div id="partially-clipped" style="width:120px;height:20px;overflow:hidden;font:16px/20px monospace">VISIBLE-FIRST EXCLUDED-SECOND EXCLUDED-THIRD EXCLUDED-FOURTH</div>
<img alt="EXCLUDED alt" title="EXCLUDED title"><span aria-label="EXCLUDED aria">Screen label visible.</span>
<canvas>EXCLUDED canvas fallback.</canvas><iframe srcdoc="EXCLUDED iframe"></iframe>
<div id="shadow-host"><span slot="label">Slotted source visible.</span></div><div id="closed-host"></div>
<p id="offscreen">Offscreen loaded visible.</p><div id="destination">Destination visible.</div></main>
<script>document.querySelector('#shadow-host').attachShadow({mode:'open'}).innerHTML='<p>Shadow source visible.</p><slot name="label"></slot><input id="shadow-input" value="">';document.querySelector('#closed-host').attachShadow({mode:'closed'}).innerHTML='<p>EXCLUDED closed shadow.</p>';document.querySelector('#link').addEventListener('click',()=>document.body.dataset.linkClicked='yes');document.querySelector('#button').addEventListener('click',()=>document.body.dataset.buttonClicked='yes');</script>`;
const pubmedStyle = `<!doctype html><meta charset="utf-8"><title>PubMed structure fixture</title><style>body{font:18px Arial}.docsum-content{margin:24px}</style><h1>Search results</h1><main id="search-results"><div class="search-results-chunk results-chunk">
${[1,2,3].map(n => `<article class="full-docsum"><div class="docsum-content"><a class="docsum-title" href="#${n}">Astrocyte result title ${n}.</a><div class="docsum-citation"><span class="docsum-authors">Author ${n}.</span><span class="docsum-journal-citation full-journal-citation">Journal ${n}. 2026.</span><span class="citation-part">PMID: ${40000000+n}</span></div><a href="#full${n}" class="free-resources">Free full text ${n}.</a><div class="full-view-snippet">Calcium signaling finding ${n}.</div></div></article>`).join('')}</div></main>`;
fs.writeFileSync(path.join(output, 'generic.html'), html);
fs.writeFileSync(path.join(output, 'pubmed-structure.html'), pubmedStyle);
let server;
let context;
try {
  server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.method === 'GET') {
      const article = request.url === '/article-dc-lower' ? fixtureHtml()
        .replace('name="citation_doi"', 'name="dc.identifier"')
        .replace('10.0000/brevess.semantic.find.fixture', 'https://doi.org/10.0000/search024.dc-lower') :
        request.url === '/article-dc-upper' ? fixtureHtml()
          .replace('name="citation_doi"', 'name="DC.Identifier"')
          .replace('10.0000/brevess.semantic.find.fixture', 'doi:10.0000/search024.dc-upper') : '';
      const body = article || (request.url === '/article' ? fixtureHtml() : request.url === '/pubmed' ? pubmedStyle :
        request.url === '/actual-pubmed' && actualPubmed ? actualPubmed : html);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(body); return;
    }
    try {
      assert.equal(request.url, '/v1/systemone');
      assert.equal(request.headers.authorization, 'Bearer search024-dummy');
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      const valid = validateSemanticFindRequest(body);
      const row = { query: valid.query, sentences: valid.sentences };
      report.requests.push(row); persist();
      if (valid.query.includes('late')) await new Promise(resolve => setTimeout(resolve, 1800));
      const answers = Object.fromEntries(valid.sentenceIds.map(id => [id, { type: 'noul',
        noul: /High|clearly increased/u.test(valid.sentences[id].text) ? 0.95 :
          /Low score/u.test(valid.sentences[id].text) ? 0.2 : 0.8 }]));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ model: 'jev-1.13.0', answers }));
    } catch (error) { report.errors.push(String(error.stack)); persist(); response.writeHead(500); response.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const extension = path.join(output, 'frozen-extension');
  fs.mkdirSync(extension);
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales', 'cmaps', 'standard_fonts']) {
    if (fs.existsSync(path.join(repository, directory))) fs.cpSync(path.join(repository, directory), path.join(extension, directory), { recursive: true });
  }
  for (const name of fs.readdirSync(repository)) {
    if (/\.(js|mjs|html|css)$/u.test(name) || name === 'manifest.json') fs.copyFileSync(path.join(repository, name), path.join(extension, name));
  }
  report.sourceHashes = Object.fromEntries(['core/semantic-find-dom.js', 'semantic-find-content.js',
    'core/tab-messenger.js', 'semantic-find-controller.js', 'semantic-find.css', 'content.js'].map(name =>
    [name, hash(fs.readFileSync(path.join(extension, name)))]));
  fs.writeFileSync(path.join(extension, 'search024-rpc.html'), '<!doctype html><title>SEARCH024 isolated RPC</title>');
  const workerPath = path.join(extension, 'offscreen-network-worker.js');
  fs.writeFileSync(workerPath, `const search024Fetch=fetch.bind(globalThis);globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input.url);if(url.origin!=='https://api.typesafe.ai'||url.pathname!=='/v1/systemone')throw Error('SEARCH024_NETWORK_BLOCKED');return search024Fetch(${JSON.stringify(origin + '/v1/systemone')},init);};\n` + fs.readFileSync(workerPath, 'utf8'));
  context = await chromium.launchPersistentContext(path.join(output, 'isolated-profile'), {
    channel: option('--browser', 'msedge'), headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  context.on('page', page => page.on('pageerror', error => report.errors.push(String(error))));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const rpc = await context.newPage();
  await rpc.goto(`chrome-extension://${extensionId}/search024-rpc.html`);
  await rpc.evaluate(async () => {
    const send = async data => { const result = await chrome.runtime.sendMessage(data); if (!result.success) throw Error(JSON.stringify(result.error)); return result.data; };
    const state = await send({ type: 'LLM_GET_SETTINGS' });
    await send({ type: 'LLM_SAVE_PROFILE', profile: { id: 'profile_search024', name: 'SEARCH024 fixture', providerId: 'typesafe', config: { apiKey: 'search024-dummy', model: 'jev-1.13.0' } } });
    await send({ type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: state.settings.globalProfileId,
      taskPolicies: { ...state.settings.taskPolicies, semantic_find: { mode: 'profile', profileId: 'profile_search024' } } });
    await send({ type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'regex', consentGranted: true } });
  });
  const page = await context.newPage();
  const openJ = async () => {
    const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
    for (let attempt = 0; attempt < 100; attempt++) {
      const key = await worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId },
        func: () => globalThis.__brevessSemanticFindShortcut?.shortcutKey }))[0]?.result, id);
      if (key === 'J') { await page.keyboard.press('j'); return; }
      await page.waitForTimeout(100);
    }
    throw Error('shortcut did not bootstrap');
  };
  await page.goto(origin + '/generic');
  // Module-level browser checks happen in page main world without mocking DOM.
  await page.addScriptTag({ path: path.join(extension, 'core/article-extractor.js') });
  await page.addScriptTag({ path: path.join(extension, 'core/semantic-find-dom.js') });
  const baseline = await page.evaluate(() => SciLLM.extractArticle(document).map(p => p.text));
  fs.writeFileSync(path.join(output, 'before-article-corpus.json'), JSON.stringify(baseline, null, 2));
  assert.ok(!baseline.some(text => text.includes('Independent link visible.')));
  checks('legacyArticleExtractorMissesStandaloneLink');
  const read = await page.evaluate(() => {
    globalThis.domSnapshot = SciLLM.createSemanticFindDomSnapshot(document, { normalizeTextWithOffsets: SciLLM.normalizeTextWithOffsets });
    const paragraphs = domSnapshot.paragraphs;
    const ranges = paragraphs.map(p => ({ text: p.text, range: domSnapshot.ranges({ paragraphId: p.paragraphId, start: 0, end: p.text.length, text: p.text }).map(range => range.toString()).join('') || null }));
    return { paragraphs, ranges, nodeCount: [...domSnapshot.bindings.values()].flatMap(b => b.parts.filter(p => p.node).map(p => p.node)).length,
      uniqueCount: new Set([...domSnapshot.bindings.values()].flatMap(b => b.parts.filter(p => p.node).map(p => p.node))).size };
  });
  const corpusText = read.paragraphs.map(p => p.text).join('\n');
  for (const phrase of ['High heading visible.', 'Independent link visible.', 'Short span visible.',
    'List item visible.', 'Cell one visible.', 'Cell two visible.', 'Button label visible.', 'Contents child visible.',
    'Offscreen loaded visible.', 'Shadow source visible.', 'Slotted source visible.', 'Screen label visible.']) assert.ok(corpusText.includes(phrase), phrase);
  assert.ok(!corpusText.includes('EXCLUDED'));
  assert.ok(!corpusText.includes('Revealed detail'));
  assert.equal(read.nodeCount, read.uniqueCount);
  assert.equal(read.paragraphs.filter(p => p.text === 'Duplicate visible.').length, 2);
  assert.ok(read.ranges.every(item => item.range !== null));
  assert.ok(read.ranges.every(item => !item.range.includes('EXCLUDED')));
  assert.equal(read.ranges.find(item => item.text === 'Inline nested exact range visible.').range, 'Inline nestedexact range visible.');
  fs.writeFileSync(path.join(output, 'dom-corpus.json'), JSON.stringify(read, null, 2));
  checks('genericCoverageAndUniqueTextOwnership'); checks('crossInlineBrRangesAndOpenShadow');
  const noise = await page.evaluate(async () => {
    const paragraph = document.querySelector('#inline');
    for (let index = 0; index < 20; index++) paragraph.style.backgroundColor = `rgb(${index},0,0)`;
    await new Promise(resolve => setTimeout(resolve, 0));
    return { current: domSnapshot.isCurrent(), counters: domSnapshot.counters };
  });
  assert.ok(noise.current); checks('decorativeAnimationNoiseDoesNotInvalidate', noise);
  const rebind = await page.evaluate(async () => {
    document.querySelector('#duplicate1').innerHTML = '<mark class="sci-manual-highlight">Duplicate visible.</mark>';
    await new Promise(resolve => setTimeout(resolve, 0));
    const p = domSnapshot.paragraphs.find(p => p.text === 'Duplicate visible.');
    return { current: domSnapshot.isCurrent(), text: domSnapshot.range({ ...p, start: 0, end: p.text.length })?.toString() };
  });
  assert.equal(rebind.current, true); assert.equal(rebind.text, 'Duplicate visible.'); checks('sameTextAnnotationRebind');
  for (const mutation of ['append', 'hidden', 'text', 'remove', 'details', 'editable', 'opacity', 'class', 'stylesheet', 'body']) {
    const fresh = await page.evaluate(kind => {
      domSnapshot.disconnect(); domSnapshot = SciLLM.createSemanticFindDomSnapshot(document, { normalizeTextWithOffsets: SciLLM.normalizeTextWithOffsets });
      if (kind === 'append') document.body.insertAdjacentHTML('beforeend', '<p id="new-result">New loaded result visible.</p>');
      if (kind === 'hidden') document.querySelector('#short').hidden = true;
      if (kind === 'text') document.querySelector('#heading').firstChild.nodeValue = 'Changed heading visible.';
      if (kind === 'remove') document.querySelector('#duplicate2').remove();
      if (kind === 'details') document.querySelector('#details').open = true;
      if (kind === 'editable') document.querySelector('#button').setAttribute('contenteditable', 'true');
      if (kind === 'opacity') document.querySelector('#offscreen').style.opacity = '0';
      if (kind === 'class') document.querySelector('#inline').className = 'gone';
      if (kind === 'stylesheet') document.querySelector('style').textContent += ' #heading{display:none}';
      if (kind === 'body') document.body.replaceWith(document.createElement('body'));
      return domSnapshot.isCurrent(); // takeRecords must reject before observer callback.
    }, mutation);
    assert.equal(fresh, false, mutation); checks(`synchronousInvalidation_${mutation}`);
  }
  await page.evaluate(() => domSnapshot.disconnect());
  await page.goto(origin + '/generic');
  await openJ();
  const query = page.locator('[data-semantic-find-role="query"]');
  await query.waitFor({ state: 'visible', timeout: 30000 });
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  const active = await worker.evaluate(async id => SciLLM.isTabActivated(chrome.storage.session, await chrome.tabs.get(id)), tabId);
  assert.equal(active, false); checks('jColdStartSidebarInactive');
  const canonicalBeforeSearch = await page.locator('[data-sci-llm-paragraph-id]').count();
  const submit = async text => {
    await query.fill(text); await query.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-semantic-find-role="status"]')?.textContent?.includes('找到'), null, { timeout: 30000 });
  };
  await submit('generic visible');
  const sent = report.requests.filter(r => r.query === 'generic visible').flatMap(r => Object.values(r.sentences));
  assert.equal(sent.filter(s => s.text === 'Duplicate visible.').length, 2);
  assert.equal(new Set(sent.map(s => `${s.paragraph_id}:${s.start}:${s.end}`)).size, sent.length);
  assert.ok(sent.some(s => s.text === 'High heading visible.'));
  assert.ok(sent.some(s => s.text === 'Offscreen loaded visible.'));
  assert.ok(sent.some(s => s.text === 'Shadow source visible.'));
  assert.ok(sent.some(s => s.text === 'VISIBLE-FIRST'));
  assert.ok(sent.every(s => !s.text.includes('EXCLUDED')));
  const painted = await page.evaluate(() => [...CSS.highlights].filter(([name]) => /^sci-semantic-search-\d+$/u.test(name)).map(([name, ranges]) => ({ name, texts: [...ranges].map(range => range.toString()) })));
  assert.ok(painted.some(row => row.name === 'sci-semantic-search-95'));
  assert.ok(painted.some(row => row.name === 'sci-semantic-search-80'));
  const callsBeforeThreshold = report.requests.length;
  await page.locator('[data-semantic-find-role="threshold-number"]').fill('0.1');
  await page.locator('[data-semantic-find-role="threshold-number"]').dispatchEvent('change');
  await page.waitForFunction(() => CSS.highlights.has('sci-semantic-search-20'));
  assert.equal(report.requests.length, callsBeforeThreshold); checks('fullProviderCoverageAnd101BucketsThresholdNoCall');
  await page.locator('#link').click(); assert.equal(await page.locator('body').getAttribute('data-link-clicked'), 'yes');
  await page.locator('#button').click(); assert.equal(await page.locator('body').getAttribute('data-button-clicked'), 'yes');
  await page.locator('#duplicate1').evaluate(element => element.addEventListener('click', () => element.dataset.originalClick = 'yes'));
  await page.locator('#duplicate1').click({ position: { x: 10, y: 10 } });
  assert.equal(await page.locator('#duplicate1').getAttribute('data-original-click'), 'yes');
  assert.equal(await page.locator('#sci-manual-toolbar:not([hidden])').count(), 0);
  assert.equal(await page.locator('[data-sci-llm-paragraph-id]').count(), canonicalBeforeSearch);
  checks('generalSearchCreatesNoCanonicalAnchorsAndOriginalClicks', { canonicalBeforeSearch });
  await page.locator('#shadow-input').fill('');
  await page.locator('#shadow-input').press('j');
  report.hotShadowInput = { value: await page.locator('#shadow-input').inputValue(), expected: 'j' }; persist();
  if (args.includes('--check-hot-input')) {
    assert.equal(report.hotShadowInput.value, 'j'); checks('hotShadowInputJPreserved');
  }
  await page.screenshot({ path: path.join(output, 'generic-j.png') });
  await query.fill('late pending source'); await query.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-semantic-find-role="status"]')?.textContent?.includes('检查'));
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p>New request-time result visible.</p>'));
  await page.waitForFunction(() => document.querySelector('[data-semantic-find-role="status"]')?.textContent?.includes('变化'));
  await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(() => [...CSS.highlights.keys()].some(key => key.startsWith('sci-semantic-search-'))), false);
  checks('pendingMutationRejectsLateProviderPaint');
  await submit('new snapshot');
  assert.ok(report.requests.filter(r => r.query === 'new snapshot').some(r => Object.values(r.sentences).some(s => s.text === 'New request-time result visible.')));
  checks('newSearchIncludesDynamicallyLoadedResult');
  for (const kind of ['empty', 'attribute']) {
    await page.evaluate(type => {
      if (type === 'empty') {
        const paragraph = document.createElement('p'); paragraph.id = 'empty-late';
        paragraph.append(document.createTextNode('')); document.body.append(paragraph);
      } else {
        const style = document.createElement('style'); style.textContent = '#short[data-state="closed"]{display:none}'; document.head.append(style);
      }
    }, kind);
    await query.fill(`late ${kind} review regression`); await query.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-semantic-find-role="status"]')?.textContent?.includes('检查'));
    await page.evaluate(type => {
      if (type === 'empty') document.querySelector('#empty-late').firstChild.nodeValue = 'Late filled text result.';
      else document.querySelector('#short').setAttribute('data-state', 'closed');
    }, kind);
    await page.waitForFunction(() => document.querySelector('[data-semantic-find-role="status"]')?.textContent?.includes('变化'));
    await page.waitForTimeout(2000);
    assert.equal(await page.evaluate(() => [...CSS.highlights.keys()].some(key => key.startsWith('sci-semantic-search-'))), false);
    checks(`pending_${kind}_rejectsLatePaint`);
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => [...CSS.highlights.keys()].some(key => key.startsWith('sci-semantic-search-'))), false);
  checks('escapeClearsOnlyTemporarySearchLayer');
  await page.goto(origin + '/pubmed'); await openJ(); await query.waitFor({ state: 'visible' });
  await submit('pubmed loaded results');
  const pubmedSent = report.requests.filter(r => r.query === 'pubmed loaded results').flatMap(r => Object.values(r.sentences));
  for (let index = 1; index <= 3; index++) {
    assert.ok(pubmedSent.some(s => s.text === `Astrocyte result title ${index}.`));
    assert.ok(pubmedSent.some(s => s.text.includes(`Free full text ${index}.`)));
    assert.ok(pubmedSent.some(s => s.text.includes(`Calcium signaling finding ${index}.`)));
  }
  await page.screenshot({ path: path.join(output, 'pubmed-structure-j.png') }); checks('pubmedStructureAllLoadedCards');
  if (actualPubmed) {
    await page.goto(origin + '/actual-pubmed');
    const titles = await page.locator('.full-docsum .docsum-title').allTextContents();
    assert.equal(titles.length, 10);
    await openJ(); await query.waitFor({ state: 'visible' }); await submit('actual pubmed loaded results');
    const sent = report.requests.filter(r => r.query === 'actual pubmed loaded results')
      .flatMap(r => Object.values(r.sentences)).map(s => s.text).join(' ').replace(/\s+/gu, ' ');
    for (const title of titles) assert.ok(sent.includes(title.replace(/\s+/gu, ' ').trim()), title);
    report.actualPubmed = { replaySha256: hash(actualPubmed), resultTitles: titles.map(t => t.replace(/\s+/gu, ' ').trim()), remoteModelCalls: 0 };
    await page.screenshot({ path: path.join(output, 'actual-pubmed-j.png') }); checks('actualPubmedHtmlCssAllTenLoadedTitles');
  }
  for (const [route, meta] of [['/article', 'citation_doi'], ['/article-dc-lower', 'dc.identifier'], ['/article-dc-upper', 'DC.Identifier']]) {
    await page.goto(origin + route); await openJ(); await query.waitFor({ state: 'visible' });
    assert.equal(await page.locator('.sci-manual-highlight').count(), 0);
    await submit(`cold article confirmation ${meta}`);
    const point = await page.evaluate(() => {
      const ranges = [...(CSS.highlights.get('sci-semantic-search-95') || [])];
      const range = ranges.find(r => r.toString().includes('clearly increased'));
      range.startContainer.parentElement.scrollIntoView({ block: 'center' });
      const rect = [...range.getClientRects()].find(r => r.width > 10);
      return { x: rect.left + 15, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.locator('#sci-manual-toolbar .sci-manual-category').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#sci-manual-toolbar .sci-manual-category').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.sci-manual-highlight').length > 0);
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('.sci-manual-highlight').count());
    await page.screenshot({ path: path.join(output, `cold-article-${meta}-saved.png`) });
    checks(`coldArticleCanonicalConfirmationAndClearPreservesSave_${meta}`);
  }
  report.success = true;
} catch (error) { report.success = false; report.failure = String(error.stack); throw error; }
finally {
  report.finishedAt = new Date().toISOString(); persist();
  await context?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ success: report.success, checks: Object.keys(report.checks).length, output }));
