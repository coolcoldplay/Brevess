const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const styles = ['popup.css', 'ui-swiss.css'].map(file =>
  fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const start = popup.indexOf('function switchWorkspaceView(');
const end = popup.indexOf('\nfunction scheduleActiveWorkspaceUiStateSave(', start);
assert.ok(start >= 0 && end > start);
const switchSource = popup.slice(start, end);
const groups = {
  navigation: ['navigationOutlineControls', 'expandAllOutlineLevels', 'collapseAllOutlineLevels'],
  highlights: ['highlightsModuleTools', 'applyHighlight'],
  figures: ['figuresModuleTools', 'expandAllFigureLevels', 'collapseAllFigureLevels',
    'analyzeFiguresFromFigures', 'openSupplementalFigureImport'],
  notes: ['notesModuleTools', 'literatureNoteTemplateSelect', 'autofillLiteratureNote']
};
let browser;
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });

async function withModuleTools(check) {
  const context = await browser.newContext({ offline: true, viewport: { width: 420, height: 844 } });
  const requests = [], errors = [];
  await context.route(/^https?:\/\//, route => {
    requests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    // Use the production markup/CSS and switcher; omit boot/network resources.
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
      .replace(/<link\b[^>]*>/giu, ''));
    await page.addStyleTag({ content: styles });
    await page.evaluate(source => {
      window.literatureNoteOpenSequence = 0;
      window.activeWorkspaceView = 'navigation';
      window.closeFigurePanelHeaderFieldsMenu = () => {};
      window.sidebarFocusModeController = { sync() {} };
      window.switchToolsFixture = new Function(`${source}\nreturn switchWorkspaceView;`)();
    }, switchSource);
    await check(page);
    assert.deepEqual(requests, [], 'View switching must not make external requests');
    assert.deepEqual(errors, [], 'View switching must not report page errors');
  } finally { await context.close(); }
}

test('module actions have unique IDs in their top tool groups, never duplicate body controls', async () => {
  await withModuleTools(async page => {
    for (const [view, [groupId, ...ids]] of Object.entries(groups)) {
      assert.equal(await page.locator(`#${groupId}`).count(), 1, `${view} has one group`);
      assert.equal(await page.locator(`#sidePanelDocumentStatus .side-panel-global-tools > #${groupId}`).count(), 1);
      assert.equal(await page.locator(`#${groupId}`).getAttribute('data-workspace-tools'), view);
      for (const id of ids) {
        assert.equal(await page.locator(`[id="${id}"]`).count(), 1, `${id} must stay unique`);
        assert.equal(await page.locator(`#${groupId} #${id}`).count(), 1, `${id} belongs to ${view}`);
        assert.equal(await page.locator(`[data-workspace-view] #${id}`).count(), 0, `${id} is absent from body modules`);
      }
    }
  });
});

test('real workspace switching shows only its own module actions including legacy analysis', async () => {
  await withModuleTools(async page => {
    for (const [view, expected] of [
      ['navigation', 'navigation'], ['highlights', 'highlights'], ['figures', 'figures'],
      ['notes', 'notes'], ['chat', null], ['mechanism', null], ['analysis', 'highlights'],
      ['navigation', 'navigation']
    ]) {
      await page.evaluate(view => window.switchToolsFixture(view, { persist: false, loadNotes: false }), view);
      for (const [groupView, [id]] of Object.entries(groups)) {
        assert.equal(await page.locator(`#${id}`).count(), 1, `${id} remains mounted`);
        assert.equal(await page.locator(`#${id}`).isVisible(), groupView === expected,
          `${view} must ${groupView === expected ? 'show' : 'hide'} ${groupView} actions`);
      }
    }
  });
});

test('task pause/cancel and note field/status surfaces stay in their owning content modules', async () => {
  await withModuleTools(async page => {
    for (const [view, ids] of Object.entries({
      highlights: ['highlightTaskControls', 'pauseHighlightAnalysis', 'cancelHighlightAnalysis'],
      figures: ['figureTaskControls', 'pauseFigureAnalysis', 'cancelFigureAnalysis', 'figureWorkspaceSummary'],
      notes: ['literatureNoteStatus', 'literatureNoteModelHint', 'literatureNoteForm', 'literatureNoteFields']
    })) for (const id of ids) {
      assert.equal(await page.locator(`[id="${id}"]`).count(), 1);
      assert.equal(await page.locator(`[data-workspace-view="${view}"] #${id}`).count(), 1);
      assert.equal(await page.locator(`.side-panel-global-tools #${id}`).count(), 0);
    }
  });
});
