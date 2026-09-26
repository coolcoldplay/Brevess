import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || repositoryRoot);
const output = path.resolve(process.env.SCI_FIGURE_EVIDENCE_OUTPUT_DIR ||
  path.join(repositoryRoot, 'output/playwright/figure-evidence-layout-upstream-r12-final2'));
if (fs.existsSync(output) && fs.readdirSync(output).length > 0) {
  throw new Error(
    `Refusing to overwrite existing acceptance artifacts: ${output}. ` +
    'Set SCI_FIGURE_EVIDENCE_OUTPUT_DIR to a new empty run directory.'
  );
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-figure-evidence-'));
const extension = path.join(temporary, 'extension');
fs.mkdirSync(extension);
fs.mkdirSync(output, { recursive: true });

for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
  fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
}
for (const file of fs.readdirSync(root)) {
  if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
    fs.copyFileSync(path.join(root, file), path.join(extension, file));
  }
}

const fixture = {
  provenance: 'isolated component fixture; synthetic data; not an actual model result',
  noteQuestion: '保存于文献笔记的问题：受体 R 是否通过激酶 K 驱动表型 P？',
  reviewedBlockConclusion: '人工复核保留值：处理后表型 P 增强。',
  reviewedUpstreamLong: '人工承上：前序表型观察留下激酶 K 是否必要的问题。第二句人工说明必须留在编辑值中。',
  reviewedTransition: '人工复核保留值：因此下一块检验激酶 K 的必要性。',
  reviewedRelation: '人工复核保留值：必要性检验',
  figure: {
    figureId: 'figure-1', figureLabel: 'Figure 1 · 组件验收 fixture',
    hasImage: false, isSupplemental: false, panelHints: ['A', 'B', 'C', 'D'],
    activeDepth: 'standard', standardError: '', deep: null, deepLoading: false,
    deepError: '', panelFollowups: {}, panelFollowupLoading: {},
    panelFollowupErrors: {}, panelAnalysisLoading: {}, expanded: true
  },
  result: {
    analysisDepth: 'standard', basis: 'caption_context',
    figureQuestion: 'Figure 1 如何连接表型观察与必要性检验？',
    coreConclusion: '组件 fixture 展示两步证据结构。',
    claimBoundary: '这些文字仅用于组件验收，不代表任何论文或模型结论。',
    authorAssembly: '先观察表型，再检验激酶必要性。',
    panelCoverage: {
      expectedPanels: ['A', 'B', 'C', 'D'], returnedPanels: ['A', 'B', 'C', 'D'], missingPanels: []
    },
    panelGroups: [
      { panels: ['A', 'B', 'C', 'D'], groupGoal: '概括整张 Figure', groupConclusion: '整图概括。' },
      { panels: ['A'], groupGoal: '观察受体 R 处理后的表型 P', groupConclusion: '生成值：表型 P 增强。' },
      { panels: ['B'], groupGoal: '检验激酶 K 对表型 P 是否必要', groupConclusion: '抑制 K 后表型 P 减弱。' },
      { panels: ['C', 'D'], groupGoal: '候选分组一', groupConclusion: '存在分组歧义。' },
      { panels: ['C', 'D'], groupGoal: '候选分组二', groupConclusion: '存在分组歧义。' }
    ],
    argumentChain: [
      { panels: ['A'], established: 'Panel A 建立表型变化。', handoff: '需要检验候选激酶。', evidenceLevel: '观察证据' },
      { panels: ['B'], established: 'Panel B 提供干预证据。', handoff: '形成当前 Figure 结论。', evidenceLevel: '必要性证据' },
      { panels: ['C'], established: 'Panel C 保留待确认信息。', handoff: '', evidenceLevel: '描述证据' },
      { panels: ['D'], established: 'Panel D 保留待确认信息。', handoff: '', evidenceLevel: '描述证据' }
    ],
    logicBridges: [{
      id: 'reviewed-bridge',
      fromGroup: '观察受体 R 处理后的表型 P',
      toGroup: '检验激酶 K 对表型 P 是否必要',
      relationType: 'generated necessity',
      bridge: '生成值：由表型观察推进到必要性检验。'
    }],
    panels: [
      {
        panel: 'A', role: 'phenotype', phenotypeName: '表型 P',
        methods: ['定量成像'], methodCategory: 'imaging', methodSource: 'caption',
        purpose: '观察受体 R 处理后的表型。', design: '处理组与匹配对照组。',
        comparison: '受体 R 处理对比载体对照。',
        directObservation: '处理后表型 P 增强。', observationSource: 'caption_statement',
        localInference: '受体 R 处理与表型 P 相关。', contribution: '建立待解释表型。'
      },
      {
        panel: 'B', role: 'necessity', phenotypeName: '表型 P',
        methods: ['激酶抑制'], methodCategory: 'perturbation', methodSource: 'caption',
        purpose: '检验激酶 K 的必要性。', design: '抑制剂与匹配对照。',
        comparison: 'K 抑制对比载体对照。',
        directObservation: '抑制 K 后表型 P 减弱。', observationSource: 'caption_statement',
        localInference: '结果支持 K 对表型 P 的必要性。', contribution: '推进到干预证据。'
      },
      {
        panel: 'C', role: 'control', phenotypeName: '表型 P',
        purpose: '保留歧义分组 Panel C。', directObservation: '组件 fixture C。',
        contribution: '等待人工确认分组。'
      },
      {
        panel: 'D', role: 'control', phenotypeName: '表型 P',
        purpose: '保留歧义分组 Panel D。', directObservation: '组件 fixture D。',
        contribution: '等待人工确认分组。'
      }
    ]
  }
};

