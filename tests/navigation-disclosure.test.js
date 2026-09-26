const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const styles = ['popup.css', 'ui-swiss.css'].map(file =>
  fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
function sourceOf(name) {
  const start = popup.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const tail = popup.slice(start);
  const end = tail.search(/\n(?:async )?function /);
  assert.ok(end > 0, `${name} must have a following function`);
  return tail.slice(0, end);
}
const rendererSource = [
  'appendScientificInlineText', 'createWorkspaceElement',
  'buildOutlineSummaryIndex', 'workspaceParagraphsForNode',
  'renderWorkspaceBilingualTitle', 'renderPopupPdfSemanticNavigation',
  'renderArticleNavigationTree', 'setAllOutlineLevelsExpanded'
].map(sourceOf).join('\n');
let browser;
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });

async function withTree(kind, check) {
  const context = await browser.newContext({ offline: true, viewport: { width: 360, height: 700 } });
  const requests = [];
  const errors = [];
  await context.route(/^https?:\/\//, route => {
    requests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<body data-ui-surface="sidebar"><main id="articleNavigationTree"></main></body>');
    await page.addStyleTag({ content: styles });
    await page.evaluate(({ rendererSource, kind }) => {
      // Only data/context boundaries are replaced. Both complete renderers,
      // their DOM helpers, disclosure handlers and native details/buttons are real.
      window.currentPdfSemanticNavigation = null;
      window.normalizePopupPdfSemanticNavigation = () => null;
      window.workspaceParagraphSummaryState = new Map();
      window.reviewOutlineState = { running: false };
      window.t = text => text;
      window.unexpectedSourceJumps = 0;
      window.focusWorkspaceSource = () => { window.unexpectedSourceJumps++; };
      window.runPopupPdfSemanticFocus = () => { window.unexpectedSourceJumps++; };
      new Function(`${rendererSource}\nObject.assign(window, {
        renderArticleNavigationTree, renderPopupPdfSemanticNavigation,
        setAllOutlineLevelsExpanded
      });`)();
      if (kind === 'html') {
        const paragraph = { paragraphId: 'p1', sectionId: 'paragraphs', text: 'Synthetic paragraph.' };
        window.navigationFixture = {
          nodes: [{ sectionId: 'parent', title: 'Parent', children: [
            { sectionId: 'paragraphs', title: 'Paragraphs', paragraphCount: 1, children: [] },
            { sectionId: 'empty', title: 'Empty', paragraphCount: 0, children: [] }
          ] }], paragraphs: [paragraph]
        };
        renderArticleNavigationTree(window.navigationFixture);
      } else {
        const paragraph = { paragraphId: 'p1', expectedNormalizedQuote: 'Synthetic paragraph.' };
        window.navigationFixture = { sections: [{
          sectionId: 'parent', title: 'Parent', paragraphTargets: [], children: [
            { sectionId: 'paragraphs', title: 'Paragraphs', paragraphTargets: [paragraph], children: [] },
            { sectionId: 'empty', title: 'Empty', paragraphTargets: [], children: [] }
          ]
        }] };
        renderPopupPdfSemanticNavigation(document.getElementById('articleNavigationTree'), window.navigationFixture);
      }
    }, { rendererSource, kind });
    await check(page);
    assert.deepEqual(errors, [], 'Renderer must not report page errors');
    assert.deepEqual(requests, [], 'Disclosure must not request network resources');
    assert.equal(await page.evaluate(() => window.unexpectedSourceJumps), 0,
      'Disclosure must not invoke title/paragraph source navigation');
  } finally { await context.close(); }
}

const toggleFor = id => `[data-node-key="${id}"] > .workspace-tree-summary > .workspace-tree-toggle`;
async function waitForDisclosure(page, id, open) {
  await page.waitForFunction(({ selector, open }) => {
    const button = document.querySelector(selector);
    return button?.closest('details').open === open &&
      button.getAttribute('aria-expanded') === String(open);
  }, { selector: toggleFor(id), open }, { timeout: 3000 });
}

for (const kind of ['html', 'pdf']) {
  test(`${kind} outline disclosure is text-free with accurate accessible state`, async () => {
    await withTree(kind, async page => {
      const toggle = page.locator(toggleFor('parent'));
      assert.equal(await toggle.textContent(), '', 'CSS triangle replaces the old + / minus text');
      assert.equal(await toggle.getAttribute('type'), 'button');
      assert.equal(await toggle.getAttribute('aria-expanded'), String(kind === 'pdf'));
      assert.match(await toggle.getAttribute('aria-label'), /(?:展开|收起)Parent/);
      const appearance = await toggle.evaluate(node => {
        const style = getComputedStyle(node), triangle = getComputedStyle(node, '::before');
        return { width: style.width, height: style.height, border: style.borderWidth,
          triangleWidth: triangle.borderLeftWidth, transform: triangle.transform };
      });
      assert.deepEqual([appearance.width, appearance.height, appearance.border], ['24px', '28px', '0px']);
      assert.equal(appearance.triangleWidth, '6px');
      assert.equal(appearance.transform === 'none', kind === 'html');
      if (kind === 'html') assert.match(
        await page.locator(toggleFor('paragraphs')).getAttribute('aria-label'), /段落摘要/);
    });
  });

  test(`${kind} outline supports single mouse Enter Space toggles and programmatic expansion`, async () => {
    await withTree(kind, async page => {
      const toggle = page.locator(toggleFor('parent'));
      await page.evaluate(() => window.setAllOutlineLevelsExpanded(false));
      await waitForDisclosure(page, 'parent', false);
      await toggle.click();
      await waitForDisclosure(page, 'parent', true);
      await toggle.press('Space');
      await waitForDisclosure(page, 'parent', false);
      await toggle.press('Enter');
      await waitForDisclosure(page, 'parent', true);
      assert.equal(await toggle.evaluate(node => document.activeElement === node), true);
      assert.notEqual(await toggle.evaluate(node => getComputedStyle(node).outlineStyle), 'none');
      await page.evaluate(() => window.setAllOutlineLevelsExpanded(false));
      await waitForDisclosure(page, 'parent', false);
      await page.evaluate(() => window.setAllOutlineLevelsExpanded(true));
      await waitForDisclosure(page, 'parent', true);
      await page.evaluate(kind => {
        if (kind === 'html') renderArticleNavigationTree(window.navigationFixture);
        else {
          const container = document.getElementById('articleNavigationTree');
          const previouslyOpen = new Set([...container.querySelectorAll('details[open]')]
            .map(node => node.dataset.nodeKey));
          container.replaceChildren();
          renderPopupPdfSemanticNavigation(container, window.navigationFixture, { hadTree: true, previouslyOpen });
        }
      }, kind);
      await waitForDisclosure(page, 'parent', true);
    });
  });

  test(`${kind} outline hides only empty leaf disclosure and retains paragraph disclosure`, async () => {
    await withTree(kind, async page => {
      await page.evaluate(() => window.setAllOutlineLevelsExpanded(true));
      const empty = page.locator(toggleFor('empty'));
      assert.equal(await empty.isDisabled(), true);
      assert.equal(await empty.evaluate(node => getComputedStyle(node).visibility), 'hidden');
      const paragraphs = page.locator(toggleFor('paragraphs'));
      assert.equal(await paragraphs.isDisabled(), false);
      assert.equal(await paragraphs.isVisible(), true);
      await paragraphs.evaluate(node => { node.closest('details').open = false; });
      await waitForDisclosure(page, 'paragraphs', false);
      await paragraphs.click();
      await waitForDisclosure(page, 'paragraphs', true);
    });
  });
}
