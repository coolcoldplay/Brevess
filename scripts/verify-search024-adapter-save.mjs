// Real extension adapter/manual-toolbar/storage, frozen runtime, scorer-only fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { fixtureHtml } from './verify-semantic-find.mjs';
const root = path.resolve(import.meta.dirname, '..');
assert.ok(process.env.SCI_EXTENSION_ROOT?.trim(), 'Explicit frozen runtime required');
const source = fs.realpathSync(process.env.SCI_EXTENSION_ROOT);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const infoPath = path.join(source, 'PACKAGE_INFO.json');
let provenance, packageIdentity = null;
if (fs.existsSync(infoPath)) {
  assert.ok(!['SCI_COMPARE_R18_ADAPTER', 'SCI_SELECTION_CONTENT_SOURCE', 'SCI_SAVE_RETIREMENT_ONLY'].some(key => process.env[key]),
    'Package acceptance forbids overlays and partial runs');
  const info = JSON.parse(fs.readFileSync(infoPath));
  const manifest = new Map(info.files.map(item => [item.file, item.sha256]));
  const files = fs.readdirSync(source).filter(file => /\.(js|mjs|html|css)$/.test(file) || file === 'manifest.json');
  const visit = relative => {
    for (const item of fs.readdirSync(path.join(source, relative), { withFileTypes: true })) {
      const file = path.join(relative, item.name);
      if (item.isDirectory()) visit(file); else files.push(file.replaceAll('\\', '/'));
    }
  };
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) visit(directory);
  const frozenHashes = Object.fromEntries(files.sort().map(file => {
    const hash = sha(path.join(source, file));
    assert.equal(hash, manifest.get(file), 'Package runtime mismatch: ' + file);
    return [file, hash];
  }));
  provenance = { frozenHashes };
  packageIdentity = { build: info.build, sha256: sha(infoPath) };
} else {
  provenance = JSON.parse(fs.readFileSync(source + '.provenance.json'));
  assert.deepEqual(provenance.differences, ['semantic-find-content.js']);
}
for (const [file, hash] of Object.entries(provenance.frozenHashes)) assert.equal(sha(path.join(source, file)), hash, file);
if (process.argv.includes('--verify-source-only')) {
  console.log(JSON.stringify({ status: 'VERIFIED_SOURCE_ONLY', source, package: packageIdentity, hashes: provenance.frozenHashes }));
  process.exit(0);
}
const run = fs.mkdtempSync(path.join(root, 'output/playwright/search024-freeze-frontend-20260926/save-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-adapter-save-'));
const extension = path.join(temporary, 'extension');
for (const [file, hash] of Object.entries(provenance.frozenHashes)) {
  assert.equal(sha(path.join(source, file)), hash, file);
  const target = path.join(extension, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(source, file), target);
  assert.equal(sha(target), hash, file);
}
const report = { status: 'FAIL', source, run, copiedHashes: provenance.frozenHashes, package: packageIdentity, scriptSha256: sha(import.meta.filename),
  boundary: 'Real isolated Edge, full production cold-J/DOM/controller/adapter/manual toolbar/storage. Synthetic scholarly HTML and deterministic semantic score transport only. No personal profile, real API or release install; not large-page performance acceptance.',
  checks: [], screenshots: [], errors: [], realApiCalls: 0, reboundPaints: [] };
if (process.env.SCI_COMPARE_R18_ADAPTER) {
  const baselineAdapter = path.join(provenance.baseline, 'semantic-find-content.js');
  assert.equal(sha(baselineAdapter), provenance.baselineHashes['semantic-find-content.js']);
  fs.copyFileSync(baselineAdapter, path.join(extension, 'semantic-find-content.js'));
  report.copiedHashes = { ...report.copiedHashes, 'semantic-find-content.js': sha(baselineAdapter) };
  report.baselineAdapterComparison = true;
}
if (process.env.SCI_SELECTION_CONTENT_SOURCE) {
  const proposed = fs.realpathSync(process.env.SCI_SELECTION_CONTENT_SOURCE);
  assert.equal(path.dirname(proposed), path.join(root, 'output/playwright/search024-freeze-frontend-20260926'));
  assert.ok(['content-selection-proposed.js', 'content-selection-final.js'].includes(path.basename(proposed)));
  fs.copyFileSync(proposed, path.join(extension, 'content.js'));
  report.copiedHashes = { ...report.copiedHashes, 'content.js': sha(proposed) };
  report.contentOverlay = { file: proposed, sha256: sha(proposed), proposal: path.basename(proposed) === 'content-selection-proposed.js' };
}
const check = (name, condition, details) => {
  report.checks.push({ name, pass: !!condition, details });
  assert.ok(condition, name + (details ? ': ' + JSON.stringify(details) : ''));
  console.log('PASS ' + name);
};
const htmlFor = variant => fixtureHtml()
  .replace('name="citation_doi"', `name="${variant === 'lower' ? 'dc.identifier' : variant === 'upper' ? 'DC.Identifier' : 'citation_doi'}"`)
  .replace('10.0000/brevess.semantic.find.fixture', `${variant === 'lower' ? 'https://doi.org/' : variant === 'upper' ? 'doi:' : ''}10.0000/adapter.save.${variant}`);
