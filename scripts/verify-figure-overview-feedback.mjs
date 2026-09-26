// UI-005: real popup/renderers/edit lifecycle; synthetic transport, zero API.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-ui005');
const phase = process.env.UI005_PHASE === 'before' ? 'before' : 'after';
const run = path.join(output, `${phase}-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(output, 'runtime-'));
const extension = path.join(temporary, 'extension');
const report = { status: 'FAIL', phase, checks: [], screenshots: [], hashes: {},
  boundary: 'real popup + core normalization/edit lifecycle; synthetic article RPC, no real provider',
  modelApiCalls: 0, blockedRequests: [], errors: [], cleanup: false };
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let context, page;
async function shot(name) {
  await page.screenshot({ path: path.join(run, `${name}.png`) });
  report.screenshots.push(`${name}.png`);
}
try {
  fs.mkdirSync(extension);
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  for (const name of fs.readdirSync(root)) {
    if (/\.(js|mjs|html|css)$/.test(name) || name === 'manifest.json') fs.copyFileSync(path.join(root, name), path.join(extension, name));
  }
  for (const name of ['popup.js', 'popup.css', 'ui-swiss.css']) report.hashes[name] = hash(path.join(extension, name));
  fs.writeFileSync(path.join(extension, 'ui005-source.html'), '<!doctype html><meta charset="utf-8"><title>UI-005 source fixture</title>' +
    '<p style="height:1000px">Isolated article fixture</p><h2 id="figure-1">HTML Figure 1</h2><p style="height:500px"></p><h2 id="figure-2">PDF page 4 fixture target</h2><p style="height:800px"></p>');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce', viewport: { width: 520, height: 880 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking']
  });
  await context.route(/^https?:\/\//, route => { report.blockedRequests.push(route.request().url()); return route.abort(); });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw new Error('UI005_NETWORK_FORBIDDEN'); }; });
  const id = new URL(worker.url()).host;
  const source = await context.newPage();
  await source.goto(`chrome-extension://${id}/ui005-source.html`);
  page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.exposeFunction('ui005Focus', target => source.evaluate(target => {
    const node = document.getElementById(target.figureId);
    if (!node) return false;
    node.scrollIntoView(); node.dataset.focused = 'true'; return true;
  }, target));
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.waitForFunction(() => panelUiReady === true);
  const installFixture = async (saved = null) => page.evaluate(({ id, saved }) => {
    panelUiReady = false;
    tabContextRequestSequence += 1;
    clearTimeout(tabContextSyncTimer);
    activePanelTabContext = { tabId: 905, url: 'https://ui005.invalid/a', key: 'ui005:a',
      activated: true, pdfMode: false, tabContextSequence: 1 };
    document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
    hasUsableLlm = () => true;
    queryPanelTargetTab = async () => ({ id: 905, url: 'https://ui005.invalid/a', title: 'UI005' });
    const result = { analysisDepth: 'standard', basis: 'caption_context',
      figureQuestion: 'RTX 模型是否改变毛囊表型，死亡发生在哪类细胞？',
      coreConclusion: '观察到表型变化，但不能直接推断因果通路。',
      claimBoundary: '仅检验 RTX 模型，未验证其他应激；aCAS3 与 H&E 未直接证明死亡通路；未标注的比较不能推断显著。',
      authorAssembly: '先以示意图(A)引入模型，再用(B)确立表型，接着用(C)描绘时间进程，最后用(D)定位细胞。',
      remainingQuestion: '', panelCoverage: { expectedPanels: ['A', 'B'], returnedPanels: ['A'], missingPanels: ['B'] },
      panelGroups: [{ panels: ['A'], groupGoal: '观察表型', groupConclusion: '只支持相关。' }],
      panels: [{ panel: 'A', purpose: '观察表型', directObservation: '表型变化', methods: ['定量成像'], contribution: '建立后续问题' }] };
    const base = { hasImage: true, panelHints: ['A', 'B'], activeDepth: 'standard', standard: result,
      expanded: true, deep: null, deepLoading: false, panelAnalyses: {}, panelFollowups: {},
      panelFollowupLoading: {}, panelFollowupErrors: {}, panelAnalysisLoading: {} };
    const figures = [
      { ...base, figureId: 'figure-1', figureLabel: 'Figure 1', sourceKind: 'html-figure' },
      { ...base, figureId: 'figure-2', figureLabel: 'Figure 2', sourceKind: 'pdf-page-caption', sourcePage: 4, hasImage: false, needsReview: true },
      { ...base, figureId: 'supp-s1', figureLabel: 'Figure S1', sourceExternal: true, isSupplemental: true,
        sourceUrl: `chrome-extension://${id}/ui005-source.html#external`, sourcePage: 7, sourceMaterialId: 'manual-fixture' }
    ];
    let draft = SciLLM.createFigureWorkspaceDraft(figures);
    for (const figure of figures) draft = SciLLM.mergeModelIntoFigureWorkspaceDraft(draft, figure, result);
    figureAnalysisState = { running: false, phase: 'completed', figureProgress: [], totalFigures: 3, completedFigures: 3 };
    currentWorkspaceSnapshot = { url: 'https://ui005.invalid/a', documentId: 'ui005-doc-a', documentHash: 'ui005-hash-a',
      title: 'UI-005 · 隔离界面验收', revision: 1, diagnostics: {},
      localWorkspace: { workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1,
        canonicalUrl: 'https://ui005.invalid/a', contentHash: 'b'.repeat(64) },
      figures: { figures, draft, status: figureAnalysisState, workspaceLifecycle: 1 }, figureWorkspaceDraft: draft };
    if (saved?.snapshot) currentWorkspaceSnapshot = saved.snapshot;
    const fixture = window.ui005 = { calls: [], savedUi: null, saveMode: 'normal', baseline: structuredClone(currentWorkspaceSnapshot) };
    sendTabMessage = async (_tab, message) => {
      fixture.calls.push(structuredClone(message));
      if (message.action === 'saveArticleWorkspaceUiState') { fixture.savedUi = structuredClone(message.uiState); return { success: true }; }
      if (message.action === 'focusArticleWorkspaceSource') return { success: true, focused: await window.ui005Focus(message.target) };
      if (message.action === 'showFigureOriginalImage') return { success: true, figureId: message.figureId, mode: message.figureId === 'figure-2' ? 'pdf-page' : 'image' };
      if (message.action === 'getArticleWorkspaceSnapshot') return { success: true, snapshot: structuredClone(currentWorkspaceSnapshot) };
      if (message.action === 'getFigureAnalysisStatus') return { success: true, status: structuredClone(figureAnalysisState) };
      if (message.action === 'getArticleArchiveSnapshot') return { success: false, error: 'UI005_NO_REAL_ARCHIVE' };
      if (message.action === 'updateFigureWorkspaceDraft') {
        if (fixture.saveMode === 'error') return { success: false, error: 'UI005 simulated save failure' };
        if (fixture.saveMode === 'hold') await new Promise(resolve => { fixture.releaseSave = resolve; });
        const next = SciLLM.applyFigureWorkspaceMutation(currentWorkspaceSnapshot.figures.draft, message.mutation);
        return { success: true, draft: next };
      }
      if (message.action === 'flushFigureWorkspaceDraft') return { success: true };
      if (message.action === 'analyzeSingleFigureWithLLM') {
        fixture.analysisRequested = message.figureId;
        await new Promise(resolve => { fixture.releaseAnalysis = resolve; });
        return { success: false, error: 'UI005 simulated provider failure' };
      }
      return { success: false, error: `UI005 unsupported isolated RPC ${message.action}` };
    };
    // Keep the real inline-edit lifecycle and core mutations; replace only transport.
    SciLLM.sendTabMessageWithRecovery = (_chrome, tab, message) => sendTabMessage(tab, message);
    figures.forEach(figure => figureExpansionState.set(figure.figureId, true));
    switchWorkspaceView('figures', { persist: false });
    if (saved?.ui) applyRestoredSidePanelUiState(saved.ui);
    renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot);
  }, { id, saved });
  await installFixture();
  const card = page.locator('.workspace-figure-card[data-figure-id="figure-1"]');
  await card.waitFor();
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 880 });
    await card.locator('.workspace-figure-actions').scrollIntoViewIfNeeded();
    const metrics = await card.evaluate(el => {
      const buttons = [...el.querySelector('.workspace-figure-actions').children].slice(0, 3);
      const overview = el.querySelector('.workspace-figure-overview');
      return { names: buttons.map(b => b.textContent), top: buttons.map(b => b.getBoundingClientRect().top),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        collapsed: overview?.tagName === 'DETAILS' && !overview.open,
        warningOutsideOverview: [...el.querySelectorAll('.workspace-figure-coverage.is-incomplete')].some(w => !overview.contains(w)) };
    });
    check(`${width}: three primary labels`, JSON.stringify(metrics.names) === JSON.stringify(['跳转', '原图', '解图']), metrics);
    check(`${width}: three primary actions on one row`, Math.max(...metrics.top) - Math.min(...metrics.top) < 2, metrics.top);
    check(`${width}: overview starts collapsed with warning outside`, metrics.collapsed && metrics.warningOutsideOverview);
    check(`${width}: no page overflow`, !metrics.overflow);
    await shot(`${width}-default`);
  }
  if (phase === 'after') {
    const overview = card.locator('.workspace-figure-overview');
    const summary = overview.locator(':scope > summary');
    const field = key => overview.locator(`[data-field="${key}"] .workspace-figure-edit-target`);
    const textarea = page.locator('.workspace-figure-inline-editor');
    const redraw = () => page.evaluate(() => renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot));
    await summary.click();
    await page.waitForFunction(() => [...figureOverviewExpansionState.values()].includes(true));
    check('boundary has three intact points', await field('claimBoundary').locator('li').count() === 3);
    check('assembly has four ordered points', await field('authorAssembly').locator('li').count() === 4);
    check('ordinary conclusion remains a scalar', await field('coreConclusion').locator('li').count() === 0);
    const baselineDraft = await page.evaluate(() => JSON.stringify(currentWorkspaceSnapshot.figures.draft));
    const sameTurnToggle = await page.evaluate(() => {
      const select = () => document.querySelector('.workspace-figure-card[data-figure-id="figure-1"] > .workspace-figure-overview');
      select().querySelector('summary').click();
      renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot);
      return select().open === false;
    });
    check('collapse choice survives a redraw before asynchronous toggle event', sameTurnToggle);
    if (!await overview.evaluate(el => el.open)) await summary.click();
    await page.waitForFunction(() => [...figureOverviewExpansionState.values()].includes(true));
    await redraw();
    check('ordinary redraw preserves open overview', await overview.evaluate(el => el.open));
    check('Figure 2 expansion is independent', await page.locator('[data-figure-id="figure-2"] > .workspace-figure-overview').evaluate(el => !el.open));
    check('display projection does not mutate the stored draft', baselineDraft === await page.evaluate(() => JSON.stringify(currentWorkspaceSnapshot.figures.draft)));
    for (const width of [320, 360, 520]) {
      await page.setViewportSize({ width, height: 880 });
      await summary.scrollIntoViewIfNeeded();
      await summary.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      check(`${width}: keyboard focus visible`, await summary.evaluate(el => {
        const style = getComputedStyle(el); return document.activeElement === el && style.outlineStyle !== 'none';
      }));
      check(`${width}: expanded overview has no horizontal overflow`, await overview.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await shot(`${width}-overview-open-focus`);
    }
    await page.setViewportSize({ width: 360, height: 880 });
    await summary.focus();
    await page.keyboard.press('Enter');
    check('Enter toggles overview closed', await overview.evaluate(el => !el.open));
    await page.keyboard.press('Space');
    check('Space toggles overview open', await overview.evaluate(el => el.open));
    await field('claimBoundary').focus();
    await page.keyboard.press('Enter');
    await textarea.waitFor();
    const original = await textarea.inputValue();
    check('Enter edits original scalar, not generated bullets', /[;；]/.test(original) && !original.includes('\n') && original.startsWith('仅检验 RTX'), original);
    await textarea.fill('取消的修改，不应保存。');
    await textarea.press('Escape');
    await textarea.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.dataset.figureEditPath?.includes('claimBoundary'));
    check('Escape preserves original draft', baselineDraft === await page.evaluate(() => JSON.stringify(currentWorkspaceSnapshot.figures.draft)));
    check('Escape returns focus to field', await field('claimBoundary').evaluate(el => el === document.activeElement));
    await field('claimBoundary').dblclick();
    await textarea.waitFor();
    const edited = '人工核对：Panel A 未证明必要性；Panel B 仍待验证。';
    await textarea.fill(edited);
    await page.evaluate(() => { ui005.saveMode = 'error'; });
    await textarea.press('Control+Enter');
    await page.waitForFunction(() => document.querySelector('[data-figure-edit-status]')?.dataset.state === 'error');
    check('failed save keeps input and visible retry message', await textarea.inputValue() === edited && await page.locator('[data-figure-edit-status]').isVisible());
    await shot('360-save-error-retained');
    // Closing the overview must not hide an unsaved draft or its failure.
    await summary.click();
    await page.waitForFunction(() => document.querySelector('[data-figure-id="figure-1"] > .workspace-figure-overview')?.open === true);
    check('collapse reopens on failed save without losing input', await textarea.isVisible() && await textarea.inputValue() === edited);
    await page.evaluate(() => { ui005.saveMode = 'hold'; });
    await textarea.press('Control+Enter');
    await page.waitForFunction(() => !!ui005.releaseSave);
    check('pending editor is read-only and aria-busy', await textarea.evaluate(el => el.readOnly && el.getAttribute('aria-busy') === 'true'));
    await shot('360-save-pending');
    await page.evaluate(() => { ui005.saveMode = 'normal'; ui005.releaseSave(); });
    await textarea.waitFor({ state: 'detached' });
    check('retry saves via real mutation and displays two points', await field('claimBoundary').locator('li').count() === 2 && (await field('claimBoundary').innerText()).includes('人工核对'));
    await field('claimBoundary').dblclick();
    check('saved manual scalar follows existing NFKC contract without bullet rewriting', await textarea.inputValue() === edited.normalize('NFKC'), await textarea.inputValue());
    await textarea.fill('');
    await textarea.press('Control+Enter');
    await textarea.waitFor({ state: 'detached' });
    check('explicit empty stays empty, not model fallback', await field('claimBoundary').locator('[data-figure-workspace-placeholder]').count() === 1);
    await redraw();
    check('empty survives normal redraw', await field('claimBoundary').locator('[data-figure-workspace-placeholder]').count() === 1);

    await field('remainingQuestion').dblclick();
    await textarea.fill('1. 尚未检验必要性\n2. 尚未检验充分性');
    await textarea.press('Control+Enter');
    await textarea.waitFor({ state: 'detached' });
    check('explicit numbered list survives core scalar normalization', await field('remainingQuestion').locator('li').count() === 2);
    await page.waitForFunction(() => ui005.savedUi?.figureOverviewExpansion?.some(entry => entry[1]));
    const saved = await page.evaluate(() => JSON.parse(JSON.stringify({ snapshot: currentWorkspaceSnapshot, ui: ui005.savedUi })));
    // Document separation tested with the same Figure IDs, not a new empty renderer.
    await page.evaluate(() => {
      currentWorkspaceSnapshot = { ...currentWorkspaceSnapshot, url: 'https://ui005.invalid/b', documentHash: 'hash-b',
        localWorkspace: { ...currentWorkspaceSnapshot.localWorkspace, workspaceId: `workspace:${'c'.repeat(64)}` } };
      renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot);
    });
    check('another document with same Figure ID starts collapsed', await overview.evaluate(el => !el.open));
    await page.reload();
    await page.waitForFunction(() => panelUiReady === true);
    await installFixture(saved);
    check('reload restores saved expansion through existing UI-state restore', await overview.evaluate(el => el.open));
    check('reload preserves manual empty and explicit list', await field('claimBoundary').locator('[data-figure-workspace-placeholder]').count() === 1 && await field('remainingQuestion').locator('li').count() === 2);
    await shot('360-reloaded-empty-and-list');
    await field('remainingQuestion').scrollIntoViewIfNeeded();
    await shot('360-reloaded-explicit-list');

    await summary.click();
    const block = card.locator('.workspace-evidence-block').first();
    check('collapsed evidence summary exposes contained Panel', (await block.locator(':scope > summary').innerText()).split('\n')[0] === '证据块1：A');
    await block.locator(':scope > summary').click();
    check('evidence opens directly to Panel cards with no intermediate details', await block.locator('[data-evidence-panels-body]').evaluate(el =>
      el.tagName !== 'DETAILS' && el.querySelector(':scope > .workspace-figure-panel-card') !== null));
    await block.locator('.workspace-figure-panel-card > summary').first().click();
    check('Panel fields visible after direct expansion', await block.locator('.workspace-figure-panel-card .workspace-figure-view-field').first().isVisible());
    await shot('360-evidence-direct-panel');
    await block.locator(':scope > summary').click();

    const primary = which => page.locator(`.workspace-figure-card[data-figure-id="${which}"] > .workspace-figure-actions`);
    await primary('figure-1').getByRole('button', { name: /跳转到/ }).click();
    check('HTML jump uses original figure target', await source.locator('#figure-1').getAttribute('data-focused') === 'true');
    await primary('figure-2').getByRole('button', { name: /跳转到/ }).click();
    check('PDF jump retains Figure 2 routing and page label', await source.locator('#figure-2').getAttribute('data-focused') === 'true' && /PDF 第 4 页/.test(await primary('figure-2').getByRole('button', { name: /跳转到/ }).getAttribute('title')));
    check('unavailable original image is disabled with explanation', await primary('figure-2').getByRole('button', { name: '当前未取得原图' }).isDisabled());
    await primary('figure-1').getByRole('button', { name: '查看 Figure 1 原图' }).click();
    await page.waitForFunction(() => ui005.calls.some(call => call.action === 'showFigureOriginalImage'));
    check('HTML original image dispatches correct Figure ID', await page.evaluate(() => ui005.calls.findLast(call => call.action === 'showFigureOriginalImage')?.figureId === 'figure-1'));
    const externalTabPromise = context.waitForEvent('page');
    await primary('supp-s1').getByRole('button', { name: /跳转到/ }).click();
    const externalTab = await externalTabPromise;
    await externalTab.waitForURL(/#external$/);
    check('external jump opens exact source URL in separate tab', externalTab.url() === `chrome-extension://${id}/ui005-source.html#external`);
    await externalTab.close();
    await page.bringToFront();
    const external = page.locator('.workspace-figure-card[data-figure-id="supp-s1"]');
    for (const width of [320, 360, 520]) {
      await page.setViewportSize({ width, height: 880 });
      await external.locator('.workspace-figure-actions').scrollIntoViewIfNeeded();
      check(`${width}: external primary/secondary separate rows`, await external.evaluate(el => {
        const main = [...el.querySelector('.workspace-figure-actions').children].map(b => b.getBoundingClientRect());
        const secondary = el.querySelector('.workspace-figure-secondary-actions').getBoundingClientRect();
        return main.length === 3 && Math.max(...main.map(r => r.top)) - Math.min(...main.map(r => r.top)) < 2 && secondary.top >= main[0].bottom;
      }));
      check(`${width}: moved placement control stays aligned and square`, await external.evaluate(el => {
        const main = el.querySelector('.workspace-figure-actions').getBoundingClientRect();
        const menu = el.querySelector('.workspace-supplemental-placement-menu');
        return Math.abs(menu.getBoundingClientRect().left - main.left) < 1 && getComputedStyle(menu).borderRadius === '0px';
      }));
      await shot(`${width}-external-actions`);
    }
    // Synthetic progress exercises production busy projection, without a live provider.
    await page.evaluate(() => { currentWorkspaceSnapshot.figures.figures[2].deepLoading = true; renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot); });
    for (const width of [320, 360, 520]) {
      await page.setViewportSize({ width, height: 880 });
      await primary('supp-s1').scrollIntoViewIfNeeded();
      check(`${width}: busy main action and secondary disabled`, await external.evaluate(el => {
        const button = el.querySelector('.workspace-figure-analyze-action');
        return button.disabled && button.getAttribute('aria-busy') === 'true' && [...el.querySelectorAll('.workspace-figure-secondary-actions button')].every(b => b.disabled);
      }));
      check(`${width}: busy controls stay in one row`, await primary('supp-s1').evaluate(el => {
        const tops = [...el.children].map(b => b.getBoundingClientRect().top); return Math.max(...tops) - Math.min(...tops) < 2;
      }));
      await shot(`${width}-busy`);
    }
    await page.evaluate(() => {
      figureAnalysisState = { running: true, phase: 'analyzing', figureProgress: [{ figureId: 'supp-s1', running: true,
        savedPanelCount: 6, expectedPanelCount: 8, validatedPanelCount: 7, unresolvedPanels: [] }] };
      renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot);
    });
    for (const width of [320, 360, 520]) {
      await page.setViewportSize({ width, height: 880 });
      await primary('supp-s1').scrollIntoViewIfNeeded();
      check(`${width}: counted progress stays readable on one row`, await primary('supp-s1').evaluate(el => {
        const buttons = [...el.children], tops = buttons.map(b => b.getBoundingClientRect().top);
        return Math.max(...tops) - Math.min(...tops) < 2 && /已存 6\/8/.test(buttons[2].textContent) &&
          buttons.every(b => b.scrollWidth <= b.clientWidth + 1);
      }));
      await shot(`${width}-counted-progress`);
    }
    await page.evaluate(() => {
      currentWorkspaceSnapshot.figures.figures[2].deepLoading = false;
      figureAnalysisState = currentWorkspaceSnapshot.figures.status;
      renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot);
    });
    check('busy clears without losing enabled actions', !await primary('supp-s1').locator('.workspace-figure-analyze-action').isDisabled());
    await external.locator('.workspace-figure-source-edit-action').click();
    check('secondary edit still opens its existing dialog', await page.locator('#supplementalFigureImportDialog').isVisible());
    await page.keyboard.press('Escape');
    const callsBeforeDelete = await page.evaluate(() => ui005.calls.length);
    page.once('dialog', dialog => dialog.dismiss());
    await external.locator('.workspace-figure-delete-action').click();
    check('secondary delete cancel sends no deletion', await page.evaluate(start => !ui005.calls.slice(start).some(call => /delete/i.test(call.action)), callsBeforeDelete));
    await external.locator('.workspace-supplemental-placement-menu > summary').click();
    check('moved placement menu still opens with bounded down control', await external.getByRole('button', { name: '下移', exact: true }).isDisabled() && await external.getByRole('button', { name: '上移', exact: true }).isVisible());
    await external.locator('.workspace-supplemental-placement-menu > summary').click();
    const pagesBeforeAnalysis = context.pages().length;
    await primary('supp-s1').locator('.workspace-figure-analyze-action').click();
    await page.waitForFunction(() => !!ui005.releaseAnalysis);
    check('external analyze dispatches original Figure ID without a new tab', await page.evaluate(() => ui005.analysisRequested === 'supp-s1') && context.pages().length === pagesBeforeAnalysis);
    await page.evaluate(() => ui005.releaseAnalysis());
    await page.waitForFunction(() => ui005.calls.some(call => call.action === 'getArticleArchiveSnapshot'));
    for (const view of ['navigation', 'highlights', 'figures', 'chat', 'notes']) {
      await page.evaluate(view => switchWorkspaceView(view, { persist: false, loadNotes: false }), view);
      check(`bottom navigation selects ${view}`, await page.locator(`[data-workspace-target="${view}"]`).getAttribute('aria-selected') === 'true');
    }
  }
  check('no browser exceptions', report.errors.length === 0, report.errors);
  report.status = report.checks.every(c => c.pass) ? 'PASS' : 'FAIL';
} catch (error) {
  report.error = error.stack || String(error);
  console.error(report.error);
  if (page && !page.isClosed()) await shot('failure').catch(() => {});
} finally {
  await context?.close();
  const validated = path.resolve(temporary);
  if (path.dirname(validated) === path.resolve(output) && /^runtime-/.test(path.basename(validated))) {
    fs.rmSync(validated, { recursive: true, force: true }); report.cleanup = true;
  }
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  fs.writeFileSync(path.join(run, 'report.html'), '<!doctype html><meta charset="utf-8"><title>UI-005</title>' +
    `<h1>UI-005 ${phase}: ${report.status}</h1><p>${escape(report.boundary)}</p>` +
    report.checks.map(c => `<p>${c.pass ? 'PASS' : 'FAIL'} ${escape(c.name)}</p>`).join('') +
    report.screenshots.map(file => `<h2>${file}</h2><img style="max-width:100%" src="${file}">`).join(''));
  console.log(`EVIDENCE ${run}`);
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
