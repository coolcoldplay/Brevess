import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const extensionPath = path.resolve(process.env.EXTENSION_PATH ||
  path.join(root, 'dist', 'Brevess-v1.0.1-ai-optional-reading-20260814'));
const outputDir = path.resolve(process.env.OUTPUT_DIR ||
  path.join(root, 'output', 'playwright', 'ai-optional-reading-qa'));
if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
  throw new Error(`Missing unpacked extension: ${extensionPath}`);
}
fs.mkdirSync(outputDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-update-qa-'));

function diagnostics(page) {
  const value = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', error => value.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') value.consoleErrors.push(message.text());
  });
  return value;
}

async function shot(page, name, fullPage = true) {
  const target = path.join(outputDir, name);
  await page.screenshot({ path: target, fullPage });
  return target;
}

async function shotElement(page, selector, name) {
  const target = path.join(outputDir, name);
  await page.locator(selector).screenshot({ path: target });
  return target;
}

let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1050 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const report = { extensionId, extensionPath, pages: {} };

  const panel = await context.newPage();
  const panelDiagnostics = diagnostics(panel);
  await panel.setViewportSize({ width: 710, height: 1180 });
  await panel.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded'
  });
  await panel.locator('#openLiteratureNote').waitFor({ state: 'visible' });
  await panel.waitForFunction(() => typeof openLiteratureNoteDrawer === 'function');
  await panel.evaluate(() => openLiteratureNoteDrawer());
  await panel.locator('#literatureNoteDrawer').waitFor({ state: 'visible' });
  await panel.evaluate(() => {
    const template = literatureNoteTemplates()[0];
    const values = Object.fromEntries(template.fields.map((field, index) => [
      field.id, `QA 自动填写字段 ${index + 1}`
    ]));
    literatureNoteDocumentState = SciLLM.reconcileLiteratureNoteDocumentStates(
      { templateId: template.id, valuesByTemplate: {}, updatedAt: 1 },
      {
        templateId: template.id,
        valuesByTemplate: { [template.id]: values },
        updatedAt: 2
      }
    );
    renderLiteratureNoteDrawer();
  });
  const noteShot = await shot(panel, '01-side-panel-literature-notes.png', false);
  const noteMetrics = await panel.evaluate(() => ({
    templateCount: document.querySelectorAll('#literatureNoteTemplateSelect option').length,
    fieldCount: document.querySelectorAll('.literature-note-field').length,
    languageButtonCount: document.querySelectorAll('#sidePanelLanguage').length,
    noteIconVisible: getComputedStyle(
      document.querySelector('#openLiteratureNote i'), '::before'
    ).content !== 'none',
    drawerVisible: !document.querySelector('#literatureNoteDrawer')?.hidden,
    autofillVisible: document.querySelector('#autofillLiteratureNote')
      ?.checkVisibility() === true,
    autofillLabel: document.querySelector('#autofillLiteratureNote')
      ?.textContent?.trim() || '',
    populatedFieldCount: Array.from(document.querySelectorAll(
      '[data-literature-note-field]'
    )).filter(field => field.value.trim()).length
  }));
  await panel.evaluate(() => {
    showStatus('QA 笔记填写完成通知', 'success');
    document.getElementById('sidePanelNotificationCenter').open = true;
  });
  const noteNotificationShot = await shot(
    panel, '01b-literature-note-notification-layer.png', false
  );
  const noteNotificationMetrics = await panel.evaluate(() => {
    const header = document.querySelector('.side-panel-header');
    const drawer = document.querySelector('#literatureNoteDrawer');
    const popover = document.querySelector('.side-panel-notification-popover');
    const popoverZ = Number.parseInt(getComputedStyle(popover).zIndex, 10) || 0;
    const headerZ = Number.parseInt(getComputedStyle(header).zIndex, 10) || 0;
    const drawerZ = Number.parseInt(getComputedStyle(drawer).zIndex, 10) || 0;
    return {
      visible: popover?.checkVisibility() === true,
      popoverZ,
      headerZ,
      drawerZ,
      notificationVisibleAboveDrawer: Boolean(
        popover?.checkVisibility() && headerZ > drawerZ
      )
    };
  });
  await panel.evaluate(() => {
    document.getElementById('sidePanelNotificationCenter').open = false;
    closeLiteratureNoteDrawer();
    switchWorkspaceView('figures');
  });
  await panel.waitForTimeout(100);
  const triangleShot = await shot(panel, '02-side-panel-figure-triangle.png', false);
  const triangleMetrics = await panel.evaluate(() => {
    const control = document.querySelector('#figurePanelHeaderFieldsControl');
    const button = document.querySelector('#figurePanelHeaderFieldsButton');
    const refresh = document.querySelector('#refreshFigureInventory');
    refresh?.setAttribute('aria-busy', 'true');
    return {
      controlVisible: Boolean(control && !control.hidden),
      buttonText: button?.textContent?.trim() || '',
      buttonAriaLabel: button?.getAttribute('aria-label') || '',
      refreshAnimation: refresh?.querySelector('i')
        ? getComputedStyle(refresh.querySelector('i')).animationName : ''
    };
  });
  await panel.locator('#supplementalFigureImportDialog').evaluate(dialog => {
    dialog.showModal();
    const radio = dialog.querySelector('input[value="pdf"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const supplementShot = await shot(panel, '03-supplemental-pdf-background-import.png', false);
  const supplementMetrics = await panel.evaluate(() => ({
    pdfPickerVisible: Boolean(document.querySelector('#supplementalFigurePdfFile')
      ?.checkVisibility()),
    currentArticleStillTarget: document.querySelector(
      '[data-supplemental-source-pane="pdf"]'
    )?.textContent.includes('不会切换') === true
  }));
  await panel.evaluate(() => {
    document.querySelector('#supplementalFigureImportDialog')?.close();
    switchWorkspaceView('highlights');
    visibleHighlightSources.add('llm');
    globalThis.__sciQaOriginalFocusWorkspaceSource = focusWorkspaceSource;
    globalThis.__sciQaFocusedHighlightIds = [];
    focusWorkspaceSource = async target => {
      globalThis.__sciQaFocusedHighlightIds.push(target?.highlightId || '');
      return true;
    };
    renderHighlightDistributionSnapshot({
      highlightDistribution: {
        totalHighlights: 2,
        sourceCounts: { llm: 2 },
        categories: [{ categoryId: 'result', name: '结果解释', color: '#7357c8' }],
        rows: [{
          sectionId: 'section-results',
          title: 'Results',
          cells: {
            result: {
              count: 2,
              sources: {
                llm: {
                  count: 2,
                  items: [
                    { highlightId: 'highlight-qa-1', quote: '第一处结果证据' },
                    { highlightId: 'highlight-qa-2', quote: '第二处独立结果证据' }
                  ]
                }
              }
            }
          }
        }]
      }
    });
  });
  const highlightGroup = panel.locator('.workspace-distribution-group').first();
  await highlightGroup.locator('summary').click();
  await highlightGroup.evaluate(group => {
    // The standalone visual harness has no article tab to activate. Keep the
    // component open after that expected activation warning so the screenshot
    // still exercises the real multi-occurrence disclosure layout.
    group.open = true;
  });
  const highlightGroupShot = await shot(
    panel, '03b-highlight-multi-occurrence.png', false
  );
  const clickedOccurrenceId = await highlightGroup
    .locator('.workspace-distribution-occurrence').nth(1)
    .evaluate(button => {
      button.click();
      return button.dataset.highlightId || '';
    });
  const highlightGroupMetrics = await panel.evaluate(() => ({
    expanded: document.querySelector('.workspace-distribution-group')?.open === true,
    occurrenceCount: document.querySelectorAll(
      '.workspace-distribution-occurrence'
    ).length,
    focusedHighlightId: globalThis.__sciQaFocusedHighlightIds?.at(-1) || ''
  }));
  highlightGroupMetrics.clickedOccurrenceId = clickedOccurrenceId;
  report.pages.sidePanel = {
    screenshots: [
      noteShot, noteNotificationShot, triangleShot, supplementShot, highlightGroupShot
    ],
    noteMetrics, noteNotificationMetrics, triangleMetrics, supplementMetrics,
    highlightGroupMetrics,
    diagnostics: panelDiagnostics
  };

  const options = await context.newPage();
  const optionsDiagnostics = diagnostics(options);
  await options.setViewportSize({ width: 1440, height: 1100 });
  await options.goto(
    `chrome-extension://${extensionId}/options.html?returnPdfTab=987654#page=models`, {
    waitUntil: 'domcontentloaded'
  });
  await options.locator('#providerSettings').waitFor({ state: 'visible' });
  await options.evaluate(() => {
    const provider = document.querySelector('#providerId');
    const model = document.querySelector('#model');
    provider.value = 'deepseek';
    provider.dispatchEvent(new Event('change', { bubbles: true }));
    model.value = 'deepseek-reasoner';
    model.dispatchEvent(new Event('input', { bubbles: true }));
    renderReasoningEffort({ model: 'deepseek-reasoner' });
  });
  await options.waitForTimeout(100);
  const optionsShot = await shot(options, '04-settings-model-notes-actions.png', true);
  const optionsMetrics = await options.evaluate(() => ({
    reasoningVisible: !document.querySelector('#reasoningEffortField')?.hidden,
    reasoningLevels: [...document.querySelectorAll('#reasoningEffort option')]
      .map(option => option.value),
    manualTokenControls: ['tokenModeManual', 'autoTokenCap', 'manualMaxTokens']
      .filter(id => document.getElementById(id)).length,
    noteTemplateCards: document.querySelectorAll(
      '#literatureNoteTemplateList .named-prompt-row'
    ).length,
    selectionActionCards: document.querySelectorAll(
      '#selectionLlmActionList .named-prompt-row'
    ).length,
    offlineSnapshotEnabled: document.querySelector('#saveArticleWebSnapshot')?.checked === true
  }));
  const headerVisuals = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 900 },
    { width: 600, height: 900 }
  ]) {
    await options.setViewportSize(viewport);
    await options.waitForTimeout(100);
    const metrics = await options.evaluate(() => {
      const topbar = document.querySelector('.topbar');
      const inner = document.querySelector('.topbar-inner');
      const returnControl = document.querySelector('#returnToPdfReader');
      const topbarRect = topbar?.getBoundingClientRect();
      const innerRect = inner?.getBoundingClientRect();
      const returnRect = returnControl?.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        headerOverflowX: document.documentElement.scrollWidth > innerWidth + 1 ||
          (topbar?.scrollWidth || 0) > (topbar?.clientWidth || 0) + 1,
        headerHeight: Math.round(topbarRect?.height || 0),
        returnControlVisible: returnControl?.checkVisibility() === true,
        returnControlWidthRatio: innerRect?.width
          ? Number(((returnRect?.width || 0) / innerRect.width).toFixed(3)) : 1,
        returnControlText: returnControl?.textContent?.trim() || '',
        brandVisible: document.querySelector('.brand')?.checkVisibility() === true,
        settingsTitleVisible: document.querySelector('.settings-center-title')
          ?.checkVisibility() === true,
        languageVisible: document.querySelector('.language-switcher')?.checkVisibility() === true
      };
    });
    const screenshot = await shotElement(
      options,
      '.topbar',
      `04-settings-header-${viewport.width}.png`
    );
    headerVisuals.push({ ...metrics, screenshot });
  }
  report.pages.options = {
    screenshots: [optionsShot, ...headerVisuals.map(item => item.screenshot)],
    metrics: optionsMetrics,
    headerVisuals,
    diagnostics: optionsDiagnostics
  };

  const pdfFixturePage = await context.newPage();
  await pdfFixturePage.setContent(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 22mm; }
      body { font: 16px/1.65 Georgia, serif; color: #172033; }
      h1 { font: 700 30px/1.2 system-ui; margin: 0 0 24px; }
      h2 { font: 700 21px/1.25 system-ui; margin: 26px 0 10px; }
      .page-break { break-before: page; }
    </style></head><body>
      <h1>Native PDF reading fixture</h1>
      <h2>Introduction</h2>
      <p>Selectable native PDF text remains available before MinerU parsing.</p>
      <p>Readers can highlight, annotate, define abbreviations, and send selected text to chat.</p>
      <h2 class="page-break">Results</h2>
      <p>The second page verifies native page rendering, text layers, and outline navigation.</p>
      <h2>Discussion</h2>
      <p>MinerU remains an explicit background action and never replaces the original PDF view.</p>
    </body></html>`);
  const pdfFixtureBytes = await pdfFixturePage.pdf({
    format: 'A4',
    tagged: true,
    outline: true,
    printBackground: true
  });
  await pdfFixturePage.close();
  const pdfFixtureUrl = 'https://brevess-native-pdf-qa.invalid/native-reading-fixture.pdf';
  await context.route(pdfFixtureUrl, route => route.fulfill({
    status: 200,
    contentType: 'application/pdf',
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    body: pdfFixtureBytes
  }));

  const pdf = await context.newPage();
  const pdfDiagnostics = diagnostics(pdf);
  await pdf.addInitScript(() => {
    document.addEventListener('brevess:native-pdf-error', event => {
      globalThis.__brevessVisualPdfError = event?.detail?.message || 'PDF_NATIVE_READER_FAILED';
    });
  });
  await pdf.setViewportSize({ width: 1440, height: 1000 });
  await pdf.goto(
    `chrome-extension://${extensionId}/pdf-reader.html?source=` +
      encodeURIComponent(pdfFixtureUrl) +
      '&title=Native%20PDF%20Reading%20Fixture',
    { waitUntil: 'domcontentloaded' }
  );
  await pdf.locator('#pdfReaderStartParse').waitFor({ state: 'visible' });
  try {
    await pdf.waitForFunction(() =>
      document.querySelector('#pdfNativeViewer')?.dataset.state === 'ready' &&
      document.querySelectorAll('.pdf-native-page').length >= 2 &&
      document.querySelectorAll('.pdf-native-text-layer').length >= 2,
    null, { timeout: 20000 });
  } catch (error) {
    const state = await pdf.evaluate(() => ({
      nativeState: document.querySelector('#pdfNativeViewer')?.dataset.state || '',
      pages: document.querySelectorAll('.pdf-native-page').length,
      textLayers: document.querySelectorAll('.pdf-native-text-layer').length,
      readyMarker: document.documentElement.dataset.brevessNativePdfReady || '',
      nativeError: globalThis.__brevessVisualPdfError || '',
      errorCode: document.documentElement.dataset.pdfErrorCode || '',
      status: document.querySelector('#pdfReaderStatus')?.textContent?.trim() || ''
    }));
    const sourceProbe = await pdf.evaluate(async source => {
      const response = await fetch(source, {
        method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'follow'
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        ok: response.ok,
        status: response.status,
        byteLength: bytes.byteLength,
        header: String.fromCharCode(...bytes.subarray(0, 5))
      };
    }, pdfFixtureUrl);
    throw new Error(
      `Native PDF visual fixture did not become ready: ${JSON.stringify(state)} ` +
      `fixtureHeader=${JSON.stringify(pdfFixtureBytes.subarray(0, 5).toString())} ` +
      `sourceProbe=${JSON.stringify(sourceProbe)} ` +
      `diagnostics=${JSON.stringify(pdfDiagnostics)}`,
    {
      cause: error
    });
  }
  const pdfShot = await shot(pdf, '05-pdf-explicit-parse-initial-state.png', false);
  const pdfMetrics = await pdf.evaluate(() => ({
    startVisible: document.querySelector('#pdfReaderStartParse')?.checkVisibility() === true,
    originalView: document.body.dataset.pdfView === 'original',
    status: document.querySelector('#pdfReaderStatus')?.textContent?.trim() || '',
    parseWasStarted: document.querySelector('#pdfReaderControl')?.dataset.state !== 'idle',
    nativeReady: document.querySelector('#pdfNativeViewer')?.dataset.state === 'ready',
    nativePageCount: document.querySelectorAll('.pdf-native-page').length,
    nativeTextLayerCount: document.querySelectorAll('.pdf-native-text-layer').length,
    nativeOutlineCount: globalThis.__brevessNativePdfDocument?.structure
      ?.diagnostics?.headingCount || 0,
    nativeTextVisible: Array.from(document.querySelectorAll('.pdf-native-text-layer'))
      .some(layer => layer.checkVisibility() && layer.textContent?.includes('Selectable native PDF text')),
    idlePlaceholderVisible: document.querySelector('#pdfReaderControl')?.checkVisibility() === true
  }));
  report.pages.pdf = {
    screenshots: [pdfShot], metrics: pdfMetrics, diagnostics: pdfDiagnostics
  };

  const offlineWorkspaceId = `workspace:${'a'.repeat(64)}`;
  const offlineSeed = await panel.evaluate(async workspace => {
    const ensured = await chrome.runtime.sendMessage({
      type: 'ARTICLE_WORKSPACE_ENSURE',
      workspace
    });
    if (!ensured?.success) return ensured;
    return chrome.runtime.sendMessage({
      type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
      workspaceId: workspace.workspaceId,
      workspaceGeneration: workspace.workspaceGeneration,
      relativePath: 'article/offline-snapshot.html',
      content: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>已保存的文献</title><style>body{max-width:780px;margin:52px auto;padding:0 28px;font:17px/1.75 system-ui;color:#172033}h1{font-size:34px}h2{margin-top:36px}</style></head><body><main><h1>离线保存的完整论文</h1><p>即使断网或离开校园网，也可以从本地历史继续阅读正文与图注。</p><h2>Results</h2><p>Representative full-text content restored from the browser-local workspace.</p></main></body></html>'
    });
  }, {
    schemaVersion: 1,
    workspaceId: offlineWorkspaceId,
    canonicalUrl: 'https://example.org/offline-qa-paper',
    aliases: [],
    title: 'Offline QA paper',
    directoryName: `Offline QA paper--${'a'.repeat(16)}`,
    revision: 'a'.repeat(64),
    contentHash: 'a'.repeat(64),
    workspaceGeneration: 1
  });
  if (!offlineSeed?.success) {
    throw new Error(`Unable to seed offline visual fixture: ${JSON.stringify(offlineSeed)}`);
  }

  await options.bringToFront();
  await options.setViewportSize({ width: 1440, height: 1100 });
  await options.locator('.settings-sidebar [data-settings-nav="data"]').click();
  await options.locator('#localData').waitFor({ state: 'visible' });
  await options.evaluate(async () => refreshArticleWorkspaceOverview());
  const offlineAction = options.locator(
    `button[data-workspace-action="offline"][data-workspace-id="${offlineWorkspaceId}"]`
  );
  await offlineAction.waitFor({ state: 'visible' });
  const offlineActionShot = await shotElement(
    options,
    '#articleWorkspaceList',
    '06-settings-local-data-offline-action.png'
  );
  const offlinePagePromise = context.waitForEvent('page', { timeout: 15000 });
  await offlineAction.click();
  const offline = await offlinePagePromise;
  const offlineDiagnostics = diagnostics(offline);
  await offline.setViewportSize({ width: 1280, height: 900 });
  await offline.waitForURL(url =>
    url.pathname.endsWith('/offline-reader.html') &&
    url.searchParams.get('workspaceId') === offlineWorkspaceId,
  { timeout: 15000 });
  const offlineLaunchMetrics = await options.evaluate(workspaceId => ({
    buttonWasRendered: Boolean(document.querySelector(
      `button[data-workspace-action="offline"][data-workspace-id="${CSS.escape(workspaceId)}"]`
    )),
    successStatus: document.querySelector('#articleWorkspaceOverviewStatus')
      ?.textContent?.includes('离线阅读') === true
  }), offlineWorkspaceId);
  await offline.locator('#offlineArticleFrame').waitFor({ state: 'visible' });
  await offline.waitForFunction(() =>
    document.querySelector('#offlineArticleStatus')?.textContent?.includes('已从本机恢复'));
  await offline.frameLocator('#offlineArticleFrame').locator('h1').waitFor({ state: 'visible' });
  const offlineShot = await shot(offline, '06-offline-article-reader.png', false);
  const offlineMetrics = await offline.evaluate(() => ({
    sandbox: document.querySelector('#offlineArticleFrame')?.getAttribute('sandbox') || '',
    loaded: document.querySelector('#offlineArticleStatus')?.textContent
      ?.includes('已从本机恢复') === true
  }));
  report.pages.offline = {
    screenshots: [offlineActionShot, offlineShot],
    metrics: { ...offlineMetrics, ...offlineLaunchMetrics },
    diagnostics: offlineDiagnostics
  };

  const required = [
    noteMetrics.templateCount >= 7,
    noteMetrics.fieldCount >= 1,
    noteMetrics.languageButtonCount === 0,
    noteMetrics.noteIconVisible,
    noteMetrics.autofillVisible,
    noteMetrics.autofillLabel.includes('AI 读取全文'),
    noteMetrics.populatedFieldCount === noteMetrics.fieldCount,
    noteNotificationMetrics.visible,
    noteNotificationMetrics.notificationVisibleAboveDrawer,
    triangleMetrics.controlVisible,
    triangleMetrics.buttonText === '',
    triangleMetrics.buttonAriaLabel.includes('Panel'),
    triangleMetrics.refreshAnimation !== 'none',
    supplementMetrics.pdfPickerVisible,
    supplementMetrics.currentArticleStillTarget,
    highlightGroupMetrics.expanded,
    highlightGroupMetrics.occurrenceCount === 2,
    highlightGroupMetrics.clickedOccurrenceId === 'highlight-qa-2',
    optionsMetrics.reasoningVisible,
    optionsMetrics.manualTokenControls === 0,
    optionsMetrics.noteTemplateCards >= 7,
    optionsMetrics.selectionActionCards >= 2,
    optionsMetrics.offlineSnapshotEnabled,
    headerVisuals.length === 3,
    headerVisuals.every(item => !item.headerOverflowX && item.headerHeight > 0 &&
      item.headerHeight < 190 && item.returnControlVisible &&
      item.returnControlWidthRatio > 0 && item.returnControlWidthRatio < 0.45 &&
      item.brandVisible && (item.viewportWidth <= 600 || item.settingsTitleVisible) &&
      item.languageVisible),
    pdfMetrics.startVisible,
    pdfMetrics.originalView,
    !pdfMetrics.parseWasStarted,
    pdfMetrics.nativeReady,
    pdfMetrics.nativePageCount >= 2,
    pdfMetrics.nativeTextLayerCount >= 2,
    pdfMetrics.nativeOutlineCount >= 3,
    pdfMetrics.nativeTextVisible,
    !pdfMetrics.idlePlaceholderVisible,
    offlineMetrics.loaded,
    offlineLaunchMetrics.buttonWasRendered,
    offlineLaunchMetrics.successStatus,
    !offlineMetrics.sandbox.includes('allow-scripts'),
    Object.values(report.pages).every(pageReport =>
      pageReport.diagnostics.pageErrors.length === 0 &&
      pageReport.diagnostics.consoleErrors.length === 0)
  ];
  report.passed = required.every(Boolean);
  fs.writeFileSync(
    path.join(outputDir, 'visual-qa-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  if (!report.passed) throw new Error('Visual QA assertions failed');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await context?.close();
}
