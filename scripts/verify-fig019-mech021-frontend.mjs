import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const resourceDirectories = ['core', 'providers', 'vendor', 'icons', '_locales'];
// Only runtime resources may come from a package; dependencies and evidence stay in root.
function resolveExtensionSourceRoot() {
  const configured = process.env.SCI_EXTENSION_ROOT;
  try {
    if (configured !== undefined && !configured.trim()) throw Error('SCI_EXTENSION_ROOT is empty');
    const selected = fs.realpathSync(path.resolve(configured ?? root));
    for (const dir of resourceDirectories) if (!fs.statSync(path.join(selected, dir)).isDirectory()) throw Error('Missing runtime directory: ' + dir);
    for (const file of ['manifest.json', 'background.js', 'popup.html', 'popup.js', 'popup.css', 'ui-swiss.css', 'content.js', 'content.css']) {
      if (!fs.statSync(path.join(selected, file)).isFile()) throw Error('Missing runtime file: ' + file);
    }
    if (JSON.parse(fs.readFileSync(path.join(selected, 'manifest.json'), 'utf8')).manifest_version !== 3) throw Error('Expected Manifest V3');
    return selected;
  } catch (error) {
    throw Error('VERIFIER_EXTENSION_ROOT_INVALID: ' + String(configured ?? root) + ': ' + error.message);
  }
}
function runtimeResourceHashes(source) {
  const files = fs.readdirSync(source).filter(file => /\.(js|mjs|html|css)$/.test(file) || file === 'manifest.json');
  const visit = relative => {
    for (const item of fs.readdirSync(path.join(source, relative), { withFileTypes: true })) {
      const file = path.join(relative, item.name);
      if (item.isDirectory()) visit(file); else files.push(file);
    }
  };
  for (const dir of resourceDirectories) visit(dir);
  return Object.fromEntries(files.map(file => file.replaceAll('\\', '/')).sort().map(file =>
    [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(source, file))).digest('hex')]));
}
const extensionSourceRoot = resolveExtensionSourceRoot();
const run = path.join(root, 'output/playwright/frontend-feedback-20260925/fig019-mech021', `run-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-fig019-'));
const extension = path.join(temporary, 'extension');
const report = { repositoryRoot: root, extensionSourceRoot, preCopySourceHashes: {}, copiedResourceHashes: {}, checks: [], screenshots: [], errors: [], hashes: {}, boundary: 'Real popup and core Figure drafts/renderers. Synthetic titles and generation request spy; no scientific quality claim or actual model calls, no personal data.' };
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); assert.ok(pass, name); console.log('PASS ' + name); };
let context, page;
async function shot(name) { const cdp = await context.newCDPSession(page); const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(run, name + '.png'), Buffer.from(r.data, 'base64')); await cdp.detach(); report.screenshots.push(name + '.png'); }
try {
  report.preCopySourceHashes = runtimeResourceHashes(extensionSourceRoot);
  fs.mkdirSync(extension);
  for (const dir of resourceDirectories) fs.cpSync(path.join(extensionSourceRoot, dir), path.join(extension, dir), { recursive: true });
  for (const f of fs.readdirSync(extensionSourceRoot)) if (/\.(js|mjs|html|css)$/.test(f) || f === 'manifest.json') fs.copyFileSync(path.join(extensionSourceRoot, f), path.join(extension, f));
  report.copiedResourceHashes = runtimeResourceHashes(extension);
  if (JSON.stringify(report.preCopySourceHashes) !== JSON.stringify(report.copiedResourceHashes)) throw Error('VERIFIER_RESOURCE_COPY_MISMATCH');
  for (const f of ['popup.js', 'popup.html', 'popup.css', 'ui-swiss.css', 'core/i18n.js']) report.hashes[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, f))).digest('hex');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true, reducedMotion: 'reduce', viewport: { width: 360, height: 950 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'] });
  await context.route(/^https?:\/\//, route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw Error('NO_NETWORK_FIG019'); }; });
  page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`); await page.waitForFunction(() => panelUiReady === true);
  await page.evaluate(() => {
    // This fixture has no real article tab. Invalidate the initial asynchronous
    // tab lookup, and keep subsequent binding refreshes inside that boundary.
    tabContextRequestSequence += 1;
    clearTimeout(tabContextSyncTimer);
    synchronizeActiveTabContext = async () => false;
    activePanelTabContext = { tabId: 905, url: 'https://fixture.invalid/a', key: 'figure-title-fixture', activated: true, pdfMode: false, tabContextSequence: 1 };
    document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
    window.frontendFixture = { calls: [], title: '本图支持当前干预条件下的表型变化，相关观察提供后续验证线索。'.repeat(4) + '但未证明必要性或充分性。', block: '对照实验界定处理组的表型改变，并为后续检验提供依据；该结论限于当前细胞与取样时点。'.repeat(3) + '不能外推至未检验的组织。' };
    const result = { analysisDepth: 'standard', basis: 'caption_context', figureQuestion: '当前实验能说明什么？', coreConclusion: frontendFixture.title, claimBoundary: '仅测试当前条件。', authorAssembly: '先描述再检验。', panelGroups: [{ panels: ['A', 'B'], groupGoal: '检验表型', groupConclusion: frontendFixture.block }], panels: ['A', 'B'].map(panel => ({ panel, purpose: '检验表型', directObservation: '受控测试内容', methods: ['成像'], contribution: '界定范围' })) };
    const figure = { figureId: 'figure-1', figureLabel: 'Figure 1', sourceKind: 'html-figure', hasImage: false, panelHints: ['A', 'B'], activeDepth: 'standard', standard: result, deep: null, expanded: true, panelAnalyses: {}, panelFollowups: {} };
    let draft = SciLLM.createFigureWorkspaceDraft([figure]); draft = SciLLM.mergeModelIntoFigureWorkspaceDraft(draft, figure, result);
    currentWorkspaceSnapshot = { url: 'https://fixture.invalid/a', documentId: 'fixture-document', documentHash: 'a'.repeat(64), title: '前端显示验收 · 非论文结果', revision: 1, diagnostics: {}, localWorkspace: { workspaceId: 'workspace:' + 'a'.repeat(64), workspaceGeneration: 1, canonicalUrl: 'https://fixture.invalid/a', contentHash: 'a'.repeat(64) }, figures: { figures: [figure], draft, workspaceLifecycle: 1 }, figureWorkspaceDraft: draft };
    figureAnalysisState = { running: false, phase: 'completed', totalFigures: 1, completedFigures: 1 };
    sendTabMessage = async (_tab, message) => message.action === 'getArticleWorkspaceSnapshot' ? { success: true, snapshot: structuredClone(currentWorkspaceSnapshot) } : { success: true };
    runCrossFigureLogic = async options => { frontendFixture.calls.push(options); await new Promise(resolve => { frontendFixture.release = resolve; }); };
    figureExpansionState.set('figure-1', true);
    switchWorkspaceView('figures', { persist: false }); renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot);
  });
  const card = page.locator('.workspace-figure-card[data-figure-id="figure-1"]');
  const title = card.locator('.workspace-figure-summary-conclusion');
  const block = card.locator('.workspace-evidence-block').first();
  check('whole Figure title exactly retains the full saved conclusion', await title.innerText() === await page.evaluate(() => frontendFixture.title.normalize('NFKC')));
  check('evidence-block title retains its full groupConclusion', await block.locator('.workspace-evidence-block-description').innerText() === await page.evaluate(() => frontendFixture.block.normalize('NFKC')));
  check('collapsed evidence block still names its Panels', !await block.evaluate(n => n.open) && /AB/.test(await block.locator(':scope > summary').innerText()));
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 950 }); await title.scrollIntoViewIfNeeded();
    check(`${width}: title is wrapped without clipping or page overflow`, await title.evaluate(n => n.scrollHeight <= n.clientHeight + 1 && n.scrollWidth <= n.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1));
    await shot(`figure-title-${width}`);
    await block.locator(':scope > summary').scrollIntoViewIfNeeded();
    check(`${width}: block heading fits completely without line clamp`, await block.locator('.workspace-evidence-block-description').evaluate(n => n.scrollHeight <= n.clientHeight + 1 && n.scrollWidth <= n.clientWidth + 1 && getComputedStyle(n).webkitLineClamp === 'none'));
    await shot(`block-title-${width}`);
  }
  const entry = page.locator('.workspace-logic-map-card');
  await entry.scrollIntoViewIfNeeded();
  check('empty module has two distinct explicit actions and its new name', (await entry.locator('h3').innerText()) === '图表梳理' && JSON.stringify(await entry.locator('button').allTextContents()) === JSON.stringify(['手动绘制', 'AI生成']));
  await shot('mechanism-empty');
  await entry.getByRole('button', { name: '手动绘制', exact: true }).click();
  check('manual action opens local editable workspace without invoking AI', await page.locator('#workspace-mechanism').isVisible() && await page.locator('#addMechanismChainNode').isVisible() && await page.evaluate(() => frontendFixture.calls.length === 0));
  await page.locator('#backFromMechanismChain').click();
  await entry.getByRole('button', { name: 'AI生成', exact: true }).click();
  check('AI action is explicit and disables repeat clicks while pending', await page.evaluate(() => frontendFixture.calls.length === 1 && frontendFixture.calls[0].returnView === 'mechanism') && await entry.locator('[data-mechanism-generate]').isDisabled());
  await page.evaluate(() => frontendFixture.release());
  await page.waitForFunction(() => !document.querySelector('[data-mechanism-generate]').disabled);
  await page.evaluate(() => {
    currentWorkspaceSnapshot.figures.draft.mechanismChain = { initialized: true, nodes: [{ id: 'manual-a', label: '人工节点', x: 0, y: 0 }], edges: [] };
    renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
  });
  check('saved manual graph exposes edit and regenerate without changing its nodes', JSON.stringify(await entry.locator('button').allTextContents()) === JSON.stringify(['编辑修改', '重新生成']) && await page.evaluate(() => currentWorkspaceSnapshot.figures.draft.mechanismChain.nodes[0].label === '人工节点'));
  await entry.scrollIntoViewIfNeeded(); await shot('mechanism-existing');
  await entry.getByRole('button', { name: '编辑修改', exact: true }).click();
  check('editing an existing graph does not invoke another generation', await page.evaluate(() => frontendFixture.calls.length === 1));
  await page.locator('#backFromMechanismChain').click();
  const savedGraph = await page.evaluate(() => JSON.stringify(currentWorkspaceSnapshot.figures.draft.mechanismChain));
  await entry.getByRole('button', { name: '重新生成', exact: true }).click();
  check('regeneration routes to the same guarded pipeline without directly replacing manual nodes', await page.evaluate(before => frontendFixture.calls.length === 2 && frontendFixture.calls[1].seedMode === 'auto' && JSON.stringify(currentWorkspaceSnapshot.figures.draft.mechanismChain) === before, savedGraph));
  await page.evaluate(() => frontendFixture.release());
  await page.waitForFunction(() => !document.querySelector('[data-mechanism-generate]').disabled);
  check('generation entry recovery itself never mutates the saved graph', await page.evaluate(before => JSON.stringify(currentWorkspaceSnapshot.figures.draft.mechanismChain) === before, savedGraph));
  await page.evaluate(() => {
    currentWorkspaceSnapshot.figures.draft.mechanismChain = { initialized: false, nodes: [], edges: [] };
    currentWorkspaceSnapshot.figures.crossFigureLogic = { pendingResult: { status: 'needs_review', nodes: [], edges: [] } };
    renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
  });
  check('a saved candidate also counts as an existing result', JSON.stringify(await entry.locator('button').allTextContents()) === JSON.stringify(['编辑修改', '重新生成']));
  check('no browser page errors', report.errors.length === 0, report.errors);
  report.status = 'PASS';
} catch (e) { report.status = 'FAIL'; report.error = String(e.stack || e); console.error(report.error); if (page) await shot('failure').catch(() => {}); }
finally {
  await context?.close();
  if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) && /^brevess-fig019-/.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2)); console.log('EVIDENCE ' + run); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
