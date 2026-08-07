import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.env.SCI_EXTENSION_ROOT
  ? path.resolve(process.env.SCI_EXTENSION_ROOT)
  : path.resolve(import.meta.dirname, '..');
const candidateDirectory = process.env.SCI_SAVED_HTML
  ? path.dirname(path.resolve(process.env.SCI_SAVED_HTML))
  : path.resolve(root, '..', 'test_example');
const savedHtml = process.env.SCI_SAVED_HTML
  ? path.resolve(process.env.SCI_SAVED_HTML)
  : fs.readdirSync(candidateDirectory)
    .filter(name => name.toLowerCase().endsWith('.html'))
    .map(name => path.join(candidateDirectory, name))
    .find(filename => /dendritic cells|树突状细胞/iu.test(path.basename(filename)));

if (!savedHtml || !fs.existsSync(savedHtml)) {
  throw new Error(
    'Science HTML was not found. Set SCI_SAVED_HTML to the saved Science page.'
  );
}

const resourceDirectory = path.join(
  path.dirname(savedHtml),
  `${path.basename(savedHtml, path.extname(savedHtml))}_files`
);
const outputDirectory = process.env.SCI_QA_OUTPUT_DIR
  ? path.resolve(process.env.SCI_QA_OUTPUT_DIR)
  : path.join(root, 'output', 'playwright');
const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-science-edge-'));
const extensionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-science-extension-'));
const pageUrl = 'https://www.science.org/doi/10.1126/science.ady1678';
const conditionQuote =
  'Mice were housed in individually ventilated cages at the Mount Sinai ' +
  'specific pathogen–free (SPF) facilities, provided food and water ad libitum, ' +
  'with conditions maintained at 21° to 23°C and 39 to 50% humidity and ' +
  '12 hour–12 hour dark-light cycle.';

function copyExtension() {
  for (const directory of ['core', 'providers', 'vendor', 'icons']) {
    fs.cpSync(path.join(root, directory), path.join(extensionDirectory, directory), {
      recursive: true
    });
  }
  for (const filename of [
    'background.js', 'content.js', 'content.css', 'popup.html', 'popup.js', 'popup.css',
    'logic-map.html', 'logic-map.js', 'logic-map.css',
    'options.html', 'options.js', 'options.css', 'offscreen.html', 'offscreen.js',
    'offscreen-network-worker.js', 'manifest.json'
  ]) {
    fs.copyFileSync(path.join(root, filename), path.join(extensionDirectory, filename));
  }
}

function resourceMap() {
  const result = new Map();
  if (!fs.existsSync(resourceDirectory)) return result;
  const pending = [resourceDirectory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else {
        result.set(entry.name.replace(/\.下载$/u, ''), absolute);
        result.set(entry.name, absolute);
      }
    }
  }
  return result;
}

function contentType(filename) {
  const extension = path.extname(filename).toLowerCase();
  return ({
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  })[extension] || 'application/octet-stream';
}

async function extensionWorker(context) {
  return context.serviceWorkers()[0] ||
    context.waitForEvent('serviceworker', { timeout: 15000 });
}

