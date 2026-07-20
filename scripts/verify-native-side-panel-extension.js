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
    contribution: `Panel ${label} advances the Figure argument.`
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
      '**建议先掌握以下背景**\n\n1. **信号转导**：理解激酶如何把外界刺激传入细胞。[[1]]\n2. **转录调控**：理解转录因子如何改变靶基因表达。[[1]]\n3. **必要性证据**：抑制关键节点后效应消失，比单纯相关性更有说服力。[[2]]\n4. **证据边界**：前临床结果不能直接等同于人群中的临床效果。[[2]]\n\n正文先用激活实验建立通路响应，再用遗传抑制检验关键节点是否不可替代。[[1]]\n\n这种“先观察、再干预”的组合，比只报告两个指标同时变化更接近机制论证。[[2]]\n\n阅读时还应区分细胞存活这一表型与临床获益，两者不能直接互换。[[2]]\n\n因此背景知识的重点不是记住术语，而是理解每类实验在因果链中的位置。[[1]]';
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
    figureVisualQa,
    quickNavSwitchQa,
    quickNavExitQa,
    articleChatQa,
    dynamicParagraphQa,
    migrationControls,
    supportEmail,
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
    afterActivationRevision === '2.3.0-panel-chat-r3' &&
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
    multiTab.secondActivatedRevision === '2.3.0-panel-chat-r3' &&
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
    results.figureVisualQa.figureOpen &&
    results.figureVisualQa.panelOpen &&
    results.figureVisualQa.followupOpen &&
    results.figureVisualQa.draftPreserved &&
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
    results.dynamicParagraphQa.paragraphCount === 7 &&
    /7 段正文/.test(results.dynamicParagraphQa.status) &&
    !/读取失败|Cannot access contents/i.test(navigationStatus || '') &&
    migrationControls === 3 &&
    supportEmail?.trim() === 'brevess0729@163.com' &&
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
