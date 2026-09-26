// DOM-only acceptance for fresh Figure synthesis artifacts.
//
// This script never calls a model. It loads normalized Figure synthesis files
// produced by the separately authorized live harness, merges the captured public
// Panel evidence when needed, persists the production workspace through
// chrome.storage, reloads the extension page, and inspects the production DOM.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const defaults = Object.freeze({
  inputDirectory: process.env.SCI_FRESH_SYNTHESIS_INPUT_DIRECTORY ||
    process.env.SCI_FRESH_SYNTHESIS_SOURCE_DIR || path.join(
      repositoryRoot, 'output/playwright/figure-group-synthesis-live-approved-r12-refined'
    ),
  outputDirectory: process.env.SCI_FRESH_SYNTHESIS_OUTPUT_DIRECTORY ||
    process.env.SCI_FRESH_SYNTHESIS_LAYOUT_OUTPUT_DIR || path.join(
      repositoryRoot, 'output/playwright/figure-fresh-synthesis-layout-r12'
    ),
  extensionRoot: process.env.SCI_FRESH_SYNTHESIS_EXTENSION_ROOT || repositoryRoot
});

function parseArguments(argv = process.argv.slice(2)) {
  const aliases = new Map([
    ['--input-directory', 'inputDirectory'], ['--input-dir', 'inputDirectory'],
    ['--output-directory', 'outputDirectory'], ['--output-dir', 'outputDirectory'],
    ['--extension-root', 'extensionRoot']
  ]);
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 2) {
    const key = aliases.get(argv[index]);
    const value = argv[index + 1];
    if (!key || !value || value.startsWith('--')) {
      throw new Error(`FRESH_SYNTHESIS_LAYOUT_ARGUMENT_INVALID: ${argv[index] || ''}`);
    }
    options[key] = value;
  }
  return Object.fromEntries(Object.entries(options).map(([key, value]) => [
    key, path.resolve(value)
  ]));
}

