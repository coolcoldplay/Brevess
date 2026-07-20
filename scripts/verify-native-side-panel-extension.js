const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require('playwright');

const root = process.env.SCI_EXTENSION_ROOT
  ? path.resolve(process.env.SCI_EXTENSION_ROOT)
  : path.resolve(__dirname, '..');
const outputDir = process.env.SCI_QA_OUTPUT_DIR
  ? path.resolve(process.env.SCI_QA_OUTPUT_DIR)
  : path.join(root, 'output', 'playwright');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-side-panel-edge-'));
const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-side-panel-extension-'));
let activeContext = null;

function prepareQaExtension() {
  for (const directory of ['core', 'providers', 'vendor', 'icons']) {
    fs.cpSync(path.join(root, directory), path.join(extensionDir, directory), {
      recursive: true
    });
  }
  for (const filename of [
    'background.js', 'content.js', 'content.css', 'popup.html', 'popup.js', 'popup.css',
    'options.html', 'options.js', 'options.css', 'offscreen.html', 'offscreen.js',
    'offscreen-network-worker.js'
  ]) {
    fs.copyFileSync(path.join(root, filename), path.join(extensionDir, filename));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  fs.writeFileSync(
    path.join(extensionDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

function articleFixture() {
  return `<!doctype html><html><head>
    <title>OA mechanism review test</title>
    <link rel="canonical" href="https://example.org/oa-mechanism-review">
    <meta name="citation_doi" content="10.1000/oa-review-test">
  </head><body><main><article>
    <h1>OA mechanism review test</h1>
    <section><h2>Abstract</h2><p>This open-access review summarizes a defined molecular mechanism and its translational implications across experimental systems.</p></section>
    <section><h2>Introduction</h2><p>Metabolic signaling regulates immune adaptation through coordinated transcriptional and epigenetic programs in disease.</p></section>
    <section><h2>Mechanisms</h2><h3>Signal integration</h3><p>Activation of kinase A increased transcription factor B, which directly induced target C and promoted cellular survival.</p><p>Genetic inhibition of kinase A abolished target C induction, supporting a necessary mechanistic relationship.</p></section>
    <section><h2>Limitations</h2><p>Available studies used small preclinical cohorts and require validation in independent human samples.</p></section>
    <section><h2>Conclusions</h2><p>The evidence supports a testable pathway while leaving its clinical generalizability unresolved.</p></section>
  </article></main></body></html>`;
}

function figureWorkspaceFixture() {
  const panel = (label, method, observation) => ({
    panel: label,
    role: 'phenotype',
    phenotypeName: `${label} panel phenotype`,
    methodCategory: 'wet_lab',
    methods: [method],
    methodSource: 'caption',
    purpose: `Test the ${label} step in the evidence chain.`,
    design: 'Treatment versus matched control.',
    comparison: 'Treated group compared with control.',
    directObservation: observation,
    observationSource: 'caption_statement',
    localInference: 'The observation supports this local step only.',
    contribution: `Panel ${label} advances the Figure argument.`,
    inputBasis: {
      inputMode: 'caption_context', imageWidth: 0, imageHeight: 0,
      pixelsSupplied: false, attempts: 1
    }
  });
  const makeFigure = (number, panels) => ({
    figureId: `figure-${number}`,
    figureLabel: `Figure ${number}`,
    hasImage: false,
    caption: '',
    isSupplemental: false,
    panelHints: panels.map(item => item.panel),
    activeDepth: 'standard',
    standard: {
      analysisDepth: 'standard',
      basis: 'caption_context',
      figureQuestion: `What does Figure ${number} establish?`,
      coreConclusion: `Figure ${number} establishes one bounded evidence step.`,
      claimBoundary: 'Only caption and supplied body context were available.',
      authorAssembly: 'Panels progress from design to observation and interpretation.',
      panels,
      panelCoverage: {
        expectedPanels: panels.map(item => item.panel),
        returnedPanels: panels.map(item => item.panel),
        missingPanels: []
      },
      argumentChain: panels.map(item => ({
        panels: [item.panel], established: item.directObservation,
        handoff: 'Motivates the next Panel.', evidenceLevel: 'association'
      })),
      panelGroups: [], logicBridges: []
    },
    standardError: '', deep: null, deepLoading: false, deepError: '',
    panelFollowups: {}, panelFollowupLoading: {}, panelFollowupErrors: {}, expanded: false
  });
  return {
    status: { running: false, paused: false, phase: 'completed', figureProgress: [] },
    figures: [
      makeFigure(1, [panel('A', 'Western blot', 'Signal increased after treatment.'),
        panel('B', 'Flow cytometry', 'The responding population expanded.'),
        panel('C', 'CCK-8', 'Cell viability increased.')]),
      makeFigure(2, [panel('A', 'RNA-seq', 'A pathway signature was enriched.'),
        panel('B', 'qPCR', 'Target expression increased.')]),
      makeFigure(3, [panel('A', 'IHC', 'The phenotype was reproduced in tissue.')])
    ],
    totalFigures: 3,
    failedFigures: 0,
    crossFigureLogic: { result: null, loading: false, error: '' }
  };
}

async function extensionWorker(context) {
  const current = context.serviceWorkers()[0];
  return current || context.waitForEvent('serviceworker', { timeout: 15000 });
}

async function readDiagnosticDownload(download) {
  const filename = download.suggestedFilename();
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error(`Diagnostic download has no local path: ${filename}`);
  const bytes = fs.readFileSync(downloadPath);
  const json = filename.endsWith('.gz') ? zlib.gunzipSync(bytes) : bytes;
  return { filename, bytes: bytes.length, bundle: JSON.parse(json.toString('utf8')) };
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  prepareQaExtension();
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
    ]
  });
  activeContext = context;
  const pageErrors = [];
  const consoleErrors = [];
  const fixture = context.pages()[0] || await context.newPage();
  fixture.on('pageerror', error => pageErrors.push(`fixture: ${error.message}`));
  fixture.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(`fixture: ${message.text()}`);
  });
  await fixture.route('https://example.org/oa-mechanism-review', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: articleFixture()
  }));
  await fixture.goto('https://example.org/oa-mechanism-review', {
    waitUntil: 'domcontentloaded'
  });

  const beforeActivationRevision = await fixture.evaluate(() =>
    document.documentElement.dataset.sciLlmContentRevision || '');
  const worker = await extensionWorker(context);
  const extensionId = new URL(worker.url()).host;
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const fixtureTab = tabs.find(tab =>
    tab.url?.startsWith('https://example.org/oa-mechanism-review') ||
    tab.title === 'OA mechanism review test'
  ) || tabs.find(tab => tab.active);
  if (!fixtureTab?.id) {
    throw new Error(`Unable to resolve the fixture tab id: ${JSON.stringify(tabs)}`);
  }
  const sidePanelOptions = await worker.evaluate(
    tabId => chrome.sidePanel.getOptions({ tabId }),
    fixtureTab.id
  );
  await worker.evaluate(async tab => {
    await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'popup.html', enabled: true });
    const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation })
      .catch(() => {});
  }, fixtureTab);

  const sidePanel = await context.newPage();
  sidePanel.on('pageerror', error => pageErrors.push(`side-panel: ${error.message}`));
  sidePanel.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(`side-panel: ${message.text()}`);
  });
  await sidePanel.setViewportSize({ width: 420, height: 900 });
  await sidePanel.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded'
  });
  await fixture.bringToFront();
  await sidePanel.waitForFunction(() =>
    document.getElementById('sidePanelPaperTitle')?.textContent ===
      'OA mechanism review test'
  );
  const activated = await sidePanel.evaluate(async () => {
    await refreshManualAnnotationSummary();
    await refreshArticleWorkspace();
    await probeCurrentArticleArchive();
    return {
      title: document.getElementById('sidePanelPaperTitle')?.textContent || '',
      status: document.getElementById('articleNavigationStatus')?.textContent || '',
      viewCount: document.querySelectorAll('[data-workspace-view]').length,
      navCount: document.querySelectorAll('[data-workspace-target]').length,
      applyActionAboveEngine:
        document.getElementById('applyHighlight')?.compareDocumentPosition(
          document.querySelector('.analysis-engine-section')
        ) === Node.DOCUMENT_POSITION_FOLLOWING,
      analysisIconVisible: getComputedStyle(
        document.querySelector('[data-workspace-target="analysis"] .ph'), '::before'
      ).content !== 'none',
      removedAnalysisActions:
        !document.getElementById('openArticleNavigator') &&
        !document.getElementById('generateReviewOutline'),
      feedbackRemoved: !document.querySelector('a[href^="mailto:"]'),
      archivePromptHidden: document.getElementById('articleArchivePrompt')?.hidden,
      migrationScriptsLoaded: typeof SciLLM.validateArticleArchive === 'function'
    };
  });
  const afterActivationRevision = await fixture.evaluate(() =>
    document.documentElement.dataset.sciLlmContentRevision || '');
  const pageOverlayCount = await fixture.locator(
    '#sci-reading-panel,#sci-review-outline-panel,#sci-article-navigator,.sci-figure-walkthrough'
  ).count();
  const manualSelectionQa = await fixture.evaluate(async () => {
    const paragraph = document.querySelector('article section:nth-of-type(3) p');
    const node = paragraph?.firstChild;
    if (!node) return { toolbarVisible: false, reason: 'missing-fixture-text' };
    const selectAndWait = async (start, end) => {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, Math.min(end, node.textContent.length));
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const startedAt = performance.now();
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      while (!document.getElementById('sci-manual-toolbar') &&
          performance.now() - startedAt < 600) {
        await new Promise(resolve => setTimeout(resolve, 4));
      }
      return Math.round(performance.now() - startedAt);
    };
    const firstOpenMs = await selectAndWait(0, 42);
    const toolbar = document.getElementById('sci-manual-toolbar');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const secondOpenMs = await selectAndWait(12, 56);
    const result = {
      toolbarVisible: Boolean(toolbar) && Boolean(document.getElementById('sci-manual-toolbar')),
      categoryActions: toolbar?.querySelectorAll('.sci-manual-category').length || 0,
      hasMore: Boolean(toolbar?.querySelector('.sci-manual-text-action')),
      firstOpenMs,
      secondOpenMs
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return result;
  });

  const secondFixture = await context.newPage();
  secondFixture.on('pageerror', error => pageErrors.push(`fixture-2: ${error.message}`));
  secondFixture.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(`fixture-2: ${message.text()}`);
  });
  const secondUrl = 'https://example.org/oa-translational-review';
  const secondHtml = articleFixture()
    .replaceAll('OA mechanism review test', 'OA translational review test')
    .replaceAll('oa-mechanism-review', 'oa-translational-review');
  await secondFixture.route(secondUrl, route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: secondHtml
  }));
  const untouchedStartedAt = Date.now();
  await secondFixture.goto(secondUrl, { waitUntil: 'domcontentloaded' });
  await sidePanel.waitForFunction(() =>
    /尚未激活/.test(document.getElementById('sidePanelDocumentStatusText')?.textContent || '')
  );
  const untouchedReadyMs = Date.now() - untouchedStartedAt;
  const untouchedRevision = await secondFixture.evaluate(() =>
    document.documentElement.dataset.sciLlmContentRevision || '');
  const currentTabs = await worker.evaluate(() => chrome.tabs.query({}));
  const secondTab = currentTabs.find(tab => tab.url?.startsWith(secondUrl));
  if (!secondTab?.id) throw new Error('Unable to resolve second fixture tab');
  const untouchedSidePanelOptions = await worker.evaluate(
    tabId => chrome.sidePanel.getOptions({ tabId }), secondTab.id
  );

  await worker.evaluate(async tab => {
    await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'popup.html', enabled: true });
    const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation })
      .catch(() => {});
  }, secondTab);
  await secondFixture.bringToFront();
  await sidePanel.waitForFunction(() =>
    document.getElementById('sidePanelPaperTitle')?.textContent ===
      'OA translational review test'
  );
  await secondFixture.waitForFunction(() =>
    document.documentElement.dataset.sciLlmContentRevision ===
      '2.4.0-article-workspaces-r1', null, { timeout: 5000 }
  );
  const secondActivatedRevision = await secondFixture.evaluate(() =>
    document.documentElement.dataset.sciLlmContentRevision || '');
  const activatedSidePanelOptions = await worker.evaluate(
    tabId => chrome.sidePanel.getOptions({ tabId }), secondTab.id
  );

  const switchBackStartedAt = Date.now();
  await fixture.bringToFront();
  await sidePanel.waitForFunction(() =>
    document.getElementById('sidePanelPaperTitle')?.textContent ===
      'OA mechanism review test'
  );
  const switchBackMs = Date.now() - switchBackStartedAt;
  await fixture.waitForTimeout(80);
  const restoreHandleVisible = await fixture.locator('#sci-side-panel-restore').isVisible()
    .catch(() => false);
  if (restoreHandleVisible) {
    await fixture.locator('h1').click();
    await fixture.locator('#sci-side-panel-restore').waitFor({ state: 'detached', timeout: 1200 });
  }
  const restoreHandleCleared = await fixture.locator('#sci-side-panel-restore').count() === 0;
  const traceResponse = await worker.evaluate(
    tabId => chrome.tabs.sendMessage(tabId, { action: 'buildAdapterDiagnosticBundle' }),
    fixtureTab.id
  );
  const actualExtractionRuns = (traceResponse?.bundle?.trace || []).filter(record =>
    record.stage === 'extract_article' && record.status === 'complete' &&
    record.cacheHit !== true
  ).length;
  const restoredSidePanelOptions = await worker.evaluate(
    tabId => chrome.sidePanel.getOptions({ tabId }), fixtureTab.id
  );
  const multiTab = {
    untouchedRevision,
    untouchedReadyMs,
    untouchedSidePanelEnabled: untouchedSidePanelOptions.enabled,
    activatedSidePanelEnabled: activatedSidePanelOptions.enabled,
    restoredSidePanelEnabled: restoredSidePanelOptions.enabled,
    secondActivatedRevision,
    switchBackMs,
    restoreHandleVisible,
    restoreHandleCleared,
    activeTitleAfterSwitchBack: await sidePanel.locator('#sidePanelPaperTitle').textContent(),
    actualExtractionRuns
  };

  await fixture.bringToFront();
  const [diagnosticDownload] = await Promise.all([
    sidePanel.waitForEvent('download', { timeout: 30000 }),
    sidePanel.evaluate(() => exportAdapterDiagnosticBundle())
  ]);
  const firstDiagnostic = await readDiagnosticDownload(diagnosticDownload);

  const patchResult = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        globalThis.__sciDiagnosticOriginalExtractArticle = SciLLM.extractArticle;
        SciLLM.extractArticle = () => {
          const error = new Error('FORCED_EXTRACTOR_FAILURE_FOR_DIAGNOSTIC');
          error.code = 'FORCED_EXTRACTOR_FAILURE';
          throw error;
        };
        return true;
      }
    });
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'extractArticleForLLM',
      forceRefresh: true
    });
    return { patched: result === true, response };
  }, fixtureTab.id);

  await fixture.bringToFront();
  const failedConnectionUi = await sidePanel.evaluate(async () => {
    const originalMode = analysisMode;
    const originalSettings = llmSettingsState;
    analysisMode = 'llm';
    llmSettingsState = { ...(llmSettingsState || {}), effectiveMode: 'llm' };
    prepareState = 'idle';
    await initializeCurrentArticle({ retry: true });
    const result = {
      status: document.getElementById('sidePanelDocumentStatusText')?.textContent || '',
      retryVisible: !document.getElementById('retryArticlePreparation')?.hidden
    };
    analysisMode = originalMode;
    llmSettingsState = originalSettings;
    return result;
  });

  await fixture.bringToFront();
  const [failureDiagnosticDownload] = await Promise.all([
    sidePanel.waitForEvent('download', { timeout: 30000 }),
    sidePanel.evaluate(() => exportAdapterDiagnosticBundle())
  ]);
  const failureDiagnostic = await readDiagnosticDownload(failureDiagnosticDownload);

  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        if (globalThis.__sciDiagnosticOriginalExtractArticle) {
          SciLLM.extractArticle = globalThis.__sciDiagnosticOriginalExtractArticle;
          delete globalThis.__sciDiagnosticOriginalExtractArticle;
        }
      }
    });
  }, fixtureTab.id);

  await fixture.bringToFront();
  const archive = await sidePanel.evaluate(async () =>
    (await getCurrentArticleArchiveFromTab()).archive);
  archive.workspace.figureWorkspace = figureWorkspaceFixture();
  archive.workspace.figures = archive.workspace.figureWorkspace.figures;
  const archiveText = JSON.stringify(archive);
  const restored = await worker.evaluate(
    ({ tabId, value }) => chrome.tabs.sendMessage(tabId, {
      action: 'applyArticleArchiveSnapshot', archive: value
    }),
    { tabId: fixtureTab.id, value: archive }
  );

  const figureIncrementalQa = await sidePanel.evaluate(completeWorkspace => {
    const originalWorkspaceSnapshot = currentWorkspaceSnapshot;
    const originalFigureAnalysisState = figureAnalysisState;
    const originalFigureProgressRenderSignature = figureProgressRenderSignature;
    const pendingWorkspace = structuredClone(completeWorkspace);
    pendingWorkspace.status = {
      running: true,
      paused: false,
      phase: 'figure_panel_batch_complete',
      figureProgress: [{
        figureId: 'figure-1',
        figureLabel: 'Figure 1',
        phase: 'figure_panel_batch_complete',
        running: true,
        expectedPanels: ['A', 'B'],
        expectedPanelCount: 2,
        recognizedPanelCount: 2,
        batchRecognizedPanelCount: 2,
        unexpectedPanels: ['D', 'E'],
        ignoredUnexpectedPanelCount: 2,
        completedPanelBatches: 1,
        totalPanelBatches: 2,
        completedFigures: 0,
        totalFigures: 3,
        startedAt: Date.now() - 5000
      }]
    };
    pendingWorkspace.figures = pendingWorkspace.figures.map(figure => ({
      ...figure,
      standard: null,
      deep: null,
      standardError: '',
      deepError: ''
    }));
    const completeFirstFigure = completeWorkspace.figures[0];
    pendingWorkspace.figures[0].standard = {
      ...completeFirstFigure.standard,
      panels: completeFirstFigure.standard.panels.slice(0, 2),
      panelCoverage: {
        expectedPanels: ['A', 'B', 'C'],
        returnedPanels: ['A', 'B'],
        missingPanels: ['C'],
        unexpectedPanels: ['D', 'E'],
        ignoredUnexpectedPanelCount: 2
      }
    };
    currentWorkspaceSnapshot = {
      ...currentWorkspaceSnapshot,
      figures: pendingWorkspace
    };
    figureProgressRenderSignature = '';
    applyFigureAnalysisProgress(pendingWorkspace.status, false);
    const cards = Array.from(document.querySelectorAll('.workspace-figure-card'));
    const firstProgressText = cards[0]
      ?.querySelector('.workspace-figure-progress')?.textContent || '';
    const quickNavItem = document.querySelector('.figure-quick-nav-item');
    quickNavItem?.classList.add('show-panels');
    const elapsedOnlyStatus = structuredClone(pendingWorkspace.status);
    elapsedOnlyStatus.figureProgress[0].elapsedSeconds = 8;
    applyFigureAnalysisProgress(elapsedOnlyStatus, false);
    const quickNavAfterElapsed = document.querySelector('.figure-quick-nav-item');
    const elapsedText = cards[0]
      ?.querySelector('[data-figure-elapsed="true"]')?.textContent || '';
    const stablePollingKeepsQuickNavNode =
      quickNavItem === quickNavAfterElapsed && quickNavItem?.isConnected === true;
    const stablePollingKeepsHoverState =
      quickNavAfterElapsed?.classList.contains('show-panels') === true;
    const changedStatus = structuredClone(elapsedOnlyStatus);
    changedStatus.figureProgress[0].batchRecognizedPanelCount = 1;
    applyFigureAnalysisProgress(changedStatus, false);
    const result = {
      cardCount: cards.length,
      summaries: cards.map(card => card.querySelector('summary')?.textContent?.trim() || ''),
      firstHasPartialResult: Boolean(cards[0]?.querySelector('.workspace-figure-field')),
      firstPanelCatalogSize:
        cards[0]?.querySelectorAll('.workspace-figure-panel-card').length || 0,
      firstAnalyzedPanels: Array.from(
        cards[0]?.querySelectorAll('.workspace-panel-analyze') || []
      ).filter(button => button.textContent?.includes('重新解读')).length,
      secondHasResult: Boolean(cards[1]?.querySelector('.workspace-figure-field')),
      firstProgressText,
      stablePollingKeepsQuickNavNode,
      stablePollingKeepsHoverState,
      elapsedUpdatedWithoutRebuild: elapsedText === '已用时 8 秒',
      changedProgressRebuilds: quickNavAfterElapsed?.isConnected === false,
      reportsBatchCount: /本批有效 Panel：2/.test(firstProgressText),
      reportsIgnoredPanels: /已忽略模型重复返回的 2 个批次外 Panel（D、E）/.test(firstProgressText)
    };
    currentWorkspaceSnapshot = originalWorkspaceSnapshot;
    figureAnalysisState = originalFigureAnalysisState;
    figureProgressRenderSignature = originalFigureProgressRenderSignature;
    renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
    return result;
  }, figureWorkspaceFixture());

  // A real Edge side panel never becomes the active browser tab. Keep the
  // article active while exercising the panel's navigation handler.
  await fixture.bringToFront();
  await sidePanel.evaluate(() =>
    document.querySelector('[data-workspace-target="navigation"]')?.click());
  await sidePanel.waitForFunction(() =>
    document.querySelector('[data-workspace-view="navigation"]')?.classList.contains('active'));
  const navigationStatus = await sidePanel.locator('#articleNavigationStatus').textContent();
  await sidePanel.screenshot({
    path: path.join(outputDir, 'edge-native-side-panel-extension.png'),
    fullPage: true
  });

  await sidePanel.evaluate(async () => {
    document.querySelector('[data-workspace-target="figures"]')?.click();
    await refreshArticleWorkspace();
  });
  await sidePanel.locator('.workspace-figure-card').first().locator('summary').first().click();
  await sidePanel.locator('.workspace-figure-panel-card').first().locator('summary').first().click();
  await sidePanel.locator('.workspace-panel-ask').first().evaluate(button => {
    button.disabled = false;
    button.click();
  });
  await sidePanel.locator('.workspace-panel-followup-custom textarea').first()
    .fill('Why does this Panel use this comparison?');
  await sidePanel.evaluate(() => renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot));
  const quickNavPreHover = await sidePanel.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const view = document.querySelector('[data-workspace-view="figures"]');
    const nav = document.getElementById('figureQuickNav');
    const marker = document.querySelector('.figure-quick-nav-marker');
    const markerRect = marker?.getBoundingClientRect();
    const navRect = nav?.getBoundingClientRect();
    const markerStyle = marker ? getComputedStyle(marker) : null;
    const navStyle = nav ? getComputedStyle(nav) : null;
    return {
      activeWorkspaceView,
      viewHidden: view?.hidden,
      navHidden: nav?.hidden,
      navDisplay: navStyle?.display || '',
      navVisibility: navStyle?.visibility || '',
      navRect: navRect ? { width: navRect.width, height: navRect.height } : null,
      markerDisplay: markerStyle?.display || '',
      markerVisibility: markerStyle?.visibility || '',
      markerOpacity: markerStyle?.opacity || '',
      markerRect: markerRect ? {
        width: markerRect.width,
        height: markerRect.height,
        top: markerRect.top,
        bottom: markerRect.bottom
      } : null,
      markerVisible: marker?.checkVisibility?.({
        checkOpacity: true,
        checkVisibilityCSS: true
      }) === true,
      figureCount: currentWorkspaceSnapshot?.figures?.figures?.length || 0
    };
  });
  if (!quickNavPreHover.markerVisible) {
    throw new Error(`Figure quick navigation was hidden before hover: ${JSON.stringify(quickNavPreHover)}`);
  }
  await sidePanel.locator('.figure-quick-nav-marker').first().hover({ force: true });
  await sidePanel.locator('.figure-quick-nav-label').first().hover({ force: true });
  await sidePanel.waitForTimeout(120);
  const figureVisualQa = await sidePanel.evaluate(() => {
    const panelPopover = document.querySelector(
      '.figure-quick-nav-item.show-panels .figure-quick-nav-panel-popover'
    );
    const panelPopoverStyle = panelPopover ? getComputedStyle(panelPopover) : null;
    const panelPopoverRect = panelPopover?.getBoundingClientRect();
    const panelButtonElements = panelPopover
      ? Array.from(panelPopover.querySelectorAll('.figure-quick-nav-panel-button'))
      : [];
    const panelButtonRects = panelButtonElements.map(button => button.getBoundingClientRect());
    return {
      figureOpen: document.querySelector('.workspace-figure-card')?.open === true,
      panelOpen: document.querySelector('.workspace-figure-panel-card')?.open === true,
      followupOpen: document.querySelector('.workspace-panel-followup')?.hidden === false,
      draftPreserved: document.querySelector('.workspace-panel-followup-custom textarea')?.value ===
        'Why does this Panel use this comparison?',
      inputBasisVisible: Array.from(document.querySelectorAll('.workspace-figure-field'))
        .some(element => /图注与相关正文/.test(element.textContent || '')),
      quickNavVisible: document.getElementById('figureQuickNav')?.hidden === false,
      figureMarkers: document.querySelectorAll('.figure-quick-nav-marker').length,
      figureLabels: document.querySelectorAll('.figure-quick-nav-label').length,
      panelButtons: document.querySelectorAll('.figure-quick-nav-panel-button').length,
      panelPopoverOpen: Boolean(panelPopover),
      panelOrder: panelButtonElements.map(button => button.textContent?.trim() || ''),
      panelSingleColumn: panelPopoverStyle?.display === 'grid' && panelButtonRects.every((rect, index) =>
        index === 0 || (
          Math.abs(rect.left - panelButtonRects[0].left) < 1 &&
          rect.top >= panelButtonRects[index - 1].bottom
        )),
      panelPopoverVisual: panelPopover ? {
        opacity: panelPopoverStyle.opacity,
        visibility: panelPopoverStyle.visibility,
        width: panelPopoverRect.width,
        left: panelPopoverRect.left,
        right: panelPopoverRect.right
      } : null,
      collapsedResultSections: Array.from(
        document.querySelectorAll('.workspace-figure-result-section')
      ).every(section => section.open === false)
    };
  });
  await sidePanel.screenshot({
    path: path.join(outputDir, 'edge-figure-interaction-controls.png'),
    fullPage: true
  });
  await sidePanel.locator('.figure-quick-nav-marker').nth(1).hover({ force: true });
  await sidePanel.waitForTimeout(35);
  const quickNavSwitchQa = await sidePanel.evaluate(() => ({
    expandedFigureIds: Array.from(
      document.querySelectorAll('.figure-quick-nav-item.show-panels')
    ).map(item => item.dataset.figureId),
    firstFigureStillExpanded: document.querySelector(
      '.figure-quick-nav-item[data-figure-id="figure-1"]'
    )?.classList.contains('show-panels') === true
  }));
  await sidePanel.evaluate(() => document.activeElement?.blur?.());
  await sidePanel.locator('#sidePanelPaperTitle').hover({ force: true });
  await sidePanel.waitForTimeout(150);
  const quickNavExitQa = await sidePanel.evaluate(() => ({
    expandedItems: document.querySelectorAll('.figure-quick-nav-item.show-panels').length,
    hoveredItems: Array.from(document.querySelectorAll('.figure-quick-nav-item'))
      .filter(item => item.matches(':hover')).length,
    focusedItems: Array.from(document.querySelectorAll('.figure-quick-nav-item'))
      .filter(item => item.matches(':focus-within')).length
  }));

  const chatSourceSnapshot = await worker.evaluate(
    tabId => chrome.tabs.sendMessage(tabId, {
      action: 'getArticleWorkspaceSnapshot', forceRefresh: true
    }),
    fixtureTab.id
  );
  await sidePanel.evaluate(paragraphs => {
    globalThis.__sciQaChatParagraphs = paragraphs;
  }, chatSourceSnapshot?.snapshot?.paragraphs || []);
  await sidePanel.setViewportSize({ width: 574, height: 1345 });
  let articleChatQa = await sidePanel.evaluate(async () => {
    await refreshArticleWorkspace();
    llmSettingsState = {
      effectiveMode: 'llm',
      settings: {
        consentGranted: true,
        globalProfileId: 'profile_qa_deepseek',
        profileOrder: ['profile_qa_deepseek', 'profile_qa_openai'],
        profiles: {
          profile_qa_deepseek: {
            name: 'DeepSeek V4 Pro', providerId: 'deepseek',
            config: { model: 'deepseek-v4-pro', hasApiKey: true }
          },
          profile_qa_openai: {
            name: 'GPT 5 Mini', providerId: 'openai',
            config: { model: 'gpt-5-mini', hasApiKey: true }
          }
        }
      }
    };
    currentWorkspaceSnapshot = {
      ...(currentWorkspaceSnapshot || {}),
      chat: {
        loading: false, error: '',
        coverage: {
          sentParagraphs: 6, totalParagraphs: 6,
          sentCharacters: 720, totalCharacters: 720, truncated: false
        },
        messages: [{
          role: 'user', content: '作者用哪些证据支持核心机制？', createdAt: Date.now()
        }, {
          role: 'assistant',
          profileName: 'DeepSeek V4 Pro', model: 'deepseek-v4-pro',
          content: '正文给出了表型变化、遗传抑制和下游靶点三层证据；其中遗传抑制最直接支持必要性。',
          evidence: [{ sectionTitle: 'Mechanisms', support: '抑制 kinase A 后 target C 的诱导消失。' }],
          limitations: '当前正文仍缺少独立人群验证。', createdAt: Date.now()
        }]
      }
    };
    const sourceParagraphs = Array.isArray(globalThis.__sciQaChatParagraphs) &&
      globalThis.__sciQaChatParagraphs.length
      ? globalThis.__sciQaChatParagraphs
      : (Array.isArray(currentWorkspaceSnapshot?.paragraphs) ? currentWorkspaceSnapshot.paragraphs : []);
    const sourceA = sourceParagraphs[2] || sourceParagraphs[0] || {};
    const sourceB = sourceParagraphs[3] || sourceParagraphs[1] || sourceA;
    currentWorkspaceSnapshot.chat.messages = [{
      role: 'user', content: '读懂这篇文献需要了解哪些背景知识？', createdAt: Date.now()
    }, {
      role: 'assistant', profileName: 'DeepSeek V4 Pro', model: 'deepseek-v4-pro',
      content: '**建议先掌握以下背景**\n\n1. **信号转导**：理解激酶如何把外界刺激传入细胞。\n2. **转录调控**：理解转录因子如何改变靶基因表达。\n3. **必要性证据**：抑制关键节点后效应消失，比单纯相关性更有说服力。\n4. **证据边界**：前临床结果不能直接等同于人群中的临床效果。',
      evidence: [{
        paragraphId: sourceA.paragraphId || 'qa-paragraph-a', sourceKey: sourceA.sourceKey || 'qa-source-a', sectionTitle: sourceA.sectionTitle || 'Mechanisms',
        quote: sourceA.text || 'Activation of kinase A increased transcription factor B.',
        support: '该段定义了论文检验的信号通路。'
      }, {
        paragraphId: sourceB.paragraphId || 'qa-paragraph-b', sourceKey: sourceB.sourceKey || 'qa-source-b', sectionTitle: sourceB.sectionTitle || 'Mechanisms',
        quote: sourceB.text || 'Genetic inhibition abolished target induction.',
        support: '该段提供了必要性证据。'
      }],
      limitations: '当前正文仍缺少独立人群验证。', createdAt: Date.now()
    }, {
      role: 'user', content: '作者具体怎样设计实验来验证这一点？', createdAt: Date.now()
    }, {
      role: 'assistant', profileName: 'GPT 5 Mini', model: 'gpt-5-mini',
      content: '**实验逻辑分为三步：**\n\n1. **先观察响应**：处理后检测 kinase A 与 target C 的变化。\n2. **再做干预**：遗传抑制 kinase A，观察 target C 的诱导是否消失。\n3. **最后界定结论**：现有结果支持通路中的必要关系，但尚不能证明临床普适性。\n\n这种“观察—干预—边界”的组织方式，把相关性推进到了机制证据。',
      evidence: [{
        paragraphId: sourceA.paragraphId || 'qa-paragraph-a', sourceKey: sourceA.sourceKey || 'qa-source-a', sectionTitle: sourceA.sectionTitle || 'Mechanisms',
        quote: sourceA.text || 'Activation of kinase A increased transcription factor B.',
        support: '处理实验建立通路响应。'
      }, {
        paragraphId: sourceB.paragraphId || 'qa-paragraph-b', sourceKey: sourceB.sourceKey || 'qa-source-b', sectionTitle: sourceB.sectionTitle || 'Mechanisms',
        quote: sourceB.text || 'Genetic inhibition abolished target induction.',
        support: '遗传抑制实验检验必要性。'
      }],
      limitations: '网页正文没有提供效应量、置信区间或独立重复次数。', createdAt: Date.now()
    }];
    currentWorkspaceSnapshot.chat.messages[1].content =
      '**建议先掌握以下背景**\n\n1. **信号转导**：理解激酶 kinase A<sup>1</sup> 如何把外界刺激传入细胞。[[1]]\n2. **转录调控**：理解转录因子如何改变靶基因表达。[[1]]\n3. **必要性证据**：抑制关键节点后效应消失，比单纯相关性更有说服力。[[2]]\n4. **证据边界**：前临床结果不能直接等同于人群中的临床效果。[[2]]\n\n正文先用激活实验建立通路响应，再用遗传抑制检验关键节点是否不可替代。[[1]]\n\n这种“先观察、再干预”的组合，比只报告两个指标同时变化更接近机制论证。[[2]]\n\n阅读时还应区分细胞存活这一表型与临床获益，两者不能直接互换。[[2]]\n\n因此背景知识的重点不是记住术语，而是理解每类实验在因果链中的位置。[[1]]';
    currentWorkspaceSnapshot.chat.messages[3].content =
      '**实验逻辑分为三步**\n\n1. **先观察响应**：处理后检测 kinase A 与 target C 的变化。[[1]]\n2. **再做干预**：遗传抑制 kinase A，观察 target C 的诱导是否消失。[[2]]\n3. **最后界定结论**：现有结果支持通路中的必要关系，但尚不能证明临床普适性。[[2]]\n\n第一步回答通路是否随处理发生变化，第二步回答变化是否依赖 kinase A。[[1]]\n\n抑制后 target C 的诱导消失，是这里最关键的必要性证据。[[2]]\n\n不过，该设计仍不能单独排除所有旁路机制，也不能外推到独立人群。[[2]]\n\n因此更准确的结论是“支持一条可检验的必要关系”，而不是已经证明完整临床机制。[[2]]';
    const longAnswerAppendix = Array.from({ length: 12 }, (_, index) =>
      `补充说明 ${index + 1}：这一判断需要同时对照观察实验、干预实验与证据边界，避免把相关变化直接写成已经证实的完整因果机制。[[${index % 2 ? 2 : 1}]]`
    ).join('\n\n');
    currentWorkspaceSnapshot.chat.messages[1].content += `\n\n${longAnswerAppendix}`;
    currentWorkspaceSnapshot.chat.messages[3].content += `\n\n${longAnswerAppendix}`;
    const legacyMessages = currentWorkspaceSnapshot.chat.messages;
    currentWorkspaceSnapshot.chat.turns = [0, 2].map((questionIndex, turnIndex) => {
      const question = legacyMessages[questionIndex];
      const answer = legacyMessages[questionIndex + 1];
      return {
        turnId: `turn-qa-${turnIndex + 1}`,
        question: question.content,
        answerBlocks: [{
          blockId: `block-qa-${turnIndex + 1}`,
          markdown: answer.content,
          evidence: answer.evidence.map((item, evidenceIndex) => ({
            ...item,
            marker: String(evidenceIndex + 1),
            documentRevision: currentWorkspaceSnapshot.revision
          }))
        }],
        summary: '',
        status: 'completed',
        selectedProfileId: turnIndex === 0 ? 'profile_qa_deepseek' : 'profile_qa_openai',
        profileName: answer.profileName,
        model: answer.model,
        createdAt: question.createdAt,
        updatedAt: answer.createdAt
      };
    });
    currentWorkspaceSnapshot.chat.totalTurns = currentWorkspaceSnapshot.chat.turns.length;
    delete currentWorkspaceSnapshot.chat.messages;
    switchWorkspaceView('chat');
    renderArticleChatSnapshot(currentWorkspaceSnapshot);
    return {
      active: document.querySelector('[data-workspace-view="chat"]')?.hidden === false,
      profileOptions: document.querySelectorAll('#articleChatProfile option').length,
      messages: document.querySelectorAll('.article-chat-message').length,
      evidenceCollapsed: document.querySelector('.article-chat-evidence')?.open === false,
      limitationsCollapsed: document.querySelector('.article-chat-limitations')?.open === false
    };
  });
  await sidePanel.waitForTimeout(160);
  articleChatQa = await sidePanel.evaluate(() => {
    const messages = document.getElementById('articleChatMessages');
    const composer = document.getElementById('articleChatForm');
    const messageRect = messages?.getBoundingClientRect();
    const composerRect = composer?.getBoundingClientRect();
    return {
      active: document.querySelector('[data-workspace-view="chat"]')?.hidden === false,
      profileOptions: document.querySelectorAll('#articleChatProfile option').length,
      messages: document.querySelectorAll('.article-chat-message').length,
      userLabels: document.querySelectorAll(
        '.article-chat-message.is-user .article-chat-message-meta'
      ).length,
      assistantLabels: document.querySelectorAll(
        '.article-chat-message.is-assistant .article-chat-message-meta'
      ).length,
      boldNodes: document.querySelectorAll('.article-chat-message-content strong').length,
      superscriptNodes: document.querySelectorAll('.article-chat-message-content sup').length,
      literalSupTagsVisible: Array.from(document.querySelectorAll('.article-chat-message-content'))
        .some(element => element.textContent?.includes('<sup>')),
      listItems: document.querySelectorAll('.article-chat-message-content li').length,
      orderedLists: document.querySelectorAll('.article-chat-message-content ol').length,
      secondQuestionVisible: Array.from(document.querySelectorAll('.article-chat-message.is-user'))
        .some(message => message.textContent?.includes('作者具体怎样设计实验')),
      citationButtons: document.querySelectorAll('.article-chat-inline-citation').length,
      citationParagraphIds: Array.from(document.querySelectorAll('.article-chat-inline-citation'))
        .map(button => button.dataset.paragraphId).filter(Boolean),
      citationSourceKeys: Array.from(document.querySelectorAll('.article-chat-inline-citation'))
        .map(button => button.dataset.sourceKey).filter(Boolean),
      fallbackCitationRows: document.querySelectorAll('.article-chat-citation-fallback').length,
      limitationsCollapsed: Array.from(document.querySelectorAll('.article-chat-limitations'))
        .every(details => details.open === false),
      messagesOverflowY: messages ? getComputedStyle(messages).overflowY : '',
      messagesScrollable: Boolean(messages && messages.scrollHeight > messages.clientHeight),
      scrolledToLatest: Boolean(messages && messages.scrollTop > 0 &&
        messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 3),
      composerOutsideMessages: Boolean(messageRect && composerRect &&
        messageRect.bottom <= composerRect.top + 1)
    };
  });
  await sidePanel.locator('.article-chat-inline-citation:not(:disabled)').first().click();
  await fixture.waitForSelector('.sci-article-source-focus', { timeout: 1800 });
  articleChatQa.citationJumpFocused = await fixture.evaluate(() => {
    const focused = document.querySelector('.sci-article-source-focus');
    return Boolean(focused && /Activation of kinase A|Genetic inhibition of kinase A/
      .test(focused.textContent || ''));
  });
  await sidePanel.evaluate(() => {
    const messages = document.getElementById('articleChatMessages');
    if (messages) {
      messages.scrollTop = 0;
      messages.dispatchEvent(new Event('scroll'));
    }
  });
  await sidePanel.waitForTimeout(80);
  articleChatQa.returnLatestVisible = await sidePanel.evaluate(() =>
    document.getElementById('articleChatReturnLatest')?.hidden === false
  );
  await sidePanel.screenshot({
    path: path.join(outputDir, 'edge-article-chat-citations.png'),
    fullPage: true
  });
  await sidePanel.locator('#articleChatReturnLatest').click();
  await sidePanel.waitForTimeout(240);
  articleChatQa.returnLatestRestored = await sidePanel.evaluate(() => {
    const messages = document.getElementById('articleChatMessages');
    return Boolean(messages && messages.scrollTop + messages.clientHeight >=
      messages.scrollHeight - 3);
  });
  await sidePanel.screenshot({
    path: path.join(outputDir, 'edge-article-chat.png'),
    fullPage: true
  });

  const chatMutationSetup = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        const completedTurn = (turnId, question, answer) => {
          const turn = createArticleChatTurn(question, 'profile_qa_openai', { turnId });
          turn.answerBlocks = [{
            blockId: `block-${turnId}`,
            markdown: answer,
            evidence: [],
            createdAt: Date.now()
          }];
          turn.status = 'completed';
          turn.profileName = 'GPT 5 Mini';
          turn.model = 'gpt-5-mini';
          turn.updatedAt = Date.now();
          return turn;
        };
        const first = completedTurn(
          'turn-ui-first', '第一个待删除的问题', '第一个回答。'
        );
        const second = completedTurn(
          'turn-ui-regenerate', '请重新生成这个回答', '旧回答。'
        );
        const queued = createArticleChatTurn(
          '这个排队问题应当可以直接删除', 'profile_qa_openai',
          { turnId: 'turn-ui-queued' }
        );
        articleChatGeneration += 1;
        articleChatPumpPromise = null;
        articleChatState = {
          turns: [first, second, queued],
          loading: false,
          error: '',
          operationId: '',
          activeTurnId: '',
          coverage: null,
          memoryNeedsRebuild: false
        };
        for (const turn of articleChatState.turns) {
          await persistWorkspaceTurnCheckpoint(turn, { append: true, force: true });
        }
        await persistArticleWorkspaceArtifacts({ force: true });
        notifyArticleChatStateChanged('workspace_restored');
        return {
          workspaceId: currentArticleWorkspace?.workspaceId || '',
          turnIds: articleChatState.turns.map(turn => turn.turnId)
        };
      }
    });
    return result;
  }, fixtureTab.id);
  await sidePanel.evaluate(async () => {
    await refreshArticleWorkspace();
    switchWorkspaceView('chat');
  });
  await sidePanel.waitForFunction(() =>
    document.querySelectorAll('.article-chat-turn').length === 3
  );
  await sidePanel.locator(
    '[data-article-chat-action="delete-queued"][data-turn-id="turn-ui-queued"]'
  ).click();
  await sidePanel.waitForFunction(() =>
    !document.querySelector('[data-turn-id="turn-ui-queued"]') &&
    document.querySelectorAll('.article-chat-turn').length === 2
  );
  const queuedDeleteState = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => ({
        turnIds: articleChatState.turns.map(turn => turn.turnId),
        queuedRemaining: articleChatState.turns.some(turn => turn.status === 'queued')
      })
    });
    return result;
  }, fixtureTab.id);

  await sidePanel.locator(
    '[data-article-chat-action="delete-answer"][data-turn-id="turn-ui-regenerate"]'
  ).click();
  await sidePanel.waitForFunction(() => {
    const turn = document.querySelector('[data-turn-id="turn-ui-regenerate"]');
    return Boolean(turn && !turn.querySelector('.article-chat-answer-block') &&
      turn.querySelector('[data-article-chat-action="regenerate"]'));
  });
  const answerDeleteState = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        const turn = articleChatState.turns.find(item =>
          item.turnId === 'turn-ui-regenerate');
        return {
          status: String(turn?.status || ''),
          answerBlocks: turn?.answerBlocks?.length || 0
        };
      }
    });
    return result;
  }, fixtureTab.id);

  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        globalThis.__sciQaOriginalChatMutationSendMessage = original;
        chrome.runtime.sendMessage = async message => {
          if (message?.type === 'LLM_ASK_ARTICLE' &&
              message.turnId === 'turn-ui-regenerate') {
            return {
              success: true,
              data: {
                message: {
                  answerBlocks: [{
                    blockId: 'block-regenerated-qa',
                    markdown: '**重新生成成功**：这是新的完整回答。',
                    evidence: []
                  }],
                  summary: '重新生成成功',
                  status: 'completed'
                },
                route: {
                  effectiveProfileId: 'profile_qa_openai',
                  effectiveProfileName: 'GPT 5 Mini',
                  model: 'gpt-5-mini'
                },
                usage: { inputTokens: 10, outputTokens: 12 },
                coverage: { sentParagraphs: 1, totalParagraphs: 1, truncated: false }
              }
            };
          }
          return original(message);
        };
      }
    });
  }, fixtureTab.id);
  await sidePanel.locator(
    '[data-article-chat-action="regenerate"][data-turn-id="turn-ui-regenerate"]'
  ).click();
  await sidePanel.waitForFunction(() =>
    document.querySelector('[data-turn-id="turn-ui-regenerate"]')
      ?.textContent?.includes('重新生成成功') === true
  );
  const regenerateState = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        const turn = articleChatState.turns.find(item =>
          item.turnId === 'turn-ui-regenerate');
        const snapshot = {
          status: String(turn?.status || ''),
          answer: String(turn?.answerBlocks?.[0]?.markdown || ''),
          loading: articleChatState.loading === true
        };
        if (globalThis.__sciQaOriginalChatMutationSendMessage) {
          chrome.runtime.sendMessage = globalThis.__sciQaOriginalChatMutationSendMessage;
          delete globalThis.__sciQaOriginalChatMutationSendMessage;
        }
        return snapshot;
      }
    });
    return result;
  }, fixtureTab.id);

  await sidePanel.locator(
    '[data-article-chat-action="delete-turn"][data-turn-id="turn-ui-first"]'
  ).click();
  await sidePanel.waitForFunction(() =>
    !document.querySelector('[data-turn-id="turn-ui-first"]') &&
    document.querySelectorAll('.article-chat-turn').length === 1
  );
  await sidePanel.locator('#clearArticleChat').click();
  await sidePanel.waitForFunction(() =>
    document.querySelectorAll('.article-chat-turn').length === 0
  );
  let chatPersistenceSettled = false;
  const chatPersistenceStartedAt = Date.now();
  while (!chatPersistenceSettled && Date.now() - chatPersistenceStartedAt < 5000) {
    chatPersistenceSettled = await worker.evaluate(async ({ workspaceId, tabId }) => {
      const [{ result: response }] = await chrome.scripting.executeScript({
        target: { tabId }, world: 'ISOLATED',
        func: workspaceId => chrome.runtime.sendMessage({
          type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId
        }),
        args: [workspaceId]
      });
      if (!response?.success) return false;
      const index = response.data.assets.find(asset =>
        asset.relativePath === 'chat/index.json');
      return response.data.turns.length === 0 &&
        Array.isArray(index?.content?.turns) && index.content.turns.length === 0;
    }, { workspaceId: chatMutationSetup.workspaceId, tabId: fixtureTab.id });
    if (!chatPersistenceSettled) await sidePanel.waitForTimeout(50);
  }
  if (!chatPersistenceSettled) {
    const diagnostics = await worker.evaluate(async ({ workspaceId, tabId }) => {
      const [{ result: response }] = await chrome.scripting.executeScript({
        target: { tabId }, world: 'ISOLATED',
        func: workspaceId => chrome.runtime.sendMessage({
          type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId
        }),
        args: [workspaceId]
      });
      const index = response?.data?.assets?.find(asset =>
        asset.relativePath === 'chat/index.json');
      const [{ result: contentState }] = await chrome.scripting.executeScript({
        target: { tabId }, world: 'ISOLATED',
        func: () => ({
          turns: articleChatState.turns.map(turn => ({
            turnId: turn.turnId, status: turn.status,
            blocks: turn.answerBlocks?.length || 0
          })),
          mutationPending: Boolean(articleWorkspaceMutationTail),
          lifecycle: articleWorkspaceLifecycleGeneration
        })
      });
      return {
        success: response?.success,
        storedTurns: response?.data?.turns?.map(turn => ({
          turnId: turn.turnId, status: turn.status,
          blocks: turn.answerBlocks?.length || 0
        })) || [],
        indexTurns: index?.content?.turns?.map(turn => ({
          turnId: turn.turnId, status: turn.status,
          blocks: turn.answerBlocks?.length || 0
        })) || [],
        contentState
      };
    }, { workspaceId: chatMutationSetup.workspaceId, tabId: fixtureTab.id });
    throw new Error(`Chat mutations were not persisted: ${JSON.stringify(diagnostics)}`);
  }
  const chatMutationQa = await worker.evaluate(async ({ workspaceId, tabId }) => {
    const [{ result: response }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: workspaceId => chrome.runtime.sendMessage({
        type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId
      }),
      args: [workspaceId]
    });
    const index = response?.data?.assets?.find(asset =>
      asset.relativePath === 'chat/index.json');
    return {
      setupTurns: 3,
      queuedDeleted: true,
      queuedRemaining: false,
      answerDeleteState: null,
      regenerateState: null,
      finalStoredTurns: response?.data?.turns?.length ?? -1,
      finalIndexTurns: index?.content?.turns?.length ?? -1
    };
  }, { workspaceId: chatMutationSetup.workspaceId, tabId: fixtureTab.id });
  chatMutationQa.queuedDeleted =
    !queuedDeleteState.turnIds.includes('turn-ui-queued');
  chatMutationQa.queuedRemaining = queuedDeleteState.queuedRemaining;
  chatMutationQa.answerDeleteState = answerDeleteState;
  chatMutationQa.regenerateState = regenerateState;

  await fixture.evaluate(() => {
    const section = document.querySelector('article section:nth-of-type(3)');
    const text = 'A dynamically loaded mechanistic paragraph is represented twice by responsive markup but should count once.';
    for (let index = 0; index < 2; index += 1) {
      const paragraph = document.createElement('div');
      paragraph.className = `Paragraph responsive-copy-${index + 1}`;
      paragraph.textContent = text;
      section?.appendChild(paragraph);
    }
  });
  await sidePanel.waitForFunction(() =>
    /7 段正文/.test(document.getElementById('articleNavigationStatus')?.textContent || ''),
    null,
    { timeout: 4000 }
  );
  const dynamicParagraphQa = await sidePanel.evaluate(() => ({
    status: document.getElementById('articleNavigationStatus')?.textContent || '',
    paragraphCount: currentWorkspaceSnapshot?.paragraphs?.length || 0
  }));

  const options = await context.newPage();
  options.on('pageerror', error => pageErrors.push(`options: ${error.message}`));
  await options.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: 'domcontentloaded'
  });
  const migrationControls = await options.locator(
    '#exportMigrationBundle,#importMigrationBundle,#confirmMigrationImport'
  ).count();
  const supportEmail = await options.locator('#support a[href^="mailto:"]').textContent();
  await options.waitForFunction(() =>
    document.querySelectorAll('#providerId option').length >= 5 &&
    document.querySelectorAll('#apiProfileList [data-profile-id]').length >= 1
  );
  const workspaceOverviewFixture = await options.evaluate(async workspace => {
    const ensure = await callBackground({
      type: 'ARTICLE_WORKSPACE_ENSURE', workspace
    });
    const asset = await callBackground({
      type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
      workspaceId: workspace.workspaceId,
      relativePath: 'figures/inventory.json',
      content: {
        figures: [
          { figureId: 'figure-qa-1', panelHints: ['A', 'B'] },
          { figureId: 'figure-qa-2', panelHints: ['A'] }
        ]
      }
    });
    const turn = await callBackground({
      type: 'ARTICLE_WORKSPACE_SAVE_TURN',
      workspaceId: workspace.workspaceId,
      turn: {
        turnId: 'turn-qa-1',
        question: 'How is the evidence organized?',
        status: 'complete',
        answerBlocks: [{ blockId: 'block-1', markdown: 'A bounded answer.' }]
      }
    });
    await refreshArticleWorkspaceOverview();
    return {
      workspaceId: ensure.workspace.workspaceId,
      ensured: Boolean(ensure.workspace),
      assetSaved: asset.saved === true,
      turnSaved: turn.saved === true
    };
  }, {
    schemaVersion: 1,
    workspaceId: `workspace:${'e'.repeat(64)}`,
    canonicalUrl: 'https://example.org/qa-workspace-search-target',
    aliases: [{ type: 'doi', value: '10.1000/qa-workspace' }],
    title: 'QA Workspace Search Target',
    directoryName: `QA Workspace Search Target--${'e'.repeat(16)}`,
    revision: '5'.repeat(64),
    contentHash: '5'.repeat(64),
    workspaceGeneration: 1
  });
  await options.waitForFunction(workspaceId =>
    articleWorkspaceOverviewUi.loading === false &&
    articleWorkspaceOverviewUi.items.some(item => item.workspaceId === workspaceId) &&
    articleWorkspaceOverviewUi.details.has(workspaceId),
  workspaceOverviewFixture.workspaceId);
  const workspaceOverviewQa = await options.evaluate(workspaceId => {
    const item = articleWorkspaceOverviewUi.items.find(entry => entry.workspaceId === workspaceId);
    const detail = articleWorkspaceOverviewUi.details.get(workspaceId);
    const search = document.getElementById('articleWorkspaceSearch');
    search.value = 'qa workspace search target';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const cards = Array.from(document.querySelectorAll('.article-workspace-card'));
    const matchingTitle = cards[0]?.querySelector('.article-workspace-title')?.textContent || '';
    const metrics = cards[0]?.querySelector('.article-workspace-metrics')?.textContent || '';
    const checkbox = cards[0]?.querySelector('.article-workspace-select');
    checkbox?.click();
    const bulkClearEnabledAfterSelect =
      document.getElementById('clearSelectedArticleWorkspaces')?.disabled === false;
    checkbox?.click();
    return {
      listItemFound: Boolean(item),
      detailLoaded: Boolean(detail),
      detailCounts: detail ? {
        chatTurns: detail.chatTurnCount,
        figures: detail.figureCount,
        panels: detail.panelCount
      } : null,
      filteredCardCount: cards.length,
      matchingTitle,
      metrics,
      bulkClearEnabledAfterSelect,
      bulkClearDisabledAfterDeselect:
        document.getElementById('clearSelectedArticleWorkspaces')?.disabled === true
    };
  }, workspaceOverviewFixture.workspaceId);
  const workspaceExportButton = options.locator(
    `[data-workspace-action="export"][data-workspace-id="${workspaceOverviewFixture.workspaceId}"]`
  );
  const [workspaceDownload] = await Promise.all([
    options.waitForEvent('download', { timeout: 30000 }),
    workspaceExportButton.click()
  ]);
  const workspaceExport = await readDiagnosticDownload(workspaceDownload);
  workspaceOverviewQa.exportedWorkspaceId = workspaceExport.bundle.workspace?.workspaceId || '';
  workspaceOverviewQa.exportContainsSecrets =
    /apiKey|authorization|absolutePath/i.test(JSON.stringify(workspaceExport.bundle));
  await options.locator(
    `[data-workspace-action="restore"][data-workspace-id="${workspaceOverviewFixture.workspaceId}"]`
  ).click();
  await options.waitForFunction(() =>
    /需要重新授权本地保存目录/.test(
      document.getElementById('articleWorkspaceOverviewStatus')?.textContent || ''
    )
  );
  workspaceOverviewQa.restoreWithoutDirectoryExplained = true;
  options.once('dialog', dialog => dialog.accept());
  await options.locator(
    `[data-workspace-action="clear"][data-workspace-id="${workspaceOverviewFixture.workspaceId}"]`
  ).click();
  await options.waitForFunction(workspaceId =>
    articleWorkspaceOverviewUi.loading === false &&
    !articleWorkspaceOverviewUi.items.some(item => item.workspaceId === workspaceId),
  workspaceOverviewFixture.workspaceId);
  workspaceOverviewQa.deletedFromOverview = true;
  workspaceOverviewQa.clearStatus = await options.locator(
    '#articleWorkspaceOverviewStatus'
  ).textContent();
  const activeWorkspaceBeforeDeletion = await worker.evaluate(async tabId => {
    await chrome.tabs.sendMessage(tabId, { action: 'saveArticleWorkspaceNow' });
    return chrome.tabs.sendMessage(tabId, { action: 'getArticleWorkspaceSnapshot' });
  }, fixtureTab.id);
  const activeWorkspaceId = activeWorkspaceBeforeDeletion?.snapshot?.localWorkspace?.workspaceId;
  const activeWorkspaceGeneration = Number(
    activeWorkspaceBeforeDeletion?.snapshot?.localWorkspace?.workspaceGeneration
  ) || 0;
  if (!activeWorkspaceId) throw new Error('Active article workspace was unavailable before deletion');
  await options.evaluate(() => {
    const search = document.getElementById('articleWorkspaceSearch');
    if (search) search.value = '';
    articleWorkspaceOverviewUi.query = '';
    articleWorkspaceOverviewUi.page = 1;
    return refreshArticleWorkspaceOverview();
  });
  await options.waitForFunction(workspaceId =>
    articleWorkspaceOverviewUi.loading === false &&
    articleWorkspaceOverviewUi.items.some(item => item.workspaceId === workspaceId),
  activeWorkspaceId);
  const lateFigureSetup = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        const figure = {
          figureId: 'figure-stale-qa',
          figureLabel: 'Figure stale QA',
          caption: 'A delayed Figure response must not survive workspace deletion.',
          panelHints: ['A'],
          contextParagraphs: [],
          imageElements: [],
          isSupplemental: false
        };
        figureWorkspaceInventory = [figure];
        figureWalkthroughState.set(figure.figureId, {
          figure,
          figureInputHash: '',
          standard: null,
          standardError: '',
          deep: null,
          activeDepth: 'standard',
          deepLoading: false,
          deepError: '',
          panelFollowups: {},
          panelFollowupHistories: {},
          panelFollowupLoading: {},
          panelFollowupErrors: {},
          panelAnalyses: {},
          panelAnalysisLoading: {},
          panelAnalysisErrors: {},
          expanded: true
        });
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        globalThis.__sciQaOriginalFigureRuntimeSendMessage = original;
        globalThis.__sciQaResolveLateFigure = null;
        globalThis.__sciQaLateFigureOutcome = null;
        chrome.runtime.sendMessage = async message => {
          if (message?.type === 'LLM_ANALYZE_FIGURES' &&
              message.figures?.[0]?.figureId === figure.figureId) {
            return new Promise(resolve => {
              globalThis.__sciQaResolveLateFigure = resolve;
            });
          }
          return original(message);
        };
        globalThis.__sciQaLateFigurePromise = analyzeSingleFigureWithLLM(
          figure.figureId, { forceRefresh: true }
        ).then(value => {
          globalThis.__sciQaLateFigureOutcome = {
            settled: 'fulfilled', value
          };
          return globalThis.__sciQaLateFigureOutcome;
        }).catch(error => {
          globalThis.__sciQaLateFigureOutcome = {
            settled: 'rejected',
            code: String(error?.code || ''),
            message: String(error?.message || '')
          };
          return globalThis.__sciQaLateFigureOutcome;
        });
        const startedAt = Date.now();
        while (!globalThis.__sciQaResolveLateFigure && Date.now() - startedAt < 1500) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        return {
          deferred: typeof globalThis.__sciQaResolveLateFigure === 'function',
          promiseAttached: Boolean(figureDepthAnalysisPromise),
          operationActive: Boolean(figureOperationState.active),
          progressSize: figureProgressById.size,
          lifecycle: articleWorkspaceLifecycleGeneration
        };
      }
    });
    return result;
  }, fixtureTab.id);
  if (!lateFigureSetup?.deferred) {
    throw new Error(`Unable to establish deferred Figure QA: ${JSON.stringify(lateFigureSetup)}`);
  }
  options.once('dialog', dialog => dialog.accept());
  await options.evaluate(workspaceId => clearArticleWorkspaces([workspaceId]), activeWorkspaceId);
  await fixture.bringToFront();
  const deletionSynced = await sidePanel.waitForFunction(previousGeneration => {
    const workspace = currentWorkspaceSnapshot?.localWorkspace;
    const figures = currentWorkspaceSnapshot?.figures?.figures || [];
    return Number(workspace?.workspaceGeneration || 0) > previousGeneration &&
      Number(currentWorkspaceSnapshot?.chat?.totalTurns || 0) === 0 &&
      figures.every(figure => !figure.standard && !figure.deep);
  }, activeWorkspaceGeneration, { timeout: 5000 }).then(() => true).catch(() => false);
  if (!deletionSynced) {
    const [contentState] = await worker.evaluate(async tabId => {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: () => ({
          workspaceId: currentArticleWorkspace?.workspaceId || '',
          workspaceGeneration: Number(currentArticleWorkspace?.workspaceGeneration) || 0,
          lifecycle: articleWorkspaceLifecycleGeneration,
          pendingDeletionId: pendingExternalWorkspaceDeletionId,
          writesFrozen: articleWorkspaceSaveFrozen,
          chatTurns: articleChatState.turns.length,
          analyzedFigures: Array.from(figureWalkthroughState.values())
            .filter(figure => figure.standard || figure.deep).length
        })
      });
      return [result];
    }, fixtureTab.id);
    const panelState = await sidePanel.evaluate(() => ({
      workspaceId: currentWorkspaceSnapshot?.localWorkspace?.workspaceId || '',
      workspaceGeneration: Number(
        currentWorkspaceSnapshot?.localWorkspace?.workspaceGeneration
      ) || 0,
      chatTurns: Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0,
      analyzedFigures: (currentWorkspaceSnapshot?.figures?.figures || [])
        .filter(figure => figure.standard || figure.deep).length,
      status: document.getElementById('articleNavigationStatus')?.textContent || ''
    }));
    const optionsState = await options.evaluate(workspaceId => ({
      status: document.getElementById('articleWorkspaceOverviewStatus')?.textContent || '',
      loading: articleWorkspaceOverviewUi.loading,
      listed: articleWorkspaceOverviewUi.items.some(item => item.workspaceId === workspaceId)
    }), activeWorkspaceId);
    throw new Error(`Active workspace deletion did not synchronize: ${JSON.stringify({
      activeWorkspaceId,
      activeWorkspaceGeneration,
      contentState,
      panelState,
      optionsState
    })}`);
  }
  const activeWorkspaceAfterDeletion = await worker.evaluate(
    tabId => chrome.tabs.sendMessage(tabId, { action: 'getArticleWorkspaceSnapshot' }),
    fixtureTab.id
  );
  const paragraphTextsBeforeDeletion = (
    activeWorkspaceBeforeDeletion?.snapshot?.paragraphs || []
  ).map(paragraph => paragraph.text);
  const paragraphTextsAfterDeletion = (
    activeWorkspaceAfterDeletion?.snapshot?.paragraphs || []
  ).map(paragraph => paragraph.text);
  await options.evaluate(() => refreshArticleWorkspaceOverview());
  await options.waitForFunction(workspaceId =>
    articleWorkspaceOverviewUi.loading === false &&
    articleWorkspaceOverviewUi.items.some(item => item.workspaceId === workspaceId) &&
    articleWorkspaceOverviewUi.details.has(workspaceId),
  activeWorkspaceId);
  const activeWorkspaceDeletionQa = await options.evaluate((input) => {
    const detail = articleWorkspaceOverviewUi.details.get(input.workspaceId);
    return {
      workspaceIdStable: input.workspaceId === input.afterWorkspaceId,
      generationBefore: input.generationBefore,
      generationAfter: input.generationAfter,
      paragraphCountBefore: input.paragraphCountBefore,
      paragraphCountAfter: input.paragraphCountAfter,
      addedParagraphs: input.addedParagraphs,
      removedParagraphs: input.removedParagraphs,
      recreatedInOverview: articleWorkspaceOverviewUi.items.some(item =>
        item.workspaceId === input.workspaceId
      ),
      storedChatTurns: Number(detail?.chatTurnCount) || 0,
      clearStatus: document.getElementById('articleWorkspaceOverviewStatus')?.textContent || ''
    };
  }, {
    workspaceId: activeWorkspaceId,
    afterWorkspaceId: activeWorkspaceAfterDeletion?.snapshot?.localWorkspace?.workspaceId || '',
    generationBefore: activeWorkspaceGeneration,
    generationAfter: Number(
      activeWorkspaceAfterDeletion?.snapshot?.localWorkspace?.workspaceGeneration
    ) || 0,
    paragraphCountBefore: paragraphTextsBeforeDeletion.length,
    paragraphCountAfter: paragraphTextsAfterDeletion.length,
    addedParagraphs: paragraphTextsAfterDeletion.filter(text =>
      !paragraphTextsBeforeDeletion.includes(text)
    ),
    removedParagraphs: paragraphTextsBeforeDeletion.filter(text =>
      !paragraphTextsAfterDeletion.includes(text)
    )
  });
  Object.assign(activeWorkspaceDeletionQa, await sidePanel.evaluate(() => ({
    sidePanelChatTurns: Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0,
    analyzedFigures: (currentWorkspaceSnapshot?.figures?.figures || [])
      .filter(figure => figure.standard || figure.deep).length,
    navigationStatus: document.getElementById('articleNavigationStatus')?.textContent || '',
    workspaceGeneration: Number(
      currentWorkspaceSnapshot?.localWorkspace?.workspaceGeneration
    ) || 0
  })));
  const lateFigureBeforeRelease = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => ({
        promiseDetached: !figureDepthAnalysisPromise,
        operationActive: Boolean(figureOperationState.active),
        progressSize: figureProgressById.size,
        statusPhase: String(figureAnalysisStatus.phase || ''),
        statusRunning: figureAnalysisStatus.running === true,
        lifecycle: articleWorkspaceLifecycleGeneration
      })
    });
    return result;
  }, fixtureTab.id);
  const lateFigureResolved = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        const resolve = globalThis.__sciQaResolveLateFigure;
        if (typeof resolve !== 'function') return false;
        resolve({
          success: true,
          data: {
            figureResults: [{
              figureId: 'figure-stale-qa',
              figureLabel: 'Figure stale QA',
              analysisDepth: 'standard',
              panels: [],
              argumentChain: []
            }],
            route: { effectiveProfileName: 'Deferred Figure QA', model: 'qa-model' }
          }
        });
        await globalThis.__sciQaLateFigurePromise;
        return true;
      }
    });
    return result;
  }, fixtureTab.id);
  const lateFigureDeletionQa = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        const outcome = globalThis.__sciQaLateFigureOutcome;
        const snapshot = {
          responseReleased: true,
          outcome,
          promiseDetached: !figureDepthAnalysisPromise,
          operationActive: Boolean(figureOperationState.active),
          progressSize: figureProgressById.size,
          progressIds: [...figureProgressById.keys()],
          statusPhase: String(figureAnalysisStatus.phase || ''),
          statusRunning: figureAnalysisStatus.running === true,
          staleFigurePresent: figureWalkthroughState.has('figure-stale-qa'),
          lifecycle: articleWorkspaceLifecycleGeneration
        };
        if (globalThis.__sciQaOriginalFigureRuntimeSendMessage) {
          chrome.runtime.sendMessage = globalThis.__sciQaOriginalFigureRuntimeSendMessage;
          delete globalThis.__sciQaOriginalFigureRuntimeSendMessage;
        }
        delete globalThis.__sciQaResolveLateFigure;
        delete globalThis.__sciQaLateFigurePromise;
        delete globalThis.__sciQaLateFigureOutcome;
        return snapshot;
      }
    });
    return result;
  }, fixtureTab.id);
  lateFigureDeletionQa.responseReleased = lateFigureResolved === true;
  lateFigureDeletionQa.beforeRelease = lateFigureBeforeRelease;
  const lateChatSetup = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        globalThis.__sciQaOriginalRuntimeSendMessage = original;
        globalThis.__sciQaResolveLateChat = null;
        const intercepted = function(message, ...args) {
          if (message?.type === 'LLM_ASK_ARTICLE' &&
              message.question === '__SCI_QA_STALE_CHAT__') {
            return new Promise(resolve => {
              globalThis.__sciQaResolveLateChat = resolve;
            });
          }
          return original(message, ...args);
        };
        chrome.runtime.sendMessage = intercepted;
        const queued = await askArticleWithLLM(
          '__SCI_QA_STALE_CHAT__', 'profile_qa_deferred'
        );
        const startedAt = Date.now();
        while (!globalThis.__sciQaResolveLateChat && Date.now() - startedAt < 1500) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        return {
          patched: chrome.runtime.sendMessage === intercepted,
          queued: queued?.queued === true,
          deferred: typeof globalThis.__sciQaResolveLateChat === 'function',
          generation: Number(currentArticleWorkspace?.workspaceGeneration) || 0,
          chatTurns: articleChatState.turns.length,
          loading: articleChatState.loading
        };
      }
    });
    return result;
  }, fixtureTab.id);
  if (!lateChatSetup.patched || !lateChatSetup.queued || !lateChatSetup.deferred) {
    throw new Error(`Unable to establish deferred chat QA: ${JSON.stringify(lateChatSetup)}`);
  }
  await options.evaluate(() => {
    articleWorkspaceOverviewUi.query = '';
    articleWorkspaceOverviewUi.page = 1;
    return refreshArticleWorkspaceOverview();
  });
  await options.waitForFunction(workspaceId =>
    articleWorkspaceOverviewUi.loading === false &&
    articleWorkspaceOverviewUi.items.some(item => item.workspaceId === workspaceId),
  activeWorkspaceId);
  options.once('dialog', dialog => dialog.accept());
  await options.evaluate(workspaceId => clearArticleWorkspaces([workspaceId]), activeWorkspaceId);
  const lateChatResolved = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        const resolve = globalThis.__sciQaResolveLateChat;
        if (typeof resolve !== 'function') return false;
        resolve({
          success: true,
          data: {
            message: {
              status: 'completed',
              summary: 'This stale answer must never survive deletion.',
              answerBlocks: [{
                blockId: 'stale-block',
                markdown: 'STALE ANSWER MUST NOT BE SAVED',
                evidence: []
              }]
            },
            route: { effectiveProfileName: 'Deferred QA', model: 'qa-model' },
            plan: {},
            coverage: {}
          }
        });
        globalThis.__sciQaResolveLateChat = null;
        return true;
      }
    });
    return result;
  }, fixtureTab.id);
  await fixture.bringToFront();
  await sidePanel.waitForFunction(previousGeneration =>
    Number(currentWorkspaceSnapshot?.localWorkspace?.workspaceGeneration || 0) >
      previousGeneration &&
    Number(currentWorkspaceSnapshot?.chat?.totalTurns || 0) === 0,
  activeWorkspaceDeletionQa.generationAfter, { timeout: 5000 });
  await sidePanel.waitForTimeout(250);
  const lateChatDeletionQa = await worker.evaluate(async tabId => {
    await new Promise(resolve => setTimeout(resolve, 50));
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        const state = {
          chatTurns: articleChatState.turns.length,
          loading: articleChatState.loading,
          workspaceGeneration: Number(currentArticleWorkspace?.workspaceGeneration) || 0,
          staleTextInMemory: JSON.stringify(articleChatState).includes(
            'STALE ANSWER MUST NOT BE SAVED'
          )
        };
        if (globalThis.__sciQaOriginalRuntimeSendMessage) {
          chrome.runtime.sendMessage = globalThis.__sciQaOriginalRuntimeSendMessage;
          delete globalThis.__sciQaOriginalRuntimeSendMessage;
        }
        delete globalThis.__sciQaResolveLateChat;
        return state;
      }
    });
    return result;
  }, fixtureTab.id);
  const lateChatDetail = await options.evaluate(
    workspaceId => callBackground({ type: 'ARTICLE_WORKSPACE_DETAIL', workspaceId }),
    activeWorkspaceId
  );
  lateChatDeletionQa.storedChatTurns = Number(lateChatDetail?.chatTurnCount) || 0;
  lateChatDeletionQa.staleTextStored = JSON.stringify(lateChatDetail || {}).includes(
    'STALE ANSWER MUST NOT BE SAVED'
  );
  lateChatDeletionQa.responseReleased = lateChatResolved === true;
  Object.assign(lateChatDeletionQa, await sidePanel.evaluate(() => ({
    sidePanelChatTurns: Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0,
    staleTextInSidePanel: document.body.textContent.includes(
      'STALE ANSWER MUST NOT BE SAVED'
    )
  })));
  const modelConfigurationQa = await options.evaluate(async () => {
    const provider = document.getElementById('providerId');
    const model = document.getElementById('model');
    const suggestions = () => Array.from(
      document.querySelectorAll('#modelSuggestions option')
    ).map(option => option.value);
    const change = element => element.dispatchEvent(
      new Event('change', { bubbles: true })
    );
    provider.value = 'deepseek';
    change(provider);
    const deepseekDefault = model.value;
    const deepseekSuggestions = suggestions();
    model.value = 'deepseek-private-science-model';
    model.dispatchEvent(new Event('input', { bubbles: true }));
    const customModelAccepted = model.value === 'deepseek-private-science-model';

    provider.value = 'openai-compatible';
    change(provider);
    const compatibleFieldsVisible =
      document.getElementById('compatibleFields')?.hidden === false;
    const preset = document.getElementById('compatiblePreset');
    preset.value = 'qwen';
    change(preset);
    const presetResult = {
      model: model.value,
      baseUrl: document.getElementById('baseUrl').value,
      suggestions: suggestions()
    };

    model.value = 'private-compatible-model';
    model.dispatchEvent(new Event('input', { bubbles: true }));
    const customCompatibleModelAccepted = model.value === 'private-compatible-model';
    const sentinel = document.getElementById('articleWorkspacePreviousPage');
    const sentinelWasDisabled = sentinel?.disabled === true;
    document.getElementById('baseUrl').value = 'not-a-valid-url';
    let rejected = false;
    try {
      await persistForm(false);
    } catch (_) {
      rejected = true;
    }
    const failureStatus = document.getElementById('status')?.textContent || '';
    const result = {
      deepseekDefault,
      deepseekSuggestions,
      customModelAccepted,
      compatibleFieldsVisible,
      presetResult,
      customCompatibleModelAccepted,
      rejected,
      failureStatus,
      saveButtonRecovered: document.getElementById('saveSettings')?.disabled === false,
      testButtonRecovered: document.getElementById('testProvider')?.disabled === false,
      preDisabledButtonPreserved: sentinelWasDisabled && sentinel?.disabled === true,
      saveGuardReleased: profileActionInFlight.save !== true
    };
    profileEditorDirty = false;
    renderProfileEditor();
    renderRouteOptions();
    return result;
  });
  await options.goto(`chrome-extension://${extensionId}/options.html#onboarding`, {
    waitUntil: 'domcontentloaded'
  });
  await options.reload({ waitUntil: 'domcontentloaded' });
  await options.waitForFunction(() =>
    document.body.dataset.onboardingStep === 'storage' &&
    document.getElementById('onboardingContinue')?.disabled === false
  );
  const settingsDatabaseQa = await options.evaluate(async () => {
    const database = await SciLLM.openUserDataDatabase(indexedDB);
    return {
      moduleAvailable: typeof SciLLM.openUserDataDatabase === 'function',
      directoryStoreAvailable: database.objectStoreNames.contains('directoryHandles'),
      continueEnabledAfterNoDirectory:
        document.getElementById('onboardingContinue')?.disabled === false
    };
  });
  await options.locator('#onboardingContinue').click();
  await options.waitForFunction(() => document.body.dataset.onboardingStep === 'api');
  settingsDatabaseQa.continuedToApi = true;

  const results = {
    extensionId,
    sidePanelOptions,
    beforeActivationRevision,
    afterActivationRevision,
    activated,
    multiTab,
    pageOverlayCount,
    archive: {
      kind: archive.kind,
      documentId: archive.documentId,
      title: archive.title,
      containsSecrets: /apiKey|authorization|data:image|pageHtml/i.test(archiveText),
      bytes: Buffer.byteLength(archiveText, 'utf8')
    },
    restored,
    navigationStatus,
    manualSelectionQa,
    figureIncrementalQa,
    quickNavPreHover,
    figureVisualQa,
    quickNavSwitchQa,
    quickNavExitQa,
    articleChatQa,
    chatMutationQa,
    dynamicParagraphQa,
    workspaceOverviewFixture,
    workspaceOverviewQa,
    activeWorkspaceDeletionQa,
    lateFigureSetup,
    lateFigureDeletionQa,
    lateChatSetup,
    lateChatDeletionQa,
    migrationControls,
    supportEmail,
    modelConfigurationQa,
    settingsDatabaseQa,
    adapterDiagnostic: {
      extension: path.extname(firstDiagnostic.filename),
      filename: firstDiagnostic.filename,
      bytes: firstDiagnostic.bytes,
      kind: firstDiagnostic.bundle.kind,
      schemaVersion: firstDiagnostic.bundle.schemaVersion,
      hasRenderedDom: firstDiagnostic.bundle.dom?.documentHtml
        ?.includes('OA mechanism review test') === true,
      selectorCoverage: firstDiagnostic.bundle.selectorCoverage?.length || 0,
      traceCount: firstDiagnostic.bundle.trace?.length || 0,
      extractionFailureRecorded: failureDiagnostic.bundle.trace?.some(record =>
        record.status === 'failed' &&
        /FORCED_EXTRACTOR_FAILURE_FOR_DIAGNOSTIC/.test(record.error?.message || '')) || false,
      survivesExtractionFailure:
        failureDiagnostic.bundle.kind === firstDiagnostic.bundle.kind,
      failedConnectionUi,
      patchResult
    },
    consoleErrors,
    pageErrors
  };
  const passed =
    beforeActivationRevision === '' &&
    afterActivationRevision === '2.4.0-article-workspaces-r1' &&
    sidePanelOptions.path === 'popup.html' &&
    sidePanelOptions.enabled === false &&
    activated.viewCount === 5 &&
    activated.navCount === 5 &&
    activated.applyActionAboveEngine &&
    activated.analysisIconVisible &&
    activated.removedAnalysisActions &&
    activated.feedbackRemoved &&
    activated.migrationScriptsLoaded &&
    multiTab.untouchedRevision === '' &&
    multiTab.untouchedSidePanelEnabled === false &&
    multiTab.activatedSidePanelEnabled === true &&
    multiTab.restoredSidePanelEnabled === true &&
    multiTab.secondActivatedRevision === '2.4.0-article-workspaces-r1' &&
    multiTab.activeTitleAfterSwitchBack === 'OA mechanism review test' &&
    multiTab.actualExtractionRuns === 1 &&
    multiTab.switchBackMs < 1500 &&
    multiTab.restoreHandleCleared &&
    pageOverlayCount === 0 &&
    results.manualSelectionQa.toolbarVisible &&
    (results.manualSelectionQa.categoryActions > 0 || results.manualSelectionQa.hasMore) &&
    results.manualSelectionQa.firstOpenMs < 120 &&
    results.manualSelectionQa.secondOpenMs < 120 &&
    archive.kind === 'sci-logic-highlighter-article' &&
    !results.archive.containsSecrets &&
    restored?.success === true &&
    results.figureIncrementalQa.cardCount === 3 &&
    results.figureIncrementalQa.firstHasPartialResult &&
    results.figureIncrementalQa.firstPanelCatalogSize === 3 &&
    results.figureIncrementalQa.firstAnalyzedPanels === 2 &&
    !results.figureIncrementalQa.secondHasResult &&
    results.figureIncrementalQa.stablePollingKeepsQuickNavNode &&
    results.figureIncrementalQa.stablePollingKeepsHoverState &&
    results.figureIncrementalQa.elapsedUpdatedWithoutRebuild &&
    results.figureIncrementalQa.changedProgressRebuilds &&
    /Figure 1/.test(results.figureIncrementalQa.summaries[0]) &&
    /当前 Panel 分批已保存/.test(results.figureIncrementalQa.summaries[0]) &&
    /待解读/.test(results.figureIncrementalQa.summaries[1]) &&
    /待解读/.test(results.figureIncrementalQa.summaries[2]) &&
    results.figureIncrementalQa.reportsBatchCount &&
    results.figureIncrementalQa.reportsIgnoredPanels &&
    results.figureVisualQa.figureOpen &&
    results.figureVisualQa.panelOpen &&
    results.figureVisualQa.followupOpen &&
    results.figureVisualQa.draftPreserved &&
    results.figureVisualQa.inputBasisVisible &&
    results.figureVisualQa.quickNavVisible &&
    results.figureVisualQa.figureMarkers === 3 &&
    results.figureVisualQa.figureLabels === 3 &&
    results.figureVisualQa.panelButtons === 6 &&
    results.figureVisualQa.panelPopoverOpen &&
    results.figureVisualQa.panelOrder.join('|') === 'Panel A|Panel B|Panel C' &&
    results.figureVisualQa.panelSingleColumn &&
    results.figureVisualQa.panelPopoverVisual?.opacity === '1' &&
    results.figureVisualQa.collapsedResultSections &&
    results.quickNavSwitchQa.expandedFigureIds.length === 0 &&
    !results.quickNavSwitchQa.firstFigureStillExpanded &&
    results.quickNavExitQa.expandedItems === 0 &&
    results.quickNavExitQa.hoveredItems === 0 &&
    results.quickNavExitQa.focusedItems === 0 &&
    results.articleChatQa.active &&
    results.articleChatQa.profileOptions === 2 &&
    results.articleChatQa.messages === 4 &&
    results.articleChatQa.userLabels === 0 &&
    results.articleChatQa.assistantLabels === 2 &&
    results.articleChatQa.boldNodes >= 6 &&
    results.articleChatQa.superscriptNodes === 1 &&
    !results.articleChatQa.literalSupTagsVisible &&
    results.articleChatQa.listItems >= 7 &&
    results.articleChatQa.orderedLists === 2 &&
    results.articleChatQa.secondQuestionVisible &&
    results.articleChatQa.citationButtons === 39 &&
    new Set(results.articleChatQa.citationParagraphIds).size >= 2 &&
    new Set(results.articleChatQa.citationSourceKeys).size >= 2 &&
    results.articleChatQa.fallbackCitationRows === 0 &&
    results.articleChatQa.limitationsCollapsed &&
    results.articleChatQa.messagesOverflowY === 'auto' &&
    results.articleChatQa.messagesScrollable &&
    results.articleChatQa.scrolledToLatest &&
    results.articleChatQa.returnLatestVisible &&
    results.articleChatQa.returnLatestRestored &&
    results.articleChatQa.composerOutsideMessages &&
    results.articleChatQa.citationJumpFocused &&
    results.chatMutationQa.queuedDeleted &&
    !results.chatMutationQa.queuedRemaining &&
    results.chatMutationQa.answerDeleteState.status === 'unanswered' &&
    results.chatMutationQa.answerDeleteState.answerBlocks === 0 &&
    results.chatMutationQa.regenerateState.status === 'completed' &&
    /重新生成成功/.test(results.chatMutationQa.regenerateState.answer) &&
    !results.chatMutationQa.regenerateState.loading &&
    results.chatMutationQa.finalStoredTurns === 0 &&
    results.chatMutationQa.finalIndexTurns === 0 &&
    results.dynamicParagraphQa.paragraphCount === 7 &&
    /7 段正文/.test(results.dynamicParagraphQa.status) &&
    results.workspaceOverviewFixture.ensured &&
    results.workspaceOverviewFixture.assetSaved &&
    results.workspaceOverviewFixture.turnSaved &&
    results.workspaceOverviewQa.listItemFound &&
    results.workspaceOverviewQa.detailLoaded &&
    results.workspaceOverviewQa.detailCounts?.chatTurns === 1 &&
    results.workspaceOverviewQa.detailCounts?.figures === 2 &&
    results.workspaceOverviewQa.detailCounts?.panels === 3 &&
    results.workspaceOverviewQa.filteredCardCount === 1 &&
    results.workspaceOverviewQa.matchingTitle === 'QA Workspace Search Target' &&
    /问答 1/.test(results.workspaceOverviewQa.metrics) &&
    /Figure 2/.test(results.workspaceOverviewQa.metrics) &&
    /Panel 3/.test(results.workspaceOverviewQa.metrics) &&
    results.workspaceOverviewQa.bulkClearEnabledAfterSelect &&
    results.workspaceOverviewQa.bulkClearDisabledAfterDeselect &&
    results.workspaceOverviewQa.exportedWorkspaceId ===
      results.workspaceOverviewFixture.workspaceId &&
    !results.workspaceOverviewQa.exportContainsSecrets &&
    results.workspaceOverviewQa.restoreWithoutDirectoryExplained &&
    results.workspaceOverviewQa.deletedFromOverview &&
    /已清除 1 篇论文工作区/.test(results.workspaceOverviewQa.clearStatus) &&
    results.activeWorkspaceDeletionQa.workspaceIdStable &&
    results.activeWorkspaceDeletionQa.generationAfter >
      results.activeWorkspaceDeletionQa.generationBefore &&
    results.activeWorkspaceDeletionQa.paragraphCountAfter ===
      results.activeWorkspaceDeletionQa.paragraphCountBefore &&
    results.activeWorkspaceDeletionQa.addedParagraphs.length === 0 &&
    results.activeWorkspaceDeletionQa.removedParagraphs.length === 0 &&
    results.activeWorkspaceDeletionQa.workspaceGeneration ===
      results.activeWorkspaceDeletionQa.generationAfter &&
    results.activeWorkspaceDeletionQa.recreatedInOverview &&
    results.activeWorkspaceDeletionQa.storedChatTurns === 0 &&
    results.activeWorkspaceDeletionQa.sidePanelChatTurns === 0 &&
    results.activeWorkspaceDeletionQa.analyzedFigures === 0 &&
    !/读取失败|WORKSPACE_|Cannot access contents/i.test(
      results.activeWorkspaceDeletionQa.navigationStatus || ''
    ) &&
    results.lateFigureSetup.deferred &&
    results.lateFigureSetup.promiseAttached &&
    results.lateFigureSetup.operationActive &&
    results.lateFigureDeletionQa.responseReleased &&
    results.lateFigureDeletionQa.beforeRelease.promiseDetached &&
    !results.lateFigureDeletionQa.beforeRelease.operationActive &&
    results.lateFigureDeletionQa.beforeRelease.progressSize === 0 &&
    results.lateFigureDeletionQa.beforeRelease.statusPhase === 'idle' &&
    !results.lateFigureDeletionQa.beforeRelease.statusRunning &&
    results.lateFigureDeletionQa.promiseDetached &&
    !results.lateFigureDeletionQa.operationActive &&
    results.lateFigureDeletionQa.progressSize === 0 &&
    results.lateFigureDeletionQa.statusPhase === 'idle' &&
    !results.lateFigureDeletionQa.statusRunning &&
    !results.lateFigureDeletionQa.staleFigurePresent &&
    results.lateChatSetup.loading &&
    results.lateChatDeletionQa.responseReleased &&
    results.lateChatDeletionQa.workspaceGeneration >
      results.activeWorkspaceDeletionQa.generationAfter &&
    results.lateChatDeletionQa.chatTurns === 0 &&
    results.lateChatDeletionQa.storedChatTurns === 0 &&
    results.lateChatDeletionQa.sidePanelChatTurns === 0 &&
    !results.lateChatDeletionQa.staleTextInMemory &&
    !results.lateChatDeletionQa.staleTextStored &&
    !results.lateChatDeletionQa.staleTextInSidePanel &&
    !/读取失败|Cannot access contents/i.test(navigationStatus || '') &&
    migrationControls === 3 &&
    supportEmail?.trim() === 'brevess0729@163.com' &&
    results.modelConfigurationQa.deepseekDefault === 'deepseek-v4-flash' &&
    results.modelConfigurationQa.deepseekSuggestions.includes('deepseek-v4-pro') &&
    results.modelConfigurationQa.deepseekSuggestions.includes('deepseek-v4-flash') &&
    results.modelConfigurationQa.customModelAccepted &&
    results.modelConfigurationQa.compatibleFieldsVisible &&
    results.modelConfigurationQa.presetResult.model === 'qwen-flash' &&
    results.modelConfigurationQa.presetResult.baseUrl ===
      'https://dashscope.aliyuncs.com/compatible-mode/v1' &&
    results.modelConfigurationQa.presetResult.suggestions.includes('qwen-flash') &&
    results.modelConfigurationQa.customCompatibleModelAccepted &&
    results.modelConfigurationQa.rejected &&
    /Base URL 格式不正确/.test(results.modelConfigurationQa.failureStatus) &&
    results.modelConfigurationQa.saveButtonRecovered &&
    results.modelConfigurationQa.testButtonRecovered &&
    results.modelConfigurationQa.preDisabledButtonPreserved &&
    results.modelConfigurationQa.saveGuardReleased &&
    results.settingsDatabaseQa.moduleAvailable &&
    results.settingsDatabaseQa.directoryStoreAvailable &&
    results.settingsDatabaseQa.continueEnabledAfterNoDirectory &&
    results.settingsDatabaseQa.continuedToApi &&
    results.adapterDiagnostic.kind === 'sci-publisher-adapter-diagnostic' &&
    results.adapterDiagnostic.schemaVersion === 2 &&
    results.adapterDiagnostic.hasRenderedDom &&
    results.adapterDiagnostic.selectorCoverage > 0 &&
    results.adapterDiagnostic.traceCount > 0 &&
    results.adapterDiagnostic.extractionFailureRecorded &&
    results.adapterDiagnostic.survivesExtractionFailure &&
    results.adapterDiagnostic.patchResult.patched === true &&
    results.adapterDiagnostic.patchResult.response?.success === false &&
    results.adapterDiagnostic.failedConnectionUi.retryVisible === true &&
    /提取失败|提取超时/.test(results.adapterDiagnostic.failedConnectionUi.status) &&
    pageErrors.length === 0;

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  await context.close();
  activeContext = null;
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(extensionDir, { recursive: true, force: true });
  if (!passed) process.exitCode = 1;
})().catch(async error => {
  console.error(error.stack || error);
  try { await activeContext?.close(); } catch (_) {}
  activeContext = null;
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(extensionDir, { recursive: true, force: true }); } catch (_) {}
  process.exitCode = 1;
});
