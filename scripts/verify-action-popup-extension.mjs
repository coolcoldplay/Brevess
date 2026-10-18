import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const extensionPath = path.resolve(process.argv[2] || process.env.EXTENSION_PATH || root);
const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join(root, 'output', 'playwright'));
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-action-popup-'));
const manualAction = process.env.MANUAL_ACTION === '1';
const headless = manualAction ? false :
  (process.env.HEADLESS === '0' ? false : process.env.HEADED !== '1');
const requestedManualTimeout = Number.parseInt(process.env.MANUAL_ACTION_TIMEOUT_MS || '60000', 10);
const manualActionTimeoutMs = Number.isFinite(requestedManualTimeout) && requestedManualTimeout > 0
  ? requestedManualTimeout
  : 60000;
fs.mkdirSync(outputDir, { recursive: true });

const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><head><title>QA research article</title></head>
    <body><article><h1>QA research article</h1><p>This is a bounded local article fixture.</p></article></body></html>`);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const diagnostics = { pageErrors: [], consoleErrors: [], openPopupErrors: [] };
const targetDiagnostics = [];
const discoveredTargets = new Map();
const recordTargetDiagnostic = targetInfo => {
  const diagnostic = {
    type: String(targetInfo?.type || ''),
    url: String(targetInfo?.url || '')
  };
  if (!targetDiagnostics.some(item => item.type === diagnostic.type && item.url === diagnostic.url)) {
    targetDiagnostics.push(diagnostic);
  }
  if (targetInfo?.targetId) discoveredTargets.set(targetInfo.targetId, targetInfo);
};
let context;
try {
  const address = server.address();
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge',
    headless,
    viewport: null,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const articlePage = await context.newPage();
  await articlePage.goto(`http://127.0.0.1:${address.port}/article`, {
    waitUntil: 'domcontentloaded'
  });
  const browserCdp = await context.browser().newBrowserCDPSession();
  browserCdp.on('Target.targetCreated', ({ targetInfo }) => recordTargetDiagnostic(targetInfo));
  browserCdp.on('Target.targetInfoChanged', ({ targetInfo }) => recordTargetDiagnostic(targetInfo));
  await browserCdp.send('Target.setDiscoverTargets', { discover: true });
  const initialTargets = await browserCdp.send('Target.getTargets');
  initialTargets.targetInfos.forEach(recordTargetDiagnostic);

  const waitForPopupTarget = (timeoutMs = 15000) => new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for an action popup CDP target'));
    }, timeoutMs);
    const inspect = ({ targetInfo }) => {
      if (!targetInfo.url.includes('/action-popup.html')) return;
      cleanup();
      resolve(targetInfo);
    };
    const cleanup = () => {
      clearTimeout(timeoutId);
      browserCdp.off('Target.targetCreated', inspect);
      browserCdp.off('Target.targetInfoChanged', inspect);
    };
    browserCdp.on('Target.targetCreated', inspect);
    browserCdp.on('Target.targetInfoChanged', inspect);
  });

  const attachToPopupTarget = async targetInfo => {
    const { sessionId } = await browserCdp.send('Target.attachToTarget', {
      targetId: targetInfo.targetId,
      flatten: false
    });
    let nextMessageId = 0;
    const sendToTarget = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextMessageId;
      const onMessage = event => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);
        if (message.id !== id) return;
        browserCdp.off('Target.receivedMessageFromTarget', onMessage);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result || {});
      };
      browserCdp.on('Target.receivedMessageFromTarget', onMessage);
      browserCdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id, method, params })
      }).catch(error => {
        browserCdp.off('Target.receivedMessageFromTarget', onMessage);
        reject(error);
      });
    });
    await sendToTarget('Runtime.enable');
    await sendToTarget('Page.enable');

    const evaluate = async (fn, arg, { userGesture = false } = {}) => {
      const args = arg === undefined ? '' : JSON.stringify(arg);
      const expression = `(${fn.toString()})(${args})`;
      const result = await sendToTarget('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'Popup target evaluation failed');
      }
      return result.result?.value;
    };
    const waitUntil = async (predicate, arg) => {
      const deadline = Date.now() + 10000;
      let lastValue;
      while (Date.now() < deadline) {
        lastValue = await evaluate(predicate, arg);
        if (lastValue) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(
        `Timed out waiting for attached popup target state (last value: ${JSON.stringify(lastValue)})`
      );
    };
    return {
      kind: 'cdp-target',
      on: () => {},
      evaluate,
      waitForLoadState: () => waitUntil(() => document.readyState !== 'loading'),
      waitForFunction: waitUntil,
      locator: selector => ({
        waitFor: () => waitUntil(value => {
          const element = document.querySelector(value);
          return Boolean(element && element.getClientRects().length);
        }, selector),
        click: () => evaluate(
          value => document.querySelector(value)?.click(),
          selector,
          { userGesture: true }
        )
      }),
      addStyleTag: ({ content }) => evaluate(css => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.append(style);
      }, content),
      screenshot: async ({ path: screenshotPath }) => {
        const result = await sendToTarget('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(screenshotPath, Buffer.from(result.data, 'base64'));
      },
      close: () => browserCdp.send('Target.closeTarget', { targetId: targetInfo.targetId }),
      waitForEvent: () => Promise.resolve()
    };
  };
  const articleTabId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  });

  let manualActionAttempt = 0;
  const openToolbarPopup = async () => {
    await articlePage.bringToFront();
    await worker.evaluate(async tabId => {
      const tab = await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }, articleTabId);
    const popupTimeoutMs = manualAction ? manualActionTimeoutMs : 15000;
    const popupPromise = context.waitForEvent('page', {
      predicate: page => page.url().includes('/action-popup.html'),
      timeout: popupTimeoutMs
    }).then(page => ({ source: 'playwright', page }));
    const targetPromise = waitForPopupTarget(popupTimeoutMs).then(
      targetInfo => ({ source: 'cdp', targetInfo })
    );
    let openPopupCall = Promise.resolve();
    if (!manualAction) {
      openPopupCall = worker.evaluate(() => chrome.action.openPopup()).catch(error => {
        diagnostics.openPopupErrors.push(error.message);
      });
    } else {
      manualActionAttempt += 1;
      process.stdout.write(
        `MANUAL_ACTION_READY attempt=${manualActionAttempt} timeoutMs=${manualActionTimeoutMs}\n`
      );
    }
    let popupPage;
    try {
      const candidate = await Promise.any([popupPromise, targetPromise]);
      popupPage = candidate.source === 'playwright'
        ? candidate.page
        : await attachToPopupTarget(candidate.targetInfo);
      await openPopupCall;
    } catch (popupErrors) {
      popupPage = context.pages().find(page => page.url().includes('/action-popup.html'));
      if (!popupPage) {
        const currentTargets = await browserCdp.send('Target.getTargets');
        currentTargets.targetInfos.forEach(recordTargetDiagnostic);
        const popupTarget = currentTargets.targetInfos.find(
          targetInfo => targetInfo.url.includes('/action-popup.html')
        ) || (!manualAction ? [...discoveredTargets.values()].find(
          targetInfo => targetInfo.url.includes('/action-popup.html')
        ) : null);
        if (!popupTarget) {
          throw new Error(
            `Toolbar popup was not exposed as a Playwright page or attachable CDP target: ${popupErrors.message}`
          );
        }
        popupPage = await attachToPopupTarget(popupTarget);
      }
    }
    popupPage.on('pageerror', error => diagnostics.pageErrors.push(error.message));
    popupPage.on('console', message => {
      if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    });
    await popupPage.waitForLoadState('domcontentloaded');
    await popupPage.locator('#startReading').waitFor({ state: 'visible' });
    await popupPage.waitForFunction(() => {
      const button = document.querySelector('#startReading');
      const status = document.querySelector('#pageStatus');
      return button && !button.disabled && status?.hidden === true &&
        !(status.textContent || '').trim();
    });
    return popupPage;
  };

  const measurePopup = popupPage => popupPage.evaluate(() => {
    const popup = document.querySelector('.action-popup');
    const popupRect = popup.getBoundingClientRect();
    const popupStyle = getComputedStyle(popup);
    const cards = [...document.querySelectorAll('.action-popup__button')].map(card => {
      const cardRect = card.getBoundingClientRect();
      const measureLabel = selector => {
        const label = card.querySelector(selector);
        const style = getComputedStyle(label);
        const rect = label.getBoundingClientRect();
        const lineHeight = Number.parseFloat(style.lineHeight);
        return {
          whiteSpace: style.whiteSpace,
          overflow: style.overflow,
          textOverflow: style.textOverflow,
          lineHeight,
          renderedLineCount: lineHeight > 0 ? Math.max(1, Math.round(rect.height / lineHeight)) : 1,
          clientWidth: label.clientWidth,
          scrollWidth: label.scrollWidth,
          overflowing: label.scrollWidth > label.clientWidth
        };
      };
      return {
        width: cardRect.width,
        height: cardRect.height,
        top: cardRect.top,
        bottom: cardRect.bottom,
        title: measureLabel('strong'),
        subtitle: measureLabel('small')
      };
    });
    const firstCard = document.querySelector('.action-popup__button');
    const firstCardRect = firstCard?.getBoundingClientRect() || null;
    return {
      innerWidth,
      bodyWidth: document.body.getBoundingClientRect().width,
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 ||
        document.body.scrollWidth > document.body.clientWidth + 1,
      cardCount: cards.length,
      cardWidths: cards.map(card => card.width),
      cardHeights: cards.map(card => card.height),
      cardVerticalGaps: cards.slice(1).map((card, index) => card.top - cards[index].bottom),
      titleLines: Math.max(0, ...cards.map(card => card.title.renderedLineCount)),
      subtitleLines: Math.max(0, ...cards.map(card => card.subtitle.renderedLineCount)),
      popupPadding: {
        top: Number.parseFloat(popupStyle.paddingTop),
        right: Number.parseFloat(popupStyle.paddingRight),
        bottom: Number.parseFloat(popupStyle.paddingBottom),
        left: Number.parseFloat(popupStyle.paddingLeft)
      },
      cardEdgeSpacing: firstCardRect ? {
        left: firstCardRect.left - popupRect.left,
        right: popupRect.right - firstCardRect.right
      } : null,
      cards
    };
  });

  const labelsHaveEllipsis = metrics => metrics.cards.every(card =>
    [card.title, card.subtitle].every(label =>
      label.renderedLineCount === 1 && label.whiteSpace === 'nowrap' &&
      label.overflow === 'hidden' && label.textOverflow === 'ellipsis'
    )
  );
  const cardsMeetGeometry = metrics => metrics.cardCount === 3 &&
    metrics.cardWidths.every(width => width > 0) &&
    metrics.cardHeights.every(height => height >= 64);

  const popupPage = await openToolbarPopup();
  const normalLabels = await popupPage.evaluate(() => ({
    primaryLabel: document.querySelector('#startReading strong')?.textContent || '',
    historyLabel: document.querySelector('#openHistory strong')?.textContent || '',
    settingsLabel: document.querySelector('#openSettings strong')?.textContent || '',
    status: document.querySelector('#pageStatus')?.textContent || '',
    statusHidden: document.querySelector('#pageStatus')?.hidden === true
  }));
  const normalMetrics = await measurePopup(popupPage);
  await popupPage.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }'
  });
  const screenshot = path.join(outputDir, 'action-popup-toolbar.png');
  await popupPage.screenshot({ path: screenshot, animations: 'disabled' });

  await popupPage.evaluate(() => {
    const longTitle = '开始研读这篇经过严格本地化验证的超长科学论文操作标题'.repeat(8);
    const longSubtitle = '此处是用于验证真实浏览器工具栏弹窗省略号布局的超长本地化说明文本'.repeat(10);
    for (const card of document.querySelectorAll('.action-popup__button')) {
      card.querySelector('strong').textContent = longTitle;
      card.querySelector('small').textContent = longSubtitle;
    }
  });
  await popupPage.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const longLabelMetrics = await measurePopup(popupPage);
  const everyLongLabelOverflows = longLabelMetrics.cards.every(
    card => card.title.scrollWidth > card.title.clientWidth &&
      card.subtitle.scrollWidth > card.subtitle.clientWidth
  );
  await popupPage.close();

  const historyPopup = await openToolbarPopup();
  const historyPagePromise = context.waitForEvent('page', {
    predicate: page => page.url().includes('/options.html#page=data')
  });
  await historyPopup.locator('#openHistory').click();
  const historyPage = await historyPagePromise;
  await historyPage.waitForLoadState('domcontentloaded');
  const historyOpened = historyPage.url().endsWith('/options.html#page=data');
  await historyPage.close();

  const settingsPopup = await openToolbarPopup();
  const settingsPagePromise = context.waitForEvent('page', {
    predicate: page => page.url().includes('/options.html#page=overview')
  });
  await settingsPopup.locator('#openSettings').click();
  const settingsPage = await settingsPagePromise;
  await settingsPage.waitForLoadState('domcontentloaded');
  const settingsOpened = settingsPage.url().endsWith('/options.html#page=overview');
  await settingsPage.close();

  const readingPopup = await openToolbarPopup();
  await readingPopup.locator('#startReading').click();
  await readingPopup.waitForEvent('close', { timeout: 10000 }).catch(() => null);
  const readingState = await worker.evaluate(async tabId => {
    const options = await chrome.sidePanel.getOptions({ tabId });
    const stored = await chrome.storage.session.get(null);
    return {
      panelEnabled: options?.enabled === true,
      panelPath: String(options?.path || ''),
      activationRecorded: Object.values(stored).some(value => {
        const serialized = JSON.stringify(value);
        return serialized.includes(String(tabId)) && serialized.includes('activated');
      })
    };
  }, articleTabId);

  const normalSpacingPassed = Object.values(normalMetrics.popupPadding).every(
    value => value >= 16
  ) && normalMetrics.cardEdgeSpacing.left >= 16 &&
    normalMetrics.cardEdgeSpacing.right >= 16 &&
    normalMetrics.cardVerticalGaps.length === 2 &&
    normalMetrics.cardVerticalGaps.every(gap => Math.abs(gap - 10) <= 1);
  const normalLayoutPassed = Math.abs(normalMetrics.innerWidth - 360) <= 1 &&
    Math.abs(normalMetrics.bodyWidth - 360) <= 1 && !normalMetrics.horizontalOverflow &&
    normalMetrics.titleLines === 1 && normalMetrics.subtitleLines === 1 &&
    cardsMeetGeometry(normalMetrics) && labelsHaveEllipsis(normalMetrics) && normalSpacingPassed;
  const longLabelLayoutPassed = !longLabelMetrics.horizontalOverflow &&
    longLabelMetrics.titleLines === 1 && longLabelMetrics.subtitleLines === 1 &&
    cardsMeetGeometry(longLabelMetrics) && labelsHaveEllipsis(longLabelMetrics) &&
    everyLongLabelOverflows;
  const passed = normalLabels.primaryLabel === '开始研读' &&
    normalLabels.historyLabel === '查看历史' && normalLabels.settingsLabel === '打开设置' &&
    normalLabels.status === '' && normalLabels.statusHidden && normalLayoutPassed &&
    longLabelLayoutPassed && historyOpened && settingsOpened && readingState.panelEnabled &&
    readingState.panelPath.endsWith('popup.html') && diagnostics.pageErrors.length === 0 &&
    diagnostics.consoleErrors.length === 0 && diagnostics.openPopupErrors.length === 0;
  const report = {
    passed,
    extensionId,
    headless,
    manualAction,
    normalLabels,
    normalMetrics,
    longLabelMetrics,
    everyLongLabelOverflows,
    normalSpacingPassed,
    normalLayoutPassed,
    longLabelLayoutPassed,
    historyOpened,
    settingsOpened,
    readingState,
    diagnostics,
    targetDiagnostics,
    screenshot
  };
  fs.writeFileSync(
    path.join(outputDir, 'action-popup-toolbar-report.json'),
    JSON.stringify(report, null, 2)
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
} catch (error) {
  const failureReport = {
    passed: false,
    headless,
    manualAction,
    error: {
      name: String(error?.name || 'Error'),
      message: String(error?.message || error)
    },
    diagnostics,
    targetDiagnostics
  };
  fs.writeFileSync(
    path.join(outputDir, 'action-popup-toolbar-report.json'),
    JSON.stringify(failureReport, null, 2)
  );
  process.stdout.write(`${JSON.stringify(failureReport, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
}