const options = parseArguments();
const sourceDirectory = options.inputDirectory;
const output = options.outputDirectory;
const extensionRoot = options.extensionRoot;
const storageKey = 'brevess-fresh-synthesis-layout-r12';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJsonFile(file, maximumBytes = 12 * 1024 * 1024) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < 2 || stat.size > maximumBytes) {
    throw new Error(`FRESH_SYNTHESIS_ARTIFACT_INVALID: ${path.basename(file)}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function canonicalPanelId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function canonicalPanelOrder(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function panelArray(value) {
  return Array.isArray(value) ? value : (Array.isArray(value?.panels) ? value.panels : []);
}

function mergePanelInputs(normalized, panelInput, figureId) {
  const returned = new Map((Array.isArray(normalized?.panels) ? normalized.panels : [])
    .map(panel => [canonicalPanelId(panel?.panel), panel]).filter(([id]) => id));
  const inputs = new Map(panelInput
    .map(panel => [canonicalPanelId(panel?.panel), panel]).filter(([id]) => id));
  assert.equal(inputs.size, panelInput.length, `${figureId}: duplicate Panel input identity`);
  for (const panelId of returned.keys()) {
    assert.equal(inputs.has(panelId), true, `${figureId}: synthesis returned unknown Panel ${panelId}`);
  }
  const expectedPanels = [...inputs.keys()].sort(canonicalPanelOrder);
  const panels = expectedPanels.map(panelId => ({
    ...(inputs.get(panelId) || {}), ...(returned.get(panelId) || {}), panel: panelId
  }));
  assert.deepEqual(panels.map(panel => panel.panel), expectedPanels,
    `${figureId}: merged Panel order changed`);
  assert.equal(panels.every(panel => panel.purpose || panel.directObservation || panel.contribution),
    true, `${figureId}: merged Panel analysis is incomplete`);
  return { result: { ...normalized, panels }, expectedPanels };
}

function loadSources() {
  const sourceReportFile = path.join(sourceDirectory, 'report.json');
  const sourceReport = readJsonFile(sourceReportFile);
  const normalizedNames = fs.readdirSync(sourceDirectory).filter(name =>
    /^figure-[A-Za-z0-9._-]+-synthesis-normalized-redacted\.json$/u.test(name)
  );
  assert.equal(normalizedNames.length, 2,
    'this two-Figure acceptance requires exactly two normalized synthesis files');
  const reportOrder = new Map((Array.isArray(sourceReport?.figures) ? sourceReport.figures : [])
    .map((figure, index) => [String(figure?.figureId || ''), index]));
  normalizedNames.sort((left, right) => {
    const leftId = left.replace(/-synthesis-normalized-redacted\.json$/u, '');
    const rightId = right.replace(/-synthesis-normalized-redacted\.json$/u, '');
    return (reportOrder.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
      (reportOrder.get(rightId) ?? Number.MAX_SAFE_INTEGER) ||
      canonicalPanelOrder(leftId, rightId);
  });
  const figures = normalizedNames.map(normalizedName => {
    const normalizedFile = path.join(sourceDirectory, normalizedName);
    const normalized = readJsonFile(normalizedFile);
    const figureId = String(normalized?.figureId || '').trim();
    assert.match(figureId, /^figure-[A-Za-z0-9._-]+$/u, 'normalized Figure identity invalid');
    assert.equal(normalizedName, `${figureId}-synthesis-normalized-redacted.json`);
    const freshPanelName = `${figureId}-fresh-panels-normalized-redacted.json`;
    const freshPanelFile = path.join(sourceDirectory, freshPanelName);
    const embeddedPanels = panelArray(normalized?.panels);
    const freshPanels = fs.existsSync(freshPanelFile)
      ? panelArray(readJsonFile(freshPanelFile)) : [];
    const panelInput = freshPanels.length ? freshPanels : embeddedPanels;
    assert.ok(panelInput.length > 0, `${figureId}: no normalized Panel analysis input`);
    const { result, expectedPanels } = mergePanelInputs(normalized, panelInput, figureId);
    const expectedGroups = (Array.isArray(result.panelGroups) ? result.panelGroups : [])
      .map(group => (Array.isArray(group?.panels) ? group.panels : []).map(canonicalPanelId));
    assert.ok(expectedGroups.length > 0, `${figureId}: no normalized groups`);
    expectedGroups.forEach((group, index) => assert.deepEqual(
      group, [...group].sort(canonicalPanelOrder),
      `${figureId}: normalized group ${index + 1} is not canonically ordered`
    ));
    const expectedDisplayPanels = expectedGroups.flat();
    assert.equal(new Set(expectedDisplayPanels).size, expectedDisplayPanels.length,
      `${figureId}: normalized groups overlap`);
    assert.deepEqual([...expectedDisplayPanels].sort(canonicalPanelOrder), expectedPanels,
      `${figureId}: normalized groups must be one exact Panel partition`);
    return {
      figureId,
      label: String(result.figureTitleZh || result.figureTitle || figureId),
      result, expectedGroups, expectedPanels, expectedDisplayPanels,
      normalizedSha256: sha256File(normalizedFile),
      normalizedFile: normalizedName,
      panelInputFile: freshPanels.length ? freshPanelName : normalizedName,
      panelInputSha256: sha256File(freshPanels.length ? freshPanelFile : normalizedFile),
      panelInputKind: freshPanels.length ? 'fresh-normalized-panels' : 'embedded-synthesis-panels'
    };
  });
  assert.equal(figures.reduce((sum, figure) => sum + figure.expectedPanels.length, 0), 37,
    'this two-Figure acceptance requires exactly 37 normalized Panel inputs');
  return {
    sourceReport,
    sourceReportSha256: sha256File(sourceReportFile),
    figures
  };
}

function makeFigure(source) {
  const { figureId, label, result, expectedPanels } = source;
  return {
    figureId,
    figureLabel: label,
    caption: '',
    hasImage: false,
    isSupplemental: false,
    panelHints: expectedPanels,
    activeDepth: 'standard',
    standard: result,
    standardError: '',
    deep: null,
    deepLoading: false,
    deepError: '',
    panelAnalyses: Object.fromEntries(result.panels.map(panel => [panel.panel, panel])),
    panelFollowups: {}, panelFollowupLoading: {}, panelFollowupErrors: {},
    panelAnalysisLoading: {}, panelAnalysisErrors: {}, expanded: true
  };
}

const sources = loadSources();
if (fs.existsSync(output) && fs.readdirSync(output).length > 0) {
  throw new Error(`Refusing to overwrite existing acceptance artifacts: ${output}`);
}
fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-fresh-synthesis-layout-'));
const extension = path.join(temporary, 'extension');
fs.mkdirSync(extension);
for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
  fs.cpSync(path.join(extensionRoot, directory), path.join(extension, directory), {
    recursive: true
  });
}
for (const file of fs.readdirSync(extensionRoot)) {
  if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
    fs.copyFileSync(path.join(extensionRoot, file), path.join(extension, file));
  }
}

const report = {
  schemaVersion: 1,
  status: 'FAIL',
  classification: 'DOM_ACCEPTANCE_ONLY_SCIENTIFIC_REVIEW_SEPARATE',
  scope: 'render fresh returned content only; not full extraction or scientific acceptance',
  sourceDirectory: path.relative(repositoryRoot, sourceDirectory).replaceAll('\\', '/'),
  extensionRoot: path.relative(repositoryRoot, extensionRoot).replaceAll('\\', '/') || '.',
  sourceReportSha256: sources.sourceReportSha256,
  sourceClassification: String(sources.sourceReport?.classification || ''),
  sourceFigureStatus: Object.fromEntries((sources.sourceReport?.figures || [])
    .map(item => [String(item?.figureId || ''), String(item?.status || '')])),
  sourceFiles: sources.figures.map(source => ({
    figureId: source.figureId,
    normalizedFile: source.normalizedFile,
    normalizedSha256: source.normalizedSha256,
    panelInputFile: source.panelInputFile,
    panelInputSha256: source.panelInputSha256,
    panelInputKind: source.panelInputKind,
    panelCount: source.expectedPanels.length,
    groupCount: source.expectedGroups.length
  })),
  expectedTotalPanelCount: sources.figures.reduce(
    (sum, source) => sum + source.expectedPanels.length, 0
  ),
  viewportCoverage: [360, 720],
  checks: [], screenshots: [], metrics: {},
  externalRequests: 0,
  modelApiCalls: 0
};
let context;
let page;

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
  page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('#sidePanelApp').waitFor();
  await page.waitForTimeout(700);

  const payload = {
    figures: sources.figures.map(source => makeFigure(source)),
    results: Object.fromEntries(sources.figures.map(source => [source.figureId, source.result])),
    articleTitle: String(sources.sourceReport?.articleTitle || ''),
    paperQuestion: sources.figures[0].result.figureQuestion
  };
  const saved = await page.evaluate(async ({ key, input }) => {
    let draft = SciLLM.createFigureWorkspaceDraft(input.figures);
    input.figures.forEach(figure => {
      draft = SciLLM.mergeModelIntoFigureWorkspaceDraft(
        draft, figure, input.results[figure.figureId]
      );
    });
    draft = SciLLM.applyFigureWorkspaceMutation(draft, {
      type: 'seed_generated_meta', expectedRevision: draft.revision,
      scientificQuestions: [{
        value: input.paperQuestion, relationType: 'root',
        supportingFigureIds: [input.figures[0].figureId]
      }]
    }, 1700000000100);
    const record = {
      schemaVersion: 1,
      draft: SciLLM.publicFigureWorkspaceDraft(draft),
      figures: input.figures,
      results: input.results,
      articleTitle: input.articleTitle
    };
    await chrome.storage.local.set({ [key]: record });
    return {
      revision: record.draft.revision,
      serializedChars: JSON.stringify(record).length,
      upstreamByFigure: Object.fromEntries(Object.entries(record.draft.figures).map(
        ([figureId, figure]) => [figureId, figure.evidenceBlocks
          .filter(block => block.kind === 'evidence' && block.sourceType === 'group')
          .map(block => block.upstreamContext.value)]
      ))
    };
  }, { key: storageKey, input: payload });
  report.metrics.storageWrite = saved;

  await page.reload();
  await page.locator('#sidePanelApp').waitFor();
  await page.waitForTimeout(700);
  const restored = await page.evaluate(async key => {
    const record = (await chrome.storage.local.get(key))[key];
    if (!record) throw new Error('fresh synthesis storage record missing after reload');
    const draft = SciLLM.normalizeFigureWorkspaceDraft(record.draft);
    const figures = record.figures.map(raw => ({
      ...raw,
      standard: record.results[raw.figureId],
      panelAnalyses: Object.fromEntries(record.results[raw.figureId].panels
        .map(panel => [panel.panel, panel]))
    }));
    activePanelTabContext.activated = true;
    figureAnalysisState = {
      running: false, paused: false, cancelled: false, phase: 'completed',
      completedFigures: figures.length, totalFigures: figures.length, figureProgress: []
    };
    currentWorkspaceSnapshot = {
      ...(currentWorkspaceSnapshot || {}),
      url: 'https://fresh-synthesis-layout.invalid/article',
      documentHash: 'fresh-synthesis-layout-r12', revision: 1,
      localWorkspace: {
        workspaceId: `workspace:${'c'.repeat(64)}`, workspaceGeneration: 1,
        canonicalUrl: 'https://fresh-synthesis-layout.invalid/article',
        contentHash: 'd'.repeat(64)
      },
      figureWorkspaceDraft: draft,
      figures: {
        status: figureAnalysisState, totalFigures: figures.length, failedFigures: 0,
        figures, draft, crossFigureLogic: { result: null, loading: false, error: '' },
        workspaceLifecycle: 1
      }
    };
    switchWorkspaceView('figures');
    renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
    const banner = document.createElement('aside');
    banner.id = 'freshSynthesisLayoutBanner';
    banner.style.cssText = 'margin:8px 12px;padding:8px 10px;border:1px solid #b8d0dd;' +
      'border-radius:8px;background:#eef7fb;color:#315d73;font:700 11px/1.45 sans-serif';
    banner.textContent = '获批 fresh synthesis · 已捕获公开 Panel 输入 · DOM 验收（非全文重提取）';
    document.querySelector('[data-workspace-view="figures"]')?.prepend(banner);
    figures.forEach(figure => {
      figureExpansionState.set(figure.figureId, true);
      const card = document.querySelector(
        `.workspace-figure-card[data-figure-id="${figure.figureId}"]`
      );
      if (card) card.open = true;
      card?.querySelectorAll('details.workspace-evidence-block')
        .forEach(block => { block.open = true; });
      card?.querySelectorAll('details.workspace-evidence-panels')
        .forEach(group => { group.open = true; });
    });
    return {
      revision: draft.revision,
      articleTitle: record.articleTitle,
      upstreamByFigure: Object.fromEntries(Object.entries(draft.figures).map(
        ([figureId, figure]) => [figureId, figure.evidenceBlocks
          .filter(block => block.kind === 'evidence' && block.sourceType === 'group')
          .map(block => block.upstreamContext.value)]
      ))
    };
  }, storageKey);
  report.metrics.storageReload = restored;
  assert.deepEqual(restored.upstreamByFigure, saved.upstreamByFigure,
    'actual normalized upstream text changed across chrome.storage and page reload');
  report.checks.push('normalized upstream text survives chrome.storage and a full popup reload');

  const expected = Object.fromEntries(sources.figures.map(source => [source.figureId, {
    panels: source.expectedPanels,
    groups: source.expectedGroups,
    upstream: source.result.panelGroups.map(group => String(group.upstreamContext || ''))
  }]));
  const structure = await page.evaluate(expectedByFigure => {
    const output = {};
    for (const [figureId, expectedFigure] of Object.entries(expectedByFigure)) {
      const card = document.querySelector(`.workspace-figure-card[data-figure-id="${figureId}"]`);
      const blocks = [...card.querySelectorAll('details.workspace-evidence-block')];
      const panelIds = [...card.querySelectorAll('.workspace-figure-panel-card')]
        .map(panel => panel.dataset.panelId);
      output[figureId] = {
        expectedPanelCount: expectedFigure.panels.length,
        panelIds,
        groupPanelIds: blocks.map(block => [...block.querySelectorAll(
          'details.workspace-evidence-panels .workspace-figure-panel-card'
        )].map(panel => panel.dataset.panelId)),
        evidenceBlockCount: blocks.length,
        emptyBlockCount: blocks.filter(block => !block.querySelector(
          '.workspace-figure-panel-card'
        )).length,
        emptyPanelFoldCount: [...card.querySelectorAll('details.workspace-evidence-panels')]
          .filter(group => !group.querySelector('.workspace-figure-panel-card')).length,
        upstreamRowsByBlock: blocks.map(block => block.querySelectorAll(
          '.workspace-evidence-direction.is-upstream [data-field="upstreamContext"]'
        ).length),
        downstreamCount: card.querySelectorAll(
          '.workspace-evidence-direction.is-downstream'
        ).length,
        transitionCardCount: card.querySelectorAll(
          '.workspace-evidence-transition-fields, details.workspace-evidence-transition'
        ).length,
        orphanPanelIds: [...card.querySelectorAll(
          '.workspace-evidence-orphans .workspace-figure-panel-card'
        )].map(panel => panel.dataset.panelId)
      };
    }
    return {
      figures: output,
      totalPanelCards: document.querySelectorAll(
        '.workspace-figure-card[data-figure-id] .workspace-figure-panel-card'
      ).length,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1
    };
  }, expected);
  report.metrics.structure360 = structure;
  assert.equal(structure.totalPanelCards, 37);
  assert.equal(structure.horizontalOverflow, false);
  for (const source of sources.figures) {
    const actual = structure.figures[source.figureId];
    assert.deepEqual(actual.panelIds, source.expectedDisplayPanels);
    assert.equal(new Set(actual.panelIds).size, source.expectedPanels.length);
    assert.deepEqual(actual.groupPanelIds, source.expectedGroups);
    assert.equal(actual.evidenceBlockCount, source.expectedGroups.length);
    assert.equal(actual.emptyBlockCount, 0);
    assert.equal(actual.emptyPanelFoldCount, 0);
    assert.deepEqual(actual.upstreamRowsByBlock,
      Array(source.expectedGroups.length).fill(1));
    assert.equal(actual.downstreamCount, 0);
    assert.equal(actual.transitionCardCount, 0);
    assert.deepEqual(actual.orphanPanelIds, []);
  }
  report.checks.push('all 37 Figure-scoped Panel identities render exactly once in canonical group order');
  report.checks.push('visible group membership exactly matches both normalized synthesis partitions');
  report.checks.push('no empty, bridge, transition, downstream, or orphan evidence cards render');
  report.checks.push('every visible evidence block contains exactly one upstream field');

  for (const source of sources.figures) {
    const card = page.locator(
      `.workspace-figure-card[data-figure-id="${source.figureId}"]`
    );
    const upstream = card.locator(
      'details.workspace-evidence-block [data-field="upstreamContext"] ' +
      '.workspace-figure-edit-target'
    ).first();
    await upstream.dblclick();
    const editor = page.locator('.workspace-figure-inline-editor');
    await editor.waitFor({ state: 'visible' });
    assert.equal(await editor.inputValue(),
      String(source.result.panelGroups[0].upstreamContext || ''));
    await editor.press('Escape');
    await page.locator('.workspace-figure-inline-editor').waitFor({ state: 'detached' });
  }
  report.checks.push('the editor receives the actual first-group upstream value after reload');

  const firstSource = sources.figures[0];
  const secondSource = sources.figures[1];
  const firstGroup = page.locator(
    `.workspace-figure-card[data-figure-id="${firstSource.figureId}"] ` +
    'details.workspace-evidence-block'
  ).first();
  const firstPanels = firstGroup.locator('details.workspace-evidence-panels');
  const firstPanel = firstPanels.locator('.workspace-figure-panel-card').first();
  await firstPanels.evaluate(node => { node.open = false; });
  assert.equal(await firstPanel.isVisible(), false);
  await firstGroup.evaluate(node => { node.open = false; });
  assert.equal(await firstPanel.isVisible(), false);
  const navigated = await page.evaluate(({ figureId, panelId }) =>
    navigateFigureQuickAnchor(figureId, panelId), {
    figureId: firstSource.figureId, panelId: firstSource.expectedPanels[0]
  });
  assert.equal(navigated, true);
  await page.waitForTimeout(350);
  const navigation = await page.evaluate(({ figureId, panelId }) => {
    const panel = document.querySelector(
      `.workspace-figure-panel-card[data-figure-id="${figureId}"]` +
      `[data-panel-id="${panelId}"]`
    );
    return {
      blockOpen: panel?.closest('details.workspace-evidence-block')?.open === true,
      panelsOpen: panel?.closest('details.workspace-evidence-panels')?.open === true,
      panelOpen: panel?.open === true,
      focused: document.activeElement === panel?.querySelector('summary')
    };
  }, { figureId: firstSource.figureId, panelId: firstSource.expectedPanels[0] });
  assert.deepEqual(navigation, {
    blockOpen: true, panelsOpen: true, panelOpen: true, focused: true
  });
  report.metrics.directNavigation = navigation;
  report.checks.push('nested Panel folds collapse and direct navigation reopens every ancestor');

  await page.evaluate(() => {
    document.querySelectorAll('.workspace-figure-card').forEach(card => { card.open = true; });
    const view = document.querySelector('[data-workspace-view="figures"]');
    if (view) view.scrollTop = 0;
  });
  const shotFigure1 = path.join(output, '01-first-figure-group-360.png');
  await page.locator(
    `.workspace-figure-card[data-figure-id="${firstSource.figureId}"] ` +
    'details.workspace-evidence-block'
  ).first().screenshot({ path: shotFigure1 });
  addScreenshot(shotFigure1);
  const shotFigure2 = path.join(output, '02-second-figure-group-360.png');
  await page.locator(
    `.workspace-figure-card[data-figure-id="${secondSource.figureId}"] ` +
    'details.workspace-evidence-block'
  ).first().screenshot({ path: shotFigure2 });
  addScreenshot(shotFigure2);

  await page.setViewportSize({ width: 720, height: 900 });
  const wide = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    cardWidths: [...document.querySelectorAll('.workspace-figure-card')]
      .map(card => card.getBoundingClientRect().width),
    totalPanelCards: document.querySelectorAll(
      '.workspace-figure-card[data-figure-id] .workspace-figure-panel-card'
    ).length
  }));
  assert.equal(wide.horizontalOverflow, false);
  assert.equal(wide.totalPanelCards, 37);
  assert.equal(wide.cardWidths.every(width => width > 500), true);
  report.metrics.layout720 = wide;
  report.checks.push('360px and 720px production layouts have no horizontal overflow');
  const wideShot = path.join(output, '03-first-figure-group-720.png');
  await page.locator(
    `.workspace-figure-card[data-figure-id="${firstSource.figureId}"] ` +
    'details.workspace-evidence-block'
  ).first().screenshot({ path: wideShot });
  addScreenshot(wideShot);

  assert.deepEqual(pageErrors, []);
  assert.equal(report.externalRequests, 0);
  report.status = 'PASS';
} catch (error) {
  report.error = error.stack || error.message;
  process.exitCode = 1;
} finally {
  await context?.close();
  fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith('brevess-fresh-synthesis-layout-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  status: report.status,
  checks: report.checks.length,
  screenshots: report.screenshots.length,
  totalPanels: report.metrics.structure360?.totalPanelCards || 0,
  externalRequests: report.externalRequests,
  modelApiCalls: report.modelApiCalls,
  error: report.error
}));
