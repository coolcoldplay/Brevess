// FIG-004: isolated real extension UI; synthetic scientific content and transport.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-fig004');
const phase = process.env.FIG004_PHASE === 'before' ? 'before' : 'after';
const run = path.join(output, `${phase}-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(output, 'runtime-'));
const extension = path.join(temporary, 'extension');
const report = { status: 'FAIL', phase, checks: [], screenshots: [], hashes: {}, errors: [],
  realModelCalls: 0, boundary: 'real popup/core mutation; synthetic S3-S7 result fixtures and RPC; isolated browser-local roundtrip, not real scientific validation' };
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
let context, page;
const shot = async name => { await page.screenshot({ path: path.join(run, `${name}.png`) }); report.screenshots.push(`${name}.png`); };
try {
  fs.mkdirSync(extension);
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  for (const name of fs.readdirSync(root)) if (/\.(js|mjs|html|css)$/.test(name) || name === 'manifest.json') fs.copyFileSync(path.join(root, name), path.join(extension, name));
  if (phase === 'before') for (const file of ['popup.js', 'popup.css', 'ui-swiss.css']) fs.copyFileSync(path.join(output, 'before-snapshot', file), path.join(extension, file));
  for (const file of ['popup.js', 'popup.css', 'ui-swiss.css', 'core/figure-extractor.js', 'core/figure-workspace.js']) report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, file))).digest('hex');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true,
    viewport: { width: 520, height: 880 }, reducedMotion: 'reduce', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking'] });
  await context.route(/^https?:\/\//, route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw new Error('FIG004_NO_NETWORK'); }; });
  const id = new URL(worker.url()).host;
  page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`chrome-extension://${id}/popup.html`);
  const setup = async () => {
    await page.waitForFunction(() => panelUiReady === true);
    await page.evaluate(async () => {
      panelUiReady = false; tabContextRequestSequence++; clearTimeout(tabContextSyncTimer);
      activePanelTabContext = { tabId: 904, url: 'https://fig004.invalid/article', key: 'fig004:a', activated: true, pdfMode: false, tabContextSequence: 1 };
      document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
      queryPanelTargetTab = async () => ({ id: 904, url: 'https://fig004.invalid/article', title: 'FIG004' });
      hasUsableLlm = () => true;
      const examples = [
        ['figure-s3', 'Figure S3', 'scRNA-seq showing metabolic changes in HF-TACs vs. HFSCs under stress, related to Figure 3', '比较应激条件下两类毛囊细胞的转录组与代谢变化。'],
        ['figure-s4', 'Figure S4', 'HF-TACs lose cell adhesion following acute stress, related Figure 4', '该图呈现急性应激后细胞黏附变化的证据。'],
        ['figure-s5', 'Figure S5', 'CD64-Cre is specific for macrophages, but macrophages do not drive stress-induced hair follicle necrosis, related to Figure 5', '比较巨噬细胞特异性和干预结果，未将相关性等同于坏死驱动作用。'],
        ['figure-s6', 'Figure S6', 'Type 1 DCs carry hair follicle debris to lymph nodes, related to Figure 6', '该图检验树突状细胞与毛囊碎片转运的关系。'],
        ['figure-s7', 'Figure S7', 'Autoreactive T cell activation is triggered by calcium-induced necrosis, related to Figure 7', '比较自反应T细胞激活条件，区分后续免疫反应与初始坏死。'],
        ['figure-1', 'Figure 1', 'Experimental workflow', ''],
        ['figure-2', 'Figure 2', 'English legacy result', 'English only legacy conclusion'],
        ['figure-s2', 'Figure S2', 'Long conclusion fixture', '中文证据🙂'.repeat(25) + '，但不支持充分性。']
      ];
      const figures = examples.map(([figureId, figureLabel, english, conclusion]) => ({ figureId, figureLabel,
        isSupplemental: figureId.includes('-s'), sourceKind: 'html-figure', hasImage: true, expanded: false, panelHints: ['A'],
        caption: `${figureLabel} ${english}Show full captionFigure viewer (A) Experimental schematic; not proof of causality.`,
        activeDepth: 'standard', deep: null, panelAnalyses: {}, panelFollowups: {}, panelFollowupLoading: {}, panelFollowupErrors: {},
        panelAnalysisLoading: {}, standard: { analysisDepth: 'standard', basis: 'caption_context', figureTitleZh: '',
          coreConclusion: conclusion, figureQuestion: figureId === 'figure-1' ? '给药与取样流程如何安排？' : '',
          authorAssembly: '', panels: [{ panel: 'A', purpose: '显示实验流程', directObservation: '时间线示意' }] } }));
      let draft = SciLLM.createFigureWorkspaceDraft(figures);
      for (const figure of figures) draft = SciLLM.mergeModelIntoFigureWorkspaceDraft(draft, figure, figure.standard);
      const saved = (await chrome.storage.local.get('fig004Snapshot')).fig004Snapshot;
      currentWorkspaceSnapshot = saved || { title: 'FIG-004 · 合成数据验收', url: 'https://fig004.invalid/article', documentId: 'fig004-document',
        documentHash: 'fig004-hash', revision: 1, diagnostics: {}, localWorkspace: { workspaceId: `workspace:${'4'.repeat(64)}`,
          workspaceGeneration: 1, canonicalUrl: 'https://fig004.invalid/article', contentHash: '4'.repeat(64) },
        figures: { figures, draft, workspaceLifecycle: 1 }, figureWorkspaceDraft: draft };
      figureAnalysisState = { running: false, phase: 'completed', figureProgress: [] };
      window.fig004 = { calls: [], saveMode: 'normal', figures: structuredClone(figures) };
      sendTabMessage = async (_tab, message) => {
        fig004.calls.push(structuredClone(message));
        if (message.action === 'updateFigureWorkspaceDraft') {
          if (fig004.saveMode === 'error') return { success: false, error: 'FIG004 simulated save failure' };
          const next = SciLLM.applyFigureWorkspaceMutation(currentWorkspaceSnapshot.figures.draft, message.mutation);
          const savedSnapshot = { ...currentWorkspaceSnapshot, figures: { ...currentWorkspaceSnapshot.figures, draft: next }, figureWorkspaceDraft: next };
          await chrome.storage.local.set({ fig004Snapshot: savedSnapshot });
          return { success: true, draft: next };
        }
        if (message.action === 'flushFigureWorkspaceDraft' || message.action === 'saveArticleWorkspaceUiState') return { success: true };
        if (message.action === 'getArticleWorkspaceSnapshot') return { success: true, snapshot: structuredClone(currentWorkspaceSnapshot) };
        if (message.action === 'getFigureAnalysisStatus') return { success: true, status: structuredClone(figureAnalysisState) };
        return { success: false, error: 'FIG004 controlled RPC boundary' };
      };
      SciLLM.sendTabMessageWithRecovery = (_chrome, tab, message) => sendTabMessage(tab, message);
      figures.forEach(figure => figureExpansionState.set(figure.figureId, false));
      switchWorkspaceView('figures', { persist: false });
      renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot);
    });
  };
  await setup();
  const card = name => page.locator(`.workspace-figure-card[data-figure-id="${name}"]`);
  const heading = name => card(name).locator(':scope > summary');
  for (const number of [3, 4, 5, 6, 7]) {
    const text = await heading(`figure-s${number}`).innerText();
    check(`S${number}: Chinese summary without publisher controls`, /[\u3400-\u9fff]/u.test(text) && !/Show|caption|viewer/.test(text), text);
  }
  check('method-only Figure has a question, not an invented outcome', /给药与取样流程如何安排/.test(await heading('figure-1').innerText()));
  check('English-only result honestly reports missing Chinese summary', /中文简要待补/.test(await heading('figure-2').innerText()));
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 880 });
    await heading('figure-s3').scrollIntoViewIfNeeded();
    check(`${width}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await shot(`${width}-summary-list`);
  }
  if (phase === 'after') {
    const long = card('figure-s2').locator('.workspace-figure-summary-conclusion');
    check('long header is display-bounded with full title available', Array.from(await long.innerText()).length <= 72 && (await long.getAttribute('title')).includes('但不支持充分性'));
    await heading('figure-s2').click();
    await card('figure-s2').locator('.workspace-figure-overview > summary').click();
    check('expanding overview exposes complete conclusion including limit', (await card('figure-s2').locator('[data-field="coreConclusion"]').innerText()).includes('但不支持充分性'));
    await card('figure-s2').locator('.workspace-figure-source-text > summary').click();
    const sourceText = await card('figure-s2').locator('.workspace-figure-source-text p').innerText();
    check('source caption remains available without glued controls', /Experimental schematic; not proof of causality/.test(sourceText) && !/Show|viewer/.test(sourceText));
    await card('figure-s2').locator('.workspace-figure-source-text').scrollIntoViewIfNeeded();
    await shot('520-complete-source');
    await page.setViewportSize({ width: 360, height: 880 });
    await heading('figure-s3').click();
    await card('figure-s3').locator('.workspace-figure-overview > summary').click();
    const target = () => card('figure-s3').locator('[data-field="coreConclusion"] .workspace-figure-edit-target');
    const editor = page.locator('.workspace-figure-inline-editor');
    await target().focus(); await page.keyboard.press('Enter'); await editor.waitFor();
    await editor.fill('人工修订：这里只支持相关性，不支持必要性。');
    await page.evaluate(() => { fig004.saveMode = 'error'; });
    await editor.press('Control+Enter');
    await page.waitForFunction(() => document.querySelector('[data-figure-edit-status]')?.dataset.state === 'error');
    check('failed title save preserves input and visible error', await editor.isVisible() && (await editor.inputValue()).startsWith('人工修订'));
    await shot('360-edit-error');
    await page.evaluate(() => { fig004.saveMode = 'normal'; });
    await editor.press('Control+Enter'); await editor.waitFor({ state: 'detached' });
    check('manual conclusion updates collapsed Figure header', /人工修订/.test(await heading('figure-s3').innerText()));
    await page.evaluate(() => {
      const figure = currentWorkspaceSnapshot.figures.figures[0];
      figure.deep = { ...figure.standard, analysisDepth: 'deep', coreConclusion: '模型深度新结果不能覆盖人工标题' };
      figure.activeDepth = 'deep'; renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot);
    });
    check('switching standard/deep never overwrites manual header', /人工修订/.test(await heading('figure-s3').innerText()));
    await target().dblclick(); await editor.waitFor(); await editor.fill('');
    await editor.press('Control+Enter'); await editor.waitFor({ state: 'detached' });
    check('explicit blank shows cleared status without raw-result fallback', /简要已清空/.test(await heading('figure-s3').innerText()) && !/模型|人工修订/.test(await heading('figure-s3').innerText()));
    check('display never rewrites source captions/model responses', await page.evaluate(() => currentWorkspaceSnapshot.figures.figures[0].caption === fig004.figures[0].caption &&
      currentWorkspaceSnapshot.figures.figures[0].standard.coreConclusion === fig004.figures[0].standard.coreConclusion));
    await heading('figure-s3').scrollIntoViewIfNeeded(); await shot('360-title-cleared');
    await page.reload(); await setup();
    check('browser-local save/reload preserves reviewed blank', /简要已清空/.test(await heading('figure-s3').innerText()));
    check('rendering never sends a model request', await page.evaluate(() => !fig004.calls.some(call => /analyze|generate/i.test(call.action))));
    for (const view of ['navigation', 'highlights', 'figures', 'chat', 'notes']) {
      await page.evaluate(view => switchWorkspaceView(view, { persist: false, loadNotes: false }), view);
      check(`bottom navigation ${view} preserved`, await page.locator(`[data-workspace-target="${view}"]`).getAttribute('aria-selected') === 'true');
    }
  }
  check('no page errors', report.errors.length === 0, report.errors);
  report.status = report.checks.every(item => item.pass) ? 'PASS' : 'FAIL';
} catch (error) {
  report.error = String(error.stack || error); console.error(report.error);
  if (page && !page.isClosed()) await shot('failure').catch(() => {});
} finally {
  await context?.close();
  if (path.dirname(path.resolve(temporary)) === path.resolve(output) && /^runtime-/.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  fs.writeFileSync(path.join(run, 'report.html'), `<!doctype html><meta charset="utf-8"><title>FIG-004</title><h1>FIG-004 ${phase} ${report.status}</h1><p>${escape(report.boundary)}</p>` +
    report.checks.map(item => `<p>${item.pass ? 'PASS' : 'FAIL'} ${escape(item.name)}</p>`).join('') +
    report.screenshots.map(file => `<h2>${file}</h2><img src="${file}" style="max-width:100%">`).join(''));
  console.log(`EVIDENCE ${run}`); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
