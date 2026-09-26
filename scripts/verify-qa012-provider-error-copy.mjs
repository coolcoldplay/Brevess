// QA-012 copy acceptance only: existing isolated Edge extension flow, real
// production DeepSeek error -> content turn -> popup, plus the actual settings
// formatter/status renderer for that recorded error. Model discovery remaps 503
// to PROVIDER_REJECTED and is checked separately, never forced to another code.
// Only temporary fetch boundaries return synthetic 503; no model or user profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-qa012-copy-'));
const extension = path.join(temporary, 'extension');
const base = path.join(root, 'output/playwright/qa012-provider-error-copy');
fs.mkdirSync(base, { recursive: true });
const output = fs.mkdtempSync(path.join(base, 'run-'));
const title = 'QA-012 provider-neutral error fixture';
const url = 'https://example.org/brevess-qa012-provider-copy';
const expected = '当前模型服务暂时不可用，请稍后重试。';
const report = { taskId: 'QA-012', status: 'RUNNING', checks: [], errors: [], sourceHashes: {},
  realApiCalls: 0, personalDataAccessed: false,
  boundary: 'Synthetic article and fake 503 at temporary fetch boundaries; actual production provider/router/content/popup/options. No external service, credentials, original publisher DOM or live-model acceptance.' };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); console.log('PASS ' + name); };
