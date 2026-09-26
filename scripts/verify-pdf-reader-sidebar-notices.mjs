import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'),
    `Missing value for ${name}`);
  return path.resolve(repositoryRoot, process.argv[index + 1]);
}
const root = argument('--extension', repositoryRoot);
const outputDir = argument('--output', path.join(repositoryRoot, 'output', 'playwright',
  'pdf-reader-sidebar-notices'));
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-notices-'));
const readerHtml = fs.readFileSync(path.join(root, 'pdf-reader.html'), 'utf8');
const readerCss = fs.readFileSync(path.join(root, 'pdf-reader.css'), 'utf8');
const readerUi = fs.readFileSync(path.join(root, 'pdf-reader-ui.js'), 'utf8');
const readerNotices = fs.readFileSync(path.join(root, 'pdf-reader-notices.js'), 'utf8');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function minimalPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 50 >>\nstream\nBT /F1 18 Tf 72 720 Td (Brevess notice QA) Tj ET\nendstream'
  ];
  let result = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    result += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}

function layoutFixture() {
  const markup = readerHtml
    .replace(/\s*<link[^>]+rel="stylesheet"[^>]*>/gu, '')
    .replace(/\s*<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gu, '');
  const chromeStub = `
    globalThis.chrome = {
      runtime: {
        id: 'layout-fixture',
        getURL: path => 'chrome-extension://layout-fixture/' + path,
        sendMessage: async () => ({ success: true }),
        onMessage: { addListener() {} }
      }
    };`;
  return markup
    .replace('</head>', `<style>${readerCss}</style></head>`)
    .replace('</body>', `<script>${chromeStub}</script><script>${readerUi}</script></body>`);
}

async function setReadableSurface(page) {
  await page.evaluate(() => {
    document.body.dataset.pdfView = 'original';
    const original = document.getElementById('pdfOriginalViewer');
    const workspace = document.getElementById('pdfReaderWorkspace');
    const native = document.getElementById('pdfNativeViewer');
    original.hidden = false;
    workspace.hidden = true;
    native.dataset.state = 'ready';
    native.replaceChildren(Object.assign(document.createElement('div'), {
      className: 'pdf-native-page', textContent: 'PDF reading surface'
    }));
    document.getElementById('pdfOriginalFrame').hidden = true;
    document.getElementById('pdfLocalFileFallback').hidden = true;
    globalThis.BrevessPdfReaderUI.sync();
  });
  await page.waitForFunction(() => document.body.hasAttribute('data-pdf-surface-readable'));
}

async function applyReaderStatus(page, kind) {
  await page.evaluate(state => {
    const control = document.getElementById('pdfReaderControl');
    const status = document.getElementById('pdfReaderStatus');
    const save = document.getElementById('pdfReaderSaveStatus');
    const quota = document.getElementById('pdfMineruQuotaStatus');
    control.dataset.state = state === 'progress' ? 'indexing' : state;
    control.hidden = state === 'ready';
    save.hidden = true;
    quota.hidden = true;
    if (state === 'loading') status.textContent = '正在本机准备 PDF 阅读索引…';
    if (state === 'progress') status.textContent = '已检查 3/8 页；原页始终可以阅读。';
    if (state === 'error') {
      status.textContent = '增强识别失败；PDF 原页仍可阅读。';
      document.documentElement.dataset.pdfEnhancementState = 'error';
      document.documentElement.dataset.pdfEnhancementError = 'QA_ERROR';
    } else {
      document.documentElement.dataset.pdfEnhancementState = state;
      delete document.documentElement.dataset.pdfEnhancementError;
    }
    if (state === 'save') {
      control.dataset.state = 'ready';
      control.hidden = true;
      save.hidden = false;
      save.dataset.state = 'saved';
      save.textContent = '带批注副本已保存。';
    }
    if (state === 'ready') status.textContent = 'PDF 原页已就绪。';
    globalThis.BrevessPdfReaderUI.sync();
  }, kind);
  await page.waitForTimeout(100);
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const viewer = document.getElementById('pdfOriginalViewer').getBoundingClientRect();
    const stack = document.getElementById('pdfReaderNoticeStack');
    const stackRect = stack.getBoundingClientRect();
    return {
      viewerTop: viewer.top,
      viewerHeight: viewer.height,
      stackHeight: stackRect.height,
      stackDisplay: getComputedStyle(stack).display,
      stackHidden: stack.hidden,
      sourceEntryDisplay: getComputedStyle(document.getElementById('pdfLocalFileFallback')).display,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth
    };
  });
}

