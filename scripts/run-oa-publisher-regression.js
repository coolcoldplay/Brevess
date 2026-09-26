const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'output', 'qa', 'oa-publisher-regression-latest.json');
const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-oa-extension-'));
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-oa-edge-'));

const cases = [
  { id: 'plos', url: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0337199' },
  { id: 'frontiers', url: 'https://www.frontiersin.org/journals/immunology/articles/10.3389/fimmu.2025.1524801/full' },
  { id: 'mdpi', url: 'https://www.mdpi.com/2077-0383/14/14/5094' },
  { id: 'pmc', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4524386/' },
  { id: 'elsevier-sciencedirect', url: 'https://www.sciencedirect.com/science/article/pii/S2352304225004246' }
];
const requestedCaseIds = new Set(process.argv.slice(2).map(value => String(value).trim()).filter(Boolean));
const selectedCases = requestedCaseIds.size
  ? cases.filter(item => requestedCaseIds.has(item.id)) : cases;

function prepareExtension() {
  for (const directory of ['core', 'providers', 'vendor', 'icons']) {
    fs.cpSync(path.join(root, directory), path.join(extensionDir, directory), { recursive: true });
  }
  for (const filename of [
    'background.js', 'content.js', 'content.css', 'popup.html', 'popup.js', 'popup.css',
    'logic-map.html', 'logic-map.js', 'logic-map.css',
    'options.html', 'options.js', 'options.css', 'offscreen.html', 'offscreen.js',
    'offscreen-network-worker.js', 'manifest.json'
  ]) fs.copyFileSync(path.join(root, filename), path.join(extensionDir, filename));
}

function compact(value, max = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function getWorker(context) {
  return context.serviceWorkers()[0] || context.waitForEvent('serviceworker', { timeout: 15000 });
}

async function activateAndInspect(worker, page) {
  const targetUrl = page.url();
  const tab = await worker.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const current = tabs.find(item => item.url === url) || tabs.find(item =>
      url.startsWith(item.url || '') || (item.url || '').startsWith(url));
    if (!current?.id) return null;
    const activation = await SciLLM.markTabActivated(chrome.storage.session, current);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation });
    return current;
  }, targetUrl);
  if (!tab?.id) throw new Error('TAB_NOT_FOUND');
  await page.waitForFunction(() => Boolean(document.documentElement.dataset.sciLlmContentRevision), null, {
    timeout: 3000
  }).catch(() => {});
  return worker.evaluate(async tabId => {
    const snapshot = await SciLLM.sendTabMessageWithRecovery(
      chrome, tabId, { action: 'getArticleWorkspaceSnapshot' }
    );
    const diagnostic = await SciLLM.sendTabMessageWithRecovery(
      chrome, tabId, { action: 'getLlmDiagnostics' }
    );
    return { snapshot, diagnostic };
  }, tab.id);
}

async function inspectExtractionCore(page) {
  const blocked = await page.evaluate(() => {
    const text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const title = String(document.title || '');
    return text.length < 2500 && /access denied|problem providing the content you requested|captcha|recaptcha|checking your browser/i.test(`${title}\n${text}`);
  });
  if (blocked) {
    return {
      publisherFamily: '', diagnostics: { warnings: ['NON_ARTICLE_CHALLENGE'] },
      nodes: [], paragraphs: []
    };
  }
  for (const relative of [
    'core/publisher-adapters.js', 'core/article-structure.js', 'core/article-extractor.js'
  ]) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, relative), 'utf8') });
  }
  return page.evaluate(() => {
    const adapter = SciLLM.selectPublisherAdapter(globalThis.location, document);
    const structure = SciLLM.extractArticleStructure(document, {
      locationLike: globalThis.location
    });
    const outlineLinkSamples = [];
    const seenOutlineLinks = new Set();
    (adapter?.outlineRootSelectors || []).forEach(rootSelector => {
      [...document.querySelectorAll(rootSelector)].forEach(root => {
        (adapter?.outlineLinkSelectors || []).forEach(linkSelector => {
          [...root.querySelectorAll(linkSelector)].forEach(link => {
            const target = String(
              link.getAttribute('data-target') || link.getAttribute('href') || ''
            ).trim();
            const title = String(link.textContent || '').replace(/\s+/g, ' ').trim();
            const identity = `${target}\n${title}`;
            if (!target || !title || seenOutlineLinks.has(identity)) return;
            seenOutlineLinks.add(identity);
            if (outlineLinkSamples.length < 30) outlineLinkSamples.push({ title, target });
          });
        });
      });
    });
    return {
      strategy: structure.strategy || '',
      publisherFamily: structure.publisherFamily || '',
      diagnostics: structure.diagnostics || {},
      outlineLinkSamples,
      nodes: (structure.nodes || []).map(node => ({ title: node.title, level: node.level })),
      paragraphs: structure.paragraphs || []
    };
  });
}

async function run() {
  prepareExtension();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  const worker = await getWorker(context);
  const results = [];
  try {
    for (const item of selectedCases) {
      const page = await context.newPage();
      const startedAt = Date.now();
      let navigationError = '';
      try {
        await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(2500);
      } catch (error) {
        navigationError = compact(error?.message, 500);
      }
      const row = {
        id: item.id,
        requestedUrl: item.url,
        finalUrl: page.url(),
        durationMs: Date.now() - startedAt,
        navigationError,
        title: compact(await page.title().catch(() => '')),
        bodyTextLength: await page.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0),
        extraction: null,
        error: ''
      };
      if (!navigationError) {
        try {
          const workspace = await inspectExtractionCore(page);
          const diagnostics = workspace.diagnostics || {};
          row.extraction = {
            strategy: workspace.strategy || '',
            publisherFamily: workspace.publisherFamily || '',
            headingCount: Number(diagnostics.headingCount) || 0,
            paragraphCount: Number(diagnostics.paragraphCount) || 0,
            characterCount: Number(diagnostics.characterCount) || 0,
            outlineEntryCount: Number(diagnostics.outlineEntryCount) || 0,
            matchedOutlineEntryCount: Number(diagnostics.matchedOutlineEntryCount) || 0,
            outlineCoverage: Number.isFinite(diagnostics.outlineCoverage)
              ? diagnostics.outlineCoverage : null,
            nodeCount: Array.isArray(workspace.nodes) ? workspace.nodes.length : 0,
            warningCodes: Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [],
            outlineLinkSamples: Array.isArray(workspace.outlineLinkSamples)
              ? workspace.outlineLinkSamples : [],
            topLevelTitles: (workspace.nodes || []).slice(0, 12).map(node => compact(node.title, 120))
          };
        } catch (error) {
          row.error = compact(error?.message, 700);
        }
      }
      results.push(row);
      await page.close();
    }
  } finally {
    await context.close();
  }
  const report = {
    generatedAt: new Date().toISOString(),
    extensionRoot: root,
    cases: results,
    summary: {
      total: results.length,
      extracted: results.filter(item => item.extraction?.paragraphCount > 0).length,
      challengedOrBlocked: results.filter(item =>
        item.extraction?.warningCodes?.includes('NON_ARTICLE_CHALLENGE') ||
        /challenge|access denied|captcha/i.test(`${item.title} ${item.error} ${item.navigationError}`)
      ).length
    }
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
