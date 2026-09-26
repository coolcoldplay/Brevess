import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const output = path.join(root, 'docs', 'edge-store', 'assets');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-store-profile-'));
const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-store-extension-'));
const reviewerHtml = fs.readFileSync(path.join(root, 'docs', 'reviewer-demo.html'), 'utf8');
fs.mkdirSync(output, { recursive: true });

function removeGeneratedTempDirectory(directory, expectedPrefix) {
  const resolved = path.resolve(directory);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolved.startsWith(tempRoot) || path.basename(resolved).indexOf(expectedPrefix) !== 0) {
    throw new Error(`Refusing to remove unexpected temporary directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
  fs.cpSync(path.join(root, directory), path.join(extensionDir, directory), {
    recursive: true
  });
}
for (const filename of [
  'manifest.json', 'background.js', 'content.js', 'content.css',
  'popup.html', 'popup.js', 'popup.css',
  'logic-map.html', 'logic-map.js', 'logic-map.css',
  'options.html', 'options.js', 'options.css',
  'offscreen.html', 'offscreen.js', 'offscreen-network-worker.js'
]) {
  fs.copyFileSync(path.join(root, filename), path.join(extensionDir, filename));
}

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'msedge',
  headless: true,
  viewport: { width: 860, height: 800 },
  args: [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`
  ]
});
const compositorBrowser = await chromium.launch({ channel: 'msedge', headless: true });
const compositor = await compositorBrowser.newPage({
  viewport: { width: 1280, height: 800 }
});

async function extensionWorker() {
  return context.serviceWorkers()[0] ||
    context.waitForEvent('serviceworker', { timeout: 15000 });
}

async function compose(filename, articlePage, sidePanel) {
  const [article, panel] = await Promise.all([
    articlePage.screenshot({ type: 'png' }),
    sidePanel.screenshot({ type: 'png' })
  ]);
  const articleUrl = `data:image/png;base64,${article.toString('base64')}`;
  const panelUrl = `data:image/png;base64,${panel.toString('base64')}`;
  await compositor.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}html,body{margin:0;width:1280px;height:800px;overflow:hidden;background:#fff}
    .shot{display:grid;grid-template-columns:860px 420px;width:1280px;height:800px}
    img{display:block;width:100%;height:800px;object-fit:cover;object-position:top left}
    .panel{border-left:1px solid #c8d6df}
  </style></head><body><div class="shot">
    <img src="${articleUrl}" alt=""><img class="panel" src="${panelUrl}" alt="">
  </div></body></html>`);
  await compositor.screenshot({ path: path.join(output, filename) });
}

const fixture = context.pages()[0] || await context.newPage();
await fixture.setViewportSize({ width: 860, height: 800 });
await fixture.route(
  'https://coolcoldplay.github.io/Brevess/reviewer-demo.html',
  route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: reviewerHtml
  })
);
await fixture.goto(
  'https://coolcoldplay.github.io/Brevess/reviewer-demo.html',
  { waitUntil: 'domcontentloaded' }
);
const worker = await extensionWorker();
const extensionId = new URL(worker.url()).host;
const tabs = await worker.evaluate(() => chrome.tabs.query({}));
const fixtureTab = tabs.find(tab =>
  tab.url?.includes('/Brevess/reviewer-demo.html')
);
if (!fixtureTab?.id) throw new Error('Unable to resolve the reviewer demo tab.');
await worker.evaluate(async tab => {
  const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
  await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
}, fixtureTab);

const sidePanel = await context.newPage();
await sidePanel.setViewportSize({ width: 420, height: 800 });
await sidePanel.goto(`chrome-extension://${extensionId}/popup.html`, {
  waitUntil: 'domcontentloaded'
});
await worker.evaluate(async tab => {
  await chrome.tabs.update(tab.id, { active: true });
  const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
  await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
}, fixtureTab);
await sidePanel.evaluate(async () => {
  await synchronizeActiveTabContext({ force: true });
});
await sidePanel.waitForFunction(() =>
  /Brevess Reviewer Demo/.test(
    document.getElementById('sidePanelPaperTitle')?.textContent || ''
  )
);
await sidePanel.evaluate(async () => {
  await refreshManualAnnotationSummary();
  await refreshArticleWorkspace();
  sidePanelNotificationHistory = [{
    message: '当前页面结构已完成解析',
    type: 'success',
    timestamp: Date.now()
  }];
  renderSidePanelNotificationHistory();
  document.getElementById('sidePanelNotificationCenter')?.classList.remove('has-unread');
  switchWorkspaceView('navigation');
  document.querySelector('[data-workspace-view="navigation"]')?.scrollTo(0, 0);
});
await sidePanel.waitForFunction(() =>
  document.querySelectorAll('details.workspace-tree-node').length >= 8
);
await fixture.evaluate(() => scrollTo(0, 0));
await compose('screenshot-1-navigation-1280x800.png', fixture, sidePanel);