async function verifyLayouts(report) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 1024, height: 768 },
      { width: 720, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      await page.setContent(layoutFixture(), { waitUntil: 'load' });
      await setReadableSurface(page);
      await applyReaderStatus(page, 'ready');
      const baseline = await layoutMetrics(page);
      const states = {};
      for (const state of ['loading', 'progress', 'error', 'save']) {
        await applyReaderStatus(page, state);
        states[state] = await layoutMetrics(page);
        assert.equal(states[state].stackDisplay, 'none', `${state}: top notice stack displayed`);
        assert.equal(states[state].stackHeight, 0, `${state}: top notice stack occupied height`);
        assert.ok(Math.abs(states[state].viewerTop - baseline.viewerTop) <= 0.5,
          `${state}: PDF moved vertically at ${viewport.width}x${viewport.height}`);
        assert.ok(Math.abs(states[state].viewerHeight - baseline.viewerHeight) <= 0.5,
          `${state}: PDF height changed at ${viewport.width}x${viewport.height}`);
      }
      assert.equal(baseline.sourceEntryDisplay, 'none');
      assert.ok(baseline.documentWidth <= baseline.viewportWidth,
        `reader overflows horizontally at ${viewport.width}x${viewport.height}`);

      await page.locator('#pdfReaderMoreToggle').click();
      const menu = await page.evaluate(() => ({
        retryInMenu: Boolean(document.querySelector('#pdfReaderMoreMenu #pdfReaderRetry')),
        settingsInMenu: Boolean(document.querySelector('#pdfReaderMoreMenu #pdfReaderOpenSettings')),
        right: document.getElementById('pdfReaderMoreMenu').getBoundingClientRect().right,
        width: innerWidth
      }));
      assert.equal(menu.retryInMenu, true);
      assert.equal(menu.settingsInMenu, true);
      assert.ok(menu.right <= menu.width + 1);
      const screenshot = `reader-${viewport.width}x${viewport.height}.png`;
      await page.screenshot({ path: path.join(outputDir, screenshot), fullPage: false });
      report.layouts.push({ viewport, baseline, states, menu, screenshot });
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

async function extensionWorker(context) {
  return context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 20000 });
}

async function setReaderNotice(page, message, { id = 'pdfReaderSaveStatus', state = 'saved' } = {}) {
  return page.evaluate(({ message, id, state }) => {
    const node = document.getElementById(id);
    node.hidden = false;
    node.dataset.state = state;
    node.textContent = message;
    return globalThis.BrevessPdfReaderNotices.snapshot();
  }, { message, id, state });
}

