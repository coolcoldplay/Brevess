import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const extensionPath = path.resolve(process.env.EXTENSION_PATH ||
  path.join(root, 'dist', 'Brevess-v1.0.1-build2-nature-deepseek-fix'));
const outputDir = path.join(root, 'output', 'playwright', 'live-nature-extension');
const articleUrl = 'https://www.nature.com/articles/s41586-026-10907-8';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-live-nature-'));
fs.mkdirSync(outputDir, { recursive: true });

const context = await chromium.launchPersistentContext(profile, {
  channel: 'msedge',
  headless: true,
  viewport: { width: 1440, height: 1050 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
});
const diagnostics = { pageErrors: [], consoleErrors: [] };
const watch = (page, label) => {
  page.on('pageerror', error => diagnostics.pageErrors.push(`${label}: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') {
      diagnostics.consoleErrors.push(`${label}: ${message.text()}`);
    }
  });
};

try {
  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const article = await context.newPage();
  watch(article, 'article');
  await article.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await article.locator('.c-article-supplementary__item').first()
    .waitFor({ state: 'attached', timeout: 60000 });
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const articleTab = tabs.find(tab => tab.url === articleUrl);
  if (!articleTab?.id) throw new Error('LIVE_NATURE_TAB_NOT_FOUND');
  await worker.evaluate(async tab => {
    const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
  }, articleTab);

  const panel = await context.newPage();
  watch(panel, 'panel');
  await panel.setViewportSize({ width: 460, height: 1000 });
  await panel.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded'
  });
  await article.bringToFront();
  await panel.evaluate(async expectedTabId => {
    const tab = await chrome.tabs.get(expectedTabId);
    tabContextRequestSequence += 1;
    tabContextSequence += 1;
    activePanelTabContext = {
      tabId: tab.id,
      url: SciLLM.normalizeTabDocumentUrl(tab.url || tab.pendingUrl),
      key: panelTabDocumentKey(tab),
      activated: true,
      pdfMode: false,
      tabContextSequence
    };
    resetPanelArticleState();
    await initializeCurrentArticle();
    switchWorkspaceView('figures');
    await refreshArticleWorkspace({ announce: true });
  }, articleTab.id);
  await panel.waitForFunction(() =>
    (currentWorkspaceSnapshot?.figures?.figures || []).filter(figure =>
      /^figure-ed\d+$/.test(String(figure.figureId || ''))
    ).length === 11,
  null, { timeout: 60000 });
  const result = await panel.evaluate(() => {
    const figures = currentWorkspaceSnapshot?.figures?.figures || [];
    const supplemental = currentWorkspaceSnapshot?.figures?.supplemental || {};
    const coverage = supplemental.coverage || {};
    const coverageElement = document.getElementById('supplementalFigureCoverage');
    if (coverageElement) coverageElement.open = true;
    return {
      title: document.getElementById('sidePanelPaperTitle')?.textContent || '',
      workspaceParagraphCount: currentWorkspaceSnapshot?.paragraphs?.length || 0,
      workspaceParagraphReferenceLabels: SciLLM.extractSupplementalReferences?.(
        currentWorkspaceSnapshot?.paragraphs || []
      ).map(reference => reference.shortLabel) || [],
      figureIds: figures.map(figure => figure.figureId),
      extendedData: figures.filter(figure => /^figure-ed\d+$/.test(String(figure.figureId || '')))
        .map(figure => ({
          figureId: figure.figureId,
          panels: figure.panelHints,
          hasImage: Boolean(figure.hasImage || figure.imageSource || figure.imageElements?.length)
        })),
      coverage: {
        status: coverage.status,
        expectedFigureCount: coverage.expectedFigureCount,
        foundFigureCount: coverage.foundFigureCount,
        missingFigureKeys: coverage.missingFigureKeys
      },
      snapshotReferences: (supplemental.references || []).map(reference => ({
        kind: reference.kind,
        shortLabel: reference.shortLabel,
        label: reference.label
      })),
      materialLabels: Array.from(document.querySelectorAll('.supplemental-material-label'))
        .map(element => element.textContent || ''),
      manualExtendedDataActions: Array.from(
        document.querySelectorAll('.supplemental-material-row')
      ).filter(row => /extended data fig/i.test(row.textContent || '')).length
    };
  });
  const contentProbe = await worker.evaluate(async tabId => {
    const rows = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const snapshot = getCanonicalArticleSnapshot({ forceRefresh: true });
        const references = SciLLM.extractSupplementalReferences(snapshot.paragraphs || []);
        return {
          canonicalParagraphCount: snapshot.paragraphs?.length || 0,
          canonicalReferenceLabels: references.map(reference => reference.shortLabel),
          extendedDataParagraphSamples: (snapshot.paragraphs || [])
            .filter(paragraph => /extended\s+data\s+fig/i.test(paragraph.text || ''))
            .slice(0, 3).map(paragraph => paragraph.text)
        };
      }
    });
    return rows?.[0]?.result || null;
  }, articleTab.id);
  const imageViewerProbe = await worker.evaluate(async tabId => {
    const rows = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const compactSource = value => {
          const source = String(value || '');
          if (/^data:/i.test(source)) return `data-url:${source.length}`;
          return source;
        };
        const results = [];
        for (const figureId of ['figure-1', 'figure-ed1']) {
          const figure = findFigureAnalysisTarget(figureId);
          const sources = figure ? await resolveFigureImageSources(figure) : [];
          const viewer = figure ? await showFigureImageViewer(figureId) : null;
          const image = document.querySelector('#sci-figure-image-viewer img');
          results.push({
            figureId,
            found: Boolean(figure),
            sourceCandidates: sources.map(compactSource),
            imageElements: Array.from(figure?.imageElements || []).map(element => ({
              currentSrc: compactSource(element.currentSrc),
              src: compactSource(element.getAttribute?.('src')),
              srcset: element.getAttribute?.('srcset') || '',
              dataSrc: compactSource(element.getAttribute?.('data-src')),
              closestLink: element.closest?.('a[href]')?.href || '',
              naturalWidth: element.naturalWidth || 0,
              naturalHeight: element.naturalHeight || 0
            })),
            viewer: viewer ? {
              success: viewer.success,
              sourceUrl: compactSource(viewer.sourceUrl),
              pixelWidth: viewer.pixelWidth || 0,
              pixelHeight: viewer.pixelHeight || 0,
              fallback: viewer.fallback === true
            } : null,
            loadedNaturalWidth: image?.naturalWidth || 0,
            loadedNaturalHeight: image?.naturalHeight || 0
          });
          closeFigureImageViewer();
        }
        await showFigureImageViewer('figure-5');
        const navigated = await navigateFigureImageViewer('next');
        results.push({
          figureId: 'figure-5-next',
          targetFigureId: getFigureImageViewerState().figureId,
          viewer: navigated ? {
            success: navigated.success,
            sourceUrl: compactSource(navigated.sourceUrl),
            pixelWidth: navigated.pixelWidth || 0,
            pixelHeight: navigated.pixelHeight || 0,
            fallback: navigated.fallback === true
          } : null
        });
        closeFigureImageViewer();
        return results;
      }
    });
    return rows?.[0]?.result || [];
  }, articleTab.id);
  await panel.evaluate(() => switchWorkspaceView('figures', { persist: false }));
  await panel.locator('#figureWorkspace').waitFor({ state: 'visible', timeout: 10000 });
  const coverageLocator = panel.locator('#supplementalFigureCoverage');
  const coverageVisible = await coverageLocator.isVisible().catch(() => false);
  const report = {
    extensionPath,
    passed: result.extendedData.length === 11 &&
      result.extendedData.every(figure => figure.panels.length > 0) &&
      result.coverage.expectedFigureCount === 11 &&
      result.coverage.foundFigureCount === 11 &&
      result.coverage.missingFigureKeys?.length === 0 &&
      result.manualExtendedDataActions === 0 &&
      imageViewerProbe.find(item => item.figureId === 'figure-ed1')
        ?.viewer?.pixelWidth >= 1200 &&
      imageViewerProbe.find(item => item.figureId === 'figure-5-next')
        ?.targetFigureId === 'figure-ed1' &&
      imageViewerProbe.find(item => item.figureId === 'figure-5-next')
        ?.viewer?.pixelWidth >= 1200 &&
      diagnostics.pageErrors.length === 0,
    coverageVisible,
    ...result,
    contentProbe,
    imageViewerProbe,
    diagnostics
  };
  fs.writeFileSync(
    path.join(outputDir, 'live-nature-extension-report.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
  if (coverageVisible) {
    await coverageLocator.screenshot({
      path: path.join(outputDir, 'nature-supplemental-coverage.png')
    });
  }
  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        await showFigureImageViewer('figure-5');
        return navigateFigureImageViewer('next');
      }
    });
  }, articleTab.id);
  await article.locator('#sci-figure-image-viewer img')
    .waitFor({ state: 'visible', timeout: 30000 });
  await article.screenshot({
    path: path.join(outputDir, 'nature-extended-data-hires-viewer.png'),
    fullPage: false
  });
  await panel.screenshot({
    path: path.join(outputDir, 'nature-figure-workspace.png'),
    fullPage: false
  });
  if (!report.passed) process.exitCode = 1;
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