await sidePanel.locator('#showArticleAbbreviations').click();
await sidePanel.waitForFunction(() =>
  document.getElementById('articleAbbreviationDialog')?.open === true &&
  document.querySelectorAll('#articleAbbreviationTableBody tr').length >= 2
);
await compose('screenshot-2-abbreviations-1280x800.png', fixture, sidePanel);
await sidePanel.locator('#articleAbbreviationDialog .abbreviation-dialog-close').click();

await sidePanel.evaluate(async () => {
  switchWorkspaceView('analysis');
  if (analysisMode !== 'regex') await queueAnalysisModeMutation('regex');
  selectedCategories = new Set(
    getCategoryEntriesForEngine('regex')
      .map(([categoryId]) => categoryId)
  );
  renderCategories();
  updateApplyButton();
});
await sidePanel.waitForFunction(() =>
  document.getElementById('applyHighlight')?.disabled === false
);
await sidePanel.locator('#applyHighlight').click();
await fixture.waitForFunction(() =>
  document.querySelectorAll('.sci-highlight').length >= 3
);
await fixture.evaluate(() => {
  const results = document.getElementById('results');
  if (results) {
    scrollTo({ top: results.offsetTop - 18, behavior: 'instant' });
  }
});
await sidePanel.evaluate(() => {
    const view = document.querySelector('[data-workspace-view="highlights"]');
    const controls = document.getElementById('highlightControls');
    if (!view || !controls?.open) throw new Error('The merged highlighter must be visible for capture');
    view.scrollTop = 0;
});
await compose('screenshot-3-rule-highlights-1280x800.png', fixture, sidePanel);

