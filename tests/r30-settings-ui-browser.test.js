const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require('playwright');
const repo = process.env.BREVESS_TEST_REPO || process.cwd();
const batch = path.join(repo, 'output/r30-20261013/ui-candidate/settings');
const mode = process.argv[2] || (__filename.endsWith('.test.js') ? 'production' : 'current');
const sourceDir = mode === 'production' ? repo : path.join(batch, mode);
const evidence = process.env.BREVESS_SETTINGS_EVIDENCE || path.join(batch, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
const report = { scope: 'offline production settings DOM/CSS and navigation functions', checks: [], failures: [], networkRequests: 0 };
const read = name => fs.readFileSync(path.join(sourceDir, name), 'utf8');
function fn(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const next = /\n(?:async )?function /u.exec(source.slice(start + 1));
  return source.slice(start, next ? start + 1 + next.index : undefined);
}
async function check(name, run) {
  try { await run(); report.checks.push(name); }
  catch (error) { report.failures.push({ name, message: error.message }); }
}
test('R30 settings navigation, typography and feedback browser contract', async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/*', route => { report.networkRequests++; return route.abort(); });
    const html = read('options.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '').replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (all, before, src, after) => {
      const asset = path.join(repo, src);
      if (!fs.existsSync(asset)) return all;
      const mime = src.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      return before + 'data:' + mime + ';base64,' + fs.readFileSync(asset).toString('base64') + after;
    });
    await page.setContent(html);
    await page.addStyleTag({ content: read('options.css') });
    await page.addStyleTag({ content: fs.readFileSync(path.join(repo, 'options-local-library.css'), 'utf8') });
    await page.addStyleTag({ content: read('ui-swiss.css') });
    const source = read('options.js');
    const start = source.indexOf('const SETTINGS_PAGE_ORDER');
    const end = source.indexOf('const USER_DATA_ACTION_IDS', start);
    await page.addScriptTag({ content: source.slice(start, end) + '\n' + fn(source, 'organizeSettingsContent') + '\n' + fn(source, 'syncSettingsPageVisibility') + '\n' + fn(source, 'activateSettingsPage') + `
function renderOnboarding() {}
organizeSettingsContent();
document.querySelectorAll('[data-settings-nav]').forEach(button => button.addEventListener('click', () => activateSettingsPage(button.dataset.settingsNav, {updateHash:false,animate:false})));
activateSettingsPage('overview', {updateHash:false,animate:false});` });
    await check('01–10 stays a single left vertical rail at every width, with readable body and no horizontal overflow', async () => {
      for (const width of [1440, 1024, 760, 520, 360, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const data = await page.evaluate(() => {
          const buttons = [...document.querySelectorAll('.settings-sidebar [data-settings-nav]')].map(button => button.getBoundingClientRect().toJSON());
          const content = document.querySelector('.settings-content').getBoundingClientRect();
          return { buttons, visible: getComputedStyle(document.querySelector('.settings-sidebar')).display !== 'none', contentX: content.x, contentWidth: content.width, overflow: document.documentElement.scrollWidth > innerWidth + 1, offenders: [...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().right > innerWidth+1).slice(0,8).map(n=>({tag:n.tagName,id:n.id,cls:n.className,right:n.getBoundingClientRect().right})) };
        });
        assert.equal(data.visible, true, String(width));
        assert.equal(data.overflow, false, JSON.stringify({width,...data}));
        const availableWidth = await page.evaluate(() => document.documentElement.getBoundingClientRect().width);
        assert.ok(data.contentWidth >= Math.min(240, availableWidth - 80), JSON.stringify({width,availableWidth,contentWidth:data.contentWidth}));
        assert.ok(data.buttons.every((b, i) => Math.abs(b.x - data.buttons[0].x) < 1 && (!i || b.y > data.buttons[i - 1].y)), JSON.stringify({width,...data}));
        assert.ok(data.contentX >= data.buttons[0].right, JSON.stringify({width,...data}));
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await check('selected destination is larger, bolder, gold, and row geometry does not jump', async () => {
      const before = await page.locator('[data-settings-nav="about"]').boundingBox();
      await page.locator('[data-settings-nav="about"]').click();
      const data = await page.evaluate(() => {
        const selected = document.querySelector('[data-settings-nav="about"] .settings-nav-number');
        const idle = document.querySelector('[data-settings-nav="overview"] .settings-nav-number');
        return { selected: {size:parseFloat(getComputedStyle(selected).fontSize),weight:parseInt(getComputedStyle(selected).fontWeight),color:getComputedStyle(selected).color}, idle: {size:parseFloat(getComputedStyle(idle).fontSize),weight:parseInt(getComputedStyle(idle).fontWeight)} };
      });
      assert.ok(data.selected.size > data.idle.size);
      assert.ok(data.selected.weight > data.idle.weight);
      assert.equal(data.selected.color, 'rgb(255, 192, 0)');
      assert.deepEqual(await page.locator('[data-settings-nav="about"]').boundingBox(), before);
    });
    await check('all ten destinations activate the actual corresponding sections and keep exactly one selection', async () => {
      for (const id of ['overview','storage','models','workbench','modes','categories','reading','shortcuts','data','about']) {
        await page.locator('.settings-sidebar [data-settings-nav="' + id + '"]').click();
        assert.equal(await page.locator('body').getAttribute('data-active-settings-page'), id);
        assert.equal(await page.locator('.settings-sidebar [data-settings-nav][aria-selected="true"]').count(), 1);
        assert.ok(await page.locator('[data-settings-page="' + id + '"]:not([hidden])').count() >= 1);
      }
    });
    await check('philosophy is readable at desktop and narrow widths', async () => {
      for (const width of [1440, 360, 320]) {
        await page.setViewportSize({ width, height:900 });
        const data = await page.locator('.brand small').evaluate(node => ({ size:parseFloat(getComputedStyle(node).fontSize), display:getComputedStyle(node).display, right:node.getBoundingClientRect().right }));
        assert.notEqual(data.display, 'none');
        assert.ok(data.size >= 13);
        assert.ok(data.right <= width);
      }
    });
    await check('feedback preserves mailbox and opens official Issues safely without submission', async () => {
      assert.equal(await page.locator('#support a[href="mailto:brevess0729@163.com"]').count(), 1);
      const issues = page.locator('#support a[href="https://github.com/coolcoldplay/Brevess/issues"]');
      assert.equal(await issues.count(), 1);
      assert.equal(await issues.getAttribute('target'), '_blank');
      assert.match(await issues.getAttribute('rel'), /noopener/);
    });
    await check('short viewport rail scrolls independently and supports keyboard selection', async () => {
      await page.setViewportSize({ width:520,height:460 });
      const data = await page.locator('.settings-sidebar').evaluate(node => ({scrollable:node.scrollHeight > node.clientHeight,overflow:getComputedStyle(node).overflowY}));
      assert.equal(data.scrollable,true);
      assert.match(data.overflow,/auto|scroll/);
      await page.locator('[data-settings-nav="shortcuts"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('body').getAttribute('data-active-settings-page'),'shortcuts');
    });
    for (const width of [1440, 520, 320]) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(() => activateSettingsPage('about',{updateHash:false,animate:false}));
      await page.locator('[data-settings-nav="about"]').focus();
      await page.waitForTimeout(200);
      await page.screenshot({path:path.join(evidence, mode + '-settings-' + width + '.png')});
    }
  } catch (error) { report.failures.push({name:'runner',message:error.stack}); }
  finally {
    await browser?.close();
    report.status = report.failures.length ? 'FAIL' : 'PASS';
    fs.writeFileSync(path.join(evidence, mode + '-browser-report.json'), JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    assert.equal(report.failures.length, 0, JSON.stringify(report.failures));
  }
});
