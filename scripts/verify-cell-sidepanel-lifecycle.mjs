// UI-003 native Edge sidePanel lifecycle. No mock events or scope setter calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'output/playwright/r16-feedback-ui003-native-scope');
fs.mkdirSync(out, { recursive: true });
const run = fs.mkdtempSync(path.join(out, 'run-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-ui003-native-'));
const extension = path.join(temporary, 'extension');
fs.mkdirSync(extension);
for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
  fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
}
for (const file of fs.readdirSync(root)) {
  if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
    fs.copyFileSync(path.join(root, file), path.join(extension, file));
  }
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources = ['manifest.json', 'background.js', 'content.js', 'content.css', 'popup.js',
  'popup.html', 'core/background-router.js', 'core/tab-messenger.js', 'core/tab-activation.js'];
const report = { status: 'RUNNING', startedAt: new Date().toISOString(), checks: [], stages: [],
  errors: [], missingCapabilities: [], nativeEvents: [], panelConsoleEvents: [], states: [],
  realModelCalls: 0, personalDataAccessed: false, installedToUserProfile: false,
  mockedSidePanelEvents: false, directScopeSetterCalls: 0,
  headless: process.argv.includes('--headless'),
  sourceHashes: Object.fromEntries(sources.filter(file => fs.existsSync(path.join(extension, file)))
    .map(file => [file, hash(path.join(extension, file))])),
  fixture: 'Synthetic HTML fulfilled at Cell-host test URLs; not the real Cell article or original publisher DOM',
  openingMethod: 'Actual chrome.action.openPopup followed by CDP Input.dispatchMouseEvent on the observed production Start reading button; actual Edge sidePanel.open',
  closingMethod: 'Actual Edge chrome.sidePanel.close API; never synthetic onClosed/pagehide dispatch' };
