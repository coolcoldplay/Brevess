import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const arg = (name, fallback) => process.argv.includes(name)
  ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const root = path.resolve(arg('--extension', path.resolve(import.meta.dirname, '..')));
const output = path.resolve(arg('--output', 'output/playwright/live-article-extraction'));
const url = arg('--url', 'https://www.nature.com/articles/nature25021');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-extraction-'));
fs.mkdirSync(output, { recursive: true });
const report = { status: 'FAIL', url, extension: root, livePublisher: true,
  fixtures: false, replay: false, realApiCalls: 0, checks: [], errors: [] };
const sourceHashes = () => Object.fromEntries([
  'content.js', 'popup.js', 'popup.css', 'core/tab-messenger.js'
].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
report.sourceHashes = sourceHashes();
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge', headless: true, viewport: { width: 1400, height: 1000 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const article = await context.newPage();
  const started = performance.now();
  await article.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await article.locator('article p:visible').first().waitFor({ timeout: 30000 });
  report.page = await article.evaluate(() => ({ title: document.title, url: location.href,
    readyState: document.readyState, paragraphs: document.querySelectorAll('article p').length,
    accessElements: [...document.querySelectorAll('article [id*="access"], article [class*="access"]')]
      .slice(0, 15).map(node => ({ tag: node.tagName, id: node.id, className: node.className,
        text: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) })) }));
  report.pageLoadedMs = Math.round(performance.now() - started);
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const tab = tabs.find(item => item.url?.startsWith(url));
  if (!tab?.id) throw Error('ARTICLE_TAB_MISSING');
  await worker.evaluate(async tab => {
    const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
    await SciLLM.ensureCompatibleContentRevision(chrome, tab.id);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      globalThis.__extractionProbe = { seedErrors: [], extractions: [] };
      const original = ensureFigureWorkspaceInventorySeeded;
      ensureFigureWorkspaceInventorySeeded = async function (...args) {
        await figureWorkspaceInventorySeedPromise.catch(error => {
          globalThis.__extractionProbe.seedErrors.push({ code: error.code,
            message: error.message, stack: String(error.stack || '').slice(0, 1400) });
        });
        return original(...args);
      };
      const extract = SciLLM.extractArticle;
      SciLLM.extractArticle = function (...args) {
        const start = performance.now();
        try { return extract.apply(this, args); }
        finally { globalThis.__extractionProbe.extractions.push(Math.round(performance.now() - start)); }
      };
    }});
  }, tab);
  const panel = await context.newPage();
  panel.on('pageerror', error => report.errors.push(error.message));
  await panel.setViewportSize({ width: 520, height: 1000 });
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await panel.waitForFunction(() => panelUiReady === true);
  await article.bringToFront();
  const summarize = async () => panel.evaluate(() => ({
    title: document.getElementById('sidePanelPaperTitle')?.textContent,
    status: document.getElementById('articleNavigationStatus')?.textContent,
    paragraphs: currentWorkspaceSnapshot?.paragraphs?.length || 0,
    headings: currentWorkspaceSnapshot?.nodes?.length || 0,
    figures: currentWorkspaceSnapshot?.figures?.figures?.length || 0,
    sectionCounts: currentWorkspaceSnapshot?.paragraphs?.reduce((counts, paragraph) => {
      const key = `${paragraph.sectionKind}:${paragraph.sectionTitle}`;
      counts[key] = (counts[key] || 0) + 1; return counts;
    }, {}),
    readiness: currentWorkspaceSnapshot?.readiness,
    warnings: currentWorkspaceSnapshot?.warnings,
    view: activeWorkspaceView
  }));
  const activationStart = performance.now();
  await panel.evaluate(async id => {
    const tab = await chrome.tabs.get(id);
    tabContextRequestSequence += 1; tabContextSequence += 1;
    activePanelTabContext = { tabId: id, url: SciLLM.normalizeTabDocumentUrl(tab.url),
      key: panelTabDocumentKey(tab), activated: true, pdfMode: false, tabContextSequence };
    resetPanelArticleState();
    await initializeCurrentArticle();
  }, tab.id);
  report.activationMs = Math.round(performance.now() - activationStart);
  report.initial = await summarize();
  const requestedScope = arg('--scope', '');
  if (requestedScope) {
    report.sectionScope = await worker.evaluate(async ({ id, title }) => (
      await chrome.scripting.executeScript({ target: { tabId: id }, args: [title],
        func: title => {
          const snapshot = getCanonicalArticleSnapshot();
          const nodes = [];
          const visit = items => (items || []).forEach(node => {
            nodes.push(node); visit(node.children);
          });
          visit(snapshot.nodes || snapshot.structure?.nodes);
          const normalize = value => String(value || '').trim().toLowerCase()
            .replace(/&/g, 'and').replace(/^materials and /, '');
          const matches = nodes.filter(node => normalize(node.title) === normalize(title));
          if (matches.length !== 1) return { error: 'SCOPE_NOT_UNIQUE',
            matches: matches.length, titles: nodes.map(node => node.title) };
          const node = matches[0];
          let selected;
          try {
            selected = resolveCurrentArticleChatScope({ scopes: [{
              scopeId: node.sectionId, name: node.title,
              sectionIds: [node.sectionId], sourceKeys: [node.sourceKey].filter(Boolean)
            }] }, snapshot);
          } catch (error) {
            return { error: error.code || error.name, message: String(error.message),
              resolverAvailable: typeof SciLLM.resolveArticleChatContextScope,
              sectionId: node.sectionId, title: node.title };
          }
          return { title: node.title, totalRecords: snapshot.paragraphs.length,
            selectedRecords: selected.paragraphs.length,
            sectionIds: selected.resolution.sectionIds,
            paragraphIds: selected.paragraphs.map(item => item.paragraphId),
            sectionKinds: [...new Set(selected.paragraphs.map(item => item.sectionKind))],
            samples: selected.paragraphs.slice(0, 3).map(item => ({
              sectionTitle: item.sectionTitle, text: item.text.slice(0, 320)
            })) };
        }
      })
    )[0]?.result, { id: tab.id, title: requestedScope });
    if (!report.sectionScope?.selectedRecords ||
        report.sectionScope.selectedRecords >= report.sectionScope.totalRecords) {
      throw Error('LIVE_SECTION_SCOPE_FAILED');
    }
  }
  const trace = async () => worker.evaluate(async id => (await chrome.scripting.executeScript({
    target: { tabId: id }, func: () => extractionTrace.snapshot()
  }))[0]?.result, tab.id);
  report.initialTrace = await trace();
  await panel.screenshot({ path: path.join(output, 'initial.png') });
  const refreshStart = performance.now();
  await panel.locator('#refreshArticleNavigation').click();
  await panel.waitForFunction(() => !workspaceRefreshInFlight, null, { timeout: 60000 });
  report.refreshMs = Math.round(performance.now() - refreshStart);
  report.refreshed = await summarize();
  report.refreshTrace = await trace();
  await article.goto(url + '#Abs1', { waitUntil: 'domcontentloaded' });
  await panel.evaluate(() => refreshArticleWorkspace({ announce: true }));
  report.anchorRefresh = await summarize();
  await article.reload({ waitUntil: 'domcontentloaded' });
  await article.locator('article p:visible').first().waitFor();
  await panel.evaluate(async () => {
    await SciLLM.ensureCompatibleContentRevision(chrome, activePanelTabContext.tabId);
    await initializeCurrentArticle({ retry: true });
  });
  // tabs.onUpdated may legitimately supersede that initialization; wait for
  // the replacement task's rendered result rather than inspecting its reset.
  await panel.waitForFunction(() => currentWorkspaceSnapshot?.paragraphs?.length > 0 &&
    !/正在连接/.test(document.getElementById('sidePanelPaperTitle')?.textContent || ''),
  null, { timeout: 20000 });
  report.reloaded = await summarize();
  if (process.argv.includes('--faults')) {
    report.controlledFaults = { note: 'Fault injection on the live article; separate from normal-page acceptance.' };
    await worker.evaluate(async id => { await chrome.scripting.executeScript({ target: { tabId: id },
      func: async () => {
        await ensureFigureWorkspaceInventorySeeded();
        const controller = await ensureFigureWorkspaceDraftController();
        globalThis.__restoreSeed = () => { controller.seedFigures = original; };
        const original = controller.seedFigures;
        controller.seedFigures = async () => { throw Object.assign(new Error('injected save failure'),
          { code: 'SAVE_FAILED' }); };
      }
    }); }, tab.id);
    await panel.locator('#refreshArticleNavigation').click();
    await panel.waitForFunction(() => !workspaceRefreshInFlight);
    report.controlledFaults.degraded = await summarize();
    report.controlledFaults.draftHidden = await panel.evaluate(() =>
      currentWorkspaceSnapshot?.figures?.draft === null &&
      currentWorkspaceSnapshot?.figures?.inventoryReady === false);
    await panel.screenshot({ path: path.join(output, 'degraded.png') });
    if (!report.controlledFaults.draftHidden || !report.controlledFaults.degraded.paragraphs) {
      throw Error('FAULT_DEGRADATION_FAILED');
    }
    await worker.evaluate(async id => { await chrome.scripting.executeScript({
      target: { tabId: id }, func: () => globalThis.__restoreSeed()
    }); }, tab.id);
    await panel.locator('#refreshArticleNavigation').click();
    await panel.waitForFunction(() => !workspaceRefreshInFlight);
    report.controlledFaults.recovered = await panel.evaluate(() =>
      currentWorkspaceSnapshot?.figures?.inventoryReady === true &&
      Number.isSafeInteger(currentWorkspaceSnapshot?.figures?.draft?.revision));
    if (!report.controlledFaults.recovered) throw Error('FAULT_RECOVERY_FAILED');
    await article.evaluate(() => {
      const node = document.createElement('p'); node.id = 'brevess-readiness-probe';
      document.querySelector('article p').parentElement.append(node);
      let count = 0;
      window.__readinessInterval = setInterval(() => {
        node.textContent = 'Controlled dynamic article loading probe: ' + (++count);
      }, 80);
    });
    await panel.locator('#refreshArticleNavigation').click();
    await panel.waitForFunction(() => !workspaceRefreshInFlight);
    report.controlledFaults.loadingMessage = await panel.locator('#articleNavigationStatus').textContent();
    await panel.screenshot({ path: path.join(output, 'loading.png') });
    if (!/加载|变化|等待/.test(report.controlledFaults.loadingMessage)) throw Error('LOADING_NOTICE_MISSING');
    await article.evaluate(() => { clearInterval(window.__readinessInterval);
      document.getElementById('brevess-readiness-probe')?.remove(); });
    await panel.locator('#refreshArticleNavigation').click();
    await panel.waitForFunction(() => !workspaceRefreshInFlight);
    report.controlledFaults.stableAgain = await summarize();
    if (report.controlledFaults.stableAgain.paragraphs !== report.initial.paragraphs) {
      throw Error('DYNAMIC_RECOVERY_CHANGED_BODY');
    }
  }
  report.probe = await worker.evaluate(async id => (await chrome.scripting.executeScript({
    target: { tabId: id }, func: () => ({ ...globalThis.__extractionProbe,
      binding: currentFigureWorkspaceRefreshBinding(),
      draftBinding: figureWorkspaceDraft?.binding,
      lifecycle: articleWorkspaceLifecycleGeneration,
      structureParagraphs: currentArticleStructure?.paragraphs?.length,
      inventoryCount: figureWorkspaceInventory?.length })
  }))[0]?.result, tab.id);
  await panel.screenshot({ path: path.join(output, 'refreshed.png') });
  if (!report.initial.paragraphs || !report.refreshed.paragraphs || !report.reloaded.paragraphs) throw Error('BODY_EXTRACTION_FAILED');
  if (/失败|FAILED/.test(report.initial.status || '') || /失败|FAILED/.test(report.refreshed.status || '')) {
    throw Error('SIDEBAR_EXTRACTION_FAILED');
  }
  report.status = 'PASS';
} catch (error) {
  report.failure = error.message;
} finally {
  await context?.close();
  if (path.dirname(profile) !== path.resolve(os.tmpdir()) ||
    !path.basename(profile).startsWith('brevess-extraction-')) throw Error('UNSAFE_TEMP_PATH');
  fs.rmSync(profile, { recursive: true, force: true });
  if (JSON.stringify(sourceHashes()) !== JSON.stringify(report.sourceHashes)) {
    report.status = 'FAIL';
    report.failure = 'SOURCE_CHANGED_DURING_ACCEPTANCE';
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
}