let context, page, cdp, worker, extensionId, inspect;
async function shot(name) {
  const file = name + '.png'; await page.screenshot({ path: path.join(run, file) }); report.screenshots.push(file);
}
async function open(variant) {
  await cdp?.detach(); await page?.close();
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  cdp = await context.newCDPSession(page);
  const worlds = []; cdp.on('Runtime.executionContextCreated', ({ context: world }) => worlds.push(world));
  await cdp.send('Runtime.enable');
  await page.goto('https://adapter-fixture.invalid/' + variant);
  let world;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    world = worlds.find(w => w.name === extensionId || w.origin === 'chrome-extension://' + extensionId);
    if (world) {
      const ready = await cdp.send('Runtime.evaluate', { contextId: world.id,
        expression: 'globalThis.__brevessSemanticFindShortcut?.shortcutKey === "J"', returnByValue: true });
      if (ready.result.value) break;
    }
    await page.waitForTimeout(80);
  }
  assert.ok(world, 'content isolated world exists');
  await page.keyboard.press('j');
  await page.locator('.sci-semantic-find:not([hidden])').waitFor({ timeout: 20000 });
  const isolated = async expression => {
    const result = await cdp.send('Runtime.evaluate', { contextId: world.id, expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  inspect = isolated;
  await isolated(`(() => {
    globalThis.adapterSave = { requests: 0, deletes: 0, reboundPaints: [], toolbarCalls: [], releases: 0 };
    const showToolbar = showManualSelectionToolbar;
    showManualSelectionToolbar = descriptor => {
      adapterSave.toolbarCalls.push({ key: descriptor?.semanticFindSourceKey || null, text: descriptor?.text, stack: new Error().stack });
      return showToolbar(descriptor);
    };
    const release = releaseSelectionAfterManualAction;
    releaseSelectionAfterManualAction = (...args) => { adapterSave.releases++; return release(...args); };
    const remove = CSS.highlights.delete.bind(CSS.highlights);
    CSS.highlights.delete = (...args) => { adapterSave.deletes++; return remove(...args); };
    const factory = SciLLM.createSemanticFindDomSnapshot;
    SciLLM.createSemanticFindDomSnapshot = (...args) => {
      const snapshot = factory(...args), watch = snapshot.watch.bind(snapshot);
      snapshot.watch = (stale, rebound, additional) => watch(stale, (...values) => {
        const before = adapterSave.deletes;
        try { return rebound(...values); }
        finally { adapterSave.reboundPaints.push(adapterSave.deletes - before); }
      }, additional);
      return snapshot;
    };
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (...args) => {
      const message = args[0];
      if (message.type === 'LLM_SEMANTIC_FIND_CANCEL') return { success: true };
      if (message.type !== 'LLM_SEMANTIC_FIND') return original(...args);
      adapterSave.requests++;
      const sentences = SciLLM.createSemanticFindSentences(message.paragraphs);
      return { success: true, data: { operationId: message.operationId, sourceKey: message.sourceKey,
        processed: sentences.length, total: sentences.length, skipped: 0, complete: true,
        scores: sentences.map(s => ({ id: s.id, score: /clearly increased/.test(s.text) ? .95 : .9 })) } };
    };
  })()`);
  const role = key => page.locator('[data-semantic-find-role="' + key + '"]');
  await role('query').fill('signal recovery'); await role('submit').click();
  await page.waitForFunction(() => /找到/.test(document.querySelector('[data-semantic-find-role="status"]')?.textContent || ''));
  await page.waitForTimeout(500);
  return { isolated, role };
}
async function clickSource() {
  const point = await page.evaluate(() => {
    const range = [...(CSS.highlights.get('sci-semantic-search-95') || [])].find(r => r.toString().includes('clearly increased'));
    if (!range) return null;
    range.startContainer.parentElement.scrollIntoView({ block: 'center' });
    const rect = [...range.getClientRects()].find(r => r.width > 10 && r.height > 0);
    return rect && { x: rect.left + Math.min(15, rect.width / 2), y: rect.top + rect.height / 2 };
  });
  assert.ok(point, 'visible source hit'); await page.mouse.click(point.x, point.y);
  await page.locator('#sci-manual-toolbar .sci-manual-category').first().waitFor({ state: 'visible' });
}
try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking']
  });
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).hostname === 'adapter-fixture.invalid'
    ? route.fulfill({ contentType: 'text/html', body: htmlFor(new URL(route.request().url()).pathname.slice(1)) }) : route.abort());
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  await worker.evaluate(() => { globalThis.fetch = async () => { throw Error('NO_REAL_API_ADAPTER_SAVE'); }; });
  for (const variant of (process.env.SCI_SAVE_RETIREMENT_ONLY ? [] : ['citation', 'lower', 'upper'])) {
    const { isolated, role } = await open(variant);
    const before = await role('position').textContent(), requests = await isolated('adapterSave.requests');
    await role('next').click(); await role('previous').click();
    check(variant + ': next/previous preserve results without rescoring', await role('position').textContent() === before && await isolated('adapterSave.requests') === requests);
    await clickSource();
    await page.waitForTimeout(80);
    const quote = await isolated('currentManualSelection?.anchor?.quote');
    check(variant + ': actual source click opens canonical toolbar', quote?.includes('clearly increased') && await isolated('isCurrentManualMutationCandidate(currentManualSelection)'));
    check(variant + ': delayed native selection inspection retains the semantic source key',
      await isolated('!!currentManualSelection?.semanticFindSourceKey'));
    if (variant === 'citation') {
      await isolated('adapterSave.confirmed = currentManualSelection');
      await page.evaluate(() => { document.getElementById('question').firstElementChild.textContent += ' Additional source wording.'; });
      await page.waitForTimeout(700);
      check('unrelated source retirement preserves the open toolbar and confirmation',
        await page.locator('#sci-manual-toolbar .sci-manual-category').first().isVisible() &&
        await isolated('currentManualSelection === adapterSave.confirmed && isCurrentManualMutationCandidate(currentManualSelection)'));
    }
    await shot(variant + '-real-toolbar');
    await page.locator('#sci-manual-toolbar .sci-manual-category').first().click();
    await page.waitForFunction(() => document.querySelectorAll('#positive-en .sci-manual-highlight').length > 0);
    await role('close').click();
    check(variant + ': closing temporary search preserves canonical annotation',
      await page.locator('#positive-en .sci-manual-highlight').count() > 0 &&
      await page.evaluate(() => ![...CSS.highlights.keys()].some(key => key.startsWith('sci-semantic-search-'))));
    await shot(variant + '-saved');
    report.reboundPaints.push(...await isolated('adapterSave.reboundPaints'));
    await open(variant);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
    const restored = await worker.evaluate(async id => chrome.tabs.sendMessage(id, { action: 'prepareManualAnnotations' }), tabId);
    assert.equal(restored.success, true);
    await page.waitForFunction(() => document.querySelectorAll('#positive-en .sci-manual-highlight').length > 0);
    check(variant + ': actual browser-local save restores after reopening source', await page.locator('#positive-en .sci-manual-highlight').count() > 0);
    await shot(variant + '-reopened');
  }
  const { isolated } = await open('retirement');
  await clickSource(); await isolated('adapterSave.confirmed = currentManualSelection');
  report.beforeRetirement = await isolated('({confirmed: adapterSave.confirmed, current: currentManualSelection, selection: document.getSelection().toString()})');
  await page.evaluate(() => { document.getElementById('positive-en').firstElementChild.textContent = 'Changed source no longer supports old quoted text. '; });
  await page.waitForFunction(() => !document.querySelector('#sci-manual-toolbar')?.checkVisibility());
  check('confirmed source retirement closes its owned toolbar and rejects stale save',
    await isolated('!isCurrentManualMutationCandidate(adapterSave.confirmed) && !currentManualSelection'));
  check('retirement does not create a stored manual annotation', await page.locator('.sci-manual-highlight').count() === 0);
  await shot('retired-confirmation');
  report.reboundPaints.push(...await isolated('adapterSave.reboundPaints'));
  const fresh = await open('new-selection');
  // Ordinary free selection is enabled by the production reading/manual-prepare
  // route; a cold standalone J search alone does not enable its pointer handlers.
  const manualTab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  const ready = await worker.evaluate(async id => chrome.tabs.sendMessage(id, { action: 'prepareManualAnnotations' }), manualTab);
  assert.equal(ready.success, true);
  // The new manual selection must not itself be a semantic hit; otherwise
  // each real click correctly confirms that other hit instead of manual text.
  await fresh.role('threshold-number').fill('0.94');
  await fresh.role('threshold-number').press('Tab');
  await clickSource(); await page.waitForTimeout(80);
  const semanticBlock = await fresh.isolated('currentManualSelection.blockId');
  // Native triple-click also selects the paragraph separator, which the
  // existing HTML cross-block guard correctly rejects. Drag within one text node.
  const manualRect = await page.locator('#question span').evaluate(element => {
    const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 24);
    const rect = range.getBoundingClientRect(); return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(manualRect.left + 1, manualRect.y); await page.mouse.down();
  await page.mouse.move(manualRect.right - 1, manualRect.y, { steps: 8 }); await page.mouse.up();
  await page.locator('#sci-manual-toolbar .sci-manual-category').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(80);
  check('real mouse selection of another paragraph never inherits the semantic owner',
    await fresh.isolated(`!!currentManualSelection && !currentManualSelection.semanticFindSourceKey && currentManualSelection.blockId !== ${JSON.stringify(semanticBlock)} && currentManualSelection.text.includes('study asks')`));
  await page.evaluate(() => { document.getElementById('positive-en').firstElementChild.textContent = 'Old semantic source retired after a newer manual selection.'; });
  await page.waitForTimeout(700);
  check('retiring the old semantic hit preserves the newer manually selected text and toolbar',
    await page.locator('#sci-manual-toolbar .sci-manual-category').first().isVisible() &&
    await fresh.isolated("currentManualSelection?.text.includes('study asks') && !currentManualSelection.semanticFindSourceKey && isCurrentManualMutationCandidate(currentManualSelection)"));
  await page.locator('#sci-manual-toolbar .sci-manual-category').first().click();
  await page.waitForFunction(() => document.querySelectorAll('#question .sci-manual-highlight').length > 0);
  check('new manual selection still saves through the actual category button', await page.locator('#question .sci-manual-highlight').count() > 0);
  await shot('new-manual-selection-saved');
  report.reboundPaints.push(...await fresh.isolated('adapterSave.reboundPaints'));
  check('each observed actual DOM rebound has exactly one highlight paint', report.reboundPaints.length > 0 && report.reboundPaints.every(count => count === 102), report.reboundPaints);
  check('no browser page errors', report.errors.length === 0, report.errors);
  for (const [file, hash] of Object.entries(provenance.frozenHashes)) assert.equal(sha(path.join(source, file)), hash, file);
  if (packageIdentity) assert.equal(sha(infoPath), packageIdentity.sha256, 'Package manifest remains unchanged');
  report.sourceUnchanged = true; report.status = 'PASS';
} catch (error) {
  report.failure = String(error.stack || error); console.error(report.failure);
  report.diagnostic = await inspect?.('({confirmedKey: adapterSave.confirmed?.semanticFindSourceKey || null, currentKey: currentManualSelection?.semanticFindSourceKey || null, confirmedText: adapterSave.confirmed?.text, currentText: currentManualSelection?.text, allowed: isCurrentManualMutationCandidate(adapterSave.confirmed), selection: document.getSelection().toString(), reboundPaints: adapterSave.reboundPaints, toolbarCalls: adapterSave.toolbarCalls, releases: adapterSave.releases})').catch(error => ({error:String(error)}));
  if (page && !page.isClosed()) await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await context?.close();
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, run }));
  // Retain the isolated profile alongside its OS temp path for failure diagnosis.
  // No user data or baseline runtime is removed by this verifier.
}
