const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const {
  CONTENT_SCRIPT_FILES,
  CONTENT_STYLE_FILES
} = require('../core/tab-messenger.js');

const root = path.resolve(__dirname, '..');
const targetUrl = process.env.SCI_DIAGNOSTIC_URL ||
  'https://www.cell.com/cell-biomaterials/fulltext/S3050-5623(26)00117-0';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-cell-diagnostic-edge-'));
const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-cell-diagnostic-extension-'));
let activeContext = null;

function prepareDiagnosticExtension() {
  for (const directory of ['core', 'providers', 'vendor', 'icons']) {
    fs.cpSync(path.join(root, directory), path.join(extensionDir, directory), { recursive: true });
  }
  for (const filename of [
    'background.js', 'content.js', 'content.css', 'popup.html', 'popup.js', 'popup.css',
    'logic-map.html', 'logic-map.js', 'logic-map.css',
    'options.html', 'options.js', 'options.css', 'offscreen.html', 'offscreen.js',
    'offscreen-network-worker.js'
  ]) {
    fs.copyFileSync(path.join(root, filename), path.join(extensionDir, filename));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://www.cell.com/*'];
  fs.writeFileSync(
    path.join(extensionDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );
}

async function getWorker(context) {
  return context.serviceWorkers()[0] ||
    context.waitForEvent('serviceworker', { timeout: 15000 });
}

async function timeOperation(name, operation) {
  const startedAt = Date.now();
  try {
    const value = await operation();
    return {
      name,
      status: 'ok',
      durationMs: Date.now() - startedAt,
      summary: value
    };
  } catch (error) {
    return {
      name,
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: error.message
    };
  }
}

async function sendTabMessageWithDeadline(worker, tabId, message, timeoutMs = 20000) {
  return worker.evaluate(async ({ targetTabId, payload, deadline }) => {
    let timer;
    try {
      return await Promise.race([
        chrome.tabs.sendMessage(targetTabId, payload),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timeout:' + payload.action)),
            deadline
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }, { targetTabId: tabId, payload: message, deadline: timeoutMs });
}

(async () => {
  prepareDiagnosticExtension();
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [
      '--disable-extensions-except=' + extensionDir,
      '--load-extension=' + extensionDir
    ]
  });
  activeContext = context;
  const page = context.pages()[0] || await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  page.on('console', message =>
    consoleMessages.push(message.type() + ': ' + message.text()));
  page.on('pageerror', error => pageErrors.push(error.message));

  const navigation = await timeOperation('navigation', async () => {
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    await page.waitForTimeout(5000);
    return {
      status: response?.status(),
      url: page.url(),
      title: await page.title(),
      bodyCharacters: await page.locator('body').innerText().then(text => text.length),
      headings: await page.locator('h1,h2,h3,h4,h5,h6,[role="heading"]').count()
    };
  });

  const worker = await getWorker(context);
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const articleTab = tabs.find(tab => tab.url?.startsWith('https://www.cell.com/'));
  if (!articleTab?.id) {
    throw new Error('Cell article tab unavailable: ' + JSON.stringify(tabs));
  }

  const operations = [navigation];
  operations.push(await timeOperation('inject-content-dependencies', () =>
    worker.evaluate(async ({ tabId, scriptFiles, styleFiles }) => {
      await chrome.scripting.insertCSS({
        target: { tabId }, files: styleFiles
      });
      await chrome.scripting.executeScript({
        target: { tabId }, files: scriptFiles
      });
      return { revision: 'injected' };
    }, {
      tabId: articleTab.id,
      scriptFiles: CONTENT_SCRIPT_FILES,
      styleFiles: CONTENT_STYLE_FILES
    })
  ));

  for (const [name, action] of [
    ['extract-article', 'extractArticleForLLM'],
    ['workspace-snapshot', 'getArticleWorkspaceSnapshot'],
    ['extraction-diagnostics', 'getLlmDiagnostics'],
    ['prepare-manual-document', 'prepareManualAnnotations'],
    ['figure-progress', 'getFigureAnalysisStatus'],
    ['outline-progress', 'getReviewOutlineStatus']
  ]) {
    operations.push(await timeOperation(name, async () => {
      const response = await sendTabMessageWithDeadline(
        worker,
        articleTab.id,
        { action }
      );
      const paragraphs = Array.isArray(response?.document?.paragraphs)
        ? response.document.paragraphs : [];
      return {
        success: response?.success,
        error: response?.error || '',
        paragraphCount: paragraphs.length,
        inlineReferenceFlyouts: paragraphs
          .filter(item => /^\d{1,4}\s*[.)]?\s*[A-Z][A-Za-z'’\-]+\s*,\s*[A-Z]/u
            .test(String(item?.text || '').trim()))
          .slice(0, 12)
          .map(item => ({
            paragraphId: item.paragraphId,
            sectionTitle: item.sectionTitle,
            text: String(item.text || '').slice(0, 240)
          })),
        rawScientificTags: paragraphs
          .filter(item => /<\/?(?:sup|sub)>/i.test(String(item?.displayText || '')))
          .slice(0, 12)
          .map(item => ({
            paragraphId: item.paragraphId,
            displayText: String(item.displayText || '').slice(0, 240)
          })),
        headingCount: response?.snapshot?.diagnostics?.headingCount,
        documentId: response?.documentId || ''
      };
    }));
  }

  const report = {
    targetUrl,
    operations,
    consoleMessages: consoleMessages.slice(-30),
    pageErrors
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  await context.close();
  activeContext = null;
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(extensionDir, { recursive: true, force: true });
})().catch(async error => {
  console.error(error.stack || error);
  try { await activeContext?.close(); } catch (_) {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(extensionDir, { recursive: true, force: true }); } catch (_) {}
  process.exitCode = 1;
});