const cleanFigureSnapshot = {
  status: { running: false, paused: false, phase: 'completed', figureProgress: [] },
  totalFigures: 1,
  failedFigures: 0,
  crossFigureLogic: { result: null, loading: false, error: '' },
  figures: [{
    figureId: 'figure-1',
    figureLabel: 'Figure 1',
    hasImage: true,
    caption: 'Synthetic pathway used for extension review.',
    isSupplemental: false,
    panelHints: ['A', 'B', 'C'],
    activeDepth: 'standard',
    standardError: '',
    deep: null,
    deepLoading: false,
    deepError: '',
    panelFollowups: {},
    panelFollowupLoading: {},
    panelFollowupErrors: {},
    expanded: true,
    standard: {
      analysisDepth: 'standard',
      basis: 'caption_context',
      figureQuestion: '该图如何检验从刺激到转录响应的候选通路？',
      coreConclusion: '处理、抑制与救援三步共同支持一条可检验的通路关系。',
      claimBoundary: '该合成示例不能外推为真实生物医学或临床结论。',
      authorAssembly: '作者先定义分组，再报告响应，最后用抑制和救援检验必要性与特异性。',
      panelCoverage: {
        expectedPanels: ['A', 'B', 'C'],
        returnedPanels: ['A', 'B', 'C'],
        missingPanels: []
      },
      argumentChain: [
        { panels: ['A'], established: '建立刺激组与匹配对照组。', handoff: '进入通路响应测量。', evidenceLevel: 'design' },
        { panels: ['B'], established: '处理后激酶活性升高。', handoff: '需要干预关键节点。', evidenceLevel: 'association' },
        { panels: ['C'], established: '抑制削弱响应，救援恢复响应。', handoff: '支持通路特异性。', evidenceLevel: 'mechanistic_support' }
      ],
      panelGroups: [],
      logicBridges: [],
      panels: [
        {
          panel: 'A', role: 'design', phenotypeName: '实验分组与处理流程',
          methodCategory: 'other', methods: ['匹配对照设计'], methodSource: 'caption',
          purpose: '定义刺激组和车辆对照组。',
          design: '相同培养条件下，仅处理因素不同。',
          comparison: '刺激 S 对比车辆对照。',
          directObservation: '该 Panel 展示实验设计，不报告效应大小。',
          observationSource: 'caption_statement',
          localInference: '后续差异可在该对照框架下解释。',
          contribution: '建立 Figure 的比较基础。',
          inputBasis: { inputMode: 'caption_context', pixelsSupplied: false, imageWidth: 0, imageHeight: 0, attempts: 1 }
        },
        {
          panel: 'B', role: 'phenotype', phenotypeName: '激酶活性变化',
          methodCategory: 'wet_lab', methods: ['活性测定'], methodSource: 'caption',
          purpose: '检验刺激是否伴随激酶活性变化。',
          design: '处理后定量比较两组活性。',
          comparison: '刺激组对比车辆对照组。',
          directObservation: '刺激组激酶活性升高。',
          observationSource: 'caption_statement',
          localInference: '刺激与通路激活相关。',
          contribution: '建立候选通路响应。',
          inputBasis: { inputMode: 'caption_context', pixelsSupplied: false, imageWidth: 0, imageHeight: 0, attempts: 1 }
        },
        {
          panel: 'C', role: 'rescue', phenotypeName: '抑制与救援验证',
          methodCategory: 'wet_lab', methods: ['抑制与救援实验'], methodSource: 'caption',
          purpose: '检验关键节点的必要性与通路特异性。',
          design: '先抑制激酶，再加入耐药构建体救援。',
          comparison: '抑制、救援与匹配对照。',
          directObservation: '抑制削弱响应，救援恢复响应。',
          observationSource: 'caption_statement',
          localInference: '结果支持而非最终证明通路特异性。',
          contribution: '把相关性推进为干预证据。',
          inputBasis: { inputMode: 'caption_context', pixelsSupplied: false, imageWidth: 0, imageHeight: 0, attempts: 1 }
        }
      ]
    }
  }]
};
await sidePanel.evaluate(snapshot => {
  currentWorkspaceSnapshot = {
    ...(currentWorkspaceSnapshot || {}),
    figures: snapshot
  };
  figureExpansionState.set('figure-1', true);
  figurePanelExpansionState.set(panelWorkspaceKey('figure-1', 'A'), true);
  switchWorkspaceView('figures');
  renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
  const card = document.querySelector('.workspace-figure-card[data-figure-id="figure-1"]');
  if (card) card.open = true;
  const panel = card?.querySelector('.workspace-figure-panel-card');
  if (panel) panel.open = true;
  const view = document.querySelector('[data-workspace-view="figures"]');
  if (view) view.scrollTop = 0;
  document.getElementById('statusMessage')?.classList.remove('show');
}, cleanFigureSnapshot);
await fixture.evaluate(() => {
  const figure = document.getElementById('figure-1');
  if (figure) {
    scrollTo({ top: figure.offsetTop - 24, behavior: 'instant' });
  }
});
await sidePanel.waitForTimeout(120);
await compose('screenshot-4-figure-panel-1280x800.png', fixture, sidePanel);

