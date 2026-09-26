import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || repositoryRoot);
const output = path.resolve(process.env.SCI_FRONTEND_OUTPUT_DIR ||
  path.join(repositoryRoot, 'output/playwright/frontend-fd2-20260906'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-frontend-reading-'));
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

const report = { status: 'FAIL', checks: [], screenshots: [], externalRequests: 0 };
let context;

async function assertActiveModuleTools(page, view) {
  for (const name of ['navigation', 'highlights', 'figures', 'notes']) {
    const tools = page.locator(`.side-panel-global-tools [data-workspace-tools="${name}"]`);
    assert.equal(await tools.count(), 1, `${name} has one top tool group`);
    assert.equal(await tools.isVisible(), name === view, `${view} tool visibility: ${name}`);
  }
}

try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: { width: 360, height: 844 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => {
    report.externalRequests += 1;
    return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('#sidePanelApp').waitFor();
  await page.waitForFunction(() => panelUiReady === true);
  await page.evaluate(() => synchronizeActiveTabContext());
  // A side-panel document is not itself the active browser tab. This verifier opens
  // popup.html as a tab, so mark the temporary harness context active before clicks.
  await page.evaluate(() => { activePanelTabContext.activated = true;
    // Component harness opens the sidebar as a tab: synchronize its visual guard, too.
    document.getElementById('sidePanelApp').classList.remove('is-tab-inactive'); });
  assert.equal(await page.locator('[data-workspace-view="navigation"]').isVisible(), true);
  assert.equal(await page.locator('[data-workspace-target="navigation"]').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('[data-workspace-view="analysis"]').isVisible(), false);
  await assertActiveModuleTools(page, 'navigation');
  report.checks.push('fresh sidebar opens navigation with matching selected tab');
  await page.locator('#navigationOutlineControls').waitFor({ state: 'visible' });
  assert.equal(await page.locator(
    '#sidePanelDocumentStatus .side-panel-global-tools #navigationOutlineControls').count(), 1);
  assert.equal(await page.locator('#navigationOutlineControls #expandAllOutlineLevels').isVisible(), true);
  assert.equal(await page.locator('#navigationOutlineControls #collapseAllOutlineLevels').isVisible(), true);
  assert.equal(await page.locator(
    '[data-workspace-view="navigation"] .workspace-outline-toolbar').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  report.checks.push('outline level controls live in the top tools row without a duplicate navigation toolbar');
  const bottomNavigation = await page.locator('.workspace-bottom-nav').evaluate(node => {
    const rect = node.getBoundingClientRect();
    const buttons = [...node.querySelectorAll('button')];
    return {
      bottom: rect.bottom, viewportHeight: innerHeight,
      count: buttons.length,
      minimumTargetHeight: Math.min(...buttons.map(button => button.getBoundingClientRect().height))
    };
  });
  assert.ok(Math.abs(bottomNavigation.bottom - bottomNavigation.viewportHeight) <= 1,
    'module navigation must remain at the bottom of the sidebar');
  assert.equal(bottomNavigation.count, 5);
  assert.ok(bottomNavigation.minimumTargetHeight >= 44);
  report.bottomNavigation = bottomNavigation;
  report.checks.push('all five module entries stay at the bottom with accessible targets');
  await page.locator('[data-workspace-target="highlights"]').click();
  assert.equal(await page.locator('[data-workspace-view="highlights"]').isVisible(), true);
  assert.equal(await page.locator('#navigationOutlineControls').isVisible(), false);
  await assertActiveModuleTools(page, 'highlights');
  assert.equal(await page.locator('#highlightsModuleTools #applyHighlight').isVisible(), true);
  assert.equal(await page.locator('[data-workspace-view="highlights"] #applyHighlight').count(), 0);
  assert.equal(await page.locator('[data-workspace-target="analysis"]').count(), 0);
  await page.locator('#highlightControls > summary').click();
  assert.equal(await page.locator('#applyHighlight').isVisible(), true);
  report.checks.push('excerpts expose the top apply action and retained highlighting settings without duplicates');
  await page.evaluate(() => resetPanelArticleState());
  assert.equal(await page.locator('[data-workspace-view="navigation"]').isVisible(), true);
  assert.equal(await page.locator('#navigationOutlineControls').isVisible(), true);
  await page.evaluate(() => applyRestoredSidePanelUiState({ activeWorkspaceView: 'chat' }));
  assert.equal(await page.locator('[data-workspace-view="chat"]').isVisible(), true);
  assert.equal(await page.locator('#navigationOutlineControls').isVisible(), false);
  report.checks.push('new document resets to navigation while explicit saved view still restores');
  await page.evaluate(() => applyRestoredSidePanelUiState({ activeWorkspaceView: 'analysis' }));
  assert.equal(await page.locator('[data-workspace-view="highlights"]').isVisible(), true);
  assert.equal(await page.locator('#applyHighlight').isVisible(), true);
  await assertActiveModuleTools(page, 'highlights');
  report.checks.push('saved analysis view migrates to excerpts with highlighting controls available');

  const base = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    titleWidth: document.querySelector('#sidePanelPaperTitle')?.getBoundingClientRect().width || 0,
    notificationWidth: document.querySelector('#sidePanelNotificationCenter')
      ?.getBoundingClientRect().width || 0,
    missingGlyphs: [...document.querySelectorAll('i.ph')].filter(node => {
      const content = getComputedStyle(node, '::before').content;
      return !content || content === 'none' || content === 'normal' || content === '""';
    }).map(node => node.className)
  }));
  assert.equal(base.overflow, false);
  assert.ok(base.titleWidth >= 70, `paper title width ${base.titleWidth}`);
  assert.ok(base.notificationWidth <= 170.5, `notification width ${base.notificationWidth}`);
  assert.deepEqual(base.missingGlyphs, []);
  report.checks.push('360px header keeps the paper title readable with valid icons');

  // Popup startup refreshes the synthetic harness context asynchronously. Re-arm
  // it immediately before interaction so the real inactive-panel click guard
  // cannot consume this verifier-only click.
  await page.evaluate(() => { activePanelTabContext.activated = true;
    // Component harness opens the sidebar as a tab: synchronize its visual guard, too.
    document.getElementById('sidePanelApp').classList.remove('is-tab-inactive'); });
  await page.locator('#sidePanelMoreToolsSummary').click();
  const toolsOpen = await page.locator('#sidePanelMoreTools').evaluate(node => node.open);
  report.toolsOpenAfterClick = toolsOpen;
  assert.equal(toolsOpen, true, 'more-tools disclosure did not open');
  const menuItems = page.locator('#sidePanelMoreTools [role="menuitem"]');
  assert.equal(await menuItems.count(), 6);
  await menuItems.first().waitFor({ state: 'visible' });
  const menuShot = path.join(output, '01-toolbar-more-menu-360.png');
  await page.screenshot({ path: menuShot });
  report.screenshots.push(menuShot);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sidePanelMoreTools').evaluate(node => node.open), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'sidePanelMoreToolsSummary');

  await page.locator('#sidePanelNotificationSummary').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sidePanelNotificationCenter').evaluate(node => node.open), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'sidePanelNotificationSummary');
  report.checks.push('secondary tools and notifications close on Escape and restore focus');

  await page.setViewportSize({ width: 420, height: 844 });
  await page.locator('[data-workspace-target="notes"]').click();
  await page.locator('#literatureNoteDrawer').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-workspace-target="notes"]').getAttribute('aria-selected'), 'true');
  await assertActiveModuleTools(page, 'notes');
  assert.equal(await page.locator('#notesModuleTools #literatureNoteTemplateSelect').isVisible(), true);
  assert.equal(await page.locator('#notesModuleTools #autofillLiteratureNote').isVisible(), true);
  assert.equal(await page.locator('#literatureNoteDrawer #literatureNoteTemplateSelect').count(), 0);
  assert.equal(await page.locator('#literatureNoteDrawer #autofillLiteratureNote').count(), 0);
  assert.equal(await page.locator('.side-panel-header #openLiteratureNote').count(), 0);
  const noteLayout = await page.locator('#literatureNoteDrawer').evaluate(node => ({
    position: getComputedStyle(node).position,
    bottom: node.getBoundingClientRect().bottom,
    navTop: document.querySelector('.workspace-bottom-nav').getBoundingClientRect().top
  }));
  assert.notEqual(noteLayout.position, 'absolute');
  assert.ok(noteLayout.bottom <= noteLayout.navTop + 1, 'notes must not cover bottom navigation');
  report.checks.push('notes open as a full workspace module above the persistent navigation');
  const firstNote = page.locator('[data-literature-note-field]').first();
  await firstNote.waitFor();
  await firstNote.fill('证据记录。'.repeat(180));
  await page.waitForTimeout(120);
  const noteMetrics = await firstNote.evaluate(node => ({
    fontSize: getComputedStyle(node).fontSize,
    overflowY: getComputedStyle(node).overflowY,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight
  }));
  assert.equal(noteMetrics.fontSize, '14px');
  assert.equal(noteMetrics.overflowY, 'hidden');
  assert.ok(noteMetrics.clientHeight >= noteMetrics.scrollHeight - 1,
    `note textarea ${noteMetrics.clientHeight}/${noteMetrics.scrollHeight}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  const noteShot = path.join(output, '02-literature-note-autogrow-420.png');
  await page.screenshot({ path: noteShot });
  report.screenshots.push(noteShot);
  report.checks.push('literature note text is 14px and grows without an internal scrollbar');

  await page.setViewportSize({ width: 360, height: 844 });
  await page.evaluate(() => {
    closeLiteratureNoteDrawer();
    switchWorkspaceView('chat');
  });
  await page.locator('.workspace-view[data-workspace-view="chat"]').waitFor({ state: 'visible' });
  await assertActiveModuleTools(page, 'chat');
  const chatMetrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    modelStatus: document.querySelector('#articleChatModelStatus')?.innerText || '',
    searchHelp: document.querySelector('.article-chat-search-option')?.innerText || '',
    answerFont: getComputedStyle(document.querySelector('.article-chat-message-content') ||
      document.querySelector('#articleChatQuestion')).fontSize
  }));
  assert.equal(chatMetrics.overflow, false);
  assert.match(chatMetrics.modelStatus, /模型|Model/iu);
  assert.match(chatMetrics.searchHelp, /可选|optional/iu);
  const chatShot = path.join(output, '03-chat-composer-360.png');
  await page.screenshot({ path: chatShot });
  report.screenshots.push(chatShot);
  report.checks.push('chat shows model readiness and optional web-search guidance without overflow');

  await page.setViewportSize({ width: 560, height: 844 });
  await page.evaluate(() => switchWorkspaceView('figures', { persist: false }));
  await assertActiveModuleTools(page, 'figures');
  for (const id of ['expandAllFigureLevels', 'collapseAllFigureLevels',
    'analyzeFiguresFromFigures', 'openSupplementalFigureImport']) {
    assert.equal(await page.locator(`#figuresModuleTools #${id}`).isVisible(), true);
    assert.equal(await page.locator(`[data-workspace-view="figures"] #${id}`).count(), 0);
  }
  report.checks.push('Figure actions occupy one top tool group without body duplicates');
  await page.evaluate(() => {
    const host = document.createElement('section');
    host.id = 'frontendFigureFieldFixture';
    host.style.cssText = 'position:fixed;inset:90px 10px auto;z-index:999;background:white;padding:12px';
    appendFigureWorkspaceViewField(host, localizeFigureWorkspacePanelField({
      key: 'evidenceType', label: '证据类型', value: 'phenotype_measurement'
    }), { figureId: 'fixture-figure' });
    document.body.appendChild(host);
  });
  assert.equal(await page.locator('#frontendFigureFieldFixture .workspace-figure-view-value').innerText(),
    '表型测量');
  const editableField = page.locator('#frontendFigureFieldFixture .workspace-figure-edit-target');
  await editableField.waitFor({ state: 'visible' });
  assert.equal(await editableField.getAttribute('role'), 'button');
  assert.equal(await editableField.getAttribute('tabindex'), '0');
  assert.match(await editableField.getAttribute('aria-label'), /Enter/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  const figureShot = path.join(output, '04-figure-display-edit-control-560.png');
  await page.screenshot({ path: figureShot });
  report.screenshots.push(figureShot);
  report.checks.push('Figure enums localize in the display layer with a keyboard-addressable edit target');

  assert.deepEqual(errors, []);
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
      path.basename(resolved).startsWith('brevess-frontend-reading-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  status: report.status,
  checks: report.checks.length,
  externalRequests: report.externalRequests,
  error: report.error
}));