let context, panel, settings;
const persist = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const deadline = setTimeout(() => {
  report.deadlineExceeded = true;
  context?.close().catch(() => {});
}, 180000);
try {
  fs.mkdirSync(extension);
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  for (const file of fs.readdirSync(root)) if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(root, file), path.join(extension, file));
  for (const file of ['content.js', 'options.js', 'popup.js', 'core/background-router.js', 'providers/deepseek.js', 'providers/provider-utils.js']) {
    report.sourceHashes[file] = hash(fs.readFileSync(path.join(root, file)));
    assert.equal(hash(fs.readFileSync(path.join(extension, file))), report.sourceHashes[file]);
  }
  // No remote call can leave either extension network entry. Return a real HTTP
  // Response so production error classification runs; do not replace business results.
  const fakeTransport = `globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'QA012 synthetic unavailable'}}),{status:503,headers:{'Content-Type':'application/json'}});\n`;
  for (const file of ['background.js', 'offscreen-network-worker.js']) {
    const target = path.join(extension, file);
    fs.writeFileSync(target, fakeTransport + fs.readFileSync(target, 'utf8'));
  }
  report.temporaryFetchBoundary = fakeTransport.trim(); persist();
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce',
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]
  });
  context.setDefaultTimeout(30000);
  await context.route(/^https?:\/\//u, route => route.request().url() === url
    ? route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="${url}"></head><body><article><h1>${title}</h1><h2>Introduction</h2><p>This synthetic study asks whether a measured signal differs between matched groups. Only synthetic observations are used for testing the service-error interface.</p><h2>Methods</h2><p>Independent control and intervention groups were measured using the same assay and timing, with no user or patient data included.</p><h2>Results</h2><p>The synthetic comparison reports an observed difference without inferring causality. The model response is deliberately unavailable for this interface check.</p></article></body></html>` })
    : route.abort('blockedbyclient'));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const paper = context.pages()[0] || await context.newPage(); await paper.goto(url);
  const tab = await worker.evaluate(async source => (await chrome.tabs.query({})).find(t => t.url === source), url);
  await worker.evaluate(async target => {
    const activation = await SciLLM.markTabActivated(chrome.storage.session, target);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
  }, tab);
  const extensionUrl = 'chrome-extension://' + new URL(worker.url()).host;
  panel = await context.newPage(); panel.on('pageerror', error => report.errors.push({ surface: 'popup', message: error.message }));
  await panel.setViewportSize({ width: 420, height: 900 });
  await panel.goto(extensionUrl + '/popup.html'); await paper.bringToFront();
  await panel.waitForFunction(value => document.getElementById('sidePanelPaperTitle')?.textContent === value, title);
  await panel.evaluate(async () => {
    for (const message of [
      { type: 'LLM_SAVE_PROFILE', profile: { id: 'profile_qa012_copy', name: 'QA012 synthetic error', providerId: 'deepseek', config: { apiKey: 'synthetic-no-secret', model: 'deepseek-flash', maxOutputTokens: 4096, reasoningEnabled: false } } },
      { type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: 'profile_qa012_copy', taskRoutes: {} },
      { type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', consentGranted: true } }
    ]) assertResponse(await chrome.runtime.sendMessage(message));
    function assertResponse(response) { if (!response?.success) throw Error('QA012_COPY_PROFILE_SETUP'); }
    await loadLlmSettings(); await refreshArticleWorkspace();
  });
  await panel.locator('#workspace-tab-chat').click();
  await panel.locator('#articleChatProfile').selectOption('profile_qa012_copy');
  await panel.locator('#articleChatQuestion').fill('请简述这份合成文章的研究问题。');
  await panel.locator('#sendArticleChat').click();
  await panel.waitForFunction(() => currentWorkspaceSnapshot?.chat?.loading !== true &&
    currentWorkspaceSnapshot?.chat?.turns?.at(-1)?.status === 'error', null, { timeout: 90000 });
  report.turn = await panel.evaluate(() => currentWorkspaceSnapshot.chat.turns.at(-1));
  check('actual DeepSeek turn reaches generic unavailable', report.turn.route?.providerId === 'deepseek' &&
    report.turn.model === 'deepseek-flash' && report.turn.errorCode === 'PROVIDER_UNAVAILABLE');
  check('actual saved turn uses provider-neutral copy', report.turn.error === expected);
  const turn = panel.locator('.article-chat-turn').last(); await turn.scrollIntoViewIfNeeded();
  check('actual popup shows neutral error without Codex', (await turn.innerText()).includes(expected) && !/Codex/u.test(await turn.innerText()));
  check('error actions remain available', await turn.locator('[data-article-chat-action="regenerate"]').isEnabled() &&
    await turn.locator('[data-article-chat-action="delete-turn"]').isEnabled());
  await panel.setViewportSize({ width: 360, height: 900 });
  check('popup has no horizontal overflow at 360px', await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await panel.screenshot({ path: path.join(output, 'chat-error-360.png'), fullPage: true });
  await panel.reload(); await paper.bringToFront();
  await panel.waitForFunction(value => document.getElementById('sidePanelPaperTitle')?.textContent === value, title);
  await panel.locator('#workspace-tab-chat').click();
  await panel.waitForFunction(value => currentWorkspaceSnapshot?.chat?.turns?.at(-1)?.error === value, expected);
  check('popup reload preserves the actual turn error', await panel.locator('.article-chat-turn').last().getByText(expected, { exact: true }).isVisible());
  settings = await context.newPage(); settings.on('pageerror', error => report.errors.push({ surface: 'options', message: error.message }));
  await settings.goto(extensionUrl + '/options.html');
  await settings.locator('[data-settings-nav="models"]').first().click();
  await settings.waitForFunction(() => document.getElementById('providerId')?.value === 'deepseek');
  await settings.locator('#refreshModels').click();
  await settings.waitForFunction(() => document.getElementById('modelDiscoveryStatus')?.dataset.state === 'error');
  report.modelDiscoveryError = await settings.locator('#modelDiscoveryStatus').innerText();
  check('ordinary discovery 503 keeps its existing rejected classification', /服务商拒绝了模型列表请求/u.test(report.modelDiscoveryError));
  report.settingsBoundary = 'Feed the actual production chat error code into the unchanged options friendlyError + showStatus entry; not an end-to-end model-discovery unavailable claim.';
  await settings.evaluate(error => showStatus(`连接失败：${friendlyError(error)}`, 'error'), {
    code: report.turn.errorCode, message: 'Provider is temporarily unavailable'
  });
  report.settingsError = await settings.locator('#status').innerText();
  check('actual settings formatter and status renderer show neutral unavailable', report.settingsError.includes(expected) && !/Codex/u.test(report.settingsError));
  await settings.locator('#status').scrollIntoViewIfNeeded();
  await settings.screenshot({ path: path.join(output, 'settings-error.png'), fullPage: true });
  check('production files remain unchanged during UI verification', Object.entries(report.sourceHashes).every(([file, digest]) => hash(fs.readFileSync(path.join(root, file))) === digest));
  check('no popup or settings page errors', report.errors.length === 0);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = error.message; process.exitCode = 1;
  if (settings && !settings.isClosed()) report.settingsDiagnostic = await settings.evaluate(() => ({
    providerId: document.getElementById('providerId')?.value,
    discovery: document.getElementById('modelDiscoveryStatus')?.textContent,
    status: document.getElementById('status')?.textContent
  })).catch(() => null);
  for (const [name, page] of [['popup', panel], ['settings', settings]]) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, name + '-failure.png') }).catch(() => {});
  }
} finally {
  clearTimeout(deadline); await context?.close(); persist();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error, output }));
}