async function verifyRealExtension(report) {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge', headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  const pageErrors = [];
  try {
    const worker = await extensionWorker(context);
    const extensionId = new URL(worker.url()).host;
    const pdfBytes = minimalPdf();
    const reader = context.pages()[0] || await context.newPage();
    reader.on('pageerror', error => pageErrors.push(`reader:${error.message}`));
    await reader.route('https://notice-qa.invalid/current.pdf', route => route.fulfill({
      status: 200, contentType: 'application/pdf', body: pdfBytes
    }));
    const readerUrl = `chrome-extension://${extensionId}/pdf-reader.html?source=${
      encodeURIComponent('https://notice-qa.invalid/current.pdf')}`;
    await reader.goto(readerUrl, { waitUntil: 'domcontentloaded' });
    await reader.waitForFunction(() => Boolean(globalThis.BrevessPdfReaderNotices));
    await reader.bringToFront();

    const tabs = await worker.evaluate(() => chrome.tabs.query({}));
    const readerTab = tabs.find(tab => tab.url?.startsWith(
      `chrome-extension://${extensionId}/pdf-reader.html`)) || tabs.find(tab => tab.active);
    assert.ok(readerTab?.id, `reader tab missing: ${JSON.stringify(tabs)}`);
    await worker.evaluate(async tab => {
      const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
      await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
    }, { ...readerTab, url: readerUrl, pendingUrl: readerUrl, title: 'Brevess notice QA' });

    const panel = await context.newPage();
    panel.on('pageerror', error => pageErrors.push(`panel:${error.message}`));
    await panel.setViewportSize({ width: 420, height: 900 });
    await panel.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded'
    });
    await reader.bringToFront();
    await panel.waitForFunction(tabId => typeof refreshPdfReaderNotices === 'function' &&
      activePanelTabContext?.pdfMode === true && activePanelTabContext?.activated === true &&
      Number(activePanelTabContext?.tabId) === Number(tabId), readerTab.id, { timeout: 20000 });
    const directSnapshot = await panel.evaluate(tabId =>
      SciLLM.sendTabMessageIfPresent(chrome, tabId, { action: 'getPdfReaderNotices' }),
    readerTab.id);
    assert.equal(directSnapshot?.success, true);
    assert.equal(new URL(directSnapshot.readerUrl).pathname, '/pdf-reader.html');

    const collisionIsolation = await panel.evaluate(async snapshot => {
      const scopeA = '42|chrome-extension://id/pdf-reader.html?source=https%3A%2F%2Fexample.org%2Fpaper-6310.pdf|pdf:https://example.org/paper-6310.pdf|0000000000000000000000000000000000000000000000000000000000006310';
      const scopeB = '42|chrome-extension://id/pdf-reader.html?source=https%3A%2F%2Fexample.org%2Fpaper-25135.pdf|pdf:https://example.org/paper-25135.pdf|0000000000000000000000000000000000000000000000000000000000025135';
      const keyA = notificationSessionStorageKey(scopeA);
      const keyB = notificationSessionStorageKey(scopeB);
      const previousState = pdfReaderNoticeState;
      const previousHistory = sidePanelNotificationHistory.map(item => ({ ...item }));
      if (keyA !== keyB) {
        return { collided: false, storageKeyA: keyA, storageKeyB: keyB, leaked: true };
      }
      await chrome.storage.session.set({
        [keyA]: {
          scope: scopeA,
          items: [{ message: 'QA_COLLIDING_OLD_PDF', type: 'error', timestamp: 1 }]
        }
      });
      pdfReaderNoticeState = {
        panelKey: activePanelTabContext.key,
        historyKey: scopeB,
        snapshot,
        historyLoaded: false
      };
      sidePanelNotificationHistory = [];
      const loaded = await loadSidePanelNotificationHistory(scopeB);
      const result = {
        collided: true,
        storageKey: keyA,
        loadedCount: loaded.length,
        leaked: sidePanelNotificationHistory.some(item =>
          item.message === 'QA_COLLIDING_OLD_PDF')
      };
      await chrome.storage.session.remove(keyA);
      pdfReaderNoticeState = previousState;
      sidePanelNotificationHistory = previousHistory;
      renderSidePanelNotificationHistory();
      return result;
    }, directSnapshot);
    assert.equal(collisionIsolation.collided, true, 'fixed collision pair no longer collides');
    assert.equal(collisionIsolation.loadedCount, 0);
    assert.equal(collisionIsolation.leaked, false,
      'hashed session-key collision restored another PDF history scope');

    const delayedLoadMerge = await panel.evaluate(async () => {
      const scope = notificationPanelKey();
      const storageKey = notificationSessionStorageKey(scope);
      const originalGet = chrome.storage.session.get;
      const previousHistory = sidePanelNotificationHistory.map(item => ({ ...item }));
      let releaseGet;
      sidePanelNotificationHistory = [];
      sidePanelNotificationMutationRevision += 1;
      chrome.storage.session.get = () => new Promise(resolve => { releaseGet = resolve; });
      try {
        const load = loadSidePanelNotificationHistory(scope);
        await Promise.resolve();
        const liveTimestamp = Date.now();
        recordSidePanelNotification('QA_LIVE_DURING_STORAGE_AWAIT', 'success', liveTimestamp);
        releaseGet({
          [storageKey]: {
            scope,
            items: [{ message: 'QA_STORED_BEFORE_AWAIT', type: 'info',
              timestamp: liveTimestamp - 1000 }]
          }
        });
        const loaded = await load;
        return {
          messages: loaded.map(item => item.message),
          newest: loaded[0]?.message || '',
          liveCount: loaded.filter(item =>
            item.message === 'QA_LIVE_DURING_STORAGE_AWAIT').length
        };
      } finally {
        chrome.storage.session.get = originalGet;
        sidePanelNotificationHistory = previousHistory;
        sidePanelNotificationMutationRevision += 1;
        renderSidePanelNotificationHistory();
      }
    });
    assert.deepEqual(new Set(delayedLoadMerge.messages), new Set([
      'QA_LIVE_DURING_STORAGE_AWAIT', 'QA_STORED_BEFORE_AWAIT'
    ]));
    assert.equal(delayedLoadMerge.newest, 'QA_LIVE_DURING_STORAGE_AWAIT');
    assert.equal(delayedLoadMerge.liveCount, 1);

    const centerInitiallyClosed = await panel.locator('#sidePanelNotificationCenter')
      .evaluate(node => node.open === false);
    assert.equal(centerInitiallyClosed, true);

    const closedMessage = 'QA_CLOSED_PANEL_PROGRESS_3_OF_8';
    await setReaderNotice(reader, closedMessage, { id: 'pdfReaderStatus', state: 'indexing' });
    await panel.waitForFunction(message =>
      document.getElementById('sidePanelNotificationLatest')?.textContent === message,
    closedMessage, { timeout: 10000 });
    assert.equal(await panel.locator('#sidePanelNotificationCenter').evaluate(node => node.open), false,
      'closed notification center must update without opening itself');
    await panel.locator('#sidePanelNotificationSummary').click();
    await panel.waitForFunction(message => Array.from(document.querySelectorAll(
      '#sidePanelNotificationHistory .side-panel-notification-item'
    )).some(item => item.textContent?.includes(message)), closedMessage);
    const closedToOpen = await panel.evaluate(() => ({
      open: document.getElementById('sidePanelNotificationCenter')?.open === true,
      unreadCleared: !document.getElementById('sidePanelNotificationCenter')
        ?.classList.contains('has-unread'),
      actionLabels: Array.from(document.querySelectorAll('#pdfReaderNoticeActions button'))
        .map(button => button.textContent?.trim() || ''),
      viewportWidth: innerWidth,
      popover: (() => {
        const rect = document.querySelector('.side-panel-notification-popover')
          ?.getBoundingClientRect();
        return rect ? { left: rect.left, right: rect.right, width: rect.width } : null;
      })(),
      actionBounds: Array.from(document.querySelectorAll('#pdfReaderNoticeActions button'))
        .map(button => {
          const rect = button.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        })
    }));
    assert.equal(closedToOpen.open, true);
    assert.equal(closedToOpen.unreadCleared, true);
    assert.ok(closedToOpen.popover && closedToOpen.popover.left >= 0 &&
      closedToOpen.popover.right <= closedToOpen.viewportWidth,
    `notification popover clipped by viewport: ${JSON.stringify(closedToOpen.popover)}`);
    assert.ok(closedToOpen.actionBounds.every(rect => rect.left >= 0 &&
      rect.right <= closedToOpen.viewportWidth), 'notification action clipped by viewport');

    await reader.evaluate(() => {
      document.getElementById('pdfReaderRetry').hidden = false;
      globalThis.__brevessNativePdfDocument = {
        structure: { documentHash: 'a'.repeat(64) }, documentHash: 'a'.repeat(64),
        documentGeneration: 17
      };
    });
    const oldDocument = await setReaderNotice(reader, 'QA_DOCUMENT_A_RETRY', {
      id: 'pdfReaderStatus', state: 'error'
    });
    assert.ok(oldDocument.actions.some(action => action.id === 'pdfReaderRetry'));
    await reader.evaluate(() => {
      globalThis.__pdfNoticeQaRetryClicks = 0;
      document.getElementById('pdfReaderRetry').click = () => {
        globalThis.__pdfNoticeQaRetryClicks += 1;
      };
    });
    const currentAction = await panel.evaluate(async ({ tabId, scope }) =>
      sendTabMessage(tabId, {
        action: 'runPdfReaderNoticeAction', id: 'pdfReaderRetry', scope
      }), { tabId: readerTab.id, scope: oldDocument });
    assert.equal(currentAction?.success, true, 'current snapshot action was not delivered');
    assert.equal(await reader.evaluate(() => globalThis.__pdfNoticeQaRetryClicks), 1);
    await setReaderNotice(reader, 'QA_DOCUMENT_A_NEW_REVISION', {
      id: 'pdfReaderStatus', state: 'error'
    });
    const staleRevision = await panel.evaluate(async ({ tabId, scope }) =>
      sendTabMessage(tabId, {
        action: 'runPdfReaderNoticeAction', id: 'pdfReaderRetry', scope
      }), { tabId: readerTab.id, scope: oldDocument });
    assert.equal(staleRevision?.success, false,
      'same-document action must reject a superseded snapshot revision');
    await panel.evaluate(() => refreshPdfReaderNotices());

    await reader.evaluate(() => {
      document.dispatchEvent(new CustomEvent('brevess:pdf-source-changing'));
      globalThis.__brevessNativePdfDocument = {
        structure: { documentHash: 'b'.repeat(64) }, documentHash: 'b'.repeat(64),
        documentGeneration: 18
      };
    });
    await setReaderNotice(reader, 'QA_DOCUMENT_B_ONLY', { id: 'pdfReaderSaveStatus', state: 'saved' });
    await panel.waitForFunction(message =>
      document.getElementById('sidePanelNotificationLatest')?.textContent === message,
    'QA_DOCUMENT_B_ONLY', { timeout: 10000 });
    const staleDocument = await panel.evaluate(async ({ tabId, scope }) =>
      sendTabMessage(tabId, {
        action: 'runPdfReaderNoticeAction', id: 'pdfReaderRetry', scope
      }), { tabId: readerTab.id, scope: oldDocument });
    assert.equal(staleDocument?.success, false,
      'oldDocument snapshot action must be rejected after source epoch/hash changes');
    const documentIsolation = await panel.evaluate(() => ({
      history: Array.from(document.querySelectorAll(
        '#sidePanelNotificationHistory .side-panel-notification-item span'
      )).map(node => node.textContent || ''),
      latest: document.getElementById('sidePanelNotificationLatest')?.textContent || ''
    }));
    assert.equal(documentIsolation.latest, 'QA_DOCUMENT_B_ONLY');
    assert.ok(!documentIsolation.history.includes('QA_DOCUMENT_A_RETRY'),
      'oldDocument history crossed the new hash scope');

    const intruder = await context.newPage();
    intruder.on('pageerror', error => pageErrors.push(`staleTab:${error.message}`));
    await intruder.route('https://notice-qa.invalid/other.pdf', route => route.fulfill({
      status: 200, contentType: 'application/pdf', body: pdfBytes
    }));
    const intruderUrl = `chrome-extension://${extensionId}/pdf-reader.html?source=${
      encodeURIComponent('https://notice-qa.invalid/other.pdf')}`;
    await intruder.goto(intruderUrl, { waitUntil: 'domcontentloaded' });
    await intruder.waitForFunction(() => Boolean(globalThis.BrevessPdfReaderNotices));
    await reader.bringToFront();
    await panel.waitForFunction(tabId => Number(activePanelTabContext?.tabId) === Number(tabId),
      readerTab.id);
    const beforeStaleTab = await panel.locator('#sidePanelNotificationLatest').textContent();
    await setReaderNotice(intruder, 'QA_STALE_TAB_MUST_NOT_APPEAR');
    await panel.waitForTimeout(500);
    const afterStaleTab = await panel.locator('#sidePanelNotificationLatest').textContent();
    assert.equal(afterStaleTab, beforeStaleTab, 'staleTab signal changed current PDF notices');
    assert.doesNotMatch(afterStaleTab || '', /QA_STALE_TAB_MUST_NOT_APPEAR/u);

    await worker.evaluate(() => {
      globalThis.__pdfNoticeQaSignals = [];
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message?.type === 'PDF_READER_NOTICES_CHANGED') {
          globalThis.__pdfNoticeQaSignals.push({
            message: structuredClone(message), senderTabId: Number(sender?.tab?.id) || null
          });
        }
      });
    });
    await reader.evaluate(() => {
      const node = document.getElementById('pdfReaderSaveStatus');
      node.hidden = false;
      node.textContent = 'QA_SIGNAL_PAYLOAD';
      globalThis.BrevessPdfReaderNotices.snapshot();
    });
    await panel.waitForTimeout(150);
    const signalPayloads = await worker.evaluate(() => globalThis.__pdfNoticeQaSignals || []);
    const signal = signalPayloads.map(value => value.message)
      .find(value => value.type === 'PDF_READER_NOTICES_CHANGED');
    assert.ok(signal, 'reader did not emit PDF_READER_NOTICES_CHANGED');
    assert.deepEqual(Object.keys(signal).sort(),
      ['readerInstanceId', 'revision', 'sourceEpoch', 'type'].sort());

    await panel.screenshot({ path: path.join(outputDir, 'sidebar-notification-center.png'),
      fullPage: false });
    await panel.setViewportSize({ width: 360, height: 640 });
    const compactHistory = await panel.evaluate(() => {
      sidePanelNotificationHistory = [];
      sidePanelNotificationMutationRevision += 1;
      const base = Date.now() - 40000;
      for (let index = 0; index < 40; index += 1) {
        recordSidePanelNotification(`QA_HISTORY_${String(index).padStart(2, '0')}`,
          index === 39 ? 'success' : 'info', base + index * 1000);
      }
      const center = document.getElementById('sidePanelNotificationCenter');
      center.open = true;
      renderSidePanelNotificationHistory();
      const popover = document.querySelector('.side-panel-notification-popover');
      const history = document.getElementById('sidePanelNotificationHistory');
      history.scrollTop = history.scrollHeight;
      const popoverRect = popover.getBoundingClientRect();
      const historyRect = history.getBoundingClientRect();
      const last = history.lastElementChild;
      const lastRect = last.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        popover: { left: popoverRect.left, right: popoverRect.right,
          top: popoverRect.top, bottom: popoverRect.bottom },
        actionBounds: Array.from(document.querySelectorAll('#pdfReaderNoticeActions button'))
          .map(button => {
            const rect = button.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          }),
        historyCount: history.children.length,
        historyScrollable: history.scrollHeight > history.clientHeight,
        scrollTop: history.scrollTop,
        lastText: last.textContent || '',
        lastReachable: lastRect.top >= historyRect.top - 1 &&
          lastRect.bottom <= historyRect.bottom + 1
      };
    });
    assert.ok(compactHistory.popover.left >= 0 &&
      compactHistory.popover.right <= compactHistory.viewportWidth,
    `360px notification popover clipped: ${JSON.stringify(compactHistory.popover)}`);
    assert.ok(compactHistory.actionBounds.every(rect => rect.left >= 0 &&
      rect.right <= compactHistory.viewportWidth), '360px notification action clipped');
    assert.equal(compactHistory.historyCount, 40);
    assert.equal(compactHistory.historyScrollable, true);
    assert.match(compactHistory.lastText, /QA_HISTORY_00/u);
    assert.equal(compactHistory.lastReachable, true,
      'oldest of 40 notification rows is not reachable by scrolling');
    await panel.screenshot({
      path: path.join(outputDir, 'sidebar-notification-center-360x640.png'), fullPage: false
    });
    report.extension = {
      extensionId,
      readerTabId: readerTab.id,
      centerInitiallyClosed,
      closedToOpen,
      collisionIsolation,
      delayedLoadMerge,
      compactHistory,
      currentActionDelivered: currentAction?.success === true,
      staleRevisionRejected: staleRevision?.success === false,
      staleDocumentRejected: staleDocument?.success === false,
      oldDocumentHistoryRejected: !documentIsolation.history.includes('QA_DOCUMENT_A_RETRY'),
      staleTabRejected: afterStaleTab === beforeStaleTab,
      signalKeys: Object.keys(signal).sort(),
      pageErrors
    };
    await intruder.close();
    await panel.close();
  } finally {
    await context.close();
  }
}

fs.mkdirSync(outputDir, { recursive: true });
const report = {
  status: 'RUNNING',
  scope: 'production reader HTML/CSS/notice bridge plus real unpacked-extension Chrome messaging',
  sourceHashes: Object.fromEntries(['manifest.json', 'content.js', 'background.js',
    'popup.html', 'popup.js', 'popup.css', 'pdf-reader.html', 'pdf-reader.js',
    'pdf-reader-ui.js', 'pdf-reader-notices.js', 'pdf-reader.css', 'pdf-native-reader.mjs',
    'core/i18n.js'].map(file => [file, sha256(fs.readFileSync(path.join(root, file)))])),
  sources: {
    readerHtmlSha256: sha256(readerHtml),
    readerCssSha256: sha256(readerCss),
    readerUiSha256: sha256(readerUi),
    readerNoticesSha256: sha256(readerNotices)
  },
  layouts: [],
  extension: null
};

try {
  await verifyLayouts(report);
  await verifyRealExtension(report);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.rmSync(profileDir, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    layouts: report.layouts.length,
    extension: report.extension,
    error: report.error || ''
  }, null, 2)}\n`);
}
