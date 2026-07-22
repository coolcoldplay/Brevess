const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = process.env.SCI_EXTENSION_ROOT
  ? path.resolve(process.env.SCI_EXTENSION_ROOT)
  : path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-restart-edge-'));
const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-restart-extension-'));
let activeContext = null;
let fixtureServer = null;

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
  fs.copyFileSync(path.join(root, 'manifest.json'), path.join(extensionDir, 'manifest.json'));
}

function articleHtml(canonicalUrl) {
  return `<!doctype html><html><head>
    <title>Restart persistence article</title>
    <link rel="canonical" href="${canonicalUrl}">
    <meta name="citation_doi" content="10.1000/restart-persistence">
  </head><body><main><article>
    <h1>Restart persistence article</h1>
    <section><h2>Abstract</h2><p>This paper tests durable local workspace restoration.</p></section>
    <section><h2>Results</h2><p>Treatment increased the target phenotype compared with the matched control.</p></section>
    <section><h2>Methods</h2><p>Samples were randomized before the same assay was applied.</p></section>
    <figure><figcaption>Figure 1. (A) Treatment increased the target phenotype.</figcaption></figure>
  </article></main></body></html>`;
}

async function startFixtureServer() {
  fixtureServer = http.createServer((request, response) => {
    if (request.url !== '/article') {
      response.writeHead(404).end();
      return;
    }
    const address = fixtureServer.address();
    const canonicalUrl = `http://127.0.0.1:${address.port}/article`;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(articleHtml(canonicalUrl));
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${fixtureServer.address().port}/article`;
}

function launchContext() {
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
    ]
  });
}

async function extensionWorker(context) {
  return context.serviceWorkers()[0] ||
    context.waitForEvent('serviceworker', { timeout: 15000 });
}

async function articlePage(context, articleUrl) {
  await new Promise(resolve => setTimeout(resolve, 250));
  const restored = context.pages().find(page => page.url() === articleUrl);
  const page = restored || await context.newPage();
  if (!restored) await page.goto(articleUrl, { waitUntil: 'domcontentloaded' });
  else await page.waitForLoadState('domcontentloaded');
  return { page, restored: Boolean(restored) };
}

async function activateArticle(worker, tab) {
  return worker.evaluate(async activeTab => {
    await chrome.sidePanel.setOptions({
      tabId: activeTab.id, path: 'popup.html', enabled: true
    });
    const activation = await SciLLM.markTabActivated(chrome.storage.session, activeTab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation })
      .catch(() => {});
    return activation;
  }, tab);
}

async function findArticleTab(worker, articleUrl) {
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const tab = tabs.find(item => item.url === articleUrl);
  if (!tab?.id) throw new Error(`Unable to resolve article tab: ${JSON.stringify(tabs)}`);
  return tab;
}

async function openPanelPage(context, extensionId, articlePageRef) {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded'
  });
  await articlePageRef.bringToFront();
  await panel.waitForFunction(() =>
    document.getElementById('sidePanelPaperTitle')?.textContent ===
      'Restart persistence article', null, { timeout: 10000 });
  return panel;
}

async function configureOpfsDirectory(context, extensionId) {
  const options = await context.newPage();
  await options.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle('qa-selected-directory', { create: true });
      }
    });
  });
  await options.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: 'domcontentloaded'
  });
  const chooseButton = options.locator('#chooseUserDataDirectory');
  await chooseButton.waitFor({ state: 'visible' });
  await options.waitForFunction(() =>
    document.getElementById('chooseUserDataDirectory')?.disabled === false);
  await chooseButton.click();
  await options.waitForFunction(() =>
    document.getElementById('userDataPermission')?.dataset.permission === 'granted' &&
    document.getElementById('chooseUserDataDirectory')?.disabled === false &&
    document.getElementById('chooseUserDataDirectory')?.getAttribute('aria-busy') === 'false',
  null, { timeout: 10000 });
  const result = await options.evaluate(async () => {
    const handle = await SciLLM.loadDirectoryHandle(indexedDB);
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    return {
      permission,
      kind: handle.kind,
      queryPermission: typeof handle.queryPermission,
      directoryName: document.getElementById('userDataDirectory')?.textContent || '',
      status: document.getElementById('userDataStatus')?.textContent || '',
      pendingReleased: userDataUi.pendingAction === false,
      buttonRecovered: document.getElementById('chooseUserDataDirectory')?.disabled === false
    };
  });
  return { options, result };
}

async function saveWorkspaceThroughPanel(panel) {
  await panel.locator('[data-workspace-target="highlights"]').click();
  const button = panel.locator('#saveCurrentArticleWorkspace');
  await button.waitFor({ state: 'visible' });
  await button.click();
  await panel.waitForFunction(() =>
    document.getElementById('saveCurrentArticleWorkspace')?.disabled === false &&
    document.getElementById('saveCurrentArticleWorkspace')?.hasAttribute('aria-busy') === false &&
    document.getElementById('statusMessage')?.textContent.includes('已保存'),
  null, { timeout: 10000 });
  return panel.evaluate(() => ({
    buttonRecovered: document.getElementById('saveCurrentArticleWorkspace')?.disabled === false,
    busyReleased:
      document.getElementById('saveCurrentArticleWorkspace')?.hasAttribute('aria-busy') === false,
    status: document.getElementById('statusMessage')?.textContent || '',
    statusType: document.getElementById('statusMessage')?.className || ''
  }));
}

async function ensureArticleWorkspace(worker, tabId) {
  const response = await worker.evaluate((targetTabId) =>
    SciLLM.sendTabMessageWithRecovery(chrome, targetTabId, {
      action: 'ensureArticleWorkspace', forceRefresh: true
    }), tabId);
  if (!response?.success || !response.workspace?.workspaceId) {
    throw new Error(`Unable to ensure restart workspace: ${JSON.stringify(response)}`);
  }
  return response.workspace;
}

async function saveRestartFixture(options, workspace) {
  return options.evaluate(async currentWorkspace => {
    const now = Date.now();
    const turn = {
      turnId: 'restart-turn-1',
      question: 'RESTART QUESTION: what persisted across the browser restart?',
      answerBlocks: [{
        blockId: 'restart-block-1',
        markdown: '**RESTART ANSWER** restored from the local directory.',
        evidence: [], createdAt: now
      }],
      summary: 'Restart persistence summary.',
      status: 'completed',
      selectedProfileId: 'restart-profile',
      profileName: 'Restart QA',
      model: 'restart-model',
      route: {
        effectiveProfileId: 'restart-profile',
        effectiveProfileName: 'Restart QA',
        providerId: 'openai-compatible',
        model: 'restart-model',
        capabilityMode: 'text'
      },
      usage: { inputTokens: 120, outputTokens: 40, cacheHitTokens: 0 },
      operationId: '', error: '', createdAt: now, updatedAt: now
    };
    const figureInventory = {
      status: { running: false, paused: false, phase: 'completed', figureProgress: [] },
      figures: [{
        figureId: 'figure-1', figureLabel: 'Figure 1', hasImage: false,
        caption: 'Figure 1. (A) Treatment increased the target phenotype.',
        isSupplemental: false, panelHints: ['A'], activeDepth: 'standard',
        standard: {
          analysisDepth: 'standard', basis: 'caption_context',
          figureQuestion: 'RESTART FIGURE QUESTION',
          coreConclusion: 'RESTART FIGURE CONCLUSION',
          claimBoundary: 'This Figure alone does not establish a molecular mechanism.',
          authorAssembly: 'Panel A supplies the primary comparison.',
          panels: [{
            panel: 'A', role: 'phenotype', phenotypeName: 'Target phenotype',
            methodCategory: 'wet_lab', methods: ['Assay'], methodSource: 'caption',
            purpose: 'Compare treatment and control.', design: 'Matched comparison.',
            comparison: 'Treatment versus control.',
            directObservation: 'Treatment increased the target phenotype.',
            observationSource: 'caption_statement',
            localInference: 'The treatment is associated with the phenotype.',
            contribution: 'Panel A establishes the phenotype comparison.'
          }],
          panelCoverage: { expectedPanels: ['A'], returnedPanels: ['A'], missingPanels: [] },
          argumentChain: [], panelGroups: [], logicBridges: []
        },
        standardError: '', deep: null, deepLoading: false, deepError: '',
        panelFollowups: {}, panelFollowupLoading: {}, panelFollowupErrors: {}, expanded: true
      }],
      totalFigures: 1, failedFigures: 0,
      crossFigureLogic: { result: null, loading: false, error: '' }
    };
    const assets = [
      ['article/structure.json', { title: 'Restart persistence article', nodes: [] }],
      ['article/paragraphs.json', { revision: 1, paragraphs: [] }],
      ['annotations/highlights.json', { annotations: [], highlightDistribution: {} }],
      ['analysis/full-analysis.json', { llm: null, diagnostics: null }],
      ['chat/index.json', {
        turns: [turn], totalTurns: 1, returnedTurns: 1, windowStart: 0,
        loading: false, error: '', operationId: '', activeTurnId: '',
        coverage: null, memoryNeedsRebuild: false
      }],
      ['figures/inventory.json', figureInventory],
      ['ui/state.json', {
        navigator: {
          activeTab: 'outline', depth: 'major', summariesVisible: false,
          expandedSectionIds: []
        },
        sidePanel: {
          activeWorkspaceView: 'chat',
          figureExpansion: [['figure-1', true]],
          figurePanelExpansion: [['figure-1:A', true]]
        }
      }]
    ];
    let savedAssets = 0;
    for (const [relativePath, content] of assets) {
      const saved = await callBackground({
        type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
        workspaceId: currentWorkspace.workspaceId,
        workspaceGeneration: currentWorkspace.workspaceGeneration,
        relativePath,
        content
      });
      if (saved.saved) savedAssets += 1;
    }
    const savedTurn = await callBackground({
      type: 'ARTICLE_WORKSPACE_SAVE_TURN',
      workspaceId: currentWorkspace.workspaceId,
      workspaceGeneration: currentWorkspace.workspaceGeneration,
      turn
    });
    return {
      success: savedAssets === assets.length && savedTurn.saved === true,
      workspaceId: currentWorkspace.workspaceId,
      directoryName: currentWorkspace.directoryName,
      assetCount: savedAssets,
      turnCount: savedTurn.saved ? 1 : 0
    };
  }, workspace);
}

async function seedBulkWorkspaceFixtures(options) {
  return options.evaluate(async () => {
    const fixtures = [
      {
        workspaceId: `workspace:${'b'.repeat(64)}`,
        canonicalUrl: 'https://example.org/bulk-qa-one',
        title: 'BULK QA workspace one',
        directoryName: `BULK QA workspace one--${'b'.repeat(16)}`,
        doi: '10.1000/bulk-qa-one',
        marker: 'BULK WORKSPACE SENTINEL ONE',
        hash: 'b'
      },
      {
        workspaceId: `workspace:${'c'.repeat(64)}`,
        canonicalUrl: 'https://example.org/bulk-qa-two',
        title: 'BULK QA workspace two',
        directoryName: `BULK QA workspace two--${'c'.repeat(16)}`,
        doi: '10.1000/bulk-qa-two',
        marker: 'BULK WORKSPACE SENTINEL TWO',
        hash: 'c'
      }
    ];
    const saved = [];
    for (const fixture of fixtures) {
      const identity = {
        schemaVersion: 1,
        workspaceId: fixture.workspaceId,
        canonicalUrl: fixture.canonicalUrl,
        aliases: [{ type: 'doi', value: fixture.doi }],
        title: fixture.title,
        directoryName: fixture.directoryName,
        revision: fixture.hash.repeat(64),
        contentHash: fixture.hash.repeat(64),
        workspaceGeneration: 1
      };
      const ensured = await callBackground({
        type: 'ARTICLE_WORKSPACE_ENSURE', workspace: identity
      });
      const workspace = ensured.workspace;
      const turn = {
        turnId: `bulk-turn-${fixture.hash}`,
        question: fixture.marker,
        answerBlocks: [{
          blockId: `bulk-block-${fixture.hash}`,
          markdown: `${fixture.marker} ANSWER`, evidence: []
        }],
        status: 'completed', createdAt: Date.now(), updatedAt: Date.now()
      };
      const asset = await callBackground({
        type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
        workspaceId: workspace.workspaceId,
        workspaceGeneration: workspace.workspaceGeneration,
        relativePath: 'chat/index.json',
        content: {
          turns: [turn], totalTurns: 1, returnedTurns: 1,
          windowStart: 0, loading: false, error: ''
        }
      });
      const storedTurn = await callBackground({
        type: 'ARTICLE_WORKSPACE_SAVE_TURN',
        workspaceId: workspace.workspaceId,
        workspaceGeneration: workspace.workspaceGeneration,
        turn
      });
      saved.push({
        workspaceId: workspace.workspaceId,
        directoryName: workspace.directoryName,
        assetSaved: asset.saved === true,
        turnSaved: storedTurn.saved === true
      });
    }
    return saved;
  });
}

async function flushAndInspectDirectory(options) {
  return options.evaluate(async () => {
    let sync = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      sync = await callBackground({ type: 'USER_DATA_SYNC_NOW' });
      if (Number(sync.pendingCount) === 0) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const handle = await SciLLM.loadDirectoryHandle(indexedDB);
    const files = [];
    const inspection = {
      restartQuestion: false,
      restartAnswer: false,
      restartFigureConclusion: false,
      bulkWorkspaceSentinel: false,
      chatTurnCount: null,
      figureCount: null,
      workspaceGeneration: null
    };
    const walk = async (directory, prefix = '') => {
      for await (const [name, entry] of directory.entries()) {
        const relativePath = prefix ? `${prefix}/${name}` : name;
        if (entry.kind === 'directory') await walk(entry, relativePath);
        else {
          files.push(relativePath);
          if (relativePath.endsWith('.json')) {
            const text = await (await entry.getFile()).text();
            inspection.restartQuestion ||= text.includes('RESTART QUESTION');
            inspection.restartAnswer ||= text.includes('RESTART ANSWER');
            inspection.restartFigureConclusion ||=
              text.includes('RESTART FIGURE CONCLUSION');
            inspection.bulkWorkspaceSentinel ||=
              text.includes('BULK WORKSPACE SENTINEL');
            try {
              const parsed = JSON.parse(text);
              const payload = parsed?.data && typeof parsed.data === 'object'
                ? parsed.data : parsed;
              const activeWorkspaceFile =
                relativePath.startsWith('SCI-Highlighter/workspaces/');
              if (activeWorkspaceFile && relativePath.endsWith('/chat/index.json')) {
                inspection.chatTurnCount = Array.isArray(payload.turns)
                  ? payload.turns.length : Number(payload.totalTurns) || 0;
              } else if (activeWorkspaceFile &&
                  relativePath.endsWith('/figures/inventory.json')) {
                inspection.figureCount = Array.isArray(payload.figures)
                  ? payload.figures.length : Number(payload.totalFigures) || 0;
              } else if (activeWorkspaceFile && relativePath.endsWith('/manifest.json')) {
                inspection.workspaceGeneration =
                  Math.max(1, Number(payload.workspaceGeneration) || 1);
              }
            } catch (_) {}
          }
        }
      }
    };
    await walk(handle);
    return { sync, files: files.sort(), inspection };
  });
}

async function clearWorkspaceThroughPanel(panel) {
  await panel.locator('[data-workspace-target="highlights"]').click();
  const button = panel.locator('#clearArticleWorkspace');
  await button.waitFor({ state: 'visible' });
  panel.once('dialog', dialog => dialog.accept());
  await button.click();
  await panel.waitForFunction(() =>
    document.getElementById('clearArticleWorkspace')?.disabled === false &&
    document.getElementById('statusMessage')?.textContent.includes('已清除') &&
    (Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0) === 0 &&
    !document.body.textContent.includes('RESTART QUESTION') &&
    !document.body.textContent.includes('RESTART FIGURE CONCLUSION'),
  null, { timeout: 10000 });
  return panel.evaluate(() => ({
    buttonRecovered: document.getElementById('clearArticleWorkspace')?.disabled === false,
    status: document.getElementById('statusMessage')?.textContent || '',
    statusType: document.getElementById('statusMessage')?.className || '',
    activeView: activeWorkspaceView,
    chatTurns: Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0,
    restartQuestionVisible: document.body.textContent.includes('RESTART QUESTION'),
    restartFigureVisible: document.body.textContent.includes('RESTART FIGURE CONCLUSION'),
    workspaceGeneration:
      Number(currentWorkspaceSnapshot?.localWorkspace?.workspaceGeneration) || 0
  }));
}

async function clearBulkWorkspacesThroughOptions(options, workspaceIds) {
  await options.locator('#refreshArticleWorkspaceOverview').click();
  await options.waitForFunction(ids =>
    articleWorkspaceOverviewUi.loading === false &&
    ids.every(id => articleWorkspaceOverviewUi.items.some(item => item.workspaceId === id)),
  workspaceIds, { timeout: 10000 });
  await options.locator('#articleWorkspaceSearch').fill('BULK QA');
  await options.waitForFunction(ids => {
    const cards = [...document.querySelectorAll('.article-workspace-card')];
    return cards.length === ids.length && ids.every(id =>
      cards.some(card =>
        card.querySelector('.article-workspace-select')?.dataset.workspaceSelect === id)
    );
  }, workspaceIds, { timeout: 10000 });
  await options.locator('#articleWorkspaceSelectAll').check();
  const selectedBeforeClear = await options.evaluate(() => ({
    selectedCount: articleWorkspaceOverviewUi.selected.size,
    selectAllChecked: document.getElementById('articleWorkspaceSelectAll')?.checked === true,
    clearEnabled: document.getElementById('clearSelectedArticleWorkspaces')?.disabled === false
  }));
  options.once('dialog', dialog => dialog.accept());
  await options.locator('#clearSelectedArticleWorkspaces').click();
  await options.waitForFunction(ids =>
    articleWorkspaceOverviewUi.loading === false &&
    ids.every(id => !articleWorkspaceOverviewUi.items.some(item => item.workspaceId === id)) &&
    /已清除 2 篇论文工作区/.test(
      document.getElementById('articleWorkspaceOverviewStatus')?.textContent || ''
    ), workspaceIds, { timeout: 10000 });
  return options.evaluate(before => ({
    ...before,
    selectedAfterClear: articleWorkspaceOverviewUi.selected.size,
    matchingCardsAfterClear:
      document.querySelectorAll('.article-workspace-card').length,
    clearButtonRecovered:
      document.getElementById('clearSelectedArticleWorkspaces')?.disabled === true,
    refreshButtonRecovered:
      document.getElementById('refreshArticleWorkspaceOverview')?.disabled === false,
    status: document.getElementById('articleWorkspaceOverviewStatus')?.textContent || '',
    remainingWorkspaceCount: articleWorkspaceOverviewUi.items.length
  }), selectedBeforeClear);
}

async function clearBrowserWorkspaceStores(options) {
  return options.evaluate(async () => {
    const database = await SciLLM.openUserDataDatabase(indexedDB);
    const names = [
      'workspaces', 'workspaceAssets', 'workspaceTurns', 'workspaceTombstones'
    ].filter(name => database.objectStoreNames.contains(name));
    const transaction = database.transaction(names, 'readwrite');
    names.forEach(name => transaction.objectStore(name).clear());
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const overview = await callBackground({ type: 'ARTICLE_WORKSPACE_LIST' });
    return {
      clearedStores: names,
      workspaceCount: overview.workspaces.length
    };
  });
}

(async () => {
  prepareQaExtension();
  const articleUrl = await startFixtureServer();

  const firstContext = await launchContext();
  activeContext = firstContext;
  const firstWorker = await extensionWorker(firstContext);
  const firstExtensionId = new URL(firstWorker.url()).host;
  const firstArticle = await articlePage(firstContext, articleUrl);
  const firstTab = await findArticleTab(firstWorker, articleUrl);
  await activateArticle(firstWorker, firstTab);
  const firstPanel = await openPanelPage(firstContext, firstExtensionId, firstArticle.page);
  const { options: firstOptions, result: directorySetup } =
    await configureOpfsDirectory(firstContext, firstExtensionId);
  await firstArticle.page.bringToFront();
  await firstArticle.page.waitForFunction(() =>
    document.documentElement.dataset.sciLlmContentRevision ===
      '2.4.0-article-workspaces-r7', null, { timeout: 10000 });
  const workspace = await ensureArticleWorkspace(firstWorker, firstTab.id);
  const saveUi = await saveWorkspaceThroughPanel(firstPanel);
  const saved = await saveRestartFixture(firstOptions, workspace);
  const directory = await flushAndInspectDirectory(firstOptions);
  const browserStoresCleared = await clearBrowserWorkspaceStores(firstOptions);
  await firstPanel.close();
  await firstOptions.close();
  await firstArticle.page.bringToFront();
  await firstContext.close();
  activeContext = null;

  const secondContext = await launchContext();
  activeContext = secondContext;
  const secondWorker = await extensionWorker(secondContext);
  const secondExtensionId = new URL(secondWorker.url()).host;
  const secondArticle = await articlePage(secondContext, articleUrl);
  const secondTab = await findArticleTab(secondWorker, articleUrl);
  const preRestoreOptions = await secondContext.newPage();
  await preRestoreOptions.goto(`chrome-extension://${secondExtensionId}/options.html`, {
    waitUntil: 'domcontentloaded'
  });
  const beforeRestore = await preRestoreOptions.evaluate(async () => {
    const handle = await SciLLM.loadDirectoryHandle(indexedDB);
    const permission = handle
      ? await handle.queryPermission({ mode: 'readwrite' }) : 'unconfigured';
    const overview = await callBackground({ type: 'ARTICLE_WORKSPACE_LIST' });
    return {
      handleRestored: Boolean(handle),
      permission,
      workspaceCount: overview.workspaces.length
    };
  });
  await activateArticle(secondWorker, secondTab);
  const secondPanel = await openPanelPage(secondContext, secondExtensionId, secondArticle.page);
  const beforeScanUi = await secondPanel.evaluate(() => ({
    chatTurns: Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0,
    figures: Number(currentWorkspaceSnapshot?.figures?.totalFigures) || 0,
    analyzedFigures: (currentWorkspaceSnapshot?.figures?.figures || []).filter(figure =>
      Boolean(figure?.standard || figure?.deep || figure?.error)).length,
    activeView: activeWorkspaceView
  }));
  await secondPanel.locator('[data-workspace-target="highlights"]').click();
  await secondPanel.locator('#scanArticleWorkspace').waitFor({ state: 'visible' });
  await secondPanel.locator('#scanArticleWorkspace').click();
  await secondPanel.waitForFunction(() =>
    currentWorkspaceSnapshot?.chat?.turns?.some(turn =>
      turn.question.includes('RESTART QUESTION')) &&
    currentWorkspaceSnapshot?.figures?.figures?.some(figure =>
      figure.standard?.coreConclusion === 'RESTART FIGURE CONCLUSION') &&
    activeWorkspaceView === 'chat', null, { timeout: 10000 });
  const restoredUi = await secondPanel.evaluate(() => ({
    chatTurns: Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0,
    figures: Number(currentWorkspaceSnapshot?.figures?.totalFigures) || 0,
    questionVisible: document.body.textContent.includes('RESTART QUESTION'),
    answerVisible: document.body.textContent.includes('RESTART ANSWER'),
    figureVisible: document.body.textContent.includes('RESTART FIGURE CONCLUSION'),
    activeView: activeWorkspaceView,
    scanButtonRecovered: document.getElementById('scanArticleWorkspace')?.disabled === false,
    figureExpansion: figureExpansionState.get('figure-1') === true,
    panelExpansion: figurePanelExpansionState.get('figure-1:A') === true
  }));
  const restoredContent = await secondWorker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => ({
        turnCount: articleChatState.turns.length,
        question: articleChatState.turns[0]?.question || '',
        answer: articleChatState.turns[0]?.answerBlocks?.[0]?.markdown || '',
        figureCount: restoredFigureWorkspaceSnapshot?.figures?.length || 0,
        figureConclusion:
          restoredFigureWorkspaceSnapshot?.figures?.[0]?.standard?.coreConclusion || '',
        sidePanelView: articleWorkspaceSidePanelUiState?.activeWorkspaceView || '',
        workspaceId: currentArticleWorkspace?.workspaceId || '',
        workspaceGeneration: Number(currentArticleWorkspace?.workspaceGeneration) || 0
      })
    });
    return result;
  }, secondTab.id);
  const restoredOverview = await preRestoreOptions.evaluate(async workspaceId => {
    const overview = await callBackground({ type: 'ARTICLE_WORKSPACE_LIST' });
    const detail = await callBackground({ type: 'ARTICLE_WORKSPACE_DETAIL', workspaceId });
    const exported = await callBackground({ type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId });
    return {
      workspaceCount: overview.workspaces.length,
      chatTurnCount: detail.chatTurnCount,
      figureCount: detail.figureCount,
      panelCount: detail.panelCount,
      assetCount: detail.assetCount,
      turnCount: exported.turns.length
    };
  }, restoredContent.workspaceId);
  const sidePanelOptions = await secondWorker.evaluate(
    tabId => chrome.sidePanel.getOptions({ tabId }), secondTab.id
  );
  const clearedUi = await clearWorkspaceThroughPanel(secondPanel);
  const clearedContent = await secondWorker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => ({
        turnCount: articleChatState.turns.length,
        restartQuestionPresent: articleChatState.turns.some(turn =>
          String(turn.question || '').includes('RESTART QUESTION')),
        restartFigurePresent: Boolean(restoredFigureWorkspaceSnapshot?.figures?.some(figure =>
          figure.standard?.coreConclusion === 'RESTART FIGURE CONCLUSION')),
        workspaceId: currentArticleWorkspace?.workspaceId || '',
        workspaceGeneration: Number(currentArticleWorkspace?.workspaceGeneration) || 0
      })
    });
    return result;
  }, secondTab.id);
  const clearedOverview = await preRestoreOptions.evaluate(async workspaceId => {
    const overview = await callBackground({ type: 'ARTICLE_WORKSPACE_LIST' });
    const detail = await callBackground({ type: 'ARTICLE_WORKSPACE_DETAIL', workspaceId });
    const exported = await callBackground({ type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId });
    return {
      workspaceCount: overview.workspaces.length,
      chatTurnCount: detail.chatTurnCount,
      assetCount: detail.assetCount,
      turnCount: exported.turns.length,
      workspaceGeneration: Number(exported.workspace?.workspaceGeneration) || 0
    };
  }, clearedContent.workspaceId);
  const clearedDirectory = await flushAndInspectDirectory(preRestoreOptions);
  const bulkSeed = await seedBulkWorkspaceFixtures(preRestoreOptions);
  const bulkDirectoryBefore = await flushAndInspectDirectory(preRestoreOptions);
  const bulkUi = await clearBulkWorkspacesThroughOptions(
    preRestoreOptions, bulkSeed.map(item => item.workspaceId)
  );
  const bulkDirectoryAfter = await flushAndInspectDirectory(preRestoreOptions);
  const bulkOverviewAfter = await preRestoreOptions.evaluate(async () => {
    const overview = await callBackground({ type: 'ARTICLE_WORKSPACE_LIST' });
    return {
      workspaceCount: overview.workspaces.length,
      workspaceIds: overview.workspaces.map(item => item.workspaceId)
    };
  });

  const results = {
    firstExtensionId,
    secondExtensionId,
    extensionIdStable: firstExtensionId === secondExtensionId,
    articleUrl,
    browserRestoredArticleTab: secondArticle.restored,
    directorySetup,
    saveUi,
    saved,
    directory,
    browserStoresCleared,
    beforeRestore,
    beforeScanUi,
    restoredUi,
    restoredContent,
    restoredOverview,
    sidePanelEnabled: sidePanelOptions.enabled === true,
    clearedUi,
    clearedContent,
    clearedOverview,
    clearedDirectory,
    bulkSeed,
    bulkDirectoryBefore,
    bulkUi,
    bulkDirectoryAfter,
    bulkOverviewAfter
  };
  const requiredFiles = [
    '/manifest.json', '/chat/index.json', '/chat/turns/restart-turn-1.json',
    '/figures/inventory.json', '/ui/state.json'
  ];
  const passed =
    results.extensionIdStable &&
    results.directorySetup.permission === 'granted' &&
    results.directorySetup.kind === 'directory' &&
    results.directorySetup.directoryName === 'qa-selected-directory' &&
    results.directorySetup.pendingReleased &&
    results.directorySetup.buttonRecovered &&
    results.saveUi.buttonRecovered &&
    results.saveUi.busyReleased &&
    results.saveUi.statusType.includes('success') &&
    results.saved.success &&
    results.saved.assetCount === 7 &&
    results.saved.turnCount === 1 &&
    results.directory.sync.permission === 'granted' &&
    results.directory.sync.pendingCount === 0 &&
    results.directory.inspection.chatTurnCount === 1 &&
    results.directory.inspection.figureCount === 1 &&
    requiredFiles.every(suffix => results.directory.files.some(file => file.endsWith(suffix))) &&
    results.browserStoresCleared.workspaceCount === 0 &&
    results.beforeRestore.handleRestored &&
    results.beforeRestore.permission === 'granted' &&
    results.beforeRestore.workspaceCount === 0 &&
    results.beforeScanUi.chatTurns === 0 &&
    results.beforeScanUi.analyzedFigures === 0 &&
    results.restoredUi.chatTurns === 1 &&
    results.restoredUi.figures === 1 &&
    results.restoredUi.questionVisible &&
    results.restoredUi.answerVisible &&
    results.restoredUi.figureVisible &&
    results.restoredUi.activeView === 'chat' &&
    results.restoredUi.scanButtonRecovered &&
    results.restoredUi.figureExpansion &&
    results.restoredUi.panelExpansion &&
    results.restoredContent.turnCount === 1 &&
    results.restoredContent.question.includes('RESTART QUESTION') &&
    results.restoredContent.answer.includes('RESTART ANSWER') &&
    results.restoredContent.figureConclusion === 'RESTART FIGURE CONCLUSION' &&
    results.restoredContent.sidePanelView === 'chat' &&
    results.restoredOverview.workspaceCount === 1 &&
    results.restoredOverview.chatTurnCount === 1 &&
    results.restoredOverview.figureCount === 1 &&
    results.restoredOverview.panelCount === 1 &&
    results.restoredOverview.assetCount === 7 &&
    results.restoredOverview.turnCount === 1 &&
    results.sidePanelEnabled &&
    results.clearedUi.buttonRecovered &&
    results.clearedUi.statusType.includes('success') &&
    results.clearedUi.activeView === 'analysis' &&
    results.clearedUi.chatTurns === 0 &&
    !results.clearedUi.restartQuestionVisible &&
    !results.clearedUi.restartFigureVisible &&
    results.clearedUi.workspaceGeneration > results.restoredContent.workspaceGeneration &&
    results.clearedContent.turnCount === 0 &&
    !results.clearedContent.restartQuestionPresent &&
    !results.clearedContent.restartFigurePresent &&
    results.clearedContent.workspaceId === results.restoredContent.workspaceId &&
    results.clearedContent.workspaceGeneration > results.restoredContent.workspaceGeneration &&
    results.clearedOverview.workspaceCount === 1 &&
    results.clearedOverview.chatTurnCount === 0 &&
    results.clearedOverview.turnCount === 0 &&
    results.clearedOverview.assetCount === 7 &&
    results.clearedOverview.workspaceGeneration ===
      results.clearedContent.workspaceGeneration &&
    results.clearedDirectory.sync.permission === 'granted' &&
    results.clearedDirectory.sync.pendingCount === 0 &&
    !results.clearedDirectory.files.some(file =>
      file.endsWith('/chat/turns/restart-turn-1.json')) &&
    !results.clearedDirectory.inspection.restartQuestion &&
    !results.clearedDirectory.inspection.restartAnswer &&
    !results.clearedDirectory.inspection.restartFigureConclusion &&
    results.clearedDirectory.inspection.chatTurnCount === 0 &&
    results.clearedDirectory.inspection.workspaceGeneration ===
      results.clearedContent.workspaceGeneration &&
    results.bulkSeed.length === 2 &&
    results.bulkSeed.every(item => item.assetSaved && item.turnSaved) &&
    results.bulkDirectoryBefore.sync.pendingCount === 0 &&
    results.bulkDirectoryBefore.inspection.bulkWorkspaceSentinel &&
    results.bulkSeed.every(item => results.bulkDirectoryBefore.files.some(file =>
      file.startsWith(`SCI-Highlighter/workspaces/${item.directoryName}/`))) &&
    results.bulkUi.selectedCount === 2 &&
    results.bulkUi.selectAllChecked &&
    results.bulkUi.clearEnabled &&
    results.bulkUi.selectedAfterClear === 0 &&
    results.bulkUi.matchingCardsAfterClear === 0 &&
    results.bulkUi.clearButtonRecovered &&
    results.bulkUi.refreshButtonRecovered &&
    /已清除 2 篇论文工作区/.test(results.bulkUi.status) &&
    results.bulkUi.remainingWorkspaceCount === 1 &&
    results.bulkDirectoryAfter.sync.pendingCount === 0 &&
    !results.bulkDirectoryAfter.inspection.bulkWorkspaceSentinel &&
    results.bulkSeed.every(item => !results.bulkDirectoryAfter.files.some(file =>
      file.includes(`/${item.directoryName}/`))) &&
    results.bulkOverviewAfter.workspaceCount === 1 &&
    results.bulkOverviewAfter.workspaceIds[0] === results.clearedContent.workspaceId;

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  await secondContext.close();
  activeContext = null;
  await new Promise(resolve => fixtureServer.close(resolve));
  fixtureServer = null;
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(extensionDir, { recursive: true, force: true });
  if (!passed) process.exitCode = 1;
})().catch(async error => {
  console.error(error.stack || error);
  try { await activeContext?.close(); } catch (_) {}
  try {
    if (fixtureServer) await new Promise(resolve => fixtureServer.close(resolve));
  } catch (_) {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(extensionDir, { recursive: true, force: true }); } catch (_) {}
  process.exitCode = 1;
});