let context, worker, browserCdp;
const sessions = new Map();
const pageSessions = new Map();
let nextMessage = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function stage(name) { report.stages.push({ name, at: new Date().toISOString() }); console.log(name); }
function check(name, passed, details = {}) {
  report.checks.push({ name, passed, ...details });
  if (!passed) throw new Error(`CHECK_FAILED:${name}`);
}
function fixture(name, url) {
  return `<!doctype html><html style="--article-sticky-top:82px;--scroll-padding:130px auto auto"><head>
    <meta charset="utf-8"><title>UI003 native lifecycle ${name}</title><link rel="canonical" href="${url}">
    <style>body{margin:0;font:18px/1.6 Arial}header.header.base{height:82px;background:#dbe8f2}
    .axel-mega-menu{height:60px;padding-top:82px;background:#e8dbc5}main{max-width:820px;margin:20px auto}
    article{display:block}h1{font-size:30px}p{margin:24px 0}figure{border:1px solid #aaa;padding:16px}</style>
    </head><body class="website-cell-site"><header class="header base fixed"><div class="header__wrapper">
    <a id="cpIconLnk" href="#">Synthetic Cell header</a><div class="adplaceholder--header">Synthetic ad</div></div></header>
    <div class="axel-mega-menu top-padding-handler" style="padding-top:82px"><nav id="mega-menu-nav">Synthetic navigation</nav></div>
    <main><article><header><h1>UI003 native lifecycle ${name}</h1></header><section><h2>Abstract</h2>
    <p>The measured response showed no significant increase in the treated condition (p = 0.12). This synthetic sentence must remain unchanged throughout the native side panel lifecycle.</p>
    </section><section><h2>Results</h2><p>Matched controls retained the original values. The experiment measured a defined pathway with independent biological replicates and reported the uncertainty without changing scientific text.</p>
    <p>A second synthetic paragraph provides enough stable article structure for extraction. Neither activating nor closing a reading sidebar should remove this article header, paragraph, figure caption, or user-visible scientific result.</p>
    <figure id="figure-1"><figcaption>Figure 1. (A) A synthetic unchanged comparison. (B) Matched controls.</figcaption></figure></section></article></main></body></html>`;
}
async function bounded(predicate, label, timeout = 12000) {
  const start = Date.now();
  let last;
  do {
    last = await predicate();
    if (last) return last;
    await sleep(100);
  } while (Date.now() - start < timeout);
  throw new Error(`TIMEOUT:${label}:${JSON.stringify(last)}`);
}
async function targetSession(targetId) {
  if (sessions.has(targetId)) return sessions.get(targetId);
  const { sessionId } = await browserCdp.send('Target.attachToTarget', { targetId, flatten: false });
  sessions.set(targetId, sessionId);
  return sessionId;
}
async function targetCommand(targetId, method, params = {}) {
  const sessionId = await targetSession(targetId);
  const id = ++nextMessage;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { browserCdp.off('Target.receivedMessageFromTarget', listener);
      reject(new Error(`CDP_TIMEOUT:${method}`)); }, 20000);
    function listener(event) {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message);
      if (message.id !== id) return;
      clearTimeout(timer); browserCdp.off('Target.receivedMessageFromTarget', listener);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
    browserCdp.on('Target.receivedMessageFromTarget', listener);
    browserCdp.send('Target.sendMessageToTarget', { sessionId,
      message: JSON.stringify({ id, method, params }) }).catch(error => {
      clearTimeout(timer); browserCdp.off('Target.receivedMessageFromTarget', listener); reject(error);
    });
  });
}
async function evaluateTarget(targetId, expression, { userGesture = false } = {}) {
  const result = await targetCommand(targetId, 'Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ||
    result.exceptionDetails.text);
  return result.result?.value;
}
async function state(page, label) {
  const value = await page.evaluate(() => ({ url: location.href,
    active: document.documentElement.getAttribute('data-sci-cell-reader-active'),
    singleColumn: document.documentElement.getAttribute('data-sci-reader-single-column'),
    publisher: document.documentElement.getAttribute('data-sci-publisher-family'),
    headerDisplay: getComputedStyle(document.querySelector('header.header.base')).display,
    menuDisplay: getComputedStyle(document.querySelector('.axel-mega-menu')).display,
    stickyTop: getComputedStyle(document.documentElement).getPropertyValue('--article-sticky-top').trim(),
    articleText: document.querySelector('article').textContent,
    changes: globalThis.__ui003ScopeChanges || [] }));
  report.states.push({ label, at: new Date().toISOString(), ...value });
  return value;
}
async function inactive(page, label) {
  try {
    await bounded(() => page.evaluate(() => document.documentElement.getAttribute('data-sci-cell-reader-active') !== 'true'), label);
  } catch (error) {
    const value = await state(page, `${label}-failure`);
    await page.screenshot({ path: path.join(run, `${label}-failure.png`), fullPage: true });
    check(label, false, { observed: value, waitError: error.message });
  }
  const value = await state(page, label);
  check(label, value.active !== 'true' && value.singleColumn !== 'true' && value.publisher === null &&
    value.headerDisplay !== 'none' && value.menuDisplay !== 'none' && value.stickyTop === '82px');
}
async function active(page, label) {
  await bounded(() => page.evaluate(() => document.documentElement.getAttribute('data-sci-cell-reader-active') === 'true'), label);
  const value = await state(page, label);
  check(label, value.active === 'true' && value.singleColumn === 'true' &&
    value.headerDisplay === 'none' && value.menuDisplay === 'none' && value.stickyTop === '0px');
}
async function freshPaper(name) {
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push({ surface: name, message: error.message }));
  const url = `https://www.cell.com/cell/fulltext/ui003-native-scope-${name}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    globalThis.__ui003ScopeChanges = [];
    new MutationObserver(() => globalThis.__ui003ScopeChanges.push({ at: Date.now(),
      active: document.documentElement.getAttribute('data-sci-cell-reader-active') }))
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-sci-cell-reader-active'] });
  });
  const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url), url);
  return { page, tab };
}
async function nativeEvents() {
  return worker.evaluate(() => structuredClone(globalThis.__ui003NativeSidePanelEvents));
}
async function observeNativePanel() {
  const targets = (await browserCdp.send('Target.getTargets')).targetInfos;
  const target = targets.find(item => item.url === `chrome-extension://${report.extensionId}/popup.html`);
  report.panelTargets = targets.filter(item => item.url.includes(report.extensionId));
  report.nativeContexts = await worker.evaluate(async () => chrome.runtime.getContexts
    ? chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }) : null);
  if (!target) return false;
  if (!pageSessions.has(target.targetId)) {
    await targetCommand(target.targetId, 'Runtime.enable');
    await evaluateTarget(target.targetId, `(() => {
      window.addEventListener('pagehide', () => console.info('__ui003_native_pagehide__', document.visibilityState));
      console.info('__ui003_native_observer_ready__', document.visibilityState);
      return { url: location.href, visibility: document.visibilityState };
    })()`);
    pageSessions.set(target.targetId, true);
  }
  return target;
}
let workerTarget;
async function open(tab, wait = true) {
  await worker.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tab.id);
  await worker.evaluate(windowId => chrome.windows.update(windowId, { focused: true }), tab.windowId);
  await worker.evaluate(windowId => chrome.action.openPopup({ windowId }), tab.windowId);
  const target = await bounded(async () => (await browserCdp.send('Target.getTargets')).targetInfos
    .find(item => item.url === `chrome-extension://${report.extensionId}/action-popup.html`), 'native-action-popup');
  const button = await bounded(() => evaluateTarget(target.targetId, `(() => {
    const button = document.querySelector('#startReading');
    if (!button || button.disabled) return null;
    const rect = button.getBoundingClientRect();
    return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,text:button.innerText};
  })()`), 'start-reading-enabled');
  report.actionPopupClicks ??= [];
  report.actionPopupClicks.push({ target: target.targetId, button, tabId: tab.id });
  await targetCommand(target.targetId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', button: 'left', clickCount: 1, x: button.x, y: button.y
  });
  await targetCommand(target.targetId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', button: 'left', clickCount: 1, x: button.x, y: button.y
  }).catch(error => { report.actionPopupClickCompletion = error.message; });
  if (wait) await bounded(observeNativePanel, 'actual-side-panel-after-click');
  return { clicked: true };
}
async function close(windowId) {
  return evaluateTarget(workerTarget.targetId,
    `chrome.sidePanel.close({windowId:${Number(windowId)}}).then(() => ({closed:true}))`, { userGesture: true });
}
try {
  stage('launch-isolated-edge');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: report.headless, viewport: { width: 1100, height: 820 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => {
    const url = route.request().url();
    if (url.startsWith('https://www.cell.com/cell/fulltext/ui003-native-scope-') &&
        route.request().resourceType() === 'document') {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(url.split('-').at(-1), url) });
    }
    return route.abort('blockedbyclient');
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  report.extensionId = new URL(worker.url()).host;
  browserCdp = await context.browser().newBrowserCDPSession();
  report.browserVersion = await browserCdp.send('Browser.getVersion');
  browserCdp.on('Target.receivedMessageFromTarget', event => {
    const message = JSON.parse(event.message);
    const marker = message.params?.args?.[0]?.value;
    if (message.method === 'Runtime.consoleAPICalled' &&
        ['__ui003_native_pagehide__', '__ui003_native_observer_ready__'].includes(marker)) {
      report.panelConsoleEvents.push({ event: marker === '__ui003_native_pagehide__' ? 'pagehide' : 'observer-ready', sessionId: event.sessionId,
        timestamp: message.params.timestamp, values: message.params.args.map(arg => arg.value) });
    }
  });
  workerTarget = (await browserCdp.send('Target.getTargets')).targetInfos.find(item => item.url === worker.url());
  report.capabilities = await worker.evaluate(() => {
    globalThis.__ui003NativeSidePanelEvents = [];
    if (chrome.sidePanel?.onOpened?.addListener) chrome.sidePanel.onOpened.addListener(info =>
      globalThis.__ui003NativeSidePanelEvents.push({ event: 'onOpened', at: Date.now(), info }));
    if (chrome.sidePanel?.onClosed?.addListener) chrome.sidePanel.onClosed.addListener(info =>
      globalThis.__ui003NativeSidePanelEvents.push({ event: 'onClosed', at: Date.now(), info }));
    return { open: typeof chrome.sidePanel?.open, close: typeof chrome.sidePanel?.close,
      onOpened: Boolean(chrome.sidePanel?.onOpened?.addListener),
      onClosed: Boolean(chrome.sidePanel?.onClosed?.addListener),
      getContexts: typeof chrome.runtime.getContexts,
      actionOpenPopup: typeof chrome.action?.openPopup,
      productionActivation: typeof activateTabAndOpenSidePanel };
  });
  // Only the fresh isolated profile: mark optional onboarding steps skipped,
  // through production normalizers; no API/model/directory configuration.
  await worker.evaluate(async () => {
    let state = SciLLM.normalizeOnboardingState();
    state = SciLLM.setOnboardingStep(state, 'storage', 'skipped');
    state = SciLLM.setOnboardingStep(state, 'api', 'skipped');
    await chrome.storage.local.set({ onboardingState: state });
  });
  report.isolatedOnboardingFixture = 'production normalized storage/api skipped; fresh temporary profile only';
  const paperA = await freshPaper('a');
  await worker.evaluate(tabId => SciLLM.ensureContentScriptForActivation(chrome, tabId), paperA.tab.id);
  await inactive(paperA.page, 'injection-alone-keeps-cell-chrome');
  const originalText = (await state(paperA.page, 'original-scientific-text')).articleText;
  await paperA.page.keyboard.press('j');
  await sleep(300);
  await inactive(paperA.page, 'j-alone-keeps-cell-chrome');
  await paperA.page.screenshot({ path: path.join(run, '01-before-native-open.png'), fullPage: true });
  if (report.capabilities.open !== 'function' || !report.capabilities.onOpened ||
      report.capabilities.close !== 'function' || !report.capabilities.onClosed) {
    for (const key of ['open', 'close', 'onOpened', 'onClosed']) {
      if (![true, 'function'].includes(report.capabilities[key])) report.missingCapabilities.push(key);
    }
    report.status = 'BLOCKED_NATIVE_CAPABILITY';
  } else {
    stage('open-real-native-panel');
    await open(paperA.tab);
    await bounded(observeNativePanel, 'native-panel-target');
    await active(paperA.page, 'native-open-hides-cell-chrome');
    await paperA.page.screenshot({ path: path.join(run, '02-native-open.png'), fullPage: true });
    await sleep(700);
    report.nativeEventDelivery = { onOpened: (await nativeEvents()).some(event => event.event === 'onOpened') };
    stage('close-real-native-panel');
    report.closeApiResult = await close(paperA.tab.windowId);
    await sleep(700);
    report.nativeEventDelivery.onClosed = (await nativeEvents()).some(event => event.event === 'onClosed');
    report.contextsAfterNativeClose = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
    await inactive(paperA.page, 'native-close-restores-cell-chrome');
    await sleep(2500);
    await inactive(paperA.page, 'closed-panel-remains-inactive-after-late-work');
    await paperA.page.screenshot({ path: path.join(run, '03-native-closed.png'), fullPage: true });
    report.nativeEventDelivery.pagehide = report.panelConsoleEvents.some(event => event.event === 'pagehide');
    stage('real-tab-switch-and-native-close');
    await open(paperA.tab);
    await bounded(observeNativePanel, 'reopened-native-panel');
    await active(paperA.page, 'native-reopen-activates-again');
    const paperB = await freshPaper('b');
    await paperB.page.bringToFront();
    await inactive(paperA.page, 'switch-to-inactive-tab-releases-previous-cell');
    await inactive(paperB.page, 'new-tab-not-implicitly-activated');
    await paperA.page.bringToFront();
    await active(paperA.page, 'switch-back-restores-active-panel-scope');
    await close(paperA.tab.windowId);
    await inactive(paperA.page, 'close-after-tab-switch-restores-cell');
    stage('delay-real-renderer-then-close-before-activation-finishes');
    await paperB.page.bringToFront();
    const paused = await context.newCDPSession(paperB.page);
    await paused.send('Debugger.enable');
    await paused.send('Debugger.pause');
    report.delayedActivationMethod = 'CDP pauses only the synthetic article renderer; real extension/native APIs and events remain unmocked';
    try {
      await open(paperB.tab, false);
      await sleep(150);
      await close(paperB.tab.windowId);
    } finally {
      await paused.send('Debugger.resume').catch(() => {});
      await paused.detach().catch(() => {});
    }
    await sleep(3500);
    await inactive(paperB.page, 'late-activation-after-native-close-does-not-hide-cell');
    await inactive(paperA.page, 'late-other-tab-activation-does-not-hide-previous-cell');
    check('scientific-article-text-preserved', (await state(paperA.page, 'final-scientific-text')).articleText === originalText);
    report.status = report.nativeEventDelivery.onOpened && report.nativeEventDelivery.onClosed &&
      report.nativeEventDelivery.pagehide ? 'PASS' : 'PASS_WITH_NATIVE_EVENT_GAP';
  }
} catch (error) {
  report.status = /^CHECK_FAILED:/u.test(error.message) ? 'FAIL' : 'BLOCKED_OR_RUNTIME_ERROR';
  report.failure = { message: error.message, stack: error.stack };
  console.error(error.message);
} finally {
  if (worker) report.nativeEvents = await nativeEvents().catch(() => report.nativeEvents);
  if (worker) report.finalNativeContexts = await worker.evaluate(() =>
    chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).catch(() => null);
  report.finishedAt = new Date().toISOString();
  report.sourceHashesUnchanged = Object.entries(report.sourceHashes).every(([file, digest]) => hash(path.join(root, file)) === digest);
  report.functionalAcceptance = ['PASS', 'PASS_WITH_NATIVE_EVENT_GAP'].includes(report.status) &&
    report.checks.length === 13 && report.checks.every(item => item.passed === true) &&
    report.sourceHashesUnchanged && report.errors.length === 0;
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  if (context) await context.close().catch(() => {});
  const resolved = path.resolve(temporary);
  const prefix = path.join(path.resolve(os.tmpdir()), 'brevess-ui003-native-');
  if (!resolved.startsWith(prefix) || path.dirname(resolved) !== path.resolve(os.tmpdir())) throw Error('UNSAFE_TEMP_CLEANUP_PATH');
  fs.rmSync(resolved, { recursive: true, force: true });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
    report: path.join(run, 'report.json'), missingCapabilities: report.missingCapabilities }));
  // Native event delivery is an explicit capability observation. The port
  // lifecycle fallback is accepted only after every real interaction passed.
  if (!report.functionalAcceptance) process.exitCode = 2;
}