const report = {
  status: 'FAIL',
  scope: fixture.provenance,
  viewportCoverage: [360, 720],
  checks: [], screenshots: [], metrics: {},
  externalRequests: 0, modelApiCalls: 0
};
let context;

function addScreenshot(file) {
  report.screenshots.push(path.relative(repositoryRoot, file).replaceAll('\\', '/'));
}

try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: { width: 360, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => {
    report.externalRequests += 1;
    return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('#sidePanelApp').waitFor();
  await page.waitForFunction(() => panelUiReady === true);
  await page.evaluate(() => synchronizeActiveTabContext());

  const setup = await page.evaluate(input => {
    activePanelTabContext.activated = true;
    // Component harness opens the sidebar as a tab: synchronize its visual guard, too.
    document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
    figureAnalysisState = {
      running: false, paused: false, cancelled: false,
      phase: 'completed', completedFigures: 1, totalFigures: 1, figureProgress: []
    };
    llmSettingsState = {
      ...(llmSettingsState || {}),
      settings: {
        ...(llmSettingsState?.settings || {}),
        literatureNoteTemplates: [{
          id: 'acceptance_note', name: '组件验收笔记', studyFamily: 'basic_research',
          fields: [{
            id: 'research_question', label: '研究问题', prompt: '',
            placeholder: '', multiline: true, required: false
          }]
        }]
      }
    };
    literatureNoteDocumentState = {
      templateId: 'acceptance_note',
      valuesByTemplate: {
        acceptance_note: { research_question: input.noteQuestion }
      },
      fieldStatusByTemplate: {}
    };

    let draft = SciLLM.createFigureWorkspaceDraft([input.figure]);
    draft = SciLLM.mergeModelIntoFigureWorkspaceDraft(draft, input.figure, input.result);
    const update = (blockId, field, value, timestamp) => {
      draft = SciLLM.applyFigureWorkspaceMutation(draft, {
        type: 'update_evidence_block', expectedRevision: draft.revision,
        figureId: input.figure.figureId, blockId, field, value
      }, timestamp);
    };
    const rawBlocks = draft.figures['figure-1'].evidenceBlocks;
    const blockA = rawBlocks.find(item => item.kind === 'evidence' &&
      item.panelIds.length === 1 && item.panelIds[0] === 'A');
    const blockB = rawBlocks.find(item => item.kind === 'evidence' &&
      item.panelIds.length === 1 && item.panelIds[0] === 'B');
    const transitionBlock = rawBlocks.find(item => item.kind === 'transition');
    if (!blockA || !blockB || !transitionBlock) {
      throw new Error('fixture must create specific A/B groups and their transition');
    }
    update(blockA.id, 'groupConclusion', input.reviewedBlockConclusion, 1700000000001);
    update(blockB.id, 'upstreamContext', input.reviewedUpstreamLong, 1700000000002);
    update(transitionBlock.id, 'transitionToNext', input.reviewedTransition,
      1700000000003);
    update(transitionBlock.id, 'relationType', input.reviewedRelation,
      1700000000004);

    const renderedFigure = { ...input.figure, standard: input.result };
    currentWorkspaceSnapshot = {
      ...(currentWorkspaceSnapshot || {}),
      url: 'https://component-fixture.invalid/article',
      documentHash: 'fixture-document-hash', revision: 1,
      localWorkspace: {
        workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
        canonicalUrl: 'https://component-fixture.invalid/article',
        contentHash: 'b'.repeat(64)
      },
      figureWorkspaceDraft: draft,
      figures: {
        status: figureAnalysisState, totalFigures: 1, failedFigures: 0,
        figures: [renderedFigure], draft,
        crossFigureLogic: { result: null, loading: false, error: '' },
        workspaceLifecycle: 1
      }
    };
    figureExpansionState.set(input.figure.figureId, true);
    switchWorkspaceView('figures');
    renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);

    let banner = document.getElementById('figureEvidenceFixtureBanner');
    if (!banner) {
      banner = document.createElement('aside');
      banner.id = 'figureEvidenceFixtureBanner';
      banner.style.cssText = 'margin:8px 12px;padding:8px 10px;border:1px solid #b8d0dd;' +
        'border-radius:8px;background:#eef7fb;color:#315d73;font:700 11px/1.45 sans-serif';
      document.querySelector('[data-workspace-view="figures"]')?.prepend(banner);
    }
    banner.textContent = '组件验收 fixture · 使用生产渲染函数 · 非真实模型结果';

    const card = document.querySelector('.workspace-figure-card[data-figure-id="figure-1"]');
    card.open = true;
    const blocks = [...card.querySelectorAll('details.workspace-evidence-block')];
    blocks.forEach(block => { block.open = true; });
    card.querySelector('.workspace-figure-panel-card')?.setAttribute('open', '');
    const view = document.querySelector('[data-workspace-view="figures"]');
    if (view) view.scrollTop = 0;
    return {
      revision: draft.revision,
      evidenceIds: draft.figures['figure-1'].evidenceBlocks.map(item => item.id),
      blockAId: blockA.id,
      blockBId: blockB.id,
      storedTransition: draft.figures['figure-1'].evidenceBlocks.find(item =>
        item.id === transitionBlock.id),
      noteTemplates: literatureNoteTemplates().map(item => item.id)
    };
  }, fixture);
  report.metrics.fixtureSetup = setup;

  const card = page.locator('.workspace-figure-card[data-figure-id="figure-1"]');
  const firstBlock = card.locator('details.workspace-evidence-block').first();
  const secondBlock = card.locator(
    `details.workspace-evidence-block[data-evidence-block-id="${setup.blockBId}"]`
  );
  const firstPanels = firstBlock.locator('[data-evidence-panels-body]');
  const firstPanel = firstPanels.locator('.workspace-figure-panel-card').first();
  await firstPanel.waitFor({ state: 'visible' });

  const structure = await card.evaluate((node, expected) => {
    const blocks = [...node.querySelectorAll('details.workspace-evidence-block')];
    const first = blocks[0];
    const upstreamRows = blocks.map(block =>
      block.querySelectorAll('.workspace-evidence-direction.is-upstream [data-field="upstreamContext"]')
        .length);
    const question = first?.querySelector('[data-field="upstreamContext"]')?.innerText || '';
    const secondUpstream = blocks[1]?.querySelector('[data-field="upstreamContext"]')?.innerText || '';
    const allPanels = [...node.querySelectorAll('.workspace-figure-panel-card')];
    const panelIds = allPanels.map(panel => panel.dataset.panelId);
    const blockPanelIds = blocks.map(block => [...block.querySelectorAll(
      '.workspace-evidence-panels-body .workspace-figure-panel-card'
    )].map(panel => panel.dataset.panelId));
    const orphanPanelIds = [...node.querySelectorAll(
      '.workspace-evidence-orphans .workspace-figure-panel-card'
    )].map(panel => panel.dataset.panelId);
    return {
      visibleEditButtons: [...node.querySelectorAll('button')]
        .filter(button => button.offsetParent !== null && button.textContent.trim() === '编辑').length,
      obsoleteEditClassCount: node.querySelectorAll('.workspace-figure-edit-button').length,
      blockCount: blocks.length,
      standaloneTransitionCount: node.querySelectorAll('details.workspace-evidence-transition').length,
      inlineTransitionCount: node.querySelectorAll('.workspace-evidence-transition-fields').length,
      downstreamCount: node.querySelectorAll('.workspace-evidence-direction.is-downstream').length,
      upstreamRows, question, secondUpstream, panelIds, blockPanelIds, orphanPanelIds,
      panelsFoldCount: node.querySelectorAll('details.workspace-evidence-panels').length,
      orphanHeading: node.querySelector('.workspace-evidence-orphans-title')?.textContent || '',
      noteQuestionPreserved: question.includes(
        expected.noteQuestion.normalize('NFKC').replace(/[。！？!?]+$/u, '')
      ),
      reviewedBlockPreserved:
        first?.innerText.includes(expected.reviewedBlockConclusion.normalize('NFKC')) || false,
      reviewedTransitionHidden: !node.innerText.includes(expected.reviewedTransition.normalize('NFKC')),
      reviewedRelationHidden: !node.innerText.includes(expected.reviewedRelation.normalize('NFKC')),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1
    };
  }, fixture);
  report.metrics.structure360 = structure;
  assert.equal(structure.visibleEditButtons, 0);
  assert.equal(structure.obsoleteEditClassCount, 0);
  assert.equal(structure.blockCount, 2);
  assert.equal(structure.standaloneTransitionCount, 0);
  assert.equal(structure.inlineTransitionCount, 0);
  assert.equal(structure.downstreamCount, 0);
  assert.deepEqual(structure.upstreamRows, [1, 1]);
  assert.deepEqual(structure.blockPanelIds, [['A'], ['B']]);
  assert.deepEqual(structure.orphanPanelIds, ['C', 'D']);
  assert.deepEqual([...structure.panelIds].sort(), ['A', 'B', 'C', 'D']);
  assert.equal(new Set(structure.panelIds).size, 4);
  assert.equal(structure.panelsFoldCount, 0);
  assert.equal(structure.orphanHeading, '待确认分组');
  assert.match(structure.question, /论文科学问题/u);
  assert.equal(structure.noteQuestionPreserved, true, structure.question);
  assert.match(structure.secondUpstream, /人工承上[:：]前序表型观察留下激酶 K 是否必要的问题。/u);
  assert.doesNotMatch(structure.secondUpstream, /第二句人工说明/u);
  assert.equal(structure.reviewedBlockPreserved, true);
  assert.equal(structure.reviewedTransitionHidden, true);
  assert.equal(structure.reviewedRelationHidden, true);
  assert.equal(setup.storedTransition.transitionToNext.value,
    fixture.reviewedTransition.normalize('NFKC'));
  assert.equal(setup.storedTransition.relationType.value,
    fixture.reviewedRelation.normalize('NFKC'));
  assert.equal(structure.horizontalOverflow, false);
  report.checks.push('360px production renderer shows exactly one upstream row per evidence block');
  report.checks.push('saved transition content remains stored while downstream and transition cards stay hidden');
  report.checks.push('specific groups own A/B once; ambiguous C/D remain under 待确认分组');
  report.checks.push('no visible edit button or obsolete edit-button element remains');

  const allGroupsFiltered = await page.evaluate(() => {
    const host = document.createElement('section');
    const panelView = panelId => ({
      figureId: 'figure-all-filtered', panelId, displayId: panelId,
      panelAnchorId: `figure-all-filtered-panel-${panelId.toLowerCase()}`, fields: []
    });
    const evidenceBlock = (id, title) => ({
      id, kind: 'evidence', sourceType: 'group', panelIds: ['X', 'Y'],
      groupGoal: title, groupConclusion: '', upstreamContext: '', established: '',
      handoff: '', evidenceLevel: '', transitionToNext: ''
    });
    const view = {
      panels: [panelView('X'), panelView('Y')],
      evidenceBlocks: [
        evidenceBlock('ambiguous-one', '候选一'), evidenceBlock('ambiguous-two', '候选二')
      ]
    };
    const result = {
      panels: [
        { panel: 'X', purpose: '歧义 X' }, { panel: 'Y', purpose: '歧义 Y' }
      ],
      panelGroups: [
        { panels: ['X', 'Y'], groupGoal: '候选一' },
        { panels: ['X', 'Y'], groupGoal: '候选二' }
      ]
    };
    appendFigurePanelCatalog(host, {
      figureId: 'figure-all-filtered', panelAnalyses: {}, panelAnalysisLoading: {},
      panelFollowups: {}, panelFollowupLoading: {}, panelFollowupErrors: {}
    }, result, view);
    const metrics = {
      evidenceBlockCount: host.querySelectorAll('.workspace-evidence-block').length,
      orphanHeading: host.querySelector('.workspace-evidence-orphans-title')?.textContent || '',
      orphanPanelIds: [...host.querySelectorAll('.workspace-evidence-orphans ' +
        '.workspace-figure-panel-card')].map(panel => panel.dataset.panelId),
      impliedEvidenceGroupCount: host.querySelectorAll(
        '.workspace-figure-panel-card[data-evidence-group]'
      ).length
    };
    host.remove();
    return metrics;
  });
  assert.deepEqual(allGroupsFiltered, {
    evidenceBlockCount: 0,
    orphanHeading: '待确认分组',
    orphanPanelIds: ['X', 'Y'],
    impliedEvidenceGroupCount: 0
  });
  report.metrics.allGroupsFiltered = allGroupsFiltered;
  report.checks.push('when every stored group is ambiguous, all Panels stay in 待确认分组');

  const shot360 = path.join(output, '01-evidence-blocks-saved-note-360.png');
  await page.screenshot({ path: shot360, fullPage: true });
  addScreenshot(shot360);

  const editable = secondBlock.locator(
    '[data-field="upstreamContext"] .workspace-figure-edit-target'
  );
  await editable.dblclick();
  let editor = page.locator('.workspace-figure-inline-editor');
  await editor.waitFor({ state: 'visible' });
  assert.equal(await editor.inputValue(), fixture.reviewedUpstreamLong.normalize('NFKC'));
  const editorShot = path.join(output, '02-inline-editor-dblclick-360.png');
  await page.screenshot({ path: editorShot, fullPage: true });
  addScreenshot(editorShot);
  await editor.press('Escape');
  await page.waitForFunction(() => !figureWorkspaceInlineEditController.getState().active);
  await page.locator('.workspace-figure-inline-editor').waitFor({ state: 'detached' });
  await editable.dblclick();
  editor = page.locator('.workspace-figure-inline-editor');
  await editor.waitFor({ state: 'visible' });
  await editor.press('Control+Enter');
  await page.waitForFunction(() => !figureWorkspaceInlineEditController.getState().active);
  await page.locator('.workspace-figure-inline-editor').waitFor({ state: 'detached' });
  const savedUpstreamAfterNoChange = await page.evaluate(blockId =>
    currentWorkspaceSnapshot.figures.draft.figures['figure-1'].evidenceBlocks
      .find(item => item.id === blockId)?.upstreamContext?.value, setup.blockBId);
  assert.equal(savedUpstreamAfterNoChange, fixture.reviewedUpstreamLong.normalize('NFKC'));
  report.metrics.savedUpstreamAfterNoChange = savedUpstreamAfterNoChange;

  const keyboardTarget = page.locator(
    '.workspace-figure-card[data-figure-id="figure-1"] ' +
    'details.workspace-evidence-block [data-field="groupGoal"] .workspace-figure-edit-target'
  ).first();
  await keyboardTarget.focus();
  await keyboardTarget.press('Enter');
  editor = page.locator('.workspace-figure-inline-editor');
  await editor.waitFor({ state: 'visible' });
  await editor.press('Escape');
  await page.waitForFunction(() => !figureWorkspaceInlineEditController.getState().active);
  await page.locator('.workspace-figure-inline-editor').waitFor({ state: 'detached' });

  const spaceTarget = page.locator(
    '.workspace-figure-card[data-figure-id="figure-1"] ' +
    'details.workspace-evidence-block [data-field="groupGoal"] .workspace-figure-edit-target'
  ).first();
  await spaceTarget.focus();
  await spaceTarget.press('Space');
  editor = page.locator('.workspace-figure-inline-editor');
  await editor.waitFor({ state: 'visible' });
  await editor.press('Escape');
  await page.waitForFunction(() => !figureWorkspaceInlineEditController.getState().active);
  await page.locator('.workspace-figure-inline-editor').waitFor({ state: 'detached' });
  report.checks.push('double click keeps the full saved upstream text; Enter and Space keep editing reachable');

  const liveFirstBlock = page.locator(
    '.workspace-figure-card[data-figure-id="figure-1"] details.workspace-evidence-block'
  ).first();
  const liveFirstPanels = liveFirstBlock.locator('[data-evidence-panels-body]');
  const liveFirstPanel = liveFirstPanels.locator('.workspace-figure-panel-card').first();
  await liveFirstBlock.evaluate(node => { node.open = true; });
  const panelVisibleWithBlock = await liveFirstPanel.isVisible();
  await liveFirstBlock.evaluate(node => { node.open = false; });
  const panelHiddenByBlock = !(await liveFirstPanel.isVisible());
  const collapse = { panelVisibleWithBlock, panelHiddenByBlock };
  assert.deepEqual(collapse, { panelVisibleWithBlock: true, panelHiddenByBlock: true });
  report.metrics.collapse = collapse;
  report.checks.push('one evidence-block fold directly reveals or hides its Panel descendants');

  const navigated = await page.evaluate(() => navigateFigureQuickAnchor('figure-1', 'A'));
  assert.equal(navigated, true);
  await page.waitForTimeout(500);
  const navigation = await page.evaluate(() => {
    const panel = document.querySelector(
      '.workspace-figure-panel-card[data-figure-id="figure-1"][data-panel-id="A"]'
    );
    const block = panel?.closest('details.workspace-evidence-block');
    const panels = panel?.closest('details.workspace-evidence-panels');
    return {
      blockOpen: block?.open === true,
      noPanelsFold: !panels,
      panelOpen: panel?.open === true,
      activeElementPanel: document.activeElement === panel?.querySelector('summary')
    };
  });
  assert.deepEqual(navigation, {
    blockOpen: true, noPanelsFold: true, panelOpen: true, activeElementPanel: true
  });
  report.metrics.directNavigation = navigation;
  report.checks.push('direct Panel navigation expands the Figure and evidence block without an extra Panels fold');

  const fallback = await page.evaluate(() => {
    const prior = document.getElementById('figureEvidenceFallbackFixture');
    prior?.remove();
    const host = document.createElement('section');
    host.id = 'figureEvidenceFallbackFixture';
    host.style.cssText = 'margin:12px;padding:8px;border:2px dashed #9ab8c8;border-radius:9px';
    host.appendChild(createWorkspaceElement(
      'strong', '', '缺失科学问题分支 · 组件 fixture · 非真实模型结果'
    ));
    const missing = resolveFigureEvidencePaperQuestion({});
    const block = createFigureEvidenceBlockDetails('figure-missing', {
      id: 'missing-block', kind: 'evidence', sourceType: 'manual', panelIds: [],
      groupGoal: '检查缺失占位', groupConclusion: '', established: '', handoff: '',
      evidenceLevel: '', transitionToNext: ''
    }, 0, { paperQuestion: missing });
    block.open = true;
    host.appendChild(block);
    document.getElementById('figureWorkspace')?.appendChild(host);
    return { value: missing.value, missing: missing.missing, text: host.innerText };
  });
  assert.deepEqual({ value: fallback.value, missing: fallback.missing }, {
    value: '文章科学问题尚未取得', missing: true
  });
  assert.match(fallback.text, /承上：\s*尚未取得论文科学问题，暂无法说明本块承接关系。/u);
  report.metrics.missingFallback = fallback;
  report.checks.push('missing paper question renders the explicit fallback without inventing content');
  const fallbackShot = path.join(output, '03-missing-question-fallback-360.png');
  await page.locator('#figureEvidenceFallbackFixture').screenshot({ path: fallbackShot });
  addScreenshot(fallbackShot);

  const badge360 = await firstPanel.locator('.workspace-panel-id').evaluate(node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      text: node.textContent.trim(), width: rect.width,
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      minWidth: style.minWidth, borderRadius: style.borderRadius
    };
  });
  assert.match(badge360.text, /^\d*A$/u);
  assert.ok(badge360.width >= 18 && badge360.width <= 48, `badge width ${badge360.width}`);
  assert.equal(badge360.minWidth, '0px');
  assert.equal(badge360.borderRadius, '4px');
  report.metrics.badge360 = badge360;
  report.checks.push('Panel ID badge geometry follows text plus compact padding at 360px');

  await page.setViewportSize({ width: 720, height: 900 });
  await page.evaluate(() => {
    document.getElementById('figureEvidenceFallbackFixture')?.remove();
    const view = document.querySelector('[data-workspace-view="figures"]');
    if (view) view.scrollTop = 0;
  });
  const wide = await card.evaluate(node => ({
    visibleEditButtons: [...node.querySelectorAll('button')]
      .filter(button => button.offsetParent !== null && button.textContent.trim() === '编辑').length,
    standaloneTransitionCount: node.querySelectorAll('details.workspace-evidence-transition').length,
    downstreamCount: node.querySelectorAll('.workspace-evidence-direction.is-downstream').length,
    upstreamRowCount: node.querySelectorAll(
      '.workspace-evidence-direction.is-upstream [data-field="upstreamContext"]'
    ).length,
    orphanPanelCount: node.querySelectorAll(
      '.workspace-evidence-orphans .workspace-figure-panel-card'
    ).length,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    blockWidth: node.querySelector('details.workspace-evidence-block')
      ?.getBoundingClientRect().width || 0
  }));
  assert.deepEqual({
    visibleEditButtons: wide.visibleEditButtons,
    standaloneTransitionCount: wide.standaloneTransitionCount,
    downstreamCount: wide.downstreamCount,
    upstreamRowCount: wide.upstreamRowCount,
    orphanPanelCount: wide.orphanPanelCount,
    horizontalOverflow: wide.horizontalOverflow
  }, {
    visibleEditButtons: 0, standaloneTransitionCount: 0, downstreamCount: 0,
    upstreamRowCount: 2, orphanPanelCount: 2, horizontalOverflow: false
  });
  assert.ok(wide.blockWidth > 500, `wide block width ${wide.blockWidth}`);
  report.metrics.layout720 = wide;
  report.checks.push('720px production component keeps the same hierarchy without overflow');
  const wideShot = path.join(output, '04-evidence-blocks-wide-720.png');
  await firstBlock.screenshot({ path: wideShot });
  addScreenshot(wideShot);

  assert.deepEqual(pageErrors, []);
  assert.equal(report.externalRequests, 0);
  report.status = 'PASS';
} catch (error) {
  report.error = error.stack || error.message;
  process.exitCode = 1;
} finally {
  await context?.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith('brevess-figure-evidence-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  status: report.status, checks: report.checks.length,
  screenshots: report.screenshots.length,
  externalRequests: report.externalRequests,
  modelApiCalls: report.modelApiCalls,
  error: report.error
}));