await sidePanel.evaluate(() => {
  const paragraphs = Array.isArray(currentWorkspaceSnapshot?.paragraphs)
    ? currentWorkspaceSnapshot.paragraphs : [];
  const sourceA = paragraphs.find(item => /Activation of kinase A/.test(item.text || '')) ||
    paragraphs[0] || {};
  const sourceB = paragraphs.find(item => /To test necessity/.test(item.text || '')) ||
    paragraphs[1] || sourceA;
  const evidence = (source, marker, support) => ({
    marker: String(marker),
    paragraphId: source.paragraphId || `demo-${marker}`,
    sourceKey: source.sourceKey || `demo-source-${marker}`,
    sectionTitle: source.sectionTitle || 'Results',
    quote: source.text || support,
    support,
    documentRevision: currentWorkspaceSnapshot.revision
  });
  llmSettingsState = {
    effectiveMode: 'llm',
    llmReady: true,
    settings: {
      consentGranted: true,
      globalProfileId: 'profile_demo',
      profileOrder: ['profile_demo'],
      profiles: {
        profile_demo: {
          name: 'Demo Model', providerId: 'openai-compatible',
          config: {
            model: 'demo-evidence-model',
            hasApiKey: true,
            baseUrl: 'https://api.example.invalid/v1'
          }
        }
      }
    }
  };
  currentWorkspaceSnapshot = {
    ...(currentWorkspaceSnapshot || {}),
    chat: {
      loading: false,
      error: '',
      coverage: {
        sentParagraphs: paragraphs.length,
        totalParagraphs: paragraphs.length,
        sentCharacters: 1800,
        totalCharacters: 1800,
        truncated: false
      },
      totalTurns: 2,
      turns: [
        {
          turnId: 'store-turn-1',
          question: '作者用哪些证据支持这条候选通路？',
          status: 'completed',
          selectedProfileId: 'profile_demo',
          profileName: 'Demo Model',
          model: 'demo-evidence-model',
          createdAt: Date.now() - 2000,
          updatedAt: Date.now() - 1900,
          answerBlocks: [{
            blockId: 'store-block-1',
            markdown: '**证据链分为三步：**\n\n1. 刺激后激酶活性升高，先建立通路响应。[[1]]\n2. 抑制关键节点后下游响应减弱，支持必要性。[[2]]\n3. 救援实验恢复响应，进一步支持通路特异性。[[2]]',
            evidence: [
              evidence(sourceA, 1, '该段报告刺激后的通路响应。'),
              evidence(sourceB, 2, '该段报告抑制与救援结果。')
            ]
          }]
        },
        {
          turnId: 'store-turn-2',
          question: '这个结论的边界是什么？',
          status: 'completed',
          selectedProfileId: 'profile_demo',
          profileName: 'Demo Model',
          model: 'demo-evidence-model',
          createdAt: Date.now() - 1000,
          updatedAt: Date.now() - 900,
          answerBlocks: [{
            blockId: 'store-block-2',
            markdown: '结果支持一条**可检验的候选机制**，但示例没有独立重复、人群外部验证或临床结局，因此不能外推为真实医学结论。[[1]]',
            evidence: [evidence(sourceB, 1, '该段明确限定了证据能够支持的范围。')]
          }]
        }
      ]
    }
  };
  switchWorkspaceView('chat');
  articleChatFollowLatest = false;
  renderArticleChatSnapshot(currentWorkspaceSnapshot);
  const messages = document.getElementById('articleChatMessages');
  if (messages) messages.scrollTop = 0;
  document.querySelectorAll('.article-chat-turn-actions').forEach(actions => {
    actions.hidden = true;
  });
  const view = document.querySelector('[data-workspace-view="chat"]');
  if (view) view.scrollTop = 0;
  document.getElementById('statusMessage')?.classList.remove('show');
});
await fixture.evaluate(() => {
  document.querySelector('#discussion')?.scrollIntoView({ block: 'start' });
});
await sidePanel.waitForTimeout(160);
await compose('screenshot-5-full-text-chat-1280x800.png', fixture, sidePanel);

await context.close();
await compositorBrowser.close();
removeGeneratedTempDirectory(userDataDir, 'brevess-store-profile-');
removeGeneratedTempDirectory(extensionDir, 'brevess-store-extension-');
process.stdout.write(`${output}\n`);