let context;
try {
  fs.mkdirSync(outputDirectory, { recursive: true });
  copyExtension();
  const resources = resourceMap();
  const html = fs.readFileSync(savedHtml);
  context = await chromium.launchPersistentContext(userDataDirectory, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1500, height: 900 },
    args: [
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`
    ]
  });
  const page = context.pages()[0] || await context.newPage();
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.isNavigationRequest() && url.href.split('?')[0] === pageUrl) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: html
      });
      return;
    }
    let filename = '';
    try {
      filename = path.basename(decodeURIComponent(url.pathname));
    } catch {
      filename = path.basename(url.pathname);
    }
    const localResource = resources.get(filename);
    if (localResource && !/\.m?js(?:\.下载)?$/iu.test(localResource)) {
      await route.fulfill({
        status: 200,
        contentType: contentType(filename),
        body: fs.readFileSync(localResource)
      });
      return;
    }
    await route.abort();
  });
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

  const worker = await extensionWorker(context);
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const tab = tabs.find(item => item.url?.startsWith(
    'https://www.science.org/doi/10.1126/science.ady1678'
  ));
  if (!tab?.id) throw new Error('Unable to resolve the saved Science test tab.');

  const snapshotResponse = await worker.evaluate(
    tabId => SciLLM.sendTabMessageWithRecovery(chrome, tabId, {
      action: 'getArticleWorkspaceSnapshot',
      forceRefresh: true
    }),
    tab.id
  );
  if (!snapshotResponse?.success) {
    throw new Error(snapshotResponse?.error || 'Science article extraction failed.');
  }

  const layout = await page.evaluate(() => {
    const article = document.querySelector('article[data-has="right-rail"]');
    const aside = article?.querySelector(':scope > aside, :scope > [data-core-aside="right-rail"]');
    const body = article?.querySelector(':scope > [data-core-wrapper="content"]');
    const bodyRect = body?.getBoundingClientRect();
    return {
      publisherFamily: document.documentElement.dataset.sciPublisherFamily || '',
      asideDisplay: aside ? getComputedStyle(aside).display : 'missing',
      asideWidth: aside ? Math.round(aside.getBoundingClientRect().width) : -1,
      bodyWidth: bodyRect ? Math.round(bodyRect.width) : 0,
      bodyX: bodyRect ? Math.round(bodyRect.x) : 0,
      viewportWidth: innerWidth,
      gridTemplateColumns: article ? getComputedStyle(article).gridTemplateColumns : ''
    };
  });

  const citationResponse = await worker.evaluate(
    ({ tabId, quote }) => SciLLM.sendTabMessageWithRecovery(chrome, tabId, {
      action: 'focusArticleWorkspaceSource',
      target: {
        kind: 'article-chat-citation',
        evidence: { quote }
      }
    }),
    { tabId: tab.id, quote: conditionQuote }
  );
  await page.waitForTimeout(1800);
  const sentenceFocus = await page.evaluate(expectedQuote => {
    const highlight = CSS.highlights?.get('sci-article-citation-focus');
    const ranges = highlight ? [...highlight] : [];
    const focusedText = ranges[0]?.toString().replace(/\s+/gu, ' ').trim() || '';
    const rangeRect = ranges[0]?.getBoundingClientRect();
    return {
      highlightRangeCount: ranges.length,
      focusedText,
      containsCondition: focusedText.includes('conditions maintained at 21° to 23°C'),
      exactQuoteFound: document.body.innerText.replace(/\s+/gu, ' ').includes(expectedQuote),
      focusedParagraphs: document.querySelectorAll('.sci-article-source-focus').length,
      scrollY: Math.round(scrollY),
      rangeTop: rangeRect ? Math.round(rangeRect.top) : null,
      rangeBottom: rangeRect ? Math.round(rangeRect.bottom) : null,
      viewportHeight: innerHeight
    };
  }, conditionQuote);

  const screenshot = path.join(outputDirectory, 'saved-science-sentence-citation.png');
  await page.screenshot({ path: screenshot, fullPage: false });
  const result = {
    savedHtml,
    paragraphCount: snapshotResponse.snapshot?.paragraphs?.length || 0,
    layout,
    citation: citationResponse?.citationResult || citationResponse,
    sentenceFocus,
    screenshot,
    passed:
      layout.publisherFamily === 'aaas' &&
      layout.asideDisplay === 'none' &&
      layout.asideWidth === 0 &&
      layout.bodyWidth >= 900 &&
      citationResponse?.focused === true &&
      citationResponse?.citationResult?.focusedGranularity === 'sentence' &&
      sentenceFocus.highlightRangeCount === 1 &&
      sentenceFocus.containsCondition &&
      sentenceFocus.scrollY > 100 &&
      sentenceFocus.rangeTop >= 0 &&
      sentenceFocus.rangeBottom <= sentenceFocus.viewportHeight
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  fs.rmSync(userDataDirectory, { recursive: true, force: true });
  fs.rmSync(extensionDirectory, { recursive: true, force: true });
}
