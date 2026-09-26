// Real isolated Edge extension + production rendering/edit controller/core mutations.
// Scientific content and RPC are synthetic; no model/network or daily browser data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-fig006');
const phase = process.env.FIG006_PHASE === 'before' ? 'before' : 'after';
const run = path.join(output, `${phase}-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const temporary = fs.mkdtempSync(path.join(output, 'runtime-'));
const extension = path.join(temporary, 'extension');
const report = { status: 'FAIL', phase, checks: [], screenshots: [], hashes: {}, errors: [], realModelCalls: 0,
  boundary: 'Real production popup, resolved view, edit controller and core mutation; synthetic scientific data/RPC, isolated browser-local save/reload. Not real paper/model validation.' };
const check = (name, pass, details) => { report.checks.push({ name, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
let context, page;
const shot = async name => { await page.screenshot({ path: path.join(run, `${name}.png`) }); report.screenshots.push(`${name}.png`); };
try {
  fs.mkdirSync(extension);
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  for (const name of fs.readdirSync(root)) if (/\.(js|mjs|html|css)$/.test(name) || name === 'manifest.json') fs.copyFileSync(path.join(root, name), path.join(extension, name));
  if (phase === 'before') for (const file of ['popup.js', 'popup.css', 'ui-swiss.css']) fs.copyFileSync(path.join(output, 'before-snapshot', file), path.join(extension, file));
  for (const file of ['popup.js', 'popup.css', 'ui-swiss.css', 'core/figure-workspace.js']) report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, file))).digest('hex');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, viewport: { width: 520, height: 920 }, reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking']
  });
  await context.route(/^https?:\/\//, route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw new Error('FIG006_NO_NETWORK'); }; });
  page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  const setup = async () => {
    await page.waitForFunction(() => panelUiReady === true);
    await page.evaluate(async () => {
      panelUiReady = false; tabContextRequestSequence++; clearTimeout(tabContextSyncTimer);
      activePanelTabContext = { tabId: 906, url: 'https://fig006.invalid/article', key: 'fig006:a', activated: true, pdfMode: false, tabContextSequence: 1 };
      document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
      queryPanelTargetTab = async () => ({ id: 906, url: 'https://fig006.invalid/article', title: 'FIG006' });
      hasUsableLlm = () => true;
      const result = { analysisDepth: 'standard', basis: 'caption_context', coreConclusion: '合成证据布局验收，不代表真实科学结论。',
        panelGroups: [
          { panels: ['A', 'C'], groupGoal: 'D2 观察毛发变化。', groupConclusion: 'D2 观察毛发变化。' },
          { panels: ['A1', 'A2'], groupGoal: '检验时间过程', groupConclusion: 'D4–D8 减少；D10 恢复，但不支持充分性。' }
        ],
        panels: [
          { panel: 'A', purpose: '给药与取样流程', directObservation: '时间线示意，不代表结果' },
          { panel: 'C', evidenceType: '观察证据', experimentalMethods: ['组织成像'], purpose: '观察毛囊变化' },
          { panel: 'A1', purpose: '', evidenceType: '' }, { panel: 'A2', purpose: '比较不同取样时间' }
        ] };
      const figure = { figureId: 'figure-1', figureLabel: 'Figure 1', caption: 'Figure 1 Synthetic workflow',
        activeDepth: 'standard', standard: result, deep: null, panelHints: ['A', 'C', 'A1', 'A2'], hasImage: true,
        panelAnalyses: {}, panelFollowups: {}, panelFollowupLoading: {}, panelFollowupErrors: {}, panelAnalysisLoading: {}, expanded: true };
      let draft = SciLLM.mergeModelIntoFigureWorkspaceDraft(SciLLM.createFigureWorkspaceDraft([figure]), figure, result);
      for (const [field, value] of [['upstreamContext', '人工承上：确认既有观察。第二句必须完整保留。'],
        ['established', 'D4–D8 减少；D10 恢复，但不支持充分性。'], ['evidenceLevel', '仅观察证据']]) {
        draft = SciLLM.applyFigureWorkspaceMutation(draft, { type: 'update_evidence_block',
          expectedRevision: draft.revision, figureId: 'figure-1', blockId: 'evidence-group-1', field, value });
      }
      const restored = (await chrome.storage.local.get('fig006Snapshot')).fig006Snapshot;
      currentWorkspaceSnapshot = restored || { title: 'FIG-006 · 合成数据验收', url: 'https://fig006.invalid/article', documentId: 'fig006-document',
        documentHash: 'fig006-hash', revision: 1, diagnostics: {}, localWorkspace: { workspaceId: `workspace:${'6'.repeat(64)}`,
          workspaceGeneration: 1, canonicalUrl: 'https://fig006.invalid/article', contentHash: '6'.repeat(64) },
        figures: { figures: [figure], draft, workspaceLifecycle: 1 }, figureWorkspaceDraft: draft };
      window.fig006 = { calls: [], saveMode: 'normal', initial: structuredClone(currentWorkspaceSnapshot) };
      sendTabMessage = async (_tab, message) => {
        fig006.calls.push(structuredClone(message));
        if (message.action === 'updateFigureWorkspaceDraft') {
          if (fig006.saveMode === 'error') return { success: false, error: 'FIG006 simulated save failure' };
          const next = SciLLM.applyFigureWorkspaceMutation(currentWorkspaceSnapshot.figures.draft, message.mutation);
          const saved = { ...currentWorkspaceSnapshot, figures: { ...currentWorkspaceSnapshot.figures, draft: next }, figureWorkspaceDraft: next };
          await chrome.storage.local.set({ fig006Snapshot: saved });
          return { success: true, draft: next };
        }
        if (['flushFigureWorkspaceDraft', 'saveArticleWorkspaceUiState'].includes(message.action)) return { success: true };
        if (message.action === 'getArticleWorkspaceSnapshot') return { success: true, snapshot: structuredClone(currentWorkspaceSnapshot) };
        if (message.action === 'getFigureAnalysisStatus') return { success: true, status: structuredClone(figureAnalysisState) };
        return { success: false, error: 'FIG006 controlled RPC boundary' };
      };
      SciLLM.sendTabMessageWithRecovery = (_chrome, tab, message) => sendTabMessage(tab, message);
      figureAnalysisState = { running: false, phase: 'completed', figureProgress: [] };
      figureExpansionState.set('figure-1', true);
      figureEvidenceExpansionState.clear();
      figurePanelHeaderFieldsState = { evidenceType: true, purpose: false, experimentalMethods: true,
        statisticalMethods: true, comparison: false, directObservation: false };
      switchWorkspaceView('figures', { persist: false }); renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot);
    });
  };
  await setup();
  const block = () => page.locator('.workspace-evidence-block[data-evidence-block-id="evidence-group-1"]');
  const block2 = () => page.locator('.workspace-evidence-block[data-evidence-block-id="evidence-group-2"]');
  const panel = id => page.locator(`.workspace-figure-panel-card[data-panel-id="${id}"] > summary`);
  check('first line has actual sparse AC membership', await block().locator(':scope > summary').innerText().then(t => t.split('\n')[0] === '证据块1：AC'));
  check('multicharacter members are separated', (await block2().locator(':scope > summary').innerText()).includes('证据块2：A1 · A2'));
  check('conclusion gets a second line', (await block().locator(':scope > summary').innerText()).split('\n').length === 2);
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 920 });
    await block().scrollIntoViewIfNeeded(); await shot(`${width}-collapsed`);
    await block().locator(':scope > summary').click();
    check(`${width}: source editor collapsed by default`, !(await block().locator('.workspace-evidence-summary-editor').count()) ||
      !(await block().locator('.workspace-evidence-summary-editor').evaluate(el => el.open)));
    const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    check(`${width}: no horizontal overflow`, geometry.scroll <= geometry.width + 1, geometry);
    const upstreamGeometry = await block().locator('[data-field="upstreamContext"]').evaluate(row => {
      const label = row.querySelector('strong').getBoundingClientRect(), text = row.querySelector('.workspace-figure-edit-target').getBoundingClientRect();
      return { gap: text.left - label.right, labelWidth: label.width };
    });
    check(`${width}: upstream label does not reserve a large empty column`, upstreamGeometry.gap >= 0 &&
      upstreamGeometry.gap <= 8 && upstreamGeometry.labelWidth <= 40, upstreamGeometry);
    await block().scrollIntoViewIfNeeded(); await shot(`${width}-expanded`);
    await block().locator(':scope > summary').click();
  }
  await block().locator(':scope > summary').click();
  check('Panel A shows genuine saved purpose', (await panel('A').innerText()).includes('给药与取样流程'));
  await block2().locator(':scope > summary').click();
  check('missing Panel description is explicit', (await panel('A1').innerText()).includes('描述待补'));
  await block2().scrollIntoViewIfNeeded(); await shot('520-missing-panel');
  check('two unique summary pieces preserve D2/D4-D8/D10/limit', await block().locator('.workspace-evidence-synthesis p').count() === 2 &&
    /D2[\s\S]*D4–D8[\s\S]*D10[\s\S]*不支持充分性/.test(await block().innerText()));
  if (phase === 'after') {
    const sourceSummary = () => block().locator('.workspace-evidence-summary-editor > summary');
    await sourceSummary().click();
    const target = field => block().locator(`[data-field="${field}"] .workspace-figure-edit-target`);
    const editor = page.locator('.workspace-figure-inline-editor');
    await target('groupGoal').focus(); await page.keyboard.press('Enter'); await editor.waitFor();
    check('source editor starts with the original value, not combined text', await editor.inputValue() === 'D2 观察毛发变化。');
    await editor.fill('人工条件 D2，保持对照。');
    await page.evaluate(() => { fig006.saveMode = 'error'; }); await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => document.body.innerText.includes('保存失败'));
    check('save failure retains human input', await editor.inputValue() === '人工条件 D2，保持对照。');
    await shot('520-save-error');
    await page.evaluate(() => { fig006.saveMode = 'normal'; }); await page.keyboard.press('Control+Enter'); await editor.waitFor({ state: 'detached' });
    check('editing one source preserves the other two', await page.evaluate(() => {
      const block = currentWorkspaceSnapshot.figures.draft.figures['figure-1'].evidenceBlocks[0];
      return block.groupGoal.value.includes('人工条件 D2') && block.groupGoal.humanReviewed && block.groupConclusion.value === 'D2 观察毛发变化。' && block.established.value.includes('D10');
    }));
    check('source editor remains open after save redraw', await block().locator('.workspace-evidence-summary-editor').evaluate(el => el.open));
    await target('groupConclusion').focus(); await page.keyboard.press('Enter'); await editor.waitFor(); await editor.fill('');
    await page.keyboard.press('Control+Enter'); await editor.waitFor({ state: 'detached' });
    await target('established').focus(); await page.keyboard.press('Enter'); await editor.waitFor();
    await editor.fill('人工确立 D4–D8 与 D10；不能推出因果性。'); await page.keyboard.press('Control+Enter'); await editor.waitFor({ state: 'detached' });
    await target('upstreamContext').focus(); await page.keyboard.press('Enter'); await editor.waitFor();
    check('upstream edit preserves full second sentence', (await editor.inputValue()).includes('第二句必须完整保留'));
    await editor.fill(''); await page.keyboard.press('Control+Enter'); await editor.waitFor({ state: 'detached' });
    check('cleared upstream does not resurrect derived question', (await target('upstreamContext').innerText()) === '尚未填写');
    await page.setViewportSize({ width: 360, height: 920 }); await block().scrollIntoViewIfNeeded(); await shot('360-reviewed-clear');
    check('shared memberships, remaining fields and raw model stay unchanged', await page.evaluate(() => {
      const stored = currentWorkspaceSnapshot.figures.draft.figures['figure-1'].evidenceBlocks[0];
      const initial = fig006.initial.figures.draft.figures['figure-1'].evidenceBlocks[0];
      const changed = new Set(['groupGoal', 'groupConclusion', 'established', 'upstreamContext']);
      return Object.keys(initial).every(key => changed.has(key) || JSON.stringify(initial[key]) === JSON.stringify(stored[key])) &&
        JSON.stringify(currentWorkspaceSnapshot.figures.figures[0].standard) === JSON.stringify(fig006.initial.figures.figures[0].standard);
    }));
    check('no render/edit triggered analyzer', await page.evaluate(() => !fig006.calls.some(call => /analyze|generate|interpret/i.test(call.action))));
    await page.reload(); await setup(); await block().locator(':scope > summary').click();
    check('real browser-local roundtrip retains three source edits and human empty', await page.evaluate(() => {
      const block = currentWorkspaceSnapshot.figures.draft.figures['figure-1'].evidenceBlocks[0];
      return block.groupGoal.humanReviewed && block.groupGoal.value.includes('人工条件') && block.groupConclusion.humanReviewed && block.groupConclusion.value === '' &&
        block.established.humanReviewed && block.established.value.includes('不能推出因果性') && block.upstreamContext.humanReviewed && block.upstreamContext.value === '';
    }));
    check('reopened display does not refill cleared upstream', (await target('upstreamContext').innerText()) === '尚未填写');
    await block().scrollIntoViewIfNeeded(); await shot('360-reloaded');
    for (const view of ['navigation', 'highlights', 'figures', 'chat', 'notes']) {
      await page.evaluate(view => switchWorkspaceView(view, { persist: false, loadNotes: false }), view);
      check(`module ${view} tool isolation`, await page.locator('[data-workspace-tools]:visible').evaluateAll((groups, view) => groups.every(group => group.dataset.workspaceTools === view), view));
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
  fs.writeFileSync(path.join(run, 'report.html'), `<!doctype html><meta charset="utf-8"><title>FIG-006</title><h1>FIG-006 ${phase} ${report.status}</h1><p>${escape(report.boundary)}</p>` +
    report.checks.map(item => `<p>${item.pass ? 'PASS' : 'FAIL'} ${escape(item.name)}</p>`).join('') +
    report.screenshots.map(file => `<h2>${file}</h2><img src="${file}" style="max-width:100%">`).join(''));
  console.log(`EVIDENCE ${run}`); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
